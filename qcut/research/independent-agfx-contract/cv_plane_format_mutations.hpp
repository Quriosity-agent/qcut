#pragma once

#include "cv_plane_format_fixtures.hpp"

#include <string>

namespace agfx_test {

// Deliberately wrong variants of the plane resolvers. They exist so that both
// the native differential and the pinned standalone fixtures can be shown to
// reject a decision tree that is close to, but not, the recovered one.
// `faithful` must reproduce cv_plane_format.cpp exactly; every other value is a
// single localized error of the kind a careless reading of the instruction
// stream would produce.
enum class Mutation : unsigned {
  faithful = 0,
  full_mask,               // the bit-0x10 fold is dropped, so '420v' is rejected
  truncated_plane,         // the plane index is compared over 32 bits
  masked_plane_fallback,   // a non-matching key falls back to the masked source
  swapped_plane_key,       // the luma and chroma keys are exchanged
  metal_l008_r8unorm,      // Metal 'L008' "aligned" onto R8Unorm
  metal_accepts_2c08,      // Metal grows the '2C08' branch it does not have
  metal_bgra_swapped,      // the Metal BGRA channel order is inverted
  amg_bgra_follows_bgra,   // the AMG plane entry grows a prefer_bgra output
  bgra_writes_flag,        // the BGRA branch also writes the fourth output
  reject_writes_defaults,  // rejection zeroes the outputs instead of preserving
  unsigned_pivot,          // the 'L007' pivot compared without sign
  count
};

inline std::string mutation_name(Mutation mutation) {
  switch (mutation) {
    case Mutation::faithful: return "faithful";
    case Mutation::full_mask: return "full_mask";
    case Mutation::truncated_plane: return "truncated_plane";
    case Mutation::masked_plane_fallback: return "masked_plane_fallback";
    case Mutation::swapped_plane_key: return "swapped_plane_key";
    case Mutation::metal_l008_r8unorm: return "metal_l008_r8unorm";
    case Mutation::metal_accepts_2c08: return "metal_accepts_2c08";
    case Mutation::metal_bgra_swapped: return "metal_bgra_swapped";
    case Mutation::amg_bgra_follows_bgra: return "amg_bgra_follows_bgra";
    case Mutation::bgra_writes_flag: return "bgra_writes_flag";
    case Mutation::reject_writes_defaults: return "reject_writes_defaults";
    case Mutation::unsigned_pivot: return "unsigned_pivot";
    case Mutation::count: break;
  }
  return "unknown";
}

namespace mutation_detail {

constexpr std::uint32_t k420f = 0x34323066U;
constexpr std::uint32_t k2C08 = 0x32433038U;
constexpr std::uint32_t kBGRA = 0x42475241U;
constexpr std::uint32_t kL007 = 0x4c303037U;
constexpr std::uint32_t kL008 = 0x4c303038U;
constexpr std::uint32_t kRGhA = 0x52476841U;
constexpr std::uint32_t kfdep = 0x66646570U;
constexpr std::uint32_t k420v = 0x34323076U;

inline bool above_pivot(std::uint32_t key, Mutation mutation) noexcept {
  if (mutation == Mutation::unsigned_pivot) return key > kL007;
  return static_cast<std::int32_t>(key) > static_cast<std::int32_t>(kL007);
}

inline std::uint32_t plane_key(std::uint32_t source, std::uint64_t plane,
                               Mutation mutation) noexcept {
  const std::uint32_t mask = mutation == Mutation::full_mask ? 0xffffffffU : 0xffffffefU;
  const std::uint64_t compared =
      mutation == Mutation::truncated_plane ? (plane & 0xffffffffULL) : plane;
  if ((source & mask) != k420f) {
    return mutation == Mutation::masked_plane_fallback ? (source & mask) : source;
  }
  const bool luminance = mutation == Mutation::swapped_plane_key ? compared != 0 : compared == 0;
  return luminance ? kL008 : k2C08;
}

inline bool gles(const agfx_contract::PlaneFormatRequest& request,
                 agfx_contract::GlesPlaneFormat& output, Mutation mutation) noexcept {
  const auto reject = [&] {
    if (mutation == Mutation::reject_writes_defaults) output = {0U, 0U, 0U, 0U};
    return false;
  };
  const auto key = plane_key(request.source_format, request.plane_index, mutation);
  if (above_pivot(key, mutation)) {
    if (key == kL008) {
      output = {0x1903U, 0x1401U, 0x8229U, 0x4000U};
      return true;
    }
    if (key == kRGhA) {
      output.format = 0x1908U;
      output.type = 0x140bU;
      output.internal_format = 0x881aU;
      return true;
    }
    if (key == kfdep) {
      output.format = 0x1903U;
      output.type = 0x1406U;
      output.internal_format = 0x822eU;
      return true;
    }
    return reject();
  }
  if (key == k2C08) {
    output = {0x8227U, 0x1401U, 0x822bU, 0x1000U};
    return true;
  }
  if (key == kBGRA) {
    output.format = request.prefer_bgra ? 0x80e1U : 0x1908U;
    output.type = 0x1401U;
    output.internal_format = 0x1908U;
    if (mutation == Mutation::bgra_writes_flag) output.flag = 0x4000U;
    return true;
  }
  return reject();
}

inline bool amg(const agfx_contract::PlaneFormatRequest& request, std::uint32_t& output,
                Mutation mutation) noexcept {
  const auto reject = [&] {
    if (mutation == Mutation::reject_writes_defaults) output = 0U;
    return false;
  };
  const auto key = plane_key(request.source_format, request.plane_index, mutation);
  if (above_pivot(key, mutation)) {
    if (key == kL008) { output = 2U; return true; }
    if (key == kRGhA) { output = 103U; return true; }
    if (key == kfdep) { output = 106U; return true; }
    return reject();
  }
  if (key == k2C08) { output = 22U; return true; }
  if (key == kBGRA) {
    output = mutation == Mutation::amg_bgra_follows_bgra && request.prefer_bgra ? 50U : 43U;
    return true;
  }
  return reject();
}

inline std::uint64_t metal(const agfx_contract::PlaneFormatRequest& request,
                           Mutation mutation) noexcept {
  const auto source = request.source_format;
  const std::uint64_t plane = mutation == Mutation::truncated_plane
                                  ? (request.plane_index & 0xffffffffULL)
                                  : request.plane_index;
  const std::uint64_t biplanar = plane == 0 ? 10U : 30U;
  if (above_pivot(source, mutation)) {
    if (source == kL008) return mutation == Mutation::metal_l008_r8unorm ? 10U : 1U;
    if (source == kRGhA) return 115U;
    if (source == kfdep) return 55U;
    return 0U;
  }
  if (source == k420f || source == k420v) return biplanar;
  if (source == k2C08 && mutation == Mutation::metal_accepts_2c08) return biplanar;
  if (source == kBGRA) {
    const bool swapped = mutation == Mutation::metal_bgra_swapped;
    return request.prefer_bgra != swapped ? 80U : 70U;
  }
  return 0U;
}

}  // namespace mutation_detail

inline PlaneObservation observe_mutated(Mutation mutation,
                                        const agfx_contract::PlaneFormatRequest& request) noexcept {
  auto observation = seeded_observation();
  observation.gles_recognized = mutation_detail::gles(request, observation.gles, mutation);
  observation.amg_recognized = mutation_detail::amg(request, observation.amg, mutation);
  observation.metal = mutation_detail::metal(request, mutation);
  return observation;
}

}  // namespace agfx_test
