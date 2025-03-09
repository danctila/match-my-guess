import { PrismaClient } from '@prisma/client';
import { GameInterface } from './GameInterface';
import { WordMatchGame } from './WordMatchGame';

// Map of game type to game class
const gameImplementations: Record<string, any> = {
  'WORD_MATCH': WordMatchGame,
  // Add more game types here as they are implemented
  // 'WORD_BOMB': WordBombGame,
  // 'CROSSWORD': CrosswordGame,
};

/**
 * Factory class for creating and managing game instances
 */
export class GameFactory {
  private static games: Map<string, GameInterface> = new Map();
  private static prisma: PrismaClient;
  private static io: any;
  
  /**
   * Initialize the GameFactory with dependencies
   */
  static initialize(prisma: PrismaClient, io: any): void {
    GameFactory.prisma = prisma;
    GameFactory.io = io;
  }
  
  /**
   * Create a new game instance of the specified type
   */
  static async createGame(gameId: string, gameType: string, config: any): Promise<GameInterface> {
    // Check if game already exists
    if (GameFactory.games.has(gameId)) {
      return GameFactory.games.get(gameId)!;
    }
    
    // Get the game implementation class
    const GameClass = gameImplementations[gameType];
    if (!GameClass) {
      throw new Error(`Game type '${gameType}' is not supported`);
    }
    
    // Create a new game instance
    const game = new GameClass(GameFactory.prisma, GameFactory.io);
    await game.initialize(gameId, config);
    
    // Store the game instance
    GameFactory.games.set(gameId, game);
    
    return game;
  }
  
  /**
   * Get an existing game instance
   */
  static getGame(gameId: string): GameInterface | undefined {
    return GameFactory.games.get(gameId);
  }
  
  /**
   * Remove a game instance
   */
  static removeGame(gameId: string): void {
    GameFactory.games.delete(gameId);
  }
  
  /**
   * Get all active games
   */
  static getAllGames(): GameInterface[] {
    return Array.from(GameFactory.games.values());
  }
  
  /**
   * Get all supported game types
   */
  static getSupportedGameTypes(): string[] {
    return Object.keys(gameImplementations);
  }
} 