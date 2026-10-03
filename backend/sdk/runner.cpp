// 平台提供的 runner：含 main()，负责 JSON IO。用户不要再定义 main()。
#include <iostream>
#include <sstream>
#include <string>

#include "quoridor_sdk.h"

// 用户必须实现这个函数：输入局面，返回一步决策。
quoridor::Move decide(const quoridor::State &state);

int main() {
    std::ostringstream ss;
    ss << std::cin.rdbuf();
    std::string input = ss.str();
    if (input.empty()) {
        std::cerr << "empty stdin" << std::endl;
        return 1;
    }
    quoridor::State state;
    try {
        state = quoridor::parse_state(input);
    } catch (const std::exception &e) {
        std::cerr << "parse failed: " << e.what() << std::endl;
        return 2;
    }
    quoridor::Move mv;
    try {
        mv = decide(state);
    } catch (const std::exception &e) {
        std::cerr << "decide() threw: " << e.what() << std::endl;
        return 3;
    }
    std::cout << quoridor::move_to_json(mv) << std::endl;
    return 0;
}
