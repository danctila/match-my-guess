"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

export default function GamePage() {
  const router = useRouter();
  const params = useParams();
  const gameId = params.id as string;

  const {
    isConnected,
    error: socketError,
    gameState,
    currentPlayer,
    winningWord,
    joinGame,
    setSecretWord,
    makeGuess,
    leaveGame,
  } = useSocket();

  const [playerName, setPlayerName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wordInput, setWordInput] = useState("");
  const [joinAttempted, setJoinAttempted] = useState(false);

  // Get player name from sessionStorage
  useEffect(() => {
    const savedName = sessionStorage.getItem("playerName");
    if (savedName) {
      setPlayerName(savedName);
    } else {
      router.replace("/");
    }
  }, [router]);

  // Join the game when connected
  useEffect(() => {
    if (!playerName || !isConnected || joinAttempted) return;

    const connectToGame = async () => {
      try {
        setLoading(true);
        setJoinAttempted(true);
        console.log(`Joining game ${gameId} as ${playerName}`);
        const success = await joinGame(gameId, playerName);

        if (!success) {
          setError(
            "Failed to join game. It may be full or no longer available."
          );
          setTimeout(() => router.replace("/"), 3000);
        }
      } catch (error) {
        console.error("Error joining game:", error);
        setError("Failed to connect to game");
        setTimeout(() => router.replace("/"), 3000);
      } finally {
        setLoading(false);
      }
    };

    connectToGame();
  }, [gameId, playerName, isConnected, joinGame, router, joinAttempted]);

  // Update loading state when game state changes
  useEffect(() => {
    if (gameState) {
      setLoading(false);
    }
  }, [gameState]);

  // Handle form submissions
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const word = wordInput.trim().toLowerCase();
    if (!word) return;

    setError(null);
    try {
      if (
        gameState?.status === "SETTING_WORDS" &&
        currentPlayer &&
        !currentPlayer.secretWord
      ) {
        await setSecretWord(word);
      } else if (gameState?.status === "PLAYING") {
        await makeGuess(word);
      }
      setWordInput("");
    } catch (err) {
      setError("Failed to submit word");
    }
  };

  // Handle leaving the game
  const handleLeaveGame = async () => {
    try {
      await leaveGame();
      router.push("/");
    } catch (error) {
      console.error("Error leaving game:", error);
    }
  };

  // Loading state
  if (loading || !isConnected || !gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            {!isConnected
              ? "Connecting to server..."
              : loading
              ? "Joining game..."
              : "Waiting for game data..."}
          </h2>
          {(error || socketError) && (
            <p className="text-red-600 mt-2">{error || socketError}</p>
          )}
          <div className="mt-4">
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            {gameState.title}
          </h2>
          <button
            onClick={handleLeaveGame}
            className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
          >
            Leave Game
          </button>
        </div>

        {/* Game Status */}
        <div
          className={`text-center p-4 rounded-lg mb-6 ${
            gameState.status === "WAITING"
              ? "bg-yellow-100 text-yellow-900"
              : gameState.status === "SETTING_WORDS"
              ? "bg-blue-100 text-blue-900"
              : gameState.status === "PLAYING"
              ? "bg-green-100 text-green-900"
              : "bg-purple-100 text-purple-900"
          }`}
        >
          {gameState.status === "WAITING" && (
            <h3 className="text-lg font-semibold">Waiting for Players</h3>
          )}
          {gameState.status === "SETTING_WORDS" && (
            <h3 className="text-lg font-semibold">Set Your Secret Word</h3>
          )}
          {gameState.status === "PLAYING" && (
            <h3 className="text-lg font-semibold">Game In Progress</h3>
          )}
          {gameState.status === "COMPLETED" && (
            <>
              <h3 className="text-lg font-semibold">Game Over!</h3>
              <p>
                Winning word: <span className="font-bold">{winningWord}</span>
              </p>
            </>
          )}
        </div>

        {/* Players */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Players</h3>
          <div className="grid grid-cols-2 gap-4">
            {gameState.players.map((player) => (
              <div
                key={player.id}
                className={`p-4 rounded-lg ${
                  player.socketId === currentPlayer?.socketId
                    ? "bg-blue-50 border-2 border-blue-300"
                    : "bg-gray-50 border border-gray-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">
                    {player.name}
                  </span>
                  <div className="flex gap-2">
                    {player.isHost && (
                      <span className="text-xs bg-yellow-200 text-yellow-900 px-2 py-1 rounded font-medium">
                        Host
                      </span>
                    )}
                    {player.secretWord && (
                      <span className="text-xs bg-green-200 text-green-900 px-2 py-1 rounded font-medium">
                        Ready
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Word Input */}
        {((gameState.status === "SETTING_WORDS" &&
          currentPlayer &&
          !currentPlayer.secretWord) ||
          gameState.status === "PLAYING") && (
          <form onSubmit={handleSubmit} className="mb-6">
            <div className="flex gap-2">
              <input
                type="text"
                value={wordInput}
                onChange={(e) => setWordInput(e.target.value)}
                placeholder={
                  gameState.status === "SETTING_WORDS"
                    ? "Enter your secret word"
                    : "Make a guess"
                }
                className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
              />
              <button
                type="submit"
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {gameState.status === "SETTING_WORDS" ? "Set Word" : "Guess"}
              </button>
            </div>
          </form>
        )}

        {/* Guesses */}
        {gameState.status === "PLAYING" && (
          <div>
            <h3 className="text-lg font-semibold mb-2">Recent Guesses</h3>
            {gameState.guesses.length === 0 ? (
              <p className="text-gray-500">No guesses yet. Be the first!</p>
            ) : (
              <div className="space-y-2">
                {[...gameState.guesses]
                  .sort(
                    (a, b) =>
                      new Date(b.timestamp).getTime() -
                      new Date(a.timestamp).getTime()
                  )
                  .slice(0, 10)
                  .map((guess, index) => (
                    <div
                      key={index}
                      className="p-3 bg-gray-50 rounded-lg flex justify-between"
                    >
                      <span>
                        <span className="font-medium">
                          {guess.playerName}:{" "}
                        </span>
                        {guess.word}
                      </span>
                      <span className="text-gray-500 text-sm">
                        {new Date(guess.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Error Message */}
        {error && <p className="text-red-600 mt-4">{error}</p>}
      </div>
    </div>
  );
}
