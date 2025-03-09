import { Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { 
  GameConfig, 
  PlayerMetadata, 
  GameMetadata, 
  MoveData 
} from '../types';

/**
 * Interface that all game implementations must follow
 */
export interface GameInterface {
  // Game type identifier
  readonly gameType: string;
  
  // Game initialization
  initialize(gameId: string, config: GameConfig): Promise<void>;
  
  // Player management
  addPlayer(playerId: string, playerName: string, isHost: boolean): Promise<void>;
  removePlayer(playerId: string): Promise<void>;
  
  // Game state management
  setPlayerReady(playerId: string, metadata: PlayerMetadata): Promise<void>;
  processMove(playerId: string, moveData: MoveData): Promise<{
    isGameOver: boolean;
    gameOverData?: GameMetadata;
  }>;
  
  // Socket event registration
  registerSocketEvents(socket: Socket, playerId: string): void;
  
  // Game state getters
  getGameState(): Promise<any>;
  getPublicGameState(): Promise<any>;
  
  // Game lifecycle
  startGame(): Promise<void>;
  endGame(metadata: GameMetadata): Promise<void>;
  abandonGame(): Promise<void>;
}

/**
 * Abstract base class that provides common functionality for all games
 */
export abstract class BaseGame implements GameInterface {
  protected prisma: PrismaClient;
  protected gameId: string = '';
  protected io: any;
  
  constructor(prisma: PrismaClient, io: any) {
    this.prisma = prisma;
    this.io = io;
  }
  
  abstract get gameType(): string;
  
  abstract initialize(gameId: string, config: GameConfig): Promise<void>;
  abstract addPlayer(playerId: string, playerName: string, isHost: boolean): Promise<void>;
  abstract removePlayer(playerId: string): Promise<void>;
  abstract setPlayerReady(playerId: string, metadata: PlayerMetadata): Promise<void>;
  abstract processMove(playerId: string, moveData: MoveData): Promise<{
    isGameOver: boolean;
    gameOverData?: GameMetadata;
  }>;
  abstract registerSocketEvents(socket: Socket, playerId: string): void;
  abstract getGameState(): Promise<any>;
  abstract getPublicGameState(): Promise<any>;
  abstract startGame(): Promise<void>;
  abstract endGame(metadata: GameMetadata): Promise<void>;
  abstract abandonGame(): Promise<void>;
  
  // Common utility methods can be implemented here
  protected emitToGame(event: string, data: any): void {
    this.io.to(`game:${this.gameId}`).emit(event, data);
  }
} 