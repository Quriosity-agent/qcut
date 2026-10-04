#pragma once
// Included after shared live ownership state; hooks remain research-only.
const bool liveMakeupTrace = std::string(std::getenv("QCUT_FACE_LIVE_MAKEUP_TRACE") ?: "") == "1";
const bool liveMakeupPublish = std::string(std::getenv("QCUT_FACE_LIVE_MAKEUP_PUBLISH") ?: "") == "1";
const bool liveMakeupStages = std::string(std::getenv("QCUT_FACE_LIVE_MAKEUP_STAGES") ?: "") == "1";
qcut_live::MakeupRenderStage liveRenderStage;
std::optional<int> liveSeekResult;
void* liveFeature = nullptr;
void* liveSeekManager = nullptr;
using MakeupUpdate = void (*)(void*, double);
struct MakeupShadow { std::array<void*, 32> table{}; MakeupUpdate original = nullptr; };
std::map<void*, MakeupShadow> liveMakeupSystems;
size_t liveMakeupCalls = 0;

uint64_t makeupThreadId() {
  uint64_t id = 0;
  if (pthread_threadid_np(nullptr, &id) != 0 || id == 0)
    throw std::runtime_error("makeup thread identity unavailable");
  return id;
}

void captureOwnedFeature(void* feature) {
  if (!liveMakeupTrace) return;
  if (!feature || liveFeature) throw std::runtime_error("makeup trace requires one fresh feature");
  liveFeature = feature;
  if (liveMakeupStages) liveRenderStage.captureFeature(feature);
}

void observeOwnedSeekResult(int result) {
  if (!liveMakeupStages) return;
  if (liveSeekResult) throw std::runtime_error("duplicate makeup seek result");
  liveSeekResult = result;
}

void beginOwnedParameters(void* feature, const char* parameters) {
  if (!liveMakeupStages) return;
  if (std::this_thread::get_id() != seekThread || !parameters ||
      ::strnlen(parameters, 128 * 1024) == 0 || ::strnlen(parameters, 128 * 1024) == 128 * 1024)
    throw std::runtime_error("invalid makeup parameter payload or thread");
  liveRenderStage.beginParameters(feature);
}

void finishOwnedParameters(int result) {
  if (!liveMakeupStages) return;
  liveRenderStage.endParameters(result);
  records << "{\"event\":\"live_feature_parameters_applied\",\"prediction\":" << livePrediction
          << ",\"timestamp_us\":" << seekTimestamp
          << ",\"result\":0,\"renderer_consumption\":false}\n" << std::flush;
}

bool allowOwnedFrameOutput() {
  if (!liveMakeupStages || liveRenderStage.allowFrameOutput()) return true;
  records << "{\"event\":\"live_initialization_output_suppressed\",\"prediction\":" << livePrediction
          << ",\"timestamp_us\":" << seekTimestamp << ",\"renderer_consumption\":false}\n" << std::flush;
  return false;
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
      const void* sourceFirst = input->originals.count
          ? field<void*>(reinterpret_cast<void*>(input->originals.begin), 0) : nullptr;
      records << "{\"event\":\"live_makeup_publication\",\"prediction\":" << livePrediction
              << ",\"timestamp_us\":" << seekTimestamp << ",\"binding_id\":" << lease.bindingId
              << ",\"graph_id\":" << lease.graphId << ",\"graph\":" << reinterpret_cast<uintptr_t>(lease.graph)
              << ",\"source_buffer\":" << reinterpret_cast<uintptr_t>(lease.source.get())
              << ",\"owned_buffer\":" << reinterpret_cast<uintptr_t>(lease.duplicate)
              << ",\"owned_base\":" << reinterpret_cast<uintptr_t>(first)
              << ",\"owned_points\":" << (first ? reinterpret_cast<uintptr_t>(readLandmarks(first).destination) : 0)
              << ",\"source_base\":" << reinterpret_cast<uintptr_t>(sourceFirst)
              << ",\"source_points\":" << (sourceFirst ? reinterpret_cast<uintptr_t>(readLandmarks(sourceFirst).destination) : 0)
              << ",\"thread\":" << makeupThreadId() << ",\"face_id\":" << (first ? field<int>(first, 0x40) : -1)
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
