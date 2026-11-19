import { useState } from 'react';
import type { GameController } from '../client/controller';
import { POLICY_GROUPS, TECH_BRANCHES, TECHS } from '../sim/data';
import { researchPerMinute } from '../sim/economy';
import { researchBlocked, researchCost, researchName } from '../sim/systems/research';
import type { GameState } from '../sim/types';

const BRANCH_ICONS: Record<string, string> = {
  agriculture: '🌾',
  industry: '⚒',
  construction: '🏗',
  military: '⚔',
  society: '📜',
  navigation: '⚓',
};
const TIER_NAMES = ['', '第一階', '第二階', '第三階', '第四階', '第五階'];

/**
 * Research screen in the spirit of Hearts of Iron IV: one column per branch,
 * tiers top to bottom, each tech connected to the one it requires.
 */
export function ResearchPanel({ controller, state, onClose }: { controller: GameController; state: GameState; onClose: () => void }) {
  const [tab, setTab] = useState<'tech' | 'policy'>('tech');
  const me = state.players[controller.localPlayer];
  const current = me.currentResearch;
  const rate = researchPerMinute(state, me);
  const choose = (id: string | null) => controller.issue({ type: 'setResearch', player: me.id, research: id });
  const maxTier = Math.max(...Object.values(TECHS).map((t) => t.tier));

  const progress = current ? Math.min(1, me.researchPoints / researchCost(current)) : 0;

  return (
    <div className="panel research-panel">
      <div className="panel-title">
        研究
        <span className="tabs">
          <button className={tab === 'tech' ? 'active' : ''} onClick={() => setTab('tech')}>
            科技樹
          </button>
          <button className={tab === 'policy' ? 'active' : ''} onClick={() => setTab('policy')}>
            國策
          </button>
        </span>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="research-status">
        <span>
          研究點數 <b>{Math.floor(me.researchPoints)}</b>　產出 {rate.toFixed(1)} 點/分
          {rate === 0 && <span className="neg">（需要研究所和研究員）</span>}
        </span>
        <span>
          目前研究：{current ? <b>{researchName(current)}</b> : '無（點數會累積起來）'}
          {current && ` ${Math.floor(me.researchPoints)}/${researchCost(current)}`}
        </span>
        {current && (
          <div className="progress">
            <div className="bar" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>

      {tab === 'tech' ? (
        <div className="tech-tree" style={{ gridTemplateColumns: `56px repeat(${TECH_BRANCHES.length}, minmax(130px, 1fr))` }}>
          <div />
          {TECH_BRANCHES.map((b) => (
            <div key={b.id} className="branch-head">
              <span className="branch-icon">{BRANCH_ICONS[b.id] ?? '◆'}</span> {b.name}
            </div>
          ))}
          {Array.from({ length: maxTier }, (_, i) => i + 1).map((tier) => (
            <TierRow key={tier} tier={tier}>
              <div className="tier-label">{TIER_NAMES[tier] ?? `第${tier}階`}</div>
              {TECH_BRANCHES.map((b) => {
                const entry = Object.entries(TECHS).find(([, t]) => t.branch === b.id && t.tier === tier);
                if (!entry) return <div key={b.id} />;
                const [id, t] = entry;
                const done = me.researched.includes(id);
                const blocked = researchBlocked(me, id);
                const selected = current === id;
                const st = done ? 'done' : selected ? 'current' : blocked ? 'locked' : 'available';
                return (
                  <div key={b.id} className="tech-cell">
                    {tier > 1 && <div className={`connector ${done || selected || !blocked ? 'lit' : ''}`} />}
                    <button
                      className={`tech-node ${st}`}
                      disabled={done || st === 'locked'}
                      title={blocked && !done ? blocked : t.description}
                      onClick={() => choose(selected ? null : id)}
                    >
                      <span className="tech-name">{t.name}</span>
                      <span className="tech-cost">{done ? '✔' : `${t.cost} 點`}</span>
                      <span className="tech-desc">{t.description}</span>
                      {selected && (
                        <span className="tech-progress">
                          <span style={{ width: `${progress * 100}%` }} />
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </TierRow>
          ))}
        </div>
      ) : (
        <div className="policies">
          <div className="hint">國策每一類只能選一個，選定後不能更改。</div>
          {Object.entries(POLICY_GROUPS).map(([gid, g]) => (
            <div key={gid} className="policy-group">
              <div className="branch-head">{g.name}</div>
              <div className="policy-options">
                {Object.entries(g.options).map(([id, p]) => {
                  const done = me.policies.includes(id);
                  const blocked = researchBlocked(me, id);
                  const selected = current === id;
                  const st = done ? 'done' : selected ? 'current' : blocked ? 'locked' : 'available';
                  return (
                    <button
                      key={id}
                      className={`tech-node ${st}`}
                      disabled={done || st === 'locked'}
                      title={blocked && !done ? blocked : p.description}
                      onClick={() => choose(selected ? null : id)}
                    >
                      <span className="tech-name">{p.name}</span>
                      <span className="tech-cost">{done ? '✔ 已採用' : `${p.cost} 點`}</span>
                      <span className="tech-desc">{p.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="legend">
        <span className="dot done" /> 已完成 <span className="dot current" /> 研究中 <span className="dot available" /> 可研究{' '}
        <span className="dot locked" /> 需先完成上一項
      </div>
    </div>
  );
}

/** Grid rows are flattened into the parent grid; this keeps the JSX readable. */
function TierRow({ children }: { tier: number; children: React.ReactNode }) {
  return <>{children}</>;
}
