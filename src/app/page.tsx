"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSocket, GameType } from "@/hooks/useSocket";

export default function Home() {
  const router = useRouter();
  const {
    isConnected,
    error: socketError,
    lobbyList,
    createGame,
    refreshGameList,
    getSupportedGameTypes,
  } = useSocket();

  const [playerName, setPlayerName] = useState("");
  const [gameTitle, setGameTitle] = useState("");
  const [selectedGameType, setSelectedGameType] =
    useState<GameType>("WORD_MATCH");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState("");

  // Restore player name from sessionStorage if available
  useEffect(() => {
    const savedName = sessionStorage.getItem("playerName");
    if (savedName) {
      setPlayerName(savedName);
    }
  }, []);

  // Refresh game list when connected
  useEffect(() => {
    if (isConnected) {
      refreshGameList();
    }
  }, [isConnected, refreshGameList]);

  // Handle creation of a new game
  const handleCreateGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim() || isCreating) return;

    setIsCreating(true);
    setError("");

    try {
      // Save the player name to sessionStorage
      sessionStorage.setItem("playerName", playerName.trim());

      // Create a new game
      const gameId = await createGame(
        playerName.trim(),
        gameTitle.trim() || `${playerName}'s Game`,
        selectedGameType
      );

      if (gameId) {
        console.log(`Game created successfully: ${gameId}`);
        router.push(`/game/${gameId}`);
      } else {
        setError("Failed to create game. Please try again.");
      }
    } catch (err) {
      console.error("Failed to create game:", err);
      setError("An error occurred. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  // Handle joining an existing game
  const handleJoinGame = async (lobbyId: string) => {
    if (!playerName.trim() || isJoining) return;

    setIsJoining(true);
    setError("");

    try {
      // Save the player name to sessionStorage before navigating
      sessionStorage.setItem("playerName", playerName.trim());
      console.log(`Joining game: ${lobbyId}`);
      router.push(`/game/${lobbyId}`);
    } catch (err) {
      console.error("Failed to join game:", err);
      setError("An error occurred. Please try again.");
    } finally {
      setIsJoining(false);
    }
  };

  // Get game type display name
  const getGameTypeDisplayName = (gameType: GameType): string => {
    switch (gameType) {
      case "WORD_MATCH":
        return "Match My Guess";
      case "WORD_BOMB":
        return "Word Bomb";
      default:
        return gameType;
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 flex flex-col p-4">
      <div className="max-w-4xl w-full mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Match My Guess
          </h1>
          <p className="text-gray-700">
            A multiplayer word guessing game platform with different game modes!
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Player Info and Create Game Form */}
          <div className="bg-white rounded-lg shadow-md p-6 space-y-4 lg:col-span-1">
            <div className="space-y-4 mb-6">
              <h2 className="text-xl font-semibold text-gray-900">
                Player Info
              </h2>
              <div className="space-y-2">
                <label
                  htmlFor="playerName"
                  className="block text-sm font-medium text-gray-800"
                >
                  Your Name
                </label>
                <input
                  type="text"
                  id="playerName"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                  autoFocus
                />
              </div>
            </div>

            <h2 className="text-xl font-semibold text-gray-900">Create Game</h2>
            <form onSubmit={handleCreateGame} className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="gameTitle"
                  className="block text-sm font-medium text-gray-800"
                >
                  Game Title (optional)
                </label>
                <input
                  type="text"
                  id="gameTitle"
                  value={gameTitle}
                  onChange={(e) => setGameTitle(e.target.value)}
                  placeholder={`${playerName}'s Game`}
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="gameType"
                  className="block text-sm font-medium text-gray-800"
                >
                  Game Type
                </label>
                <select
                  id="gameType"
                  value={selectedGameType}
                  onChange={(e) =>
                    setSelectedGameType(e.target.value as GameType)
                  }
                  className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                >
                  {getSupportedGameTypes().map((gameType) => (
                    <option key={gameType} value={gameType}>
                      {getGameTypeDisplayName(gameType as GameType)}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedGameType === "WORD_MATCH"
                    ? "Players choose secret words and guess until they match."
                    : selectedGameType === "WORD_BOMB"
                    ? "Take turns creating words that start with the last letter of the previous word."
                    : "Select a game type to see its description."}
                </p>
              </div>

              <button
                type="submit"
                disabled={!isConnected || !playerName.trim() || isCreating}
                className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 
                       focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? "Creating..." : "Create New Game"}
              </button>
            </form>

            {error && (
              <p className="text-red-600 font-medium text-sm mt-2">{error}</p>
            )}
            {socketError && (
              <p className="text-red-600 font-medium text-sm mt-2">
                {socketError}
              </p>
            )}
          </div>

          {/* Available Games List */}
          <div className="bg-white rounded-lg shadow-md p-6 space-y-4 lg:col-span-2">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900">
                Available Games
              </h2>
              <button
                onClick={refreshGameList}
                className="text-blue-700 hover:text-blue-900 font-medium"
                disabled={!isConnected}
              >
                Refresh
              </button>
            </div>

            {!isConnected ? (
              <p className="text-gray-700 py-4 text-center">
                Connecting to server...
              </p>
            ) : lobbyList.length === 0 ? (
              <p className="text-gray-700 py-4 text-center">
                No games available. Create one to get started!
              </p>
            ) : (
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                {lobbyList.map((lobby) => (
                  <div
                    key={lobby.id}
                    className="border border-gray-300 rounded-lg p-4 shadow-sm bg-white hover:shadow-md transition-shadow"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="text-lg font-medium">{lobby.title}</h3>
                        <p className="text-gray-600 text-sm">
                          Host: {lobby.host}
                        </p>
                      </div>
                      <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                        {lobby.gameType}
                      </span>
                    </div>

                    {/* Player list */}
                    <div className="mt-2 mb-3">
                      <h4 className="text-sm font-medium text-gray-700 mb-1">
                        Players:
                      </h4>
                      <div className="flex flex-wrap gap-1">
                        {lobby.playerNames?.map((name, index) => (
                          <span
                            key={index}
                            className={`text-xs px-2 py-1 rounded-full ${
                              name === lobby.host
                                ? "bg-purple-100 text-purple-800"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {name} {name === lobby.host && "(Host)"}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex justify-between items-center mt-2">
                      <div className="text-sm text-gray-600">
                        {lobby.players} / 2 players
                      </div>

                      <button
                        onClick={() => handleJoinGame(lobby.id)}
                        disabled={
                          lobby.players >= 2 || !playerName.trim() || isJoining
                        }
                        className={`px-3 py-1 rounded-md text-white text-sm ${
                          lobby.players >= 2 || !playerName.trim() || isJoining
                            ? "bg-gray-400 cursor-not-allowed"
                            : "bg-blue-500 hover:bg-blue-600"
                        }`}
                      >
                        {isJoining
                          ? "Joining..."
                          : lobby.players >= 2
                          ? "Full"
                          : "Join"}
                      </button>
                    </div>
                  </div>
                ))}

                {lobbyList.length === 0 && (
                  <div className="col-span-full p-6 text-center">
                    <p className="text-gray-500">
                      No active games found. Create one to get started!
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {!isConnected && (
          <p className="mt-4 text-center text-sm text-red-600 font-medium">
            Connecting to server...
          </p>
        )}
      </div>
    </main>
  );
}
