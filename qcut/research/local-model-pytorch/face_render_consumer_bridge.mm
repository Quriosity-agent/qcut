// Research-only replay into process-owned results before native rendering.
#include "../jianying-runtime-probe/probe-utils.h"
#include "../jianying-runtime-probe/filter-host-support.h"
#include "../jianying-runtime-probe/amazer-context-scope.h"
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <array>
#include <cmath>
#include <cstring>
#include <exception>
#include <fstream>
#include <iomanip>
#include <map>
#include <set>
#include <thread>
#include <type_traits>
#include <vector>

namespace jianying_probe { namespace { struct SwingDeviceTextureDataProbe; } }

namespace {
using Seek = int (*)(void*, std::int64_t,
    const jianying_probe::SwingDeviceTextureDataProbe*,
    const jianying_probe::SwingDeviceTextureDataProbe*);
Seek originalSeek = nullptr;
void* core = nullptr;
std::ofstream records;
std::map<void*, std::size_t> observedAlgorithms;
using Update = std::uint64_t (*)(void*, void*, void*, std::uint64_t, void*, double);
struct Shadow {
  std::array<void*, 36> table{};
  Update original = nullptr;
};
std::map<void*, Shadow> shadows;
struct PointRestore {
  void* destination = nullptr;
  std::array<float, 212> coordinates{};
};
std::vector<PointRestore> restorations;
double pointShift = 0;
bool traceUpdates = false;
struct ReplayFace { int id; std::array<float, 212> coordinates; };
struct ReplayFrame { std::int64_t timestamp; std::vector<ReplayFace> faces; };
std::vector<ReplayFrame> replay;
std::size_t replayCursor = 0;
std::size_t nativeUpdateCalls = 0;
std::thread::id seekThread;
std::exception_ptr updateError;
void writeFaces(const void* buffer);

template <typename Value>
Value readValue(std::ifstream& stream) {
  Value value{};
  if (!stream.read(reinterpret_cast<char*>(&value), sizeof(value)))
    throw std::runtime_error("truncated replay payload");
  return value;
}

void loadReplay(const char* path, int width, int height) {
  std::ifstream stream(path, std::ios::binary);
  const auto magic = readValue<std::array<char, 8>>(stream);
  if (magic != std::array<char, 8>{'Q', 'C', 'F', 'A', 'C', 'E', '1', '\0'} ||
      readValue<std::uint32_t>(stream) != static_cast<std::uint32_t>(width) ||
      readValue<std::uint32_t>(stream) != static_cast<std::uint32_t>(height))
    throw std::runtime_error("replay version or dimensions mismatch");
  const auto count = readValue<std::uint32_t>(stream);
  if (count < 1 || count > 64) throw std::runtime_error("invalid replay frame count");
  for (std::uint32_t index = 0; index < count; ++index) {
    ReplayFrame frame{.timestamp = readValue<std::int64_t>(stream), .faces = {}};
    const auto faceCount = readValue<std::uint32_t>(stream);
    if (frame.timestamp < 0 || frame.timestamp > 100'000 ||
        (!replay.empty() && frame.timestamp < replay.back().timestamp) || faceCount > 10)
      throw std::runtime_error("invalid replay timestamp or face count");
    std::set<int> ids;
    for (std::uint32_t faceIndex = 0; faceIndex < faceCount; ++faceIndex) {
      ReplayFace face{.id = readValue<std::int32_t>(stream), .coordinates = {}};
      if (face.id < 0 || !ids.insert(face.id).second)
        throw std::runtime_error("invalid replay face identity");
      face.coordinates = readValue<std::array<float, 212>>(stream);
      for (float value : face.coordinates)
        if (!std::isfinite(value) || value < 0 || value > 1)
          throw std::runtime_error("invalid normalized replay landmark");
      frame.faces.push_back(face);
    }
    replay.push_back(frame);
  }
  if (stream.peek() != std::ifstream::traits_type::eof())
    throw std::runtime_error("trailing replay payload");
}

bool readMemory(const void* address, void* output, std::size_t size) {
  mach_vm_size_t actual = 0;
  return address != nullptr && size > 0 && size <= 4096 &&
         mach_vm_read_overwrite(mach_task_self(),
             reinterpret_cast<mach_vm_address_t>(address), size,
             reinterpret_cast<mach_vm_address_t>(output), &actual) == KERN_SUCCESS &&
         actual == size;
}

template <typename Value>
Value field(const void* object, std::size_t offset) {
  Value result{};
  if (object == nullptr || !readMemory(static_cast<const unsigned char*>(object) + offset,
                  &result, sizeof(result))) {
    throw std::runtime_error("unreadable bounded object field");
  }
  return result;
}

PointRestore readLandmarks(const void* face) {
  const void* points = field<void*>(face, 0x20);
  const auto first = field<std::uintptr_t>(points, 0x10);
  const auto last = field<std::uintptr_t>(points, 0x18);
  if (first == 0 || last < first || last - first != 848)
    throw std::runtime_error("expected 106 XY landmarks");
  PointRestore restore{.destination = reinterpret_cast<void*>(first)};
  if (!readMemory(restore.destination, restore.coordinates.data(), sizeof(restore.coordinates)))
    throw std::runtime_error("unreadable landmarks");
  for (float value : restore.coordinates)
    if (!std::isfinite(value)) throw std::runtime_error("non-finite landmarks");
  return restore;
}

void writeLandmarks(void* destination, const std::array<float, 212>& coordinates) {
  if (mach_vm_write(mach_task_self(), reinterpret_cast<mach_vm_address_t>(destination),
                    reinterpret_cast<vm_offset_t>(coordinates.data()), sizeof(coordinates)) != KERN_SUCCESS)
    throw std::runtime_error("cannot write process-owned landmark span");
}

std::uintptr_t imageOffset(const void* address) {
  Dl_info info{};
  return dladdr(address, &info) == 0 ? 0 :
      reinterpret_cast<std::uintptr_t>(address) -
      reinterpret_cast<std::uintptr_t>(info.dli_fbase);
}

void* imageBase() {
  Dl_info image{};
  if (dladdr(reinterpret_cast<void*>(originalSeek), &image) == 0)
    throw std::runtime_error("missing pinned image base");
  return image.dli_fbase;
}

std::uint64_t tracedUpdate(void* algorithm, void* input, void* segments,
                          std::uint64_t flag, void* context, double timestamp) {
  std::uint64_t result = 0;
  try {
    if (std::this_thread::get_id() != seekThread)
      throw std::runtime_error("parallel algorithm update is unsupported");
    result = shadows.at(algorithm).original(
        algorithm, input, segments, flag, context, timestamp);
    ++nativeUpdateCalls;
    if (updateError) return result;
    const void* manager = field<void*>(algorithm, 0x178);
    using RawResult = void* (*)(const void*, int, int, int);
    using GraphIndex = int (*)(const void*);
    const auto getRaw = reinterpret_cast<RawResult>(
        static_cast<unsigned char*>(imageBase()) + 0x25e3af8);
    const auto getGraph = reinterpret_cast<GraphIndex>(
        static_cast<unsigned char*>(imageBase()) + 0x25e3ff8);
    const int graph = manager == nullptr ? -1 : getGraph(manager);
    const void* buffer = graph < 0 ? nullptr : getRaw(manager, graph, 0, 4);
    const auto expected = static_cast<unsigned char*>(dlsym(core, "_ZTVN4Bach10FaceBufferE"));
    if (buffer == nullptr) return result;
    if (expected == nullptr || field<void*>(buffer, 0) != expected + 16)
      throw std::runtime_error("update result is not a FaceBuffer");
#ifdef QCUT_FACE_RESULT_HOOK
    inspectOwnedResult(buffer);
#endif
#ifdef QCUT_FACE_BINDING_HOOK
    inspectOwnedAdapter(algorithm);
#endif
    const auto begin = field<std::uintptr_t>(buffer, 0x38);
    const auto end = field<std::uintptr_t>(buffer, 0x40);
    if (end < begin || (end - begin) / 8 > 10 || (end - begin) % 8 != 0)
      throw std::runtime_error("invalid update face span");
    const auto timestampUs = static_cast<std::int64_t>(std::llround(timestamp * 1'000'000));
    const ReplayFrame* external = nullptr;
    if (!replay.empty()) {
      if (replayCursor >= replay.size() || replay[replayCursor].timestamp != timestampUs ||
          replay[replayCursor].faces.size() != (end - begin) / 8)
        throw std::runtime_error("replay timing or face count mismatch");
      external = &replay[replayCursor++];
    }
    records << "{\"event\":\"algorithm_update\",\"timestamp_us\":" << timestampUs
            << ",\"native_update_call\":" << nativeUpdateCalls
            << ",\"eye_shift\":" << pointShift << ",\"external_points\":"
            << (external == nullptr ? "false" : "true") << ",\"faces_before\":";
    writeFaces(buffer);
    for (std::size_t index = 0; index < (end - begin) / 8; ++index) {
      const void* face = field<void*>(reinterpret_cast<void*>(begin), index * 8);
      PointRestore restore = readLandmarks(face);
      auto changed = restore.coordinates;
      if (external != nullptr) {
        if (external->faces[index].id != field<int>(face, 0x40))
          throw std::runtime_error("replay track id mismatch");
        changed = external->faces[index].coordinates;
      }
      for (std::size_t point = 52; point <= 63; ++point) {
        const double value = changed[point * 2] + pointShift;
        if (!std::isfinite(value) || value < 0 || value > 1)
          throw std::runtime_error("eye shift leaves normalized frame");
        changed[point * 2] = static_cast<float>(value);
      }
      restorations.push_back(restore);
      writeLandmarks(restore.destination, changed);
    }
    records << ",\"faces_applied\":";
    writeFaces(buffer);
    records << "}\n" << std::flush;
    return result;
  } catch (...) {
    // Do not unwind through vendor callbacks; discard the frame after seek returns.
    updateError = std::current_exception();
    return result;
  }
}

void installUpdateTrace(void* algorithm) {
  if (!traceUpdates || shadows.contains(algorithm)) return;
  void* vtable = field<void*>(algorithm, 0);
  if (imageOffset(vtable) != 0x373bba0)
    throw std::runtime_error("unexpected Swing algorithm type");
  auto& shadow = shadows[algorithm];
  // Preserve RTTI and all 34 virtual slots; only this process-owned object changes.
  if (!readMemory(static_cast<unsigned char*>(vtable) - 16,
                  shadow.table.data(), sizeof(shadow.table)))
    throw std::runtime_error("unreadable Swing vtable");
  if (imageOffset(shadow.table[6]) != 0x27823d0)
    throw std::runtime_error("unexpected update virtual slot");
  shadow.original = reinterpret_cast<Update>(shadow.table[6]);
  shadow.table[6] = reinterpret_cast<void*>(tracedUpdate);
  void* replacement = shadow.table.data() + 2;
  std::memcpy(algorithm, &replacement, sizeof(replacement));
}

void writeFaces(const void* buffer) {
  const auto begin = field<std::uintptr_t>(buffer, 0x38);
  const auto end = field<std::uintptr_t>(buffer, 0x40);
  if (end < begin || (end - begin) % 8 != 0 || (end - begin) / 8 > 10)
    throw std::runtime_error("invalid primary face vector");
  records << '[';
  for (std::size_t index = 0; index < (end - begin) / 8; ++index) {
    const void* face = field<void*>(reinterpret_cast<void*>(begin), index * 8);
    const auto coordinates = readLandmarks(face).coordinates;
    records << (index == 0 ? "" : ",") << "{\"id\":" << field<int>(face, 0x40)
            << ",\"points\":[";
    for (std::size_t point = 0; point < 106; ++point) {
      records << (point == 0 ? "" : ",") << '[' << coordinates[point * 2]
              << ',' << coordinates[point * 2 + 1] << ']';
    }
    records << "]}";
  }
  records << ']';
}

void inspectManager(void* manager) {
  using Getter = void* (*)(void*);
  const auto getAlgorithms = jianying_probe::resolveSymbol<Getter>(core,
      "_ZN13AmazingEngine12SwingManager18getSwingAlgorithmsEv");
  const auto getIndexed = jianying_probe::resolveSymbol<Getter>(core,
      "_ZN13AmazingEngine12SwingManager25getIndexedSwingAlgorithmsEv");
  if (jianying_probe::runtimeImageUuid(reinterpret_cast<void*>(getAlgorithms)) !=
      "D6342ECD-5432-33F0-A2AD-0C28F5699994")
    throw std::runtime_error("unverified consumer image UUID");
  const auto visit = [&](void* algorithm) {
    if (++observedAlgorithms[algorithm] > 64)
      throw std::runtime_error("bounded seek trace exceeded");
    if (imageOffset(field<void*>(algorithm, 0)) != 0x373bba0 && !shadows.contains(algorithm))
      throw std::runtime_error("unexpected Swing algorithm layout");
    installUpdateTrace(algorithm);
    const auto vtable = field<void*>(algorithm, 0);
    const auto extracted = field<void*>(algorithm, 0x70);
    Dl_info image{};
    if (dladdr(reinterpret_cast<void*>(getAlgorithms), &image) == 0)
      throw std::runtime_error("missing pinned image base");
    using Lookup = void* (*)(void*, std::uint64_t, std::uint64_t);
    const auto lookup = reinterpret_cast<Lookup>(
        static_cast<unsigned char*>(image.dli_fbase) + 0x16739ec);
    // This wrapper receives a 128-bit requirement by value, not a node name.
    void* face = extracted == nullptr ? nullptr : lookup(extracted, 1, 0);
    const void* algorithmManager = extracted == nullptr ? nullptr : field<void*>(extracted, 0x80);
    using GraphIndex = int (*)(const void*);
    const auto graphIndex = reinterpret_cast<GraphIndex>(
        static_cast<unsigned char*>(image.dli_fbase) + 0x25e3ff8);
    using Type = int (*)(const void*);
    const auto getType = reinterpret_cast<Type>(
        static_cast<unsigned char*>(image.dli_fbase) + 0x25e2438);
    const std::array<std::uint64_t, 2> requirement = {1, 0};
    const int type = getType(requirement.data());
    const int graph = algorithmManager == nullptr ? -1 : graphIndex(algorithmManager);
    using RawResult = void* (*)(const void*, int, int, int);
    const auto getRaw = reinterpret_cast<RawResult>(
        static_cast<unsigned char*>(image.dli_fbase) + 0x25e3af8);
    void* rawFace = graph < 0 ? nullptr : getRaw(algorithmManager, graph, 0, type);
    const auto faceVtable = static_cast<unsigned char*>(dlsym(core, "_ZTVN4Bach10FaceBufferE"));
    if (rawFace != nullptr && (faceVtable == nullptr || field<void*>(rawFace, 0) != faceVtable + 16))
      throw std::runtime_error("raw face buffer type mismatch");
    records << "{\"algorithm_vtable\":" << imageOffset(vtable)
            << ",\"extract_present\":" << (extracted != nullptr ? "true" : "false")
            << ",\"extract_vtable\":" <<
            (extracted == nullptr ? 0 : imageOffset(field<void*>(extracted, 0)))
            << ",\"graph_index\":" << graph << ",\"algorithm_type\":" << type
            << ",\"face_present\":" << (face != nullptr ? "true" : "false")
            << ",\"face_vtable\":" << (face == nullptr ? 0 : imageOffset(field<void*>(face, 0)))
            << ",\"raw_face_present\":" << (rawFace == nullptr ? "false" : "true")
            << ",\"raw_face_vtable\":" << (rawFace == nullptr ? 0 : imageOffset(field<void*>(rawFace, 0)))
            << ",\"faces\":";
    if (rawFace == nullptr) records << "[]";
    else writeFaces(rawFace);
    records << "}\n" << std::flush;
  };
  void* const list = getAlgorithms(manager);
  void* node = field<void*>(list, 8);
  std::set<void*> nodes;
  while (node != list) {
    if (nodes.size() >= 32 || !nodes.insert(node).second)
      throw std::runtime_error("unbounded or cyclic Swing algorithm list");
    visit(field<void*>(node, 0x10));
    node = field<void*>(node, 8);
  }
  // Indexed algorithms are not part of the manager's primary list.
  const auto* indexed = static_cast<const std::map<int, std::vector<void*>>*>(getIndexed(manager));
  if (indexed->size() > 32) throw std::runtime_error("too many algorithm indices");
  for (const auto& [index, algorithms] : *indexed) {
    static_cast<void>(index);
    if (algorithms.size() > 32) throw std::runtime_error("too many indexed algorithms");
    for (void* algorithm : algorithms) visit(algorithm);
  }
}

int tracedSeek(void* manager, std::int64_t timestamp,
               const jianying_probe::SwingDeviceTextureDataProbe* input,
               const jianying_probe::SwingDeviceTextureDataProbe* output) {
  seekThread = std::this_thread::get_id();
  updateError = nullptr;
  const auto restore = [] {
    for (auto entry = restorations.rbegin(); entry != restorations.rend(); ++entry)
      writeLandmarks(entry->destination, entry->coordinates);
    restorations.clear();
  };
  try {
    const int result = originalSeek(manager, timestamp, input, output);
    restore();
#ifdef QCUT_FACE_BINDING_HOOK
    finishOwnedBinding(manager);
#endif
    if (updateError) std::rethrow_exception(updateError);
    if (result != 0) throw std::runtime_error("native seek failed");
    inspectManager(manager);
    return result;
  } catch (...) {
    restore();
#ifdef QCUT_FACE_BINDING_HOOK
    finishOwnedBinding(manager);
#endif
    throw;
  }
}

template <typename Function>
Function tracedResolve(void* handle, std::string_view name) {
  Function original = jianying_probe::resolveSymbol<Function>(handle, name);
  if constexpr (std::is_same_v<Function, Seek>) {
    if (name == "bef_swing_manager_seek_frame_device_texture_with_data") {
      if (jianying_probe::runtimeImageUuid(reinterpret_cast<void*>(original)) !=
          "D6342ECD-5432-33F0-A2AD-0C28F5699994")
        throw std::runtime_error("unverified consumer image UUID");
      originalSeek = original;
      core = handle;
      return tracedSeek;
    }
  }
  return original;
}
}  // namespace

