// Live candidate points enter an owned clone, never the borrowed native result.
#import <Foundation/Foundation.h>
#include <memory>
#include <optional>
#include <unistd.h>
#include "face_live_bridge_response.h"
namespace {
void inspectOwnedAdapter(void*);
void finishOwnedBinding(void*);
}
#define QCUT_FACE_BINDING_HOOK
#define main liveConsumerMain
#include "face_owned_result_bridge.mm"
#undef main
#undef QCUT_FACE_BINDING_HOOK

namespace {
using Convert = uint64_t (*)(void*, void*);
using Publish = void (*)(void*, int, void* const*);
struct Adapter { std::array<void*, 18> table{}; Convert original = nullptr; };
struct Binding { void* graph; void* duplicate; std::unique_ptr<FaceOwner> source; };
std::map<void*, Adapter> liveAdapters;
std::vector<std::unique_ptr<FaceOwner>> liveClones;
std::vector<Binding> liveBindings;
std::optional<ReplayFrame> livePending;
int64_t livePrediction = -1;
bool liveConsumed = true;

uint64_t liveConvert(void* adapter, void* context) {
  uint64_t result = 0;
  void* graph = nullptr;
  void* source = nullptr;
  Publish publish = nullptr;
  bool replaced = false;
  std::unique_ptr<FaceOwner> originalOwner;
  try {
    if (std::this_thread::get_id() != seekThread || updateError || !livePending || liveConsumed ||
        livePending->timestamp != seekTimestamp || liveClones.size() >= 128)
      throw std::runtime_error("missing/stale live result or unsupported conversion state");
    graph = field<void*>(context, 0x20);
    if (!liveBindings.empty()) throw std::runtime_error("one owned live conversion per prediction required");
    using Raw = void* (*)(void*, int);
    const auto raw = reinterpret_cast<Raw>(static_cast<unsigned char*>(imageBase()) + 0xc15cd4);
    publish = reinterpret_cast<Publish>(static_cast<unsigned char*>(imageBase()) + 0xc157e8);
    source = raw(graph, 4);
    if (!source) throw std::runtime_error("live conversion has no FaceBuffer");
    const auto clone = jianying_probe::resolveSymbol<CloneFace>(core, "_ZNK4Bach10FaceBuffer5CloneEv");
    const auto retain = jianying_probe::resolveSymbol<ReferenceOperation>(core, "_ZNK13AmazingEngine7RefBase6retainEv");
    const auto release = jianying_probe::resolveSymbol<ReferenceOperation>(core, "_ZNK13AmazingEngine7RefBase7releaseEv");
    void* duplicate = clone(source);
    if (!duplicate || duplicate == source) throw std::runtime_error("live clone allocation failed");
    retain(duplicate);
    auto owner = std::make_unique<FaceOwner>(duplicate, release);
    retain(source);
    originalOwner = std::make_unique<FaceOwner>(source, release);
    const auto faces = pointerSpan(duplicate, 0x38), originals = pointerSpan(source, 0x38);
    if (faces.count > 1 || originals.count != faces.count || faces.count != livePending->faces.size())
      throw std::runtime_error("live/native face count mismatch");
    std::vector<PointRestore> before;
    for (size_t index = 0; index < faces.count; ++index) {
      const void* face = field<void*>(reinterpret_cast<void*>(faces.begin), index * 8);
      const void* original = field<void*>(reinterpret_cast<void*>(originals.begin), index * 8);
      const auto destination = readLandmarks(face);
      before.push_back(readLandmarks(original));
      if (destination.destination == before.back().destination ||
          field<int>(face, 0x40) != livePending->faces[index].id)
        throw std::runtime_error("live clone aliases source or identity differs");
      writeLandmarks(destination.destination, livePending->faces[index].coordinates);
      if (readLandmarks(original).coordinates != before.back().coordinates ||
          readLandmarks(face).coordinates != livePending->faces[index].coordinates)
        throw std::runtime_error("live clone write isolation failed");
    }
    liveClones.push_back(std::move(owner));
    publish(graph, 4, &duplicate);
    replaced = true;
    if (raw(graph, 4) != duplicate) throw std::runtime_error("live clone publication failed");
    result = liveAdapters.at(adapter).original(adapter, context);
    for (size_t index = 0; index < originals.count; ++index) {
      const void* original = field<void*>(reinterpret_cast<void*>(originals.begin), index * 8);
      if (readLandmarks(original).coordinates != before[index].coordinates)
        throw std::runtime_error("live conversion changed native source landmarks");
    }
    liveBindings.push_back({graph, duplicate, std::move(originalOwner)});
    replaced = false;
    liveConsumed = true;
    records << "{\"event\":\"live_owned_conversion\",\"prediction\":" << livePrediction
            << ",\"timestamp_us\":" << seekTimestamp << ",\"faces\":" << faces.count
            << ",\"source_points_unchanged\":true,\"candidate_source\":\"fresh-worker-inference\","
               "\"native_analysis_bypassed\":false}\n" << std::flush;
  } catch (...) {
    if (replaced) publish(graph, 4, &source);
    updateError = std::current_exception();
  }
  return result;
}

void inspectOwnedAdapter(void* algorithm) {
  const void* manager = field<void*>(algorithm, 0x178);
  const void* implementation = field<void*>(manager, 0);
  if (field<unsigned char>(implementation, 0x661) != 0)
    throw std::runtime_error("unsupported live adapter mode");
  using Lookup = void* (*)(void*, const int*);
  const auto lookup = reinterpret_cast<Lookup>(static_cast<unsigned char*>(imageBase()) + 0x25dcd08);
  const int type = 4;
  void* adapter = lookup(field<void*>(implementation, 0x658), &type);
  if (!adapter) throw std::runtime_error("live face adapter unavailable");
  if (liveAdapters.contains(adapter)) return;
  void* table = field<void*>(adapter, 0);
  auto& shadow = liveAdapters[adapter];
  if (imageOffset(table) != 0x36f7c90 ||
      !readMemory(static_cast<unsigned char*>(table) - 16, shadow.table.data(), sizeof(shadow.table)) ||
      imageOffset(shadow.table[16]) != 0x25f0b44)
    throw std::runtime_error("unverified live adapter vtable");
  shadow.original = reinterpret_cast<Convert>(shadow.table[16]);
  shadow.table[16] = reinterpret_cast<void*>(liveConvert);
  void* replacement = shadow.table.data() + 2;
  std::memcpy(adapter, &replacement, sizeof(replacement));
}

void finishOwnedBinding(void* manager) {
  if (!liveBindings.empty()) {
    using Getter = void* (*)(void*);
    const auto amazer = jianying_probe::resolveSymbol<Getter>(core, "_ZNK13AmazingEngine12SwingManager9getAmazerEv");
    const auto renderer = reinterpret_cast<Getter>(static_cast<unsigned char*>(imageBase()) + 0x3f9fd8)(amazer(manager));
    if (!renderer) throw std::runtime_error("live completion renderer missing");
    jianying_probe::resolveSymbol<ReferenceOperation>(core, "_ZN13AmazingEngine14RendererDevice6finishEv")(renderer);
    using Raw = void* (*)(void*, int);
    const auto raw = reinterpret_cast<Raw>(static_cast<unsigned char*>(imageBase()) + 0xc15cd4);
    const auto publish = reinterpret_cast<Publish>(static_cast<unsigned char*>(imageBase()) + 0xc157e8);
    for (auto& binding : liveBindings) {
      if (raw(binding.graph, 4) != binding.duplicate) throw std::runtime_error("live clone overwritten before GPU completion");
      void* source = binding.source->value;
      publish(binding.graph, 4, &source);
      if (raw(binding.graph, 4) != source) throw std::runtime_error("live source restoration failed");
      records << "{\"event\":\"live_owned_restored\",\"prediction\":" << livePrediction
              << ",\"gpu_complete\":true,\"original_restored\":true}\n" << std::flush;
    }
    liveBindings.clear();
  }
  if (!updateError && (!livePending || (livePrediction >= 2 && !liveConsumed)))
    throw std::runtime_error("live prediction missing or not consumed by renderer");
}
}

