import React, { useState, useEffect } from "react";
import { Game, Player } from "@/hooks/useSocket";

interface WordBombGameProps {
  gameState: Game;
  currentPlayer: Player | null;
  onSubmitWord: (word: string) => Promise<void>;
  wordInput: string;
  setWordInput: (value: string) => void;
}

const WordBombGame: React.FC<WordBombGameProps> = ({
  gameState,
  currentPlayer,
  onSubmitWord,
  wordInput,
  setWordInput,
}) => {
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [lastWord, setLastWord] = useState<string>("");
  const isMyTurn =
    currentPlayer && gameState.currentPlayerId === currentPlayer.id;

  // Set up timer
  useEffect(() => {
    if (!gameState.currentPlayerId || !gameState.turnTimeLimit) return;

    // Find the last word to display
    if (gameState.guesses && gameState.guesses.length > 0) {
      setLastWord(gameState.guesses[gameState.guesses.length - 1].word);
    }

    // Only start timer if it's the current player's turn
    if (isMyTurn) {
      setTimeLeft(gameState.turnTimeLimit / 1000);

      const timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [
    gameState.currentPlayerId,
    gameState.turnTimeLimit,
    gameState.guesses,
    isMyTurn,
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const word = wordInput.trim().toLowerCase();
    if (!word) return;

    try {
      await onSubmitWord(word);
      setWordInput("");
    } catch (err) {
      console.error("Failed to submit word:", err);
    }
  };

  // Get player by ID
  const getPlayerById = (id: string): Player | undefined => {
    return gameState.players.find((p) => p.id === id);
  };

  // Get current player name
  const getCurrentPlayerName = (): string => {
    if (!gameState.currentPlayerId) return "Unknown";
    const player = getPlayerById(gameState.currentPlayerId);
    return player ? player.name : "Unknown";
  };

  // Check if game is in active playing state
  const isGameActive = (): boolean => {
    return gameState.status === "PLAYING";
  };

  return (
    <div>
      {/* Game Status */}
      <div
        className={`text-center p-4 rounded-lg mb-6 ${
          gameState.status === "WAITING"
            ? "bg-yellow-100 text-yellow-900"
            : gameState.status === "PLAYING"
            ? "bg-green-100 text-green-900"
            : "bg-purple-100 text-purple-900"
        }`}
      >
        {gameState.status === "WAITING" && (
          <h3 className="text-lg font-semibold">Waiting for Players</h3>
        )}
        {gameState.status === "PLAYING" && (
          <h3 className="text-lg font-semibold">
            {isMyTurn ? "Your Turn!" : `${getCurrentPlayerName()}'s Turn`}
          </h3>
        )}
        {gameState.status === "COMPLETED" && (
          <>
            <h3 className="text-lg font-semibold">Game Over!</h3>
            <p>
              Winner: <span className="font-bold">{gameState.winnerName}</span>
            </p>
          </>
        )}
      </div>

      {/* Players */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2 text-gray-900">Players</h3>
        <div className="grid grid-cols-2 gap-4">
          {gameState.players.map((player) => (
            <div
              key={player.id}
              className={`p-4 rounded-lg ${
                player.id === gameState.currentPlayerId
                  ? "bg-green-50 border-2 border-green-300"
                  : player.socketId === currentPlayer?.socketId
                  ? "bg-blue-50 border-2 border-blue-300"
                  : "bg-gray-50 border border-gray-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">{player.name}</span>
                <div className="flex gap-2">
                  {player.isHost && (
                    <span className="text-xs bg-yellow-200 text-yellow-900 px-2 py-1 rounded font-medium">
                      Host
                    </span>
                  )}
                  {player.id === gameState.currentPlayerId && (
                    <span className="text-xs bg-green-200 text-green-900 px-2 py-1 rounded font-medium">
                      Current Turn
                    </span>
                  )}
                </div>
              </div>
              {player.score !== undefined && (
                <div className="mt-2">
                  <span className="text-sm text-gray-700">
                    Score: <span className="font-medium">{player.score}</span>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Current Word Info */}
      {isGameActive() && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          {lastWord ? (
            <div className="text-center">
              <p className="text-gray-700 mb-2">Last word:</p>
              <p className="text-2xl font-bold text-gray-900">{lastWord}</p>
              {lastWord && (
                <p className="mt-2 text-blue-700 font-medium">
                  Next word must start with:{" "}
                  <span className="text-xl">
                    {lastWord.charAt(lastWord.length - 1).toUpperCase()}
                  </span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-center text-gray-700">
              First player can use any word to start
            </p>
          )}
        </div>
      )}

      {/* Timer */}
      {isMyTurn && isGameActive() && (
        <div className="mb-6">
          <div className="w-full bg-gray-200 rounded-full h-4">
            <div
              className={`h-4 rounded-full ${
                timeLeft > 5 ? "bg-green-600" : "bg-red-600"
              }`}
              style={{
                width: `${
                  (timeLeft / (gameState.turnTimeLimit! / 1000)) * 100
                }%`,
              }}
            ></div>
          </div>
          <p className="text-center mt-2 font-medium">
            Time left: {timeLeft} seconds
          </p>
        </div>
      )}

      {/* Word Input */}
      {isMyTurn && isGameActive() && (
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={wordInput}
              onChange={(e) => setWordInput(e.target.value)}
              placeholder={
                lastWord
                  ? `Enter a word starting with "${lastWord
                      .charAt(lastWord.length - 1)
                      .toUpperCase()}"`
                  : "Enter any word to start"
              }
              className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              autoFocus
            />
            <button
              type="submit"
              className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Submit
            </button>
          </div>
        </form>
      )}

      {/* Word History */}
      <div>
        <h3 className="text-lg font-semibold mb-2 text-gray-900">
          Word History
        </h3>
        {gameState.guesses && gameState.guesses.length === 0 ? (
          <p className="text-gray-500">No words yet. Be the first!</p>
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
                    <span className="font-medium">{guess.playerName}: </span>
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
    </div>
  );
};

export default WordBombGame;
