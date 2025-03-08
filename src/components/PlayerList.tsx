import { PlayerState } from "@/server/types";

interface PlayerListProps {
  players: PlayerState[];
  currentPlayerId?: string;
}

export function PlayerList({ players, currentPlayerId }: PlayerListProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">Players</h3>
      <div className="space-y-1">
        {players.map((player) => (
          <div
            key={player.id}
            className={`p-2 rounded-lg ${
              player.id === currentPlayerId
                ? "bg-blue-100 border border-blue-200"
                : "bg-gray-50 border border-gray-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{player.nickname}</span>
              <div className="flex gap-2">
                {player.isHost && (
                  <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                    Host
                  </span>
                )}
                {player.hasSetSecretWord && (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Ready
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
