import React from "react";
import { Game, Player } from "@/hooks/useSocket";

interface WordMatchGameProps {
  gameState: Game;
  currentPlayer: Player | null;
  winningWord: string | null;
  onSubmitWord: (word: string) => Promise<void>;
  wordInput: string;
  setWordInput: (value: string) => void;
}

const WordMatchGame: React.FC<WordMatchGameProps> = ({
  gameState,
  currentPlayer,
  winningWord,
  onSubmitWord,
  wordInput,
  setWordInput,
}) => {
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

  return (
    <div>
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
        <h3 className="text-lg font-semibold mb-2 text-gray-900">Players</h3>
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
                <span className="font-medium text-gray-900">{player.name}</span>
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
              className="flex-1 px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
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
          <h3 className="text-lg font-semibold mb-2 text-gray-900">
            Recent Guesses
          </h3>
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
      )}
    </div>
  );
};

export default WordMatchGame;
