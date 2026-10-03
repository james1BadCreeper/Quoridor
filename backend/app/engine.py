"""Quoridor 规则引擎：棋盘 9x9，双人对战。"""
from __future__ import annotations

from collections import deque
from copy import deepcopy
from dataclasses import dataclass, field

BOARD_SIZE = 9
WALL_RANGE = 8  # 墙坐标 0..7
INIT_WALLS = 10


@dataclass
class Pos:
    r: int
    c: int

    def to_dict(self):
        return {"r": self.r, "c": self.c}

    @staticmethod
    def from_dict(d):
        return Pos(r=int(d["r"]), c=int(d["c"]))


@dataclass
class Wall:
    r: int
    c: int
    dir: str  # 'h' | 'v'

    def to_dict(self):
        return {"r": self.r, "c": self.c, "dir": self.dir}

    @staticmethod
    def from_dict(d):
        return Wall(r=int(d["r"]), c=int(d["c"]), dir=str(d["dir"]))


@dataclass
class GameState:
    pawns: list[Pos] = field(default_factory=lambda: [Pos(8, 4), Pos(0, 4)])
    walls: list[Wall] = field(default_factory=list)
    walls_remaining: list[int] = field(default_factory=lambda: [INIT_WALLS, INIT_WALLS])
    current_player: int = 0
    move_number: int = 0
    winner: int | None = None

    def to_dict(self, include_legal: bool = True):
        d = {
            "boardSize": BOARD_SIZE,
            "pawns": [p.to_dict() for p in self.pawns],
            "walls": [w.to_dict() for w in self.walls],
            "wallsRemaining": list(self.walls_remaining),
            "currentPlayer": self.current_player,
            "moveNumber": self.move_number,
            "winner": self.winner,
        }
        if include_legal and self.winner is None:
            d["legalMoves"] = [move_to_dict(m) for m in legal_moves(self)]
        return d

    @staticmethod
    def from_dict(d):
        pawns = [Pos.from_dict(p) for p in d.get("pawns", [{"r": 8, "c": 4}, {"r": 0, "c": 4}])]
        walls = [Wall.from_dict(w) for w in d.get("walls", [])]
        wr = list(d.get("wallsRemaining", [INIT_WALLS, INIT_WALLS]))
        return GameState(
            pawns=pawns,
            walls=walls,
            walls_remaining=wr,
            current_player=int(d.get("currentPlayer", 0)),
            move_number=int(d.get("moveNumber", 0)),
            winner=d.get("winner"),
        )


def move_to_dict(m) -> dict:
    if m["type"] == "move":
        return {"type": "move", "to": m["to"].to_dict() if isinstance(m["to"], Pos) else m["to"]}
    return {"type": "wall", "at": m["at"].to_dict() if isinstance(m["at"], Wall) else m["at"]}


def parse_move(d: dict):
    """把前端/AI 传来的 json 转为内部表示，抛 ValueError 说明非法格式。"""
    t = d.get("type")
    if t == "move":
        to = d.get("to")
        if to is None:
            raise ValueError("缺少 to 字段")
        r, c = int(to["r"]), int(to["c"])
        if not (0 <= r < BOARD_SIZE and 0 <= c < BOARD_SIZE):
            raise ValueError("目标越界")
        return {"type": "move", "to": Pos(r, c)}
    if t == "wall":
        at = d.get("at")
        if at is None:
            raise ValueError("缺少 at 字段")
        r, c, direction = int(at["r"]), int(at["c"]), str(at["dir"])
        if direction not in ("h", "v"):
            raise ValueError("墙方向必须是 h/v")
        if not (0 <= r < WALL_RANGE and 0 <= c < WALL_RANGE):
            raise ValueError("墙坐标越界(0..7)")
        return {"type": "wall", "at": Wall(r, c, direction)}
    raise ValueError("move.type 必须是 move/wall")


def _blocked_edges(state: GameState):
    """返回被墙挡住的相邻移动：集合 ((r1,c1),(r2,c2)) 无序对。"""
    blocked = set()
    for w in state.walls:
        if w.dir == "h":
            # 挡住 (r,c)->(r+1,c) 与 (r,c+1)->(r+1,c+1)
            a, b = (w.r, w.c), (w.r + 1, w.c)
            blocked.add((a, b))
            blocked.add((b, a))
            a, b = (w.r, w.c + 1), (w.r + 1, w.c + 1)
            blocked.add((a, b))
            blocked.add((b, a))
        else:
            a, b = (w.r, w.c), (w.r, w.c + 1)
            blocked.add((a, b))
            blocked.add((b, a))
            a, b = (w.r + 1, w.c), (w.r + 1, w.c + 1)
            blocked.add((a, b))
            blocked.add((b, a))
    return blocked


def _neighbors(pos: Pos, blocked: set) -> list[Pos]:
    out = []
    for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        nr, nc = pos.r + dr, pos.c + dc
        if 0 <= nr < BOARD_SIZE and 0 <= nc < BOARD_SIZE:
            if ((pos.r, pos.c), (nr, nc)) not in blocked:
                out.append(Pos(nr, nc))
    return out


def bfs_distance(state: GameState, player: int) -> int | None:
    """到对方底线的最短步数（忽略对方棋子），不可达返回 None。"""
    blocked = _blocked_edges(state)
    goal = 0 if player == 0 else BOARD_SIZE - 1
    start = state.pawns[player]
    if (player == 0 and start.r == 0) or (player == 1 and start.r == BOARD_SIZE - 1):
        return 0
    dist = { (start.r, start.c): 0 }
    q = deque([start])
    while q:
        cur = q.popleft()
        for nb in _neighbors(cur, blocked):
            if (nb.r, nb.c) not in dist:
                if (player == 0 and nb.r == 0) or (player == 1 and nb.r == BOARD_SIZE - 1):
                    return dist[(cur.r, cur.c)] + 1
                dist[(nb.r, nb.c)] = dist[(cur.r, cur.c)] + 1
                q.append(nb)
    return None


