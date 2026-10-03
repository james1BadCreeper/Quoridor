// 后端 API 封装
export interface Pos { r: number; c: number }
export interface WallPos { r: number; c: number; dir: 'h' | 'v'; by?: number }
export type Move = { type: 'move'; to: Pos } | { type: 'wall'; at: WallPos };

export interface GameState {
  boardSize: number;
  pawns: Pos[];
  walls: WallPos[];
  wallsRemaining: number[];
  currentPlayer: number;
  moveNumber: number;
  winner: number | null;
  legalMoves?: Move[];
}

export interface GameView {
  gameId: string;
  state: GameState;
  playerTypes: ('human' | 'ai')[];
  aiIds: (string | null)[];
  names: string[];
  history: { player: number; move: Move }[];
  aiMove?: Move;
  aiSandbox?: string;
}

export interface AiMeta {
  aiId: string;
  name: string;
  status: string;
  files: string[];
  sandbox?: string;
  error?: string | null;
}

const BASE = '';

async function req(path: string, init?: RequestInit) {
  const r = await fetch(BASE + path, init);
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error((data && (data.detail || data.message)) || `请求失败 ${r.status}`);
  return data;
}

export const api = {
  health: () => req('/api/health'),
  listAi: async (): Promise<AiMeta[]> => (await req('/api/ai/list')).ais,
  exampleUrl: '/api/ai/example/download',
  uploadAi: async (file: File, name: string): Promise<AiMeta> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    const r = await fetch('/api/ai/upload', { method: 'POST', body: fd });
    const t = await r.text();
    const d = t ? JSON.parse(t) : null;
    if (!r.ok) throw new Error(d?.detail || '上传失败');
    return d;
  },
  createGame: (playerTypes: string[], aiIds: (string | null)[], names?: string[]): Promise<GameView> =>
    req('/api/game/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerTypes, aiIds, names }),
    }),
  getGame: (gid: string): Promise<GameView> => req(`/api/game/${gid}`),
  humanMove: (gid: string, move: Move): Promise<GameView> =>
    req(`/api/game/${gid}/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ move }),
    }),
  aiMove: (gid: string, timeout = 2.0): Promise<GameView> =>
    req(`/api/game/${gid}/ai-move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout }),
    }),
  record: (gid: string) => req(`/api/game/${gid}/record`),
  replay: (record: any) =>
    req('/api/game/replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record }),
    }),
};
