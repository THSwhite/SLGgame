import { useEffect } from 'react';
import type { GameController } from '../client/controller';

/** Step-by-step tutorial instructions (top centre). */
export function TutorialPanel({ controller, onFocus, onExit }: { controller: GameController; onFocus: (tile: number) => void; onExit: () => void }) {
  const t = controller.tutorial;
  useEffect(() => {
    if (!t) return;
    const id = setInterval(() => t.update(), 200);
    return () => clearInterval(id);
  }, [t]);
  if (!t) return null;
  const step = t.step;
  const total = t.steps.length;
  if (!step) {
    return (
      <div className="panel tutorial">
        <div className="panel-title">
          🎓 新手教學完成！
          <button onClick={onExit}>回到主選單</button>
        </div>
        <p>你已經學會採集、建造、研究、擴張、探索、外交與戰爭。現在可以開始一場正式的遊戲了。</p>
      </div>
    );
  }
  const done = t.completedAt !== null;
  const focus = step.focus?.(t);
  return (
    <div className="panel tutorial">
      <div className="panel-title">
        <span>
          🎓 新手教學 {t.index + 1}/{total}：{step.title}
        </span>
        <span className="tutorial-buttons">
          {focus !== undefined && focus !== null && <button onClick={() => onFocus(focus)}>帶我看</button>}
          <button onClick={() => t.next()} title="跳過這一步">
            跳過
          </button>
          <button onClick={onExit}>結束教學</button>
        </span>
      </div>
      <div className="progress">
        <div className="bar" style={{ width: `${((t.index + (done ? 1 : 0)) / total) * 100}%` }} />
      </div>
      {(typeof step.text === 'function' ? step.text(t) : step.text).map((line, i) => (
        <p key={i}>{line}</p>
      ))}
      {done ? <div className="pos">✔ 完成！</div> : <div className="hint">完成上面的操作後會自動進到下一步。</div>}
    </div>
  );
}
