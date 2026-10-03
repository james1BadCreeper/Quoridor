// 棋盘组件：9x9 格 + 墙槽点击放墙 + 高亮可走格
import React, { useMemo } from 'react';
import type { GameState, Move } from '../api';

interface Props {
  state: GameState;
  wallDir: 'h' | 'v';
  interactive: boolean;
  onPawn: (r: number, c: number) => void;
  onWall: (r: number, c: number) => void;
}

const CELL = 46;
const GAP = 10;

function wallSet(walls: { r: number; c: number; dir: string }[]) {
  const s = new Set<string>();
  for (const w of walls) s.add(`${w.r},${w.c},${w.dir}`);
  return s;
}

export default function Board({ state, wallDir, interactive, onPawn, onWall }: Props) {
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
  const placed = useMemo(() => wallSet(state.walls), [state]);

  const xy = (r: number, c: number) => ({ x: c * (CELL + GAP), y: r * (CELL + GAP) });

  const renderCells = () => {
    const els: React.ReactNode[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const { x, y } = xy(r, c);
        const isT = targets.has(`${r},${c}`);
        els.push(
          <g key={`c${r}-${c}`}>
            <rect
              x={x} y={y} width={CELL} height={CELL} rx={4}
              fill={isT ? '#d9f2d0' : '#f0e6d2'}
              stroke="#8b6f47" strokeWidth={1}
              style={{ cursor: interactive && isT ? 'pointer' : 'default' }}
              onClick={() => { if (interactive && isT) onPawn(r, c); }}
            />
            {isT && interactive && <circle cx={x + CELL / 2} cy={y + CELL / 2} r={7} fill="#4caf50" opacity={0.75} />}
          </g>
        );
      }
    }
    return els;
  };

  // 已放置的墙：横墙占两格宽，竖墙占两格高
  const renderPlacedWalls = () => {
    const els: React.ReactNode[] = [];
    for (const w of state.walls) {
      if (w.dir === 'h') {
        const { x, y } = xy(w.r, w.c);
        els.push(
          <rect key={`w${w.r}-${w.c}-h`} x={x} y={y + CELL} width={CELL * 2 + GAP} height={GAP}
            fill="#7b4b2a" rx={2} />
        );
      } else {
        const { x, y } = xy(w.r, w.c);
        els.push(
          <rect key={`w${w.r}-${w.c}-v`} x={x + CELL} y={y} width={GAP} height={CELL * 2 + GAP}
            fill="#37474f" rx={2} />
        );
      }
    }
    return els;
  };

  // 可点击的墙槽（仅当前朝向、合法才高亮）
  const renderWallSlots = () => {
    if (!interactive) return null;
    const els: React.ReactNode[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const key = `${r},${c},${wallDir}`;
        if (placed.has(key)) continue;
        const ok = legalWall.has(key);
        if (wallDir === 'h') {
          const { x, y } = xy(r, c);
          els.push(
            <rect key={`s${key}`} x={x} y={y + CELL} width={CELL * 2 + GAP} height={GAP}
              fill={ok ? '#c89b6a' : '#e8e0d0'} opacity={ok ? 0.85 : 0.35} rx={2}
              style={{ cursor: ok ? 'pointer' : 'not-allowed' }}
              onClick={() => { if (ok) onWall(r, c); }}>
              <title>{ok ? `放横墙 (${r},${c})` : `非法 (${r},${c})`}</title>
            </rect>
          );
        } else {
          const { x, y } = xy(r, c);
          els.push(
            <rect key={`s${key}`} x={x + CELL} y={y} width={GAP} height={CELL * 2 + GAP}
              fill={ok ? '#78909c' : '#e8e0d0'} opacity={ok ? 0.85 : 0.35} rx={2}
              style={{ cursor: ok ? 'pointer' : 'not-allowed' }}
              onClick={() => { if (ok) onWall(r, c); }}>
              <title>{ok ? `放竖墙 (${r},${c})` : `非法 (${r},${c})`}</title>
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
      return (
        <g key={`p${i}`}>
          <circle cx={x + CELL / 2} cy={y + CELL / 2} r={15}
            fill={i === 0 ? '#e53935' : '#1e88e5'}
            stroke={isTurn ? '#ffeb3b' : '#333'} strokeWidth={isTurn ? 3 : 1.5} />
          <text x={x + CELL / 2} y={y + CELL / 2 + 5} textAnchor="middle"
            fill="#fff" fontSize={14} fontWeight="bold">P{i + 1}</text>
        </g>
      );
    });
  };

  return (
    <svg width={size} height={size} style={{ background: '#cbb98f', borderRadius: 8, padding: 0 }}>
      {renderCells()}
      {renderWallSlots()}
      {renderPlacedWalls()}
      {renderPawns()}
    </svg>
  );
}
