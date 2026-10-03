# Quoridor 

一个 Quoridor 全栈应用，支持人类 / AI 对战、AI 上传编译、棋谱导出与回放。

## 目录

- `backend/`：FastAPI + 规则引擎 + AI 沙箱
  - `app/engine.py`：走子（含跳吃/斜跳）、放墙（重叠/交叉/断路校验 + BFS 保路）、胜负判定
  - `app/main.py`：REST API（对局 / AI / 棋谱 / 回放）
  - `app/ai_manager.py`：zip 上传、编译（Docker 内 `gcc:13` 优先，失败回退本地 `g++`）、限时运行（`--network none`，256MB，0.5 CPU）
  - `sdk/quoridor_sdk.h`：C++ SDK（`State/Move`、JSON 解析、`bfsDist` 等辅助）
  - `sdk/example_ai.cpp`：示例 AI（贪心，需实现 `Move decide(const State&)`）
  - `sdk/README.md`：AI 编写说明（输入/输出 JSON 协议）
- `frontend/`：Vite + React + TS（开局设置、SVG 棋盘、上传 AI、导出/导入棋谱、步进回放）

## AI 协议

用户 zip 内只需包含实现 `Move decide(const State &state)` 的 `.cpp`（`#include "quoridor_sdk.h"`，不应该实现 Main 函数）。
平台编译时自动加入 `sdk/runner.cpp`；运行时 stdin 传入局面 JSON、stdout 读回一步 JSON：

- 走子 `{"type":"move","to":{"r":7,"c":4}}`
- 放墙 `{"type":"wall","at":{"r":1,"c":2,"dir":"h"}}`

输入还包含 `legalMoves`（全部合法走法，可直接选用）。每步限时 2s（可调，上限 10s），超时/非法/崩溃判该手失败。

## 本地运行

后端：

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

前端：

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173（/api 已代理到 8000）
```

Docker（后端，含 g++；AI 沙箱另用 `gcc:13` 镜像，需本机有 docker）：

```bash
cd backend && docker build -t quoridor-backend .
docker run -p 8000:8000 -v /var/run/docker.sock:/var/run/docker.sock quoridor-backend
# 如无 docker.sock 挂载或无 gcc 镜像，自动降级为本地 subprocess 沙箱（仍限时 + rlimit）
```

环境变量：`QUORIDOR_DOCKER_IMAGE`（默认 `gcc:13`）、`QUORIDOR_DOCKER_MEMORY`（默认 `256m`）、`QUORIDOR_NO_DOCKER=1`（强制本地沙箱）。

## API 速览

- `GET /api/health`
- `GET /api/ai/example/download`（示例 zip）、`POST /api/ai/upload`（multipart zip + name）、`GET /api/ai/list`
- `POST /api/game/create {playerTypes, aiIds}`、`GET /api/game/{id}`、`POST /api/game/{id}/move {move}`、`POST /api/game/{id}/ai-move {timeout}`、`GET /api/game/{id}/record`
- `POST /api/game/replay {record}`（校验棋谱并返回逐局面）

## 测试

```bash
cd backend && python -m pytest tests/ -q
cd frontend && npx tsc --noEmit && npm run build
```
