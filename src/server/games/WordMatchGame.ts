import { Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { BaseGame } from './GameInterface';
import { 
  GameConfig, 
  PlayerMetadata, 
  GameMetadata, 
  MoveData,
  isPlayerMetadata,
  isMoveData
} from '../types';

/**
 * Implementation of the original "Match My Guess" game
 */
export class WordMatchGame extends BaseGame {
  private players: Map<string, {
    id: string;
    name: string;
    socketId?: string;
    secretWord?: string;
    isHost: boolean;
    dbId?: string;
  }> = new Map();
  
  private guesses: Array<{
    id: string;
    playerId: string;
    playerName: string;
    word: string;
    timestamp: Date;
    dbId?: string;
  }> = [];
  
  private title: string = 'Match My Guess';
  private status: string = 'WAITING';
  private dbStatus: string = 'IN_PROGRESS'; // Track the database status separately
  private winningWord: string | null = null;
  private lobbyId?: string;
  private countdownTimer: NodeJS.Timeout | null = null;
  private countdownSeconds: number = 0;
  
  constructor(prisma: PrismaClient, io: any) {
    super(prisma, io);
  }
  
  get gameType(): string {
    return 'WORD_MATCH';
  }
  
  async initialize(gameId: string, config: GameConfig): Promise<void> {
    this.gameId = gameId;
    this.title = config.title || 'Match My Guess';
    this.status = 'WAITING'; // Game state in metadata
    this.dbStatus = 'IN_PROGRESS'; // Database status
    
    console.log(`Initializing WordMatchGame for game ${gameId}, title: ${this.title}`);
    
    // Get game data from database if it exists
    const game = await this.prisma.$queryRaw`
      SELECT g.*, l.id as "lobbyId", l."hostId"
      FROM "Game" g
      JOIN "Lobby" l ON g."lobbyId" = l.id
      WHERE g.id = ${gameId}
    `;
    
    if (game && Array.isArray(game) && game.length > 0) {
      const gameData = game[0];
      this.lobbyId = gameData.lobbyId;
      this.dbStatus = gameData.status;
      
      // Get game state from metadata
      const metadata = gameData.metadata as any;
      if (metadata?.status) {
        this.status = metadata.status;
      }
      
      console.log(`Loaded game data for game ${gameId}, status: ${this.status}`);
      
      // Load players
      const players = await this.prisma.$queryRaw`
        SELECT p.*, u."displayName"
        FROM "Player" p
        JOIN "User" u ON p."userId" = u.id
        WHERE p."gameId" = ${gameId}
      `;
      
      if (players && Array.isArray(players)) {
        for (const player of players) {
          const metadata = player.metadata as any;
          const secretWord = metadata?.secretWord as string | undefined;
          
          this.players.set(player.id, {
            id: player.id,
            name: player.displayName,
            secretWord,
            isHost: gameData.hostId === player.userId,
            dbId: player.id
          });
        }
      }
      
      // Load moves/guesses
      const moves = await this.prisma.$queryRaw`
        SELECT m.*, p.id as "playerId", u."displayName"
        FROM "Move" m
        JOIN "Player" p ON m."playerId" = p.id
        JOIN "User" u ON p."userId" = u.id
        WHERE m."gameId" = ${gameId} AND m."moveType" = 'guess'
      `;
      
      if (moves && Array.isArray(moves)) {
        for (const move of moves) {
          const data = move.data as any;
          if (data && typeof data.word === 'string') {
            this.guesses.push({
              id: move.id,
              playerId: move.playerId,
              playerName: move.displayName,
              word: data.word,
              timestamp: move.createdAt,
              dbId: move.id
            });
          }
        }
      }
      
      // Check if game is already complete
      if (metadata && metadata.winningWord) {
        this.winningWord = metadata.winningWord;
      }
    }

    // Update game metadata in database to ensure it's correct
    await this.prisma.$executeRaw`
      UPDATE "Game"
      SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{status}', ${JSON.stringify(this.status)}::jsonb)
      WHERE id = ${this.gameId}
    `;
  }
  
  async addPlayer(playerId: string, playerName: string, isHost: boolean): Promise<void> {
    // Check if player already exists
    if (this.players.has(playerId)) {
      // Update the player's connection status
      const player = this.players.get(playerId)!;
      console.log(`Player ${playerName} (${playerId}) reconnected to game ${this.gameId}`);
      
      // Emit updated game state to all players
      this.emitToGame('gameState', await this.getPublicGameState());
      return;
    }
    
    // Add new player
    this.players.set(playerId, {
      id: playerId,
      name: playerName,
      isHost,
      dbId: playerId
    });
    
    console.log(`Player ${playerName} (${playerId}) added to game ${this.gameId}`);
    
    // If we have 2 players and game is in WAITING state, start the countdown
    if (this.players.size === 2 && this.status === 'WAITING') {
      this.startCountdown();
    }
    
    // Emit updated game state to all players
    this.emitToGame('gameState', await this.getPublicGameState());
  }
  
  async removePlayer(playerId: string): Promise<void> {
    this.players.delete(playerId);
    
    // If a player leaves during countdown, cancel it
    if (this.countdownTimer && this.status === 'WAITING') {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
      this.countdownSeconds = 0;
      this.emitToGame('gameState', await this.getPublicGameState());
    }
    
    // If all players left, abandon the game
    if (this.players.size === 0) {
      await this.abandonGame();
    }
  }
  
  async setPlayerReady(playerId: string, metadata: PlayerMetadata): Promise<void> {
    const player = this.players.get(playerId);
    if (!player) return;
    
    if (isPlayerMetadata(metadata) && metadata.secretWord) {
      player.secretWord = metadata.secretWord;
      
      // Update player in database
      if (player.dbId) {
        await this.prisma.$executeRaw`
          UPDATE "Player"
          SET "isReady" = true,
              "metadata" = jsonb_set("metadata"::jsonb, '{secretWord}', ${JSON.stringify(metadata.secretWord)}::jsonb)
          WHERE id = ${player.dbId}
        `;
      }
      
      // Check if all players have set their secret words
      const allReady = Array.from(this.players.values()).every(p => p.secretWord);
      if (allReady && this.status === 'SETTING_WORDS') {
        await this.updateGameState('PLAYING');
      }
    }
  }
  
  async processMove(playerId: string, moveData: MoveData): Promise<{
    isGameOver: boolean;
    gameOverData?: GameMetadata;
  }> {
    if (!isMoveData(moveData)) {
      return { isGameOver: false };
    }
    
    const player = this.players.get(playerId);
    if (!player) {
      return { isGameOver: false };
    }
    
    const { word } = moveData;
    
    // Create a new guess
    const guess = {
      id: `guess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      playerId,
      playerName: player.name,
      word,
      timestamp: new Date(),
      dbId: undefined as string | undefined
    };
    
    this.guesses.push(guess);
    
    // Save move to database
    if (player.dbId) {
      const result = await this.prisma.$executeRaw`
        INSERT INTO "Move" ("id", "createdAt", "moveType", "data", "gameId", "playerId")
        VALUES (gen_random_uuid(), NOW(), 'guess', ${JSON.stringify({ word })}::jsonb, ${this.gameId}, ${player.dbId})
        RETURNING id
      `;
      
      // This is a simplification - in a real implementation, you'd get the ID back
      guess.dbId = `move_${Date.now()}`;
    }
    
    // Emit the new guess to all players
    this.emitToGame('newGuess', {
      playerId: guess.playerId,
      playerName: guess.playerName,
      word: guess.word,
      timestamp: guess.timestamp
    });
    
    // Check for matching guesses
    const matchingWord = this.checkForMatchingGuess();
    if (matchingWord) {
      // Game is over
      this.winningWord = matchingWord;
      
      // Update game status in database
      await this.prisma.$executeRaw`
        UPDATE "Game"
        SET "status" = 'COMPLETED',
            "endedAt" = NOW(),
            "metadata" = jsonb_set("metadata"::jsonb, '{winningWord}', ${JSON.stringify(matchingWord)}::jsonb)
        WHERE id = ${this.gameId}
      `;
      
      // Emit game over event
      this.emitToGame('gameOver', {
        winningWord: matchingWord
      });
      
      return {
        isGameOver: true,
        gameOverData: {
          winningWord: matchingWord
        }
      };
    }
    
    return { isGameOver: false };
  }
  
  registerSocketEvents(socket: Socket, playerId: string): void {
    // Update the player's socket ID
    const player = this.players.get(playerId);
    if (player) {
      player.socketId = socket.id;
      console.log(`Registered socket events for player ${player.name} (${playerId}) in game ${this.gameId}`);
    }
    
    // Join the game room
    socket.join(`game:${this.gameId}`);
    
    // Send current game state to the player
    this.getPublicGameState().then(gameState => {
      socket.emit('gameState', gameState);
    });
    
    // Handle set secret word
    socket.on('setSecretWord', async (word: string, callback) => {
      try {
        if (!player) {
          callback(false);
          return;
        }
        
        // Set the player's secret word
        player.secretWord = word.toLowerCase().trim();
        
        // Update player metadata in database
        await this.prisma.$executeRaw`
          UPDATE "Player"
          SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{secretWord}', ${JSON.stringify(player.secretWord)}::jsonb)
          WHERE id = ${playerId}
        `;
        
        console.log(`Player ${player.name} set secret word: ${player.secretWord}`);
        
        // Check if all players have set their secret words
        const allPlayersReady = Array.from(this.players.values()).every(p => p.secretWord);
        if (allPlayersReady && this.status === 'SETTING_WORDS') {
          this.status = 'PLAYING';
          
          // Update game status in database
          await this.prisma.$executeRaw`
            UPDATE "Game"
            SET "status" = 'IN_PROGRESS',
                "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{status}', '"PLAYING"'::jsonb)
            WHERE id = ${this.gameId}
          `;
        }
        
        // Emit updated game state to all players
        this.emitToGame('gameState', await this.getPublicGameState());
        
        callback(true);
      } catch (error) {
        console.error('Error setting secret word:', error);
        callback(false);
      }
    });
  }
  
  async getGameState(): Promise<any> {
    // Get player connection status from database
    const playerStatuses = await this.prisma.$queryRaw<Array<{id: string, metadata: any, lastActiveAt: Date}>>`
      SELECT id, metadata, "lastActiveAt"
      FROM "Player"
      WHERE "gameId" = ${this.gameId}
    `;
    
    // Create a map of player IDs to connection status
    const connectionStatus = new Map<string, boolean>();
    for (const status of playerStatuses) {
      const isDisconnected = status.metadata?.isDisconnected === true;
      connectionStatus.set(status.id, !isDisconnected);
    }
    
    return {
      id: this.gameId,
      title: this.title,
      status: this.status,
      gameType: this.gameType,
      countdownSeconds: this.countdownSeconds,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        socketId: p.socketId,
        secretWord: p.secretWord || '',
        isHost: p.isHost,
        isConnected: connectionStatus.get(p.id) ?? true
      })),
      guesses: this.guesses.map(g => ({
        playerId: g.playerId,
        playerName: g.playerName,
        word: g.word,
        timestamp: g.timestamp
      })),
      winningWord: this.winningWord
    };
  }
  
  async getPublicGameState(): Promise<any> {
    const state = await this.getGameState();
    
    // Hide secret words in public state
    state.players = state.players.map((p: any) => ({
      ...p,
      secretWord: p.secretWord ? '[hidden]' : ''
    }));
    
    return state;
  }
  
  async startGame(): Promise<void> {
    this.status = 'IN_PROGRESS';
    
    // Update lobby status in database
    if (this.lobbyId) {
      await this.prisma.$executeRaw`
        UPDATE "Lobby"
        SET "status" = 'IN_GAME'
        WHERE id = ${this.lobbyId}
      `;
    }
    
    // Emit updated game state
    const gameState = await this.getPublicGameState();
    this.emitToGame('gameState', gameState);
  }
  
  async endGame(metadata: GameMetadata): Promise<void> {
    this.status = 'COMPLETED';
    this.dbStatus = 'COMPLETED';
    
    if (metadata.winningWord) {
      this.winningWord = metadata.winningWord;
    }
    
    // Update game status and metadata in database
    await this.prisma.$executeRaw`
      UPDATE "Game"
      SET "status" = 'COMPLETED',
          "endedAt" = NOW(),
          "metadata" = jsonb_set(
            jsonb_set(COALESCE("metadata", '{}'::jsonb), '{status}', '"COMPLETED"'::jsonb),
            '{winningWord}', ${JSON.stringify(this.winningWord)}::jsonb
          )
      WHERE id = ${this.gameId}
    `;
    
    // Update lobby status
    if (this.lobbyId) {
      await this.prisma.$executeRaw`
        UPDATE "Lobby"
        SET "status" = 'COMPLETED'
        WHERE id = ${this.lobbyId}
      `;
    }
    
    // Emit game over event
    this.emitToGame('gameOver', {
      winningWord: this.winningWord
    });
  }
  
  async abandonGame(): Promise<void> {
    // Clear any active countdown
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    
    this.status = 'ABANDONED';
    this.dbStatus = 'ABANDONED';
    
    // Update game status in database
    await this.prisma.$executeRaw`
      UPDATE "Game"
      SET "status" = 'ABANDONED',
          "endedAt" = NOW(),
          "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{status}', '"ABANDONED"'::jsonb)
      WHERE id = ${this.gameId}
    `;
    
    // Emit final game state
    this.emitToGame('gameState', await this.getPublicGameState());
  }
  
  private checkForMatchingGuess(): string | null {
    if (this.guesses.length < 2) return null;
    
    // Get the most recent guess
    const latestGuess = this.guesses[this.guesses.length - 1];
    
    // Get all player IDs
    const playerIds = Array.from(this.players.keys());
    
    // For each player, get their most recent guess
    const latestGuessesByPlayer = new Map<string, string>();
    
    // Process guesses in reverse order to find the latest for each player
    for (let i = this.guesses.length - 1; i >= 0; i--) {
      const guess = this.guesses[i];
      if (!latestGuessesByPlayer.has(guess.playerId)) {
        latestGuessesByPlayer.set(guess.playerId, guess.word);
      }
      
      // If we have a latest guess for all players, stop searching
      if (latestGuessesByPlayer.size === playerIds.length) {
        break;
      }
    }
    
    // Check if all players have the same latest guess
    const allGuesses = Array.from(latestGuessesByPlayer.values());
    if (allGuesses.length < 2) return null;
    
    const firstGuess = allGuesses[0];
    const allMatch = allGuesses.every(guess => guess === firstGuess);
    
    return allMatch ? firstGuess : null;
  }
  
  private async updateGameState(newState: string): Promise<void> {
    this.status = newState;
    
    // Update metadata in database
    await this.prisma.$executeRaw`
      UPDATE "Game"
      SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{status}', ${JSON.stringify(this.status)}::jsonb)
      WHERE id = ${this.gameId}
    `;
    
    // Emit the updated game state
    this.emitToGame('gameState', await this.getPublicGameState());
  }
  
  private startCountdown(): void {
    this.countdownSeconds = 5; // 5 second countdown
    
    // Clear any existing timer
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }
    
    // Start the countdown
    this.countdownTimer = setInterval(async () => {
      this.countdownSeconds--;
      
      // Emit the current game state with updated countdown
      this.emitToGame('gameState', await this.getPublicGameState());
      
      if (this.countdownSeconds <= 0) {
        // Clear the timer
        if (this.countdownTimer) {
          clearInterval(this.countdownTimer);
          this.countdownTimer = null;
        }
        
        // Move to setting words phase
        await this.updateGameState('SETTING_WORDS');
      }
    }, 1000);
  }
} 