/*
  Warnings:

  - The values [WAITING,ABANDONED] on the enum `GameStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "GameStatus_new" AS ENUM ('WAITING_FOR_PLAYERS', 'SETTING_WORDS', 'ACTIVE', 'COMPLETED');
ALTER TABLE "GameSession" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "GameSession" ALTER COLUMN "status" TYPE "GameStatus_new" USING ("status"::text::"GameStatus_new");
ALTER TYPE "GameStatus" RENAME TO "GameStatus_old";
ALTER TYPE "GameStatus_new" RENAME TO "GameStatus";
DROP TYPE "GameStatus_old";
ALTER TABLE "GameSession" ALTER COLUMN "status" SET DEFAULT 'WAITING_FOR_PLAYERS';
COMMIT;

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "title" TEXT NOT NULL DEFAULT 'New Game',
ALTER COLUMN "status" SET DEFAULT 'WAITING_FOR_PLAYERS';

-- AlterTable
ALTER TABLE "Player" ALTER COLUMN "secretWord" DROP NOT NULL;
