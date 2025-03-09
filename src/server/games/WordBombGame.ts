// import { Socket } from 'socket.io';
// import { PrismaClient } from '@prisma/client';
// import { BaseGame } from './GameInterface';
// import { 
//   GameConfig, 
//   PlayerMetadata, 
//   GameMetadata, 
//   MoveData,
//   isPlayerMetadata,
//   isMoveData
// } from '../types';

// /**
//  * Word Bomb Game Implementation
//  * 
//  * Game Rules:
//  * 1. Players take turns submitting words
//  * 2. Each word must start with the last letter of the previous word
//  * 3. Words cannot be repeated
//  * 4. Players have a time limit to submit a word
//  * 5. If a player fails to submit a valid word in time, they lose
//  */
// export class WordBombGame extends BaseGame {
//   private players: Map<string, {
//     id: string;
//     name: string;
//     socketId?: string;
//     isHost: boolean;
//     dbId?: string;
//     score: number;
//   }> = new Map();
  
//   private words: Array<{
//     id: string;
//     playerId: string;
//     playerName: string;
//     word: string;
//     timestamp: Date;
//     dbId?: string;
//   }> = [];
  
//   private title: string = 'Word Bomb';
//   private status: string = 'IN_PROGRESS';
//   private currentPlayerId: string | null = null;
//   private turnTimeLimit: number = 15000; // 15 seconds
//   private turnTimer: NodeJS.Timeout | null = null;
//   private usedWords: Set<string> = new Set();
//   private lobbyId?: string;
//   private winnerName: string | null = null;
  
//   constructor(prisma: PrismaClient, io: any) {
//     super(prisma, io);
//   }
  
//   get gameType(): string {
//     return 'WORD_BOMB';
//   }
  
//   async initialize(gameId: string, config: GameConfig): Promise<void> {
//     this.gameId = gameId;
//     this.title = config.title || 'Word Bomb';
    
//     // Set custom game options if provided
//     if (config.turnTimeLimit) {
//       this.turnTimeLimit = config.turnTimeLimit;
//     }
    
//     // Get game data from database if it exists
//     const game = await this.prisma.$queryRaw`
//       SELECT g.*, l.id as "lobbyId", l."hostId"
//       FROM "Game" g
//       JOIN "Lobby" l ON g."lobbyId" = l.id
//       WHERE g.id = ${gameId}
//     `;
    
//     if (game && Array.isArray(game) && game.length > 0) {
//       const gameData = game[0];
//       this.lobbyId = gameData.lobbyId;
//       this.status = gameData.status;
      
//       // Load players
//       const players = await this.prisma.$queryRaw`
//         SELECT p.*, u."displayName"
//         FROM "Player" p
//         JOIN "User" u ON p."userId" = u.id
//         WHERE p."gameId" = ${gameId}
//       `;
      
//       if (players && Array.isArray(players)) {
//         for (const player of players) {
//           const metadata = player.metadata as any;
          
//           this.players.set(player.id, {
//             id: player.id,
//             name: player.displayName,
//             isHost: gameData.hostId === player.userId,
//             dbId: player.id,
//             score: metadata?.score || 0
//           });
//         }
//       }
      
//       // Load moves/words
//       const moves = await this.prisma.$queryRaw`
//         SELECT m.*, p.id as "playerId", u."displayName"
//         FROM "Move" m
//         JOIN "Player" p ON m."playerId" = p.id
//         JOIN "User" u ON p."userId" = u.id
//         WHERE m."gameId" = ${gameId} AND m."moveType" = 'word'
//         ORDER BY m."createdAt" ASC
//       `;
      
//       if (moves && Array.isArray(moves)) {
//         for (const move of moves) {
//           const data = move.data as any;
//           if (data && typeof data.word === 'string') {
//             this.words.push({
//               id: move.id,
//               playerId: move.playerId,
//               playerName: move.displayName,
//               word: data.word,
//               timestamp: move.createdAt,
//               dbId: move.id
//             });
            
//             // Add to used words set
//             this.usedWords.add(data.word.toLowerCase());
//           }
//         }
//       }
      
//       // Check if game is already complete
//       const metadata = gameData.metadata as any;
//       if (metadata && metadata.winnerName) {
//         this.winnerName = metadata.winnerName;
//       }
//     }
//   }
  
//   async addPlayer(playerId: string, playerName: string, isHost: boolean): Promise<void> {
//     this.players.set(playerId, {
//       id: playerId,
//       name: playerName,
//       isHost,
//       score: 0
//     });
//   }
  
//   async removePlayer(playerId: string): Promise<void> {
//     this.players.delete(playerId);
    
//     // If current player left, move to next player
//     if (this.currentPlayerId === playerId) {
//       this.moveToNextPlayer();
//     }
    
//     // If all players left, abandon the game
//     if (this.players.size === 0) {
//       await this.abandonGame();
//     } else if (this.players.size === 1 && this.status === 'IN_PROGRESS') {
//       // If only one player left and game is in progress, they win
//       const lastPlayer = Array.from(this.players.values())[0];
//       await this.endGame({
//         winnerName: lastPlayer.name
//       });
//     }
//   }
  
