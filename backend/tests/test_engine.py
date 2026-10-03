"""引擎单测：走子/放墙/胜负/回放。"""
from app.engine import GameState, Pos, Wall, apply_move, legal_moves, bfs_distance, replay_moves


def test_initial_legal_moves():
    st = GameState()
    ms = legal_moves(st)
    # 开局走子 3 个方向（前左右）+ 大量放墙
    pawn = [m for m in ms if m["type"] == "move"]
    assert len(pawn) == 3
    assert bfs_distance(st, 0) == 8


def test_move_and_wall():
    st = GameState()
    st = apply_move(st, {"type": "move", "to": {"r": 7, "c": 4}})
    assert st.pawns[0].r == 7 and st.current_player == 1
    st = apply_move(st, {"type": "wall", "at": {"r": 0, "c": 0, "dir": "h"}})
    assert len(st.walls) == 1 and st.walls_remaining[1] == 9


def test_illegal_wall_overlap():
    st = GameState()
    st = apply_move(st, {"type": "wall", "at": {"r": 1, "c": 1, "dir": "h"}})
    st = apply_move(st, {"type": "move", "to": {"r": 1, "c": 4}})
    try:
        apply_move(st, {"type": "wall", "at": {"r": 1, "c": 1, "dir": "h"}})
        assert False, "应抛非法"
    except ValueError:
        pass
    try:
        apply_move(st, {"type": "wall", "at": {"r": 1, "c": 1, "dir": "v"}})
        assert False, "十字交叉应抛非法"
    except ValueError:
        pass


def test_wall_owner():
    st = GameState()
    st = apply_move(st, {"type": "wall", "at": {"r": 1, "c": 1, "dir": "h"}})
    assert st.walls[0].by == 0
    d = st.to_dict()
    assert d["walls"][0]["by"] == 0
    # 旧棋谱（无 by）仍可读，by 缺省为未知
    st2 = GameState.from_dict({"walls": [{"r": 1, "c": 1, "dir": "h"}]})
    assert st2.walls[0].by == -1
    assert "by" not in st2.to_dict(include_legal=False)["walls"][0]


def test_win():
    st = GameState(pawns=[Pos(1, 4), Pos(0, 0)], walls=[], walls_remaining=[10, 10], current_player=0)
    st = apply_move(st, {"type": "move", "to": {"r": 0, "c": 4}})
    assert st.winner == 0


def test_replay():
    moves = [
        {"player": 0, "move": {"type": "move", "to": {"r": 7, "c": 4}}},
        {"player": 1, "move": {"type": "move", "to": {"r": 1, "c": 4}}},
    ]
    states = replay_moves(moves)
    assert len(states) == 3
    assert states[2].pawns[1].r == 1
