import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;

// Helper function to create a temporary user (we can add proper auth later)
export async function getOrCreateUser(username: string, displayName: string) {
  return await prisma.user.upsert({
    where: { username },
    update: { displayName },
    create: {
      username,
      displayName,
    },
  });
}

// Helper function to create a new lobby and associated game
export async function createLobby(
  hostUser: { id: string },
  title: string,
  maxPlayers: number = 2
) {
  return await prisma.lobby.create({
    data: {
      title,
      maxPlayers,
      hostId: hostUser.id,
      gameType: 'WORD_MATCH',
      status: 'WAITING',
    },
    include: {
      host: true,
      players: {
        include: {
          user: true,
        },
      },
    },
  });
}

// Helper function to join a lobby
export async function joinLobby(lobbyId: string, user: { id: string }) {
  return await prisma.$transaction(async (tx) => {
    // Get the lobby with current player count
    const lobby = await tx.lobby.findUnique({
      where: { id: lobbyId },
      include: {
        players: true,
      },
    });

    if (!lobby) throw new Error('Lobby not found');
    if (lobby.players.length >= lobby.maxPlayers) throw new Error('Lobby is full');
    if (lobby.status !== 'WAITING') throw new Error('Lobby is not accepting players');

    // Create player entry
    const player = await tx.player.create({
      data: {
        userId: user.id,
        lobbyId: lobby.id,
        metadata: {} as Prisma.JsonObject,
        isReady: false
      },
      include: {
        user: true,
        lobby: {
          include: {
            host: true
          }
        },
      },
    });

    // If we have enough players, update lobby status
    if (lobby.players.length + 1 === lobby.maxPlayers) {
      await tx.lobby.update({
        where: { id: lobbyId },
        data: { status: 'READY' },
      });
    }

    return player;
  });
}

// Helper function to start a game from a lobby
export async function startGame(lobbyId: string) {
  return await prisma.$transaction(async (tx) => {
    const lobby = await tx.lobby.findUnique({
      where: { id: lobbyId },
      include: {
        players: true,
      },
    });

    if (!lobby) throw new Error('Lobby not found');
    if (lobby.status !== 'READY') throw new Error('Lobby is not ready');

    // Create the game
    const game = await tx.game.create({
      data: {
        lobbyId: lobby.id,
        gameType: lobby.gameType,
        config: {
          maxPlayers: lobby.maxPlayers,
        } as Prisma.JsonObject,
        metadata: {
          winningWord: null,
        } as Prisma.JsonObject,
      },
    });

    // Update lobby status
    await tx.lobby.update({
      where: { id: lobbyId },
      data: { status: 'IN_GAME' },
    });

    // Update all players to link them to the game
    await tx.player.updateMany({
      where: { lobbyId: lobby.id },
      data: { gameId: game.id },
    });

    return game;
  });
}

// Helper function to record a move (guess)
export async function recordMove(
  gameId: string,
  playerId: string,
  word: string
) {
  return await prisma.move.create({
    data: {
      gameId,
      playerId,
      moveType: 'guess',
      data: {
        word,
      } as Prisma.JsonObject,
    },
    include: {
      player: {
        include: {
          user: true,
        },
      },
    },
  });
}

// Helper function to get available lobbies
export async function getAvailableLobbies() {
  return await prisma.lobby.findMany({
    where: {
      status: 'WAITING',
      players: {
        none: {
          gameId: { not: null },
        },
      },
    },
    include: {
      host: true,
      players: {
        include: {
          user: true,
        },
      },
    },
  });
}

// Helper function to check for matching moves
export async function checkForMatchingMoves(gameId: string): Promise<string | null> {
  const recentMoves = await prisma.move.findMany({
    where: {
      gameId,
      moveType: 'guess',
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      player: true,
    },
    take: 2, // Get last move from each player
  });

  if (recentMoves.length < 2) return null;

  const [move1, move2] = recentMoves;
  const word1 = (move1.data as any).word;
  const word2 = (move2.data as any).word;

  if (word1 === word2) {
    return word1;
  }

  return null;
} 