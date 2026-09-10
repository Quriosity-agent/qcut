#include "rigid_lock_conversion.hpp"

#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <sstream>
#include <string>

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "to-lock width height center_x center_y tx ty degrees scale\n"
        "to-rigid width height center_x center_y tx ty degrees scale\n"
        "One conversion per line. The two directions are separate recovered algorithms, "
        "not each other's inverse; a value round tripped through both does not return.\n";
    return 0;
  }
  if (argc != 1) { std::cerr << "Usage: lens-rigid-lock [--help]\n"; return 2; }
  std::cout.imbue(std::locale::classic());
  std::cout << std::setprecision(std::numeric_limits<float>::max_digits10);
  std::string line;
  while (std::getline(std::cin, line)) {
    std::istringstream request(line);
    request.imbue(std::locale::classic());
    std::string command, extra;
    lens_contract::LockFrame frame{};
    lens_contract::RigidTransform input{}, output{};
    const bool parsed = static_cast<bool>(request >> command >> frame.width >> frame.height
        >> frame.center.x >> frame.center.y >> input.translation_x >> input.translation_y
        >> input.degrees >> input.scale);
    const bool to_lock = command == "to-lock";
    if (!parsed || (!to_lock && command != "to-rigid") || (request >> extra) ||
        !(to_lock ? lens_contract::rigid_to_lock(frame, input, output)
                  : lens_contract::lock_to_rigid(frame, input, output))) {
      std::cerr << "Invalid or unsupported rigid/lock conversion request\n"; return 2;
    }
    std::cout << "{\"translation\":[" << output.translation_x << ',' << output.translation_y
        << "],\"degrees\":" << output.degrees << ",\"scale\":" << output.scale << "}\n" << std::flush;
    if (!std::cout) return 2;
  }
  return std::cin.eof() && std::cout ? 0 : 2;
}
