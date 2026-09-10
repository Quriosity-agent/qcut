#include "cv_plane_format_fixtures.hpp"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <string>

namespace {

using agfx_contract::PlaneFormatRequest;
using namespace agfx_test;

// Counts and fingerprint recorded by the native oracle over the same 2^32 x 2
// plane classes x 2 flag values. This program re-derives them from the
// standalone model alone, so a build with no vendor library present still
// covers the whole four-character-code space.
constexpr std::size_t native_combos = 17179869184ULL;
constexpr std::size_t native_gles_recognized = 28;
constexpr std::size_t native_amg_recognized = 28;
constexpr std::size_t native_metal_recognized = 24;
constexpr std::size_t native_accepted_records = 28;
constexpr std::uint64_t native_accepted_fingerprint = 0xdea4ebd7ee69873fULL;

void require(bool condition, const std::string& message) {
  if (!condition) {
    std::cerr << message << '\n';
    std::exit(1);
  }
}

}  // namespace

int main() {
  const auto started = std::chrono::steady_clock::now();
  std::size_t combos = 0;
  std::size_t gles_recognized = 0;
  std::size_t amg_recognized = 0;
  std::size_t metal_recognized = 0;
  std::size_t accepted_records = 0;
  std::uint64_t accepted_fingerprint = fnv_offset;
  for (std::uint64_t source = 0; source <= 0xffffffffULL; ++source) {
    const auto code = static_cast<std::uint32_t>(source);
    for (const auto plane : sweep_planes) {
      for (const bool prefer_bgra : {false, true}) {
        const PlaneFormatRequest request{code, plane, prefer_bgra};
        const auto observation = observe(request);
        ++combos;
        gles_recognized += observation.gles_recognized ? 1 : 0;
        amg_recognized += observation.amg_recognized ? 1 : 0;
        metal_recognized += observation.metal != 0 ? 1 : 0;
        if (observation.gles_recognized || observation.amg_recognized || observation.metal != 0) {
          ++accepted_records;
          hash_observation(accepted_fingerprint, request, observation);
        }
      }
    }
  }
  const auto seconds =
      std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
  require(combos == native_combos, "Sweep visited a different number of combinations");
  require(gles_recognized == native_gles_recognized, "GLES acceptance count differs from native");
  require(amg_recognized == native_amg_recognized, "AMG acceptance count differs from native");
  require(metal_recognized == native_metal_recognized,
          "Metal acceptance count differs from native");
  require(accepted_records == native_accepted_records, "Accepted record count differs from native");
  require(accepted_fingerprint == native_accepted_fingerprint,
          "Accepted-record fingerprint differs from the native observation");
  std::cout << "CV plane format sweep passed: " << combos
            << " combinations over the whole four-character-code space, " << gles_recognized
            << " GLES / " << amg_recognized << " AMG / " << metal_recognized
            << " Metal acceptances and the pinned native fingerprint, in " << seconds << " s.\n";
  return 0;
}
