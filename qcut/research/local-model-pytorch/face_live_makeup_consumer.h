#pragma once
// Included inside the research host after its live state and geometry validator.
const bool liveMakeupConsume = std::string(std::getenv("QCUT_FACE_LIVE_MAKEUP_CONSUME") ?: "") == "1";
using MakeupGeometry = void (*)(void*, void*, void*, void*, int, int);
struct MakeupGeometryShadow {
  std::array<void*, 32> table{};
  void* originalTable = nullptr;
  MakeupGeometry original = nullptr;
  void* system = nullptr;
  size_t index = 0;
};
std::map<void*, MakeupGeometryShadow> liveGeometry;
const OwnedLiveInput* activeMakeupInput = nullptr;
void* activeMakeupSystem = nullptr;
size_t liveGeometryCalls = 0;
struct MakeupSnapshot { void* base; PointRestore points; int faceId; };
std::optional<MakeupSnapshot> activeMakeupSnapshot;

void verifyMakeupSnapshot() {
  if (!activeMakeupSnapshot || !activeMakeupInput || !livePending || livePending->faces.size() != 1)
    throw std::runtime_error("missing immutable makeup snapshot");
  const auto& snapshot = *activeMakeupSnapshot;
  const auto faces = pointerSpan(activeMakeupInput->lease->duplicate, 0x38);
  if (faces.count != 1 || field<void*>(reinterpret_cast<void*>(faces.begin), 0) != snapshot.base ||
      field<int>(snapshot.base, 0x40) != snapshot.faceId || snapshot.faceId != livePending->faces[0].id)
    throw std::runtime_error("makeup face identity changed after publication");
  const auto current = readLandmarks(snapshot.base);
  if (current.destination != snapshot.points.destination ||
      std::memcmp(current.coordinates.data(), snapshot.points.coordinates.data(), sizeof(current.coordinates)) ||
      std::memcmp(current.coordinates.data(), livePending->faces[0].coordinates.data(), sizeof(current.coordinates)))
    throw std::runtime_error("makeup candidate changed after publication");
}

void writeMakeupBits(const std::array<float, 212>& values) {
  records << '[';
  for (size_t index = 0; index < values.size(); index += 2) {
    records << (index ? ",[" : "[") << std::bit_cast<uint32_t>(values[index])
            << ',' << std::bit_cast<uint32_t>(values[index + 1]) << ']';
  }
  records << ']';
}

