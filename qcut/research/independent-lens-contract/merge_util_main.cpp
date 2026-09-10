#include "merge_util.hpp"

#include <array>
#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <sstream>
#include <string>
#include <vector>

namespace {
const char* stage_name(lens_contract::MergeStage stage) {
  switch (stage) {
    case lens_contract::MergeStage::settings: return "settings";
    case lens_contract::MergeStage::template_vector: return "template vector";
    case lens_contract::MergeStage::box_vector: return "box vector";
    case lens_contract::MergeStage::rigid_to_lock: return "rigid-to-lock stage";
    case lens_contract::MergeStage::motion: return "motion stage";
    case lens_contract::MergeStage::lock_to_rigid: return "lock-to-rigid stage";
    case lens_contract::MergeStage::accepted: break;
  }
  return "accepted";
}
}  // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--help") {
    std::cout << "merge width height unused_field scale degrees tx ty x0 y0 x1 y1\n"
        "One MergeUtil chain per line. The template vector is normalized and ordered "
        "{scale, degrees, tx, ty}; the box is a pixel rectangle {x0, y0, x1, y1}. The result "
        "keeps the template order. unused_field is SettingInfo +0x10, which the algorithm "
        "loads and discards; it never changes the result.\n";
    return 0;
  }
  if (argc != 1) { std::cerr << "Usage: lens-merge-util [--help]\n"; return 2; }
  std::cout.imbue(std::locale::classic());
  std::cout << std::setprecision(std::numeric_limits<float>::max_digits10);
  std::string line;
  std::vector<float> output;
  while (std::getline(std::cin, line)) {
    std::istringstream request(line);
    request.imbue(std::locale::classic());
    std::string command, extra;
    lens_contract::MergeSettings settings{};
    std::array<float, lens_contract::merge_vector_length> current{}, box{};
    const bool parsed = static_cast<bool>(
        request >> command >> settings.width >> settings.height >> settings.unused_field >>
        current[0] >> current[1] >> current[2] >> current[3] >> box[0] >> box[1] >> box[2] >>
        box[3]);
    if (!parsed || command != "merge" || (request >> extra)) {
      std::cerr << "Invalid MergeUtil request\n";
      return 2;
    }
    const lens_contract::MergeStage stage =
        lens_contract::merge_util(settings, current, box, output);
    if (stage != lens_contract::MergeStage::accepted) {
      std::cerr << "Refused by the " << stage_name(stage) << "\n";
      return 2;
    }
    std::cout << "{\"vector\":[" << output[0] << ',' << output[1] << ',' << output[2] << ','
        << output[3] << "],\"scale\":" << output[0] << ",\"degrees\":" << output[1]
        << ",\"translation\":[" << output[2] << ',' << output[3] << "]}\n" << std::flush;
    if (!std::cout) return 2;
  }
  return std::cin.eof() && std::cout ? 0 : 2;
}
