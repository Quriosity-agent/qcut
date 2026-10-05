#pragma once
// Included after host ownership and seek state; this route never marks a lease converted.
std::map<void*, qcut_live::ReshapeUpdateBinding> liveReshapeSystems;

bool readReshapeMemory(uintptr_t address, void* output, size_t size) {
  return readMemory(reinterpret_cast<const void*>(address), output, size);
}

bool writeReshapeVptr(uintptr_t address, const void* input, size_t size) {
  if (size != sizeof(uintptr_t) || !liveReshapeSystems.contains(reinterpret_cast<void*>(address)))
    return false;
  std::memcpy(reinterpret_cast<void*>(address), input, size);
  return true;
}

std::string reshapeCoreHash() {
  Dl_info image{};
  if (!dladdr(imageBase(), &image) || !image.dli_fname)
    throw std::runtime_error("reshape core path unavailable");
  std::ifstream source(image.dli_fname, std::ios::binary);
  if (!source) throw std::runtime_error("reshape core file unavailable");
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  std::array<char, 65536> bytes;
  size_t total = 0;
  while (source.read(bytes.data(), bytes.size()) || source.gcount()) {
    total += source.gcount();
    if (total > 1024ull * 1024 * 1024)
      throw std::runtime_error("reshape core hash budget exceeded");
    CC_SHA256_Update(&context, bytes.data(), static_cast<CC_LONG>(source.gcount()));
  }
  if (!source.eof() || !total) throw std::runtime_error("reshape core read failed");
  std::array<unsigned char, CC_SHA256_DIGEST_LENGTH> digest;
  CC_SHA256_Final(digest.data(), &context);
  std::ostringstream text;
  for (unsigned char value : digest)
    text << std::hex << std::setfill('0') << std::setw(2) << static_cast<unsigned>(value);
  return text.str();
}

void recordReshapeUpdate(const qcut_live::ReshapeUpdateReceipt& receipt, void* system) {
  const auto& publication = receipt.publication;
  records << "{\"event\":\""
          << (receipt.nativeReturned ? "live_reshape_update_exit" : "live_reshape_publication")
          << "\",\"prediction\":" << publication.prediction << ",\"timestamp_us\":0"
          << ",\"system\":" << reinterpret_cast<uintptr_t>(system)
          << ",\"binding_id\":" << publication.bindingId << ",\"graph_id\":" << publication.graphId
          << ",\"graph\":" << publication.graph << ",\"thread\":" << publication.thread
          << ",\"source_buffer\":" << publication.sourceBuffer << ",\"owned_buffer\":" << publication.ownedBuffer
          << ",\"source_base\":" << publication.sourceBase << ",\"owned_base\":" << publication.ownedBase
          << ",\"source_points\":" << publication.sourcePoints << ",\"owned_points\":" << publication.ownedPoints
          << ",\"face_id\":0,\"faces\":1,\"candidate_injected\":true,\"source_points_unchanged\":true"
          << ",\"native_returned\":" << (receipt.nativeReturned ? "true" : "false")
          << ",\"renderer_consumption\":false}\n" << std::flush;
}

