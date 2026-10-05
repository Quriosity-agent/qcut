#pragma once
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <stdexcept>
#include <string_view>

namespace qcut_live {
constexpr uintptr_t kReshapeTable = 0x35e58a0;
constexpr uintptr_t kReshapeUpdate = 0x9d9428;
constexpr uintptr_t kReshapeUpdateCaller = 0x61cd94;
constexpr std::string_view kReshapeCoreUuid = "D6342ECD-5432-33F0-A2AD-0C28F5699994";
constexpr std::string_view kReshapeCoreSha256 =
    "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9";
using ReshapeUpdate = void (*)(void*, double);

struct ReshapeImageIdentity {
  std::string_view uuid;
  std::string_view sha256;
};

struct ReshapePublication {
  uintptr_t graph = 0;
  uintptr_t sourceBuffer = 0;
  uintptr_t ownedBuffer = 0;
  uintptr_t sourceBase = 0;
  uintptr_t ownedBase = 0;
  uintptr_t sourcePoints = 0;
  uintptr_t ownedPoints = 0;
  uint64_t bindingId = 0;
  uint64_t graphId = 0;
  uint64_t thread = 0;
  int64_t prediction = -1;
  int64_t timestamp = -1;
  int faceId = -1;
  size_t faces = 0;
};

struct ReshapeUpdateRequest {
  uintptr_t system = 0;
  uintptr_t callerOffset = 0;
  uint64_t thread = 0;
  uint64_t seekThread = 0;
  int64_t prediction = -1;
  int64_t timestamp = -1;
  double delta = 0;
  bool injecting = false;
  bool priorFailure = false;
};

struct ReshapeUpdateReceipt {
  ReshapePublication publication;
  bool nativeReturned = false;
  bool sourceValidated = false;
  bool rendererConsumption = false;
};

inline void requireReshape(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

inline bool reshapeAddress(uintptr_t address) {
  return address >= 4096 && address % 8 == 0 && address <= UINTPTR_MAX - 0x1000;
}

inline void validateReshapePublication(const ReshapePublication& publication,
                                      const ReshapeUpdateRequest& request) {
  requireReshape(publication.prediction == request.prediction && publication.timestamp == 0 &&
      publication.thread == request.thread && publication.faces == 1 && publication.faceId == 0 &&
      publication.bindingId > 0 && publication.graphId > 0,
      "reshape publication prediction, identity or thread mismatch");
  const std::array addresses{publication.graph, publication.sourceBuffer, publication.ownedBuffer,
      publication.sourceBase, publication.ownedBase, publication.sourcePoints, publication.ownedPoints};
  for (size_t index = 0; index < addresses.size(); ++index) {
    requireReshape(reshapeAddress(addresses[index]), "invalid reshape publication address");
    for (size_t previous = 0; previous < index; ++previous)
      requireReshape(addresses[index] != addresses[previous], "aliased reshape publication storage");
  }
  for (uintptr_t begin : {publication.sourcePoints, publication.ownedPoints}) {
    for (uintptr_t address : addresses)
      requireReshape(address == begin || address < begin || address >= begin + 848,
          "overlapping reshape point storage");
  }
}

// Session-owned and immovable: a failed restoration must not free an installed shadow.
class ReshapeUpdateBinding {
 public:
  ReshapeUpdateBinding() = default;
  ReshapeUpdateBinding(const ReshapeUpdateBinding&) = delete;
  ReshapeUpdateBinding& operator=(const ReshapeUpdateBinding&) = delete;
  ReshapeUpdateBinding(ReshapeUpdateBinding&&) = delete;
  ReshapeUpdateBinding& operator=(ReshapeUpdateBinding&&) = delete;

  template <typename Read, typename Offset>
  void prepare(uintptr_t system, ReshapeImageIdentity identity, Read read, Offset offset) {
    try {
      check(!prepared_ && !installed_ && !restored_, "reshape binding is not fresh");
      check(identity.uuid == kReshapeCoreUuid && identity.sha256 == kReshapeCoreSha256,
          "unverified reshape image identity");
      check(reshapeAddress(system), "invalid reshape system address");
      uintptr_t table = 0;
      check(read(system, &table, sizeof(table)) && reshapeAddress(table) && offset(table) == kReshapeTable,
          "unverified reshape system vtable");
      check(read(table - 16, originalTable_.data(), sizeof(originalTable_)) &&
          offset(originalTable_[kUpdateIndex]) == kReshapeUpdate,
          "unverified reshape update slot");
      uintptr_t current = 0;
      check(read(system, &current, sizeof(current)) && current == table,
          "reshape system changed during binding");
      system_ = system;
      table_ = table;
      original_ = reinterpret_cast<ReshapeUpdate>(originalTable_[kUpdateIndex]);
      shadow_ = originalTable_;
      prepared_ = true;
    } catch (...) { fail(); throw; }
  }

  template <typename Read, typename Write>
  void install(ReshapeUpdate replacement, Read read, Write write) {
    try {
      check(prepared_ && !installed_ && !restored_ && replacement && replacement != original_,
          "invalid reshape hook installation");
      checkOriginal(read);
      replacement_ = reinterpret_cast<uintptr_t>(replacement);
      shadow_[kUpdateIndex] = replacement_;
      const uintptr_t address = shadowAddress();
      // A short/failed write may have changed the vptr; keep the shadow alive for cleanup.
      installed_ = true;
      check(write(system_, &address, sizeof(address)), "reshape hook write failed");
      checkInstalled(read);
      installationConfirmed_ = true;
    } catch (...) { fail(); throw; }
  }

  template <typename Read, typename Write>
  void restore(Read read, Write write) {
    try {
      requireReshape(installed_ && !active_ && !restored_, "reshape restoration outside installed scope");
      uintptr_t current = 0;
      requireReshape(read(system_, &current, sizeof(current)), "unreadable reshape restoration vptr");
      requireReshape(current == shadowAddress() || (!installationConfirmed_ && current == table_),
          "reshape vtable superseded before restoration");
      if (current != table_)
        requireReshape(write(system_, &table_, sizeof(table_)), "reshape restoration write failed");
      requireReshape(read(system_, &current, sizeof(current)) && current == table_,
          "reshape vtable not restored");
      installed_ = false;
      restored_ = true;
    } catch (...) { fail(); throw; }
  }

  // Publish owns the CloneLease; validate checks immutable candidate/native points and current graph.
  // Neither publication nor return marks the lease converted or releases it before the GPU fence.
  template <typename Read, typename Publish, typename Validate, typename Observe>
  ReshapeUpdateReceipt update(const ReshapeUpdateRequest& request, Read read, Publish publish,
                             Validate validate, Observe observe) {
    try {
      check(installed_ && !restored_ && !active_, "reshape update outside installed scope");
      check(request.system == system_ && request.callerOffset == kReshapeUpdateCaller &&
          request.thread > 0 && request.thread == request.seekThread && request.timestamp == 0 &&
          request.injecting && !request.priorFailure && std::isfinite(request.delta) &&
          request.prediction == nextPrediction_ && nextPrediction_ < 2,
          "reshape update outside fresh single-frame prediction");
      checkInstalled(read);
      active_ = true;
      const ReshapePublication publication = publish();
      validateReshapePublication(publication, request);
      if (nextPrediction_ == 1) {
        check(publication.graph == previous_.graph && publication.graphId == previous_.graphId &&
            publication.thread == previous_.thread && publication.bindingId > previous_.bindingId,
            "reshape publication association changed");
        validateFreshStorage(publication);
      }
      validate(publication);
      observe(ReshapeUpdateReceipt{publication, false, true, false});
      original_(reinterpret_cast<void*>(system_), request.delta);
      checkInstalled(read);
      validate(publication);
      const ReshapeUpdateReceipt receipt{publication, true, true, false};
      observe(receipt);
      previous_ = publication;
      ++nextPrediction_;
      active_ = false;
      return receipt;
    } catch (...) { active_ = false; fail(); throw; }
  }

  bool installed() const { return installed_; }
  bool failed() const { return static_cast<bool>(failure_); }
  uintptr_t system() const { return system_; }
  uintptr_t shadowAddress() const { return reinterpret_cast<uintptr_t>(shadow_.data() + 2); }

 private:
  template <typename Read>
  void checkOriginal(Read read) {
    uintptr_t current = 0;
    std::array<uintptr_t, 32> table;
    check(read(system_, &current, sizeof(current)) && current == table_ &&
        read(table_ - 16, table.data(), sizeof(table)) && table == originalTable_,
        "reshape native vtable changed");
  }

  template <typename Read>
  void checkInstalled(Read read) {
    uintptr_t current = 0;
    std::array<uintptr_t, 32> table;
    auto expected = originalTable_;
    expected[kUpdateIndex] = replacement_;
    check(read(system_, &current, sizeof(current)) && current == shadowAddress() &&
        read(shadowAddress() - 16, table.data(), sizeof(table)) && table == expected,
        "reshape shadow vtable changed");
  }

  void validateFreshStorage(const ReshapePublication& current) {
    const std::array previousOwned{previous_.ownedBuffer, previous_.ownedBase, previous_.ownedPoints};
    const std::array currentOwned{current.ownedBuffer, current.ownedBase, current.ownedPoints};
    const std::array allSource{previous_.sourceBuffer, previous_.sourceBase, previous_.sourcePoints,
        current.sourceBuffer, current.sourceBase, current.sourcePoints};
    for (uintptr_t address : currentOwned) {
      for (uintptr_t previous : previousOwned)
        check(address != previous, "reshape owned storage reused across predictions");
      for (uintptr_t source : allSource)
        check(address != source, "reshape candidate aliases earlier source storage");
    }
    for (uintptr_t address : previousOwned)
      for (uintptr_t source : allSource)
        check(address != source, "reshape source aliases earlier candidate storage");
    check(current.ownedPoints + 848 <= previous_.ownedPoints ||
        previous_.ownedPoints + 848 <= current.ownedPoints, "reshape point spans reused");
    check(current.ownedPoints + 848 <= previous_.sourcePoints ||
        previous_.sourcePoints + 848 <= current.ownedPoints, "reshape prior source points overlap candidate");
    check(previous_.ownedPoints + 848 <= current.sourcePoints ||
        current.sourcePoints + 848 <= previous_.ownedPoints, "reshape source overlaps prior candidate points");
  }

  void check(bool condition, const char* message) const {
    if (failure_) std::rethrow_exception(failure_);
    requireReshape(condition, message);
  }
  void fail() { if (!failure_) failure_ = std::current_exception(); }
  static constexpr size_t kUpdateIndex = 2 + 0xb8 / sizeof(uintptr_t);
  static_assert(sizeof(uintptr_t) == 8);
  std::array<uintptr_t, 32> originalTable_{}, shadow_{};
  uintptr_t system_ = 0, table_ = 0, replacement_ = 0;
  ReshapeUpdate original_ = nullptr;
  std::exception_ptr failure_;
  ReshapePublication previous_;
  int64_t nextPrediction_ = 0;
  bool prepared_ = false, installed_ = false, restored_ = false, active_ = false;
  bool installationConfirmed_ = false;
};
}
