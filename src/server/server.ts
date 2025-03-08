import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

// Simple types
type GameStatus = 'WAITING' | 'SETTING_WORDS' | 'PLAYING' | 'COMPLETED';

interface Player {
  id: string;
  name: string;
  socketId: string;
  secretWord: string;
  isHost: boolean;
}

interface Guess {
  playerId: string;
  playerName: string;
  word: string;
  timestamp: Date;
}

interface Game {
  id: string;
  title: string;
  status: GameStatus;
  players: Player[];
  guesses: Guess[];
  winningWord: string | null;
  createdAt: Date;
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
  }
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
  socket.on('createGame', (playerName, gameTitle, callback) => {
    try {
      const gameId = uuidv4();
      
      const player: Player = {
        id: uuidv4(),
        name: playerName,
        socketId: socket.id,
        secretWord: '',
        isHost: true
      };
      
      const game: Game = {
        id: gameId,
        title: gameTitle || `${playerName}'s Game`,
        status: 'WAITING',
        players: [player],
        guesses: [],
        winningWord: null,
        createdAt: new Date()
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
  socket.on('joinGame', (gameId, playerName, callback) => {
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
      
      // Create player and add to game
      const player: Player = {
        id: uuidv4(),
        name: playerName,
        socketId: socket.id,
        secretWord: '',
        isHost: false
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
  socket.on('setSecretWord', (word, callback) => {
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
      
      // Check if all players have set their words
      const allPlayersReady = game.players.every(p => p.secretWord);
      if (allPlayersReady && game.status === 'SETTING_WORDS') {
        game.status = 'PLAYING';
        console.log(`Game ${gameId} - All players have set words, moving to PLAYING state`);
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
  socket.on('makeGuess', (word, callback) => {
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
      
      // Check for matching guesses
      const matchingWord = checkForMatchingGuess(game);
      if (matchingWord) {
        game.status = 'COMPLETED';
        game.winningWord = matchingWord;
        console.log(`Game ${gameId} - GAME OVER! Winning word: ${matchingWord}`);
        
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
  socket.on('leaveGame', (callback) => {
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
            game.players.splice(playerIndex, 1);
            
            // If no players left, remove the game
            if (game.players.length === 0) {
              console.log(`No players left in game ${gameId}, removing game`);
              games.delete(gameId);
            } else {
              // Otherwise, update game state
              if (game.status !== 'COMPLETED') {
                game.status = 'WAITING';
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
  socket.on('disconnect', () => {
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
            game.players.splice(playerIndex, 1);
            
            // If no players left, remove the game
            if (game.players.length === 0) {
              console.log(`No players left in game ${gameId}, removing game`);
              games.delete(gameId);
            } else {
              // Otherwise, update game state
              if (game.status !== 'COMPLETED') {
                game.status = 'WAITING';
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
setInterval(() => {
  try {
    const now = new Date();
    Array.from(games.entries()).forEach(([gameId, game]) => {
      // Remove games older than 24 hours
      if (now.getTime() - new Date(game.createdAt).getTime() > 24 * 60 * 60 * 1000) {
        console.log(`Cleaning up old game: ${gameId}`);
        games.delete(gameId);
      }
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