#include "agfx-texture-runtime.hpp"
#include "agfx-texture-kernel.hpp"
#include "../independent-agfx-contract/texture_sample.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <iostream>
#include <stdexcept>

namespace {

using namespace agfx_probe;
using namespace agfx_contract;

TextureUpload make_upload(int width, int height, int depth, int format, int padding, int level_count = 1) {
  TextureUpload upload{width, height, depth, format, {}, {}};
  for (int level = 0; level < level_count; ++level) {
    const int stride = width * 4 + padding;
    std::vector<std::uint8_t> pixels(static_cast<std::size_t>(stride) * height * depth, 0xbd);
    for (int z = 0; z < depth; ++z) {
      for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
          const auto offset = (static_cast<std::size_t>(z) * height + y) * stride + x * 4;
          const std::array<int, 4> color{{(x * 31 + y * 17 + z * 71 + level * 41) % 256,
              (x * 19 + y * 67 + z * 13 + level * 79 + 41) % 256,
              (x * 53 + y * 29 + z * 43 + level * 17 + 137) % 256,
              (x * 37 + y * 11 + z * 59 + level * 31 + 23) % 256}};
          for (int c = 0; c < 4; ++c) {
            const int source = format == 50 && c != 1 && c != 3 ? 2 - c : c;
            pixels[offset + c] = static_cast<std::uint8_t>(color[source]);
          }
        }
      }
    }
    upload.row_strides.push_back(stride);
    upload.levels.push_back(std::move(pixels));
    width = std::max(1, width / 2);
    height = std::max(1, height / 2);
  }
  return upload;
}

TextureView view(const TextureUpload& upload, std::size_t level = 0) {
  return {upload.levels.at(level), static_cast<std::uint32_t>(std::max(1, upload.width >> level)),
      static_cast<std::uint32_t>(std::max(1, upload.height >> level)), static_cast<std::uint32_t>(upload.depth),
      static_cast<std::size_t>(upload.row_strides.at(level)), 0,
      upload.format == 50 ? ChannelOrder::bgra : ChannelOrder::rgba};
}

std::vector<std::array<float, 4>> queries(bool volume) {
  const std::array<float, 9> coordinates{{-1.125F, -0.125F, 0.0F, 0.0625F, 0.375F, 0.5F, 0.9375F, 1.0F, 1.375F}};
  const std::array<float, 12> lods{{-1.0F, 0.0F, 0.49F, 0.5F, 0.51F, 0.75F,
      1.49F, 1.5F, 1.51F, 2.5F, 3.0F, 8.0F}};
  std::vector<std::array<float, 4>> result;
  for (const auto u : coordinates) {
    for (const auto v : coordinates) {
      for (const auto lod : lods) {
        result.push_back({u, v, volume ? u * 0.5F + v * 0.25F : 0.5F, lod});
      }
    }
  }
  return result;
}

SourceSampler source_sampler(int code) {
  return {code % 2, (code / 2) % 2, (code / 4) % 3,
      (code / 12) % 4, (code / 48) % 4, (code / 192) % 4};
}

std::array<float, 4> reference_sample(const TextureUpload& upload,
                                     const std::array<float, 4>& point,
                                     const SourceSampler& source) {
  const SampleSettings settings{source.mag == 0 ? TexelFilter::nearest : TexelFilter::linear,
      static_cast<TexelWrap>(source.wrap_s), static_cast<TexelWrap>(source.wrap_t),
      static_cast<TexelWrap>(source.wrap_r), {}};
  const float lod = source.mip == 0 ? 0.0F :
      std::clamp(point[3], 0.0F, static_cast<float>(upload.levels.size() - 1));
  const auto first = static_cast<std::size_t>(source.mip == 1 ? std::ceil(lod - 0.5F) : std::floor(lod));
  const SamplePoint coordinate{point[0], point[1], point[2]};
  auto result = sample_texture(view(upload, first), coordinate, settings);
  if (source.mip == 2 && first + 1 < upload.levels.size()) {
    const auto second = sample_texture(view(upload, first + 1), coordinate, settings);
    const float fraction = lod - static_cast<float>(first);
    for (std::size_t c = 0; c < 4; ++c) result[c] += (second[c] - result[c]) * fraction;
  }
  return result;
}

