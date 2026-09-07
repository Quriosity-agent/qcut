#include "image_warp_native_support.hpp"
#include "image_warp_backend_fixtures.hpp"

#include <unistd.h>
#include <sys/mman.h>

#include <cfenv>
#include <cstdio>
#include <iostream>
#include <memory>
#include <optional>

namespace {
using namespace lens_contract;
using namespace lens_contract::diagnostic;

constexpr char base_symbol[] =
    "_ZN5smash6module5fsnew4base25WarpAffineForRgbaCvtColorERKN9mobilecv23MatERS4_S7_S6_RKNS3_5Size_IiEE";
constexpr char neon_symbol[] =
    "_ZN5smash6module5fsnew4neon25WarpAffineForRgbaCvtColorERKN9mobilecv23MatERS4_S7_S6_RKNS3_5Size_IiEE";
using Transform = void (*)(const void*, void*, const void*, const void*);

class NearStorage {
 public:
  explicit NearStorage(std::size_t bytes) : storage_((bytes + 3) / 4 + 32) {
    std::memset(storage_.data(), 0xd7, storage_.size() * sizeof(float));
  }
  float* matrix() { return storage_.data(); }
  std::uint8_t* pixels() { return reinterpret_cast<std::uint8_t*>(storage_.data() + 16); }
  std::vector<std::uint8_t> snapshot() const {
    const auto* begin = reinterpret_cast<const std::uint8_t*>(storage_.data());
    return {begin, begin + storage_.size() * sizeof(float)};
  }
 private:
  // Float objects provide aligned, writable matrix storage beside pixel object bytes.
  std::vector<float> storage_;
};

class FarStorage {
 public:
  FarStorage(const std::array<float, 6>& matrix, const void* source) {
    const long page_size = sysconf(_SC_PAGESIZE);
    require(page_size >= 4096 && page_size <= 1048576, "Unexpected mmap page size");
    size_ = static_cast<std::size_t>(page_size);
    const auto hint = (reinterpret_cast<std::uintptr_t>(source) ^ (std::uintptr_t{1} << 36)) &
                      ~(static_cast<std::uintptr_t>(size_) - 1);
    // An advisory hint never replaces an existing mapping; actual distance is checked below.
    allocation_ = mmap(reinterpret_cast<void*>(hint), size_, PROT_READ | PROT_WRITE,
                        MAP_PRIVATE | MAP_ANON, -1, 0);
    require(allocation_ != MAP_FAILED, "Cannot allocate distant matrix storage");
    std::memset(allocation_, 0xd7, size_);
    matrix_ = std::construct_at(reinterpret_cast<std::array<float, 6>*>(
                                   static_cast<std::uint8_t*>(allocation_) + 32), matrix);
  }
  ~FarStorage() { munmap(allocation_, size_); }
  FarStorage(const FarStorage&) = delete;
  FarStorage& operator=(const FarStorage&) = delete;
  float* matrix() { return matrix_->data(); }
  bool unchanged(const std::array<float, 6>& expected) const {
    if (std::memcmp(matrix_->data(), expected.data(), sizeof(expected)) != 0) return false;
    const auto* bytes = static_cast<const std::uint8_t*>(allocation_);
    for (std::size_t index = 0; index < size_; ++index) {
      if (index >= 32 && index < 32 + sizeof(expected)) continue;
      if (bytes[index] != 0xd7) return false;
    }
    return true;
  }
 private:
  void* allocation_ = MAP_FAILED;
  std::size_t size_ = 0;
  std::array<float, 6>* matrix_ = nullptr;
};

struct Totals {
  std::size_t cases = 0, bytes = 0, simd_predicate = 0, vector_width = 0;
  std::size_t fallback_stride = 0, fallback_distance = 0, base_differences = 0;
  std::uint64_t fingerprint = 14695981039346656037ULL;
  void compare(const std::vector<std::uint8_t>& own, const GuardedBytes& native) {
    native.guards();
    require(own.size() == native.length, "Native output size differs");
    for (std::size_t index = 0; index < own.size(); ++index) {
      if (own[index] != native.storage[index + 32]) {
        throw std::runtime_error("Native pixel mismatch at case " + std::to_string(cases) +
                                 " byte " + std::to_string(index));
      }
      fingerprint = (fingerprint ^ own[index]) * 1099511628211ULL;
    }
    bytes += own.size();
  }
};

struct NativeFunctions {
  Construct construct;
  Destroy destroy;
  Warp neon;
  Transform transform;
};

void compare_case(const NativeFunctions& native, const std::array<int, 2>& size,
                  std::size_t layout, const AffineWarpRequest& request, Totals& totals) {
  const auto stride = static_cast<std::size_t>(size[0]) * 4 + (layout == 1 ? 7U : 0U);
  const auto length = stride * static_cast<std::size_t>(size[1]);
  NearStorage storage(length);
  std::copy(request.source_to_destination.begin(), request.source_to_destination.end(), storage.matrix());
  std::optional<FarStorage> far;
  if (layout == 2) far.emplace(request.source_to_destination, storage.pixels());
  float* matrix = far ? far->matrix() : storage.matrix();
  for (std::size_t index = 0; index < length; ++index) storage.pixels()[index] = fixtures::pixel_byte(index);
  const auto source_before = storage.snapshot();
  const auto count = static_cast<std::size_t>(request.width) * static_cast<std::size_t>(request.height);
  GuardedBytes rgba(count * 4), bgr(count * 3);
  NativeMat input(native.construct, native.destroy, size[1], size[0], 24, storage.pixels(), stride);
  NativeMat output(native.construct, native.destroy, request.height, request.width, 24, rgba.data(),
                   static_cast<std::size_t>(request.width) * 4);
  NativeMat color(native.construct, native.destroy, request.height, request.width, 16, bgr.data(),
                  static_cast<std::size_t>(request.width) * 3);
  NativeMat transform(native.construct, native.destroy, 2, 3, 5, matrix, 12);
  require(input.externally_owned() && output.externally_owned(), "Unexpected native buffer ownership");
  const auto source_address = reinterpret_cast<std::uintptr_t>(storage.pixels());
  const auto matrix_address = reinterpret_cast<std::uintptr_t>(matrix);
  const auto distance = source_address > matrix_address ? source_address - matrix_address
                                                       : matrix_address - source_address;
  const bool near = distance / 4 < 0x1fffffffU;
  require(near == (layout != 2), "Address-distance fixture does not exercise the intended branch");
  require(input.continuous() == (layout != 1 || size[1] == 1), "Native continuity flag differs");
  const bool simd = input.continuous() && near;
  totals.simd_predicate += simd;
  totals.vector_width += simd && request.width >= 8;
  totals.fallback_stride += !input.continuous();
  totals.fallback_distance += input.continuous() && !near;
  const std::array target_size{request.width, request.height};
  if (request.backend == AffineWarpBackend::fsnew) {
    native.neon(input.address(), color.address(), output.address(), transform.address(), target_size.data());
  } else {
    native.transform(input.address(), output.address(), transform.address(), target_size.data());
  }
  input.unchanged_storage(storage.pixels(), size[0], size[1]);
  output.unchanged_storage(rgba.data(), request.width, request.height);
  color.unchanged_storage(bgr.data(), request.width, request.height);
  transform.unchanged_storage(matrix, 3, 2);
  require(storage.snapshot() == source_before &&
              (!far || far->unchanged(request.source_to_destination)) &&
              std::fegetround() == FE_TONEAREST,
          "Native changed source/guards/matrix or rounding mode");
  AffineWarpResult own;
  const RgbaImageView view{{storage.pixels(), length}, size[0], size[1], stride};
  require(warp_affine_rgba(view, request, own), "Independent backend rejected fixture");
  totals.compare(own.rgba, rgba);
  if (request.backend == AffineWarpBackend::fsnew) totals.compare(own.bgr, bgr);
  if (request.backend == AffineWarpBackend::image_transform) {
    AffineWarpResult base;
    auto base_request = request;
    base_request.backend = AffineWarpBackend::fsnew;
    require(warp_affine_rgba(view, base_request, base), "Base counterfactual rejected fixture");
    totals.base_differences += base.rgba != own.rgba;
  }
  ++totals.cases;
}

void print(const char* name, const Totals& totals) {
  std::cout << "  \"" << name << "\": {\"cases\": " << totals.cases
            << ", \"comparedBytes\": " << totals.bytes << ", \"differentBytes\": 0"
            << ", \"simdPredicateCases\": " << totals.simd_predicate
            << ", \"simdWidthAtLeast8Cases\": " << totals.vector_width
            << ", \"strideFallbackCases\": " << totals.fallback_stride
            << ", \"distanceFallbackCases\": " << totals.fallback_distance
            << ", \"differentFromBaseCases\": " << totals.base_differences
            << ", \"fnv1a64\": \"" << std::hex << totals.fingerprint << std::dec << "\"}";
}
}  // namespace

