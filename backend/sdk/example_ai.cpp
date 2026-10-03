// 示例 AI：展示如何编写 decide() 函数。
// 策略（贪心演示）：
//  1. 若 legalMoves 为空则原地不动（不应发生）；
//  2. 评估每个合法走子：走后自己到终点距离 - 对手到终点距离，选最小；
//  3. 放墙：只在前期尝试挡对手最短路（简单起见，优先走子，墙作为备选）。
// 你可以把这里替换成 minimax / MCTS 等更强算法。
#include <limits>

#include "quoridor_sdk.h"

// 用户要实现的函数：传入局面 JSON（已解析为 State），返回决策。
quoridor::Move decide(const quoridor::State &s) {
    using namespace quoridor;
    int me = s.currentPlayer;
    int opp = 1 - me;

    // 兜底：没有合法走法时返回原地（后端会判非法，本分支基本走不到）
    if (s.legalMoves.empty()) {
        return Move::pawn(s.pawns[me].r, s.pawns[me].c);
    }

    // 先算对手当前距离，用于评估放墙收益
    int oppNow = bfsDist(s.pawns[opp], s.walls, opp);

    Move best = s.legalMoves[0];
    int bestScore = std::numeric_limits<int>::max();

    for (const Move &m : s.legalMoves) {
        if (!m.isWall) {
            // 模拟走子后的局面（忽略跳吃细节，用目标位置直接评估）
            int myD = bfsDist(m.to, s.walls, me);
            // 对手位置不变
            int score = myD * 2 - oppNow;
            if (score < bestScore) {
                bestScore = score;
                best = m;
            }
        } else {
            // 模拟放墙：对手距离增加越多越好，但自己不能被挡太远
            if (s.wallsRemaining[me] <= 2) continue;  // 留两堵墙保底
            std::vector<Wall> w2 = s.walls;
            w2.push_back(m.wall);
            int oppD = bfsDist(s.pawns[opp], w2, opp);
            int myD = bfsDist(s.pawns[me], w2, me);
            if (oppD >= 1e9 || myD >= 1e9) continue;  // 保证有路（后端也会校验）
            int gain = oppD - oppNow;
            // 只有能让对手多绕 >=2 步、且自己不亏太多时才考虑放墙
            if (gain >= 2 && myD <= bfsDist(s.pawns[me], s.walls, me) + 1) {
                int score = myD * 2 - oppD - 1;  // -1 鼓励放墙
                if (score < bestScore) {
                    bestScore = score;
                    best = m;
                }
            }
        }
    }
    return best;
}
