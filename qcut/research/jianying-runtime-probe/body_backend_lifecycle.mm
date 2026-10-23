#include "filter-probe.h"

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

int main(int argc, char* argv[]) {
  @autoreleasepool {
    if (argc != 8) {
      std::cerr << "runtime models package manifest output width height required\n";
      return 2;
    }
    try {
      const char* parameters = std::getenv("QCUT_BACKEND_PARAMETERS");
      if (parameters == nullptr) {
        throw std::runtime_error("missing explicit body controls");
      }
      const auto result = jianying_probe::renderFilterSequence({
          .runtimeRoot = argv[1],
          .packagePath = argv[3],
          .modelDirectory = argv[2],
          .manifestPath = argv[4],
          .outputDirectory = argv[5],
          .width = std::stoi(argv[6]),
          .height = std::stoi(argv[7]),
          .frameRate = 30.0,
          .nativeTextureFlags = {false, false, true},
          .featureParameters = parameters,
      });
      return result.requestedFrames == result.renderedFrames ? 0 : 1;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      return 1;
    }
  }
}
