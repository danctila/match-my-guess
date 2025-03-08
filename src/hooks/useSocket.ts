import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// Socket.IO server URL
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';

// Game types
export interface Player {
  id: string;
  name: string;
  socketId: string;
  secretWord: string; 
  isHost: boolean;
}

export interface Guess {
  playerId: string;
  playerName: string;
  word: string;
  timestamp: Date;
}

export interface Game {
  id: string;
  title: string;
  status: 'WAITING' | 'SETTING_WORDS' | 'PLAYING' | 'COMPLETED';
  players: Player[];
  guesses: Guess[];
  winningWord: string | null;
  createdAt: Date;
}

export interface GameListItem {
  id: string;
  title: string;
  players: number;
  host: string;
  status: 'WAITING' | 'SETTING_WORDS' | 'PLAYING' | 'COMPLETED';
}

// Create a socket instance
let socket: Socket | null = null;

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lobbyList, setLobbyList] = useState<GameListItem[]>([]);
  const [gameState, setGameState] = useState<Game | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [winningWord, setWinningWord] = useState<string | null>(null);

  // Initialize socket connection
  useEffect(() => {
    // Create socket if it doesn't exist
    if (!socket) {
      console.log('Creating new socket connection to:', SOCKET_URL);
      socket = io(SOCKET_URL);
    }

    // Connection events
    const onConnect = () => {
      console.log('Socket connected:', socket?.id);
      setIsConnected(true);
      setError(null);
      
      // Request the game list when connected
      socket?.emit('getGameList');
    };

    const onDisconnect = () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    };

    const onConnectError = (err: Error) => {
      console.error('Connection error:', err.message);
      setError(`Connection error: ${err.message}`);
      setIsConnected(false);
    };

    // Game events
    const onGameState = (state: Game) => {
      console.log('Game state updated:', state);
      setGameState(state);
      
      // Update current player if we have a player with matching socket ID
      if (socket) {
        const player = state.players.find(p => p.socketId === socket.id);
        if (player) {
          setCurrentPlayer(player);
        }
      }
    };

    const onGameList = (games: GameListItem[]) => {
      console.log('Received game list:', games);
      setLobbyList(games);
    };

    const onGameOver = (word: string) => {
      console.log('Game over! Winning word:', word);
      setWinningWord(word);
    };

    const onGameNotFound = () => {
      console.error('Game not found');
      setError('Game not found or no longer available');
    };

    const onGameFull = () => {
      console.error('Game is full or already started');
      setError('Game is full or has already started');
    };

    const onError = (message: string) => {
      console.error('Socket error:', message);
      setError(message);
    };

    // Register event handlers
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('error', onError);
    socket.on('gameState', onGameState);
    socket.on('gameList', onGameList);
    socket.on('gameOver', onGameOver);
    socket.on('gameNotFound', onGameNotFound);
    socket.on('gameFull', onGameFull);

    // If socket is already connected, trigger the connect handler
    if (socket && socket.connected) {
      onConnect();
    }

    // Clean up event listeners on unmount
    return () => {
      socket?.off('connect', onConnect);
      socket?.off('disconnect', onDisconnect);
      socket?.off('connect_error', onConnectError);
      socket?.off('error', onError);
      socket?.off('gameState', onGameState);
      socket?.off('gameList', onGameList);
      socket?.off('gameOver', onGameOver);
      socket?.off('gameNotFound', onGameNotFound);
      socket?.off('gameFull', onGameFull);
    };
  }, []);

  // Refresh game list every 3 seconds
  useEffect(() => {
    if (!isConnected || !socket) return;
    
    const interval = setInterval(() => {
      socket.emit('getGameList');
    }, 3000);
    
    return () => clearInterval(interval);
  }, [isConnected]);

  // Create a new game
  const createGame = useCallback((playerName: string, gameTitle: string = ''): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!socket || !isConnected) {
        setError('Not connected to server');
        resolve(null);
        return;
      }

      console.log(`Creating game with title: ${gameTitle || playerName + "'s Game"}`);
      socket.emit('createGame', playerName, gameTitle, (gameId: string | null) => {
        console.log(`Game creation result: ${gameId ? 'SUCCESS' : 'FAILED'}`);
        resolve(gameId);
      });
    });
  }, [isConnected]);

  // Join a game
  const joinGame = useCallback((gameId: string, playerName: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socket || !isConnected) {
        setError('Not connected to server');
        resolve(false);
        return;
      }

      console.log(`Attempting to join game ${gameId} as ${playerName}`);
      socket.emit('joinGame', gameId, playerName, (success: boolean) => {
        console.log(`Join game result: ${success ? 'SUCCESS' : 'FAILED'}`);
        resolve(success);
      });
    });
  }, [isConnected]);

  // Set secret word
  const setSecretWord = useCallback((word: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socket || !isConnected) {
        setError('Not connected to game');
        resolve(false);
        return;
      }

      console.log(`Setting secret word: ${word}`);
      socket.emit('setSecretWord', word, (success: boolean) => {
        console.log(`Set secret word result: ${success ? 'SUCCESS' : 'FAILED'}`);
        resolve(success);
      });
    });
  }, [isConnected]);

  // Make a guess
  const makeGuess = useCallback((word: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socket || !isConnected) {
        setError('Not connected to game');
        resolve(false);
        return;
      }

      console.log(`Making guess: ${word}`);
      socket.emit('makeGuess', word, (success: boolean) => {
        console.log(`Make guess result: ${success ? 'SUCCESS' : 'FAILED'}`);
        resolve(success);
      });
    });
  }, [isConnected]);

  // Leave game
  const leaveGame = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      if (!socket || !isConnected) {
        resolve();
        return;
      }

      console.log('Leaving game');
      socket.emit('leaveGame', () => {
        setGameState(null);
        setCurrentPlayer(null);
        setWinningWord(null);
        console.log('Left game successfully');
        resolve();
      });
    });
  }, [isConnected]);

  // Refresh game list
  const refreshGameList = useCallback(() => {
    if (socket && isConnected) {
      console.log('Refreshing game list');
      socket.emit('getGameList');
    }
  }, [isConnected]);

  return {
    socket,
    isConnected,
    error,
    lobbyList,
    gameState,
    currentPlayer,
    winningWord,
    createGame,
    joinGame,
    setSecretWord,
    makeGuess,
    leaveGame,
    refreshGameList
  };
} 