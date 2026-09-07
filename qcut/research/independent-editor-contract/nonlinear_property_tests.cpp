#include "nonlinear_property_fixtures.hpp"
#include "wrapped_time.hpp"

#include <cmath>
#include <iostream>

namespace {
using editor_contract::evaluate_nonlinear_property_interval;
using editor_test::require;

struct Fingerprint {
  std::uint64_t calls = 0, values = 0, nan = 0, hash = editor_test::kFnvStart;
  void append(const std::vector<double>& result) {
    for (const auto value : result) {
      const bool is_nan = std::isnan(value);
      editor_test::hash_integer(hash, is_nan ? 0x7ff8000000000000ULL : std::bit_cast<std::uint64_t>(value), 8);
      ++values;
      if (is_nan) ++nan;
    }
    ++calls;
  }
};

void test_native_goldens(Fingerprint& fingerprint) {
  constexpr std::array<std::array<std::uint64_t, 3>, editor_test::kNonlinearGoldenCount> expected{{
    {0x3fe8666660000000ULL, 0x400ce66680000000ULL, 0xc2fc6bf540000000ULL},
    {0x3fd4df7bc0000000ULL, 0x4001e14760000000ULL, 0xc2cdd800a0000000ULL},
    {0x3fec100120000000ULL, 0x4012ac2120000000ULL, 0xc30a8e7520000000ULL},
    {0x3fe68d7460000000ULL, 0x4003d44a00000000ULL, 0xc288412c60000000ULL},
    {0x3fb99999a0000000ULL, 0xbfd3333340000000ULL, 0x430c6bf520000000ULL},
    {0x3feccccccccccccdULL, 0x401c000000000000ULL, 0xc31c6bf526340000ULL},
    {0x3fb99999a0000000ULL, 0xbfd3333340000000ULL, 0x430c6bf520000000ULL},
    {0x3feccccccccccccdULL, 0x401c000000000000ULL, 0xc31c6bf526340000ULL},
    {0x3fb99999a0000000ULL, 0xbfd3333340000000ULL, 0x430c6bf520000000ULL},
    {0x4170000040000000ULL, 0xc170000020000000ULL, 0x3fe0edb880000000ULL},
    {0x8000000000000000ULL, 0x7ff8000000001234ULL, 0xfff0000000000001ULL}
  }};
  for (std::size_t i = 0; i < expected.size(); ++i) {
    const auto fixture = editor_test::nonlinear_golden(i);
    const auto actual = evaluate_nonlinear_property_interval(fixture.segment, fixture.interval(),
        editor_test::nonlinear_golden_query(i));
    require(actual.size() == expected[i].size(), "Native nonlinear golden shape differs");
    for (std::size_t channel = 0; channel < actual.size(); ++channel) {
      require(std::bit_cast<std::uint64_t>(actual[channel]) == expected[i][channel],
              "Native nonlinear golden differs at fixture " + std::to_string(i) + " channel " + std::to_string(channel));
    }
    fingerprint.append(actual);
  }
}

void test_native_fingerprint(Fingerprint& fingerprint) {
  constexpr auto pairs = editor_test::kCurveTypes.size() * editor_test::kCurveTypes.size() - 1;
  for (std::size_t pair = 0; pair < pairs; ++pair) {
    for (std::size_t speed = 0; speed < editor_test::kCurveSpeeds.size(); ++speed) {
      for (std::size_t range = 0; range < editor_test::kCurveRangeCount; ++range) {
        const auto fixture = editor_test::nonlinear_matrix(pair, speed, range);
        for (const auto window : editor_test::nonlinear_windows(fixture)) {
          const auto query = editor_contract::wrapped_midpoint(window.start, window.end);
          fingerprint.append(evaluate_nonlinear_property_interval(fixture.segment, fixture.interval(), query));
        }
      }
    }
  }
  require(fingerprint.calls == 117515 && fingerprint.values == 784545 && fingerprint.nan == 55418,
          "Nonlinear native corpus coverage or NaN classification changed");
  require(fingerprint.hash == 13853290106620421073ULL, "Nonlinear native corpus fingerprint differs");
}

void test_rejected_domain() {
  const auto fixture = editor_test::nonlinear_golden(0);
  const auto reject = [](const editor_test::NonlinearFixture& invalid, std::int64_t query) {
    bool rejected = false;
    try { static_cast<void>(evaluate_nonlinear_property_interval(invalid.segment, invalid.interval(), query)); }
    catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, "Unsupported nonlinear input was silently evaluated");
  };
  for (const auto time : {fixture.left_time, fixture.right_time, fixture.left_time - 1, fixture.right_time + 1}) {
    reject(fixture, time);
  }
  auto invalid = fixture;
  invalid.left_curve = invalid.right_curve = 0;
  reject(invalid, 500000);
  invalid = fixture;
  invalid.left_values.clear();
  reject(invalid, 500000);
  invalid = fixture;
  invalid.right_values.pop_back();
  reject(invalid, 500000);
  invalid = fixture;
  invalid.segment.speed = 0;
  reject(invalid, 500000);
  invalid = fixture;
  invalid.segment.source.duration = -1;
  reject(invalid, 500000);
  invalid = fixture;
  invalid.segment = {{0, 2000}, {0, 100}, 2};
  invalid.left_time = 1000;
  invalid.right_time = 2000;
  reject(invalid, 1500);

  invalid = fixture;
  invalid.left_values.resize((1U << 20) + 1);
  invalid.right_values.resize(invalid.left_values.size());
  bool rejected = false;
  try { static_cast<void>(evaluate_nonlinear_property_interval(invalid.segment, invalid.interval(), 500000)); }
  catch (const std::length_error&) { rejected = true; }
  require(rejected, "Independent nonlinear scalar budget was not enforced");
}
}  // namespace

int main() {
  try {
    Fingerprint fingerprint;
    test_native_goldens(fingerprint);
    test_native_fingerprint(fingerprint);
    test_rejected_domain();
    std::cout << "3 nonlinear groups passed: 11 native goldens, 784545-value native fingerprint, rejected domain\n";
  } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
