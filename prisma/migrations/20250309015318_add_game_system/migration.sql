/*
  Warnings:

  - The values [WAITING_FOR_PLAYERS,SETTING_WORDS,ACTIVE] on the enum `GameStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `isHost` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `nickname` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `secretWord` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the column `sessionId` on the `Player` table. All the data in the column will be lost.
  - You are about to drop the `GameSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Guess` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[userId,lobbyId]` on the table `Player` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `lastActiveAt` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lobbyId` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `metadata` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Player` table without a default value. This is not possible if the table is not empty.

*/
-- Drop existing tables and types if they exist
DROP TABLE IF EXISTS "Move" CASCADE;
DROP TABLE IF EXISTS "Player" CASCADE;
DROP TABLE IF EXISTS "Game" CASCADE;
DROP TABLE IF EXISTS "Lobby" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;
DROP TABLE IF EXISTS "Guess" CASCADE;
DROP TABLE IF EXISTS "GameSession" CASCADE;
DROP TYPE IF EXISTS "GameStatus" CASCADE;
DROP TYPE IF EXISTS "GameType" CASCADE;
DROP TYPE IF EXISTS "LobbyStatus" CASCADE;

-- Create enums
CREATE TYPE "GameType" AS ENUM ('WORD_MATCH');
CREATE TYPE "GameStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');
CREATE TYPE "LobbyStatus" AS ENUM ('WAITING', 'READY', 'IN_GAME', 'FINISHED', 'ABANDONED');

-- Create tables
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Lobby" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New Game',
    "gameType" "GameType" NOT NULL DEFAULT 'WORD_MATCH',
    "status" "LobbyStatus" NOT NULL DEFAULT 'WAITING',
    "maxPlayers" INTEGER NOT NULL DEFAULT 2,
    "hostId" TEXT NOT NULL,

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "gameType" "GameType" NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "config" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "lobbyId" TEXT NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "userId" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "gameId" TEXT,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Move" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moveType" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,

    CONSTRAINT "Move_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "Lobby_hostId_idx" ON "Lobby"("hostId");
CREATE UNIQUE INDEX "Game_lobbyId_key" ON "Game"("lobbyId");
CREATE INDEX "Game_lobbyId_idx" ON "Game"("lobbyId");
CREATE INDEX "Move_gameId_idx" ON "Move"("gameId");
CREATE INDEX "Move_playerId_idx" ON "Move"("playerId");
CREATE INDEX "Player_userId_idx" ON "Player"("userId");
CREATE INDEX "Player_lobbyId_idx" ON "Player"("lobbyId");
CREATE INDEX "Player_gameId_idx" ON "Player"("gameId");
CREATE UNIQUE INDEX "Player_userId_lobbyId_key" ON "Player"("userId", "lobbyId");

-- Add foreign key constraints
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_hostId_fkey" 
    FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Game" ADD CONSTRAINT "Game_lobbyId_fkey" 
    FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Player" ADD CONSTRAINT "Player_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Player" ADD CONSTRAINT "Player_lobbyId_fkey" 
    FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Player" ADD CONSTRAINT "Player_gameId_fkey" 
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Move" ADD CONSTRAINT "Move_gameId_fkey" 
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Move" ADD CONSTRAINT "Move_playerId_fkey" 
    FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
