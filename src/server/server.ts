import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import type { 
  ServerToClientEvents,
  ClientToServerEvents,
  GameState,
  PlayerState,
  GuessState
} from './types';
import prisma from './prisma';

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? 'https://your-production-domain.com'  // Update this with your actual domain
      : 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// In-memory game state for quick access
const activeGames = new Map<string, GameState>();

io.on('connection', (socket) => {
  let currentGameId: string | null = null;
  let currentPlayerId: string | null = null;

  socket.on('joinGame', async (gameId: string, playerName: string, callback: (success: boolean) => void) => {
    try {
      const game = await prisma.gameSession.findUnique({
        where: { id: gameId },
        include: { players: true, guesses: true }
      });

      if (!game) {
        callback(false);
        socket.emit('error', 'Game not found');
        return;
      }

      // Create new player
      const player = await prisma.player.create({
        data: {
          sessionId: gameId,
          nickname: playerName,
          secretWord: '',
          isHost: game.players.length === 0
        }
      });

      // Join socket room
      socket.join(gameId);
      currentGameId = gameId;
      currentPlayerId = player.id;

      // Update game state
      const playerState: PlayerState = {
        id: player.id,
        nickname: playerName,
        isHost: player.isHost,
        hasSetSecretWord: false
      };

      // Notify others
      socket.to(gameId).emit('playerJoined', playerState);
      callback(true);

      // Update active games map
      updateGameState(gameId);
    } catch (error) {
      console.error('Error joining game:', error);
      callback(false);
      socket.emit('error', 'Failed to join game');
    }
  });

  socket.on('setSecretWord', async (word: string, callback: (success: boolean) => void) => {
    if (!currentGameId || !currentPlayerId) {
      callback(false);
      return;
    }

    try {
      await prisma.player.update({
        where: { id: currentPlayerId },
        data: { secretWord: word }
      });

      // Check if all players have set their secret words
      const game = await prisma.gameSession.findUnique({
        where: { id: currentGameId },
        include: { players: true }
      });

      if (game && game.players.every(player => player.secretWord)) {
        await prisma.gameSession.update({
          where: { id: currentGameId },
          data: { status: 'ACTIVE' }
        });
      }

      callback(true);
      updateGameState(currentGameId);
    } catch (error) {
      console.error('Error setting secret word:', error);
      callback(false);
      socket.emit('error', 'Failed to set secret word');
    }
  });

  socket.on('makeGuess', async (word: string, callback: (success: boolean) => void) => {
    if (!currentGameId || !currentPlayerId) {
      callback(false);
      return;
    }

    try {
      // Create the guess
      const guess = await prisma.guess.create({
        data: {
          sessionId: currentGameId,
          playerId: currentPlayerId,
          word: word.toLowerCase().trim()
        },
        include: { player: true }
      });

      const guessState: GuessState = {
        id: guess.id,
        playerId: guess.playerId,
        playerNickname: guess.player.nickname,
        word: guess.word,
        timestamp: guess.createdAt
      };

      // Broadcast the guess to all players in the game
      io.to(currentGameId).emit('newGuess', guessState);

      // Check for winning condition
      const game = await prisma.gameSession.findUnique({
        where: { id: currentGameId },
        include: { players: true, guesses: { orderBy: { createdAt: 'desc' }, take: 2 } }
      });

      if (game && game.guesses.length >= 2) {
        const [latestGuess, previousGuess] = game.guesses;
        if (latestGuess.word === previousGuess.word && 
            latestGuess.playerId !== previousGuess.playerId) {
          // We have a winner!
          await prisma.gameSession.update({
            where: { id: currentGameId },
            data: {
              status: 'COMPLETED',
              winningWord: latestGuess.word,
              completedAt: new Date()
            }
          });

          io.to(currentGameId).emit('gameOver', latestGuess.word);
        }
      }

      callback(true);
      updateGameState(currentGameId);
    } catch (error) {
      console.error('Error making guess:', error);
      callback(false);
      socket.emit('error', 'Failed to submit guess');
    }
  });

  socket.on('leaveGame', async () => {
    if (currentGameId && currentPlayerId) {
      try {
        await prisma.player.delete({
          where: { id: currentPlayerId }
        });

        socket.to(currentGameId).emit('playerLeft', currentPlayerId);
        socket.leave(currentGameId);
        
        // Check if game should be abandoned
        const game = await prisma.gameSession.findUnique({
          where: { id: currentGameId },
          include: { players: true }
        });

        if (game && game.players.length === 0) {
          await prisma.gameSession.update({
            where: { id: currentGameId },
            data: { status: 'ABANDONED' }
          });
        }

        updateGameState(currentGameId);
      } catch (error) {
        console.error('Error leaving game:', error);
      }

      currentGameId = null;
      currentPlayerId = null;
    }
  });

  socket.on('disconnect', () => {
    if (currentGameId && currentPlayerId) {
      // Handle disconnection by triggering the leave game logic
      socket.emit('error', 'Disconnected from game');
      socket.emit('playerLeft', currentPlayerId);
    }
  });
});

async function updateGameState(gameId: string) {
  try {
    const game = await prisma.gameSession.findUnique({
      where: { id: gameId },
      include: {
        players: true,
        guesses: {
          include: { player: true },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!game) return;

    const gameState: GameState = {
      id: game.id,
      status: game.status,
      players: game.players.map((player: { id: string; nickname: string; isHost: boolean; secretWord: string | null }) => ({
        id: player.id,
        nickname: player.nickname,
        isHost: player.isHost,
        hasSetSecretWord: Boolean(player.secretWord)
      })),
      guesses: game.guesses.map((guess: { id: string; playerId: string; word: string; createdAt: Date; player: { nickname: string } }) => ({
        id: guess.id,
        playerId: guess.playerId,
        playerNickname: guess.player.nickname,
        word: guess.word,
        timestamp: guess.createdAt
      }))
    };

    activeGames.set(gameId, gameState);
    io.to(gameId).emit('gameStateUpdate', gameState);
  } catch (error) {
    console.error('Error updating game state:', error);
  }
}

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
}); 