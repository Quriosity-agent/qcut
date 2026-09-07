#pragma once

#include <cstddef>
#include <stdexcept>

namespace fog_test {
inline std::size_t checks = 0;

inline void require(bool value, const char* message) {
    ++checks;
    if (!value) throw std::runtime_error(message);
}

template<typename Function> void rejects(Function function) {
    bool rejected = false;
    try { function(); } catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Invalid fog request was accepted");
}
} // namespace fog_test
