// Live candidate points enter an owned clone, never the borrowed native result.
#include <cstdint>
#include <exception>
#include <map>
#include <memory>
#include <stdexcept>
#include <utility>

namespace qcut_live {
class DeferredColdSetup {
 public:
  void prepare(void* manager) {
    if (failure_) std::rethrow_exception(failure_);
    if (!manager || (manager_ && manager_ != manager) || active_) {
      failure_ = std::make_exception_ptr(std::runtime_error("cold seek manager missing, changed or reentered"));
      std::rethrow_exception(failure_);
    }
    manager_ = manager;
    active_ = true;
  }

  template <typename Install>
  bool installForPrediction(int64_t prediction, Install install) {
    if (failure_) std::rethrow_exception(failure_);
    try {
      if (!active_ || !manager_)
        throw std::runtime_error("cold hook setup outside native seek");
      if (installed_) return false;
      if (prediction != 0)
        throw std::runtime_error("cold hooks must be installed at prediction zero");
      install(manager_);
      installed_ = true;
      return true;
    } catch (...) {
      failure_ = std::current_exception();
      throw;
    }
  }

  bool active() const { return active_; }
  bool finish() { return std::exchange(active_, false); }

 private:
  void* manager_ = nullptr;
  std::exception_ptr failure_;
  bool active_ = false;
  bool installed_ = false;
};

struct CloneLease {
  void* graph;
  void* duplicate;
  std::shared_ptr<void> source;
  int64_t prediction;
  int64_t timestamp;
  uint64_t bindingId;
  uint64_t graphId;
  bool published = false;
  bool converted = false;
};

class CloneLeaseScope {
 public:
  explicit CloneLeaseScope(bool requireEveryPrediction = false)
      : requireEveryPrediction_(requireEveryPrediction) {}

  void begin(int64_t prediction, int64_t timestamp) {
    if (failure_) std::rethrow_exception(failure_);
    if (!leases_.empty()) throw std::runtime_error("live result has undrained graph leases");
    if (requiresConsumption() && !consumed_)
      throw std::runtime_error("live result has unconsumed predecessor");
    prediction_ = prediction;
    timestamp_ = timestamp;
    consumed_ = false;
    open_ = true;
    finished_ = false;
  }

  bool injecting() const { return open_; }
  bool consumed() const { return consumed_; }
  bool requiresConsumption() const {
    return prediction_ >= 0 && (requireEveryPrediction_ || prediction_ >= 2);
  }
  void validateConsumption() const {
    if (prediction_ < 0 || (requiresConsumption() && !consumed_))
      throw std::runtime_error("live prediction missing or not consumed by renderer");
  }

  void requireGraph(void* graph) const {
    if (!open_ || !graph) throw std::runtime_error("live conversion outside prediction scope");
    if (leases_.contains(graph)) throw std::runtime_error("duplicate live graph conversion in one prediction");
    if (leases_.size() >= 10) throw std::runtime_error("bounded live graph lease limit exceeded");
  }

  const CloneLease& reserve(void* graph, void* duplicate, std::shared_ptr<void> source) {
    requireGraph(graph);
    if (!duplicate || !source || duplicate == source.get())
      throw std::runtime_error("invalid live clone lease ownership");
    if (!graphIds_.contains(graph)) graphIds_.emplace(graph, graphIds_.size() + 1);
    return leases_.emplace(graph, CloneLease{graph, duplicate, std::move(source),
        prediction_, timestamp_, ++nextBinding_, graphIds_.at(graph)}).first->second;
  }

  void published(void* graph) { leases_.at(graph).published = true; }

  void converted(void* graph) {
    auto& lease = leases_.at(graph);
    if (!open_ || !lease.published || lease.converted)
      throw std::runtime_error("live conversion has no unique published lease");
    lease.converted = true;
    consumed_ = true;
  }

