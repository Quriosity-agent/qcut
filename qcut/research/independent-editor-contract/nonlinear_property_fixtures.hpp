#pragma once

#include "nonlinear_property.hpp"
#include "test_support.hpp"

#include <algorithm>
#include <array>
#include <bit>
#include <limits>

namespace editor_test {

struct NonlinearFixture {
  editor_contract::ConstantSpeedSegment segment{{0, 1000000}, {5000000, 1000000}, 1};
  std::int64_t left_time = 10000, right_time = 990000;
  std::int32_t left_curve = 1, right_curve = 2;
  editor_contract::ControlOffset left_incoming{-310000, -1.7}, left_outgoing{200000, .9};
  editor_contract::ControlOffset right_incoming{-200000, -.2}, right_outgoing{910000, 5};
  std::vector<double> left_values{.1, -.3, 1000000000000000.0}, right_values{.9, 7, -2000000000000000.0};

  editor_contract::NonlinearPropertyInterval interval() const {
    return {{left_time, left_values, left_curve, left_incoming, left_outgoing},
            {right_time, right_values, right_curve, right_incoming, right_outgoing}};
  }
};

inline constexpr std::size_t kNonlinearGoldenCount = 11;

inline NonlinearFixture nonlinear_golden(std::size_t index) {
  NonlinearFixture fixture;
  switch (index) {
    case 0: break;
    case 1: fixture.left_curve = 0; break;
    case 2: fixture.right_curve = 0; break;
    case 3:
      fixture.segment = {{100000, 2000000}, {5000000, 1666666}, 1.2, 731};
      fixture.left_time = 101001;
      fixture.right_time = 2100000;
      fixture.left_curve = -1;
      fixture.right_curve = std::numeric_limits<std::int32_t>::max();
      break;
    case 4: fixture.left_time = 0; fixture.right_time = 1000000; break;
    case 5: fixture.left_time = -10000; fixture.right_time = 2000000; break;
    case 6: fixture.segment.offset = 100000; break;
    case 7:
      fixture.segment.target.duration = 1;
      fixture.left_time = 0;
      fixture.right_time = 1000000;
      break;
    case 8:
      fixture.segment = {{0, 0}, {0, 0}, 1};
      fixture.left_time = -10;
      fixture.right_time = 10;
      break;
    case 9:
      fixture.left_values = {16777217, -16777217, .1};
      fixture.right_values = {16777219, -16777219, .9};
      fixture.left_outgoing.value = 1;
      fixture.right_incoming.value = -1;
      break;
    case 10:
      fixture.left_time = -10000;
      fixture.right_time = 2000000;
      fixture.right_values = {-0.0, std::bit_cast<double>(std::uint64_t{0x7ff8000000001234}),
                                    std::bit_cast<double>(std::uint64_t{0xfff0000000000001})};
      break;
    default: throw std::out_of_range("Unknown nonlinear golden fixture");
  }
  return fixture;
}

inline std::int64_t nonlinear_golden_query(std::size_t index) {
  constexpr std::array<std::int64_t, kNonlinearGoldenCount> queries{
      500000, 300000, 700000, 800731, 1, 1500000, 20000, 500000, 0, 300000, 1500000};
  return queries.at(index);
}

inline constexpr std::array<std::int32_t, 7> kCurveTypes{
    0, 1, 2, 3, -1, std::numeric_limits<std::int32_t>::min(), std::numeric_limits<std::int32_t>::max()};
inline constexpr std::array<double, 9> kCurveSpeeds{.125, .3, .75, 1, 1.2, 2, 8, 1e100, 1e-100};
inline constexpr std::size_t kCurveRangeCount = 8;

inline NonlinearFixture nonlinear_matrix(std::size_t pair, std::size_t speed_index, std::size_t range) {
  NonlinearFixture fixture;
  const auto raw_pair = pair + 1;
  fixture.left_curve = kCurveTypes.at(raw_pair / kCurveTypes.size());
  fixture.right_curve = kCurveTypes.at(raw_pair % kCurveTypes.size());
  const auto index = (pair * kCurveSpeeds.size() + speed_index) * kCurveRangeCount + range;
  constexpr std::array<std::int64_t, 4> starts{0, 100000, -200000, 9007199254740992LL};
  constexpr std::array<std::int64_t, 5> offsets{-100000, -731, 0, 731, 100000};
  const auto start = starts[(pair + range) % starts.size()];
  fixture.segment.source.start = start;
  fixture.segment.speed = kCurveSpeeds.at(speed_index);
  fixture.segment.offset = speed_index == 8 ? 0 : offsets[(pair + range) % offsets.size()];
  const auto duration = range == 7 ? 2000 : 1000000;
  fixture.segment.source.duration = duration;
  fixture.segment.target.duration = speed_index == 8 ? std::numeric_limits<std::int64_t>::max() :
      static_cast<std::int64_t>(duration / fixture.segment.speed);
  if (range == 7) fixture.segment.target.duration = 1;
  constexpr std::array<std::array<std::int64_t, 2>, kCurveRangeCount> bounds{{
      {10000, 990000}, {0, 1000000}, {-10000, 1010000}, {1, 999},
      {-30000, -10000}, {1010000, 1030000}, {1001, 998999}, {0, 2000}}};
  fixture.left_time = start + bounds.at(range)[0];
  fixture.right_time = start + bounds.at(range)[1];
  constexpr std::array<std::size_t, 4> shapes{1, 3, 8, 17};
  fixture.left_values.resize(shapes[index % shapes.size()]);
  fixture.right_values.resize(fixture.left_values.size());
  for (std::size_t i = 0; i < fixture.left_values.size(); ++i) {
    if (index % 7 == 0) {
      fixture.left_values[i] = std::bit_cast<double>(kDoubleBits[(index + i) % kDoubleBits.size()]);
      fixture.right_values[i] = std::bit_cast<double>(kDoubleBits[(index * 7 + i + 3) % kDoubleBits.size()]);
    } else {
      fixture.left_values[i] = (static_cast<double>((index * 17 + i * 23) % 1001) - 500) / 71;
      fixture.right_values[i] = (static_cast<double>((index * 29 + i * 37) % 2001) - 1000) / 93;
    }
  }
  fixture.left_outgoing.time += static_cast<double>(index % 301) + .5;
  fixture.right_incoming.time -= static_cast<double>(index % 127) + .25;
  if (index % 13 == 0) fixture.left_outgoing.time = -450000;
  if (index % 17 == 0) fixture.right_incoming.time = 510000;
  if (index % 19 == 0) fixture.left_incoming.value = std::bit_cast<double>(kDoubleBits[index % kDoubleBits.size()]);
  if (index % 23 == 0) fixture.right_incoming.value = std::bit_cast<double>(kDoubleBits[(index + 5) % kDoubleBits.size()]);
  if (index % 29 == 0) fixture.left_outgoing.time = std::bit_cast<double>(kDoubleBits[(index + 9) % kDoubleBits.size()]);
  return fixture;
}

struct NonlinearWindow { std::int64_t start, end; };

inline std::vector<NonlinearWindow> nonlinear_windows(const NonlinearFixture& fixture) {
  const auto distance = fixture.right_time - fixture.left_time;
  std::vector<std::int64_t> queries{fixture.left_time + 1, fixture.left_time + 999,
      fixture.left_time + 1000, fixture.left_time + distance / 17, fixture.left_time + distance / 4,
      fixture.left_time + distance / 2, fixture.left_time + distance * 3 / 4,
      fixture.right_time - 1000, fixture.right_time - 999, fixture.right_time - 1};
  std::vector<NonlinearWindow> result;
  for (unsigned order = 0; order < 2; ++order) {
    for (const auto query : queries) {
      if (query <= fixture.left_time || query >= fixture.right_time) continue;
      result.push_back({query, query});
      if (query - 1 > fixture.left_time && query + 2 < fixture.right_time) result.push_back({query - 1, query + 2});
    }
    std::reverse(queries.begin(), queries.end());
  }
  return result;
}

}  // namespace editor_test
