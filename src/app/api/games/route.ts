import { NextResponse } from 'next/server';
import prisma from '@/server/prisma';

export async function POST(request: Request) {
  try {
    const { playerName } = await request.json();

    if (!playerName?.trim()) {
      return NextResponse.json(
        { error: 'Player name is required' },
        { status: 400 }
      );
    }

    // Create a new game session
    const game = await prisma.gameSession.create({
      data: {
        status: 'WAITING'
      }
    });

    return NextResponse.json({ gameId: game.id });
  } catch (error) {
    console.error('Error creating game:', error);
    return NextResponse.json(
      { error: 'Failed to create game' },
      { status: 500 }
    );
  }
} 