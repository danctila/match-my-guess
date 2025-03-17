import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

// Socket.IO server URL
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';

// Game types
export type GameType = 'WORD_MATCH' | 'WORD_BOMB' | string;

export interface Player {
  id: string;
  name: string;
  socketId: string;
  secretWord: string; 
  isHost: boolean;
  isConnected?: boolean;
  score?: number; // For games that track scores
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
  gameType: GameType;
  players: Player[];
  guesses: Guess[];
  winningWord: string | null;
  createdAt: Date;
  countdownSeconds?: number;
  // Word Bomb specific properties
  currentPlayerId?: string;
  turnTimeLimit?: number;
  winnerName?: string;
}

export interface GameListItem {
  id: string;
  title: string;
  players: number;
  host: string;
  status: 'WAITING' | 'SETTING_WORDS' | 'PLAYING' | 'COMPLETED';
  gameType: GameType;
  playerNames: string[];
}

export interface LobbyState {
  id: string;
  title: string;
  host: string;
  hostId?: string; // Add hostId to correctly identify the host
  players: {
    id: string;
    name: string;
    isHost: boolean;
    isConnected: boolean;
  }[];
}

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lobbyList, setLobbyList] = useState<GameListItem[]>([]);
  const [gameState, setGameState] = useState<Game | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [winningWord, setWinningWord] = useState<string | null>(null);
  const [lobbyState, setLobbyState] = useState<LobbyState | null>(null);
  const [supportedGameTypes, setSupportedGameTypes] = useState<string[]>(['WORD_MATCH', 'WORD_BOMB']);
  const [isConnecting, setIsConnecting] = useState(true);

  useEffect(() => {
    // Initialize socket with reconnection options
    const socketInstance = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000', {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    setSocket(socketInstance);

    // Connection events
    socketInstance.on('connect', () => {
      console.log('Socket connected');
      setIsConnected(true);
      setIsConnecting(false);
      socketInstance.emit('getGameList');

      // Try to reconnect to game if we have stored game info
      const storedGameId = sessionStorage.getItem('gameId');
      const storedPlayerId = sessionStorage.getItem('playerId');
      if (storedGameId && storedPlayerId) {
        console.log(`Attempting to reconnect to game ${storedGameId} as player ${storedPlayerId}`);
        socketInstance.emit('reconnect', storedGameId, storedPlayerId, (response: any) => {
          if (!response.success) {
            console.error('Failed to reconnect:', response.error);
            sessionStorage.removeItem('gameId');
            sessionStorage.removeItem('playerId');
          }
        });
      }
    });
    
    socketInstance.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
      setIsConnecting(true);
    });
    
    socketInstance.on('connect_error', (error) => {
      console.error('Connection error:', error);
      setIsConnected(false);
      setIsConnecting(false);
    });

    // Game state events
    socketInstance.on('gameState', (state: Game) => {
      console.log('Received game state:', state);
      setGameState(state);
      
      // Store game and player info for reconnection
      if (state.id) {
        sessionStorage.setItem('gameId', state.id);
      }
      if (state.players.find((p: Player) => p.socketId === socketInstance?.id)) {
        setCurrentPlayer(state.players.find((p: Player) => p.socketId === socketInstance?.id) as Player);
        
        // Store player ID in session storage for reconnection
        sessionStorage.setItem('playerId', state.players.find((p: Player) => p.socketId === socketInstance?.id)?.id ?? '');
      }
    });
    
    // Lobby state events
    socketInstance.on('lobbyState', (state: LobbyState) => {
      console.log('Received lobby state:', state);
      setLobbyState(state);
      
      // Update game state players with connection status from lobby state
      if (gameState) {
        setGameState({
          ...gameState,
          players: gameState.players.map(player => ({
            ...player,
            isConnected: state.players.find((p: { id: string }) => p.id === player.id)?.isConnected ?? true
          }))
        });
      }
    });
    
    // Game list events
    socketInstance.on('gameList', (list) => {
      console.log('Received game list:', list);
      setLobbyList(list);
    });
    
    socketInstance.on('gameListUpdated', () => {
      console.log('Game list updated, requesting fresh list');
      socketInstance.emit('getGameList');
    });
    
    // Player connection events
    socketInstance.on('playerReconnected', (data) => {
      console.log(`Player reconnected: ${data.playerName} (${data.playerId})`);
      if (lobbyState) {
        setLobbyState({
          ...lobbyState,
          players: lobbyState.players.map(p => 
            p.id === data.playerId ? { ...p, isConnected: true } : p
          )
        });
      }
      
      // Update game state if we have it
      if (gameState) {
        setGameState({
          ...gameState,
          players: gameState.players.map(p => 
            p.id === data.playerId ? { ...p, isConnected: true } : p
          )
        });
      }
    });
    
    socketInstance.on('playerDisconnected', (data) => {
      console.log(`Player disconnected: ${data.playerName} (${data.playerId})`);
      if (lobbyState) {
        setLobbyState({
          ...lobbyState,
          players: lobbyState.players.map(p => 
            p.id === data.playerId ? { ...p, isConnected: false } : p
          )
        });
      }
      
      // Update game state if we have it
      if (gameState) {
        setGameState({
          ...gameState,
          players: gameState.players.map(p => 
            p.id === data.playerId ? { ...p, isConnected: false } : p
          )
        });
      }
    });
    
    socketInstance.on('gameNotFound', () => {
      console.error('Game not found');
      setError('Game not found or no longer available');
    });

    return () => {
      socketInstance.off('connect');
      socketInstance.off('disconnect');
      socketInstance.off('connect_error');
      socketInstance.off('gameState');
      socketInstance.off('lobbyState');
      socketInstance.off('gameList');
      socketInstance.off('gameListUpdated');
      socketInstance.off('playerReconnected');
      socketInstance.off('playerDisconnected');
      socketInstance.off('gameNotFound');
      socketInstance.close();
    };
  }, []);

  // Refresh game list every 3 seconds
  useEffect(() => {
    if (!isConnected || !socket) return;
    
    const interval = setInterval(() => {
      socket?.emit('getGameList');
    }, 3000);
    
    return () => clearInterval(interval);
  }, [isConnected]);

  // Create a new game
  const createGame = useCallback((playerName: string, gameTitle: string = '', gameType: GameType = 'WORD_MATCH'): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!socket || !isConnected) {
        setError('Not connected to server');
        resolve(null);
        return;
      }

      console.log(`Creating game with title: ${gameTitle || playerName + "'s Game"}, type: ${gameType}`);
      socket?.emit('createGame', playerName, gameTitle, gameType, (response: { success: boolean, gameId: string | null, error?: string }) => {
        console.log(`Game creation result: ${response.success ? 'SUCCESS' : 'FAILED'}`);
        if (!response.success && response.error) {
          setError(response.error);
        }
        resolve(response.gameId);
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
      socket?.emit('joinGame', gameId, playerName, (response: { success: boolean, error?: string }) => {
        console.log(`Join game result: ${response.success ? 'SUCCESS' : 'FAILED'}`);
        if (!response.success && response.error) {
          setError(response.error);
        }
        resolve(response.success);
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
      socket.emit('leaveGame', (response: any) => {
        if (response.success) {
          // Clear all game state
          setGameState(null);
          setCurrentPlayer(null);
          setWinningWord(null);
          setLobbyState(null);
          
          // Clear stored game info
          sessionStorage.removeItem('gameId');
          sessionStorage.removeItem('playerId');
          
          console.log('Left game successfully');
        } else {
          console.error('Failed to leave game:', response.error);
        }
        resolve();
      });
    });
  }, [socket, isConnected]);

  // Refresh game list
  const refreshGameList = useCallback(() => {
    if (socket && isConnected) {
      console.log('Refreshing game list');
      socket.emit('getGameList');
    }
  }, [socket, isConnected]);

  // Auto-refresh game list periodically
  useEffect(() => {
    if (!isConnected || !socket) return;
    
    const interval = setInterval(() => {
      socket.emit('getGameList');
    }, 3000);
    
    return () => clearInterval(interval);
  }, [socket, isConnected]);

  // Handle disconnection cleanup
  useEffect(() => {
    if (!isConnected && currentPlayer) {
      // Clear game state on disconnection
      setGameState(null);
      setCurrentPlayer(null);
      setWinningWord(null);
      setLobbyState(null);
    }
  }, [isConnected, currentPlayer]);

  // Get supported game types
  const getSupportedGameTypes = useCallback((): string[] => {
    return supportedGameTypes;
  }, [supportedGameTypes]);

  return {
    socket,
    isConnected,
    isConnecting,
    error,
    lobbyList,
    gameState,
    currentPlayer,
    winningWord,
    lobbyState,
    createGame,
    joinGame,
    setSecretWord,
    makeGuess,
    leaveGame,
    refreshGameList,
    getSupportedGameTypes
  };
} 