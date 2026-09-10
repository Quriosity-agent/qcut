#include "cv_plane_format_mutations.hpp"
#include "cv_plane_format_native_support.hpp"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

using agfx_contract::PlaneFormatRequest;
using namespace agfx_test;
using namespace agfx_test::diagnostic;

// A phase is a bounded family of requests. Every phase compares each request
// against the model twice over: the recognition flags and every output word,
// including the fields the native entries leave untouched.
struct PhaseResult {
  std::size_t combos = 0;
  std::size_t mismatches = 0;
  std::size_t gles_recognized = 0;
  std::size_t amg_recognized = 0;
  std::size_t metal_recognized = 0;
  std::size_t accepted_records = 0;
  std::uint64_t accepted_fingerprint = fnv_offset;
  std::uint64_t fingerprint = fnv_offset;
  std::string witness;
};

std::string describe(const PlaneFormatRequest& request, const PlaneObservation& native,
                     const PlaneObservation& model) {
  std::ostringstream text;
  text << std::hex << "source=0x" << request.source_format << " plane=0x" << request.plane_index
       << " bgra=" << (request.prefer_bgra ? 1 : 0) << " native{" << native.gles_recognized << ","
       << native.gles.format << "," << native.gles.type << "," << native.gles.internal_format << ","
       << native.gles.flag << "," << native.amg_recognized << "," << native.amg << ","
       << native.metal << "} model{" << model.gles_recognized << "," << model.gles.format << ","
       << model.gles.type << "," << model.gles.internal_format << "," << model.gles.flag << ","
       << model.amg_recognized << "," << model.amg << "," << model.metal << "}";
  return text.str();
}

// `hash_all` decides whether every record enters the fingerprint or only the
// accepted ones. The exhaustive phase uses the accepted-only form: 2^32 records
// of preserved sentinels carry no information and hashing them all would cost
// more than the differential itself.
void compare(PhaseResult& result, const NativePlaneResolver& native_resolver,
             const PlaneFormatRequest& request, Mutation mutation, bool hash_all) {
  const auto native = native_resolver.observe(request);
  const auto model = mutation == Mutation::faithful ? observe(request)
                                                    : observe_mutated(mutation, request);
  ++result.combos;
  if (native != model) {
    ++result.mismatches;
    if (result.witness.empty()) result.witness = describe(request, native, model);
    return;
  }
  result.gles_recognized += native.gles_recognized ? 1 : 0;
  result.amg_recognized += native.amg_recognized ? 1 : 0;
  result.metal_recognized += native.metal != 0 ? 1 : 0;
  const bool accepted = native.gles_recognized || native.amg_recognized || native.metal != 0;
  if (accepted) {
    ++result.accepted_records;
    hash_observation(result.accepted_fingerprint, request, native);
  }
  if (hash_all) hash_observation(result.fingerprint, request, native);
}

// Wide plane indices, the sign-bit sources and the rejected neighbours of every
// accepted code. This is the phase that separates a 64-bit plane test from a
// 32-bit one, because 0x100000000 has all-zero low words.
PhaseResult boundary_phase(const NativePlaneResolver& native, Mutation mutation) {
  PhaseResult result;
  for (const auto source : boundary_sources) {
    for (const auto plane : boundary_planes) {
      for (const bool prefer_bgra : {false, true}) {
        compare(result, native, {source, plane, prefer_bgra}, mutation, true);
        if (!result.witness.empty()) return result;
      }
    }
  }
  return result;
}

// Constants, their neighbourhoods, every single-bit variant and a fixed LCG
// sweep. This is the domain whose fingerprint the standalone tests pin.
PhaseResult focused_phase(const NativePlaneResolver& native, Mutation mutation) {
  PhaseResult result;
  const auto sources = fixture_sources();
  for (const auto source : sources) {
    for (const auto plane : sweep_planes) {
      for (const bool prefer_bgra : {false, true}) {
        compare(result, native, {source, plane, prefer_bgra}, mutation, true);
        if (!result.witness.empty()) return result;
      }
    }
  }
  return result;
}

// All 2^32 four-character codes against both plane classes and both flag
// values. Stops at the first difference so that a mutation reports a witness
// instead of a count.
PhaseResult exhaustive_phase(const NativePlaneResolver& native, Mutation mutation) {
  PhaseResult result;
  for (std::uint64_t source = 0; source <= 0xffffffffULL; ++source) {
    const auto code = static_cast<std::uint32_t>(source);
    for (const auto plane : sweep_planes) {
      for (const bool prefer_bgra : {false, true}) {
        compare(result, native, {code, plane, prefer_bgra}, mutation, false);
      }
    }
    if (!result.witness.empty()) return result;
  }
  return result;
}

