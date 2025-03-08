import { useState, FormEvent } from "react";

interface GuessInputProps {
  onSubmit: (guess: string) => Promise<void>;
  disabled?: boolean;
}

export function GuessInput({ onSubmit, disabled }: GuessInputProps) {
  const [guess, setGuess] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!guess.trim()) return;

    await onSubmit(guess.trim().toLowerCase());
    setGuess("");
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md">
      <div className="flex gap-2">
        <input
          type="text"
          value={guess}
          onChange={(e) => setGuess(e.target.value)}
          placeholder="Enter your guess..."
          disabled={disabled}
          className="game-input flex-1"
        />
        <button
          type="submit"
          disabled={disabled || !guess.trim()}
          className="game-button"
        >
          Guess
        </button>
      </div>
    </form>
  );
}