#define resolveSymbol tracedResolve
#include "../jianying-runtime-probe/filter-probe.mm"
#undef resolveSymbol

int dimension(const char* key) {
  const char* value = std::getenv(key);
  if (value == nullptr) throw std::runtime_error("frame dimension required");
  std::size_t consumed = 0;
  const int result = std::stoi(value, &consumed);
  if (consumed != std::strlen(value) || result < 1 || result > 4096)
    throw std::runtime_error("invalid frame dimension");
  return result;
}

int main(int argc, char* argv[]) {
  @autoreleasepool {
    try {
      if (argc != 4 || std::getenv("QCUT_CONSUMER_RECORD") == nullptr)
        throw std::runtime_error("runtime, models, package and record path required");
      records.open(std::getenv("QCUT_CONSUMER_RECORD"));
      if (!records) throw std::runtime_error("cannot create research trace");
      records << std::setprecision(9);
      const int width = dimension("QCUT_FRAME_WIDTH");
      const int height = dimension("QCUT_FRAME_HEIGHT");
      traceUpdates = std::getenv("QCUT_TRACE_UPDATES") != nullptr;
      if (const char* shift = std::getenv("QCUT_FACE_POINT_SHIFT")) {
        std::size_t consumed = 0;
        pointShift = std::stod(shift, &consumed);
        if (consumed != std::strlen(shift) || !std::isfinite(pointShift) || std::abs(pointShift) > 0.02 || !traceUpdates)
          throw std::runtime_error("eye shift requires trace mode and at most 0.02");
      }
      if (const char* path = std::getenv("QCUT_FACE_REPLAY")) {
        if (!traceUpdates) throw std::runtime_error("replay requires trace mode");
        loadReplay(path, width, height);
      }
      const int result = jianying_probe::runFilterHost({
          .runtimeRoot = argv[1], .packagePath = argv[3], .modelDirectory = argv[2],
          .width = width, .height = height,
      });
      if (replayCursor != replay.size()) throw std::runtime_error("unconsumed replay frames");
      return result;
    } catch (const std::exception& error) {
      std::cerr << "[research-error] " << error.what() << '\n';
      return 1;
    }
  }
}
