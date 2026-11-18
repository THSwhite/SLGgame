import type { GameController } from '../client/controller';
import type { DiplomacyAction } from '../sim/commands';
import { BALANCE } from '../sim/data';
import { consulateOf, getRelation, STATUS_NAMES, tradePerMinute } from '../sim/systems/diplomacy';
import type { GameState } from '../sim/types';
import { formatTime } from './describe';
import { landShare, nationScore, nextTerritoryStep, territoryThreshold } from '../sim/systems/victory';

export function pendingProposals(state: GameState, me: number): number {
  return state.relations.filter((r) => (r.a === me || r.b === me) && r.proposal && r.proposal.from !== me).length;
}

export function DiplomacyPanel({ controller, state, onClose }: { controller: GameController; state: GameState; onClose: () => void }) {
  const me = controller.localPlayer;
  const act = (target: number, action: DiplomacyAction) => controller.issue({ type: 'diplomacy', player: me, target, action });
  const others = state.players.filter((p) => p.id !== me);
  const trade = tradePerMinute(state, me);

  return (
    <div className="panel diplomacy-panel">
      <div className="panel-title">
        外交
        <button onClick={onClose}>✕</button>
      </div>
      <div className="hint">
        建交後，雙方要在 {BALANCE.diplomacy.consulateDeadlineSeconds} 秒內各自在對方國土內蓋好領事館（選村民 → 點對方國土 → 建造領事館），
        否則邦交破裂，並有 {BALANCE.diplomacy.cooldownSeconds} 秒冷卻期。領事館提供周圍視野。正式邦交帶來共享地圖探索（斷交後仍保留）、貿易收入與研究交流。攻擊別國前必須先宣戰。
        勝利條件：消滅所有國家；或領土達到門檻（{BALANCE.victory.territorySchedule.map((x) => `${x.minute} 分 ${Math.round(x.share * 100)}%`).join('、')}）；或 {BALANCE.victory.timeLimitMinutes} 分鐘時領土最多。
      </div>
      {others.length === 0 && <div className="hint">這局沒有其他國家。</div>}
      {others.map((p) => {
        const rel = getRelation(state, me, p.id);
        if (!rel.contact) {
          return (
            <div key={p.id} className="nation unknown">
              <span className="swatch" style={{ background: '#555' }} />
              <b>未知的國家</b>
              <span className="hint">尚未接觸</span>
            </div>
          );
        }
        const proposal = rel.proposal;
        const incoming = proposal && proposal.from === p.id;
        const outgoing = proposal && proposal.from === me;
        const mineThere = consulateOf(state, me, p.id);
        const theirsHere = consulateOf(state, p.id, me);
        const cooldown = rel.cooldownUntil > state.tick ? rel.cooldownUntil - state.tick : 0;
        return (
          <div key={p.id} className={`nation status-${rel.status}`}>
            <div className="nation-head">
              <span className="swatch" style={{ background: p.color }} />
              <b>{p.name}</b>
              {p.eliminated ? <span className="neg">已滅亡</span> : <span className="hint">國力 {nationScore(state, p)}</span>}
              <span className={`status-tag tag-${rel.status}`}>{STATUS_NAMES[rel.status]}</span>
            </div>
            {(rel.status === 'establishing' || rel.status === 'allied') && (
              <div>
                我方領事館：{mineThere ? (mineThere.progress >= 1 ? '✔ 已建立' : `建造中 ${Math.floor(mineThere.progress * 100)}%`) : '✘ 尚未建立'}
                {'　｜　'}對方領事館：{theirsHere ? (theirsHere.progress >= 1 ? '✔ 已建立' : '建造中') : '✘ 尚未建立'}
              </div>
            )}
            {rel.status === 'establishing' && (
              <div className="warn">剩餘期限 {formatTime(Math.max(0, rel.deadline - state.tick))}</div>
            )}
            {cooldown > 0 && rel.status === 'none' && <div className="hint">冷卻中 {formatTime(cooldown)}</div>}
            {incoming && (
              <div className="proposal">
                {p.name} {proposal!.kind === 'relations' ? '提議建立邦交' : '提議停戰'}（{formatTime(proposal!.expires - state.tick)} 內回覆）
                <div className="actions">
                  <button onClick={() => act(p.id, 'accept')}>接受</button>
                  <button onClick={() => act(p.id, 'reject')}>拒絕</button>
                </div>
              </div>
            )}
            {outgoing && <div className="hint">等待對方回覆提議…</div>}
            <div className="actions">
              {rel.status === 'none' && !proposal && (
                <button disabled={cooldown > 0} onClick={() => act(p.id, 'proposeRelations')}>
                  提議建交
                </button>
              )}
              {(rel.status === 'establishing' || rel.status === 'allied') && (
                <button onClick={() => act(p.id, 'breakRelations')}>斷交</button>
              )}
              {rel.status === 'war' && !proposal && <button onClick={() => act(p.id, 'proposePeace')}>提議停戰</button>}
              {rel.status !== 'war' && (
                <button
                  className="danger"
                  onClick={() => {
                    if (window.confirm(`確定要向 ${p.name} 宣戰嗎？`)) act(p.id, 'declareWar');
                  }}
                >
                  宣戰
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div className="hint">
        我的國力 {nationScore(state, state.players[me])}　領土 {(landShare(state, state.players[me]) * 100).toFixed(1)}%
        {(() => {
          const now = territoryThreshold(state);
          const next = nextTerritoryStep(state);
          if (now !== null) return `（目前 ${Math.round(now * 100)}% 即獲勝${next ? `；${next.minute} 分起降為 ${Math.round(next.share * 100)}%` : ''}）`;
          return next ? `（${next.minute} 分起，領土達 ${Math.round(next.share * 100)}% 即獲勝）` : '';
        })()}
      </div>
      {(trade.food > 0 || trade.wood > 0) && (
        <div className="hint">
          貿易收入：糧食 +{trade.food.toFixed(1)}/分、木材 +{trade.wood.toFixed(1)}/分、石材 +{trade.stone.toFixed(1)}/分
        </div>
      )}
    </div>
  );
}
