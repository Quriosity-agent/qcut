#include "image_warp.hpp"
#include "image_warp_native_support.hpp"

#include <unistd.h>

#include <cfenv>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <iostream>

namespace {
using namespace lens_contract;
using diagnostic::Oracle;
using namespace diagnostic;

constexpr char warp_symbol[] =
    "_ZN5smash6module5fsnew4base25WarpAffineForRgbaCvtColorERKN9mobilecv23MatERS4_S7_S6_RKNS3_5Size_IiEE";
struct Totals {
  std::size_t cases = 0;
  std::size_t bytes = 0;
  std::size_t nonzero_bytes = 0;
  std::size_t partial_alpha_pixels = 0;
  std::uint64_t fingerprint = 14695981039346656037ULL;

  void compare(std::span<const std::uint8_t> own, const GuardedBytes& native,
                const AffineWarpRequest& request, const char* output) {
    require(own.size() == native.length, "Output size differs");
    native.guards();
    for (std::size_t index = 0; index < own.size(); ++index) {
      if (own[index] != native.storage[index + 32]) {
        std::ostringstream message;
        message << output << " case=" << cases << " byte=" << index << " own="
                << unsigned(own[index]) << " native=" << unsigned(native.storage[index + 32])
                << " matrix=";
        for (float value : request.source_to_destination) message << value << ',';
        throw std::runtime_error(message.str());
      }
      fingerprint = (fingerprint ^ own[index]) * 1099511628211ULL;
      nonzero_bytes += own[index] != 0;
    }
    bytes += own.size();
  }
};


void compare(const Oracle& oracle, Totals& totals) {
  const auto warp = oracle.symbol<Warp>(warp_symbol);
  const auto construct = oracle.offset<Construct>(warp_symbol, 0x2f4054, 0x220f0c);
  const auto destroy = oracle.offset<Destroy>(warp_symbol, 0x2f4054, 0x21e9ec);
  Samples random;
  const auto transforms = matrices();
  for (const auto size : {std::array{1, 1}, std::array{2, 3}, std::array{7, 5},
                          std::array{17, 9}, std::array{31, 33}, std::array{65, 37},
                          std::array{257, 145}}) {
    for (std::size_t padding : {0U, 7U}) {
      const auto stride = static_cast<std::size_t>(size[0]) * 4 + padding;
      GuardedBytes source(stride * static_cast<std::size_t>(size[1]));
      for (std::size_t index = 0; index < source.length; ++index) {
        source.data()[index] = static_cast<std::uint8_t>(random.next());
      }
      const auto source_before = source.storage;
      for (std::size_t index = 0; index < transforms.size(); ++index) {
        const int width = size[0] + static_cast<int>(index % 3);
        const int height = size[1] + static_cast<int>((index / 3) % 3);
        const auto pixel_count = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
        GuardedBytes native_rgba(pixel_count * 4), native_bgr(pixel_count * 3);
        auto matrix = transforms[index];
        NativeMat input(construct, destroy, size[1], size[0], 24, source.data(), stride);
        NativeMat rgba(construct, destroy, height, width, 24, native_rgba.data(),
                        static_cast<std::size_t>(width) * 4);
        NativeMat bgr(construct, destroy, height, width, 16, native_bgr.data(),
                       static_cast<std::size_t>(width) * 3);
        NativeMat transform(construct, destroy, 2, 3, 5, matrix.data(), 12);
        const std::array target_size{width, height};
        warp(input.address(), bgr.address(), rgba.address(), transform.address(), target_size.data());
        input.unchanged_storage(source.data(), size[0], size[1]);
        rgba.unchanged_storage(native_rgba.data(), width, height);
        bgr.unchanged_storage(native_bgr.data(), width, height);
        transform.unchanged_storage(matrix.data(), 3, 2);
        require(matrix == transforms[index] && source.storage == source_before,
                "Native call changed source, source padding or matrix");
        const AffineWarpRequest request{transforms[index], width, height};
        AffineWarpResult own;
        require(warp_affine_rgba({{source.data(), source.length}, size[0], size[1], stride}, request, own),
                "Independent warp rejected valid native fixture");
        totals.compare(own.rgba, native_rgba, request, "RGBA");
        totals.compare(own.bgr, native_bgr, request, "BGR");
        for (std::size_t pixel = 0; pixel < pixel_count; ++pixel) {
          const auto alpha = own.rgba[pixel * 4 + 3];
          totals.partial_alpha_pixels += alpha > 0 && alpha < 255;
        }
        ++totals.cases;
      }
    }
  }
}
}  // namespace

int main(int argc, char** argv) {
  const int report = dup(STDOUT_FILENO);
  try {
    require(argc == 2 && report >= 0, "Usage: lens-image-native-oracle /absolute/path/liblens.dylib");
    require(std::fegetround() == FE_TONEAREST, "Oracle requires FE_TONEAREST");
    require(dup2(STDERR_FILENO, STDOUT_FILENO) >= 0, "Cannot redirect native logging");
    Totals totals;
    {
      Oracle oracle(argv[1]);
      compare(oracle, totals);
    }
    std::fflush(stdout);
    require(dup2(report, STDOUT_FILENO) >= 0, "Cannot restore report output");
    close(report);
    std::cout << "{\n  \"backend\": \"liblens fsnew base nearest RGBA affine\",\n"
              << "  \"cases\": " << totals.cases << ",\n  \"comparedBytes\": " << totals.bytes
              << ",\n  \"differentBytes\": 0,\n  \"nonzeroBytes\": " << totals.nonzero_bytes
              << ",\n  \"partialAlphaPixels\": " << totals.partial_alpha_pixels
              << ",\n  \"outputFnv1a64\": \"" << std::hex << totals.fingerprint << "\",\n"
              << "  \"matrixFixtures\": 278,\n  \"sourceSizes\": 7,\n  \"sourceLayouts\": 2,\n"
              << "  \"sourceAndGuardsUnchanged\": true\n}\n";
  } catch (const std::exception& error) {
    if (report >= 0) close(report);
    std::cerr << error.what() << '\n';
    return 1;
  }
}
