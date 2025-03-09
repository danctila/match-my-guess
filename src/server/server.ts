import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient, Prisma } from '@prisma/client';
import { GameFactory } from './games/GameFactory';

// Initialize Prisma client with proper type
const prisma = new PrismaClient() as PrismaClient & {
  user: any;
  lobby: any;
  game: any;
  player: any;
  move: any;
};

// Database operation queue
interface DbOperation {
  type: 'move' | 'gameComplete' | 'playerUpdate' | 'lobbyUpdate';
  data: any;
  retryCount: number;
  priority: number; // Higher number = higher priority
}

const DB_OPERATION_QUEUE: DbOperation[] = [];
const BATCH_SIZE = 10;
const BATCH_INTERVAL = 2000; // 2 seconds
const MAX_RETRIES = 3;
let batchProcessorRunning = false;

// Start the batch processor
function startBatchProcessor() {
  if (batchProcessorRunning) return;
  
  batchProcessorRunning = true;
  console.log('Database batch processor started');
  
  // Process batches at regular intervals
  setInterval(async () => {
    if (DB_OPERATION_QUEUE.length === 0) return;
    
    // Sort by priority (higher first)
    DB_OPERATION_QUEUE.sort((a, b) => b.priority - a.priority);
    
    // Take a batch of operations
    const batch = DB_OPERATION_QUEUE.splice(0, Math.min(BATCH_SIZE, DB_OPERATION_QUEUE.length));
    
    try {
      await processBatch(batch);
    } catch (error) {
      console.error('Error processing batch:', error);
      
      // Put failed operations back in the queue with increased retry count
      batch.forEach(op => {
        if (op.retryCount < MAX_RETRIES) {
          op.retryCount++;
          DB_OPERATION_QUEUE.push(op);
        } else {
          console.error(`Operation failed after ${MAX_RETRIES} retries:`, op);
        }
      });
    }
  }, BATCH_INTERVAL);
}

// Process a batch of database operations
async function processBatch(operations: DbOperation[]) {
  // Group operations by type for more efficient processing
  const moveOps = operations.filter(op => op.type === 'move');
  const gameCompleteOps = operations.filter(op => op.type === 'gameComplete');
  const playerUpdateOps = operations.filter(op => op.type === 'playerUpdate');
  const lobbyUpdateOps = operations.filter(op => op.type === 'lobbyUpdate');
  
  await prisma.$transaction(async (tx: any) => {
    // Process moves (guesses)
    if (moveOps.length > 0) {
      console.log(`Processing ${moveOps.length} move operations`);
      
      for (const op of moveOps) {
        const { gameId, playerId, word, guessId } = op.data;
        
        await tx.move.create({
          data: {
            id: guessId, // Use the same ID as in-memory
            game: { connect: { id: gameId } },
            player: { connect: { id: playerId } },
            moveType: 'guess',
            data: { word }
          } as any
        });
      }
    }
    
    // Process game completions
    if (gameCompleteOps.length > 0) {
      console.log(`Processing ${gameCompleteOps.length} game completion operations`);
      
      for (const op of gameCompleteOps) {
        const { gameId, lobbyId, winningWord } = op.data;
        
        // Update game status
        await tx.game.update({
          where: { id: gameId },
          data: {
            status: 'COMPLETED',
            endedAt: new Date(),
            metadata: { winningWord }
          } as any
        });
        
        // Update lobby status
        await tx.lobby.update({
          where: { id: lobbyId },
          data: { status: 'FINISHED' }
        });
      }
    }
    
    // Process player updates
    if (playerUpdateOps.length > 0) {
      console.log(`Processing ${playerUpdateOps.length} player update operations`);
      
      for (const op of playerUpdateOps) {
        const { playerId, data } = op.data;
        
        await tx.player.update({
          where: { id: playerId },
          data: data as any
        });
      }
    }
    
    // Process lobby updates
    if (lobbyUpdateOps.length > 0) {
      console.log(`Processing ${lobbyUpdateOps.length} lobby update operations`);
      
      for (const op of lobbyUpdateOps) {
        const { lobbyId, data } = op.data;
        
        await tx.lobby.update({
          where: { id: lobbyId },
          data
        });
      }
    }
  });
  
  console.log(`Successfully processed batch of ${operations.length} operations`);
}

