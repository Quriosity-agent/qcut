#include "agfx-texture-kernel.hpp"
#include "agfx-texture-runtime.hpp"
#include "../independent-agfx-contract/m4_trilinear_fixtures.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <iomanip>
#include <iostream>
#include <sstream>

namespace {
using namespace agfx_contract;

NSString* hash_string(std::uint64_t hash) {
  std::ostringstream text;
  text << std::hex << std::setw(16) << std::setfill('0') << hash;
  return @(text.str().c_str());
}

NSDictionary* compare(const agfx_probe::LibraryIdentity& identity) {
  auto device = MTLCreateSystemDefaultDevice();
  if (!device || ![device.name isEqualToString:@"Apple M4 Pro"]) throw std::runtime_error("Requires measured Apple M4 Pro");
  agfx_probe::TextureKernel kernel(device);
  std::uint64_t channels = 0, cpu_errors = 0, gpu_errors = 0, configurations = 0;
  std::uint64_t fingerprint = 14695981039346656037ULL, portable = fingerprint;
  NSMutableArray* examples = [NSMutableArray array];
  const std::array sizes{std::array{1U, 1U}, std::array{2U, 2U}, std::array{3U, 5U}, std::array{8U, 4U},
      std::array{17U, 9U}, std::array{128U, 65U}, std::array{257U, 129U}, std::array{16384U, 1U}, std::array{1U, 16384U}};
  for (const auto size : sizes) {
    const auto full_count = static_cast<std::uint32_t>(std::bit_width(std::max(size[0], size[1])));
    std::vector<std::uint32_t> counts{full_count};
    if (full_count > 2) counts.push_back(2);
    for (const auto count : counts) {
      const auto queries = agfx_test::trilinear_queries(size[0], size[1], count);
      std::vector<std::array<float, 4>> gpu_queries;
      for (const auto& query : queries) gpu_queries.push_back({query.point.u, query.point.v, query.point.w, query.lod});
      for (const auto format : {43, 50}) {
        agfx_probe::TextureRuntime runtime(identity);
        auto fixture = agfx_test::m4_fixture(size[0], size[1], format == 50, agfx_test::trilinear_pattern);
        fixture.levels.resize(count);
        fixture.storage.resize(count);
        agfx_probe::TextureUpload upload{static_cast<int>(size[0]), static_cast<int>(size[1]), 1, format, fixture.storage, {}};
        for (const auto& level : fixture.levels) upload.row_strides.push_back(static_cast<int>(level.row_stride));
        const auto texture = runtime.upload(upload);
        if (texture.metal.mipmapLevelCount != count) throw std::runtime_error("Wrong native level count");
        for (int s = 0; s < 4; ++s) {
          for (int t = 0; t < 4; ++t) {
            @autoreleasepool {
              ++configurations;
              const SourceSampler source{1, 1, 2, s, t, 1};
              const SampleSettings settings{TexelFilter::linear, static_cast<TexelWrap>(s), static_cast<TexelWrap>(t)};
              const auto cpu = sample_m4_texture_points({fixture.levels, queries, settings, MipFilter::linear});
              const auto actual = kernel.sample(texture.metal, runtime.set_sampler(texture, source), gpu_queries);
              const auto gpu = kernel.sample(texture.metal, kernel.independent_sampler(source), gpu_queries);
              for (std::size_t i = 0; i < actual.size(); ++i) {
                agfx_test::hash_color(fingerprint, actual[i]);
                if (size == std::array{3U, 5U} && count == 3 && format == 43 && i % 61 == 0) agfx_test::hash_color(portable, actual[i]);
                for (std::size_t c = 0; c < 4; ++c) {
                  ++channels;
                  const auto bits = std::bit_cast<std::uint32_t>(actual[i][c]);
                  if (bits != std::bit_cast<std::uint32_t>(gpu[i][c])) ++gpu_errors;
                  if (bits != std::bit_cast<std::uint32_t>(cpu[i][c])) {
                    ++cpu_errors;
                    if (examples.count < 16) [examples addObject:@{@"width": @(size[0]), @"height": @(size[1]), @"levels": @(count),
                      @"s": @(s), @"t": @(t), @"query": @(i), @"channel": @(c), @"nativeBits": @(bits),
                      @"cpuBits": @(std::bit_cast<std::uint32_t>(cpu[i][c]))}];
                  }
                }
              }
            }
          }
        }
      }
    }
    std::cerr << size[0] << 'x' << size[1] << ": " << channels << " channels, " << cpu_errors << " CPU differences\n";
  }
  return @{@"passed": @(cpu_errors == 0 && gpu_errors == 0), @"configurations": @(configurations),
    @"channelsPerRoute": @(channels), @"cpuDifferences": @(cpu_errors), @"gpuDifferences": @(gpu_errors),
    @"nativeFingerprint": hash_string(fingerprint), @"portableFingerprint": hash_string(portable), @"examples": examples,
    @"sha256": identity.sha256, @"arm64Uuid": identity.uuid, @"device": device.name,
    @"os": NSProcessInfo.processInfo.operatingSystemVersionString,
    @"scope": @"M4 Pro RGBA8/BGRA8 2D linear spatial plus linear mip; full and partial mip chains; per-axis signed zero or abs in [2^-24,8]; transparent border, min=mag, anisotropy 1",
    @"notCovered": @"Other devices/OS, tiny or large coordinates, 3D, sRGB/HDR, anisotropy, actual filter-pass or product parity"};
}
} // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::invalid_argument("Usage: agfx-trilinear-probe /absolute/libAGFX.dylib");
      NSDictionary* report;
      {
        editor_probe::NativeOutputScope quiet;
        report = compare(agfx_probe::loadVerifiedLibrary({argv[1]}));
      }
      auto json = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
      if (!json) throw std::runtime_error("Cannot serialize trilinear comparison");
      std::cout.write(static_cast<const char*>(json.bytes), static_cast<std::streamsize>(json.length));
      std::cout << '\n';
      return [report[@"passed"] boolValue] ? 0 : 1;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      return 1;
    }
  }
}
