// Quoridor AI SDK：用户只需实现 decide()，不要写 main()。
// 编译时平台会自动加入 runner.cpp（含 main：stdin 读 JSON -> decide -> stdout 写 JSON）。
//
// 期望的用户代码形态（见 example_ai.cpp）：
//   #include "quoridor_sdk.h"
//   Move decide(const State &state) { ... }
#pragma once

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <map>
#include <queue>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace quoridor {

// ---------- 数据结构 ----------

struct Pos {
    int r = 0, c = 0;
};

struct Wall {
    int r = 0, c = 0;
    char dir = 'h';  // 'h' | 'v'
};

struct Move {
    bool isWall = false;
    Pos to;    // 走子时有效
    Wall wall;  // 放墙时有效
    static Move pawn(int r, int c) {
        Move m;
        m.isWall = false;
        m.to = {r, c};
        return m;
    }
    static Move putWall(int r, int c, char d) {
        Move m;
        m.isWall = true;
        m.wall = {r, c, d};
        return m;
    }
};

struct State {
    int boardSize = 9;
    Pos pawns[2];
    std::vector<Wall> walls;
    int wallsRemaining[2] = {10, 10};
    int currentPlayer = 0;
    int moveNumber = 0;
    std::vector<Move> legalMoves;  // 后端下发的合法走法（可直接选用）
};

const int N = 9;

// ---------- 极简 JSON 解析（仅够解析局面） ----------

struct JVal {
    enum Type { NUL, BOOL, NUM, STR, ARR, OBJ } type = NUL;
    bool b = false;
    double num = 0;
    std::string str;
    std::vector<JVal> arr;
    std::map<std::string, JVal> obj;
};

struct JParser {
    const char *p;
    JParser(const std::string &s) : p(s.c_str()) {}
    void skip() {
        while (*p && isspace((unsigned char)*p)) p++;
    }
    JVal parse() {
        skip();
        JVal v = val();
        skip();
        return v;
    }
    JVal val() {
        skip();
        if (*p == '{') return object();
        if (*p == '[') return array();
        if (*p == '"') return string();
        if (!strncmp(p, "true", 4)) {
            p += 4;
            JVal v;
            v.type = JVal::BOOL;
            v.b = true;
            return v;
        }
        if (!strncmp(p, "false", 5)) {
            p += 5;
            JVal v;
            v.type = JVal::BOOL;
            v.b = false;
            return v;
        }
        if (!strncmp(p, "null", 4)) {
            p += 4;
            JVal v;
            return v;
        }
        return number();
    }
    JVal object() {
        JVal v;
        v.type = JVal::OBJ;
        p++;  // {
        skip();
        if (*p == '}') {
            p++;
            return v;
        }
        while (true) {
            skip();
            std::string k = rawString();
            skip();
            if (*p == ':') p++;
            JVal vv = val();
            v.obj[k] = vv;
            skip();
            if (*p == ',') {
                p++;
                continue;
            }
            if (*p == '}') {
                p++;
                break;
            }
            break;
        }
        return v;
    }
    JVal array() {
        JVal v;
        v.type = JVal::ARR;
        p++;  // [
        skip();
        if (*p == ']') {
            p++;
            return v;
        }
        while (true) {
            v.arr.push_back(val());
            skip();
            if (*p == ',') {
                p++;
                continue;
            }
            if (*p == ']') {
                p++;
                break;
            }
            break;
        }
        return v;
    }
    std::string rawString() {
        // 调用时 p 指向 opening quote
        if (*p == '"') p++;
        std::string s;
        while (*p && *p != '"') {
            if (*p == '\\' && *(p + 1)) {
                p++;
                s += *p;
                p++;
            } else {
                s += *p;
                p++;
            }
        }
        if (*p == '"') p++;
        return s;
    }
    JVal string() {
        JVal v;
        v.type = JVal::STR;
        v.str = rawString();
        return v;
    }
    JVal number() {
        JVal v;
        v.type = JVal::NUM;
        char *end = nullptr;
        v.num = strtod(p, &end);
        p = end ? end : p;
        return v;
    }
};

inline int jint(const JVal &v) { return (int)std::round(v.num); }

// 把局面 JSON 解析为 State。缺字段时用默认值，保证鲁棒。
inline State parse_state(const std::string &json) {
    JParser ps(json);
    JVal root = ps.parse();
    State s;
    auto &o = root.obj;
    if (o.count("boardSize")) s.boardSize = jint(o["boardSize"]);
    if (o.count("pawns") && o["pawns"].type == JVal::ARR && o["pawns"].arr.size() >= 2) {
        for (int i = 0; i < 2; i++) {
            auto &pp = o["pawns"].arr[i].obj;
            if (pp.count("r")) s.pawns[i].r = jint(pp["r"]);
            if (pp.count("c")) s.pawns[i].c = jint(pp["c"]);
        }
    }
    if (o.count("walls") && o["walls"].type == JVal::ARR) {
        for (auto &w : o["walls"].arr) {
            Wall wall;
            auto &wo = w.obj;
            if (wo.count("r")) wall.r = jint(wo["r"]);
            if (wo.count("c")) wall.c = jint(wo["c"]);
            if (wo.count("dir") && !wo["dir"].str.empty()) wall.dir = wo["dir"].str[0];
            s.walls.push_back(wall);
        }
    }
    if (o.count("wallsRemaining") && o["wallsRemaining"].type == JVal::ARR &&
        o["wallsRemaining"].arr.size() >= 2) {
        s.wallsRemaining[0] = jint(o["wallsRemaining"].arr[0]);
        s.wallsRemaining[1] = jint(o["wallsRemaining"].arr[1]);
    }
    if (o.count("currentPlayer")) s.currentPlayer = jint(o["currentPlayer"]);
    if (o.count("moveNumber")) s.moveNumber = jint(o["moveNumber"]);
    if (o.count("legalMoves") && o["legalMoves"].type == JVal::ARR) {
        for (auto &m : o["legalMoves"].arr) {
            auto &mo = m.obj;
            if (!mo.count("type")) continue;
            std::string t = mo["type"].str;
            if (t == "move" && mo.count("to")) {
                auto &to = mo["to"].obj;
                Move mv = Move::pawn(jint(to["r"]), jint(to["c"]));
                s.legalMoves.push_back(mv);
            } else if (t == "wall" && mo.count("at")) {
                auto &at = mo["at"].obj;
                char d = at.count("dir") && !at["dir"].str.empty() ? at["dir"].str[0] : 'h';
                Move mv = Move::putWall(jint(at["r"]), jint(at["c"]), d);
                s.legalMoves.push_back(mv);
            }
        }
    }
    return s;
}

