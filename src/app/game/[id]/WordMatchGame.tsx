import React from "react";
import { Game, Player, LobbyState } from "@/hooks/useSocket";

interface WordMatchGameProps {
  gameState: Game;
  currentPlayer: Player | null;
  winningWord: string | null;
  lobbyState: LobbyState | null;
  onSubmitWord: (word: string) => Promise<void>;
  wordInput: string;
  setWordInput: (value: string) => void;
}

const WordMatchGame: React.FC<WordMatchGameProps> = ({
  gameState,
  currentPlayer,
  winningWord,
  lobbyState,
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

  // Get the current player's connection status from lobby state
  const isCurrentPlayerConnected =
    lobbyState?.players.find((p) => p.id === currentPlayer?.id)?.isConnected ??
    true;

  // Get updated player information including connection status
  const getUpdatedPlayerStatus = (player: Player) => {
    const playerFromLobby = lobbyState?.players.find((p) => p.id === player.id);
    return {
      ...player,
      isConnected: playerFromLobby?.isConnected ?? true,
    };
  };

  // Get a list of players with updated connection information
  const playersWithStatus = gameState.players.map(getUpdatedPlayerStatus);

  // Render game status message
  const renderGameStatus = () => {
    switch (gameState.status) {
      case "WAITING":
        if (playersWithStatus.length < 2) {
          return "Waiting for another player to join...";
        }
        return `Game starting in ${gameState.countdownSeconds} seconds...`;
      case "SETTING_WORDS":
        const readyPlayers = playersWithStatus.filter(
          (p) => p.secretWord
        ).length;
        return `Setting secret words (${readyPlayers}/${playersWithStatus.length} ready)`;
      case "PLAYING":
        return "Game in progress - Make your guesses!";
      case "COMPLETED":
        return "Game Over!";
      default:
        return "Unknown game state";
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
        <h3 className="text-lg font-semibold">{renderGameStatus()}</h3>
        {gameState.status === "COMPLETED" && (
          <p className="mt-2">
            Winning word: <span className="font-bold">{winningWord}</span>
          </p>
        )}
      </div>

      {/* Players */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {playersWithStatus.map((player) => (
          <div
            key={player.id}
            className={`p-4 rounded-lg ${
              currentPlayer && player.id === currentPlayer.id
                ? "bg-blue-100 border-2 border-blue-300"
                : "bg-gray-100"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">
                  {player.name} {player.isHost && "(Host)"}
                </h3>
                {gameState.status === "SETTING_WORDS" && (
                  <p className="text-sm text-gray-600">
                    {player.secretWord
                      ? "Secret word set ✓"
                      : "Setting word..."}
                  </p>
                )}
              </div>
              <div className="flex items-center">
                <span
                  className={`inline-block w-3 h-3 rounded-full mr-2 ${
                    player.isConnected ? "bg-green-500" : "bg-red-500"
                  }`}
                ></span>
                <span className="text-sm text-gray-600">
                  {player.isConnected ? "Online" : "Offline"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Word Input */}
      {((gameState.status === "SETTING_WORDS" &&
        currentPlayer &&
        !currentPlayer.secretWord) ||
        gameState.status === "PLAYING") &&
        isCurrentPlayerConnected && (
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
            {gameState.status === "SETTING_WORDS" && (
              <p className="text-sm text-gray-600 mt-2">
                Choose a secret word that your opponent needs to guess. The game
                will start once both players set their words.
              </p>
            )}
          </form>
        )}

      {/* Connection Status Message */}
      {!isCurrentPlayerConnected && (
        <div className="bg-yellow-100 text-yellow-900 p-4 rounded-lg mb-6">
          <p className="text-center">
            You are currently offline. Please check your connection and refresh
            the page to reconnect.
          </p>
        </div>
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