// Queue a database operation
function queueDbOperation(operation: DbOperation) {
  DB_OPERATION_QUEUE.push(operation);
  console.log(`Queued ${operation.type} operation, queue length: ${DB_OPERATION_QUEUE.length}`);
}

// Helper function to persist game state
async function persistGameState(
  game: Game, 
  player: Player, 
  guess: Guess, 
  gameCompleted: boolean, 
  matchingWord: string | null
) {
  // Queue the move operation
  if (game.gameId && player.dbId) {
    queueDbOperation({
      type: 'move',
      data: {
        gameId: game.gameId,
        playerId: player.dbId,
        word: guess.word,
        guessId: guess.id
      },
      retryCount: 0,
      priority: 1
    });
  }
  
  // If game is completed, queue a game completion operation
  if (gameCompleted && game.gameId && matchingWord) {
    queueDbOperation({
      type: 'gameComplete',
      data: {
        gameId: game.gameId,
        lobbyId: game.lobbyId,
        winningWord: matchingWord
      },
      retryCount: 0,
      priority: 2 // Higher priority than regular moves
    });
  }
}

// Simple types
type GameStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';
type LobbyStatus = 'WAITING' | 'READY' | 'IN_GAME' | 'FINISHED' | 'ABANDONED';

interface Player {
  id: string;
  name: string;
  socketId: string;
  secretWord: string;
  isHost: boolean;
  // New field to track database ID
  dbId?: string;
}

interface Guess {
  id: string;  // Add this field for tracking
  playerId: string;
  playerName: string;
  word: string;
  timestamp: Date;
  // New field to track database ID
  dbId?: string;
}

interface Game {
  id: string;
  title: string;
  status: GameStatus;
  players: Player[];
  guesses: Guess[];
  winningWord: string | null;
  createdAt: Date;
  // New fields to track database IDs
  lobbyId?: string;
  gameId?: string;
}

interface GameListItem {
  id: string;
  title: string;
  players: number;
  host: string;
  status: GameStatus;
  gameType: string;
}

// In-memory storage
const games = new Map<string, Game>();
const playerToGame = new Map<string, string>();

// Create server
const app = express();
app.use(cors());
const httpServer = http.createServer(app);

// Create Socket.IO server
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // Add these settings to fix xhr poll error
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Initialize the GameFactory with dependencies
GameFactory.initialize(prisma, io);

// Get available games for lobby
async function getAvailableGames(): Promise<GameListItem[]> {
  try {
    // Query the database for available games
    const games = await prisma.$queryRaw<any[]>`
      SELECT 
        g.id, 
        l.title, 
        l."gameType",
        g.status,
        u."displayName" as "hostName",
        (SELECT COUNT(*) FROM "Player" p WHERE p."gameId" = g.id) as "playerCount"
      FROM "Game" g
      JOIN "Lobby" l ON g."lobbyId" = l.id
      JOIN "User" u ON l."hostId" = u.id
      WHERE g.status = 'IN_PROGRESS'
      AND l.status IN ('WAITING', 'READY', 'IN_GAME')
      ORDER BY g."createdAt" DESC
      LIMIT 20
    `;
    
    return games.map(game => ({
      id: game.id,
      title: game.title,
      players: parseInt(game.playerCount),
      host: game.hostName,
      status: game.status,
      gameType: game.gameType
    }));
  } catch (error) {
    console.error('Error getting available games:', error);
    return [];
  }
}

