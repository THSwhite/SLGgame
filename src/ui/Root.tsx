import { useEffect, useReducer, useState } from 'react';
import { GameController, randomSeed } from '../client/controller';
import { defaultServerUrl, NetClient } from '../client/net';
import { BALANCE } from '../sim/data';
import { MAX_PLAYERS } from '../net/protocol';
import { Game } from './App';
import { audio } from '../client/audio';
import { createTutorialController } from '../client/tutorial';

type Screen =
  | { kind: 'menu' }
  | { kind: 'single'; controller: GameController }
  | { kind: 'lobby'; client: NetClient }
  | { kind: 'net'; client: NetClient };

function loadName(): string {
  try {
    return localStorage.getItem('slg.name') ?? '';
  } catch {
    return '';
  }
}
function saveName(name: string) {
  try {
    localStorage.setItem('slg.name', name);
  } catch {
    /* storage unavailable */
  }
}

export function Root() {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });

  if (screen.kind === 'single') return <Game controller={screen.controller} onExit={() => setScreen({ kind: 'menu' })} />;
  if (screen.kind === 'net' && screen.client.controller) {
    return (
      <Game
        controller={screen.client.controller}
        onExit={() => {
          screen.client.close();
          setScreen({ kind: 'menu' });
        }}
      />
    );
  }
  if (screen.kind === 'lobby') {
    return (
      <Lobby
        client={screen.client}
        onStarted={() => setScreen({ kind: 'net', client: screen.client })}
        onBack={() => {
          screen.client.close();
          setScreen({ kind: 'menu' });
        }}
      />
    );
  }
  return (
    <Menu
      onSingle={() => {
        audio.unlock();
        setScreen({ kind: 'single', controller: new GameController({ seed: randomSeed() }) });
      }}
      onTutorial={() => {
        audio.unlock();
        const controller = createTutorialController();
        setScreen({ kind: 'single', controller });
      }}
      onOnline={(client) => setScreen({ kind: 'lobby', client })}
    />
  );
}

function Menu({ onSingle, onTutorial, onOnline }: { onSingle: () => void; onTutorial: () => void; onOnline: (c: NetClient) => void }) {
  const [name, setName] = useState(loadName);
  const [url, setUrl] = useState(defaultServerUrl);
  const [code, setCode] = useState('');
  const connect = (action: (c: NetClient) => void) => {
    saveName(name);
    audio.unlock();
    const c = new NetClient(url);
    action(c);
    onOnline(c);
  };
  return (
    <div className="menu">
      <div className="panel menu-panel">
        <h1>SLG 國戰</h1>
        <p className="hint">探索、經營、擴張國土，與其他國家建交或開戰。</p>
        <button className="big" onClick={onSingle}>
          單人遊戲（對 AI）
        </button>
        <button className="big tutorial-button" onClick={onTutorial}>
          🎓 新手教學
        </button>
        <h3>多人連線</h3>
        {import.meta.env.VITE_STATIC_DEMO ? (
          <p className="hint">這個線上試玩版只能玩單人遊戲和新手教學。多人連線需要自己架設伺服器（<code>npm run serve</code>，詳見 README）。</p>
        ) : (
        <>
        <label className="field">
          你的名字
          <input value={name} maxLength={16} placeholder="例如：北方王國" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          伺服器
          <input value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <div className="row">
          <button onClick={() => connect((c) => c.create(name))}>建立房間</button>
          <span className="join">
            <input value={code} placeholder="房號" inputMode="numeric" maxLength={4} onChange={(e) => setCode(e.target.value)} />
            <button disabled={code.trim().length !== 4} onClick={() => connect((c) => c.join(code, name))}>
              加入
            </button>
          </span>
        </div>
        <p className="hint">多人連線需要先啟動伺服器：<code>npm run server</code>（詳見 README）。</p>
        </>
        )}
      </div>
    </div>
  );
}

function Lobby({ client, onStarted, onBack }: { client: NetClient; onStarted: () => void; onBack: () => void }) {
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useEffect(() => client.subscribe(refresh), [client]);
  useEffect(() => {
    if (client.controller) onStarted();
  });
  const lobby = client.lobby;
  const host = client.isHost;
  return (
    <div className="menu">
      <div className="panel menu-panel">
        <h2>多人房間</h2>
        {client.status === 'connecting' && <p>連線中…</p>}
        {client.error && <p className="error">{client.error}</p>}
        {lobby && (
          <>
            <p>
              房號 <span className="room-code">{lobby.code}</span>
              <span className="hint">　把房號告訴朋友，讓他們加入</span>
            </p>
            <h3>
              玩家（{lobby.players.length}/{MAX_PLAYERS}）
            </h3>
            <ul className="lobby-players">
              {lobby.players.map((p) => (
                <li key={p.id}>
                  {p.name || '（未命名）'}
                  {p.id === lobby.host && <span className="tag">房主</span>}
                  {p.id === lobby.you && <span className="tag">你</span>}
                </li>
              ))}
            </ul>
            <div className="row">
              <span>AI 國家</span>
              <span className="speeds">
                {Array.from({ length: MAX_PLAYERS - lobby.players.length + 1 }, (_, n) => (
                  <button key={n} disabled={!host} className={lobby.options.aiCount === n ? 'active' : ''} onClick={() => client.setOptions({ aiCount: n })}>
                    {n}
                  </button>
                ))}
              </span>
            </div>
            <div className="row">
              <span>地圖大小</span>
              <span className="speeds">
                {Object.entries(BALANCE.mapSizes).map(([key, m]) => (
                  <button key={key} disabled={!host} className={lobby.options.mapSize === key ? 'active' : ''} onClick={() => client.setOptions({ mapSize: key })}>
                    {m.name}
                  </button>
                ))}
              </span>
            </div>
            <div className="row">
              <span>
                地圖種子 <code>{lobby.options.seed}</code>
              </span>
              <button disabled={!host} onClick={() => client.setOptions({ seed: randomSeed() })}>
                🎲
              </button>
            </div>
          </>
        )}
        <div className="row">
          <button onClick={onBack}>返回</button>
          {host ? (
            <button className="big" onClick={() => client.start()}>
              開始遊戲
            </button>
          ) : (
            lobby && <span className="hint">等待房主開始遊戲…</span>
          )}
        </div>
      </div>
    </div>
  );
}