NSDictionary* check_upload_and_samples(TextureRuntime& runtime, TextureKernel& kernel,
                                       const TextureUpload& upload, const char* name) {
  const auto texture = runtime.upload(upload);
  if (texture.metal.mipmapLevelCount != upload.levels.size()) {
    throw std::runtime_error(std::string(name) + ": mip count differs from upload");
  }
  const auto expected_bytes = tight_rgba8(view(upload));
  if (upload.depth == 1) {
    const auto actual = runtime.readback(texture, upload.width, upload.height, 43);
    if (actual != expected_bytes) {
      std::size_t first = 0;
      while (first < actual.size() && actual[first] == expected_bytes[first]) ++first;
      throw std::runtime_error(std::string(name) + ": native RGBA readback mismatch at byte " + std::to_string(first));
    }
    auto bgra_expected = expected_bytes;
    for (std::size_t offset = 0; offset < bgra_expected.size(); offset += 4) {
      std::swap(bgra_expected[offset], bgra_expected[offset + 2]);
    }
    if (runtime.readback(texture, upload.width, upload.height, 50) != bgra_expected) {
      throw std::runtime_error(std::string(name) + ": native BGRA readback mismatch");
    }
  }
  const auto points = queries(upload.depth > 1);
  double max_reference_error = 0;
  std::size_t cpu_comparisons = 0;
  std::size_t excluded_mip_boundary_channels = 0;
  for (int code = 0; code < 768; ++code) {
    @autoreleasepool {
      const auto source = source_sampler(code);
      const auto native_sampler = runtime.set_sampler(texture, source);
      const auto independent_sampler = kernel.independent_sampler(source);
      const auto native = kernel.sample(texture.metal, native_sampler, points);
      const auto independent = kernel.sample(texture.metal, independent_sampler, points);
      if (std::memcmp(native.data(), independent.data(), native.size() * sizeof(native.front())) != 0) {
        throw std::runtime_error(std::string(name) + ": native/independent sampler pixels differ for code " + std::to_string(code));
      }
      if (source.mag == source.min) {
        for (std::size_t index = 0; index < native.size(); ++index) {
          // Arbitrary fractional LOD and nearest ties differ from continuous CPU math.
          // Keep every GPU comparison; limit CPU mip checks to exact quarter levels without nearest ties.
          const float lod = points[index][3];
          const bool non_quarter_lod = lod * 4.0F != std::floor(lod * 4.0F);
          const bool nearest_tie = source.mip == 1 && lod - std::floor(lod) == 0.5F;
          if (source.mip != 0 && upload.levels.size() > 1 && (non_quarter_lod || nearest_tie)) {
            excluded_mip_boundary_channels += 4;
            continue;
          }
          const auto reference = reference_sample(upload, points[index], source);
          for (std::size_t c = 0; c < 4; ++c) {
            const double error = std::abs(static_cast<double>(reference[c]) - native[index][c]);
            if (!std::isfinite(error) || error > 1.0 / 255.0) {
              throw std::runtime_error(std::string(name) + ": CPU sample mismatch code=" + std::to_string(code) +
                  " query=" + std::to_string(index) + " channel=" + std::to_string(c) + " error=" + std::to_string(error) +
                  " expected=" + std::to_string(reference[c]) + " actual=" + std::to_string(native[index][c]));
            }
            max_reference_error = std::max(max_reference_error, error);
            ++cpu_comparisons;
          }
        }
      }
    }
  }
  const SourceSampler border{1, 1, 0, 2, 2, 2};
  const SourceSampler wrong_clamp{1, 1, 0, 1, 1, 1};
  const auto border_pixels = kernel.sample(texture.metal, runtime.set_sampler(texture, border), points);
  const auto wrong_pixels = kernel.sample(texture.metal, kernel.independent_sampler(wrong_clamp), points);
  if (border_pixels == wrong_pixels) throw std::runtime_error("Wrong-wrap negative control did not diverge");
  return @{
    @"name": @(name), @"width": @(upload.width), @"height": @(upload.height), @"depth": @(upload.depth),
    @"sourceFormat": @(upload.format), @"metalFormat": @(texture.metal.pixelFormat),
    @"rowStride": @(upload.row_strides[0]), @"mipLevels": @(texture.metal.mipmapLevelCount),
    @"nativeReadbackChecked": @(upload.depth == 1), @"nativeReadbackExact": upload.depth == 1 ? @YES : [NSNull null],
    @"readbackFormats": upload.depth == 1 ? @[@43, @50] : @[], @"samplerCombinations": @768,
    @"uploadAdapter": @"Pack each padded RGBA/BGRA row before calling the AGFX convenience API",
    @"wrongWrapNegativeControlDetected": @YES,
    @"queriesPerSampler": @(points.size()), @"gpuPixelComparisons": @(points.size() * 768),
    @"gpuSamplerResultsBitEqual": @YES, @"cpuChannelComparisons": @(cpu_comparisons),
    @"cpuMipBoundaryExcludedChannels": @(excluded_mip_boundary_channels),
    @"maxCpuError": @(max_reference_error), @"cpuErrorLimit": @(1.0 / 255.0),
  };
}

