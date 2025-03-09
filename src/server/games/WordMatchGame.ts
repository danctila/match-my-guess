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
  private status: string = 'IN_PROGRESS';
  private winningWord: string | null = null;
  private lobbyId?: string;
  
  constructor(prisma: PrismaClient, io: any) {
    super(prisma, io);
  }
  
  get gameType(): string {
    return 'WORD_MATCH';
  }
  
  async initialize(gameId: string, config: GameConfig): Promise<void> {
    this.gameId = gameId;
    this.title = config.title || 'Match My Guess';
    
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
      this.status = gameData.status;
      
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
      const metadata = gameData.metadata as any;
      if (metadata && metadata.winningWord) {
        this.winningWord = metadata.winningWord;
      }
    }
  }
  
  async addPlayer(playerId: string, playerName: string, isHost: boolean): Promise<void> {
    this.players.set(playerId, {
      id: playerId,
      name: playerName,
      isHost
    });
  }
  
  async removePlayer(playerId: string): Promise<void> {
    this.players.delete(playerId);
    
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
      if (allReady) {
        await this.startGame();
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
    const player = this.players.get(playerId);
    if (player) {
      player.socketId = socket.id;
    }
    
    // Join the game room
    socket.join(`game:${this.gameId}`);
    
    // Send current game state to the player
    this.getPublicGameState().then(gameState => {
      socket.emit('gameState', gameState);
    });
  }
  
  async getGameState(): Promise<any> {
    return {
      id: this.gameId,
      title: this.title,
      status: this.status,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        secretWord: p.secretWord || ''
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
    if (metadata.winningWord) {
      this.winningWord = metadata.winningWord;
    }
    
    // Update game status in database
    await this.prisma.$executeRaw`
      UPDATE "Game"
      SET "status" = 'COMPLETED',
          "endedAt" = NOW(),
          "metadata" = jsonb_set("metadata"::jsonb, '{winningWord}', ${JSON.stringify(this.winningWord)}::jsonb)
      WHERE id = ${this.gameId}
    `;
    
    // Update lobby status
    if (this.lobbyId) {
      await this.prisma.$executeRaw`
        UPDATE "Lobby"
        SET "status" = 'FINISHED'
        WHERE id = ${this.lobbyId}
      `;
    }
    
    // Emit game over event
    this.emitToGame('gameOver', {
      winningWord: this.winningWord
    });
  }
  
  async abandonGame(): Promise<void> {
    this.status = 'ABANDONED';
    
    // Update game status in database
    await this.prisma.$executeRaw`
      UPDATE "Game"
      SET "status" = 'ABANDONED',
          "endedAt" = NOW()
      WHERE id = ${this.gameId}
    `;
    
    // Update lobby status
    if (this.lobbyId) {
      await this.prisma.$executeRaw`
        UPDATE "Lobby"
        SET "status" = 'ABANDONED'
        WHERE id = ${this.lobbyId}
      `;
    }
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
} 