  template <typename Fence, typename Raw, typename Publish, typename Receipt>
  bool finish(Fence fence, Raw raw, Publish publish, Receipt receipt) {
    if (finished_) return false;
    // inspectManager's lazy getter runs after this boundary; it is not a renderer consumer.
    open_ = false;
    finished_ = true;
    if (leases_.empty()) return true;
    try {
      fence();
    } catch (...) {
      failure_ = std::current_exception();
      throw;  // retain every source and clone when completion cannot be established
    }
    for (auto entry = leases_.begin(); entry != leases_.end();) {
      const auto& lease = entry->second;
      try {
        void* current = raw(lease.graph);
        if (current == lease.duplicate) {
          publish(lease.graph, lease.source.get());
          if (raw(lease.graph) != lease.source.get())
            throw std::runtime_error("live source restoration failed");
        } else if (lease.published || current != lease.source.get()) {
          throw std::runtime_error("live clone overwritten before GPU completion");
        }
        receipt(lease);
        entry = leases_.erase(entry);
      } catch (...) {
        if (!failure_) failure_ = std::current_exception();
        ++entry;  // never overwrite a superseding native result
      }
    }
    if (failure_) std::rethrow_exception(failure_);
    return true;
  }

 private:
  const bool requireEveryPrediction_;
  std::map<void*, CloneLease> leases_;
  std::map<void*, uint64_t> graphIds_;
  std::exception_ptr failure_;
  int64_t prediction_ = -1;
  int64_t timestamp_ = 0;
  uint64_t nextBinding_ = 0;
  bool open_ = false;
  bool consumed_ = true;
  bool finished_ = true;
};
}

#ifndef QCUT_FACE_LIVE_LIFECYCLE_TEST
#import <Foundation/Foundation.h>
#include <optional>
#include <unistd.h>
#include "face_live_bridge_response.h"
#include "face_live_makeup_scene.h"
namespace {
void inspectOwnedAdapter(void*);
void finishOwnedBinding(void*);
void prepareOwnedSeek(void*);
void captureOwnedFeature(void*);
}
#define QCUT_FACE_BINDING_HOOK
#define QCUT_FACE_PRE_SEEK_HOOK
#define QCUT_FACE_FEATURE_HOOK
#define main liveConsumerMain
#include "face_owned_result_bridge.mm"
#undef main
#undef QCUT_FACE_BINDING_HOOK
#undef QCUT_FACE_PRE_SEEK_HOOK
#undef QCUT_FACE_FEATURE_HOOK

