#include "agfx-mip-fixtures.hpp"
#include "agfx-texture-kernel.hpp"
#include "../independent-agfx-contract/mip_sample.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <algorithm>
#include <iomanip>
#include <iostream>
#include <sstream>

namespace {
using namespace agfx_mip_probe;
using namespace agfx_contract;
constexpr std::size_t kBatch = 65536;

void hash_float(std::uint64_t& fingerprint, float value) {
  const auto bits = std::bit_cast<std::uint32_t>(value);
  for (unsigned shift = 0; shift < 32; shift += 8) {
    fingerprint ^= (bits >> shift) & 255U;
    fingerprint *= 1099511628211ULL;
  }
}

NSString* hex_hash(std::uint64_t value) {
  std::ostringstream hash;
  hash << std::hex << std::setw(16) << std::setfill('0') << value;
  return @(hash.str().c_str());
}

struct Counts {
  std::uint64_t query_count = 0;
  std::uint64_t cpu_channels = 0;
  std::uint64_t independent_gpu_channels = 0;
  std::uint64_t cpu_differences = 0;
  std::uint64_t independent_gpu_differences = 0;
  std::uint64_t fingerprint = 14695981039346656037ULL;
  std::uint64_t portable_red_fingerprint = 14695981039346656037ULL;
  std::uint64_t portable_red_floats = 0;
  std::uint64_t unquantized_lod_model_differences = 0;
  std::uint64_t unquantized_blend_model_differences = 0;
  std::uint64_t wrong_tie_blend_model_differences = 0;
  NSMutableArray* examples = [NSMutableArray array];

  void observe(const Query& query, std::uint32_t levels, int format, int mode,
               const std::array<float, 4>& actual, const std::array<float, 4>& independent,
               const std::array<float, 4>& expected) {
    ++query_count;
    for (std::size_t channel = 0; channel < 4; ++channel) {
      const auto bits = std::bit_cast<std::uint32_t>(actual[channel]);
      hash_float(fingerprint, actual[channel]);
      ++cpu_channels; ++independent_gpu_channels;
      const auto cpu_bits = std::bit_cast<std::uint32_t>(expected[channel]);
      const auto direct_bits = std::bit_cast<std::uint32_t>(independent[channel]);
      if (bits != cpu_bits) ++cpu_differences;
      if (bits != direct_bits) ++independent_gpu_differences;
      if ((bits != cpu_bits || bits != direct_bits) && examples.count < 8) {
        [examples addObject:@{@"levels": @(levels), @"format": @(format), @"mode": @(mode),
          @"lodBits": @(std::bit_cast<std::uint32_t>(query[3])), @"channel": @(channel),
          @"nativeBits": @(bits), @"cpuBits": @(cpu_bits), @"independentGpuBits": @(direct_bits)}];
      }
    }
  }

