import { GuessState } from "@/server/types";

interface GuessHistoryProps {
  guesses: GuessState[];
  currentPlayerId?: string;
}

export function GuessHistory({ guesses, currentPlayerId }: GuessHistoryProps) {
  return (
    <div className="guess-history">
      {guesses.map((guess) => (
        <div
          key={guess.id}
          className={`guess-item ${
            guess.playerId === currentPlayerId ? "bg-blue-50" : ""
          }`}
        >
          <span className="font-semibold">{guess.playerNickname}: </span>
          <span className="text-lg">{guess.word}</span>
          <span className="text-xs text-gray-500 ml-2">
            {new Date(guess.timestamp).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}
