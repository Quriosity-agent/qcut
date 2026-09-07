#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include "agfx-library.hpp"

#include "../independent-agfx-contract/pixel_format.hpp"
#include "../independent-agfx-contract/sampler.hpp"

#include <array>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using agfx_probe::LibraryIdentity;
using agfx_probe::loadVerifiedLibrary;
constexpr std::uintptr_t kMetalFormatConverter = 0x8b6e4;
constexpr std::uint64_t kUnwritten = 0x123456789abcdef0ULL;

struct FormatRequest {
  int format;
  MTLPixelFormat expected;
  const char* name;
  bool supported;
};

struct ProbeRequest {
  const LibraryIdentity& library;
  id<MTLDevice> device;
};

struct GuardedOutput {
  std::uint64_t before = 0x0123456789abcdefULL;
  std::uint64_t value;
  std::uint64_t after = 0xfedcba9876543210ULL;
};

std::vector<std::uint32_t> differentialInputs() {
  std::vector<std::uint32_t> inputs;
  inputs.reserve(65536 + 5 + 4096);
  for (std::uint32_t value = 0; value < 65536; ++value) inputs.push_back(value);
  for (const auto value : {0x7fffffffU, 0x80000000U, 0xfffffffeU, 0xffffffffU, 0x10000U}) {
    inputs.push_back(value);
  }
  std::uint32_t state = 0x51435554U;
  for (std::uint32_t index = 0; index < 4096; ++index) {
    state = state * 1664525U + 1013904223U;
    inputs.push_back(state);
  }
  return inputs;
}

NSDictionary* comparePixelFormats(const LibraryIdentity& library) {
  using ConvertFormat = bool (*)(std::uint32_t, std::uint64_t*);
  const auto convert = reinterpret_cast<ConvertFormat>(
      const_cast<std::uint8_t*>(library.base) + kMetalFormatConverter);
  const bool macos11 = [NSProcessInfo processInfo].operatingSystemVersion.majorVersion >= 11;
  const std::array<std::uint64_t, 3> sentinels{{kUnwritten, 0, UINT64_MAX}};
  const auto inputs = differentialInputs();
  NSMutableArray* domainRows = [NSMutableArray array];
  std::size_t comparisons = 0;
  std::size_t recognizedInDomain = 0;
  std::size_t writtenInDomain = 0;
  for (const auto input : inputs) {
    for (const auto sentinel : sentinels) {
      GuardedOutput native{.value = sentinel};
      std::uint64_t independent = sentinel;
      const bool nativeResult = convert(input, &native.value);
      const bool independentResult = agfx_contract::convert_pixel_format({input, macos11}, independent);
      const bool guardsIntact = native.before == 0x0123456789abcdefULL &&
          native.after == 0xfedcba9876543210ULL;
      if (!guardsIntact || nativeResult != independentResult || native.value != independent) {
        throw std::runtime_error("Independent format mismatch for " + std::to_string(input));
      }
      ++comparisons;
      if (input <= 206 && sentinel == kUnwritten) {
        recognizedInDomain += nativeResult;
        writtenInDomain += native.value != sentinel;
        [domainRows addObject:@{
          @"sourceFormat": @(input), @"recognized": @(nativeResult),
          @"outputWritten": @(native.value != sentinel),
          @"output": @(native.value), @"passed": @YES,
        }];
      }
    }
  }
  return @{
    @"inputCount": @(inputs.size()), @"comparisonCount": @(comparisons),
    @"sentinelCount": @(sentinels.size()), @"macos11OrNewer": @(macos11),
    @"inputSpecification": @{
      @"denseInclusiveRange": @[@0, @65535],
      @"additionalValues": @[@0x7fffffffU, @0x80000000U, @0xfffffffeU, @0xffffffffU, @0x10000U],
      @"lcgSeed": @0x51435554U, @"lcgMultiplier": @1664525U,
      @"lcgIncrement": @1013904223U, @"lcgCount": @4096,
      @"lcgRule": @"Update state modulo 2^32, then emit",
    },
    @"mismatchCount": @0,
    @"recognizedIn0Through206": @(recognizedInDomain),
    @"writtenIn0Through206": @(writtenInDomain),
    @"scope": @"Native function return, 64-bit output and adjacent guards compared to independent C++",
    @"olderMacosBranch": @"Static reconstruction and portable tests only; not native-executed",
    @"domainCases": domainRows,
  };
}

template <std::size_t Count>
std::array<std::uint64_t, Count> readSamplerTable(const LibraryIdentity& library, std::size_t offset) {
  std::array<std::uint64_t, Count> table{};
  std::memcpy(table.data(), library.base + offset, sizeof(table));
  return table;
}