def has_path(state: GameState, player: int) -> bool:
    return bfs_distance(state, player) is not None


def pawn_moves(state: GameState, player: int | None = None) -> list[dict]:
    """生成走子合法移动（含跳吃/斜跳）。"""
    if player is None:
        player = state.current_player
    me = state.pawns[player]
    opp = state.pawns[1 - player]
    blocked = _blocked_edges(state)
    res: list[Pos] = []
    for nb in _neighbors(me, blocked):
        if nb.r == opp.r and nb.c == opp.c:
            # 与对手相邻：尝试直跳
            dr, dc = opp.r - me.r, opp.c - me.c
            jr, jc = opp.r + dr, opp.c + dc
            straight_ok = (
                0 <= jr < BOARD_SIZE
                and 0 <= jc < BOARD_SIZE
                and ((opp.r, opp.c), (jr, jc)) not in blocked
            )
            if straight_ok:
                res.append(Pos(jr, jc))
            else:
                # 直跳被挡：可斜跳到对手旁边的三个方向（除回头）
                for dr2, dc2 in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    sr, sc = opp.r + dr2, opp.c + dc2
                    if (sr, sc) == (me.r, me.c):
                        continue
                    if 0 <= sr < BOARD_SIZE and 0 <= sc < BOARD_SIZE:
                        if ((opp.r, opp.c), (sr, sc)) not in blocked:
                            res.append(Pos(sr, sc))
        else:
            res.append(nb)
    # 去重
    seen = set()
    uniq = []
    for p in res:
        if (p.r, p.c) not in seen:
            seen.add((p.r, p.c))
            uniq.append({"type": "move", "to": p})
    return uniq


def wall_conflicts(state: GameState, w: Wall) -> bool:
    for e in state.walls:
        if e.r == w.r and e.c == w.c:
            return True  # 同格重叠或十字交叉都不允许
        if w.dir == "h" and e.dir == "h" and e.r == w.r and abs(e.c - w.c) == 1:
            return True  # 同向重叠一格
        if w.dir == "v" and e.dir == "v" and e.c == w.c and abs(e.r - w.r) == 1:
            return True
    return False


def wall_moves(state: GameState, player: int | None = None) -> list[dict]:
    if player is None:
        player = state.current_player
    if state.walls_remaining[player] <= 0:
        return []
    out = []
    for r in range(WALL_RANGE):
        for c in range(WALL_RANGE):
            for d in ("h", "v"):
                w = Wall(r, c, d)
                if wall_conflicts(state, w):
                    continue
                # 放墙后双方必须仍有路
                trial = deepcopy(state)
                trial.walls.append(w)
                if has_path(trial, 0) and has_path(trial, 1):
                    out.append({"type": "wall", "at": w})
    return out


def legal_moves(state: GameState) -> list[dict]:
    if state.winner is not None:
        return []
    return pawn_moves(state) + wall_moves(state)


def _move_equals(a: dict, b: dict) -> bool:
    if a["type"] != b["type"]:
        return False
    if a["type"] == "move":
        ta, tb = a["to"], b["to"]
        ar, ac = (ta.r, ta.c) if isinstance(ta, Pos) else (ta["r"], ta["c"])
        br, bc = (tb.r, tb.c) if isinstance(tb, Pos) else (tb["r"], tb["c"])
        return ar == br and ac == bc
    aa, ba = a["at"], b["at"]
    ar, ac, ad = (aa.r, aa.c, aa.dir) if isinstance(aa, Wall) else (aa["r"], aa["c"], aa["dir"])
    br, bc, bd = (ba.r, ba.c, ba.dir) if isinstance(ba, Wall) else (ba["r"], ba["c"], ba["dir"])
    return ar == br and ac == bc and ad == bd


def is_legal(state: GameState, move: dict) -> bool:
    for m in legal_moves(state):
        if _move_equals(m, move):
            return True
    return False


def apply_move(state: GameState, move: dict) -> GameState:
    """校验并执行一步，返回新状态；非法抛 ValueError。"""
    if state.winner is not None:
        raise ValueError("对局已结束")
    m = parse_move(move_to_dict(move) if isinstance(move, dict) and "to" in move or "at" in move else move)
    # 规范化：parse_move 接受 dict 形态
    if not is_legal(state, m):
        raise ValueError("非法移动（走子被挡/墙冲突/无路/无墙可放）")
    ns = deepcopy(state)
    p = ns.current_player
    if m["type"] == "move":
        ns.pawns[p] = m["to"]
        # 到达底线获胜
        if (p == 0 and m["to"].r == 0) or (p == 1 and m["to"].r == BOARD_SIZE - 1):
            ns.winner = p
    else:
        ns.walls.append(m["at"])
        ns.walls_remaining[p] -= 1
    ns.move_number += 1
    if ns.winner is None:
        ns.current_player = 1 - p
    return ns


def replay_moves(moves: list[dict], initial: GameState | None = None) -> list[GameState]:
    """从初始局面依次走棋，返回每步后的状态列表（含初始）。"""
    st = initial or GameState()
    states = [deepcopy(st)]
    for mv in moves:
        player = mv.get("player", st.current_player)
        if player != st.current_player:
            raise ValueError(f"行棋方不符：期望 {st.current_player}，得到 {player}")
        st = apply_move(st, mv["move"])
        states.append(deepcopy(st))
    return states
