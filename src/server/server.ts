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
type LobbyStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

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
  playerNames: string[];
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
    // Get active games and their lobbies
    const games = await prisma.game.findMany({
      where: {
        status: 'IN_PROGRESS',
        lobby: {
          status: {
            not: 'ABANDONED'
          }
        }
      },
      include: {
        lobby: {
          include: {
            host: true,
            players: {
              include: {
                user: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    // Convert to GameListItems, only counting connected players
    return games.map((game: any) => {
      const connectedPlayers = game.lobby.players.filter((p: any) => 
        p.metadata?.isConnected === true
      );
      
      return {
        id: game.id,
        title: game.lobby.title,
        players: connectedPlayers.length,
        host: game.lobby.host.displayName,
        status: game.status as GameStatus,
        gameType: game.gameType,
        playerNames: connectedPlayers.map((p: any) => p.user.displayName)
      };
    });
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
  
  // Utility function to broadcast updated lobby state to all players in a lobby
  async function broadcastLobbyState(lobbyId: string) {
    try {
      const lobby = await prisma.lobby.findUnique({
        where: { id: lobbyId },
        include: {
          host: true,
          players: {
            include: {
              user: true
            }
          }
        }
      });
      
      if (!lobby) return;
      
      const lobbyState = {
        id: lobby.id,
        title: lobby.title,
        host: lobby.host.displayName,
        hostId: lobby.hostId, // Include the host ID for accurate comparison
        players: lobby.players.map((p: any) => ({
          id: p.id,
          name: p.user.displayName,
          isHost: p.userId === lobby.hostId, // Compare user ID with host ID
          isConnected: p.metadata?.isConnected !== false // Default to true if not explicitly false
        }))
      };
      
      // Emit to all sockets in the lobby room including sender
      io.to(`lobby:${lobbyId}`).emit('lobbyState', lobbyState);
      
      // Also update the game list for everyone
      io.emit('gameListUpdated');
    } catch (error) {
      console.error('Error broadcasting lobby state:', error);
    }
  }
  
  // Create a new game
  socket.on('createGame', async (playerName, gameTitle, gameType = 'WORD_MATCH', callback) => {
    try {
      console.log(`Creating game with title: ${gameTitle || 'New Game'}, type: ${gameType}`);
      
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
          status: 'WAITING',
          hostId: user.id // Set the host ID to this user
        }
      });
      
      // Create a game immediately
      const game = await prisma.game.create({
        data: {
          lobbyId: lobby.id,
          gameType: gameType as any,
          status: 'IN_PROGRESS',
          config: { 
            maxPlayers: 2,
            title: gameTitle || 'New Game'
          },
          metadata: {
            status: 'WAITING',
            playerCount: 1
          }
        }
      });
      
      // Create a player record
      const player = await prisma.player.create({
        data: {
          userId: user.id,
          lobbyId: lobby.id,
          gameId: game.id,
          isReady: true,
          metadata: {
            isConnected: true,
            socketId: socket.id,
            lastActiveAt: new Date().toISOString()
          }
        }
      });
      
      // Initialize the game instance
      const gameInstance = await GameFactory.createGame(game.id, gameType, {
        maxPlayers: 2,
        title: gameTitle || 'New Game'
      });
      
      // Add the player to the game
      await gameInstance.addPlayer(player.id, user.displayName, true);
      
      // Register socket events
      gameInstance.registerSocketEvents(socket, player.id);
      
      // Store player info in socket session
      currentPlayer = {
        id: player.id,
        name: user.displayName,
        socketId: socket.id,
        secretWord: '',
        isHost: true, // This player is definitely the host
        dbId: player.id
      };
      
      // Join both lobby and game rooms
      socket.join(`lobby:${lobby.id}`);
      socket.join(`game:${game.id}`);
      
      // Broadcast the lobby state
      await broadcastLobbyState(lobby.id);
      
      // Emit initial game state
      const gameState = await gameInstance.getPublicGameState();
      socket.emit('gameState', gameState);
      
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
      console.log(`Attempting to join game ${gameId} as ${playerName}`);
      
      // Try to find as game first, then as lobby if not found
      let game = await prisma.game.findUnique({
        where: { id: gameId },
        include: {
          lobby: {
            include: {
              host: true,
              players: {
                include: {
                  user: true
                }
              }
            }
          }
        }
      });
      
      let lobby;
      if (!game) {
        // Try to find as lobby ID
        lobby = await prisma.lobby.findUnique({
          where: { id: gameId },
          include: {
            host: true,
            players: {
              include: {
                user: true
              }
            }
          }
        });
        
        if (!lobby) {
          callback({ success: false, error: 'Game not found' });
          return;
        }
      } else {
        lobby = game.lobby;
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
      
      // Check if player already exists in this lobby
      let player = await prisma.player.findFirst({
        where: {
          userId: user.id,
          lobbyId: lobby.id
        }
      });
      
      const isExistingPlayer = !!player;
      
      // If player doesn't exist, create a new player record
      if (!player) {
        player = await prisma.player.create({
          data: {
            userId: user.id,
            lobbyId: lobby.id,
            gameId: game?.id, // Link to game if it exists
            isReady: false,
            metadata: {
              isConnected: true,
              socketId: socket.id,
              lastActiveAt: new Date().toISOString()
            }
          }
        });
      } else {
        // Update existing player's connection status
        await prisma.player.update({
          where: { id: player.id },
          data: {
            lastActiveAt: new Date(),
            metadata: {
              ...player.metadata,
              isConnected: true,
              socketId: socket.id,
              reconnectedAt: new Date().toISOString()
            }
          }
        });
      }
      
      // Store player info in socket session - note the correct isHost determination
      currentPlayer = {
        id: player.id,
        name: user.displayName,
        socketId: socket.id,
        secretWord: '',
        isHost: user.id === lobby.hostId, // Determine host status by comparing user ID with lobby hostId
        dbId: player.id
      };
      
      // Join the lobby room
      socket.join(`lobby:${lobby.id}`);
      
      // Get or create game instance if we have a game
      let gameInstance;
      if (game) {
        // Update player-game association if needed
        if (!player.gameId) {
          await prisma.player.update({
            where: { id: player.id },
            data: { gameId: game.id }
          });
        }
        
        // Join the game room
        socket.join(`game:${game.id}`);
        
        // Get or create the game instance
        gameInstance = GameFactory.getGame(game.id);
        if (!gameInstance) {
          gameInstance = await GameFactory.createGame(game.id, game.gameType, {
            maxPlayers: 2,
            title: lobby.title
          });
        }
        
        // Register socket events and add player if new
        gameInstance.registerSocketEvents(socket, player.id);
        if (!isExistingPlayer) {
          await gameInstance.addPlayer(player.id, user.displayName, false);
        }
        
        // Emit game state to the joining player
        const gameState = await gameInstance.getPublicGameState();
        socket.emit('gameState', gameState);
      }
      
      // Broadcast updated lobby state to all players
      await broadcastLobbyState(lobby.id);
      
      // If player is reconnecting, notify others
      if (isExistingPlayer) {
        socket.to(`lobby:${lobby.id}`).emit('playerReconnected', {
          playerId: player.id,
          playerName: user.displayName
        });
        
        if (game) {
          socket.to(`game:${game.id}`).emit('playerReconnected', {
            playerId: player.id,
            playerName: user.displayName
          });
        }
      }
      
      // Return success to the client
      callback({ success: true });
      
    } catch (error) {
      console.error('Error joining game:', error);
      callback({ success: false, error: 'Failed to join game' });
    }
  });
  
  // Handle reconnection
  socket.on('reconnect', async (gameId, playerId, callback) => {
    try {
      console.log(`Player ${playerId} attempting to reconnect to game ${gameId}`);
      
      // Find the player in the database
      const player = await prisma.player.findUnique({
        where: { id: playerId },
        include: {
          user: true,
          game: true,
          lobby: {
            include: {
              host: true
            }
          }
        }
      });
      
      if (!player) {
        callback({ success: false, error: 'Player not found' });
        return;
      }
      
      // Update the player's connection status
      await prisma.player.update({
        where: { id: playerId },
        data: { 
          lastActiveAt: new Date(),
          metadata: {
            ...player.metadata,
            isConnected: true,
            socketId: socket.id,
            reconnectedAt: new Date().toISOString()
          }
        }
      });
      
      // Store player info in socket session with correct host determination
      currentPlayer = {
        id: player.id,
        name: player.user.displayName,
        socketId: socket.id,
        secretWord: player.metadata?.secretWord || '',
        isHost: player.lobby && player.user.id === player.lobby.hostId,
        dbId: player.id
      };
      
      // Join the appropriate rooms
      if (player.lobby) {
        socket.join(`lobby:${player.lobby.id}`);
        await broadcastLobbyState(player.lobby.id);
      }
      
      if (player.game) {
        socket.join(`game:${player.game.id}`);
        
        // Get or create game instance
        let gameInstance = GameFactory.getGame(player.game.id);
        if (!gameInstance) {
          gameInstance = await GameFactory.createGame(player.game.id, player.game.gameType, {
            maxPlayers: 2,
            title: player.lobby?.title || 'Game'
          });
        }
        
        // Register socket events
        gameInstance.registerSocketEvents(socket, player.id);
        
        // Emit game state to the reconnected player
        const gameState = await gameInstance.getPublicGameState();
        socket.emit('gameState', gameState);
      }
      
      callback({ success: true });
    } catch (error) {
      console.error('Error handling reconnection:', error);
      callback({ success: false, error: 'Failed to reconnect' });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`Disconnected: ${socket.id}`);
    
    try {
      if (!currentPlayer || !currentPlayer.dbId) return;
      
      // Get the player with lobby and game info
      const player = await prisma.player.findUnique({
        where: { id: currentPlayer.dbId },
        include: {
          game: true,
          lobby: true
        }
      });
      
      if (!player) return;
      
      // Update player connection status
      await prisma.player.update({
        where: { id: currentPlayer.dbId },
        data: { 
          lastActiveAt: new Date(),
          metadata: {
            ...player.metadata,
            isConnected: false,
            disconnectedAt: new Date().toISOString()
          }
        }
      });
      
      // Leave all rooms
      if (player.lobby) {
        socket.leave(`lobby:${player.lobby.id}`);
      }
      if (player.game) {
        socket.leave(`game:${player.game.id}`);
      }
      
      // Broadcast updated state to rooms
      if (player.lobby) {
        await broadcastLobbyState(player.lobby.id);
      }
      
      // Notify other players about disconnection
      if (player.game) {
        socket.to(`game:${player.game.id}`).emit('playerDisconnected', {
          playerId: currentPlayer.id,
          playerName: currentPlayer.name
        });
        
        // Update game state
        const gameInstance = GameFactory.getGame(player.game.id);
        if (gameInstance) {
          const gameState = await gameInstance.getPublicGameState();
          socket.to(`game:${player.game.id}`).emit('gameState', gameState);
        }
      }
      
      // Clear current player
      currentPlayer = null;
      
      // Force update game list for all clients
      io.emit('gameListUpdated');
    } catch (error) {
      console.error('Error handling disconnection:', error);
    }
  });
  
  // Get list of available games
  socket.on('getGameList', async () => {
    try {
      // Get all active games with full player details
      const games = await getAvailableGames();
      socket.emit('gameList', games);
    } catch (error) {
      console.error('Error getting game list:', error);
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
      
      // Get the player's current game and lobby
      const player = await prisma.player.findUnique({
        where: { id: currentPlayer.dbId },
        include: {
          game: true,
          lobby: true
        }
      });
      
      if (!player) {
        callback({ success: false, error: 'Player not found' });
        return;
      }
      
      // Remove player from game instance if it exists
      if (player.game) {
        const gameInstance = GameFactory.getGame(player.game.id);
        if (gameInstance) {
          await gameInstance.removePlayer(player.id);
        }
        socket.leave(`game:${player.game.id}`);
      }
      
      // Leave lobby room
      if (player.lobby) {
        socket.leave(`lobby:${player.lobby.id}`);
      }
      
      // Delete the player record
      await prisma.player.delete({
        where: { id: currentPlayer.dbId }
      });
      
      // Clear current player
      currentPlayer = null;
      
      // Broadcast updated states
      if (player.lobby) {
        await broadcastLobbyState(player.lobby.id);
      }
      
      // Force update game list for all clients
      io.emit('gameListUpdated');
      
      callback({ success: true });
    } catch (error) {
      console.error('Error leaving game:', error);
      callback({ success: false, error: 'Failed to leave game' });
    }
  });
});

// Add a new event handler for forced game list updates
io.on('gameListUpdated', async () => {
  try {
    // Get updated game list
    const games = await getAvailableGames();
    // Broadcast to all connected clients
    io.emit('gameList', games);
  } catch (error) {
    console.error('Error updating game list:', error);
  }
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