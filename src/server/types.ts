export interface ServerToClientEvents {
  gameStateUpdate: (gameState: GameState) => void;
  playerJoined: (player: PlayerState) => void;
  playerLeft: (playerId: string) => void;
  newGuess: (guess: GuessState) => void;
  gameOver: (winningWord: string) => void;
  error: (message: string) => void;
}

export interface ClientToServerEvents {
  joinGame: (gameId: string, playerName: string, callback: (success: boolean) => void) => void;
  setSecretWord: (word: string, callback: (success: boolean) => void) => void;
  makeGuess: (word: string, callback: (success: boolean) => void) => void;
  leaveGame: () => void;
}

export interface GameState {
  id: string;
  status: 'WAITING' | 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  players: PlayerState[];
  guesses: GuessState[];
}

export interface PlayerState {
  id: string;
  nickname: string;
  isHost: boolean;
  hasSetSecretWord: boolean;
}

export interface GuessState {
  id: string;
  playerId: string;
  playerNickname: string;
  word: string;
  timestamp: Date;
} 