// Check for matching guesses
function checkForMatchingGuess(game: Game): string | null {
  if (game.guesses.length < 2) return null;
  
  // Get the most recent guesses from each player
  const recentGuesses = new Map<string, string>();
  
  // Process guesses in chronological order
  const sortedGuesses = [...game.guesses].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  for (const guess of sortedGuesses) {
    recentGuesses.set(guess.playerId, guess.word);
  }
  
  // Check if all players guessed the same word
  const guessValues = Array.from(recentGuesses.values());
  if (guessValues.length >= 2) {
    const firstGuess = guessValues[0];
    const allMatch = guessValues.every(guess => guess === firstGuess);
    
    if (allMatch) {
      return firstGuess;
    }
  }
  
  return null;
}

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);
  
  let currentPlayer: Player | null = null;
  let currentGame: Game | null = null;
  
  // Create a new game
  socket.on('createGame', async (playerName, gameTitle, gameType = 'WORD_MATCH', callback) => {
    try {
      // Create a new user or find existing one
      const user = await prisma.user.upsert({
        where: { username: playerName.toLowerCase() },
        update: {},
        create: {
          username: playerName.toLowerCase(),
          displayName: playerName
        }
      });
      
      // Create a new lobby
      const lobby = await prisma.lobby.create({
        data: {
          title: gameTitle || 'New Game',
          gameType: gameType as any,
          host: { connect: { id: user.id } }
        }
      });
      
      // Create a new game
      const game = await prisma.game.create({
        data: {
          gameType: gameType as any,
          lobby: { connect: { id: lobby.id } },
          config: { maxPlayers: 2 },
          metadata: {}
        }
      });
      
      // Create a player record
      const player = await prisma.player.create({
        data: {
          user: { connect: { id: user.id } },
          lobby: { connect: { id: lobby.id } },
          game: { connect: { id: game.id } },
          metadata: {}
        }
      });
      
      // Initialize the game instance
      const gameInstance = await GameFactory.createGame(game.id, gameType, {
        title: gameTitle || 'New Game',
        maxPlayers: 2
      });
      
      // Add the player to the game
      await gameInstance.addPlayer(player.id, user.displayName, true);
      
      // Register socket events for this game type
      gameInstance.registerSocketEvents(socket, player.id);
      
      // Store player and game info in socket session
      currentPlayer = {
        id: player.id,
        name: user.displayName,
        socketId: socket.id,
        secretWord: '',
        isHost: true,
        dbId: player.id
      };
      
      // Join the game room
      socket.join(`game:${game.id}`);
      
      // Return the game ID to the client
      callback({ success: true, gameId: game.id });
      
    } catch (error) {
      console.error('Error creating game:', error);
      callback({ success: false, error: 'Failed to create game' });
    }
  });
  
  // Join an existing game
  socket.on('joinGame', async (gameId, playerName, callback) => {
    try {
      // Find the game
      const game = await prisma.game.findUnique({
        where: { id: gameId },
        include: {
          lobby: true
        }
      });
      
      if (!game) {
        socket.emit('gameNotFound');
        callback({ success: false, error: 'Game not found' });
        return;
      }
      
      // Check if game is joinable
      if (game.status !== 'IN_PROGRESS' && game.status !== 'WAITING') {
        callback({ success: false, error: 'Game is not joinable' });
        return;
      }
      
      // Count existing players
      const playerCount = await prisma.player.count({
        where: { gameId }
      });
      
      // Check if game is full
      const maxPlayers = (game.config as any).maxPlayers || 2;
      if (playerCount >= maxPlayers) {
        socket.emit('gameFull');
        callback({ success: false, error: 'Game is full' });
        return;
      }
      
      // Create a new user or find existing one
      const user = await prisma.user.upsert({
        where: { username: playerName.toLowerCase() },
        update: {},
        create: {
          username: playerName.toLowerCase(),
          displayName: playerName
        }
      });
      
      // Create a player record
      const player = await prisma.player.create({
        data: {
          user: { connect: { id: user.id } },
          lobby: { connect: { id: game.lobbyId } },
          game: { connect: { id: game.id } },
          metadata: {}
        }
      });
      
      // Get the game instance
      const gameInstance = await GameFactory.getGame(game.id) || 
        await GameFactory.createGame(game.id, game.gameType, game.config);
      
      // Add the player to the game
      await gameInstance.addPlayer(player.id, user.displayName, false);
      
      // Register socket events for this game type
      gameInstance.registerSocketEvents(socket, player.id);
      
      // Store player and game info in socket session
      currentPlayer = {
        id: player.id,
        name: user.displayName,
        socketId: socket.id,
        secretWord: '',
        isHost: false,
        dbId: player.id
      };
      
      // Join the game room
      socket.join(`game:${game.id}`);
      
      // Return success to the client
      callback({ success: true });
      
    } catch (error) {
      console.error('Error joining game:', error);
      callback({ success: false, error: 'Failed to join game' });
    }
  });
  
  // Set secret word (for Match My Guess game)
  socket.on('setSecretWord', async (word, callback) => {
    try {
      if (!currentPlayer || !currentPlayer.dbId) {
        callback({ success: false, error: 'Not in a game' });
        return;
      }
      
      // Get the player's current game
      const player = await prisma.player.findUnique({
        where: { id: currentPlayer.dbId },
        include: {
          game: true
        }
      });
      
      if (!player || !player.game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }
      
      // Get the game instance
      const gameInstance = GameFactory.getGame(player.game.id);
      if (!gameInstance) {
        callback({ success: false, error: 'Game instance not found' });
        return;
      }
      
      // Set the player ready with their secret word
      await gameInstance.setPlayerReady(player.id, { secretWord: word });
      
      // Update the current player's secret word
      currentPlayer.secretWord = word;
      
      callback({ success: true });
      
    } catch (error) {
      console.error('Error setting secret word:', error);
      callback({ success: false, error: 'Failed to set secret word' });
    }
  });
  
  // Make a guess/move
  socket.on('makeGuess', async (word, callback) => {
    try {
      if (!currentPlayer || !currentPlayer.dbId) {
        callback({ success: false, error: 'Not in a game' });
        return;
      }
      
      // Get the player's current game
      const player = await prisma.player.findUnique({
        where: { id: currentPlayer.dbId },
        include: {
          game: true
        }
      });
      
      if (!player || !player.game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }
      
      // Get the game instance
      const gameInstance = GameFactory.getGame(player.game.id);
      if (!gameInstance) {
        callback({ success: false, error: 'Game instance not found' });
        return;
      }
      
      // Process the move
      const result = await gameInstance.processMove(player.id, { word });
      
      callback({ success: true });
      
    } catch (error) {
      console.error('Error making guess:', error);
      callback({ success: false, error: 'Failed to make guess' });
    }
  });
  
  // Leave the current game
  socket.on('leaveGame', async (callback) => {
    try {
      if (!currentPlayer || !currentPlayer.dbId) {
        callback({ success: false, error: 'Not in a game' });
        return;
      }
      
      // Get the player's current game
      const player = await prisma.player.findUnique({
        where: { id: currentPlayer.dbId },
        include: {
          game: true
        }
      });
      
      if (!player || !player.game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }
      
      // Get the game instance
      const gameInstance = GameFactory.getGame(player.game.id);
      if (gameInstance) {
        // Remove the player from the game
        await gameInstance.removePlayer(player.id);
      }
      
      // Leave the game room
      socket.leave(`game:${player.game.id}`);
      
      // Clear the current player and game
      currentPlayer = null;
      
      callback({ success: true });
      
    } catch (error) {
      console.error('Error leaving game:', error);
      callback({ success: false, error: 'Failed to leave game' });
    }
  });
  
  // Get list of available games
  socket.on('getGameList', async () => {
    try {
      // Get all active games
      const games = await getAvailableGames();
      socket.emit('gameList', games);
    } catch (error) {
      console.error('Error getting game list:', error);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', async () => {
    try {
      console.log(`Disconnected: ${socket.id}`);
      
      if (currentPlayer && currentPlayer.dbId) {
        // Get the player's current game
        const player = await prisma.player.findUnique({
          where: { id: currentPlayer.dbId },
          include: {
            game: true
          }
        });
        
        if (player && player.game) {
          // Get the game instance
          const gameInstance = GameFactory.getGame(player.game.id);
          if (gameInstance) {
            // Remove the player from the game
            await gameInstance.removePlayer(player.id);
          }
        }
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// Clean up old games every hour
setInterval(async () => {
  try {
    const now = new Date();
    Array.from(games.entries()).forEach(async ([gameId, game]) => {
      // Remove games older than 24 hours
      if (now.getTime() - new Date(game.createdAt).getTime() > 24 * 60 * 60 * 1000) {
        console.log(`Cleaning up old game: ${gameId}`);
        games.delete(gameId);
        
        // Queue lobby update
        if (game.lobbyId) {
          queueDbOperation({
            type: 'lobbyUpdate',
            data: {
              lobbyId: game.lobbyId,
              data: { status: 'ABANDONED' }
            },
            retryCount: 0,
            priority: 0 // Low priority
          });
        }
      }
    });
    
    // Clean up abandoned lobbies in the database (do this directly, not queued)
    await prisma.$transaction(async (tx: any) => {
      await tx.lobby.updateMany({
        where: {
          updatedAt: {
            lt: new Date(now.getTime() - 24 * 60 * 60 * 1000)
          },
          status: {
            not: 'ABANDONED'
          }
        },
        data: {
          status: 'ABANDONED'
        }
      });
    });
  } catch (error) {
    console.error('Error cleaning up old games:', error);
  }
}, 60 * 60 * 1000);

// Start the batch processor
startBatchProcessor();

// Start the server
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 