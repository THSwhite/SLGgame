import { useEffect, useRef, useState } from 'react';
import type { GameController } from '../client/controller';
import { MAX_CHAT_LENGTH, type LogEntry } from '../client/log';
import { formatTime } from './describe';

const COLLAPSED_LINES = 6;

/**
 * Bottom-left message box: events as "[事件] …", chat as "[國家名] …".
 * Enter opens the full history with an input; Enter sends, Esc / empty Enter closes.
 */
export function ChatLog({ controller }: { controller: GameController }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const s = controller.state;
  controller.log.sync(s, controller.localPlayer);
  const entries = controller.log.entries;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || open) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [open, entries.length]);

  const close = () => {
    setText('');
    setOpen(false);
  };

  const line = (e: LogEntry) => {
    const nation = e.kind === 'chat' && e.from !== undefined ? s.players[e.from] : null;
    return (
      <div key={e.id} className={`log-line log-${e.kind}`}>
        <span className="time">{formatTime(e.tick)}</span>{' '}
        {nation ? (
          <span className="tag-nation" style={{ color: nation.color }}>
            [{nation.name}]
          </span>
        ) : (
          <span className="tag-event">[事件]</span>
        )}{' '}
        {e.text}
      </div>
    );
  };

  if (!open) {
    const recent = entries.slice(-COLLAPSED_LINES);
    return (
      <div className="panel events" onClick={() => setOpen(true)} title="按 Enter 查看歷史與輸入訊息">
        {recent.length === 0 ? <div className="hint">按 Enter 輸入訊息</div> : recent.map(line)}
      </div>
    );
  }

  return (
    <div className="panel events open">
      <div className="panel-title">
        訊息與事件歷史 <small>{entries.length} 則</small>
        <button onClick={close}>✕</button>
      </div>
      <div className="log-list" ref={list}>
        {entries.length === 0 ? <div className="hint">還沒有任何事件</div> : entries.map(line)}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return close();
          controller.sendChat(text);
          setText('');
        }}
      >
        <input
          ref={input}
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={controller.isNetwork ? '輸入訊息，Enter 送出給所有玩家（Esc 關閉）' : '輸入訊息，Enter 送出（Esc 關閉）'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
          }}
        />
      </form>
    </div>
  );
}
