#include "lens_contract.hpp"

#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <mach-o/loader.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>

namespace {
using namespace lens_contract;
using NativePoints = std::vector<std::pair<float, float>>;
constexpr char expected_sha[] =
    "8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf";
constexpr std::array<unsigned char, 16> expected_uuid{
    0x24, 0x88, 0x72, 0xf2, 0x77, 0x36, 0x32, 0xa9,
    0xa4, 0x8b, 0xdc, 0x5d, 0xfe, 0xe2, 0x0c, 0x99};

void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

std::string sha256(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  require(static_cast<bool>(stream), "Cannot read the library");
  CC_SHA256_CTX context{};
  CC_SHA256_Init(&context);
  std::array<char, 65536> block{};
  while (stream.read(block.data(), static_cast<std::streamsize>(block.size())) ||
         stream.gcount() != 0) {
    CC_SHA256_Update(&context, block.data(), static_cast<CC_LONG>(stream.gcount()));
  }
  require(stream.eof(), "Library read failed");
  std::array<unsigned char, CC_SHA256_DIGEST_LENGTH> digest{};
  CC_SHA256_Final(digest.data(), &context);
  std::ostringstream result;
  result << std::hex << std::setfill('0');
  for (unsigned char byte : digest) result << std::setw(2) << static_cast<unsigned>(byte);
  return result.str();
}

void validate_loaded_image(void* symbol) {
  Dl_info info{};
  require(dladdr(symbol, &info) != 0, "Cannot locate the loaded image");
  const auto* header = static_cast<const mach_header_64*>(info.dli_fbase);
  require(header && header->magic == MH_MAGIC_64 && header->cputype == CPU_TYPE_ARM64,
          "Unexpected loaded architecture");
  const auto* cursor = reinterpret_cast<const unsigned char*>(header + 1);
  const auto* end = cursor + header->sizeofcmds;
  for (std::uint32_t index = 0; index < header->ncmds; ++index) {
    require(cursor + sizeof(load_command) <= end, "Malformed load commands");
    const auto* command = reinterpret_cast<const load_command*>(cursor);
    require(command->cmdsize >= sizeof(load_command) && cursor + command->cmdsize <= end,
            "Malformed load command size");
    if (command->cmd == LC_UUID) {
      require(command->cmdsize >= sizeof(uuid_command), "Malformed UUID command");
      const auto* uuid = reinterpret_cast<const uuid_command*>(cursor);
      require(std::equal(expected_uuid.begin(), expected_uuid.end(), uuid->uuid),
              "Unknown loaded library UUID");
      return;
    }
    cursor += command->cmdsize;
  }
  throw std::runtime_error("Loaded library has no UUID");
}

class Oracle {
 public:
  explicit Oracle(const std::string& path) {
    require(std::filesystem::path(path).is_absolute(), "Library path must be absolute");
    require(sha256(path) == expected_sha, "Unknown library SHA256; no native call made");
    handle_ = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle_) throw std::runtime_error(dlerror());
  }
  ~Oracle() { if (handle_) dlclose(handle_); }
  Oracle(const Oracle&) = delete;
  Oracle& operator=(const Oracle&) = delete;

  template <typename Function>
  Function symbol(const char* name) const {
    void* address = dlsym(handle_, name);
    require(address != nullptr, std::string("Missing symbol: ") + name);
    validate_loaded_image(address);
    return reinterpret_cast<Function>(address);
  }

 private:
  void* handle_ = nullptr;
};

struct Comparison {
  const char* name;
  std::size_t cases = 0;
  std::size_t values = 0;
  std::size_t different_bits = 0;
  double maximum_absolute_error = 0;

  template <typename Value>
  void compare(Value own, Value native) {
    require(std::isfinite(own) && std::isfinite(native), "Nonfinite result in valid-domain oracle");
    ++values;
    const bool different = std::memcmp(&own, &native, sizeof(Value)) != 0;
    if (different) ++different_bits;
    maximum_absolute_error = std::max(maximum_absolute_error,
                                     std::abs(static_cast<double>(own) - native));
    if (different) {
      std::ostringstream message;
      message << std::setprecision(17) << name << " case " << cases << " value "
              << values << ": independent=" << own << ", native=" << native;
      throw std::runtime_error(message.str());
    }
  }
};

class Samples {
 public:
  double next() {
    state_ ^= state_ << 13;
    state_ ^= state_ >> 17;
    state_ ^= state_ << 5;
    return (static_cast<int>(state_ % 20001U) - 10000) / 17.125;
  }
 private:
  std::uint32_t state_ = 0x6c656e73U;
};

void matrix_comparison(const Oracle& oracle, Comparison& products, Comparison& inverses) {
  const auto native_multiply = oracle.symbol<void (*)(double*, double*, double*)>(
      "_ZN4LENS9ALGORITHM7MoveSys4Util12MatrixMul3x3EPA3_dS4_S4_");
  const auto native_inverse = oracle.symbol<void (*)(double*, double*)>(
      "_ZN4LENS9ALGORITHM7MoveSys4Util12MatrixInv3x3EPA3_dS4_");
  Samples samples;
  for (int test = 0; test < 1000; ++test) {
    Matrix3 a{}, b{}, native{}, own{};
    for (auto& value : a) value = samples.next();
    for (auto& value : b) value = samples.next();
    native_multiply(a.data(), b.data(), native.data());
    require(multiply(a, b, own), "Valid multiply rejected");
    for (std::size_t index = 0; index < own.size(); ++index) products.compare(own[index], native[index]);
    ++products.cases;
    for (std::size_t index : {0U, 4U, 8U}) a[index] += 2000;
    native_inverse(a.data(), native.data());
    require(inverse(a, own), "Valid inverse rejected");
    for (std::size_t index = 0; index < own.size(); ++index) inverses.compare(own[index], native[index]);
    ++inverses.cases;
  }
}

