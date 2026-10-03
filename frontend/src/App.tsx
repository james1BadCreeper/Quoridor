import React, { useCallback, useEffect, useState } from 'react';
import { api, type AiMeta, type GameView, type Move } from './api';
import Board from './components/Board';

type Tab = 'play' | 'replay';

function WallPips({ left, player }: { left: number; player: number }) {
  return (
    <span className="pwalls" title={`剩余 ${left} 堵墙`}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < left ? (player === 0 ? 'on0' : 'on1') : undefined} />
      ))}
    </span>
  );
}

function PlayerCard({ idx, name, tag, wallsLeft, isTurn }: {
  idx: number; name: string; tag: string; wallsLeft: number; isTurn: boolean;
}) {
  return (
    <div className={`pcard ${isTurn ? (idx === 0 ? 'turn0' : 'turn1') : ''}`}>
      <span className={`pdot p${idx}`} />
      <span className="pname">{name}</span>
      <span className="pbadge">P{idx + 1} · {tag}</span>
      <WallPips left={wallsLeft} player={idx} />
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('play');
  const [ais, setAis] = useState<AiMeta[]>([]);
  const [p1type, setP1type] = useState<'human' | 'ai'>('human');
  const [p2type, setP2type] = useState<'human' | 'ai'>('ai');
  const [p1ai, setP1ai] = useState<string>('');
  const [p2ai, setP2ai] = useState<string>('');
  const [game, setGame] = useState<GameView | null>(null);
  const [wallDir, setWallDir] = useState<'h' | 'v'>('h');
  const [mode, setMode] = useState<'pawn' | 'wall'>('pawn');
  const [autoAi, setAutoAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [upName, setUpName] = useState('我的AI');

  // 回放
  const [recStates, setRecStates] = useState<any[]>([]);
  const [recMoves, setRecMoves] = useState<{ player: number; move: Move }[]>([]);
  const [recMeta, setRecMeta] = useState<any>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);

  const refreshAis = useCallback(async () => {
    try { setAis(await api.listAi()); } catch { /* 后端未启动时忽略 */ }
  }, []);

  useEffect(() => { refreshAis(); }, [refreshAis]);

  const showErr = (e: any) => setErr(e?.message || String(e));

  async function createGame() {
    setErr('');
    try {
      const g = await api.createGame(
        [p1type, p2type],
        [p1type === 'ai' ? p1ai || null : null, p2type === 'ai' ? p2ai || null : null],
      );
      setGame(g);
    } catch (e: any) { showErr(e); }
  }

  async function doHumanPawn(r: number, c: number) {
    if (!game || busy) return;
    setErr(''); setBusy(true);
    try {
      const g = await api.humanMove(game.gameId, { type: 'move', to: { r, c } } as Move);
      setGame(g);
    } catch (e: any) { showErr(e); } finally { setBusy(false); }
  }

  async function doHumanWall(r: number, c: number) {
    if (!game || busy) return;
    setErr(''); setBusy(true);
    try {
      const g = await api.humanMove(game.gameId, { type: 'wall', at: { r, c, dir: wallDir } } as Move);
      setGame(g);
    } catch (e: any) { showErr(e); } finally { setBusy(false); }
  }

  const doAi = useCallback(async () => {
    if (!game || busy) return;
    setErr(''); setBusy(true);
    try {
      const g = await api.aiMove(game.gameId, 2.0);
      setGame(g);
    } catch (e: any) { showErr(e); } finally { setBusy(false); }
  }, [game, busy]);

  // AI 回合自动走
  useEffect(() => {
    if (!game || !autoAi || tab !== 'play') return;
    const st = game.state;
    if (st.winner != null) return;
    if (game.playerTypes[st.currentPlayer] === 'ai' && !busy) {
      const t = setTimeout(() => { doAi(); }, 400);
      return () => clearTimeout(t);
    }
  }, [game, autoAi, tab, busy, doAi]);

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setErr('');
    try {
      const m = await api.uploadAi(file, upName);
      if (m.status !== 'ready') throw new Error(m.error || '编译失败');
      await refreshAis();
    } catch (e: any) { showErr(e); }
  }

  function exportRecord() {
    if (!game) return;
    api.record(game.gameId).then((rec) => {
      const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `quoridor_${game.gameId}.json`;
      a.click();
    }).catch(showErr);
  }

  async function loadReplayFile(file: File | undefined) {
    if (!file) return;
    setErr(''); setPlaying(false);
    try {
      const rec = JSON.parse(await file.text());
      const res = await api.replay(rec);
      setRecStates(res.states);
      setRecMoves(rec.moves || []);
      setRecMeta({ ...res.meta, winner: res.winner, totalMoves: res.totalMoves });
      setStep(0);
    } catch (e: any) { showErr(e); }
  }

  // 回放自动播放
  useEffect(() => {
    if (!playing || recStates.length === 0) return;
    if (step >= recStates.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setStep((s) => Math.min(recStates.length - 1, s + 1)), 700);
    return () => clearTimeout(t);
  }, [playing, step, recStates.length]);

  const st = game?.state;
  const curIsAi = !!(st && game && game.playerTypes[st.currentPlayer] === 'ai');
  const aiOptions = ais.filter((a) => a.status === 'ready');

  return (
    <div className="qapp">
      <h1 className="qtitle">QUORIDOR · 步步为营</h1>
      <p className="qsub">React + FastAPI 全栈对战 · 支持人类 / 自上传 C++ AI · 棋谱导出与回放</p>
      <div className="qtabbar">
        <button className={tab === 'play' ? 'active' : ''} onClick={() => setTab('play')}>对战</button>
        <button className={tab === 'replay' ? 'active' : ''} onClick={() => setTab('replay')}>棋谱回放</button>
        <a href={api.exampleUrl} style={{ marginLeft: 'auto' }}><button>下载 C++ 示例 AI（zip）</button></a>
      </div>
      {err && <div className="qerr">{err}</div>}

      {tab === 'play' && (
        <div className="qlayout">
          <div className="qside">
            <div className="qcard">
              <h3>开局设置（人类 / AI 任意组合）</h3>
              <div className="qrow">
                <span className="pdot p0" /><span>P1 橙红·先手</span>
                <select value={p1type} onChange={(e) => setP1type(e.target.value as any)}>
                  <option value="human">人类</option>
                  <option value="ai">AI</option>
                </select>
                {p1type === 'ai' && (
                  <select value={p1ai} onChange={(e) => setP1ai(e.target.value)}>
                    <option value="">选择AI…</option>
                    {aiOptions.map((a) => (
                      <option key={a.aiId} value={a.aiId}>{a.name}（{a.aiId.slice(0, 6)}）</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="qrow">
                <span className="pdot p1" /><span>P2 青蓝·后手</span>
                <select value={p2type} onChange={(e) => setP2type(e.target.value as any)}>
                  <option value="human">人类</option>
                  <option value="ai">AI</option>
                </select>
                {p2type === 'ai' && (
                  <select value={p2ai} onChange={(e) => setP2ai(e.target.value)}>
                    <option value="">选择AI…</option>
                    {aiOptions.map((a) => (
                      <option key={a.aiId} value={a.aiId}>{a.name}（{a.aiId.slice(0, 6)}）</option>
                    ))}
                  </select>
                )}
              </div>
              <button className="primary" onClick={createGame}>开始新对局</button>
            </div>
            <div className="qcard">
              <h3>上传 AI（zip 内含 C++，实现 decide 函数）</h3>
              <div className="qrow">
                <input value={upName} onChange={(e) => setUpName(e.target.value)} placeholder="AI 名称" />
                <input type="file" accept=".zip" onChange={(e) => onUpload(e.target.files?.[0])} />
              </div>
              <button onClick={refreshAis}>刷新 AI 列表</button>
              <ul className="qailist">
                {ais.map((a) => (
                  <li key={a.aiId}>{a.name} [{a.aiId.slice(0, 8)}] {a.status} · {a.sandbox || '?'}
                    {a.error ? ` · ${a.error.slice(0, 100)}` : ''}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="qmain">
            {st && game ? (
              <>
                {st.winner != null ? (
                  <div className={`qwin w${st.winner}`}>🏆 {game.names[st.winner]}（P{st.winner + 1}）获胜！</div>
                ) : (
                  <div className="qcard" style={{ marginBottom: 10 }}>
                    <PlayerCard idx={0} name={game.names[0]} tag={game.playerTypes[0] === 'ai' ? 'AI' : '人类'}
                      wallsLeft={st.wallsRemaining[0]} isTurn={st.currentPlayer === 0} />
                    <PlayerCard idx={1} name={game.names[1]} tag={game.playerTypes[1] === 'ai' ? 'AI' : '人类'}
                      wallsLeft={st.wallsRemaining[1]} isTurn={st.currentPlayer === 1} />
                    <div className="qstatus"><span>第 {st.moveNumber} 步</span>
                      <span>· 轮到 <b>{game.names[st.currentPlayer]}</b>{busy ? '（思考中…）' : ''}</span></div>
                  </div>
                )}
                <div className="qboard-wrap">
                  <Board state={st} wallDir={wallDir} mode={mode} history={game.history}
                    interactive={st.winner == null && !curIsAi}
                    onPawn={doHumanPawn} onWall={doHumanWall} />
                </div>
                <div className="qlegend">
                  <span><span className="sw sw0" />P1 橙红墙</span>
                  <span><span className="sw sw1" />P2 青蓝墙</span>
                  <span>底线色条 = 各自进攻方向</span>
                </div>
                <div className="qbtns">
                  <span className="qseg">
                    <button className={mode === 'pawn' ? 'active' : ''} onClick={() => setMode('pawn')}>🚶 走子</button>
                    <button className={mode === 'wall' ? 'active' : ''} onClick={() => setMode('wall')}>🧱 放墙</button>
                  </span>
                  {mode === 'wall' && (
                    <button onClick={() => setWallDir(wallDir === 'h' ? 'v' : 'h')}>
                      朝向：{wallDir === 'h' ? '横墙 h' : '竖墙 v'}（点击切换）
                    </button>
                  )}
                  <button onClick={doAi} disabled={busy || st.winner != null || !curIsAi}>
                    {busy ? '思考中…' : 'AI 走一步'}
                  </button>
                  <label className="qhint"><input type="checkbox" checked={autoAi} onChange={(e) => setAutoAi(e.target.checked)} /> AI 自动走</label>
                  <button onClick={exportRecord}>导出棋谱 JSON</button>
                </div>
                {game.history.length > 0 && (
                  <div className="qhint" style={{ marginTop: 8 }}>
                    最近：{JSON.stringify(game.history[game.history.length - 1])}
                    {game.aiSandbox && <span>（沙箱 {game.aiSandbox}）</span>}
                  </div>
                )}
              </>
            ) : <p className="qhint">👈 先在左侧创建对局。人类回合先用「走子 / 放墙」切换操作模式，再点棋盘落子；AI 回合可手动或自动触发。</p>}
          </div>
        </div>
      )}

      {tab === 'replay' && (
        <div className="qcard">
          <h3>棋谱回放（导入导出的 JSON）</h3>
          <input type="file" accept=".json" onChange={(e) => loadReplayFile(e.target.files?.[0])} />
          {recStates.length > 0 && (
            <>
              <div className="qreplay-bar">
                <button onClick={() => { setPlaying(false); setStep(Math.max(0, step - 1)); }}>上一步</button>
                <button onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '播放'}</button>
                <button onClick={() => { setPlaying(false); setStep(Math.min(recStates.length - 1, step + 1)); }}>下一步</button>
                <input type="range" min={0} max={recStates.length - 1} value={step}
                  onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }} />
                <span>第 {step} / {recStates.length - 1} 步</span>
                {recMeta?.winner != null && <b>胜者 P{(recMeta.winner as number) + 1}</b>}
              </div>
              <div className="qboard-wrap">
                <Board state={recStates[step]} wallDir="h" mode="pawn" interactive={false}
                  history={recMoves.slice(0, step)} onPawn={() => {}} onWall={() => {}} />
              </div>
              <pre className="qjson">{JSON.stringify(recStates[step], null, 1)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
