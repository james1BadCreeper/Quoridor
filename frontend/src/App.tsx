import React, { useCallback, useEffect, useState } from 'react';
import { api, type AiMeta, type GameView, type Move } from './api';
import Board from './components/Board';

type Tab = 'play' | 'replay';

export default function App() {
  const [tab, setTab] = useState<Tab>('play');
  const [ais, setAis] = useState<AiMeta[]>([]);
  const [p1type, setP1type] = useState<'human' | 'ai'>('human');
  const [p2type, setP2type] = useState<'human' | 'ai'>('ai');
  const [p1ai, setP1ai] = useState<string>('');
  const [p2ai, setP2ai] = useState<string>('');
  const [game, setGame] = useState<GameView | null>(null);
  const [wallDir, setWallDir] = useState<'h' | 'v'>('h');
  const [autoAi, setAutoAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [upName, setUpName] = useState('我的AI');

  // 回放
  const [recStates, setRecStates] = useState<any[]>([]);
  const [recMeta, setRecMeta] = useState<any>(null);
  const [step, setStep] = useState(0);

  const refreshAis = useCallback(async () => {
    try { setAis(await api.listAi()); } catch { /* 忽略 */ }
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
    setErr('');
    try {
      const rec = JSON.parse(await file.text());
      const res = await api.replay(rec);
      setRecStates(res.states);
      setRecMeta({ ...res.meta, winner: res.winner, totalMoves: res.totalMoves });
      setStep(0);
    } catch (e: any) { showErr(e); }
  }

  const st = game?.state;
  const curIsAi = st && game && game.playerTypes[st.currentPlayer] === 'ai';

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Quoridor 步步为营</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => setTab('play')} disabled={tab === 'play'}>对战</button>
        <button onClick={() => setTab('replay')} disabled={tab === 'replay'}>回放（导入棋谱 JSON）</button>
        <a href={api.exampleUrl} style={{ marginLeft: 'auto' }}><button>下载 C++ 示例 AI（zip）</button></a>
      </div>
      {err && <div style={{ color: '#fff', background: '#c62828', padding: 8, borderRadius: 4, marginBottom: 8 }}>{err}</div>}

      {tab === 'play' && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <h3>开局设置（人类 / AI 可任意组合）</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span>P1（红，先手）</span>
              <select value={p1type} onChange={(e) => setP1type(e.target.value as any)}>
                <option value="human">人类</option>
                <option value="ai">AI</option>
              </select>
              {p1type === 'ai' && (
                <select value={p1ai} onChange={(e) => setP1ai(e.target.value)}>
                  <option value="">选择AI…</option>
                  {ais.filter((a) => a.status === 'ready').map((a) => (
                    <option key={a.aiId} value={a.aiId}>{a.name}（{a.aiId.slice(0, 6)}）</option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span>P2（蓝，后手）</span>
              <select value={p2type} onChange={(e) => setP2type(e.target.value as any)}>
                <option value="human">人类</option>
                <option value="ai">AI</option>
              </select>
              {p2type === 'ai' && (
                <select value={p2ai} onChange={(e) => setP2ai(e.target.value)}>
                  <option value="">选择AI…</option>
                  {ais.filter((a) => a.status === 'ready').map((a) => (
                    <option key={a.aiId} value={a.aiId}>{a.name}（{a.aiId.slice(0, 6)}）</option>
                  ))}
                </select>
              )}
            </div>
            <button onClick={createGame}>开始新对局</button>
            <h3 style={{ marginTop: 16 }}>上传 AI（zip 内含 C++，实现 decide 函数）</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={upName} onChange={(e) => setUpName(e.target.value)} placeholder="AI 名称" />
              <input type="file" accept=".zip" onChange={(e) => onUpload(e.target.files?.[0])} />
            </div>
            <button onClick={refreshAis} style={{ marginTop: 6 }}>刷新 AI 列表</button>
            <ul>
              {ais.map((a) => (
                <li key={a.aiId}>{a.name} [{a.aiId.slice(0, 8)}] 状态:{a.status} 沙箱:{a.sandbox || '?'}
                  {a.error ? ` 错误:${a.error.slice(0, 120)}` : ''}</li>
              ))}
            </ul>
          </div>
          <div>
            {st && game ? (
              <>
                <div style={{ marginBottom: 8 }}>
                  {st.winner != null ? (
                    <b>🏆 {game.names[st.winner]}（P{st.winner + 1}）获胜！</b>
                  ) : (
                    <span>轮到 <b>{game.names[st.currentPlayer]}（P{st.currentPlayer + 1}{game.playerTypes[st.currentPlayer] === 'ai' ? '/AI' : '/人'}）</b>
                      ｜步数 {st.moveNumber}｜墙 P1:{st.wallsRemaining[0]} P2:{st.wallsRemaining[1]}</span>
                  )}
                </div>
                <Board state={st} wallDir={wallDir} interactive={st.winner == null && !curIsAi}
                  onPawn={doHumanPawn} onWall={doHumanWall} />
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => setWallDir(wallDir === 'h' ? 'v' : 'h')}>
                    墙朝向：{wallDir === 'h' ? '横墙 h' : '竖墙 v'}（点击切换）
                  </button>
                  <button onClick={doAi} disabled={busy || st.winner != null || !curIsAi}>
                    {busy ? '思考中…' : 'AI 走一步'}
                  </button>
                  <label><input type="checkbox" checked={autoAi} onChange={(e) => setAutoAi(e.target.checked)} /> AI 自动走</label>
                  <button onClick={exportRecord}>导出棋谱 JSON</button>
                </div>
                {game.history.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    最近：{JSON.stringify(game.history[game.history.length - 1])}
                    {game.aiSandbox && <span>（沙箱 {game.aiSandbox}）</span>}
                  </div>
                )}
              </>
            ) : <p>👈 先在左侧创建对局。人类点绿色格走子，切朝向后点墙槽放墙；AI 回合可手动或自动触发。</p>}
          </div>
        </div>
      )}

      {tab === 'replay' && (
        <div>
          <h3>棋谱回放</h3>
          <input type="file" accept=".json" onChange={(e) => loadReplayFile(e.target.files?.[0])} />
          {recStates.length > 0 && (
            <>
              <div style={{ margin: '8px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setStep(Math.max(0, step - 1))}>上一步</button>
                <button onClick={() => setStep(Math.min(recStates.length - 1, step + 1))}>下一步</button>
                <span>第 {step} / {recStates.length - 1} 步</span>
                {recMeta?.winner != null && <b>胜者 P{(recMeta.winner as number) + 1}</b>}
              </div>
              <Board state={recStates[step]} wallDir="h" interactive={false} onPawn={() => {}} onWall={() => {}} />
              <pre style={{ background: '#f5f5f5', padding: 8, fontSize: 12 }}>
                {JSON.stringify(recStates[step], null, 1)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
