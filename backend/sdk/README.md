# Quoridor C++ AI 编写说明

## 1. 接口：实现一个函数

```cpp
#include "quoridor_sdk.h"

// 传入局面，返回决策
quoridor::Move decide(const quoridor::State &state);
```

- **不要写 `main()`**，平台的 `runner.cpp` 已提供 `main()`（stdin 读 JSON → 调用 `decide` → stdout 写 JSON）。
- 把你的代码打成 `zip`（内含 `.cpp` / `.h` 即可），从前端「上传 AI」处上传，平台自动编译。

## 2. 输入 JSON（stdin，平台传给你）

```json
{
  "boardSize": 9,
  "pawns": [{"r": 8, "c": 4}, {"r": 0, "c": 4}],
  "walls": [{"r": 1, "c": 1, "dir": "h"}],
  "wallsRemaining": [10, 10],
  "currentPlayer": 0,
  "moveNumber": 5,
  "legalMoves": [
    {"type": "move", "to": {"r": 7, "c": 4}},
    {"type": "wall", "at": {"r": 0, "c": 0, "dir": "h"}}
  ]
}
```

- `pawns[0]` 是先手（从第 8 行出发，目标第 0 行），`pawns[1]` 反之。
- 墙坐标 `r/c ∈ 0..7`，`dir` 为 `h`（横墙，挡纵向移动）或 `v`（竖墙，挡横向移动）。
- `legalMoves` 是平台算好的全部合法走法，**最简单的 AI 可直接从中选一个返回**。

SDK 已把 JSON 解析为 `State` 结构体（含 `legalMoves`），见 `quoridor_sdk.h`。

## 3. 输出 JSON（stdout，你返回的 Move 会被自动转成）

走子：

```json
{"type": "move", "to": {"r": 7, "c": 4}}
```

放墙：

```json
{"type": "wall", "at": {"r": 2, "c": 2, "dir": "v"}}
```

- 非法走法（撞墙/压墙/断路/无墙可放）会被判负一手，请尽量从 `legalMoves` 里选。
- 程序需在 **2 秒**内输出一行 JSON 并退出，超时判失败（可在下棋时自定义超时，上限 10s）。
- 运行环境：Docker 沙箱（`--network none`，256MB 内存，0.5 CPU，无状态），无网络、无持久化。

## 4. SDK 辅助函数（`quoridor_sdk.h` 内）

- `bfsDist(Pos, walls, player)`：到对方底线的最短步数。
- `nextStepOnShortest(Pos, walls, player)`：最短路的下一步。
- `blockedBy(walls, r1, c1, r2, c2)`：两格之间是否有墙。
- `move_to_json(Move)` / `parse_state(string)`：协议转换（一般不用直接调）。

## 5. 最小示例

见 `example_ai.cpp`：贪心选择使 `自己距离*2 - 对手距离` 最小的走法，偶尔放墙干扰。
