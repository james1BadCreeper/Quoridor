"""FastAPI 入口：对局 + AI 上传/运行 + 棋谱导出/回放校验。"""
from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import ai_manager, engine, game_manager
from .engine import GameState
from .models import AiMoveRequest, CreateGameRequest, DoMoveRequest, ReplayRequest

app = FastAPI(title="Quoridor API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------- AI ----------

@app.get("/api/ai/example/download")
def download_example():
    data = ai_manager.build_example_zip()
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=quoridor_example_ai.zip"},
    )


@app.get("/api/ai/list")
def ai_list():
    return {"ais": ai_manager.list_ais()}


@app.post("/api/ai/upload")
async def ai_upload(file: UploadFile = File(...), name: str = Form("unnamed")):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "空文件")
    try:
        meta = ai_manager.save_upload(raw, name or file.filename or "unnamed")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return meta


# ---------- 对局 ----------

@app.post("/api/game/create")
def game_create(req: CreateGameRequest):
    try:
        g = game_manager.create_game(req.playerTypes, req.aiIds, req.names)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return game_manager.game_view(g)


@app.get("/api/game/{gid}")
def game_get(gid: str):
    g = game_manager.get_game(gid)
    if not g:
        raise HTTPException(404, "对局不存在")
    return game_manager.game_view(g)


@app.post("/api/game/{gid}/move")
def game_move(gid: str, req: DoMoveRequest):
    g = game_manager.get_game(gid)
    if not g:
        raise HTTPException(404, "对局不存在")
    try:
        game_manager.do_move(g, req.move)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return game_manager.game_view(g)


@app.post("/api/game/{gid}/ai-move")
def game_ai_move(gid: str, req: AiMoveRequest):
    g = game_manager.get_game(gid)
    if not g:
        raise HTTPException(404, "对局不存在")
    st: GameState = g["state"]
    if st.winner is not None:
        raise HTTPException(400, "对局已结束")
    cur = st.current_player
    if g["playerTypes"][cur] != "ai":
        raise HTTPException(400, "当前不是 AI 行棋")
    ai_id = g["aiIds"][cur]
    if not ai_id:
        raise HTTPException(400, "该位置未绑定 AI")
    meta = ai_manager.get_ai(ai_id)
    if not meta or meta.get("status") != "ready":
        raise HTTPException(400, "AI 不可用（未编译成功）")
    try:
        out = ai_manager.run_ai(ai_id, st.to_dict(include_legal=True), timeout=req.timeout)
    except ValueError as e:
        raise HTTPException(500, f"AI 运行失败：{e}")
    try:
        game_manager.do_move(g, out["move"])
    except ValueError as e:
        raise HTTPException(500, f"AI 给出非法走法 {out['move']}：{e}")
    view = game_manager.game_view(g)
    view["aiMove"] = out["move"]
    view["aiSandbox"] = out["sandbox"]
    return view


@app.get("/api/game/{gid}/record")
def game_record(gid: str):
    g = game_manager.get_game(gid)
    if not g:
        raise HTTPException(404, "对局不存在")
    return game_manager.build_record(g)


# ---------- 回放 ----------

@app.post("/api/game/replay")
def replay(req: ReplayRequest):
    """校验一份棋谱 JSON，返回逐局面（含合法性检查）。"""
    rec = req.record or {}
    try:
        initial = GameState.from_dict(rec.get("initialState", {}))
        moves = rec.get("moves", [])
        states = engine.replay_moves(moves, initial)
    except ValueError as e:
        raise HTTPException(400, f"棋谱非法：{e}")
    except Exception as e:
        raise HTTPException(400, f"棋谱解析失败：{e}")
    return {
        "meta": rec.get("meta", {}),
        "states": [s.to_dict(include_legal=False) for s in states],
        "totalMoves": len(moves),
        "winner": states[-1].winner,
    }
