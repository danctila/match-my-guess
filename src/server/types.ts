import { Prisma, GameType, GameStatus, LobbyStatus } from '@prisma/client';

export type { GameType, GameStatus, LobbyStatus };

export interface GameMetadata {
  winningWord?: string;
  [key: string]: unknown;
}

export interface PlayerMetadata {
  secretWord?: string;
  [key: string]: unknown;
}

export interface GameConfig {
  maxPlayers: number;
  [key: string]: any;
}

export interface MoveData {
  word: string;
  [key: string]: unknown;
}

// Prisma includes for common queries
export const lobbyInclude = {
  host: true,
  players: {
    include: {
      user: true
    }
  },
  game: true
} as const;

export const playerInclude = {
  user: true,
  lobby: {
    include: {
      host: true
    }
  },
  game: true
} as const;

export const moveInclude = {
  player: {
    include: {
      user: true
    }
  },
  game: true
} as const;

// Inferred types from includes
export type LobbyWithRelations = Prisma.LobbyGetPayload<{
  include: typeof lobbyInclude;
}>;

export type PlayerWithRelations = Prisma.PlayerGetPayload<{
  include: typeof playerInclude;
}>;

export type MoveWithRelations = Prisma.MoveGetPayload<{
  include: typeof moveInclude;
}>;

// Socket.IO event payloads
export interface GameStatePayload {
  id: string;
  title: string;
  status: string;
  players: {
    id: string;
    name: string;
    isHost: boolean;
    secretWord: string;
  }[];
  guesses: {
    playerId: string;
    playerName: string;
    word: string;
    timestamp: Date;
  }[];
}

export interface GameListItemPayload {
  id: string;
  title: string;
  players: number;
  host: string;
  status: string;
}

export interface NewGuessPayload {
  playerId: string;
  playerName: string;
  word: string;
  timestamp: Date;
}

export interface GameCompletePayload {
  winningWord: string;
}

// Helper type for JSON data
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Type guards
export function isPlayerMetadata(obj: unknown): obj is PlayerMetadata {
  return typeof obj === 'object' && obj !== null && 'secretWord' in obj;
}

export function isMoveData(obj: unknown): obj is MoveData {
  return typeof obj === 'object' && obj !== null && 'word' in obj;
}

export function getMetadataValue<T>(metadata: Prisma.JsonValue | null, key: string): T | undefined {
  if (typeof metadata === 'object' && metadata !== null && key in metadata) {
    return (metadata as Record<string, unknown>)[key] as T;
  }
  return undefined;
}

// Type guards for Prisma relations
export function isLobbyWithRelations(obj: unknown): obj is Prisma.LobbyGetPayload<{
  include: typeof lobbyInclude;
}> {
  return obj !== null &&
    typeof obj === 'object' &&
    'id' in obj &&
    'host' in obj &&
    'players' in obj &&
    Array.isArray((obj as any).players);
}

export function isPlayerWithRelations(obj: unknown): obj is Prisma.PlayerGetPayload<{
  include: typeof playerInclude;
}> {
  return obj !== null &&
    typeof obj === 'object' &&
    'id' in obj &&
    'user' in obj &&
    'lobby' in obj;
}

export function isMoveWithRelations(obj: unknown): obj is Prisma.MoveGetPayload<{
  include: typeof moveInclude;
}> {
  return obj !== null &&
    typeof obj === 'object' &&
    'id' in obj &&
    'player' in obj &&
    'game' in obj;
} 