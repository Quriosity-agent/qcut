#include "agfx-texture-kernel.hpp"
#include "agfx-texture-runtime.hpp"
#include "../independent-agfx-contract/m4_texture_fixtures.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <iomanip>
#include <iostream>
#include <sstream>

namespace {
using namespace agfx_contract;

NSString* hex_hash(std::uint64_t hash) {
  std::ostringstream out;
  out << std::hex << std::setw(16) << std::setfill('0') << hash;
  return @(out.str().c_str());
}

NSDictionary* run(const agfx_probe::LibraryIdentity& identity) {
  auto device = MTLCreateSystemDefaultDevice();
  if (!device || ![device.name isEqualToString:@"Apple M4 Pro"]) throw std::runtime_error("Requires the measured Apple M4 Pro device");
  agfx_probe::TextureKernel kernel(device);
  std::uint64_t cpu_channels = 0, gpu_channels = 0, mismatches = 0, gpu_mismatches = 0;
  std::uint64_t hash = 14695981039346656037ULL, portable = hash;
  std::uint64_t float_reference_differences = 0;
  NSMutableArray* examples = [NSMutableArray array];
  std::size_t configurations = 0;
  const std::array dimensions{std::array{1U, 1U}, std::array{2U, 2U}, std::array{3U, 5U}, std::array{17U, 9U},
      std::array{128U, 65U}, std::array{257U, 129U}, std::array{16384U, 1U}, std::array{1U, 16384U}};
  for (const auto& size : dimensions) {
    const auto queries = agfx_test::m4_queries(size[0], size[1]);
    std::vector<std::array<float, 4>> gpu_queries;
    for (const auto& query : queries) gpu_queries.push_back({query.point.u, query.point.v, query.point.w, query.lod});
    for (const auto format : {43, 50}) {
      agfx_probe::TextureRuntime runtime(identity);
      const auto fixture = agfx_test::m4_fixture(size[0], size[1], format == 50);
      agfx_probe::TextureUpload upload{static_cast<int>(size[0]), static_cast<int>(size[1]), 1, format, fixture.storage, {}};
      for (const auto& level : fixture.levels) upload.row_strides.push_back(static_cast<int>(level.row_stride));
      const auto texture = runtime.upload(upload);
      if (texture.metal.mipmapLevelCount != fixture.levels.size()) throw std::runtime_error("Native level count mismatch");
      for (int spatial = 0; spatial < 2; ++spatial) {
        for (int mip = 0; mip < 3; ++mip) {
          if (spatial == 1 && mip == 2 && fixture.levels.size() > 1) continue;
          for (int wrap_s = 0; wrap_s < 4; ++wrap_s) {
            for (int wrap_t = 0; wrap_t < 4; ++wrap_t) {
              @autoreleasepool {
                ++configurations;
                const SourceSampler source{spatial, spatial, mip, wrap_s, wrap_t, 1};
                const SampleSettings settings{static_cast<TexelFilter>(spatial), static_cast<TexelWrap>(wrap_s), static_cast<TexelWrap>(wrap_t)};
                const auto expected = sample_m4_texture_points({fixture.levels, queries, settings, static_cast<MipFilter>(mip)});
                const auto actual = kernel.sample(texture.metal, runtime.set_sampler(texture, source), gpu_queries);
                const auto independent = kernel.sample(texture.metal, kernel.independent_sampler(source), gpu_queries);
                for (std::size_t i = 0; i < actual.size(); ++i) {
                  agfx_test::hash_color(hash, actual[i]);
                  if (size == std::array{3U, 5U} && format == 43) agfx_test::hash_color(portable, actual[i]);
                  for (std::size_t c = 0; c < 4; ++c) {
                    const auto bits = std::bit_cast<std::uint32_t>(actual[i][c]);
                    ++cpu_channels; ++gpu_channels;
                    if (bits != std::bit_cast<std::uint32_t>(independent[i][c])) ++gpu_mismatches;
                    if (bits != std::bit_cast<std::uint32_t>(expected[i][c])) {
                      ++mismatches;
                      if (examples.count < 12) [examples addObject:@{@"width": @(size[0]), @"height": @(size[1]),
                        @"spatial": @(spatial), @"mip": @(mip), @"s": @(wrap_s), @"t": @(wrap_t), @"query": @(i),
                        @"u": @(queries[i].point.u), @"v": @(queries[i].point.v), @"lod": @(queries[i].lod),
                        @"channel": @(c), @"nativeBits": @(bits), @"cpuBits": @(std::bit_cast<std::uint32_t>(expected[i][c]))}];
                    }
                  }
                  if (i < 128) {
                    const auto approximate = sample_m4_mip_texture({fixture.levels, queries[i].point, settings, queries[i].lod, static_cast<MipFilter>(mip)});
                    if (approximate != actual[i]) ++float_reference_differences;
                  }
                }
              }
            }
          }
        }
      }
    }
    std::cerr << "spatial " << size[0] << 'x' << size[1] << ": " << mismatches << " CPU differences\n";
  }
  return @{@"passed": @(mismatches == 0 && gpu_mismatches == 0 && float_reference_differences > 0),
    @"cpuChannels": @(cpu_channels), @"gpuChannels": @(gpu_channels), @"cpuDifferences": @(mismatches),
    @"gpuDifferences": @(gpu_mismatches), @"configurations": @(configurations), @"examples": examples,
    @"nativeFingerprint": hex_hash(hash), @"portableFingerprint": hex_hash(portable),
    @"continuousFloatModelPixelDifferences": @(float_reference_differences), @"device": device.name,
    @"os": NSProcessInfo.processInfo.operatingSystemVersionString,
    @"librarySha256": identity.sha256, @"arm64Uuid": identity.uuid,
    @"scope": @"M4 Pro RGBA8/BGRA8 normalized 2D coordinates of magnitude zero or [2^-24,8]: spatial nearest with any mip mode; spatial linear with none/nearest mip, or a single level. Transparent border; equal min/mag; anisotropy 1",
    @"notCovered": @"Spatial-linear plus mip-linear across multiple levels; nonzero coordinate magnitudes below 2^-24 or above 8; mag/min transitions; 3D, sRGB, HDR, other devices/OS, actual filter passes and product integration"};
}
} // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::invalid_argument("Usage: agfx-spatial-probe /absolute/libAGFX.dylib (JSON stdout)");
      NSDictionary* report;
      {
        editor_probe::NativeOutputScope quiet;
        report = run(agfx_probe::loadVerifiedLibrary({argv[1]}));
      }
      NSError* error = nil;
      auto json = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:&error];
      if (!json) throw std::runtime_error("Cannot serialize spatial comparison");
      std::cout.write(static_cast<const char*>(json.bytes), static_cast<std::streamsize>(json.length));
      std::cout << '\n';
      return [report[@"passed"] boolValue] ? 0 : 1;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      return 1;
    }
  }
}
