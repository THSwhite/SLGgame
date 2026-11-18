import { useEffect, useReducer, useRef, useState } from 'react';
import { audio, type Sfx } from '../client/audio';
import type { GameController } from '../client/controller';
import type { Command } from '../sim/commands';
import type { RelationStatus } from '../sim/types';

/** Commands that are settings rather than orders: no click sound. */
const QUIET = new Set<Command['type']>(['setManagement', 'setResearch', 'chooseStart', 'playerLeft']);

/**
 * Wires sound into a running game: music (peace/war mood), a click for every
 * order, and diplomacy sounds both for our own actions and for what others do to us.
 */
export function useGameAudio(controller: GameController) {
  const lastLocal = useRef<{ sfx: Sfx; at: number } | null>(null);

  useEffect(() => {
    audio.unlock();
    const play = (sfx: Sfx) => {
      lastLocal.current = { sfx, at: performance.now() };
      audio.play(sfx);
    };
    controller.onIssue = (cmd, error) => {
      if (error) return audio.play('error');
      if (cmd.type === 'diplomacy') {
        if (cmd.action === 'declareWar') play('war');
        else if (cmd.action === 'breakRelations') play('break');
        else audio.play('command');
      } else if (!QUIET.has(cmd.type)) {
        audio.play('command');
      }
    };

    // Watch relation changes caused by others (AI declares war, deadline break-up, alliance).
    let previous = new Map<string, RelationStatus>();
    const timer = setInterval(() => {
      const s = controller.state;
      const me = controller.localPlayer;
      const now = new Map<string, RelationStatus>();
      for (const r of s.relations) if (r.a === me || r.b === me) now.set(`${r.a}-${r.b}`, r.status);
      for (const [key, status] of now) {
        const before = previous.get(key);
        if (before === undefined || before === status) continue;
        let sfx: Sfx | null = null;
        if (status === 'war') sfx = 'war';
        else if (status === 'allied') sfx = 'alliance';
        else if (status === 'none' && (before === 'establishing' || before === 'allied')) sfx = 'break';
        const recent = lastLocal.current && lastLocal.current.sfx === sfx && performance.now() - lastLocal.current.at < 2000;
        if (sfx && !recent) audio.play(sfx);
      }
      previous = now;
      audio.setMood(s.players[me]?.atWar ? 'war' : 'peace');
    }, 250);

    return () => {
      controller.onIssue = null;
      clearInterval(timer);
      audio.stopMusic();
    };
  }, [controller]);
}

export function SoundButton() {
  const [open, setOpen] = useState(false);
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = audio.subscribe(refresh);
    return () => {
      off();
    };
  }, []);
  const s = audio.settings;
  return (
    <span className="sound">
      <button title="聲音設定" onClick={() => setOpen((x) => !x)}>
        {s.muted ? '🔇' : '🔊'}
      </button>
      {open && (
        <div className="panel sound-panel">
          <label className="check">
            <input type="checkbox" checked={s.muted} onChange={(e) => audio.update({ muted: e.target.checked })} />
            靜音
          </label>
          <label className="slider">
            音樂 {Math.round(s.music * 100)}%
            <input type="range" min={0} max={1} step={0.05} value={s.music} onChange={(e) => audio.update({ music: Number(e.target.value) })} />
          </label>
          <label className="slider">
            音效 {Math.round(s.sfx * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.sfx}
              onChange={(e) => {
                audio.update({ sfx: Number(e.target.value) });
                audio.play('command');
              }}
            />
          </label>
          <div className="hint">音樂：OpenGameArt.org 的 CC0 作品（見 public/audio/CREDITS.md）</div>
        </div>
      )}
    </span>
  );
}
