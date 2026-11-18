import { useState } from 'react';
import { randomSeed, type GameController } from '../client/controller';
import { landShare, nationScore } from '../sim/systems/victory';
import type { GameState } from '../sim/types';
import { formatTime } from './describe';

const REASONS = {
  conquest: '征服勝利：其他國家都已滅亡',
  territory: '領土勝利：在期限內控制了足夠的土地',
  time: '時間到：領土最多的國家獲勝',
  defeat: '你的國家滅亡了',
};

export function EndOverlay({ controller, state }: { controller: GameController; state: GameState }) {
  const [hidden, setHidden] = useState(false);
  const r = state.result!;
  if (hidden) {
    return (
      <div className="panel end-mini">
        遊戲結束 <button onClick={() => setHidden(false)}>查看結果</button>
      </div>
    );
  }
  const won = r.winner === controller.localPlayer;
  const ranking = [...state.players].sort((a, b) => nationScore(state, b) - nationScore(state, a));
  return (
    <div className="end-overlay">
      <div className="panel end-panel">
        <h2 className={won ? 'pos' : 'neg'}>{won ? '🏆 勝利！' : r.reason === 'defeat' ? '💀 戰敗' : '遊戲結束'}</h2>
        <p>{REASONS[r.reason]}</p>
        {r.winner !== null && !won && <p>勝利者：{state.players[r.winner].name}</p>}
        <p className="hint">遊戲時間 {formatTime(r.tick)}</p>
        <table className="ranking">
          <thead>
            <tr>
              <th>國家</th>
              <th>國力</th>
              <th>人口</th>
              <th>領土</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((p) => (
              <tr key={p.id} className={p.eliminated ? 'eliminated' : ''}>
                <td>
                  <span className="swatch" style={{ background: p.color }} /> {p.name}
                  {p.eliminated && '（滅亡）'}
                </td>
                <td>{nationScore(state, p)}</td>
                <td>{state.villagers.filter((v) => v.owner === p.id).length}</td>
                <td>{(landShare(state, p) * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button onClick={() => controller.newGame({ seed: randomSeed() })}>再玩一局（新地圖）</button>
          <button onClick={() => controller.newGame({})}>同一張地圖再玩</button>
          <button onClick={() => setHidden(true)}>看看地圖</button>
        </div>
      </div>
    </div>
  );
}
