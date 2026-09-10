#pragma once

#include "cv_plane_format.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

namespace agfx_test {

// Every four-character code either decision tree compares against, including
// the 'L007' pivot that is never accepted and the four codes only the
// CoreVideo-buffer entry knows. The fixture domain is built around these.
inline constexpr std::array<std::uint32_t, 12> plane_format_anchors{
    0x34323066U,  // '420f'
    0x34323076U,  // '420v'
    0x32433038U,  // '2C08'
    0x42475241U,  // 'BGRA'
    0x4c303037U,  // 'L007' pivot
    0x4c303038U,  // 'L008'
    0x52476841U,  // 'RGhA'
    0x66646570U,  // 'fdep'
    0x26424741U,  // '&BGA'
    0x2d424741U,  // '-BGA'
    0x68646973U,  // 'hdis'
    0x6c363472U,  // 'l64r'
};

// Sentinel written into every output before a call so that a preserved field is
// distinguishable from a field the resolver happened to write with the same
// value. 0xAAAAAAAA is not a GL enumerator and not an AMGPixelFormat.
inline constexpr std::uint32_t plane_format_sentinel = 0xaaaaaaaaU;

inline constexpr std::uint64_t fnv_offset = 14695981039346656037ULL;
inline constexpr std::uint64_t fnv_prime = 1099511628211ULL;

inline void hash_integer(std::uint64_t& hash, std::uint64_t value,
                         std::size_t byte_count) noexcept {
  for (std::size_t index = 0; index < byte_count; ++index) {
    hash ^= (value >> (index * 8)) & 0xffU;
    hash *= fnv_prime;
  }
}

// One (source, plane, prefer_bgra) triple resolved through all three plane
// entries, with every output seeded from plane_format_sentinel so the record
// carries the write mask as well as the values.
struct PlaneObservation {
  bool gles_recognized;
  agfx_contract::GlesPlaneFormat gles;
  bool amg_recognized;
  std::uint32_t amg;
  std::uint64_t metal;

  bool operator==(const PlaneObservation&) const = default;
};

inline PlaneObservation seeded_observation() noexcept {
  return {false,
          {plane_format_sentinel, plane_format_sentinel, plane_format_sentinel,
           plane_format_sentinel},
          false,
          plane_format_sentinel,
          0};
}

inline PlaneObservation observe(const agfx_contract::PlaneFormatRequest& request) noexcept {
  auto observation = seeded_observation();
  observation.gles_recognized = agfx_contract::resolve_gles_plane_format(request, observation.gles);
  observation.amg_recognized = agfx_contract::resolve_amg_plane_format(request, observation.amg);
  observation.metal = agfx_contract::resolve_metal_plane_format(request);
  return observation;
}

// Record layout, fixed so that the native oracle and the standalone tests hash
// identical bytes: LE u32 source, LE u64 plane, u8 prefer_bgra, u8 gles return,
// four LE u32 GLES outputs, u8 AMG return, LE u32 AMG output, LE u64 Metal.
inline void hash_observation(std::uint64_t& hash,
                             const agfx_contract::PlaneFormatRequest& request,
                             const PlaneObservation& observation) noexcept {
  hash_integer(hash, request.source_format, 4);
  hash_integer(hash, request.plane_index, 8);
  hash_integer(hash, request.prefer_bgra ? 1U : 0U, 1);
  hash_integer(hash, observation.gles_recognized ? 1U : 0U, 1);
  hash_integer(hash, observation.gles.format, 4);
  hash_integer(hash, observation.gles.type, 4);
  hash_integer(hash, observation.gles.internal_format, 4);
  hash_integer(hash, observation.gles.flag, 4);
  hash_integer(hash, observation.amg_recognized ? 1U : 0U, 1);
  hash_integer(hash, observation.amg, 4);
  hash_integer(hash, observation.metal, 8);
}

// The exhaustive sweep varies the plane between zero and one and toggles
// prefer_bgra; wider plane indices are covered by the boundary fixtures.
inline constexpr std::array<std::uint64_t, 2> sweep_planes{0U, 1U};

inline std::uint32_t next_plane_format_value(std::uint32_t& state) noexcept {
  state = state * 1664525U + 1013904223U;
  return state;
}

// A deterministic entry list, not a set: neighbourhoods overlap and the sweep
// may repeat a value, so the count below is entries rather than unique sources.
inline std::vector<std::uint32_t> fixture_sources() {
  std::vector<std::uint32_t> sources;
  sources.reserve(210000);
  for (const auto anchor : plane_format_anchors) {
    for (std::int32_t delta = -64; delta <= 64; ++delta) {
      sources.push_back(anchor + static_cast<std::uint32_t>(delta));
    }
    for (unsigned bit = 0; bit < 32; ++bit) {
      sources.push_back(anchor ^ (1U << bit));
    }
    sources.push_back(anchor | 0x10U);
    sources.push_back(anchor & 0xffffffefU);
  }
  for (const auto edge : {0U, 1U, 0x7fffffffU, 0x80000000U, 0x80000001U, 0xfffffffeU,
                          0xffffffffU}) {
    sources.push_back(edge);
  }
  std::uint32_t state = 0x41474658U;  // 'AGFX'
  for (std::size_t index = 0; index < 200000; ++index) {
    sources.push_back(next_plane_format_value(state));
  }
  return sources;
}

// Plane indices that probe the 64-bit comparison, including the value whose low
// 32 bits are zero and which therefore separates a 64-bit test from a 32-bit one.
inline constexpr std::array<std::uint64_t, 8> boundary_planes{
    0U, 1U, 2U, 0xffffffffU, 0x100000000ULL, 0x100000001ULL,
    0xfffffffffffffffeULL, 0xffffffffffffffffULL};

// Sources the boundary phase walks against every plane above; the biplanar pair
// is what makes a truncated plane index observable.
inline constexpr std::array<std::uint32_t, 10> boundary_sources{
    0x34323066U, 0x34323076U, 0x32433038U, 0x42475241U, 0x4c303037U,
    0x4c303038U, 0x52476841U, 0x66646570U, 0x00000000U, 0xffffffffU,
};

}  // namespace agfx_test