extern "C" __attribute__((visibility("default"), used)) int64_t qcut_face_live_timestamp() {
  return seekTimestamp;
}

extern "C" __attribute__((visibility("default"), used)) void qcut_face_live_failure(const char* error) {
  updateError = std::make_exception_ptr(std::runtime_error(error ? error : "live callback failed"));
}

extern "C" __attribute__((visibility("default"), used)) void qcut_face_live_result(const void* bytes, size_t size) {
  try {
    if (std::this_thread::get_id() != seekThread || updateError || size > 128 * 1024)
      throw std::runtime_error("unsupported live result thread/state/size");
    NSString* token = @(std::getenv("QCUT_FACE_LIVE_TOKEN") ?: "");
    if (livePrediction >= 2 && !liveConsumed)
      throw std::runtime_error("live result has unconsumed predecessor");
    const auto response = qcut_live::parseResponse(bytes, size, token, getpid(), livePrediction + 1, seekTimestamp);
    ReplayFrame frame;
    frame.timestamp = response.timestamp;
    for (const auto& face : response.faces) {
      frame.faces.push_back({face.id, face.points});
    }
    livePending = std::move(frame);
    livePrediction = response.prediction;
    liveConsumed = false;
    records << "{\"event\":\"live_candidate_received\",\"prediction\":" << livePrediction
            << ",\"timestamp_us\":" << seekTimestamp << "}\n" << std::flush;
  } catch (...) { updateError = std::current_exception(); }
}

int main(int argc, char* argv[]) {
  if (!std::getenv("QCUT_FACE_LIVE_TOKEN") || !std::getenv("QCUT_FACE_LIVE_SOCKET") ||
      std::getenv("QCUT_FACE_REPLAY") || std::getenv("QCUT_FACE_BIND_REPLAY") ||
      std::getenv("QCUT_FACE_BIND_EYE_SHIFT") ||
      std::string(std::getenv("QCUT_FACE_POINT_SHIFT") ?: "invalid") != "0") return 1;
  return liveConsumerMain(argc, argv);
}
