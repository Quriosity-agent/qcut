#include "motion_constraint.hpp"

#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <sstream>
#include <string>

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "run width height center_x center_y minimum_scale tx ty degrees scale\n"
        "One pixel-space motion request per line. This is MergeUtil's border=11 constraint, not the normalized template conversion.\n";
    return 0;
  }
  if (argc != 1) { std::cerr << "Usage: lens-motion-constraint [--help]\n"; return 2; }
  std::cout.imbue(std::locale::classic());
  std::cout << std::setprecision(std::numeric_limits<float>::max_digits10);
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream request(line);
    request.imbue(std::locale::classic());
    std::string command, extra;
    lens_contract::MotionConstraint constraint{};
    lens_contract::RigidTransform input{}, output{};
    const bool parsed = static_cast<bool>(request >> command >> constraint.width >> constraint.height
        >> constraint.center.x >> constraint.center.y >> constraint.minimum_scale
        >> input.translation_x >> input.translation_y >> input.degrees >> input.scale);
    if (!parsed || command != "run" || (request >> extra) ||
        !lens_contract::constrain_motion(constraint, input, output)) {
      std::cerr << "Invalid or unsupported pixel-space motion request\n"; return 2;
    }
    std::cout << "{\"translation\":[" << output.translation_x << ',' << output.translation_y
        << "],\"degrees\":" << output.degrees << ",\"scale\":" << output.scale << "}\n" << std::flush;
    if (!std::cout) return 2;
  }
  return std::cin.eof() && std::cout ? 0 : 2;
}
