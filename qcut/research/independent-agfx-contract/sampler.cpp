#include "sampler.hpp"

#include <array>
#include <cstddef>

namespace agfx_contract {
namespace {

constexpr std::array<std::uint64_t, 2> kFilter{0, 1};
constexpr std::array<std::uint64_t, 3> kMip{0, 1, 2};
constexpr std::array<std::uint64_t, 4> kWrap{2, 0, 5, 3};

bool valid_index(std::int32_t value, std::size_t count) noexcept {
  return value >= 0 && static_cast<std::size_t>(value) < count;
}

}  // namespace

bool convert_sampler(const SourceSampler& request,
                     MetalSampler& output) noexcept {
  if (!valid_index(request.mag, kFilter.size()) ||
      !valid_index(request.min, kFilter.size()) ||
      !valid_index(request.mip, kMip.size()) ||
      !valid_index(request.wrap_s, kWrap.size()) ||
      !valid_index(request.wrap_t, kWrap.size()) ||
      !valid_index(request.wrap_r, kWrap.size())) {
    return false;
  }

  output = {
      kFilter[static_cast<std::size_t>(request.mag)],
      kFilter[static_cast<std::size_t>(request.min)],
      kMip[static_cast<std::size_t>(request.mip)],
      kWrap[static_cast<std::size_t>(request.wrap_s)],
      kWrap[static_cast<std::size_t>(request.wrap_t)],
      kWrap[static_cast<std::size_t>(request.wrap_r)],
  };
  return true;
}

}  // namespace agfx_contract
