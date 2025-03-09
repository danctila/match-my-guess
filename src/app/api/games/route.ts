import { NextResponse } from 'next/server';
import { getOrCreateUser, createLobby, startGame } from '../../../server/prisma';

export async function POST(request: Request) {
  try {
    const { playerName } = await request.json();

    if (!playerName?.trim()) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      );
    }

    // Create or get the user
    const user = await getOrCreateUser(playerName.toLowerCase(), playerName);

    // Create a new lobby
    const lobby = await createLobby(user, 'New Game');

    // Start the game
    const game = await startGame(lobby.id);

    return NextResponse.json({ gameId: game.id });
  } catch (error) {
    console.error('Error creating game:', error);
    return NextResponse.json(
      { error: 'Failed to create game' },
      { status: 500 }
    );
  }
} 