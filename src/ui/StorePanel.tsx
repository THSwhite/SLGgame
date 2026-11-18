import { useState } from 'react';
import type { GameController } from '../client/controller';
import { BALANCE, BUILDINGS, RESOURCE_NAMES, RESOURCE_TYPES, type ResourceType } from '../sim/data';
import { storageCapacity, storesOf } from '../sim/storage';
import { hexDistance } from '../sim/hex';
import type { Building, GameState } from '../sim/types';

/** Contents of a capital / branch city / warehouse, plus a transport order form. */
export function StorePanel({ controller, state, b }: { controller: GameController; state: GameState; b: Building }) {
  const mine = b.owner === controller.localPlayer;
  const cap = storageCapacity(b);
  const [resource, setResource] = useState<ResourceType>('wood');
  const destinations = storesOf(state, b.owner).filter((x) => x.id !== b.id);
  const [to, setTo] = useState<number | null>(null);
  if (!b.store || b.progress < 1) return null;
  const visible = mine || state.players[controller.localPlayer].visible[b.tile];
  if (!visible) return null;

  const villager = state.villagers.find((v) => v.id === controller.selection.villager && v.owner === controller.localPlayer);
  const dest = destinations.find((x) => x.id === to) ?? destinations[0];
  return (
    <div className="store">
      <div className="hint">庫存（每種上限 {cap}）：</div>
      <div className="store-grid">
        {RESOURCE_TYPES.map((r) => (
          <div key={r} className={b.store![r] >= cap ? 'neg' : ''}>
            {RESOURCE_NAMES[r]} <b>{Math.floor(b.store![r])}</b>
            <div className="progress">
              <div className="bar" style={{ width: `${Math.min(1, b.store![r] / cap) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      {mine && villager && !villager.soldier && destinations.length > 0 && (
        <div className="transport">
          <span className="hint">派村民 #{villager.id} 運送：</span>
          <select value={resource} onChange={(e) => setResource(e.target.value as ResourceType)}>
            {RESOURCE_TYPES.map((r) => (
              <option key={r} value={r}>
                {RESOURCE_NAMES[r]}
              </option>
            ))}
          </select>
          <span>→</span>
          <select value={dest?.id} onChange={(e) => setTo(Number(e.target.value))}>
            {destinations.map((x) => (
              <option key={x.id} value={x.id}>
                {BUILDINGS[x.type].name}（{hexDistance(state, b.tile, x.tile)} 格）
              </option>
            ))}
          </select>
          <button
            disabled={!dest || b.store[resource] < 1}
            onClick={() =>
              dest &&
              controller.issue({
                type: 'transport',
                player: b.owner,
                villager: villager.id,
                from: b.id,
                to: dest.id,
                resource,
                amount: BALANCE.transport.carryCapacity,
              })
            }
          >
            運送 {Math.min(BALANCE.transport.carryCapacity, Math.floor(b.store[resource]))}
          </button>
          <div className="hint">運送途中被敵人殺死，貨物會被對方奪走。</div>
        </div>
      )}
    </div>
  );
}
