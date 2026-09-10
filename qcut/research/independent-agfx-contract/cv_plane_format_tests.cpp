#include "cv_plane_format_fixtures.hpp"
#include "cv_plane_format_mutations.hpp"
#include "pixel_format.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>

namespace {

using agfx_contract::GlesPlaneFormat;
using agfx_contract::PlaneFormatRequest;
using namespace agfx_test;

constexpr std::uint32_t sentinel = plane_format_sentinel;

// Fingerprints and counts recorded by the native oracle against libAGFX
// 4fa8758d..., UUID 408EB610-AD47-3846-9595-14B6A3ABF537. They are native
// observations; nothing below regenerates them from this implementation.
constexpr std::uint64_t native_boundary_fingerprint = 0xc23d0e62e5dcb791ULL;
constexpr std::uint64_t native_focused_fingerprint = 0xdb74a7ba9ee56b17ULL;
constexpr std::uint64_t native_exhaustive_accepted_fingerprint = 0xdea4ebd7ee69873fULL;
constexpr std::size_t native_focused_combos = 807852;
constexpr std::size_t native_focused_gles_recognized = 84;
constexpr std::size_t native_focused_amg_recognized = 84;
constexpr std::size_t native_focused_metal_recognized = 76;

void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

struct GoldenRecord {
  PlaneFormatRequest request;
  PlaneObservation observation;
};

// Every accepted combination in the 2^32 sweep, written out as the native
// entries answered it and in the order the sweep visits them: source ascending,
// then plane, then the flag. `sentinel` marks a field the native code does not
// write, so the table carries the write mask as well as the values.
constexpr std::array<GoldenRecord, 28> golden{{
    // '2C08' is accepted by the GLES and AMGPixelFormat trees and by neither
    // plane of the Metal tree, which has no branch for it at all.
    {{0x32433038U, 0, false}, {true, {0x8227U, 0x1401U, 0x822bU, 0x1000U}, true, 22U, 0U}},
    {{0x32433038U, 0, true}, {true, {0x8227U, 0x1401U, 0x822bU, 0x1000U}, true, 22U, 0U}},
    {{0x32433038U, 1, false}, {true, {0x8227U, 0x1401U, 0x822bU, 0x1000U}, true, 22U, 0U}},
    {{0x32433038U, 1, true}, {true, {0x8227U, 0x1401U, 0x822bU, 0x1000U}, true, 22U, 0U}},
    // '420f' folds onto the per-plane keys; the Metal tree answers directly.
    {{0x34323066U, 0, false}, {true, {0x1903U, 0x1401U, 0x8229U, 0x4000U}, true, 2U, 10U}},
    {{0x34323066U, 0, true}, {true, {0x1903U, 0x1401U, 0x8229U, 0x4000U}, true, 2U, 10U}},
    {{0x34323066U, 1, false}, {true, {0x8227U, 0x1401U, 0x822bU, 0x1000U}, true, 22U, 30U}},
    {{0x34323066U, 1, true}, {true, {0x8227U, 0x1401U, 0x822bU, 0x1000U}, true, 22U, 30U}},
    // '420v' differs from '420f' only in the bit the plane entries clear.
    {{0x34323076U, 0, false}, {true, {0x1903U, 0x1401U, 0x8229U, 0x4000U}, true, 2U, 10U}},
    {{0x34323076U, 0, true}, {true, {0x1903U, 0x1401U, 0x8229U, 0x4000U}, true, 2U, 10U}},
    {{0x34323076U, 1, false}, {true, {0x8227U, 0x1401U, 0x822bU, 0x1000U}, true, 22U, 30U}},
    {{0x34323076U, 1, true}, {true, {0x8227U, 0x1401U, 0x822bU, 0x1000U}, true, 22U, 30U}},
    // 'BGRA' is the only code the flag reaches, and it never writes the fourth
    // GLES output; the internal format stays RGBA on both sides.
    {{0x42475241U, 0, false}, {true, {0x1908U, 0x1401U, 0x1908U, sentinel}, true, 43U, 70U}},
    {{0x42475241U, 0, true}, {true, {0x80e1U, 0x1401U, 0x1908U, sentinel}, true, 43U, 80U}},
    {{0x42475241U, 1, false}, {true, {0x1908U, 0x1401U, 0x1908U, sentinel}, true, 43U, 70U}},
    {{0x42475241U, 1, true}, {true, {0x80e1U, 0x1401U, 0x1908U, sentinel}, true, 43U, 80U}},
    // 'L008' reaches A8Unorm on the Metal tree and code 2 on the AMG tree,
    // which the delivered format table then resolves to R8Unorm.
    {{0x4c303038U, 0, false}, {true, {0x1903U, 0x1401U, 0x8229U, 0x4000U}, true, 2U, 1U}},
    {{0x4c303038U, 0, true}, {true, {0x1903U, 0x1401U, 0x8229U, 0x4000U}, true, 2U, 1U}},
    {{0x4c303038U, 1, false}, {true, {0x1903U, 0x1401U, 0x8229U, 0x4000U}, true, 2U, 1U}},
    {{0x4c303038U, 1, true}, {true, {0x1903U, 0x1401U, 0x8229U, 0x4000U}, true, 2U, 1U}},
    {{0x52476841U, 0, false}, {true, {0x1908U, 0x140bU, 0x881aU, sentinel}, true, 103U, 115U}},
    {{0x52476841U, 0, true}, {true, {0x1908U, 0x140bU, 0x881aU, sentinel}, true, 103U, 115U}},
    {{0x52476841U, 1, false}, {true, {0x1908U, 0x140bU, 0x881aU, sentinel}, true, 103U, 115U}},
    {{0x52476841U, 1, true}, {true, {0x1908U, 0x140bU, 0x881aU, sentinel}, true, 103U, 115U}},
    {{0x66646570U, 0, false}, {true, {0x1903U, 0x1406U, 0x822eU, sentinel}, true, 106U, 55U}},
    {{0x66646570U, 0, true}, {true, {0x1903U, 0x1406U, 0x822eU, sentinel}, true, 106U, 55U}},
    {{0x66646570U, 1, false}, {true, {0x1903U, 0x1406U, 0x822eU, sentinel}, true, 106U, 55U}},
    {{0x66646570U, 1, true}, {true, {0x1903U, 0x1406U, 0x822eU, sentinel}, true, 106U, 55U}},
}};

std::string hex(std::uint64_t value) {
  std::ostringstream text;
  text << "0x" << std::hex << value;
  return text.str();
}

std::string context(const PlaneFormatRequest& request) {
  return "source " + hex(request.source_format) + " plane " + hex(request.plane_index) + " bgra " +
         std::to_string(request.prefer_bgra ? 1 : 0);
}

void test_recognized_combinations_match_the_native_golden_table() {
  for (const auto& record : golden) {
    const auto observation = observe(record.request);
    require(observation == record.observation,
            "Recognized combination differs from the native record at " + context(record.request));
  }
  // The table is the complete accepted set of the sweep, so its fingerprint has
  // to be the accepted-record fingerprint the oracle reported over all 2^32.
  std::uint64_t fingerprint = fnv_offset;
  for (const auto& record : golden) {
    hash_observation(fingerprint, record.request, record.observation);
  }
  require(fingerprint == native_exhaustive_accepted_fingerprint,
          "The golden table is not the accepted set the native sweep recorded");
}

void test_unwritten_outputs_keep_every_bit() {
  constexpr std::array<std::uint32_t, 4> seeds{0U, 1U, 0x5a5a5a5aU,
                                               std::numeric_limits<std::uint32_t>::max()};
  constexpr std::array<std::uint32_t, 3> preserves_flag{0x42475241U, 0x52476841U, 0x66646570U};
  constexpr std::array<std::uint32_t, 8> rejected{
      0U, 1U, 0x4c303037U, 0x4c303039U, 0x32433039U, 0x42475242U, 0x80000000U, 0xffffffffU};
  for (const auto seed : seeds) {
    for (const auto source : preserves_flag) {
      for (const auto plane : boundary_planes) {
        GlesPlaneFormat output{seed, seed, seed, seed};
        require(agfx_contract::resolve_gles_plane_format({source, plane, false}, output),
                "A recognized source was rejected");
        require(output.flag == seed, "The fourth GLES output was written on a preserving branch");
      }
    }
    for (const auto source : rejected) {
      for (const auto plane : boundary_planes) {
        for (const bool prefer_bgra : {false, true}) {
          const PlaneFormatRequest request{source, plane, prefer_bgra};
          GlesPlaneFormat output{seed, seed, seed, seed};
          require(!agfx_contract::resolve_gles_plane_format(request, output),
                  "A rejected source was accepted at " + context(request));
          require(output == GlesPlaneFormat{seed, seed, seed, seed},
                  "A rejected source wrote a GLES output at " + context(request));
          std::uint32_t amg = seed;
          require(!agfx_contract::resolve_amg_plane_format(request, amg),
                  "A rejected source was accepted by the AMG entry at " + context(request));
          require(amg == seed, "A rejected source wrote the AMG output at " + context(request));
          require(agfx_contract::resolve_metal_plane_format(request) == 0,
                  "A rejected source produced a Metal format at " + context(request));
        }
      }
    }
  }
}

void test_plane_index_is_compared_over_sixty_four_bits() {
  // Only zero is the luminance plane. 0x100000000 has all-zero low words and is
  // the value that separates the native 64-bit test from a truncated one.
  for (const auto source : {0x34323066U, 0x34323076U}) {
    std::uint32_t luminance = sentinel;
    require(agfx_contract::resolve_amg_plane_format({source, 0, false}, luminance) &&
                luminance == 2U,
            "Plane zero is not the luminance plane");
    for (const auto plane : boundary_planes) {
      if (plane == 0) continue;
      std::uint32_t chroma = sentinel;
      require(agfx_contract::resolve_amg_plane_format({source, plane, false}, chroma) &&
                  chroma == 22U,
              "A non-zero plane index did not select chroma");
      require(agfx_contract::resolve_metal_plane_format({source, plane, false}) == 30U,
              "A non-zero plane index did not select the Metal chroma format");
    }
  }
  // Sources outside the biplanar pair ignore the plane entirely.
  for (const auto plane : boundary_planes) {
    require(agfx_contract::resolve_metal_plane_format({0x4c303038U, plane, false}) == 1U,
            "The plane index changed a single-plane source");
  }
}

void test_bit_folding_accepts_exactly_two_biplanar_codes() {
  // The mask clears one bit and the folded target already has that bit clear,
  // so the folded comparison has exactly the two preimages '420f' and '420v'.
  static_assert(~0xffffffefU == 0x10U);
  static_assert((0x34323066U & 0x10U) == 0U);
  static_assert((0x34323076U & 0xffffffefU) == 0x34323066U);
  for (const auto source : {0x34323066U, 0x34323076U}) {
    std::uint32_t amg = sentinel;
    require(agfx_contract::resolve_amg_plane_format({source, 0, false}, amg) && amg == 2U,
            "A biplanar code was not folded onto the luminance key");
  }
  for (const auto near_miss : {0x34323065U, 0x34323067U, 0x34323075U, 0x34323077U, 0x34323046U,
                               0x34323166U, 0x35323066U}) {
    std::uint32_t amg = sentinel;
    require(!agfx_contract::resolve_amg_plane_format({near_miss, 0, false}, amg),
            "A neighbour of the biplanar pair was folded onto it");
    require(amg == sentinel, "A rejected neighbour wrote the AMG output");
  }
  // A source that only becomes an accepted code after masking stays rejected.
  for (const auto accepted : {0x4c303038U, 0x32433038U, 0x42475241U, 0x52476841U, 0x66646570U}) {
    const std::uint32_t partner = accepted | 0x10U;
    if (partner == accepted) continue;
    std::uint32_t amg = sentinel;
    require(!agfx_contract::resolve_amg_plane_format({partner, 0, false}, amg),
            "The mask was applied to a source outside the biplanar fold");
    require(amg == sentinel, "A rejected masked partner wrote the AMG output");
  }
}

void test_metal_tree_is_not_the_gles_tree() {
  // Four differences, each verified against the native golden table above.
  require(agfx_contract::resolve_metal_plane_format({0x32433038U, 0, false}) == 0,
          "The Metal tree accepted '2C08'");
  std::uint32_t amg = sentinel;
  require(agfx_contract::resolve_amg_plane_format({0x32433038U, 0, false}, amg) && amg == 22U,
          "The AMG tree rejected '2C08'");
  require(agfx_contract::resolve_metal_plane_format({0x4c303038U, 0, false}) == 1U,
          "'L008' is not A8Unorm on the Metal tree");
  require(agfx_contract::resolve_metal_plane_format({0x34323066U, 0, false}) == 10U,
          "The luminance plane is not R8Unorm on the Metal tree");
  require(agfx_contract::resolve_metal_plane_format({0x42475241U, 0, false}) == 70U &&
              agfx_contract::resolve_metal_plane_format({0x42475241U, 0, true}) == 80U,
          "The Metal flag does not select the BGRA order");
  // The flag never reaches the AMGPixelFormat entry, which has no such argument.
  for (const auto& record : golden) {
    auto flipped = record.request;
    flipped.prefer_bgra = !flipped.prefer_bgra;
    std::uint32_t first = sentinel;
    std::uint32_t second = sentinel;
    require(agfx_contract::resolve_amg_plane_format(record.request, first) ==
                agfx_contract::resolve_amg_plane_format(flipped, second),
            "The flag changed AMG recognition at " + context(record.request));
    require(first == second, "The flag changed the AMG output at " + context(record.request));
  }
}

void test_amg_outputs_close_onto_the_delivered_format_table() {
  // Every AMGPixelFormat this unit can emit, from both the plane entries and
  // the CoreVideo-buffer entry, has to be a code the delivered converter knows.
  constexpr std::array<std::uint32_t, 9> emitted{2U, 22U, 43U, 103U, 106U, 15U, 50U, 82U, 97U};
  for (const auto code : emitted) {
    std::uint64_t metal = 0;
    require(agfx_contract::convert_pixel_format({code, true}, metal),
            "The delivered format table does not know AMG code " + std::to_string(code));
  }
  const auto metal_of = [](std::uint32_t code) {
    std::uint64_t value = 0;
    agfx_contract::convert_pixel_format({code, true}, value);
    return value;
  };
  require(metal_of(43U) == 70U && metal_of(50U) == 80U,
          "The BGRA pair does not agree with the Metal plane entry");
  require(metal_of(22U) == 30U, "The chroma code does not agree with the Metal plane entry");
  require(metal_of(103U) == 115U && metal_of(106U) == 55U,
          "The half-float and depth codes do not agree with the Metal plane entry");
  // Both single-component codes converge on R8Unorm even though the two entries
  // pick different AMG values for the same source.
  require(metal_of(2U) == 10U && metal_of(15U) == 10U,
          "The two single-component AMG codes do not converge");
  // The documented divergence: the direct Metal answer for 'L008' is A8Unorm,
  // while routing the same source through the AMG code reaches R8Unorm.
  require(agfx_contract::resolve_metal_plane_format({0x4c303038U, 0, false}) == 1U &&
              metal_of(2U) == 10U,
          "The 'L008' divergence between the two routes has disappeared");
}

void test_buffer_entry_is_a_narrower_tree() {
  struct BufferCase {
    std::uint32_t source;
    std::uint32_t without_flag;
    std::uint32_t with_flag;
  };
  constexpr std::array<BufferCase, 12> cases{{
      {0x26424741U, 43U, 50U},   // '&BGA' lossless 32BGRA
      {0x2d424741U, 43U, 50U},   // '-BGA' lossy 32BGRA
      {0x42475241U, 43U, 50U},   // 'BGRA'
      {0x4c303038U, 15U, 15U},   // 'L008', code 15 here and code 2 on the plane entry
      {0x52476841U, 103U, 103U}, // 'RGhA'
      {0x66646570U, 106U, 106U}, // 'fdep'
      {0x68646973U, 82U, 82U},   // 'hdis' DisparityFloat16
      {0x6c363472U, 97U, 97U},   // 'l64r' 64RGBALE
      {0x34323066U, 0U, 0U},     // '420f' has no branch on this entry
      {0x34323076U, 0U, 0U},     // '420v' likewise
      {0x32433038U, 0U, 0U},     // '2C08' likewise
      {0xffffffffU, 0U, 0U},
  }};
  for (const auto& item : cases) {
    require(agfx_contract::resolve_buffer_pixel_format(item.source, false) == item.without_flag,
            "Buffer entry differs without the flag for " + hex(item.source));
    require(agfx_contract::resolve_buffer_pixel_format(item.source, true) == item.with_flag,
            "Buffer entry differs with the flag for " + hex(item.source));
  }
  std::uint32_t plane_answer = sentinel;
  require(agfx_contract::resolve_amg_plane_format({0x4c303038U, 0, false}, plane_answer),
          "The plane entry rejected 'L008'");
  require(plane_answer == 2U &&
              agfx_contract::resolve_buffer_pixel_format(0x4c303038U, false) == 15U,
          "The two entries no longer disagree on 'L008'");
}

// The fingerprint domains. Both are hashed exactly the way the oracle hashed
// the native answers, so a divergence anywhere in either domain moves the number.
std::uint64_t boundary_fingerprint() {
  std::uint64_t fingerprint = fnv_offset;
  for (const auto source : boundary_sources) {
    for (const auto plane : boundary_planes) {
      for (const bool prefer_bgra : {false, true}) {
        const PlaneFormatRequest request{source, plane, prefer_bgra};
        hash_observation(fingerprint, request, observe(request));
      }
    }
  }
  return fingerprint;
}

std::uint64_t focused_fingerprint(std::size_t& combos, std::size_t& gles_recognized,
                                  std::size_t& amg_recognized, std::size_t& metal_recognized) {
  std::uint64_t fingerprint = fnv_offset;
  for (const auto source : fixture_sources()) {
    for (const auto plane : sweep_planes) {
      for (const bool prefer_bgra : {false, true}) {
        const PlaneFormatRequest request{source, plane, prefer_bgra};
        const auto observation = observe(request);
        ++combos;
        gles_recognized += observation.gles_recognized ? 1 : 0;
        amg_recognized += observation.amg_recognized ? 1 : 0;
        metal_recognized += observation.metal != 0 ? 1 : 0;
        hash_observation(fingerprint, request, observation);
      }
    }
  }
  return fingerprint;
}

void test_fixture_domains_match_the_native_fingerprints(std::size_t& combos) {
  require(boundary_fingerprint() == native_boundary_fingerprint,
          "The boundary domain differs from the native observations");
  std::size_t gles_recognized = 0;
  std::size_t amg_recognized = 0;
  std::size_t metal_recognized = 0;
  require(focused_fingerprint(combos, gles_recognized, amg_recognized, metal_recognized) ==
              native_focused_fingerprint,
          "The focused domain differs from the native observations");
  require(combos == native_focused_combos, "The focused domain changed size");
  require(gles_recognized == native_focused_gles_recognized &&
              amg_recognized == native_focused_amg_recognized &&
              metal_recognized == native_focused_metal_recognized,
          "The focused acceptance counts differ from the native run");
}

// The deliberately wrong variants. Each is a single localized error; the pinned
// fixtures above must separate every one of them from the delivered tree except
// the pivot signedness, which no input in the whole 2^32 space can expose.
std::size_t test_mutations_are_separated_by_the_pinned_fixtures() {
  std::size_t detected = 0;
  const auto differs = [](Mutation mutation) {
    for (const auto source : boundary_sources) {
      for (const auto plane : boundary_planes) {
        for (const bool prefer_bgra : {false, true}) {
          const PlaneFormatRequest request{source, plane, prefer_bgra};
          if (observe_mutated(mutation, request) != observe(request)) return true;
        }
      }
    }
    for (const auto source : fixture_sources()) {
      for (const auto plane : sweep_planes) {
        for (const bool prefer_bgra : {false, true}) {
          const PlaneFormatRequest request{source, plane, prefer_bgra};
          if (observe_mutated(mutation, request) != observe(request)) return true;
        }
      }
    }
    return false;
  };
  require(!differs(Mutation::faithful),
          "The mutation harness does not reproduce the delivered implementation");
  for (unsigned index = 1; index < static_cast<unsigned>(Mutation::count); ++index) {
    const auto mutation = static_cast<Mutation>(index);
    const bool separated = differs(mutation);
    if (mutation == Mutation::unsigned_pivot) {
      require(!separated,
              "The pivot signedness became observable; the undetected variant must be restated");
      continue;
    }
    require(separated, "The fixtures do not separate mutation " + mutation_name(mutation));
    ++detected;
  }
  return detected;
}

void test_the_unit_carries_no_floating_point() {
  // Discipline 4's non-finite clause has no subject here: every input and every
  // output is an integer, so there is no NaN, no signed zero and no rounding.
  static_assert(std::is_integral_v<decltype(PlaneFormatRequest::source_format)>);
  static_assert(std::is_integral_v<decltype(PlaneFormatRequest::plane_index)>);
  static_assert(std::is_integral_v<decltype(GlesPlaneFormat::format)>);
  static_assert(std::is_integral_v<decltype(GlesPlaneFormat::flag)>);
  static_assert(std::is_integral_v<decltype(agfx_contract::resolve_metal_plane_format(
                    PlaneFormatRequest{0, 0, false}))>);
  static_assert(std::is_integral_v<decltype(agfx_contract::resolve_buffer_pixel_format(0, false))>);
}

}  // namespace

int main() {
  try {
    test_recognized_combinations_match_the_native_golden_table();
    test_unwritten_outputs_keep_every_bit();
    test_plane_index_is_compared_over_sixty_four_bits();
    test_bit_folding_accepts_exactly_two_biplanar_codes();
    test_metal_tree_is_not_the_gles_tree();
    test_amg_outputs_close_onto_the_delivered_format_table();
    test_buffer_entry_is_a_narrower_tree();
    std::size_t combos = 0;
    test_fixture_domains_match_the_native_fingerprints(combos);
    const auto detected = test_mutations_are_separated_by_the_pinned_fixtures();
    test_the_unit_carries_no_floating_point();
    std::cout << "CV plane format contract passed: " << golden.size()
              << " native golden combinations, " << combos
              << " focused combinations against the pinned native fingerprint, 64-bit plane "
                 "boundaries, preserved outputs, the buffer entry table and "
              << detected << " of "
              << static_cast<unsigned>(Mutation::count) - 2
              << " separated error variants (the pivot signedness stays unobservable).\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
