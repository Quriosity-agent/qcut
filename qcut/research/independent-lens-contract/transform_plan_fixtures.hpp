#pragma once

#include "transform_plan.hpp"

#include <bit>
#include <cmath>

namespace lens_contract::plan_fixtures {
inline std::vector<AnchorResizeRequest> anchors(std::size_t count = 2048) {
  std::vector<AnchorResizeRequest> result{
      {{0, 0, 1, 1}, {0, 0, 1, 1}}, {{1, 2, 6, 9}, {0, 0, 10, 21}},
      {{4, 5, -4, -5}, {0, 0, 8, 10}}, {{-1, -1, 1, 1}, {-3, 5, 7, -9}},
      {{1, -1, -1, 1}, {0, 0, 3, 7}}, {{0, 0, 1, 1}, {1, 1, 2, 2}},
      {{1000000, 0, 1000001, 2}, {0, 0, 2, 2}},
      {{1000000, 0, 1000002, 2}, {0, 0, 2, 2}},
      {{0, -1000000, 2, -999999}, {0, 0, 2, 2}},
      {{0, -1000000, 2, -999998}, {0, 0, 2, 2}}};
  constexpr float threshold = 0x1.4p-20F;
  for (float near : {std::nextafter(threshold, 0.0F), threshold,
                     std::nextafter(threshold, 1.0F)}) {
    result.push_back({{0, 0, near, 2}, {0, 0, 1, 1}});
    result.push_back({{0, 0, 2, near}, {0, 0, 1, 1}});
  }
  std::uint32_t state = 0x63726f70;
  auto scalar = [&](float denominator) {
    state ^= state << 13; state ^= state >> 17; state ^= state << 5;
    return static_cast<float>(static_cast<int>(state % 200001U) - 100000) / denominator;
  };
  while (result.size() < count) {
    result.push_back({{scalar(137), scalar(91), scalar(119), scalar(73)},
                      {scalar(61), scalar(57), scalar(71), scalar(43)}});
  }
  return result;
}

inline void hash_word(std::uint64_t& fingerprint, std::uint32_t word) {
  for (unsigned shift = 0; shift < 32; shift += 8) {
    fingerprint = (fingerprint ^ ((word >> shift) & 255U)) * 1099511628211ULL;
  }
}

inline void hash_plan(std::uint64_t& fingerprint, const TransformPlan& plan) {
  for (const auto& matrix : {plan.source_to_destination, plan.destination_to_source}) {
    for (float value : matrix) hash_word(fingerprint, std::bit_cast<std::uint32_t>(value));
  }
}

inline std::vector<CropResizeRequest> crops(int width, int height) {
  const float w = static_cast<float>(width), h = static_cast<float>(height);
  std::vector<CropResizeRequest> result;
  for (const auto& target : {std::array{2, 3}, std::array{17, 9}, std::array{65, 37}}) {
    for (const auto& rectangle : {std::array{0.0F, 0.0F, w + 1, h + 1},
                                 std::array{1.0F, 2.0F, w + 3, h + 4},
                                 std::array{-2.0F, -3.0F, w + 5, h + 7},
                                 std::array{w / 3, h / 4, 2.25F, 3.5F},
                                 std::array{-w - 7, -h - 9, w + 1, h + 1},
                                 std::array{0.5F, 0.5F, w + 1, h + 1},
                                 std::array{-0.5F, -0.5F, w + 1, h + 1}}) {
      result.push_back({rectangle[0], rectangle[1], rectangle[2], rectangle[3], target[0], target[1]});
    }
  }
  if (width > 1 && height > 1) result.push_back({0, 0, w, h, width, height});
  return result;
}
}  // namespace lens_contract::plan_fixtures
