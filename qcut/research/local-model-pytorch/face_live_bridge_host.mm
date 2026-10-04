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
namespace {
void inspectOwnedAdapter(void*);
void finishOwnedBinding(void*);
void prepareOwnedSeek(void*);
}
#define QCUT_FACE_BINDING_HOOK
#define QCUT_FACE_PRE_SEEK_HOOK
#define main liveConsumerMain
#include "face_owned_result_bridge.mm"
#undef main
#undef QCUT_FACE_BINDING_HOOK
#undef QCUT_FACE_PRE_SEEK_HOOK

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

uint64_t liveConvert(void* adapter, void* context) {
  uint64_t result = 0;
  void* graph = nullptr;
  void* source = nullptr;
  Publish publish = nullptr;
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
    if (!livePending ||
        livePending->timestamp != seekTimestamp || liveClones.size() >= 128)
      throw std::runtime_error("missing/stale live result or unsupported conversion state");
    graph = field<void*>(context, 0x20);
    liveLeases.requireGraph(graph);
    using Raw = void* (*)(void*, int);
    const auto raw = reinterpret_cast<Raw>(static_cast<unsigned char*>(imageBase()) + 0xc15cd4);
    publish = reinterpret_cast<Publish>(static_cast<unsigned char*>(imageBase()) + 0xc157e8);
    source = raw(graph, 4);
    if (!source) throw std::runtime_error("live conversion has no FaceBuffer");
    if (liveColdFrame && livePrediction == 0) {
      const auto expected = static_cast<unsigned char*>(dlsym(core, "_ZTVN4Bach10FaceBufferE"));
      if (!expected || field<void*>(source, 0) != expected + 16)
        throw std::runtime_error("cold conversion result is not a FaceBuffer");
      // The first update was already on-stack when its hook was installed.
      inspectOwnedResult(source);
    }
    const auto clone = jianying_probe::resolveSymbol<CloneFace>(core, "_ZNK4Bach10FaceBuffer5CloneEv");
    const auto retain = jianying_probe::resolveSymbol<ReferenceOperation>(core, "_ZNK13AmazingEngine7RefBase6retainEv");
    const auto release = jianying_probe::resolveSymbol<ReferenceOperation>(core, "_ZNK13AmazingEngine7RefBase7releaseEv");
    void* duplicate = clone(source);
    if (!duplicate || duplicate == source) throw std::runtime_error("live clone allocation failed");
    retain(duplicate);
    auto owner = std::make_unique<FaceOwner>(duplicate, release);
    retain(source);
    std::shared_ptr<void> originalOwner(source, release);
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
    const auto& lease = liveLeases.reserve(graph, duplicate, std::move(originalOwner));
    publish(graph, 4, &duplicate);
    if (raw(graph, 4) != duplicate) throw std::runtime_error("live clone publication failed");
    liveLeases.published(graph);
    result = liveAdapters.at(adapter).original(adapter, context);
    for (size_t index = 0; index < originals.count; ++index) {
      const void* original = field<void*>(reinterpret_cast<void*>(originals.begin), index * 8);
      if (readLandmarks(original).coordinates != before[index].coordinates)
        throw std::runtime_error("live conversion changed native source landmarks");
    }
    liveLeases.converted(graph);
    records << "{\"event\":\"live_owned_conversion\",\"prediction\":" << lease.prediction
            << ",\"timestamp_us\":" << lease.timestamp << ",\"faces\":" << faces.count
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
  if (!std::getenv("QCUT_FACE_LIVE_TOKEN") || !std::getenv("QCUT_FACE_LIVE_SOCKET") ||
      std::getenv("QCUT_FACE_REPLAY") || std::getenv("QCUT_FACE_BIND_REPLAY") ||
      std::getenv("QCUT_FACE_BIND_EYE_SHIFT") ||
      std::string(std::getenv("QCUT_FACE_POINT_SHIFT") ?: "invalid") != "0") return 1;
  return liveConsumerMain(argc, argv);
}
#endif
