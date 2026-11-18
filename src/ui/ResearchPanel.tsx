import type { GameController } from '../client/controller';
import { POLICY_GROUPS, TECHS } from '../sim/data';
import { researchPerMinute } from '../sim/economy';
import { researchBlocked, researchCost, researchName } from '../sim/systems/research';
import type { GameState } from '../sim/types';

export function ResearchPanel({ controller, state, onClose }: { controller: GameController; state: GameState; onClose: () => void }) {
  const me = state.players[controller.localPlayer];
  const current = me.currentResearch;
  const rate = researchPerMinute(state, me);
  const choose = (id: string | null) => controller.issue({ type: 'setResearch', player: me.id, research: id });

  const item = (id: string, name: string, description: string, done: boolean) => {
    const blocked = researchBlocked(me, id);
    const selected = current === id;
    return (
      <div key={id} className={`research-item ${done ? 'done' : ''} ${selected ? 'selected' : ''}`}>
        <div className="research-head">
          <b>{name}</b>
          <span className="cost">{done ? '✔ 完成' : `${researchCost(id)} 點`}</span>
        </div>
        <div className="hint">{description}</div>
        {!done && (
          <div className="research-actions">
            {selected ? (
              <button onClick={() => choose(null)}>取消</button>
            ) : (
              <button disabled={blocked !== null} onClick={() => choose(id)}>
                研究
              </button>
            )}
            {blocked && <span className="reason">{blocked}</span>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="panel research-panel">
      <div className="panel-title">
        研究
        <button onClick={onClose}>✕</button>
      </div>
      <div>
        研究點數 <b>{Math.floor(me.researchPoints)}</b>　產出 {rate.toFixed(1)} 點/分
        {rate === 0 && <span className="neg">（需要研究所和研究員）</span>}
      </div>
      <div>
        目前研究：
        {current ? (
          <>
            <b>{researchName(current)}</b>（{Math.floor(me.researchPoints)}/{researchCost(current)}）
            <div className="progress">
              <div className="bar" style={{ width: `${Math.min(1, me.researchPoints / researchCost(current)) * 100}%` }} />
            </div>
          </>
        ) : (
          '無（點數會累積起來）'
        )}
      </div>
      <h3>科技樹</h3>
      <div className="research-grid">
        {Object.entries(TECHS).map(([id, t]) => item(id, t.name, t.description, me.researched.includes(id)))}
      </div>
      <h3>國策（每一類只能選一個）</h3>
      {Object.entries(POLICY_GROUPS).map(([gid, g]) => (
        <div key={gid}>
          <div className="group-name">{g.name}</div>
          <div className="research-grid">
            {Object.entries(g.options).map(([id, p]) => item(id, p.name, p.description, me.policies.includes(id)))}
          </div>
        </div>
      ))}
    </div>
  );
}