__attribute__((noinline)) void tracedReshapeUpdate(void* system, double delta) {
  try {
    const auto thread = makeupThreadId();
    const qcut_live::ReshapeUpdateRequest request{
      .system = reinterpret_cast<uintptr_t>(system),
      .callerOffset = imageOffset(__builtin_return_address(0)),
      .thread = thread, .seekThread = std::this_thread::get_id() == seekThread ? thread : 0,
      .prediction = livePrediction, .timestamp = seekTimestamp, .delta = delta,
      .injecting = liveLeases.injecting(), .priorFailure = static_cast<bool>(updateError)};
    std::optional<OwnedLiveInput> input;
    std::optional<PointRestore> immutable;
    liveReshapeSystems.at(system).update(request, readReshapeMemory, [&] {
      input = publishLiveInput(currentMakeupGraph());
      const auto& lease = *input->lease;
      const auto faces = pointerSpan(lease.duplicate, 0x38);
      if (faces.count != 1 || input->originals.count != 1)
        throw std::runtime_error("reshape requires one owned face");
      const void* owned = field<void*>(reinterpret_cast<void*>(faces.begin), 0);
      const void* source = field<void*>(reinterpret_cast<void*>(input->originals.begin), 0);
      immutable = readLandmarks(owned);
      return qcut_live::ReshapePublication{
        .graph = reinterpret_cast<uintptr_t>(lease.graph),
        .sourceBuffer = reinterpret_cast<uintptr_t>(lease.source.get()),
        .ownedBuffer = reinterpret_cast<uintptr_t>(lease.duplicate),
        .sourceBase = reinterpret_cast<uintptr_t>(source), .ownedBase = reinterpret_cast<uintptr_t>(owned),
        .sourcePoints = reinterpret_cast<uintptr_t>(readLandmarks(source).destination),
        .ownedPoints = reinterpret_cast<uintptr_t>(immutable->destination),
        .bindingId = lease.bindingId, .graphId = lease.graphId, .thread = thread,
        .prediction = lease.prediction, .timestamp = lease.timestamp,
        .faceId = field<int>(owned, 0x40), .faces = faces.count};
    }, [&](const qcut_live::ReshapePublication& publication) {
      if (updateError) std::rethrow_exception(updateError);
      if (!input || !immutable || !livePending || livePending->faces.size() != 1 ||
          currentMakeupGraph() != input->lease->graph || !liveLeases.injecting())
        throw std::runtime_error("reshape publication scope changed");
      const auto faces = pointerSpan(input->lease->duplicate, 0x38);
      const auto owned = reinterpret_cast<void*>(publication.ownedBase);
      const auto current = readLandmarks(owned);
      using Raw = void* (*)(void*, int);
      const auto raw = reinterpret_cast<Raw>(static_cast<unsigned char*>(imageBase()) + 0xc15cd4);
      if (raw(input->lease->graph, 4) != input->lease->duplicate || faces.count != 1 ||
          field<void*>(reinterpret_cast<void*>(faces.begin), 0) != owned ||
          field<int>(owned, 0x40) != publication.faceId ||
          livePending->timestamp != publication.timestamp || livePending->faces[0].id != publication.faceId ||
          current.destination != immutable->destination ||
          std::memcmp(current.coordinates.data(), immutable->coordinates.data(), sizeof(current.coordinates)) ||
          std::memcmp(current.coordinates.data(), livePending->faces[0].coordinates.data(), sizeof(current.coordinates)))
        throw std::runtime_error("reshape immutable candidate or graph binding changed");
      input->validateSource();
    }, [&](const qcut_live::ReshapeUpdateReceipt& receipt) { recordReshapeUpdate(receipt, system); });
  } catch (...) { updateError = std::current_exception(); }
}

void restoreReshapeObservers() {
  std::exception_ptr failure;
  for (auto& [system, binding] : liveReshapeSystems) {
    if (!binding.installed()) continue;
    try { binding.restore(readReshapeMemory, writeReshapeVptr); }
    catch (...) { if (!failure) failure = std::current_exception(); }
  }
  if (failure) std::rethrow_exception(failure);
}

void installReshapeObservers() {
  if (!liveReshapePublish) return;
  using SceneGetter = void* (*)(const void*, int);
  const auto getScene = jianying_probe::resolveSymbol<SceneGetter>(core,
      "_ZNK13AmazingEngine14FeatureSegment8getSceneEi");
  if (imageOffset(reinterpret_cast<void*>(getScene)) != 0x180b8ac || !liveReshapeSystems.empty())
    throw std::runtime_error("unverified or repeated reshape scene lookup");
  const auto inventory = qcut_live::inspectFaceSystemScenes(reinterpret_cast<uintptr_t>(liveFeature),
      qcut_live::kReshapeTable, qcut_live::kReshapeUpdate, readReshapeMemory,
      [](uintptr_t address) { return imageOffset(reinterpret_cast<void*>(address)); },
      [&](uintptr_t feature, int index) { return reinterpret_cast<uintptr_t>(getScene(reinterpret_cast<void*>(feature), index)); });
  if (inventory.matched.size() != 1) throw std::runtime_error("reshape diagnostic requires exactly one system");
  const std::string uuid = jianying_probe::runtimeImageUuid(imageBase()), hash = reshapeCoreHash();
  const uintptr_t address = inventory.matched.front();
  auto& binding = liveReshapeSystems.try_emplace(reinterpret_cast<void*>(address)).first->second;
  binding.prepare(address, {uuid, hash}, readReshapeMemory,
      [](uintptr_t value) { return imageOffset(reinterpret_cast<void*>(value)); });
  binding.install(tracedReshapeUpdate, readReshapeMemory, writeReshapeVptr);
  records << "{\"event\":\"live_reshape_setup\",\"scenes\":" << inventory.scenes
          << ",\"systems\":" << inventory.systems << ",\"reshape_systems\":1"
          << ",\"renderer_consumption\":false}\n" << std::flush;
}
