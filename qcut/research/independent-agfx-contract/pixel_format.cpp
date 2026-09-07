#include "pixel_format.hpp"

#include <algorithm>
#include <array>

namespace agfx_contract {
namespace {

struct FormatMapping {
    std::uint32_t source;
    std::uint64_t metal;
};

// Behavioral mappings, checked against the version-pinned native converter.
constexpr std::array<FormatMapping, 113> mappings{{
    {1, 1}, {2, 10}, {15, 10}, {16, 12}, {19, 13}, {20, 14},
    {22, 30}, {23, 32}, {26, 33}, {27, 34},
    {29, 70}, {30, 72}, {31, 73}, {32, 74}, {33, 73}, {34, 74}, {35, 71},
    {43, 70}, {44, 72}, {47, 73}, {48, 74}, {49, 71}, {50, 80}, {56, 81},
    {64, 94}, {70, 90}, {74, 91},
    {76, 20}, {77, 22}, {80, 23}, {81, 24}, {82, 25},
    {83, 60}, {84, 62}, {87, 63}, {88, 64}, {89, 65},
    {90, 110}, {91, 112}, {92, 113}, {93, 114}, {94, 113}, {95, 114}, {96, 115},
    {97, 110}, {98, 112}, {101, 113}, {102, 114}, {103, 115},
    {104, 53}, {105, 54}, {106, 55}, {107, 103}, {108, 104}, {109, 105},
    {110, 123}, {111, 124}, {112, 125}, {113, 123}, {114, 124}, {115, 125},
    {128, 92}, {129, 93}, {130, 250}, {131, 252}, {132, 252}, {133, 253},
    {135, 260}, {136, 260},
    {139, 130}, {140, 131}, {141, 132}, {142, 133}, {143, 134}, {144, 135},
    {145, 140}, {146, 141}, {147, 142}, {148, 143},
    {149, 151}, {150, 150}, {151, 152}, {152, 153},
    {164, 204}, {165, 186}, {166, 205}, {167, 187}, {168, 206}, {169, 188},
    {170, 207}, {171, 189}, {172, 208}, {173, 190}, {174, 210}, {175, 192},
    {176, 211}, {177, 193}, {178, 212}, {179, 194}, {180, 213}, {181, 195},
    {182, 214}, {183, 196}, {184, 215}, {185, 197}, {186, 216}, {187, 198},
    {188, 217}, {189, 199}, {190, 218}, {191, 200}, {204, 240}, {205, 241},
}};

static_assert([] {
    for (std::size_t index = 1; index < mappings.size(); ++index) {
        if (mappings[index - 1].source >= mappings[index].source) return false;
    }
    return true;
}());

} // namespace

bool convert_pixel_format(const FormatRequest& request, std::uint64_t& output) noexcept {
    const auto found = std::lower_bound(mappings.begin(), mappings.end(), request.source_format,
        [](const FormatMapping& mapping, std::uint32_t source) { return mapping.source < source; });
    if (found == mappings.end() || found->source != request.source_format) return false;

    const bool needs_macos_11 = request.source_format >= 164 && request.source_format <= 191;
    if (needs_macos_11 && !request.macos_11_or_newer) return true;

    output = found->metal;
    return true;
}

} // namespace agfx_contract
