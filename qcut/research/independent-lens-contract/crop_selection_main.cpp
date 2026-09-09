#include "crop_selection.hpp"

#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <sstream>
#include <string>

namespace {
void print_values(const lens_contract::DetectionBounds& values) {
  std::cout << '[' << values[0] << ',' << values[1] << ',' << values[2] << ',' << values[3] << ']';
}
bool no_extra(std::istringstream& input) {
  std::string extra;
  return !(input >> extra);
}
}  // namespace
int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "init width height scale anchor_x anchor_y\nbox left top right bottom\nmissing\nreset\n"
        "One command per line. Coordinates are source pixels. Output bounds are [left,top,right,bottom].\n";
    return 0;
  }
  if (argc != 1) {
    std::cerr << "Usage: lens-crop-selection [--help]\n";
    return 2;
  }
  lens_contract::CenterFocus focus;
  std::string line;
  std::cout.imbue(std::locale::classic());
  std::cout << std::setprecision(std::numeric_limits<float>::max_digits10);
  while (std::getline(std::cin, line)) {
    std::istringstream input(line);
    input.imbue(std::locale::classic());
    std::string operation;
    input >> operation;
    bool accepted = false;
    if (operation == "init") {
      lens_contract::CenterFocusConfiguration config;
      accepted = static_cast<bool>(input >> config.frame_width >> config.frame_height >> config.scale >> config.anchor_x >> config.anchor_y) &&
          no_extra(input) && focus.initialize(config);
      if (accepted) std::cout << "{\"initialized\":true}\n" << std::flush;
    } else if (operation == "reset") {
      accepted = no_extra(input);
      if (accepted) { focus.reset(); std::cout << "{\"reset\":true}\n" << std::flush; }
    } else if (operation == "box" || operation == "missing") {
      lens_contract::DetectionBounds bounds{};
      accepted = operation == "missing" || static_cast<bool>(input >> bounds[0] >> bounds[1] >> bounds[2] >> bounds[3]);
      const std::span<const float> detection = operation == "missing" ? std::span<const float>{} : std::span<const float>{bounds};
      accepted = accepted && no_extra(input) && focus.process(detection);
      if (accepted) {
        std::cout << "{\"frame\":" << focus.smoother_state().processed_frames << ",\"bounds\":";
        print_values(focus.state().output);
        std::cout << ",\"adjusted_detection\":";
        print_values(focus.state().adjusted);
        const auto& crop = focus.planner_state().output;
        std::cout << ",\"planned_rectangle\":[" << crop.x << ',' << crop.y << ',' << crop.width << ',' << crop.height
            << "],\"scale\":" << focus.planner_state().previous_scale << "}\n" << std::flush;
      }
    }
    if (!accepted) {
      std::cerr << "Invalid or unsupported command; state was not advanced\n";
      return 2;
    }
    if (!std::cout) return 2;
  }
  if (!std::cin.eof()) {
    std::cerr << "Input read failed\n";
    return 2;
  }
  return std::cout ? 0 : 2;
}
