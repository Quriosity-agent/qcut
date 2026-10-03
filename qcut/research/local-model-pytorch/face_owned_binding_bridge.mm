// Bind a clone before FaceAdapter conversion; preserve it through host teardown.
namespace {
void inspectOwnedAdapter(void* algorithm);
void finishOwnedBinding(void* manager);
}
#define QCUT_FACE_BINDING_HOOK
#define main cloneAuditMain
#include "face_owned_result_bridge.mm"
#undef main
#undef QCUT_FACE_BINDING_HOOK
#include <memory>

namespace {
using ConvertFace = std::uint64_t (*)(void*, void*);
using PublishFace = void (*)(void*, int, void* const*);
struct AdapterShadow {
  std::array<void*, 18> table{};
  ConvertFace original = nullptr;
};
std::map<void*, AdapterShadow> adapters;
std::vector<std::unique_ptr<FaceOwner>> convertedClones;
struct RawBinding {
  void* graph;
  void* duplicate;
  std::unique_ptr<FaceOwner> source;
};
std::vector<RawBinding> bindings;
double bindingShift = 0;
std::vector<ReplayFrame> ownedReplay;
std::size_t ownedReplayCursor = 0;

std::uint64_t ownedConvert(void* adapter, void* context) {
  std::uint64_t result = 0;
  void* graph = nullptr;
  void* source = nullptr;
  PublishFace publish = nullptr;
  std::unique_ptr<FaceOwner> originalOwner;
  bool replaced = false;
  try {
    if (std::this_thread::get_id() != seekThread || updateError)
      throw std::runtime_error("unsupported conversion thread or prior callback failure");
    if (convertedClones.size() >= 128 || bindings.size() >= 10)
      throw std::runtime_error("bounded retained clone limit exceeded");
    graph = field<void*>(context, 0x20);
    for (const auto& binding : bindings)
      if (binding.graph == graph) throw std::runtime_error("duplicate graph conversion in one seek");
    using RawFace = void* (*)(void*, int);
    const auto raw = reinterpret_cast<RawFace>(
        static_cast<unsigned char*>(imageBase()) + 0xc15cd4);
    publish = reinterpret_cast<PublishFace>(
        static_cast<unsigned char*>(imageBase()) + 0xc157e8);
    source = raw(graph, 4);
    if (source == nullptr) throw std::runtime_error("conversion has no FaceBuffer");
    const auto clone = jianying_probe::resolveSymbol<CloneFace>(core,
        "_ZNK4Bach10FaceBuffer5CloneEv");
    const auto retain = jianying_probe::resolveSymbol<ReferenceOperation>(core,
        "_ZNK13AmazingEngine7RefBase6retainEv");
    const auto release = jianying_probe::resolveSymbol<ReferenceOperation>(core,
        "_ZNK13AmazingEngine7RefBase7releaseEv");
    void* duplicate = clone(source);
    if (duplicate == nullptr || duplicate == source)
      throw std::runtime_error("conversion clone allocation failed");
    retain(duplicate);
    auto owner = std::make_unique<FaceOwner>(duplicate, release);
    retain(source);
    originalOwner = std::make_unique<FaceOwner>(source, release);
    const auto faces = pointerSpan(duplicate, 0x38);
    const auto sourceFaces = pointerSpan(source, 0x38);
    const ReplayFrame* external = nullptr;
    if (!ownedReplay.empty()) {
      if (ownedReplayCursor >= ownedReplay.size() ||
          ownedReplay[ownedReplayCursor].timestamp != seekTimestamp ||
          ownedReplay[ownedReplayCursor].faces.size() != faces.count)
        throw std::runtime_error("owned replay timing or face count mismatch");
      external = &ownedReplay[ownedReplayCursor];
    }
    if (sourceFaces.count != faces.count)
      throw std::runtime_error("owned replay source/clone count mismatch");
    std::vector<PointRestore> originals;
    for (std::size_t index = 0; index < faces.count; ++index) {
      const void* face = field<void*>(reinterpret_cast<void*>(faces.begin), index * 8);
      const void* sourceFace = field<void*>(reinterpret_cast<void*>(sourceFaces.begin), index * 8);
      const auto points = readLandmarks(face);
      originals.push_back(readLandmarks(sourceFace));
      if (points.destination == originals.back().destination)
        throw std::runtime_error("owned replay landmark storage aliases source");
      auto shifted = points.coordinates;
      if (external != nullptr) {
        if (external->faces[index].id != field<int>(face, 0x40))
          throw std::runtime_error("owned replay track id mismatch");
        shifted = external->faces[index].coordinates;
      }
      for (std::size_t point = 52; point <= 63; ++point) {
        const double value = shifted[point * 2] + bindingShift;
        if (!std::isfinite(value) || value < 0 || value > 1)
          throw std::runtime_error("binding shift leaves normalized frame");
        shifted[point * 2] = static_cast<float>(value);
      }
      writeLandmarks(points.destination, shifted);
      if (readLandmarks(sourceFace).coordinates != originals.back().coordinates ||
          readLandmarks(face).coordinates != shifted)
        throw std::runtime_error("owned replay write isolation failed");
    }
    // The adapted result may borrow clone children after the raw slot is restored.
    convertedClones.push_back(std::move(owner));
    publish(graph, 4, &duplicate);
    replaced = true;
    if (raw(graph, 4) != duplicate)
      throw std::runtime_error("owning publisher did not replace raw result");
    result = adapters.at(adapter).original(adapter, context);
    for (std::size_t index = 0; index < sourceFaces.count; ++index) {
      const void* face = field<void*>(reinterpret_cast<void*>(sourceFaces.begin), index * 8);
      if (readLandmarks(face).coordinates != originals[index].coordinates)
        throw std::runtime_error("conversion changed original source landmarks");
    }
    bindings.push_back({.graph = graph, .duplicate = duplicate, .source = std::move(originalOwner)});
    replaced = false;
    if (external != nullptr) ++ownedReplayCursor;
    records << "{\"event\":\"owned_face_conversion\",\"faces\":" << faces.count
            << ",\"timestamp_us\":" << seekTimestamp
            << ",\"eye_shift\":" << bindingShift
            << ",\"external_points\":" << (external == nullptr ? "false" : "true")
            << ",\"source_points_unchanged\":true,\"owned_points_isolated\":true,"
               "\"raw_clone_verified\":true,\"original_restored\":false,"
               "\"native_analysis_bypassed\":false,\"faces_before\":";
    writeFaces(source);
    records << ",\"faces_applied\":";
    writeFaces(duplicate);
    records << "}\n" << std::flush;
    return result;
  } catch (...) {
    if (replaced) publish(graph, 4, &source);
    updateError = std::current_exception();
    return result;
  }
}

void finishOwnedBinding(void* manager) {
  if (bindings.empty()) return;
  using Getter = void* (*)(void*);
  const auto getAmazer = jianying_probe::resolveSymbol<Getter>(core,
      "_ZNK13AmazingEngine12SwingManager9getAmazerEv");
  const auto rendererGetter = reinterpret_cast<Getter>(
      static_cast<unsigned char*>(imageBase()) + 0x3f9fd8);
  void* renderer = rendererGetter(getAmazer(manager));
  if (renderer == nullptr) throw std::runtime_error("missing owned-result completion renderer");
  const auto finish = jianying_probe::resolveSymbol<ReferenceOperation>(core,
      "_ZN13AmazingEngine14RendererDevice6finishEv");
  finish(renderer);
  using RawFace = void* (*)(void*, int);
  const auto raw = reinterpret_cast<RawFace>(static_cast<unsigned char*>(imageBase()) + 0xc15cd4);
  const auto publish = reinterpret_cast<PublishFace>(static_cast<unsigned char*>(imageBase()) + 0xc157e8);
  for (auto entry = bindings.rbegin(); entry != bindings.rend(); ++entry) {
    if (raw(entry->graph, 4) != entry->duplicate)
      throw std::runtime_error("owned raw result was overwritten before completion");
    void* source = entry->source->value;
    publish(entry->graph, 4, &source);
    if (raw(entry->graph, 4) != source)
      throw std::runtime_error("cannot restore owned raw result after completion");
    records << "{\"event\":\"owned_face_restored\",\"gpu_complete\":true,"
               "\"original_restored\":true}\n" << std::flush;
  }
  bindings.clear();
}

void inspectOwnedAdapter(void* algorithm) {
  const void* manager = field<void*>(algorithm, 0x178);
  const void* implementation = field<void*>(manager, 0);
  const int mode = field<unsigned char>(implementation, 0x661);
  if (mode != 0) throw std::runtime_error("new adapter mode is not supported by this probe");
  void* adapterManager = field<void*>(implementation, 0x658);
  using LookupAdapter = void* (*)(void*, const int*);
  const auto lookup = reinterpret_cast<LookupAdapter>(
      static_cast<unsigned char*>(imageBase()) + 0x25dcd08);
  const int type = 4;
  void* adapter = lookup(adapterManager, &type);
  if (adapter == nullptr) throw std::runtime_error("face adapter is unavailable");
  if (adapters.contains(adapter)) return;
  void* vtable = field<void*>(adapter, 0);
  if (imageOffset(vtable) != 0x36f7c90)
    throw std::runtime_error("unexpected face adapter vtable");
  auto& shadow = adapters[adapter];
  if (!readMemory(static_cast<unsigned char*>(vtable) - 16,
                  shadow.table.data(), sizeof(shadow.table)) ||
      imageOffset(shadow.table[16]) != 0x25f0b44)
    throw std::runtime_error("unexpected face conversion virtual slot");
  shadow.original = reinterpret_cast<ConvertFace>(shadow.table[16]);
  shadow.table[16] = reinterpret_cast<void*>(ownedConvert);
  void* replacement = shadow.table.data() + 2;
  std::memcpy(adapter, &replacement, sizeof(replacement));
}
}  // namespace