namespace {
using Convert = uint64_t (*)(void*, void*);
using Publish = void (*)(void*, int, void* const*);
struct Adapter { std::array<void*, 18> table{}; Convert original = nullptr; };
std::map<void*, Adapter> liveAdapters;
std::vector<std::unique_ptr<FaceOwner>> liveClones;
const bool liveColdFrame = std::string(std::getenv("QCUT_FACE_LIVE_COLD_FRAME") ?: "") == "1";
qcut_live::CloneLeaseScope liveLeases(liveColdFrame);
std::optional<ReplayFrame> livePending;
int64_t livePrediction = -1;
qcut_live::DeferredColdSetup liveColdSetup;
int64_t liveColdSeekStartPrediction = -1;
#include "face_live_owned_input.h"
const bool liveMakeupTrace = std::string(std::getenv("QCUT_FACE_LIVE_MAKEUP_TRACE") ?: "") == "1";
const bool liveMakeupPublish = std::string(std::getenv("QCUT_FACE_LIVE_MAKEUP_PUBLISH") ?: "") == "1";
void* liveFeature = nullptr;
void* liveSeekManager = nullptr;
using MakeupUpdate = void (*)(void*, double);
struct MakeupShadow { std::array<void*, 32> table{}; MakeupUpdate original = nullptr; };
std::map<void*, MakeupShadow> liveMakeupSystems;
size_t liveMakeupCalls = 0;

void captureOwnedFeature(void* feature) {
  if (!liveMakeupTrace) return;
  if (!feature || liveFeature) throw std::runtime_error("makeup trace requires one fresh feature");
  liveFeature = feature;
}

void* currentMakeupGraph() {
  using Current = void* (*)();
  using Getter = void* (*)(void*);
  if (!liveSeekManager) throw std::runtime_error("makeup seek manager unavailable");
  auto* base = static_cast<unsigned char*>(imageBase());
  void* native = reinterpret_cast<Current>(base + 0x40422c)();
  const auto wrapper = jianying_probe::resolveSymbol<Getter>(core,
      "_ZNK13AmazingEngine12SwingManager9getAmazerEv")(liveSeekManager);
  if (!native || !wrapper || native != reinterpret_cast<Getter>(base + 0x3f9d88)(wrapper))
    throw std::runtime_error("makeup TLS context differs from current seek manager");
  const auto table = field<void*>(native, 0);
  const auto getter = field<void*>(table, 0x98);
  if (imageOffset(table) != 0x3530c48 || imageOffset(getter) != 0x41d56c)
    throw std::runtime_error("unverified makeup AE manager getter");
  void* manager = reinterpret_cast<Getter>(getter)(native);
  if (!manager) throw std::runtime_error("makeup AE manager unavailable");
  void* graph = reinterpret_cast<Getter>(base + 0x407224)(manager);
  if (!graph) throw std::runtime_error("makeup current graph unavailable");
  return graph;
}

void tracedMakeupUpdate(void* system, double delta) {
  try {
    if (std::this_thread::get_id() != seekThread || updateError || !liveLeases.injecting() ||
        !livePending || livePending->timestamp != seekTimestamp || ++liveMakeupCalls > 64)
      throw std::runtime_error("makeup update outside bounded native prediction");
    records << "{\"event\":\"live_makeup_update_enter\",\"prediction\":" << livePrediction
            << ",\"timestamp_us\":" << seekTimestamp
            << ",\"reader\":\"face-makeup-v2\",\"candidate_injected\":false,\"renderer_consumption\":false}\n"
            << std::flush;
    std::optional<OwnedLiveInput> input;
    if (liveMakeupPublish) {
      input = publishLiveInput(currentMakeupGraph());
      const auto& lease = *input->lease;
      const auto faces = pointerSpan(lease.duplicate, 0x38);
      const void* first = faces.count ? field<void*>(reinterpret_cast<void*>(faces.begin), 0) : nullptr;
      records << "{\"event\":\"live_makeup_publication\",\"prediction\":" << livePrediction
              << ",\"timestamp_us\":" << seekTimestamp << ",\"binding_id\":" << lease.bindingId
              << ",\"graph_id\":" << lease.graphId << ",\"graph\":" << reinterpret_cast<uintptr_t>(lease.graph)
              << ",\"source_buffer\":" << reinterpret_cast<uintptr_t>(lease.source.get())
              << ",\"owned_buffer\":" << reinterpret_cast<uintptr_t>(lease.duplicate)
              << ",\"owned_base\":" << reinterpret_cast<uintptr_t>(first)
              << ",\"owned_points\":" << (first ? reinterpret_cast<uintptr_t>(readLandmarks(first).destination) : 0)
              << ",\"faces\":" << faces.count
              << ",\"candidate_injected\":true,\"renderer_consumption\":false}\n" << std::flush;
    }
    liveMakeupSystems.at(system).original(system, delta);
    if (input) input->validateSource();
    records << "{\"event\":\"live_makeup_update_exit\",\"prediction\":" << livePrediction
            << ",\"timestamp_us\":" << seekTimestamp << ",\"renderer_consumption\":false}\n" << std::flush;
  } catch (...) { updateError = std::current_exception(); }
}

void installMakeupObservers() {
  if (!liveMakeupTrace) return;
  using SceneGetter = void* (*)(const void*, int);
  const auto getScene = jianying_probe::resolveSymbol<SceneGetter>(core,
      "_ZNK13AmazingEngine14FeatureSegment8getSceneEi");
  if (imageOffset(reinterpret_cast<void*>(getScene)) != 0x180b8ac)
    throw std::runtime_error("unverified makeup scene getter");
  const auto inventory = qcut_live::inspectMakeupScenes(reinterpret_cast<uintptr_t>(liveFeature),
      [](uintptr_t address, void* out, size_t size) { return readMemory(reinterpret_cast<void*>(address), out, size); },
      [](uintptr_t address) { return imageOffset(reinterpret_cast<void*>(address)); },
      [&](uintptr_t feature, int index) { return reinterpret_cast<uintptr_t>(getScene(reinterpret_cast<void*>(feature), index)); });
  for (uintptr_t address : inventory.makeup) {
    void* system = reinterpret_cast<void*>(address);
    if (liveMakeupSystems.contains(system)) throw std::runtime_error("duplicate makeup observer installation");
    const auto table = field<unsigned char*>(system, 0);
    auto& shadow = liveMakeupSystems[system];
    if (!readMemory(table - 16, shadow.table.data(), sizeof(shadow.table)) ||
        imageOffset(shadow.table[25]) != qcut_live::kMakeupV2Update)
      throw std::runtime_error("unverified makeup observer vtable");
    shadow.original = reinterpret_cast<MakeupUpdate>(shadow.table[25]);
    shadow.table[25] = reinterpret_cast<void*>(tracedMakeupUpdate);
    void* replacement = shadow.table.data() + 2;
    std::memcpy(system, &replacement, sizeof(replacement));
  }
  records << "{\"event\":\"live_makeup_setup\",\"scenes\":" << inventory.scenes
          << ",\"systems\":" << inventory.systems << ",\"makeup_systems\":" << inventory.makeup.size()
          << ",\"renderer_consumption\":false}\n" << std::flush;
}

uint64_t liveConvert(void* adapter, void* context) {
  uint64_t result = 0;
  try {
    if (std::this_thread::get_id() != seekThread || updateError)
      throw std::runtime_error("unsupported live conversion thread or prior callback failure");
    if (!liveLeases.injecting()) {
      if (liveColdSetup.active())
        throw std::runtime_error("cold native conversion without active prediction");
      result = liveAdapters.at(adapter).original(adapter, context);
      records << "{\"event\":\"live_inspection_conversion\",\"prediction\":" << livePrediction
              << ",\"timestamp_us\":" << seekTimestamp
              << ",\"candidate_injected\":false,\"renderer_consumption\":false}\n" << std::flush;
      return result;
    }
    void* graph = field<void*>(context, 0x20);
    const auto input = publishLiveInput(graph);
    result = liveAdapters.at(adapter).original(adapter, context);
    input.validateSource();
    liveLeases.converted(graph);
    const auto& lease = *input.lease;
    records << "{\"event\":\"live_owned_conversion\",\"prediction\":" << lease.prediction
            << ",\"timestamp_us\":" << lease.timestamp << ",\"faces\":" << input.originals.count
            << ",\"binding_id\":" << lease.bindingId << ",\"graph_id\":" << lease.graphId
            << ",\"conversion_scope\":\"native-seek\""
            << ",\"source_points_unchanged\":true,\"candidate_source\":\"fresh-worker-inference\","
               "\"native_analysis_bypassed\":false}\n" << std::flush;
  } catch (...) {
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
  void* registry = field<void*>(implementation, 0x658);
  if (!registry) throw std::runtime_error("live face adapter registry unavailable");
  void* adapter = lookup(registry, &type);
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

void prepareOwnedSeek(void* manager) {
  if (!liveColdFrame) return;
  if (!traceUpdates)
    throw std::runtime_error("cold setup requires update tracing");
  liveColdSetup.prepare(manager);
  liveSeekManager = manager;
  liveColdSeekStartPrediction = livePrediction;
}

void prepareOwnedPrediction() {
  if (!liveColdFrame) return;
  std::set<void*> algorithms;
  const bool installed = liveColdSetup.installForPrediction(livePrediction, [&](void* manager) {
    if (nativeUpdateCalls != 0)
      throw std::runtime_error("cold setup missed the first native update");
    visitManagerAlgorithms(manager, [&](void* algorithm) {
      if (!algorithms.insert(algorithm).second) return;
      if (algorithms.size() > 32)
        throw std::runtime_error("too many cold setup algorithms");
      // No lazy face lookup or raw-result read while prediction is still unwinding.
      installUpdateTrace(algorithm);
      inspectOwnedAdapter(algorithm);
    });
    if (algorithms.empty()) throw std::runtime_error("cold callback algorithm list is empty");
    installMakeupObservers();
  });
  if (installed) {
    records << "{\"event\":\"live_cold_setup\",\"algorithms\":" << algorithms.size()
            << ",\"first_prediction\":0,\"setup_scope\":\"worker-result\","
               "\"inspection_performed\":false,\"renderer_consumption\":false}\n" << std::flush;
  }
}

void finishOwnedBinding(void* manager) {
  const bool coldSeek = liveColdSetup.finish();
  const auto fence = [&] {
    using Getter = void* (*)(void*);
    const auto amazer = jianying_probe::resolveSymbol<Getter>(core, "_ZNK13AmazingEngine12SwingManager9getAmazerEv");
    const auto renderer = reinterpret_cast<Getter>(static_cast<unsigned char*>(imageBase()) + 0x3f9fd8)(amazer(manager));
    if (!renderer) throw std::runtime_error("live completion renderer missing");
    jianying_probe::resolveSymbol<ReferenceOperation>(core, "_ZN13AmazingEngine14RendererDevice6finishEv")(renderer);
  };
  using Raw = void* (*)(void*, int);
  const auto raw = reinterpret_cast<Raw>(static_cast<unsigned char*>(imageBase()) + 0xc15cd4);
  const auto publish = reinterpret_cast<Publish>(static_cast<unsigned char*>(imageBase()) + 0xc157e8);
  bool finished = false;
  try {
    finished = liveLeases.finish(fence, [&](void* graph) { return raw(graph, 4); },
        [&](void* graph, void* source) { publish(graph, 4, &source); },
        [&](const qcut_live::CloneLease& lease) {
          records << "{\"event\":\""
                  << (lease.converted ? "live_owned_restored" : "live_owned_rollback")
                  << "\",\"prediction\":" << lease.prediction << ",\"timestamp_us\":" << lease.timestamp
                  << ",\"binding_id\":" << lease.bindingId << ",\"graph_id\":" << lease.graphId
                  << ",\"gpu_complete\":true,\"original_restored\":true}\n" << std::flush;
        });
  } catch (...) {
    if (updateError) std::rethrow_exception(updateError);
    throw;
  }
  if (coldSeek && !updateError && livePrediction <= liveColdSeekStartPrediction)
    throw std::runtime_error("live prediction missing or not consumed by renderer");
  if (finished && !updateError) {
    if (!livePending) throw std::runtime_error("live prediction missing or not consumed by renderer");
    liveLeases.validateConsumption();
  }
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
    const auto response = qcut_live::parseResponse(bytes, size, token, getpid(), livePrediction + 1, seekTimestamp);
    ReplayFrame frame;
    frame.timestamp = response.timestamp;
    for (const auto& face : response.faces) {
      frame.faces.push_back({face.id, face.points});
    }
    liveLeases.begin(response.prediction, response.timestamp);
    livePending = std::move(frame);
    livePrediction = response.prediction;
    records << "{\"event\":\"live_candidate_received\",\"prediction\":" << livePrediction
            << ",\"timestamp_us\":" << seekTimestamp << "}\n" << std::flush;
    prepareOwnedPrediction();
  } catch (...) { updateError = std::current_exception(); }
}

int main(int argc, char* argv[]) {
  if (std::getenv("QCUT_FACE_LIVE_COLD_FRAME") && !liveColdFrame) return 1;
  if (std::getenv("QCUT_FACE_LIVE_MAKEUP_TRACE") && (!liveMakeupTrace || !liveColdFrame)) return 1;
  if (std::getenv("QCUT_FACE_LIVE_MAKEUP_PUBLISH") && (!liveMakeupPublish || !liveMakeupTrace)) return 1;
  if (!std::getenv("QCUT_FACE_LIVE_TOKEN") || !std::getenv("QCUT_FACE_LIVE_SOCKET") ||
      std::getenv("QCUT_FACE_REPLAY") || std::getenv("QCUT_FACE_BIND_REPLAY") ||
      std::getenv("QCUT_FACE_BIND_EYE_SHIFT") ||
      std::string(std::getenv("QCUT_FACE_POINT_SHIFT") ?: "invalid") != "0") return 1;
  return liveConsumerMain(argc, argv);
}
#endif