//   async setPlayerReady(playerId: string, metadata: PlayerMetadata): Promise<void> {
//     const player = this.players.get(playerId);
//     if (!player) return;
    
//     // Update player in database
//     if (player.dbId) {
//       await this.prisma.$executeRaw`
//         UPDATE "Player"
//         SET "isReady" = true
//         WHERE id = ${player.dbId}
//       `;
//     }
    
//     // Check if all players are ready
//     const allPlayersReady = await this.prisma.$queryRaw`
//       SELECT COUNT(*) = COUNT(CASE WHEN "isReady" = true THEN 1 END) as "allReady"
//       FROM "Player"
//       WHERE "gameId" = ${this.gameId}
//     `;
    
//     if (allPlayersReady && Array.isArray(allPlayersReady) && allPlayersReady.length > 0 && allPlayersReady[0].allReady) {
//       await this.startGame();
//     }
//   }
  
//   async processMove(playerId: string, moveData: MoveData): Promise<{
//     isGameOver: boolean;
//     gameOverData?: GameMetadata;
//   }> {
//     if (!isMoveData(moveData)) {
//       return { isGameOver: false };
//     }
    
//     const player = this.players.get(playerId);
//     if (!player) {
//       return { isGameOver: false };
//     }
    
//     // Check if it's this player's turn
//     if (this.currentPlayerId !== playerId) {
//       return { isGameOver: false };
//     }
    
//     const { word } = moveData;
//     const normalizedWord = word.trim().toLowerCase();
    
//     // Validate the word
//     const isValid = await this.validateWord(normalizedWord);
//     if (!isValid) {
//       // Invalid word - player loses
//       await this.endGame({
//         winnerName: this.getOtherPlayerName(playerId)
//       });
      
//       return {
//         isGameOver: true,
//         gameOverData: {
//           winnerName: this.getOtherPlayerName(playerId)
//         }
//       };
//     }
    
//     // Create a new word entry
//     const wordEntry = {
//       id: `word_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
//       playerId,
//       playerName: player.name,
//       word: normalizedWord,
//       timestamp: new Date(),
//       dbId: undefined as string | undefined
//     };
    
//     this.words.push(wordEntry);
//     this.usedWords.add(normalizedWord);
    
//     // Save move to database
//     if (player.dbId) {
//       const result = await this.prisma.$executeRaw`
//         INSERT INTO "Move" ("id", "createdAt", "moveType", "data", "gameId", "playerId")
//         VALUES (gen_random_uuid(), NOW(), 'word', ${JSON.stringify({ word: normalizedWord })}::jsonb, ${this.gameId}, ${player.dbId})
//         RETURNING id
//       `;
      
//       // This is a simplification - in a real implementation, you'd get the ID back
//       wordEntry.dbId = `move_${Date.now()}`;
//     }
    
//     // Increment player's score
//     player.score += normalizedWord.length;
    
//     // Update player score in database
//     if (player.dbId) {
//       await this.prisma.$executeRaw`
//         UPDATE "Player"
//         SET "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{score}', ${player.score}::text::jsonb)
//         WHERE id = ${player.dbId}
//       `;
//     }
    
//     // Emit the new word to all players
//     this.emitToGame('newWord', {
//       playerId: wordEntry.playerId,
//       playerName: wordEntry.playerName,
//       word: wordEntry.word,
//       timestamp: wordEntry.timestamp,
//       score: player.score
//     });
    
//     // Move to the next player
//     this.moveToNextPlayer();
    
//     return { isGameOver: false };
//   }
  
//   registerSocketEvents(socket: Socket, playerId: string): void {
//     const player = this.players.get(playerId);
//     if (player) {
//       player.socketId = socket.id;
//     }
    
//     // Join the game room
//     socket.join(`game:${this.gameId}`);
    
//     // Send current game state to the player
//     this.getPublicGameState().then(gameState => {
//       socket.emit('gameState', gameState);
//     });
//   }
  
//   async getGameState(): Promise<any> {
//     return {
//       id: this.gameId,
//       title: this.title,
//       status: this.status,
//       players: Array.from(this.players.values()).map(p => ({
//         id: p.id,
//         name: p.name,
//         isHost: p.isHost,
//         score: p.score
//       })),
//       words: this.words.map(w => ({
//         playerId: w.playerId,
//         playerName: w.playerName,
//         word: w.word,
//         timestamp: w.timestamp
//       })),
//       currentPlayerId: this.currentPlayerId,
//       turnTimeLimit: this.turnTimeLimit,
//       winnerName: this.winnerName
//     };
//   }
  
//   async getPublicGameState(): Promise<any> {
//     return this.getGameState();
//   }
  
//   async startGame(): Promise<void> {
//     this.status = 'IN_PROGRESS';
    