NSDictionary* run(const LibraryIdentity& library) {
  TextureRuntime runtime(library);
  id<MTLDevice> device = MTLCreateSystemDefaultDevice();
  if (!device) throw std::runtime_error("Metal device unavailable");
  TextureKernel kernel(device);
  NSMutableArray* cases = [NSMutableArray array];
  const std::array<TextureUpload, 5> fixtures{{
    make_upload(1, 1, 1, 43, 4), make_upload(5, 3, 1, 43, 12),
    make_upload(7, 5, 1, 50, 20), make_upload(3, 2, 3, 43, 4),
    make_upload(8, 4, 1, 43, 8, 4),
  }};
  const std::array<const char*, 5> names{{"one-texel", "odd-rgba-padded", "odd-bgra-padded", "volume-r-wrap", "explicit-mip-levels"}};
  for (std::size_t index = 0; index < fixtures.size(); ++index) {
    std::cerr << "Checking " << names[index] << '\n';
    [cases addObject:check_upload_and_samples(runtime, kernel, fixtures[index], names[index])];
  }
  return @{
    @"status": @"ok", @"librarySha256": library.sha256, @"arm64Uuid": library.uuid,
    @"device": device.name, @"cases": cases,
    @"scope": @"Real AGFX upload/setters/readback; same native texture and original shader with native versus independent sampler; separate CPU spatial/mip reference",
    @"synchronization": @"AGFX finish before access; original compute command waits until completed and checks error",
    @"notCovered": @"Actual effect passes, cross-version CGL parity, HDR, anisotropy other than 1, UI/export state, CPU mag/min transition and fractional-LOD quantization/nearest ties",
  };
}

} // namespace

int main(int argc, const char* argv[]) {
  @autoreleasepool {
    try {
      if (argc != 3 || argv[1][0] != '/' || argv[2][0] != '/') {
        throw std::runtime_error("Usage: agfx-texture-probe /absolute/libAGFX.dylib /absolute/report.json");
      }
      const auto library = agfx_probe::loadVerifiedLibrary({argv[1]});
      const auto report = run(library);
      NSError* error = nil;
      NSData* json = [NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:&error];
      if (!json || ![json writeToFile:@(argv[2]) options:NSDataWritingAtomic error:&error]) {
        throw std::runtime_error("Cannot write diagnostic report");
      }
      std::cerr << "All texture checks passed\n";
      return 0;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      return 1;
    }
  }
}