int main(int argc, char* argv[]) {
  if (argc != 4) return 1;
  const auto libraryPath = std::filesystem::path(argv[1]) / "Frameworks/libcccreator.dylib";
  void* pinned = dlopen(libraryPath.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (pinned == nullptr) return 1;
  int result = 1;
  try {
    if (const char* path = std::getenv("QCUT_FACE_BIND_REPLAY")) {
      if (std::getenv("QCUT_FACE_REPLAY") != nullptr ||
          std::getenv("QCUT_FACE_POINT_SHIFT") == nullptr ||
          std::string(std::getenv("QCUT_FACE_POINT_SHIFT")) != "0")
        throw std::runtime_error("owned replay forbids borrowed point overrides");
      loadReplay(path, dimension("QCUT_FRAME_WIDTH"), dimension("QCUT_FRAME_HEIGHT"));
      ownedReplay = std::move(replay);
      replay.clear();
    }
    if (const char* value = std::getenv("QCUT_FACE_BIND_EYE_SHIFT")) {
      std::size_t consumed = 0;
      bindingShift = std::stod(value, &consumed);
      if (consumed != std::strlen(value) || !std::isfinite(bindingShift) ||
          std::abs(bindingShift) > 0.02)
        throw std::runtime_error("invalid binding eye shift");
    }
    result = cloneAuditMain(argc, argv);
    if (ownedReplayCursor != ownedReplay.size())
      throw std::runtime_error("unconsumed owned replay frames");
  } catch (const std::exception& error) {
    result = 1;
    std::cerr << "[research-error] " << error.what() << '\n';
  }
  // Host teardown destroys adapted caches before the final clone references.
  convertedClones.clear();
  bindings.clear();
  adapters.clear();
  dlclose(pinned);
  return result;
}