__attribute__((noinline)) void consumeMakeupGeometry(void* object, void* primary, void* extra,
                                                     void* auxiliary, int width, int height) {
  try {
    const auto& shadow = liveGeometry.at(object);
    const auto caller = __builtin_return_address(0);
    if (imageOffset(caller) != 0x9eba4c || std::this_thread::get_id() != seekThread || updateError)
      throw std::runtime_error("makeup geometry caller/thread/error mismatch: " + std::to_string(imageOffset(caller)));
    if (!activeMakeupInput || !activeMakeupSnapshot || activeMakeupSystem != shadow.system || shadow.index != 0 ||
        livePrediction != 1 || !liveLeases.injecting() || ++liveGeometryCalls != 1)
      throw std::runtime_error("makeup geometry consumer outside current final publication");
    if (primary != static_cast<unsigned char*>(object) + 8 ||
        extra != static_cast<unsigned char*>(object) + 16 || !auxiliary)
      throw std::runtime_error("makeup geometry reference arguments mismatch");
    const auto& input = *activeMakeupInput;
    const auto& lease = *input.lease;
    const auto faces = pointerSpan(lease.duplicate, 0x38);
    if (faces.count != 1 || input.originals.count != 1 || lease.prediction != livePrediction ||
        lease.timestamp != seekTimestamp || currentMakeupGraph() != lease.graph)
      throw std::runtime_error("makeup geometry lease mismatch");
    const auto sourceBase = field<void*>(reinterpret_cast<void*>(faces.begin), 0);
    const auto destinationBase = field<void*>(primary, 0);
    const auto source = readLandmarks(sourceBase), destination = readLandmarks(destinationBase);
    verifyMakeupSnapshot();
    if (sourceBase == destinationBase || source.destination == destination.destination ||
        field<int>(sourceBase, 0x40) != 0 || field<int>(destinationBase, 0x40) != 0)
      throw std::runtime_error("makeup geometry storage or face identity mismatch");
    qcut_live::validateMakeupGeometry(source.coordinates, destination.coordinates, width, height);
    input.validateSource();
    records << "{\"event\":\"live_makeup_geometry_enter\",\"prediction\":1,\"timestamp_us\":0"
            << ",\"binding_id\":" << lease.bindingId << ",\"graph_id\":" << lease.graphId
            << ",\"graph\":" << reinterpret_cast<uintptr_t>(lease.graph)
            << ",\"thread\":" << makeupThreadId() << ",\"object\":" << reinterpret_cast<uintptr_t>(object)
            << ",\"source_base\":" << reinterpret_cast<uintptr_t>(sourceBase)
            << ",\"source_points\":" << reinterpret_cast<uintptr_t>(source.destination)
            << ",\"destination_base\":" << reinterpret_cast<uintptr_t>(destinationBase)
            << ",\"destination_points\":" << reinterpret_cast<uintptr_t>(destination.destination)
            << ",\"caller_offset\":10402380,\"process_offset\":10533716,\"face_id\":0"
            << ",\"width\":" << width << ",\"height\":" << height << ",\"source_bits\":";
    writeMakeupBits(source.coordinates);
    records << ",\"destination_bits\":";
    writeMakeupBits(destination.coordinates);
    records << ",\"renderer_consumption\":false}\n" << std::flush;
    shadow.original(object, primary, extra, auxiliary, width, height);
    input.validateSource();
    verifyMakeupSnapshot();
    equalBytes(source.destination, source.coordinates.data(), sizeof(source.coordinates));
    if (updateError || currentMakeupGraph() != lease.graph)
      throw std::runtime_error("makeup geometry consumer failed or changed graph");
    records << "{\"event\":\"live_makeup_geometry_complete\",\"prediction\":1,\"timestamp_us\":0"
            << ",\"binding_id\":" << lease.bindingId << ",\"graph_id\":" << lease.graphId
            << ",\"thread\":" << makeupThreadId() << ",\"object\":" << reinterpret_cast<uintptr_t>(object)
            << ",\"native_returned\":true,\"source_points_unchanged\":true,\"renderer_consumption\":false}\n"
            << std::flush;
  } catch (...) { updateError = std::current_exception(); }
}

void restoreMakeupConsumers() {
  std::exception_ptr failure;
  for (auto entry = liveGeometry.begin(); entry != liveGeometry.end();) {
    const auto& [object, shadow] = *entry;
    try {
      if (field<void*>(object, 0) != shadow.table.data() + 2)
        throw std::runtime_error("makeup consumer table changed before restoration");
      std::memcpy(object, &shadow.originalTable, sizeof(void*));
      entry = liveGeometry.erase(entry);
    } catch (...) {
      if (!failure) failure = std::current_exception();
      ++entry;
    }
  }
  if (failure) std::rethrow_exception(failure);
}

void installMakeupConsumers(void* system) {
  if (!liveGeometry.empty()) throw std::runtime_error("makeup consumers already installed");
  const auto objects = pointerSpan(system, 0xd0);
  if (objects.count != 10) throw std::runtime_error("unverified makeup geometry inventory");
  for (size_t index = 0; index < objects.count; ++index) {
    void* object = field<void*>(reinterpret_cast<void*>(objects.begin), index * 8);
    auto* table = field<unsigned char*>(object, 0);
    auto* base = static_cast<unsigned char*>(imageBase());
    if (table != base + 0x35eac48 || field<void*>(table, 0x10) != base + 0xa0bb54 ||
        liveGeometry.contains(object))
      throw std::runtime_error("unverified makeup geometry consumer table");
    MakeupGeometryShadow prepared;
    if (!readMemory(table - 16, prepared.table.data(), sizeof(prepared.table)))
      throw std::runtime_error("unreadable makeup geometry consumer table");
    auto& shadow = liveGeometry.emplace(object, std::move(prepared)).first->second;
    shadow.originalTable = table;
    shadow.original = reinterpret_cast<MakeupGeometry>(shadow.table[4]);
    shadow.system = system;
    shadow.index = index;
    shadow.table[4] = reinterpret_cast<void*>(consumeMakeupGeometry);
    void* replacement = shadow.table.data() + 2;
    std::memcpy(object, &replacement, sizeof(replacement));
  }
}