//     // Update lobby status in database
//     if (this.lobbyId) {
//       await this.prisma.$executeRaw`
//         UPDATE "Lobby"
//         SET "status" = 'IN_GAME'
//         WHERE id = ${this.lobbyId}
//       `;
//     }
    
//     // Choose a random player to start
//     const playerIds = Array.from(this.players.keys());
//     this.currentPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
    
//     // Start the turn timer
//     this.startTurnTimer();
    
//     // Emit updated game state
//     const gameState = await this.getPublicGameState();
//     this.emitToGame('gameState', gameState);
    
//     // Notify players whose turn it is
//     this.emitToGame('turnChange', {
//       playerId: this.currentPlayerId,
//       playerName: this.players.get(this.currentPlayerId)?.name,
//       timeLimit: this.turnTimeLimit
//     });
//   }
  
//   async endGame(metadata: GameMetadata): Promise<void> {
//     this.status = 'COMPLETED';
//     if (metadata.winnerName) {
//       this.winnerName = metadata.winnerName;
//     }
    
//     // Clear any active timers
//     if (this.turnTimer) {
//       clearTimeout(this.turnTimer);
//       this.turnTimer = null;
//     }
    
//     // Update game status in database
//     await this.prisma.$executeRaw`
//       UPDATE "Game"
//       SET "status" = 'COMPLETED',
//           "endedAt" = NOW(),
//           "metadata" = jsonb_set(COALESCE("metadata", '{}'::jsonb), '{winnerName}', ${JSON.stringify(this.winnerName)}::jsonb)
//       WHERE id = ${this.gameId}
//     `;
    
//     // Update lobby status
//     if (this.lobbyId) {
//       await this.prisma.$executeRaw`
//         UPDATE "Lobby"
//         SET "status" = 'FINISHED'
//         WHERE id = ${this.lobbyId}
//       `;
//     }
    
//     // Emit game over event
//     this.emitToGame('gameOver', {
//       winnerName: this.winnerName
//     });
//   }
  
//   async abandonGame(): Promise<void> {
//     this.status = 'ABANDONED';
    
//     // Clear any active timers
//     if (this.turnTimer) {
//       clearTimeout(this.turnTimer);
//       this.turnTimer = null;
//     }
    
//     // Update game status in database
//     await this.prisma.$executeRaw`
//       UPDATE "Game"
//       SET "status" = 'ABANDONED',
//           "endedAt" = NOW()
//       WHERE id = ${this.gameId}
//     `;
    
//     // Update lobby status
//     if (this.lobbyId) {
//       await this.prisma.$executeRaw`
//         UPDATE "Lobby"
//         SET "status" = 'ABANDONED'
//         WHERE id = ${this.lobbyId}
//       `;
//     }
//   }
  
//   private startTurnTimer(): void {
//     // Clear any existing timer
//     if (this.turnTimer) {
//       clearTimeout(this.turnTimer);
//     }
    
//     // Start a new timer
//     this.turnTimer = setTimeout(async () => {
//       // Time's up - current player loses
//       if (this.currentPlayerId) {
//         const losingPlayerId = this.currentPlayerId;
//         const winnerName = this.getOtherPlayerName(losingPlayerId);
        
//         await this.endGame({
//           winnerName
//         });
//       }
//     }, this.turnTimeLimit);
//   }
  
//   private moveToNextPlayer(): void {
//     // Get all player IDs
//     const playerIds = Array.from(this.players.keys());
//     if (playerIds.length === 0) return;
    
//     // Find the current player's index
//     const currentIndex = this.currentPlayerId ? playerIds.indexOf(this.currentPlayerId) : -1;
    
//     // Move to the next player
//     const nextIndex = (currentIndex + 1) % playerIds.length;
//     this.currentPlayerId = playerIds[nextIndex];
    
//     // Reset the turn timer
//     this.startTurnTimer();
    
//     // Notify players whose turn it is
//     this.emitToGame('turnChange', {
//       playerId: this.currentPlayerId,
//       playerName: this.players.get(this.currentPlayerId)?.name,
//       timeLimit: this.turnTimeLimit
//     });
//   }
  
//   private getOtherPlayerName(playerId: string): string {
//     // Find a player that isn't the specified player
//     for (const [id, player] of this.players.entries()) {
//       if (id !== playerId) {
//         return player.name;
//       }
//     }
//     return 'Unknown';
//   }
  
//   private async validateWord(word: string): Promise<boolean> {
//     // Check if the word has already been used
//     if (this.usedWords.has(word)) {
//       return false;
//     }
    
//     // Check if the word starts with the last letter of the previous word
//     if (this.words.length > 0) {
//       const previousWord = this.words[this.words.length - 1].word;
//       const lastLetter = previousWord.charAt(previousWord.length - 1);
      
//       if (word.charAt(0) !== lastLetter) {
//         return false;
//       }
//     }
    
//     // In a real implementation, you might check against a dictionary API
//     // For this example, we'll just check if the word is at least 2 characters
//     return word.length >= 2;
//   }
// } 