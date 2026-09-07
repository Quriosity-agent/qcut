#include "temporal_crop.hpp"

#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <sstream>
#include <string>

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "One line per frame: x y width height frame_width frame_height history_limit motion_fraction\n"
                 "Use reset on its own line. A negative parameter preserves both stored parameters.\n";
    return 0;
  }
  if (argc != 1) {
    std::cerr << "Usage: lens-temporal-crop [--help]\n";
    return 2;
  }
  lens_contract::TemporalCropSmoother smoother;
  std::string line;
  std::cout.imbue(std::locale::classic());
  std::cout << std::setprecision(std::numeric_limits<float>::max_digits10);
  while (std::getline(std::cin, line)) {
    if (line == "reset") {
      smoother.reset();
      std::cout << "{\"reset\":true}\n" << std::flush;
      continue;
    }
    lens_contract::TemporalCropRequest request{};
    auto& rectangle = request.rectangle;
    std::istringstream input(line);
    input.imbue(std::locale::classic());
    std::string extra;
    if (!(input >> rectangle.x >> rectangle.y >> rectangle.width >> rectangle.height >>
          request.frame_width >> request.frame_height >> request.history_limit >> request.motion_fraction) ||
        (input >> extra) || !smoother.process(request)) {
      std::cerr << "Invalid or unsupported frame; smoother state was not advanced\n";
      return 2;
    }
    const auto& state = smoother.state();
    const auto& output = state.output;
    std::cout << "{\"frame\":" << state.processed_frames << ",\"rectangle\":["
        << output.x << ',' << output.y << ',' << output.width << ',' << output.height
        << "],\"history\":[" << state.center_x << ',' << state.center_y << ',' << state.horizontal_extent
        << "],\"parameters\":[" << state.history_limit << ',' << state.motion_fraction << "]}\n" << std::flush;
  }
  if (!std::cin.eof()) {
    std::cerr << "Input read failed\n";
    return 2;
  }
  return std::cout ? 0 : 2;
}