// ---------- 走法输出 ----------

inline std::string move_to_json(const Move &m) {
    std::ostringstream os;
    if (!m.isWall) {
        os << "{\"type\":\"move\",\"to\":{\"r\":" << m.to.r << ",\"c\":" << m.to.c << "}}";
    } else {
        os << "{\"type\":\"wall\",\"at\":{\"r\":" << m.wall.r << ",\"c\":" << m.wall.c << ",\"dir\":\""
           << m.wall.dir << "\"}}";
    }
    return os.str();
}

// ---------- 规则辅助（供 AI 内部评估） ----------

inline bool inBoard(int r, int c) { return r >= 0 && r < N && c >= 0 && c < N; }

// 判断两格之间是否有墙
inline bool blockedBy(const std::vector<Wall> &walls, int r1, int c1, int r2, int c2) {
    for (auto &w : walls) {
        if (w.dir == 'h') {
            if ((r1 == w.r && c1 == w.c && r2 == w.r + 1 && c2 == w.c) ||
                (r1 == w.r + 1 && c1 == w.c && r2 == w.r && c2 == w.c) ||
                (r1 == w.r && c1 == w.c + 1 && r2 == w.r + 1 && c2 == w.c + 1) ||
                (r1 == w.r + 1 && c1 == w.c + 1 && r2 == w.r && c2 == w.c + 1))
                return true;
        } else {
            if ((r1 == w.r && c1 == w.c && r2 == w.r && c2 == w.c + 1) ||
                (r1 == w.r && c1 == w.c + 1 && r2 == w.r && c2 == w.c) ||
                (r1 == w.r + 1 && c1 == w.c && r2 == w.r + 1 && c2 == w.c + 1) ||
                (r1 == w.r + 1 && c1 == w.c + 1 && r2 == w.r + 1 && c2 == w.c))
                return true;
        }
    }
    return false;
}

// BFS 到底线最短距离
inline int bfsDist(Pos start, const std::vector<Wall> &walls, int player) {
    int goal = (player == 0 ? 0 : N - 1);
    if ((player == 0 && start.r == 0) || (player == 1 && start.r == N - 1)) return 0;
    int dist[9][9];
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) dist[i][j] = -1;
    std::queue<Pos> q;
    q.push(start);
    dist[start.r][start.c] = 0;
    const int dr[4] = {-1, 1, 0, 0};
    const int dc[4] = {0, 0, -1, 1};
    while (!q.empty()) {
        Pos cur = q.front();
        q.pop();
        for (int k = 0; k < 4; k++) {
            int nr = cur.r + dr[k], nc = cur.c + dc[k];
            if (!inBoard(nr, nc)) continue;
            if (blockedBy(walls, cur.r, cur.c, nr, nc)) continue;
            if (dist[nr][nc] != -1) continue;
            if ((player == 0 && nr == 0) || (player == 1 && nr == N - 1))
                return dist[cur.r][cur.c] + 1;
            dist[nr][nc] = dist[cur.r][cur.c] + 1;
            q.push({nr, nc});
        }
    }
    return 1e9;
}

// 最短路的下一步（贪心跟随 BFS 父指针）
inline Pos nextStepOnShortest(Pos start, const std::vector<Wall> &walls, int player) {
    int goal = (player == 0 ? 0 : N - 1);
    int dist[9][9];
    Pos parent[9][9];
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) dist[i][j] = -1;
    std::queue<Pos> q;
    q.push(start);
    dist[start.r][start.c] = 0;
    parent[start.r][start.c] = start;
    const int dr[4] = {-1, 1, 0, 0};
    const int dc[4] = {0, 0, -1, 1};
    Pos found{-1, -1};
    while (!q.empty() && found.r == -1) {
        Pos cur = q.front();
        q.pop();
        for (int k = 0; k < 4; k++) {
            int nr = cur.r + dr[k], nc = cur.c + dc[k];
            if (!inBoard(nr, nc)) continue;
            if (blockedBy(walls, cur.r, cur.c, nr, nc)) continue;
            if (dist[nr][nc] != -1) continue;
            dist[nr][nc] = dist[cur.r][cur.c] + 1;
            parent[nr][nc] = cur;
            if ((player == 0 && nr == 0) || (player == 1 && nr == N - 1)) {
                found = {nr, nc};
                break;
            }
            q.push({nr, nc});
        }
    }
    if (found.r == -1) return start;
    Pos cur = found;
    while (!(parent[cur.r][cur.c].r == start.r && parent[cur.r][cur.c].c == start.c)) {
        cur = parent[cur.r][cur.c];
    }
    return cur;
}

}  // namespace quoridor
