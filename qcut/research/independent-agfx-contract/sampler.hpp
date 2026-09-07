#pragma once

#include <cstdint>

namespace agfx_contract {

struct SourceSampler {
  std::int32_t mag;
  std::int32_t min;
  std::int32_t mip;
  std::int32_t wrap_s;
  std::int32_t wrap_t;
  std::int32_t wrap_r;
};

struct MetalSampler {
  std::uint64_t mag;
  std::uint64_t min;
  std::uint64_t mip;
  std::uint64_t wrap_s;
  std::uint64_t wrap_t;
  std::uint64_t wrap_r;

  bool operator==(const MetalSampler&) const = default;
};

// Invalid values leave output unchanged; this is QCut policy, not native behavior.
[[nodiscard]] bool convert_sampler(const SourceSampler& request,
                                   MetalSampler& output) noexcept;

}  // namespace agfx_contract