struct BufferPhase {
  std::size_t created = 0;
  std::size_t declined = 0;
  std::size_t comparisons = 0;
  std::size_t mismatches = 0;
  std::size_t recognized = 0;
  std::string witness;
  std::string declined_codes;
};

std::string fourcc_text(std::uint32_t code) {
  std::string text(4, ' ');
  for (int index = 0; index < 4; ++index) {
    const auto byte = static_cast<char>((code >> ((3 - index) * 8)) & 0xffU);
    text[static_cast<std::size_t>(index)] = byte >= 32 && byte < 127 ? byte : '?';
  }
  return text;
}

// The secondary entry needs a real CVPixelBufferRef, so CVPixelBufferCreate is
// the only source of inputs. Codes CoreVideo declines are reported, never
// simulated, and none of this feeds the exhaustive counts above.
BufferPhase buffer_phase(const NativePlaneResolver& native) {
  BufferPhase result;
  NSDictionary* attributes = @{
    (__bridge NSString*)kCVPixelBufferIOSurfacePropertiesKey : @{},
  };
  for (const auto source : buffer_probe_sources) {
    CVPixelBufferRef buffer = nullptr;
    const auto status = CVPixelBufferCreate(kCFAllocatorDefault, 64, 64, source,
                                            (__bridge CFDictionaryRef)attributes, &buffer);
    if (status != kCVReturnSuccess || buffer == nullptr) {
      ++result.declined;
      if (!result.declined_codes.empty()) result.declined_codes += " ";
      result.declined_codes += fourcc_text(source);
      if (buffer) CFRelease(buffer);
      continue;
    }
    ++result.created;
    const auto actual = static_cast<std::uint32_t>(CVPixelBufferGetPixelFormatType(buffer));
    for (const bool prefer_bgra : {false, true}) {
      const auto observed = native.buffer_format(buffer, prefer_bgra);
      const auto expected = agfx_contract::resolve_buffer_pixel_format(actual, prefer_bgra);
      ++result.comparisons;
      if (observed != expected) {
        ++result.mismatches;
        if (result.witness.empty()) {
          std::ostringstream text;
          text << std::hex << "source=0x" << actual << " bgra=" << (prefer_bgra ? 1 : 0)
               << " native=" << observed << " model=" << expected;
          result.witness = text.str();
        }
      } else if (observed != 0) {
        ++result.recognized;
      }
    }
    CFRelease(buffer);
  }
  return result;
}

// The high half of x0 and a bool argument outside {0,1} are ABI observations,
// reported separately because the declared C++ signatures do not admit them.
std::string abi_observations(const NativePlaneResolver& native) {
  // Resolved straight into the wider signatures so that no incompatible
  // function type is ever formed; both still have to land on the pinned offset.
  using WideSource = std::uint64_t (*)(std::uint64_t, std::size_t, bool);
  using WideFlag = std::uint64_t (*)(std::uint32_t, std::size_t, unsigned);
  const auto wide_source = agfx_probe::resolve<WideSource>(native.library(), kMetalSymbol.name);
  const auto wide_flag = agfx_probe::resolve<WideFlag>(native.library(), kMetalSymbol.name);
  const auto expected =
      reinterpret_cast<std::uintptr_t>(native.library().base) + kMetalSymbol.offset;
  require(reinterpret_cast<std::uintptr_t>(wide_source) == expected &&
              reinterpret_cast<std::uintptr_t>(wide_flag) == expected,
          "The ABI observation resolved a different address than the pinned entry");
  const std::uint64_t garbage = 0xdeadbeef00000000ULL | 0x42475241ULL;
  std::ostringstream text;
  text << "{\"high_word_ignored\":" << (wide_source(garbage, 0, false) == 70 ? "true" : "false")
       << ",\"bool_0x100_takes_the_bgra_branch\":"
       << (wide_flag(0x42475241U, 0, 0x100U) == 80 ? "true" : "false") << "}";
  return text.str();
}

// Counting the bytes the library writes to the standard descriptors before and
// after the real singleton is silenced. The silenced count is a precondition of
// the exhaustive run and is itself a negative control on the harness: a run that
// reports no noisy bytes has proved nothing about the silencing.
struct LogCheck {
  std::size_t noisy_bytes = 0;
  std::size_t silenced_bytes = 0;
};

LogCheck log_check(const NativePlaneResolver& native) {
  LogCheck result;
  const auto reject_many = [&native] {
    for (std::uint32_t index = 0; index < 20000; ++index) {
      volatile auto value = native.observe({index, 0, false}).metal;
      (void)value;
    }
  };
  {
    OutputCapture capture;
    reject_many();
    result.noisy_bytes = capture.restore();
  }
  native.silence_logs();
  {
    OutputCapture capture;
    reject_many();
    result.silenced_bytes = capture.restore();
  }
  return result;
}