  NSDictionary* json() const {
    return @{@"queries": @(query_count), @"cpuChannelComparisons": @(cpu_channels),
      @"independentGpuChannelComparisons": @(independent_gpu_channels),
      @"cpuDifferences": @(cpu_differences), @"independentGpuDifferences": @(independent_gpu_differences),
      @"fnv1aNativeChannelBits": hex_hash(fingerprint), @"firstDifferences": examples,
      @"portableRgbaRedFloats": @(portable_red_floats),
      @"fnv1aPortableRgbaRedBits": hex_hash(portable_red_fingerprint),
      @"negativeModelDifferences": @{@"continuousLod": @(unquantized_lod_model_differences),
      @"continuousByteBlend": @(unquantized_blend_model_differences),
      @"wrongBlendTieFloor": @(wrong_tie_blend_model_differences)}};
  }
};

std::array<float, 4> normalized(Pixel bytes) {
  std::array<float, 4> result{};
  for (std::size_t channel = 0; channel < 4; ++channel) result[channel] = static_cast<float>(bytes[channel]) / 255.0F;
  return result;
}

std::array<float, 4> constant_expected(std::uint32_t levels, int mode, float lod) {
  const auto selection = select_m4_mip({lod, levels, static_cast<MipFilter>(mode)});
  if (selection.first == selection.second || selection.weight_64 == 0) return normalized(constant_color(selection.first));
  return blend_m4_mip_texels({constant_color(selection.first), constant_color(selection.second), selection.weight_64});
}

std::array<float, 4> continuous_lod(std::uint32_t levels, int mode, float lod) {
  if (mode == 0) return normalized(constant_color(0));
  const auto clamped = std::clamp(lod, 0.0F, static_cast<float>(levels - 1));
  if (mode == 1) return normalized(constant_color(static_cast<std::uint32_t>(std::ceil(clamped - .5F))));
  const auto first = static_cast<std::uint32_t>(clamped);
  const auto second = std::min(first + 1, levels - 1);
  auto result = normalized(constant_color(first));
  const auto next = normalized(constant_color(second));
  for (std::size_t channel = 0; channel < 4; ++channel) result[channel] += (next[channel] - result[channel]) * (clamped - static_cast<float>(first));
  return result;
}

void check_constants(const agfx_probe::LibraryIdentity& identity, id<MTLDevice> device, Counts& counts) {
  agfx_probe::TextureKernel kernel(device);
  for (const int format : {43, 50}) {
    agfx_probe::TextureRuntime runtime(identity);
    for (std::uint32_t levels = 1; levels <= 15; ++levels) {
      const auto texture = runtime.upload(constant_upload(levels, format));
      if (texture.metal.mipmapLevelCount != levels) throw std::runtime_error("Native constant mip chain count differs");
      const auto queries = lod_queries(levels);
      for (const int spatial : {0, 1}) {
        for (const int mode : {0, 1, 2}) {
          const SourceSampler source{spatial, spatial, mode, 1, 1, 1};
          const auto sampler = runtime.set_sampler(texture, source);
          const auto independent_sampler = kernel.independent_sampler(source);
          for (std::size_t offset = 0; offset < queries.size(); offset += kBatch) {
            @autoreleasepool {
              const auto batch = std::span<const Query>(queries).subspan(offset, std::min(kBatch, queries.size() - offset));
              const auto actual = kernel.sample(texture.metal, sampler, batch);
              const auto independent = kernel.sample(texture.metal, independent_sampler, batch);
              for (std::size_t i = 0; i < batch.size(); ++i) {
                const auto expected = constant_expected(levels, mode, batch[i][3]);
                counts.observe(batch[i], levels, format, mode, actual[i], independent[i], expected);
                const auto wrong = continuous_lod(levels, mode, batch[i][3]);
                for (std::size_t c = 0; c < 4; ++c) {
                  if (std::bit_cast<std::uint32_t>(wrong[c]) != std::bit_cast<std::uint32_t>(actual[i][c])) {
                    ++counts.unquantized_lod_model_differences;
                  }
                }
              }
            }
          }
        }
      }
      std::cerr << "constant format=" << format << " levels=" << levels << " CPU differences=" << counts.cpu_differences << '\n';
    }
  }
}

void check_pairs(const agfx_probe::LibraryIdentity& identity, id<MTLDevice> device, Counts& counts) {
  agfx_probe::TextureKernel kernel(device);
  for (const int format : {43, 50}) {
    agfx_probe::TextureRuntime runtime(identity);
    const auto texture = runtime.upload(pair_upload(format));
    if (texture.metal.mipmapLevelCount != 2) throw std::runtime_error("Native exhaustive mip chain count differs");
    const SourceSampler source{0, 0, 2, 1, 1, 1};
    const auto sampler = runtime.set_sampler(texture, source);
    const auto independent_sampler = kernel.independent_sampler(source);
    for (std::uint32_t weight = 0; weight <= 64; ++weight) {
      @autoreleasepool {
        const auto queries = pair_queries(weight);
        const auto actual = kernel.sample(texture.metal, sampler, queries);
        const auto independent = kernel.sample(texture.metal, independent_sampler, queries);
        for (std::size_t index = 0; index < queries.size(); ++index) {
          const auto first = pair_color(static_cast<std::uint32_t>(index % 256), false);
          const auto second = pair_color(static_cast<std::uint32_t>(index / 256), true);
          const auto expected = blend_m4_mip_texels({first, second, weight});
          counts.observe(queries[index], 2, format, 2, actual[index], independent[index], expected);
          if (format == 43) {
            hash_float(counts.portable_red_fingerprint, actual[index][0]);
            ++counts.portable_red_floats;
          }
          for (std::size_t c = 0; c < 4; ++c) {
            const auto numerator = static_cast<std::uint32_t>(first[c]) * (64 - weight) + static_cast<std::uint32_t>(second[c]) * weight;
            const float unquantized = static_cast<float>(numerator) / 16320.0F;
            const float wrong_tie = static_cast<float>(numerator / 4) / 4080.0F;
            if (std::bit_cast<std::uint32_t>(unquantized) != std::bit_cast<std::uint32_t>(actual[index][c])) ++counts.unquantized_blend_model_differences;
            if (std::bit_cast<std::uint32_t>(wrong_tie) != std::bit_cast<std::uint32_t>(actual[index][c])) ++counts.wrong_tie_blend_model_differences;
          }
        }
      }
    }
    std::cerr << "exhaustive format=" << format << " CPU differences=" << counts.cpu_differences << '\n';
  }
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    Counts constants, pairs;
    NSString* device_name = nil;
    NSString* failure = nil;
    NSDictionary* library = nil;
    NSNumber* registry = nil;
    bool complete = false;
    try {
      if (argc != 2) throw std::invalid_argument("Usage: agfx-mip-probe /absolute/libAGFX.dylib (JSON on stdout)");
      {
        editor_probe::NativeOutputScope quiet;
        auto device = MTLCreateSystemDefaultDevice();
        if (!device) throw std::runtime_error("No Metal device");
        device_name = device.name; registry = @(device.registryID);
        if ([device_name rangeOfString:@"Apple M4"].location == NSNotFound) {
          throw std::runtime_error("Explicit LOD model is restricted to the measured Apple M4 profile");
        }
        const auto identity = agfx_probe::loadVerifiedLibrary({argv[1]});
        library = @{@"sha256": identity.sha256, @"uuid": identity.uuid, @"path": @(argv[1])};
        check_constants(identity, device, constants);
        check_pairs(identity, device, pairs);
        complete = true;
      }
      if (pairs.cpu_channels != 34078720ULL) throw std::runtime_error("Exhaustive byte-pair matrix is incomplete");
      if (pairs.portable_red_floats != 4259840ULL) throw std::runtime_error("Portable red-channel fingerprint is incomplete");
      if (!constants.unquantized_lod_model_differences || !pairs.unquantized_blend_model_differences ||
          !pairs.wrong_tie_blend_model_differences) throw std::runtime_error("A negative model was not detected");
    } catch (const std::exception& error) { failure = @(error.what()); }
    const bool passed = complete && !failure && constants.cpu_differences == 0 &&
        constants.independent_gpu_differences == 0 && pairs.cpu_differences == 0 && pairs.independent_gpu_differences == 0;
    NSDictionary* result = @{@"schemaVersion": @1, @"passed": @(passed), @"matrixCompleted": @(complete),
      @"device": device_name ? device_name : @"unavailable", @"registryID": registry ? registry : @0,
      @"os": NSProcessInfo.processInfo.operatingSystemVersionString,
      @"library": library ? library : @{}, @"maxQueriesPerDispatch": @(kBatch),
      @"constantLevels": constants.json(), @"exhaustiveBytePairs": pairs.json(),
      @"portableFingerprintOrder": @"RGBA8 only, R only; weight 0..64 outer, b 0..255 middle, a 0..255 inner; native float32 bytes little-endian, FNV-1a 64",
      @"error": failure ? failure : @"", @"scope": @"Measured Apple M4 explicit-LOD sampling profile through actual AGFX and independent Metal samplers; not recovered AGFX C++ arithmetic or a universal Metal guarantee"};
    NSError* error = nil;
    NSData* json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:&error];
    if (!json) { std::cerr << "Cannot serialize mip evidence\n"; return 1; }
    std::cout.write(static_cast<const char*>(json.bytes), static_cast<std::streamsize>(json.length));
    std::cout << '\n';
    return passed ? 0 : 1;
  }
}
