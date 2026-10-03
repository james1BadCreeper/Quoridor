// 棋盘组件：深色主题，墙/棋子按玩家着色（P1 橙红 / P2 青蓝）
import React, { useMemo } from 'react';
import type { GameState, Move } from '../api';

interface HistItem { player: number; move: Move }

interface Props {
  state: GameState;
  wallDir: 'h' | 'v';
  interactive: boolean;
  /** 操作模式：pawn 只走子，wall 只放墙，避免两种目标同时可点造成误触 */
  mode: 'pawn' | 'wall';
  history?: HistItem[];
  onPawn: (r: number, c: number) => void;
  onWall: (r: number, c: number) => void;
}

const CELL = 46;
const GAP = 10;

const P0 = '#ff6b4a';
const P1 = '#38bdf8';

/** 墙的归属：优先 state 自带的 by，缺失时用 history 回填（兼容旧棋谱）。 */
function ownerOf(
  w: { r: number; c: number; dir: string; by?: number },
  histMap: Map<string, number>,
): number | null {
  if (w.by === 0 || w.by === 1) return w.by;
  const o = histMap.get(`${w.r},${w.c},${w.dir}`);
  return o === undefined ? null : o;
}

export default function Board({ state, wallDir, interactive, mode, history, onPawn, onWall }: Props) {
  const size = 9 * CELL + 8 * GAP;

  const targets = useMemo(() => {
    const t = new Set<string>();
    for (const m of state.legalMoves || []) {
      if (m.type === 'move') t.add(`${m.to.r},${m.to.c}`);
    }
    return t;
  }, [state]);

  const legalWall = useMemo(() => {
    const t = new Set<string>();
    for (const m of (state.legalMoves || []) as Move[]) {
      if (m.type === 'wall') t.add(`${m.at.r},${m.at.c},${m.at.dir}`);
    }
    return t;
  }, [state]);

  const histMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of history || []) {
      if (h.move.type === 'wall') m.set(`${h.move.at.r},${h.move.at.c},${h.move.at.dir}`, h.player);
    }
    return m;
  }, [history]);

  const placed = useMemo(() => {
    const s = new Set<string>();
    for (const w of state.walls) s.add(`${w.r},${w.c},${w.dir}`);
    return s;
  }, [state]);

  const xy = (r: number, c: number) => ({ x: c * (CELL + GAP), y: r * (CELL + GAP) });
  const cur = state.currentPlayer;

  const renderCells = () => {
    const els: React.ReactNode[] = [];
    // 放墙模式下不显示可走格，避免与墙槽误触
    const showMoves = interactive && mode === 'pawn';
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const { x, y } = xy(r, c);
        const isT = showMoves && targets.has(`${r},${c}`);
        // 两端底线行淡淡染上对应玩家色，提示进攻方向
        const goalTint = r === 0 ? P0 : r === 8 ? P1 : null;
        els.push(
          <g key={`c${r}-${c}`}>
            <rect
              x={x} y={y} width={CELL} height={CELL} rx={5}
              fill={(r + c) % 2 === 0 ? '#232f52' : '#28365c'}
              stroke={isT ? '#34d399' : '#3b4f7e'} strokeWidth={isT ? 2 : 1}
              style={{ cursor: isT ? 'pointer' : 'default' }}
              onClick={() => { if (isT) onPawn(r, c); }}
            />
            {goalTint && (
              <rect x={x} y={r === 0 ? y : y + CELL - 4} width={CELL} height={4}
                fill={goalTint} opacity={0.55} rx={2} pointerEvents="none" />
            )}
            {isT && (
              <circle className="move-dot" cx={x + CELL / 2} cy={y + CELL / 2} r={7}
                fill="#34d399" pointerEvents="none" />
            )}
          </g>
        );
      }
    }
    return els;
  };

  // 已放置的墙：按归属玩家着色，未知归属用灰
  const renderPlacedWalls = () => {
    const els: React.ReactNode[] = [];
    state.walls.forEach((w, i) => {
      const o = ownerOf(w, histMap);
      const fill = o === 0 ? 'url(#wall0)' : o === 1 ? 'url(#wall1)' : '#64748b';
      const glow = o === 0 ? P0 : o === 1 ? P1 : 'transparent';
      if (w.dir === 'h') {
        const { x, y } = xy(w.r, w.c);
        els.push(
          <g key={`w${i}`}>
            <rect x={x} y={y + CELL} width={CELL * 2 + GAP} height={GAP} fill={glow} opacity={0.35} rx={3} />
            <rect x={x} y={y + CELL} width={CELL * 2 + GAP} height={GAP} fill={fill} rx={3} />
          </g>
        );
      } else {
        const { x, y } = xy(w.r, w.c);
        els.push(
          <g key={`w${i}`}>
            <rect x={x + CELL} y={y} width={GAP} height={CELL * 2 + GAP} fill={glow} opacity={0.35} rx={3} />
            <rect x={x + CELL} y={y} width={GAP} height={CELL * 2 + GAP} fill={fill} rx={3} />
          </g>
        );
      }
    });
    return els;
  };

  // 可点击墙槽：仅放墙模式显示，用当前行棋方的颜色预览
  const renderWallSlots = () => {
    if (!interactive || mode !== 'wall') return null;
    const els: React.ReactNode[] = [];
    const slotFill = cur === 0 ? P0 : P1;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const key = `${r},${c},${wallDir}`;
        if (placed.has(key)) continue;
        const ok = legalWall.has(key);
        if (!ok) continue; // 非法槽位直接不渲染，棋盘更干净
        if (wallDir === 'h') {
          const { x, y } = xy(r, c);
          els.push(
            <rect key={`s${key}`} className="wall-slot ok"
              x={x} y={y + CELL} width={CELL * 2 + GAP} height={GAP}
              fill={slotFill} opacity={0.45} rx={3}
              style={{ cursor: 'pointer' }}
              onClick={() => onWall(r, c)}>
              <title>{`放${cur === 0 ? '橙红' : '青蓝'}横墙 (${r},${c})`}</title>
            </rect>
          );
        } else {
          const { x, y } = xy(r, c);
          els.push(
            <rect key={`s${key}`} className="wall-slot ok"
              x={x + CELL} y={y} width={GAP} height={CELL * 2 + GAP}
              fill={slotFill} opacity={0.45} rx={3}
              style={{ cursor: 'pointer' }}
              onClick={() => onWall(r, c)}>
              <title>{`放${cur === 0 ? '橙红' : '青蓝'}竖墙 (${r},${c})`}</title>
            </rect>
          );
        }
      }
    }
    return els;
  };

  const renderPawns = () => {
    return state.pawns.map((p, i) => {
      const { x, y } = xy(p.r, p.c);
      const isTurn = state.winner == null && state.currentPlayer === i;
      const cx = x + CELL / 2, cy = y + CELL / 2;
      return (
        <g key={`p${i}`}>
          {isTurn && (
            <circle className="turn-ring" cx={cx} cy={cy} r={21}
              fill="none" stroke={i === 0 ? P0 : P1} strokeWidth={3} pointerEvents="none" />
          )}
          <circle cx={cx} cy={cy} r={15} fill={`url(#pawn${i})`}
            stroke={isTurn ? '#ffffff' : '#0b1020'} strokeWidth={isTurn ? 2.5 : 1.5} />
          <text x={cx} y={cy + 5} textAnchor="middle"
            fill="#fff" fontSize={13} fontWeight="bold">P{i + 1}</text>
        </g>
      );
    });
  };

  return (
    <svg className="qboard" width={size} height={size}>
      <defs>
        <radialGradient id="pawn0" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#ffc4b0" />
          <stop offset="60%" stopColor={P0} />
          <stop offset="100%" stopColor="#c2410c" />
        </radialGradient>
        <radialGradient id="pawn1" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#c9ecff" />
          <stop offset="60%" stopColor={P1} />
          <stop offset="100%" stopColor="#0369a1" />
        </radialGradient>
        <linearGradient id="wall0" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ff6b4a" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
        <linearGradient id="wall1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0369a1" />
        </linearGradient>
      </defs>
      {renderCells()}
      {renderWallSlots()}
      {renderPlacedWalls()}
      {renderPawns()}
    </svg>
  );
}
