import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { PrismaClient, Prisma } from '@prisma/client';

// Initialize Prisma client with proper type
const prisma = new PrismaClient() as PrismaClient & {
  user: any;
  lobby: any;
  game: any;
  player: any;
  move: any;
};

// Simple types
type GameStatus = 'WAITING' | 'SETTING_WORDS' | 'PLAYING' | 'COMPLETED';

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

// Get available games for lobby
function getAvailableGames(): GameListItem[] {
  const availableGames: GameListItem[] = [];
  
  Array.from(games.entries()).forEach(([gameId, game]) => {
    // Only show games in WAITING status and with less than 2 players
    if (game.status === 'WAITING' && game.players.length < 2) {
      availableGames.push({
        id: gameId,
        title: game.title,
        players: game.players.length,
        host: game.players[0]?.name || 'Unknown',
        status: game.status
      });
    }
  });
  
  console.log(`Available games: ${availableGames.length}`);
  return availableGames;
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
  console.log(`Player connected: ${socket.id}`);
  
  // Send the list of available games to the newly connected client
  socket.emit('gameList', getAvailableGames());
  
  // Create a new game
  socket.on('createGame', async (playerName, gameTitle, callback) => {
    try {
      const gameId = uuidv4();
      
      // Create a temporary user or get existing one
      const user = await prisma.$transaction(async (tx: any) => {
        return tx.user.upsert({
          where: { username: playerName.toLowerCase() },
          update: { displayName: playerName },
          create: {
            username: playerName.toLowerCase(),
            displayName: playerName
          }
        });
      });
      
      // Create a lobby in the database
      const lobby = await prisma.$transaction(async (tx: any) => {
        return tx.lobby.create({
          data: {
            id: gameId, // Use the same ID for both in-memory and DB
            title: gameTitle || `${playerName}'s Game`,
            gameType: 'WORD_MATCH',
            status: 'WAITING',
            hostId: user.id,
            maxPlayers: 2
          }
        });
      });
      
      // Create a player in the database
      const dbPlayer = await prisma.$transaction(async (tx: any) => {
        return tx.player.create({
          data: {
            user: { connect: { id: user.id } },
            lobby: { connect: { id: lobby.id } },
            metadata: {},
            isReady: false
          } as any
        });
      });
      
      const player: Player = {
        id: uuidv4(),
        name: playerName,
        socketId: socket.id,
        secretWord: '',
        isHost: true,
        dbId: dbPlayer.id
      };
      
      const game: Game = {
        id: gameId,
        title: gameTitle || `${playerName}'s Game`,
        status: 'WAITING',
        players: [player],
        guesses: [],
        winningWord: null,
        createdAt: new Date(),
        lobbyId: lobby.id
      };
      
      // Store game and player mapping
      games.set(gameId, game);
      playerToGame.set(socket.id, gameId);
      
      // Join the Socket.IO room
      socket.join(gameId);
      console.log(`Game created: ${gameId} by ${playerName}`);
      
      // Send game state to the player
      socket.emit('gameState', game);
      
      // Send updated game list to everyone
      io.emit('gameList', getAvailableGames());
      
      callback(gameId);
    } catch (error) {
      console.error('Error creating game:', error);
      callback(null);
    }
  });
  
  // Join an existing game
  socket.on('joinGame', async (gameId, playerName, callback) => {
    try {
      console.log(`Join request: ${playerName} (${socket.id}) trying to join game ${gameId}`);
      
      // Check if player is already in this game
      const currentGameId = playerToGame.get(socket.id);
      if (currentGameId === gameId) {
        console.log(`Player ${playerName} (${socket.id}) is already in game ${gameId}`);
        // Player is already in this game, send the current game state
        const game = games.get(gameId);
        if (game) {
          socket.emit('gameState', game);
          callback(true);
          return;
        }
      }
      
      const game = games.get(gameId);
      
      // Game not found
      if (!game) {
        console.log(`Game ${gameId} not found`);
        socket.emit('gameNotFound');
        callback(false);
        return;
      }
      
      // Game is full or not in waiting state
      if (game.players.length >= 2 || game.status !== 'WAITING') {
        console.log(`Game ${gameId} is full or not in waiting state. Players: ${game.players.length}, Status: ${game.status}`);
        socket.emit('gameFull');
        callback(false);
        return;
      }
      
      // Create a temporary user or get existing one
      const user = await prisma.$transaction(async (tx: any) => {
        return tx.user.upsert({
          where: { username: playerName.toLowerCase() },
          update: { displayName: playerName },
          create: {
            username: playerName.toLowerCase(),
            displayName: playerName
          }
        });
      });
      
      // Create a player in the database
      const dbPlayer = await prisma.$transaction(async (tx: any) => {
        return tx.player.create({
          data: {
            user: { connect: { id: user.id } },
            lobby: { connect: { id: game.lobbyId! } },
            metadata: {},
            isReady: false
          } as any
        });
      });
      
      // Create player and add to game
      const player: Player = {
        id: uuidv4(),
        name: playerName,
        socketId: socket.id,
        secretWord: '',
        isHost: false,
        dbId: dbPlayer.id
      };
      
      game.players.push(player);
      playerToGame.set(socket.id, gameId);
      
      // Join the Socket.IO room
      socket.join(gameId);
      console.log(`${playerName} (${socket.id}) joined game ${gameId}. Total players: ${game.players.length}`);
      
      // If we now have 2 players, update game status
      if (game.players.length === 2) {
        game.status = 'SETTING_WORDS';
        console.log(`Game ${gameId} now has 2 players, updating status to SETTING_WORDS`);
        
        // Update lobby status in database
        await prisma.$transaction(async (tx: any) => {
          await tx.lobby.update({
            where: { id: game.lobbyId },
            data: { status: 'READY' }
          });
        });
      }
      
      // Send game state to everyone in the room
      io.to(gameId).emit('gameState', game);
      
      // Send updated game list to everyone
      io.emit('gameList', getAvailableGames());
      
      callback(true);
    } catch (error) {
      console.error('Error joining game:', error);
      callback(false);
    }
  });
  
  // Set secret word
  socket.on('setSecretWord', async (word, callback) => {
    try {
      const gameId = playerToGame.get(socket.id);
      if (!gameId) {
        console.log(`No game found for player ${socket.id}`);
        callback(false);
        return;
      }
      
      const game = games.get(gameId);
      if (!game) {
        console.log(`Game ${gameId} not found`);
        callback(false);
        return;
      }
      
      // Find player and set word
      const player = game.players.find(p => p.socketId === socket.id);
      if (!player) {
        console.log(`Player not found in game ${gameId}`);
        callback(false);
        return;
      }
      
      console.log(`Player ${player.name} (${socket.id}) setting secret word in game ${gameId}`);
      player.secretWord = word.toLowerCase().trim();
      
      // Update player metadata in database
      if (player.dbId) {
        await prisma.$transaction(async (tx: any) => {
          await tx.player.update({
            where: { id: player.dbId },
            data: {
              metadata: { secretWord: player.secretWord },
              isReady: true
            } as any
          });
        });
      }
      
      // Check if all players have set their words
      const allPlayersReady = game.players.every(p => p.secretWord);
      if (allPlayersReady && game.status === 'SETTING_WORDS') {
        game.status = 'PLAYING';
        console.log(`Game ${gameId} - All players have set words, moving to PLAYING state`);
        
        // Create a game in the database
        const dbGame = await prisma.$transaction(async (tx: any) => {
          const newGame = await tx.game.create({
            data: {
              lobby: { connect: { id: game.lobbyId! } },
              gameType: 'WORD_MATCH',
              status: 'IN_PROGRESS',
              config: { maxPlayers: 2 },
              metadata: { winningWord: null }
            } as any
          });
          
          // Update lobby status
          await tx.lobby.update({
            where: { id: game.lobbyId },
            data: { status: 'IN_GAME' }
          });
          
          // Update players to link them to the game
          for (const p of game.players) {
            if (p.dbId) {
              await tx.player.update({
                where: { id: p.dbId },
                data: { game: { connect: { id: newGame.id } } } as any
              });
            }
          }
          
          return newGame;
        });
        
        // Update game reference
        game.gameId = dbGame.id;
      }
      
      // Send updated game state to all players
      io.to(gameId).emit('gameState', game);
      
      callback(true);
    } catch (error) {
      console.error('Error setting secret word:', error);
      callback(false);
    }
  });
  
  // Make a guess
  socket.on('makeGuess', async (word, callback) => {
    try {
      const gameId = playerToGame.get(socket.id);
      if (!gameId) {
        callback(false);
        return;
      }
      
      const game = games.get(gameId);
      if (!game || game.status !== 'PLAYING') {
        callback(false);
        return;
      }
      
      const player = game.players.find(p => p.socketId === socket.id);
      if (!player) {
        callback(false);
        return;
      }
      
      // Add guess
      const guess: Guess = {
        playerId: player.id,
        playerName: player.name,
        word: word.toLowerCase().trim(),
        timestamp: new Date()
      };
      
      console.log(`Player ${player.name} guessed: ${guess.word} in game ${gameId}`);
      game.guesses.push(guess);
      
      // Record move in database if game exists
      if (game.gameId && player.dbId) {
        const dbMove = await prisma.$transaction(async (tx: any) => {
          return tx.move.create({
            data: {
              game: { connect: { id: game.gameId! } },
              player: { connect: { id: player.dbId! } },
              moveType: 'guess',
              data: { word: guess.word }
            } as any
          });
        });
        
        // Store the database ID
        guess.dbId = dbMove.id;
      }
      
      // Check for matching guesses
      const matchingWord = checkForMatchingGuess(game);
      if (matchingWord) {
        game.status = 'COMPLETED';
        game.winningWord = matchingWord;
        console.log(`Game ${gameId} - GAME OVER! Winning word: ${matchingWord}`);
        
        // Update game in database
        if (game.gameId) {
          await prisma.$transaction(async (tx: any) => {
            await tx.game.update({
              where: { id: game.gameId },
              data: {
                status: 'COMPLETED',
                endedAt: new Date(),
                metadata: { winningWord: matchingWord }
              } as any
            });
            
            // Update lobby status
            await tx.lobby.update({
              where: { id: game.lobbyId },
              data: { status: 'FINISHED' }
            });
          });
        }
        
        // Notify all players
        io.to(gameId).emit('gameOver', matchingWord);
      }
      
      // Send updated game state to all players
      io.to(gameId).emit('gameState', game);
      
      callback(true);
    } catch (error) {
      console.error('Error making guess:', error);
      callback(false);
    }
  });
  
  // Leave game
  socket.on('leaveGame', async (callback) => {
    try {
      const gameId = playerToGame.get(socket.id);
      
      if (gameId) {
        socket.leave(gameId);
        console.log(`Player ${socket.id} leaving game ${gameId}`);
        
        const game = games.get(gameId);
        if (game) {
          // Remove player from game
          const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
          
          if (playerIndex !== -1) {
            const player = game.players[playerIndex];
            console.log(`Removing player ${player.name} from game ${gameId}`);
            
            // Update player's last active time in database
            if (player.dbId) {
              await prisma.$transaction(async (tx: any) => {
                await tx.player.update({
                  where: { id: player.dbId },
                  data: { lastActiveAt: new Date() } as any
                });
              });
            }
            
            game.players.splice(playerIndex, 1);
            
            // If no players left, remove the game
            if (game.players.length === 0) {
              console.log(`No players left in game ${gameId}, removing game`);
              games.delete(gameId);
              
              // Update lobby status in database
              if (game.lobbyId) {
                await prisma.$transaction(async (tx: any) => {
                  await tx.lobby.update({
                    where: { id: game.lobbyId },
                    data: { status: 'ABANDONED' }
                  });
                });
              }
            } else {
              // Otherwise, update game state
              if (game.status !== 'COMPLETED') {
                game.status = 'WAITING';
                
                // Update lobby status in database
                if (game.lobbyId) {
                  await prisma.$transaction(async (tx: any) => {
                    await tx.lobby.update({
                      where: { id: game.lobbyId },
                      data: { status: 'WAITING' }
                    });
                  });
                }
              }
              
              // Make the first remaining player the host
              if (game.players.length > 0) {
                game.players[0].isHost = true;
              }
              
              // Send updated game state to remaining players
              io.to(gameId).emit('gameState', game);
            }
          }
        }
        
        playerToGame.delete(socket.id);
        
        // Send updated game list to everyone
        io.emit('gameList', getAvailableGames());
      }
      
      callback();
    } catch (error) {
      console.error('Error leaving game:', error);
      callback();
    }
  });
  
  // Get game list
  socket.on('getGameList', () => {
    try {
      socket.emit('gameList', getAvailableGames());
    } catch (error) {
      console.error('Error getting game list:', error);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', async () => {
    try {
      console.log(`Player disconnected: ${socket.id}`);
      
      const gameId = playerToGame.get(socket.id);
      if (gameId) {
        const game = games.get(gameId);
        if (game) {
          // Remove player from game
          const playerIndex = game.players.findIndex(p => p.socketId === socket.id);
          
          if (playerIndex !== -1) {
            const player = game.players[playerIndex];
            console.log(`Player ${player.name} disconnected from game ${gameId}`);
            
            // Update player's last active time in database
            if (player.dbId) {
              await prisma.$transaction(async (tx: any) => {
                await tx.player.update({
                  where: { id: player.dbId },
                  data: { lastActiveAt: new Date() } as any
                });
              });
            }
            
            game.players.splice(playerIndex, 1);
            
            // If no players left, remove the game
            if (game.players.length === 0) {
              console.log(`No players left in game ${gameId}, removing game`);
              games.delete(gameId);
              
              // Update lobby status in database
              if (game.lobbyId) {
                await prisma.$transaction(async (tx: any) => {
                  await tx.lobby.update({
                    where: { id: game.lobbyId },
                    data: { status: 'ABANDONED' }
                  });
                });
              }
            } else {
              // Otherwise, update game state
              if (game.status !== 'COMPLETED') {
                game.status = 'WAITING';
                
                // Update lobby status in database
                if (game.lobbyId) {
                  await prisma.$transaction(async (tx: any) => {
                    await tx.lobby.update({
                      where: { id: game.lobbyId },
                      data: { status: 'WAITING' }
                    });
                  });
                }
              }
              
              // Make the first remaining player the host
              if (game.players.length > 0) {
                game.players[0].isHost = true;
              }
              
              // Send updated game state to remaining players
              io.to(gameId).emit('gameState', game);
            }
          }
        }
        
        playerToGame.delete(socket.id);
        
        // Send updated game list to everyone
        io.emit('gameList', getAvailableGames());
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
        
        // Update lobby status in database
        if (game.lobbyId) {
          await prisma.$transaction(async (tx: any) => {
            await tx.lobby.update({
              where: { id: game.lobbyId },
              data: { status: 'ABANDONED' }
            });
          });
        }
      }
    });
    
    // Also clean up abandoned lobbies in the database
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

// Start the server
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 