NSDictionary* compareSamplers(const ProbeRequest& request) {
  const auto filters = readSamplerTable<2>(request.library, 0x6b88f0);
  const auto mips = readSamplerTable<3>(request.library, 0x6b8900);
  const auto wraps = readSamplerTable<4>(request.library, 0x6b88d0);
  for (std::int32_t code = 0; code < 768; ++code) {
    @autoreleasepool {
      const agfx_contract::SourceSampler source{
        .mag = code % 2, .min = (code / 2) % 2, .mip = (code / 4) % 3,
        .wrap_s = (code / 12) % 4, .wrap_t = (code / 48) % 4, .wrap_r = (code / 192) % 4,
      };
      const agfx_contract::MetalSampler expected{
        filters.at(source.mag), filters.at(source.min), mips.at(source.mip),
        wraps.at(source.wrap_s), wraps.at(source.wrap_t), wraps.at(source.wrap_r),
      };
      agfx_contract::MetalSampler actual{};
      if (!agfx_contract::convert_sampler(source, actual) || actual != expected) {
        throw std::runtime_error("Sampler mapping differs from verified AGFX image tables");
      }
      auto descriptor = [[MTLSamplerDescriptor alloc] init];
      descriptor.magFilter = static_cast<MTLSamplerMinMagFilter>(actual.mag);
      descriptor.minFilter = static_cast<MTLSamplerMinMagFilter>(actual.min);
      descriptor.mipFilter = static_cast<MTLSamplerMipFilter>(actual.mip);
      descriptor.sAddressMode = static_cast<MTLSamplerAddressMode>(actual.wrap_s);
      descriptor.tAddressMode = static_cast<MTLSamplerAddressMode>(actual.wrap_t);
      descriptor.rAddressMode = static_cast<MTLSamplerAddressMode>(actual.wrap_r);
      id<MTLSamplerState> sampler = [request.device newSamplerStateWithDescriptor:descriptor];
      if (!sampler) throw std::runtime_error("Apple rejected a reconstructed sampler descriptor");
    }
  }
  return @{
    @"validCombinations": @768, @"mappingTablesMatched": @YES,
    @"appleSamplerStatesCreated": @768,
    @"scope": @"Verified AGFX image table reads and Apple descriptor allocation; AGFX setter not called",
    @"invalidInputs": @"Independent C++ rejection policy only; native setter has unchecked indices",
  };
}

NSDictionary* probeFormats(const ProbeRequest& request) {
  // This converter's first argument is the enum, not a renderer object.
  using ConvertFormat = bool (*)(int, std::uint64_t*);
  const auto convert = reinterpret_cast<ConvertFormat>(
      const_cast<std::uint8_t*>(request.library.base) + kMetalFormatConverter);
  const std::array<FormatRequest, 7> cases{{
      {43, MTLPixelFormatRGBA8Unorm, "RGBA8Unorm", true},
      {50, MTLPixelFormatBGRA8Unorm, "BGRA8Unorm", true},
      {97, MTLPixelFormatRGBA16Unorm, "RGBA16Unorm", true},
      {128, MTLPixelFormatRG11B10Float, "RG11B10Float", true},
      {127, MTLPixelFormatInvalid, "unsupported", false},
      {0, MTLPixelFormatInvalid, "unsupported", false},
      {206, MTLPixelFormatInvalid, "unsupported", false},
  }};
  NSMutableArray* rows = [NSMutableArray array];
  for (const auto& sample : cases) {
    std::uint64_t output = kUnwritten;
    const bool supported = convert(sample.format, &output);
    const bool conversionPassed = supported == sample.supported &&
        output == (supported ? static_cast<std::uint64_t>(sample.expected) : kUnwritten);
    bool textureCreated = false;
    if (supported && conversionPassed) {
      auto descriptor = [MTLTextureDescriptor
          texture2DDescriptorWithPixelFormat:static_cast<MTLPixelFormat>(output)
                                     width:4
                                    height:3
                                 mipmapped:NO];
      descriptor.storageMode = MTLStorageModeShared;
      descriptor.usage = MTLTextureUsageShaderRead | MTLTextureUsageRenderTarget;
      id<MTLTexture> texture = [request.device newTextureWithDescriptor:descriptor];
      textureCreated = texture && texture.pixelFormat == output;
    }
    const bool passed = conversionPassed && (!supported || textureCreated);
    [rows addObject:@{
      @"agfxFormat": @(sample.format),
      @"supported": @(supported),
      @"metalFormat": supported ? @(output) : [NSNull null],
      @"expectedName": @(sample.name),
      @"outputUnchanged": @(output == kUnwritten),
      @"appleTextureCreated": @(textureCreated),
      @"passed": @(passed),
    }];
    if (!passed) {
      throw std::runtime_error("AGFX format contract mismatch for " +
          std::to_string(sample.format) + ": output=" + std::to_string(output) +
          ", expected=" + std::to_string(sample.expected));
    }
  }
  return @{
    @"status": @"ok",
    @"librarySha256": request.library.sha256,
    @"arm64Uuid": request.library.uuid,
    @"converterOffset": @"0x8b6e4",
    @"device": request.device.name,
    @"scope": @"AGFX format differential, sampler tables and Apple allocations; no effect render",
    @"cases": rows,
    @"formatDifferential": comparePixelFormats(request.library),
    @"samplerDifferential": compareSamplers(request),
  };
}

}  // namespace

int main(int argc, const char* argv[]) {
  @autoreleasepool {
    try {
      if (argc != 2 || argv[1][0] != '/') {
        throw std::runtime_error("Usage: agfx-format-probe /absolute/path/libAGFX.dylib");
      }
      const auto library = loadVerifiedLibrary({argv[1]});
      id<MTLDevice> device = MTLCreateSystemDefaultDevice();
      if (!device) {
        throw std::runtime_error("No Metal device available.");
      }
      const auto report = probeFormats({library, device});
      NSData* data = [NSJSONSerialization dataWithJSONObject:report
                                                   options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys
                                                     error:nil];
      if (!data) {
        throw std::runtime_error("Cannot encode probe report.");
      }
      std::cout.write(static_cast<const char*>(data.bytes), data.length);
      std::cout << '\n';
      // Keep the diagnostic image resident until exit; dyld owns transitive initializers.
      return 0;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      return 1;
    }
  }
}
