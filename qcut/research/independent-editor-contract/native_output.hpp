#pragma once

#include <cstdio>
#include <stdexcept>
#include <unistd.h>

namespace editor_probe {

class NativeOutputScope {
 public:
  NativeOutputScope() : saved_stdout_(dup(STDOUT_FILENO)) {
    if (saved_stdout_ < 0) throw std::runtime_error("Cannot preserve diagnostic stdout");
    if (dup2(STDERR_FILENO, STDOUT_FILENO) < 0) {
      close(saved_stdout_);
      throw std::runtime_error("Cannot isolate native initializer output");
    }
  }
  ~NativeOutputScope() {
    std::fflush(stdout);
    dup2(saved_stdout_, STDOUT_FILENO);
    close(saved_stdout_);
  }
  NativeOutputScope(const NativeOutputScope&) = delete;
  NativeOutputScope& operator=(const NativeOutputScope&) = delete;
 private:
  int saved_stdout_;
};

}  // namespace editor_probe