int main(int argc, char** argv) {
  const int report = dup(STDOUT_FILENO);
  try {
    require(argc == 2 && report >= 0, "Usage: lens-warp-backend-native-oracle /absolute/liblens.dylib");
    require(std::fegetround() == FE_TONEAREST, "Oracle requires FE_TONEAREST");
    require(dup2(STDERR_FILENO, STDOUT_FILENO) >= 0, "Cannot redirect native output");
    Totals neon, transform, boundary;
    {
      Oracle oracle(argv[1]);
      const NativeFunctions native{
          oracle.offset<Construct>(base_symbol, 0x2f4054, 0x220f0c),
          oracle.offset<Destroy>(base_symbol, 0x2f4054, 0x21e9ec),
          oracle.symbol<Warp>(neon_symbol),
          oracle.offset<Transform>(base_symbol, 0x2f4054, 0x28917c)};
      auto transforms = matrices();
      transforms.insert(transforms.end(), fixtures::boundary_matrices.begin(), fixtures::boundary_matrices.end());
      for (const auto& matrix : fixtures::boundary_matrices) {
        compare_case(native, {65, 37}, 0, {matrix, 65, 37, AffineWarpBackend::image_transform}, boundary);
      }
      for (const auto size : {std::array{1, 1}, std::array{2, 3}, std::array{7, 5},
                              std::array{8, 5}, std::array{15, 9}, std::array{16, 9},
                              std::array{17, 9}, std::array{31, 33}, std::array{32, 33},
                              std::array{63, 37}, std::array{64, 37}, std::array{65, 37},
                              std::array{257, 145}}) {
        for (std::size_t layout : {0U, 1U, 2U}) {
          for (std::size_t index = 0; index < transforms.size(); ++index) {
            AffineWarpRequest request{transforms[index], size[0] + static_cast<int>(index % 3),
                                       size[1] + static_cast<int>((index / 3) % 3)};
            compare_case(native, size, layout, request, neon);
            request.backend = AffineWarpBackend::image_transform;
            compare_case(native, size, layout, request, transform);
          }
        }
      }
    }
    require(transform.base_differences > 0, "Boundary fixtures failed to distinguish ImageTransform");
    std::fflush(stdout);
    require(dup2(report, STDOUT_FILENO) >= 0, "Cannot restore report output");
    close(report);
    std::cout << "{\n  \"matrixFixtures\": 282, \"sourceSizes\": 13, \"layouts\": 3,\n";
    print("neon", neon);
    std::cout << ",\n";
    print("imageTransform", transform);
    std::cout << ",\n";
    print("imageTransformBoundary", boundary);
    std::cout << ",\n  \"sourceGuardsMatrixAndRoundingModeUnchanged\": true\n}\n";
  } catch (const std::exception& error) {
    if (report >= 0) close(report);
    std::cerr << error.what() << '\n';
    return 1;
  }
}
