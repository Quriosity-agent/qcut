#pragma once

#include "caption_color.hpp"
#include "test_support.hpp"

#include <array>
#include <bit>
#include <cmath>
#include <limits>
#include <random>
#include <string>
#include <vector>

namespace editor_test {

// The corpus is shared by the standalone tests and the optional diagnostic so that both
// hash exactly the same call sequence. Every draw comes from the engine's specified
// output; no <random> distribution is used, because those are implementation defined and
// the pinned fingerprint has to be reproducible outside this machine.
inline constexpr std::array<double, 17> kCaptionChannels{
    0.0, -0.0, 1.0, 0.5, 0.25, 64.0 / 255.0, 1.0 / 3.0, 0.9999999, 1.0000001, -0.5, 2.0,
    1e-8, std::numeric_limits<double>::infinity(), -std::numeric_limits<double>::infinity(),
    std::numeric_limits<double>::quiet_NaN(), 5e-324, 1e300};

inline constexpr std::array<float, 14> kCaptionProgress{
    0.0f, 1.0f, 0.5f, 0.25f, 4.0f / 17.0f, 1e-7f, 0.9999999f, -0.0f, -1e-7f, 1.0000001f,
    2.0f, -1.0f, std::numeric_limits<float>::quiet_NaN(), std::numeric_limits<float>::infinity()};

inline constexpr std::array<float, 7> kCaptionSweepProgress{
    0.0f, 1.0f, 0.5f, 0.125f, 4.0f / 17.0f, 0.9999999f, 0.3333333f};

// The extremes injected into the pseudorandom part. 8.4e6 and 4e9 sit just beyond the
// int32 range after the 255 scaling, which is how the wrapped channel differences and the
// out-of-table sector are reached at all.
inline constexpr std::array<double, 14> kCaptionExtremes{
    0.0, -0.0, 1.0, -1.0, 1e300, -1e300, std::numeric_limits<double>::infinity(),
    -std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN(),
    5e-324, 8.4e6, -8.4e6, 4e9, -4e9};

inline constexpr std::uint64_t kCaptionCorpusSeed = 20260910;
inline constexpr std::size_t kCaptionRandomCases = 400000;

// A fully specified draw in [-0.2, 1.2): the engine's top 53 bits scaled by 2^-53. This
// replaces uniform_real_distribution, whose bit pattern is not portable.
inline double caption_unit_draw(std::uint64_t raw) noexcept {
  return -0.2 + 1.4 * (static_cast<double>(raw >> 11) * 0x1p-53);
}

template <typename Visit>
void visit_caption_corpus(Visit&& visit) {
  std::vector<double> previous(3), next(3);
  // Boundary cross product. The far side is rotated through the same table so that the
  // two sides disagree on which channel peaks.
  const auto count = kCaptionChannels.size();
  for (std::size_t i = 0; i < count; ++i) {
    for (std::size_t j = 0; j < count; ++j) {
      for (std::size_t k = 0; k < count; ++k) {
        previous = {kCaptionChannels[i], kCaptionChannels[j], kCaptionChannels[k]};
        next = {kCaptionChannels[(i + 5) % count], kCaptionChannels[(j + 9) % count],
                kCaptionChannels[(k + 3) % count]};
        for (const float progress : kCaptionProgress) visit(previous, next, progress);
      }
    }
  }
  // Dense sweep of the unit color cube in sixteenths, with the two sides mirrored.
  for (int i = 0; i <= 16; i += 2) {
    for (int j = 0; j <= 16; j += 2) {
      for (int k = 0; k <= 16; k += 2) {
        previous = {i / 16.0, j / 16.0, k / 16.0};
        next = {(16 - i) / 16.0, (16 - k) / 16.0, j / 16.0};
        for (const float progress : kCaptionSweepProgress) visit(previous, next, progress);
      }
    }
  }
  // Pseudorandom bulk with one in seven channels replaced by an extreme.
  std::mt19937_64 engine(kCaptionCorpusSeed);
  for (std::size_t sample = 0; sample < kCaptionRandomCases; ++sample) {
    for (std::size_t channel = 0; channel < 3; ++channel) {
      const bool extreme_previous = engine() % 7 == 0;
      previous[channel] = extreme_previous ? kCaptionExtremes[engine() % kCaptionExtremes.size()]
                                           : caption_unit_draw(engine());
      const bool extreme_next = engine() % 7 == 0;
      next[channel] = extreme_next ? kCaptionExtremes[engine() % kCaptionExtremes.size()]
                                   : caption_unit_draw(engine());
    }
    float progress = static_cast<float>(engine() % 1001) / 1000.0f;
    if (engine() % 50 == 0) {
      progress = engine() % 2 == 0 ? std::numeric_limits<float>::quiet_NaN()
                                   : static_cast<float>(caption_unit_draw(engine()));
    }
    visit(previous, next, progress);
  }
  // Shape gate. Every combination shorter than three on either side must fall back, and
  // the three-by-three case must not.
  for (std::size_t left = 0; left <= 3; ++left) {
    for (std::size_t right = 0; right <= 3; ++right) {
      const std::vector<double> short_previous(left, 0.5);
      const std::vector<double> short_next(right, 0.25);
      visit(short_previous, short_next, 0.5f);
    }
  }
}

// NaN outputs would only be compared by classification, so the fingerprint canonicalizes
// them. The diagnostic separately reports how many appeared; the observed count is zero,
// because every channel leaves through the integer quantizer.
inline void hash_caption_values(std::uint64_t& fingerprint, const std::vector<double>& values) {
  hash_integer(fingerprint, values.size(), 1);
  for (const double value : values) {
    hash_integer(fingerprint, std::isnan(value) ? 0x7ff8000000000000ULL
                                                : std::bit_cast<std::uint64_t>(value), 8);
  }
}

struct CaptionTypeCase { std::string type; bool heap; };

// The six accepted names plus neighbors that differ only in case, length, padding or an
// embedded null, each in both the inline and the heap string layout.
inline std::vector<CaptionTypeCase> caption_type_corpus() {
  const std::vector<std::string> names{
      "page", "word", "word_unread", "line", "line_unread", "keyword",
      "", "Page", "PAGE", "pages", "pag", "word ", " word", "keyword ", "keywordd",
      "word_unreadx", "line_unrea", "wordunread", "text", "KFTypeTextColor",
      std::string("page\0", 5), std::string("pag\0", 4), std::string("line\0_unread", 12),
      std::string("keyword\0page", 12), std::string(40, 'p')};
  std::vector<CaptionTypeCase> corpus;
  // Reserved up front: a reallocation would move the strings, and only a move keeps the
  // reserved buffer. A copy shrinks back to the inline layout.
  corpus.reserve(names.size() * 2);
  for (const auto& name : names) {
    corpus.push_back({name, false});
    corpus.push_back({name, true});
    // libc++ keeps up to twenty-two characters inline; a reservation moves the buffer out
    // and changes which of the two length encodings the native code reads.
    corpus.back().type.reserve(64);
  }
  return corpus;
}

}  // namespace editor_test
