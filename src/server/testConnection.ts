import { PrismaClient } from '@prisma/client'
import { withAccelerate } from '@prisma/extension-accelerate'

const prisma = new PrismaClient().$extends(withAccelerate())

async function testConnection() {
  try {
    // Try to create a test game session
    const testGame = await prisma.gameSession.create({
      data: {
        status: 'WAITING'
      }
    });

    console.log('Successfully created test game:', testGame);

    // Clean up by deleting the test game
    await prisma.gameSession.delete({
      where: {
        id: testGame.id
      }
    });

    console.log('Successfully deleted test game');
    console.log('Database connection verified! ✅');
  } catch (error) {
    console.error('Failed to connect to database:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testConnection(); 