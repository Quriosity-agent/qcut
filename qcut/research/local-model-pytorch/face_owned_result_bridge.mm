// Research-only ownership audit; the product host never installs this callback.
namespace { void inspectOwnedResult(const void* buffer); }
#define QCUT_FACE_RESULT_HOOK
#include "face_render_consumer_bridge.mm"
#undef QCUT_FACE_RESULT_HOOK

namespace {
using CloneFace = void* (*)(const void*);
using ReferenceOperation = void (*)(const void*);
using ReferenceCount = int (*)(const void*);

struct FaceOwner {
  void* value;
  ReferenceOperation release;
  ~FaceOwner() { release(value); }
  FaceOwner(const FaceOwner&) = delete;
  FaceOwner& operator=(const FaceOwner&) = delete;
  FaceOwner(void* object, ReferenceOperation operation) : value(object), release(operation) {}
};

struct PointerSpan {
  std::uintptr_t begin;
  std::size_t count;
};

PointerSpan pointerSpan(const void* object, std::size_t offset) {
  const auto begin = field<std::uintptr_t>(object, offset);
  const auto end = field<std::uintptr_t>(object, offset + 8);
  const auto capacity = field<std::uintptr_t>(object, offset + 16);
  if (end < begin || capacity < end || (end - begin) % 8 != 0 ||
      (capacity - begin) % 8 != 0 || (end - begin) / 8 > 10 ||
      (capacity - begin) / 8 > 64 || (begin == 0 && capacity != 0))
    throw std::runtime_error("invalid bounded clone vector");
  return {.begin = begin, .count = (end - begin) / 8};
}

void equalBytes(const void* first, const void* second, std::size_t size) {
  std::array<unsigned char, 4096> left{}, right{};
  if (size > left.size() || (size != 0 &&
      (!readMemory(first, left.data(), size) || !readMemory(second, right.data(), size))) ||
      std::memcmp(left.data(), right.data(), size) != 0)
    throw std::runtime_error("clone metadata or primitive data differs");
}

void primitiveCopy(const void* first, const void* second) {
  if ((first == nullptr) != (second == nullptr))
    throw std::runtime_error("clone primitive presence differs");
  if (first == nullptr) return;
  const auto begin = field<std::uintptr_t>(first, 0x10);
  const auto end = field<std::uintptr_t>(first, 0x18);
  const auto clonedBegin = field<std::uintptr_t>(second, 0x10);
  const auto clonedEnd = field<std::uintptr_t>(second, 0x18);
  if (first == second || end < begin || clonedEnd < clonedBegin ||
      end - begin != clonedEnd - clonedBegin || end - begin > 4096 ||
      (end != begin && (begin == 0 || clonedBegin == 0 || begin == clonedBegin)))
    throw std::runtime_error("clone primitive storage is shared or invalid");
  equalBytes(reinterpret_cast<const void*>(begin),
             reinterpret_cast<const void*>(clonedBegin), end - begin);
}

void inspectOwnedResult(const void* buffer) {
  const auto clone = jianying_probe::resolveSymbol<CloneFace>(core,
      "_ZNK4Bach10FaceBuffer5CloneEv");
  const auto retain = jianying_probe::resolveSymbol<ReferenceOperation>(core,
      "_ZNK13AmazingEngine7RefBase6retainEv");
  const auto release = jianying_probe::resolveSymbol<ReferenceOperation>(core,
      "_ZNK13AmazingEngine7RefBase7releaseEv");
  const auto count = jianying_probe::resolveSymbol<ReferenceCount>(core,
      "_ZNK13AmazingEngine7RefBase11getRefCountEv");
  if (imageOffset(reinterpret_cast<void*>(clone)) != 0xcd96dc ||
      jianying_probe::runtimeImageUuid(reinterpret_cast<void*>(retain)) !=
          "57ECC10F-8BB8-319C-BA46-AF286E2EBD43")
    throw std::runtime_error("unverified clone or ownership implementation");
  const int sourceReferences = count(buffer);
  void* copied = clone(buffer);
  if (copied == nullptr || copied == buffer)
    throw std::runtime_error("clone did not allocate a distinct FaceBuffer");
  const int initialCount = count(copied);
  retain(copied);
  const FaceOwner owner(copied, release);
  if (initialCount != 0 || count(copied) != 1 || count(buffer) != sourceReferences ||
      field<void*>(copied, 0) != field<void*>(buffer, 0) ||
      field<int>(copied, 0x30) != field<int>(buffer, 0x30))
    throw std::runtime_error("clone type or reference-count contract differs");
  equalBytes(static_cast<const unsigned char*>(buffer) + 0xe0,
             static_cast<const unsigned char*>(copied) + 0xe0, 8);
  std::array<std::size_t, 6> sizes{};
  std::size_t vectorIndex = 0;
  for (std::size_t offset : {0x38, 0x50, 0x68, 0x80, 0x98, 0xb0}) {
    const auto original = pointerSpan(buffer, offset);
    const auto duplicate = pointerSpan(copied, offset);
    if (original.count != duplicate.count ||
        (original.count != 0 && original.begin == duplicate.begin))
      throw std::runtime_error("clone vector is shared or differs in length");
    sizes[vectorIndex++] = original.count;
    for (std::size_t index = 0; index < original.count; ++index) {
      const void* first = field<void*>(reinterpret_cast<void*>(original.begin), index * 8);
      const void* second = field<void*>(reinterpret_cast<void*>(duplicate.begin), index * 8);
      if (first == nullptr || second == nullptr || first == second ||
          field<void*>(first, 0) != field<void*>(second, 0))
        throw std::runtime_error("clone child object is shared or invalid");
      if (offset != 0x38) continue;
      equalBytes(static_cast<const unsigned char*>(first) + 0xc,
                 static_cast<const unsigned char*>(second) + 0xc, 20);
      equalBytes(static_cast<const unsigned char*>(first) + 0x30,
                 static_cast<const unsigned char*>(second) + 0x30, 28);
      primitiveCopy(field<void*>(first, 0x20), field<void*>(second, 0x20));
      primitiveCopy(field<void*>(first, 0x28), field<void*>(second, 0x28));
      const auto originalPoints = readLandmarks(first);
      const auto clonedPoints = readLandmarks(second);
      auto changed = clonedPoints.coordinates;
      changed[104] += 0.001f;
      writeLandmarks(clonedPoints.destination, changed);
      if (readLandmarks(first).coordinates != originalPoints.coordinates ||
          readLandmarks(second).coordinates != changed)
        throw std::runtime_error("mutating clone affected the original landmarks");
      writeLandmarks(clonedPoints.destination, clonedPoints.coordinates);
    }
  }
  retain(copied);
  if (count(copied) != 2) throw std::runtime_error("clone retain did not increment");
  release(copied);
  if (count(copied) != 1 || count(buffer) != sourceReferences)
    throw std::runtime_error("clone release changed the wrong owner");
  records << "{\"event\":\"face_clone_audit\",\"distinct_buffer\":true,"
             "\"initial_refcount\":0,\"owned_refcount\":1,"
             "\"source_refcount\":" << sourceReferences << ",\"vector_counts\":[";
  for (std::size_t index = 0; index < sizes.size(); ++index)
    records << (index == 0 ? "" : ",") << sizes[index];
  records << "],\"primary_metadata_equal\":true,\"primary_points_isolated\":true,"
             "\"all_masks_exercised\":false,\"native_analysis_bypassed\":false}\n"
          << std::flush;
}
}  // namespace