void emit_phase(std::ostream& out, const char* name, const PhaseResult& phase) {
  out << "\"" << name << "\":{\"combos\":" << phase.combos
      << ",\"mismatches\":" << phase.mismatches
      << ",\"values_compared\":" << phase.combos * 8
      << ",\"gles_recognized\":" << phase.gles_recognized
      << ",\"amg_recognized\":" << phase.amg_recognized
      << ",\"metal_recognized\":" << phase.metal_recognized
      << ",\"accepted_records\":" << phase.accepted_records << ",\"accepted_fingerprint\":\""
      << std::hex << phase.accepted_fingerprint << std::dec << "\",\"fingerprint\":\"" << std::hex
      << phase.fingerprint << std::dec << "\",\"witness\":\"" << phase.witness << "\"}";
}

}  // namespace

int main(int argc, char** argv) {
  try {
    require(argc >= 2, "Usage: agfx-cv-plane-native-oracle /absolute/libAGFX.dylib [--mutations]");
    bool run_mutations = false;
    bool run_exhaustive = true;
    for (int index = 2; index < argc; ++index) {
      const std::string flag = argv[index];
      if (flag == "--mutations") run_mutations = true;
      else if (flag == "--skip-exhaustive") run_exhaustive = false;
      else require(false, "Unknown flag: " + flag);
    }
    const NativePlaneResolver native(argv[1]);
    const auto logs = log_check(native);
    require(logs.noisy_bytes > 0,
            "The unsilenced log system wrote nothing; the control would be vacuous");
    require(logs.silenced_bytes == 0,
            "The silenced log system still wrote to a standard descriptor");
    const auto abi = abi_observations(native);

    OutputCapture capture;
    const auto started = std::chrono::steady_clock::now();
    const auto boundary = boundary_phase(native, Mutation::faithful);
    const auto focused = focused_phase(native, Mutation::faithful);
    PhaseResult exhaustive;
    if (run_exhaustive) exhaustive = exhaustive_phase(native, Mutation::faithful);
    const auto buffers = buffer_phase(native);
    const auto seconds =
        std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count();
    const auto quiet_bytes = capture.restore();

    std::ostringstream mutations;
    if (run_mutations) {
      for (unsigned index = 1; index < static_cast<unsigned>(Mutation::count); ++index) {
        const auto mutation = static_cast<Mutation>(index);
        auto phase = boundary_phase(native, mutation);
        const char* caught = "boundary";
        if (phase.witness.empty()) {
          phase = focused_phase(native, mutation);
          caught = "focused";
        }
        if (phase.witness.empty() && run_exhaustive) {
          phase = exhaustive_phase(native, mutation);
          caught = "exhaustive";
        }
        const bool detected = !phase.witness.empty();
        if (index > 1) mutations << ",";
        mutations << "{\"mutation\":\"" << mutation_name(mutation) << "\",\"detected\":"
                  << (detected ? "true" : "false") << ",\"phase\":\""
                  << (detected ? caught : "none") << "\",\"combos_before_witness\":" << phase.combos
                  << ",\"witness\":\"" << phase.witness << "\"}";
      }
    }

    std::cout << "{\"library_sha256\":\"" << native.library().sha256.UTF8String
              << "\",\"arm64_uuid\":\"" << native.library().uuid.UTF8String
              << "\",\"log_noisy_bytes\":" << logs.noisy_bytes
              << ",\"log_silenced_bytes\":" << logs.silenced_bytes
              << ",\"vendor_output_bytes_during_run\":" << quiet_bytes << ",\"abi_observations\":"
              << abi << ",\"seconds\":" << seconds << ",";
    emit_phase(std::cout, "boundary", boundary);
    std::cout << ",";
    emit_phase(std::cout, "focused", focused);
    std::cout << ",";
    emit_phase(std::cout, "exhaustive", exhaustive);
    std::cout << ",\"buffer_entry\":{\"created\":" << buffers.created
              << ",\"declined\":" << buffers.declined << ",\"comparisons\":" << buffers.comparisons
              << ",\"mismatches\":" << buffers.mismatches
              << ",\"recognized\":" << buffers.recognized << ",\"declined_codes\":\""
              << buffers.declined_codes << "\",\"witness\":\"" << buffers.witness << "\"}"
              << ",\"mutations\":[" << mutations.str() << "]}\n";
    return boundary.mismatches == 0 && focused.mismatches == 0 && exhaustive.mismatches == 0 &&
                   buffers.mismatches == 0
               ? 0
               : 1;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 2;
  }
}
