#pragma once
// Included after the live host state; both consumers share this ownership boundary.
struct OwnedLiveInput {
  const qcut_live::CloneLease* lease;
  PointerSpan originals;
  std::vector<PointRestore> before;

  void validateSource() const {
    for (size_t index = 0; index < originals.count; ++index) {
      const void* original = field<void*>(reinterpret_cast<void*>(originals.begin), index * 8);
      if (readLandmarks(original).coordinates != before[index].coordinates)
        throw std::runtime_error("live conversion changed native source landmarks");
    }
  }
};

OwnedLiveInput publishLiveInput(void* graph) {
  if (std::this_thread::get_id() != seekThread || updateError || !liveLeases.injecting() ||
      !livePending || livePending->timestamp != seekTimestamp || liveClones.size() >= 128)
    throw std::runtime_error("missing/stale live result or unsupported conversion state");
  liveLeases.requireGraph(graph);
  using Raw = void* (*)(void*, int);
  const auto raw = reinterpret_cast<Raw>(static_cast<unsigned char*>(imageBase()) + 0xc15cd4);
  const auto publish = reinterpret_cast<Publish>(static_cast<unsigned char*>(imageBase()) + 0xc157e8);
  void* source = raw(graph, 4);
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
  return {&lease, originals, std::move(before)};
}
