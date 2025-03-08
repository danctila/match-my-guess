"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

export default function JoinPage() {
  const router = useRouter();
  const { isConnected } = useSocket();
  const [gameId, setGameId] = useState("");
  const [playerName, setPlayerName] = useState("");

  const handleJoin = () => {
    if (!gameId.trim() || !playerName.trim()) return;
    router.push(`/game/${gameId.trim()}`);
  };

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-md mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Join Game</h1>
          <p className="text-gray-600">
            Enter the game ID and your name to join an existing game.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="gameId"
              className="block text-sm font-medium text-gray-700"
            >
              Game ID
            </label>
            <input
              type="text"
              id="gameId"
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              placeholder="Enter game ID"
              className="game-input"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="playerName"
              className="block text-sm font-medium text-gray-700"
            >
              Your Name
            </label>
            <input
              type="text"
              id="playerName"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              className="game-input"
            />
          </div>

          <button
            onClick={handleJoin}
            disabled={!isConnected || !gameId.trim() || !playerName.trim()}
            className="game-button w-full"
          >
            Join Game
          </button>
        </div>

        {!isConnected && (
          <p className="mt-4 text-center text-sm text-red-600">
            Connecting to server...
          </p>
        )}
      </div>
    </main>
  );
}
