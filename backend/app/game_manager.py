"""对局管理：内存存储（重启丢失，够演示；后续可换 DB）。"""
from __future__ import annotations

import time
import uuid
from copy import deepcopy

from . import engine
from .engine import GameState

_games: dict[str, dict] = {}


def create_game(player_types: list[str], ai_ids: list[str | None], names: list[str] | None = None) -> dict:
    if len(player_types) != 2 or len(ai_ids) != 2:
        raise ValueError("只支持双人对局")
    for t in player_types:
        if t not in ("human", "ai"):
            raise ValueError("playerTypes 只能是 human/ai")
    gid = uuid.uuid4().hex[:12]
    _games[gid] = {
        "gameId": gid,
        "state": GameState(),
        "playerTypes": list(player_types),
        "aiIds": list(ai_ids),
        "names": list(names) if names else ["玩家1", "玩家2"],
        "history": [],  # 每项 {player, move}
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    return _games[gid]


def get_game(gid: str) -> dict | None:
    return _games.get(gid)


def game_view(g: dict) -> dict:
    st: GameState = g["state"]
    return {
        "gameId": g["gameId"],
        "state": st.to_dict(include_legal=True),
        "playerTypes": g["playerTypes"],
        "aiIds": g["aiIds"],
        "names": g["names"],
        "history": deepcopy(g["history"]),
    }


def do_move(g: dict, move: dict) -> dict:
    player = g["state"].current_player
    g["state"] = engine.apply_move(g["state"], move)
    norm = engine.move_to_dict(engine.parse_move(move))
    g["history"].append({"player": player, "move": norm})
    return g


def build_record(g: dict) -> dict:
    st: GameState = g["state"]
    return {
        "meta": {
            "boardSize": engine.BOARD_SIZE,
            "names": g["names"],
            "playerTypes": g["playerTypes"],
            "winner": st.winner,
            "totalMoves": len(g["history"]),
            "exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "initialState": GameState().to_dict(include_legal=False),
        "moves": deepcopy(g["history"]),
    }
