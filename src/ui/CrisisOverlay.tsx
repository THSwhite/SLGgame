import type { GameController } from '../client/controller';
import { BALANCE } from '../sim/data';
import { keepsVillager, riseCandidate } from '../sim/systems/crisis';
import type { GameState } from '../sim/types';

/** Shown when our last capital fell but branch cities remain: surrender or rise again. */
export function CrisisOverlay({ controller, state }: { controller: GameController; state: GameState }) {
  const me = state.players[controller.localPlayer];
  const crisis = me.capitalCrisis;
  if (!crisis) return null;
  const seconds = Math.max(0, Math.ceil((crisis.deadline - state.tick) / BALANCE.ticksPerSecond));
  const city = riseCandidate(state, me);
  const mine = state.villagers.filter((v) => v.owner === me.id);
  const kept = mine.filter((v) => keepsVillager(state, me.id, v.tile)).length;
  const conqueror = state.players[crisis.by];
  const decide = (choice: 'rise' | 'surrender') => controller.issue({ type: 'capitalDecision', player: me.id, choice });
  const byDefault = BALANCE.capitalFall.defaultChoice === 'rise' ? '再起' : '投降';
  return (
    <div className="end-overlay">
      <div className="panel end-panel crisis">
        <h2 className="neg">👑 主城陷落！</h2>
        <p>
          主城被 <b style={{ color: conqueror.color }}>{conqueror.name}</b> 攻陷了。請在 <b>{seconds}</b> 秒內做出決定（時間到會自動{byDefault}）。
        </p>
        <div className="crisis-options">
          <div className="crisis-option">
            <button className="big" disabled={!city} onClick={() => decide('rise')}>
              再起
            </button>
            <div className="hint">
              {city ? (
                <>
                  人口最多的分城成為新主城（生命上限只有原本的 {Math.round(BALANCE.capitalFall.riseHpShare * 100)}%）。
                  分城領地內的 {kept} 位人口會留下；其餘 {mine.length - kept} 位會歸 {conqueror.name}。
                </>
              ) : (
                '沒有可以再起的分城'
              )}
            </div>
          </div>
          <div className="crisis-option">
            <button onClick={() => decide('surrender')}>投降</button>
            <div className="hint">整個國家（所有建築、人口與資源）併入 {conqueror.name}，遊戲結束。</div>
          </div>
        </div>
      </div>
    </div>
  );
}
