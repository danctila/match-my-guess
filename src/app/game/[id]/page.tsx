"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSocket, GameType } from "@/hooks/useSocket";

// Game-specific components
import WordMatchGame from "@/app/game/[id]/WordMatchGame";
import WordBombGame from "@/app/game/[id]/WordBombGame";

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
    lobbyState,
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

  // Handle leaving the game
  const handleLeaveGame = async () => {
    try {
      await leaveGame();
      router.replace("/");
    } catch (error) {
      console.error("Error leaving game:", error);
    }
  };

  // Render the appropriate game component based on game type
  const renderGameComponent = () => {
    if (!gameState) return null;

    switch (gameState.gameType) {
      case "WORD_MATCH":
        return (
          <WordMatchGame
            gameState={gameState}
            currentPlayer={currentPlayer}
            winningWord={winningWord}
            lobbyState={lobbyState}
            onSubmitWord={async (word: string) => {
              if (
                gameState.status === "SETTING_WORDS" &&
                currentPlayer &&
                !currentPlayer.secretWord
              ) {
                await setSecretWord(word);
              } else if (gameState.status === "PLAYING") {
                await makeGuess(word);
              }
            }}
            wordInput={wordInput}
            setWordInput={setWordInput}
          />
        );
      case "WORD_BOMB":
        return (
          <WordBombGame
            gameState={gameState}
            currentPlayer={currentPlayer}
            lobbyState={lobbyState}
            onSubmitWord={async (word: string) => {
              await makeGuess(word);
            }}
            wordInput={wordInput}
            setWordInput={setWordInput}
          />
        );
      default:
        return (
          <div className="text-center py-8">
            <p className="text-red-600">
              Unknown game type: {gameState.gameType}
            </p>
          </div>
        );
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
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-700">Loading game...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-600">{error}</p>
            <p className="text-gray-700 mt-2">Redirecting to home page...</p>
          </div>
        ) : gameState ? (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    {gameState.title}
                  </h1>
                  <p className="text-gray-700">
                    Game Type: {getGameTypeDisplayName(gameState.gameType)}
                  </p>
                </div>
                <button
                  onClick={handleLeaveGame}
                  className="px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 
                         focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  Leave Game
                </button>
              </div>

              {renderGameComponent()}
            </div>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-red-600">Game not found</p>
            <button
              onClick={() => router.replace("/")}
              className="mt-4 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Return to Home
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