void gaussian_comparison(const Oracle& oracle, Comparison& kernels, Comparison& smoothed) {
  const auto native_kernel = oracle.symbol<std::vector<double> (*)(int, double)>(
      "_ZN4LENS9ALGORITHM7MoveSys4Util11GaussKernelEid");
  const auto native_smooth = oracle.symbol<void (*)(std::vector<float>&, int, double)>(
      "_ZN4LENS9ALGORITHM7MoveSys4Util11GaussSmoothERNSt3__16vectorIfNS3_9allocatorIfEEEEid");
  Samples samples;
  for (int length = 1; length <= 65; ++length) {
    for (double sigma : {0.001, 0.1, 0.7, 1.0, 3.0, 11.25, 1000.0}) {
      const auto native = native_kernel(length, sigma);
      std::vector<double> own;
      require(gaussian_kernel({length, sigma}, own) && own.size() == native.size(),
              "Kernel size differs");
      for (std::size_t index = 0; index < own.size(); ++index) kernels.compare(own[index], native[index]);
      ++kernels.cases;
      if (length % 2 == 0) continue;
      for (std::size_t count : {0U, 1U, 2U, 7U, 31U, 257U}) {
        std::vector<float> input(count);
        for (float& value : input) value = static_cast<float>(samples.next());
        std::vector<float> native_output = input;
        std::vector<float> own_output;
        native_smooth(native_output, length, sigma);
        require(gaussian_smooth(input, {length, sigma}, own_output) &&
                    own_output.size() == native_output.size(), "Smoothing size differs");
        for (std::size_t index = 0; index < count; ++index) {
          smoothed.compare(own_output[index], native_output[index]);
        }
        ++smoothed.cases;
      }
    }
  }
}

void point_comparison(const Oracle& oracle, Comparison& rotations, Comparison& warps) {
  const auto native_rotate = oracle.symbol<void (*)(NativePoints&, float, float, float)>(
      "_ZN4LENS9ALGORITHM7MoveSys4Util6RotateERNSt3__16vectorINS3_4pairIffEENS3_9allocatorIS6_EEEEfff");
  const auto native_warp = oracle.symbol<void (*)(NativePoints&, const void*)>(
      "_ZN4LENS9ALGORITHM7MoveSys4Util7WarpPtsERNSt3__16vectorINS3_4pairIffEENS3_9allocatorIS6_EEEERKNS1_5RigidE");
  Samples samples;
  for (int test = 0; test < 300; ++test) {
    const auto count = static_cast<std::size_t>(test % 67);
    std::vector<Point> input(count);
    NativePoints native(count);
    for (std::size_t index = 0; index < count; ++index) {
      input[index] = {static_cast<float>(samples.next()), static_cast<float>(samples.next())};
      native[index] = {input[index].x, input[index].y};
    }
    const Rotation rotation{static_cast<float>(samples.next()),
                            {static_cast<float>(samples.next()), static_cast<float>(samples.next())}};
    const auto original = native;
    native_rotate(native, rotation.degrees, rotation.center.x, rotation.center.y);
    std::vector<Point> own;
    require(rotate_points(input, rotation, own), "Valid rotation rejected");
    for (std::size_t index = 0; index < count; ++index) {
      rotations.compare(own[index].x, native[index].first);
      rotations.compare(own[index].y, native[index].second);
    }
    ++rotations.cases;
    native = original;
    const std::array<float, 4> rigid{rotation.center.x, rotation.center.y,
                                    rotation.degrees, static_cast<float>(samples.next() / 100)};
    native_warp(native, rigid.data());
    require(warp_points(input, {rigid[0], rigid[1], rigid[2], rigid[3]}, own),
            "Valid rigid transform rejected");
    for (std::size_t index = 0; index < count; ++index) {
      warps.compare(own[index].x, native[index].first);
      warps.compare(own[index].y, native[index].second);
    }
    ++warps.cases;
  }
}

void print(const char* name, const Comparison& comparison, bool comma) {
  std::cout << "  \"" << name << "\": {\"cases\": " << comparison.cases
            << ", \"values\": " << comparison.values << ", \"differentBits\": "
            << comparison.different_bits << ", \"maximumAbsoluteError\": "
            << comparison.maximum_absolute_error << '}' << (comma ? ",\n" : "\n");
}
}  // namespace

int main(int argc, char** argv) {
  try {
    require(argc == 2, "Usage: lens-native-oracle /absolute/path/liblens.dylib");
    std::cout.flush();
    const int result_descriptor = dup(STDOUT_FILENO);
    require(result_descriptor >= 0 && dup2(STDERR_FILENO, STDOUT_FILENO) >= 0,
            "Cannot isolate native diagnostic output");
    const Oracle oracle(argv[1]);
    Comparison products{"multiply"}, inverses{"inverse"}, kernels{"kernel"},
        smoothed{"smooth"}, rotations{"rotate"}, warps{"warp"};
    matrix_comparison(oracle, products, inverses);
    gaussian_comparison(oracle, kernels, smoothed);
    point_comparison(oracle, rotations, warps);
    std::fflush(stdout);
    require(dup2(result_descriptor, STDOUT_FILENO) >= 0,
            "Cannot restore result output");
    close(result_descriptor);
    std::cout << std::setprecision(17) << "{\n  \"sha256\": \"" << expected_sha
              << "\",\n  \"arm64Uuid\": \"248872F2-7736-32A9-A48B-DC5DFEE20C99\",\n";
    print("multiply", products, true);
    print("inverse", inverses, true);
    print("kernel", kernels, true);
    print("smooth", smoothed, true);
    print("rotate", rotations, true);
    print("warp", warps, false);
    std::cout << "}\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
