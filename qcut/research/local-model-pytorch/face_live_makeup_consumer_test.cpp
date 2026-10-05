#include "face_live_makeup_geometry.h"

#include <algorithm>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <functional>
#include <iostream>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {
using Points = std::array<float, 212>;
struct PointRestore { void* destination; Points coordinates; };
struct PointerSpan { uintptr_t begin; size_t count; };
struct Lease {
  void* graph;
  void* duplicate;
  int64_t prediction = 1, timestamp = 0;
  uint64_t bindingId = 2, graphId = 1;
};
struct ReplayFace { int id; Points coordinates; };
struct ReplayFrame { std::vector<ReplayFace> faces; };
struct InjectionScope { bool open = true; bool injecting() const { return open; } } liveLeases;
struct Call {
  void* object;
  void* primary;
  void* extra;
  void* auxiliary;
  int width = 17, height = 31;
  bool operator==(const Call&) const = default;
};
struct Region { uintptr_t address; const void* bytes; size_t size; };
std::vector<Region> memory;
std::vector<Call> originalCalls;
std::function<void()> originalAction;
std::optional<uintptr_t> blockedRead;
size_t tableReads = 0, failTableRead = 0, checks = 0, cases = 0, failures = 0;
uintptr_t configuredCaller = 0x9eba4c, fakeBase = 0;
std::thread::id seekThread;
std::exception_ptr updateError;
std::optional<ReplayFrame> livePending;
int64_t livePrediction = 1, seekTimestamp = 0;
void* currentGraph = nullptr;
std::ostringstream records;

void require(bool condition, const std::string& message) {
  ++checks;
  if (!condition) throw std::runtime_error(message);
}

template <typename Action>
void rejects(Action action, const std::string& message) {
  try { action(); }
  catch (const std::runtime_error& error) {
    require(std::string(error.what()).find(message) != std::string::npos,
            "unexpected exception: " + std::string(error.what()));
    return;
  }
  throw std::runtime_error("missing rejection: " + message);
}

bool readMemory(const void* address, void* output, size_t size) {
  const auto begin = reinterpret_cast<uintptr_t>(address);
  if (blockedRead && begin == *blockedRead) return false;
  if (begin == fakeBase + 0x35eac48 - 16 && size == 32 * sizeof(void*) &&
      ++tableReads == failTableRead) return false;
  for (const auto& region : memory) {
    if (begin >= region.address && begin - region.address <= region.size &&
        size <= region.size - (begin - region.address)) {
      std::memcpy(output, static_cast<const unsigned char*>(region.bytes) + begin - region.address, size);
      return true;
    }
  }
  return false;
}

template <typename Value>
Value field(const void* object, size_t offset) {
  Value value{};
  if (!object || !readMemory(reinterpret_cast<const void*>(reinterpret_cast<uintptr_t>(object) + offset),
                             &value, sizeof(value)))
    throw std::runtime_error("unreadable bounded object field");
  return value;
}

template <typename Value>
void put(void* object, size_t offset, Value value) {
  std::memcpy(static_cast<unsigned char*>(object) + offset, &value, sizeof(value));
}

PointerSpan pointerSpan(const void* object, size_t offset) {
  const auto begin = field<uintptr_t>(object, offset), end = field<uintptr_t>(object, offset + 8);
  if (end < begin || (end - begin) % 8 || (end - begin) / 8 > 10)
    throw std::runtime_error("invalid bounded clone vector");
  return {begin, (end - begin) / 8};
}

PointRestore readLandmarks(const void* face) {
  const auto vector = field<void*>(face, 0x20);
  const auto begin = field<uintptr_t>(vector, 0x10), end = field<uintptr_t>(vector, 0x18);
  PointRestore result{reinterpret_cast<void*>(begin), {}};
  if (!begin || end < begin || end - begin != sizeof(Points) ||
      !readMemory(result.destination, result.coordinates.data(), sizeof(Points)))
    throw std::runtime_error("unreadable 106 XY landmarks");
  for (float value : result.coordinates)
    if (!std::isfinite(value)) throw std::runtime_error("non-finite landmarks");
  return result;
}

void equalBytes(const void* source, const void* expected, size_t size) {
  Points actual{};
  if (size != sizeof(actual) || !readMemory(source, actual.data(), size) ||
      std::memcmp(actual.data(), expected, size)) throw std::runtime_error("point bytes changed");
}

struct OwnedLiveInput {
  Lease* lease;
  PointerSpan originals;
  Points before;
  void validateSource() const {
    const auto original = field<void*>(reinterpret_cast<void*>(originals.begin), 0);
    if (readLandmarks(original).coordinates != before)
      throw std::runtime_error("live conversion changed native source landmarks");
  }
};

void* imageBase() { return reinterpret_cast<void*>(fakeBase); }
uintptr_t imageOffset(const void*) { return configuredCaller; }
void* currentMakeupGraph() { return currentGraph; }
uint64_t makeupThreadId() { return 1; }

void originalGeometry(void* object, void* primary, void* extra, void* auxiliary, int width, int height) {
  originalCalls.push_back({object, primary, extra, auxiliary, width, height});
  if (originalAction) originalAction();
}

// Only host dependencies are stubbed; dispatch, guards, snapshots, and restoration come from this header.
#include "face_live_makeup_consumer.h"

struct Face {
  alignas(void*) std::array<unsigned char, 0x48> bytes{};
  std::array<uintptr_t, 4> vector{};
  Points xy{};
  void link(Points& values) {
    put(bytes.data(), 0x20, vector.data());
    vector[2] = reinterpret_cast<uintptr_t>(values.data());
    vector[3] = vector[2] + sizeof(values);
  }
};

struct Fixture {
  std::array<void*, 32> nativeTable{};
  std::array<std::array<void*, 3>, 10> objects{};
  std::array<void*, 10> objectPointers{};
  alignas(void*) std::array<unsigned char, 0xe8> system{};
  alignas(void*) std::array<unsigned char, 0x50> duplicate{};
  std::array<void*, 1> ownedFaces{}, originalFaces{};
  Face source, destination, borrowed, alternate;
  Points movedPoints{};
  int graph = 0, otherGraph = 0, foreignTable = 0;
  void* auxiliary = nullptr;
  Lease lease{&graph, duplicate.data()};
  OwnedLiveInput input{&lease, {reinterpret_cast<uintptr_t>(originalFaces.data()), 1}, {}};

  Fixture() {
    require(liveGeometry.empty(), "previous fixture left hooks installed");
    memory.clear(); originalCalls.clear(); originalAction = {}; blockedRead.reset();
    records.str(""); records.clear(); updateError = nullptr;
    tableReads = failTableRead = liveGeometryCalls = 0;
    configuredCaller = 0x9eba4c; seekThread = std::this_thread::get_id();
    livePrediction = 1; seekTimestamp = 0; liveLeases.open = true; currentGraph = &graph;
    fakeBase = reinterpret_cast<uintptr_t>(&originalGeometry) - 0xa0bb54;
    for (size_t index = 0; index < nativeTable.size(); ++index)
      nativeTable[index] = reinterpret_cast<void*>(0x1000 + index * 8);
    nativeTable[4] = reinterpret_cast<void*>(&originalGeometry);
    memory.push_back({reinterpret_cast<uintptr_t>(this), this, sizeof(*this)});
    memory.push_back({fakeBase + 0x35eac48 - 16, nativeTable.data(), sizeof(nativeTable)});
    for (size_t index = 0; index < source.xy.size(); ++index)
      source.xy[index] = static_cast<float>(index) / 212.0f;
    borrowed.xy = alternate.xy = movedPoints = source.xy;
    for (size_t index = 0; index < source.xy.size(); index += 2) {
      destination.xy[index] = source.xy[index] * 17.0f;
      const volatile float scaledY = source.xy[index + 1] * 31.0f;
      destination.xy[index + 1] = 31.0f - scaledY;
    }
    source.link(source.xy); destination.link(destination.xy);
    borrowed.link(borrowed.xy); alternate.link(alternate.xy);
    ownedFaces[0] = source.bytes.data(); originalFaces[0] = borrowed.bytes.data();
    put(duplicate.data(), 0x38, ownedFaces.data());
    put(duplicate.data(), 0x40, ownedFaces.data() + 1);
    for (size_t index = 0; index < objects.size(); ++index) {
      objects[index] = {table(), destination.bytes.data(), &otherGraph};
      objectPointers[index] = objects[index].data();
    }
    put(system.data(), 0xd0, objectPointers.data());
    put(system.data(), 0xd8, objectPointers.data() + 10);
    input.before = borrowed.xy;
    livePending = ReplayFrame{{{0, source.xy}}};
    activeMakeupInput = &input; activeMakeupSystem = system.data();
    activeMakeupSnapshot = MakeupSnapshot{source.bytes.data(), readLandmarks(source.bytes.data()), 0};
  }

  ~Fixture() {
    activeMakeupInput = nullptr; activeMakeupSystem = nullptr; activeMakeupSnapshot.reset();
    livePending.reset(); liveGeometry.clear(); memory.clear(); originalAction = {}; updateError = nullptr;
  }
  Fixture(const Fixture&) = delete;
  Fixture& operator=(const Fixture&) = delete;
  void* table() const { return reinterpret_cast<void*>(fakeBase + 0x35eac48); }
  void install() { installMakeupConsumers(system.data()); }
  Call arguments(size_t index = 0) {
    return {objects[index].data(), &objects[index][1], &objects[index][2], &auxiliary};
  }
  void dispatch(const Call& call) {
    // The installed shadow is real writable memory; the native table address is never dereferenced.
    require(liveGeometry.contains(call.object), "dispatch without installed object");
    const auto table = field<void**>(call.object, 0);
    const auto callback = reinterpret_cast<MakeupGeometry>(table[2]);
    callback(call.object, call.primary, call.extra, call.auxiliary, call.width, call.height);
  }
  void restored() {
    restoreMakeupConsumers(); restoreMakeupConsumers();
    require(liveGeometry.empty(), "restoration left entries");
    for (const auto& object : objects) {
      require(object[0] == table(), "native table not restored");
      require(object[2] == &otherGraph, "restoration changed extra reference");
    }
  }
};

size_t events(const std::string& name) {
  const auto text = records.str(), needle = "\"event\":\"" + name + "\"";
  size_t count = 0, position = 0;
  while ((position = text.find(needle, position)) != std::string::npos) { ++count; position += needle.size(); }
  return count;
}

void callbackFailed(size_t expectedCalls) {
  require(updateError != nullptr, "callback did not fail closed");
  require(originalCalls.size() == expectedCalls, "unexpected original callback count");
  require(events("live_makeup_geometry_complete") == 0, "failure emitted completion");
  require(records.str().find("\"renderer_consumption\":true") == std::string::npos,
          "geometry hook fabricated renderer consumption");
}

template <typename Action>
void run(const std::string& label, Action action) {
  ++cases;
  try { action(); }
  catch (const std::exception& error) { ++failures; std::cerr << "FAIL " << label << ": " << error.what() << '\n'; }
}

void validDispatch() {
  for (bool populated : {false, true}) run(populated ? "populated aux" : "null aux pointee", [=] {
    Fixture fixture;
    if (populated) fixture.auxiliary = &fixture.graph;
    const auto originalTable = fixture.nativeTable;
    fixture.install();
    require(liveGeometry.size() == 10, "inventory not completely installed");
    for (size_t index = 0; index < fixture.objects.size(); ++index) {
      const auto& shadow = liveGeometry.at(fixture.objects[index].data());
      require(shadow.original == &originalGeometry && shadow.index == index, "original or index lost");
      require(shadow.system == fixture.system.data(), "system association lost");
      for (size_t slot = 0; slot < 32; ++slot)
        require(shadow.table[slot] == (slot == 4 ? reinterpret_cast<void*>(&consumeMakeupGeometry) : originalTable[slot]),
                "metadata or untouched vtable slot changed");
    }
    const auto args = fixture.arguments();
    fixture.dispatch(args);
    require(!updateError && liveGeometryCalls == 1, "valid callback rejected");
    require(originalCalls.size() == 1 && originalCalls.front() == args, "six original arguments not preserved");
    require(events("live_makeup_geometry_enter") == 1 && events("live_makeup_geometry_complete") == 1,
            "valid callback receipts missing or duplicated");
    require(fixture.nativeTable == originalTable, "native table was modified");
    require(records.str().find("\"renderer_consumption\":true") == std::string::npos, "false consumption");
    fixture.restored();
  });
}

void rejectedContexts() {
  using Mutation = std::function<void(Fixture&, Call&)>;
  const std::vector<std::pair<std::string, Mutation>> mutations{
    {"wrong caller", [](Fixture&, Call&) { configuredCaller = 0; }},
    {"wrong thread", [](Fixture&, Call&) { seekThread = {}; }},
    {"prior error", [](Fixture&, Call&) { updateError = std::make_exception_ptr(std::runtime_error("prior")); }},
    {"missing input", [](Fixture&, Call&) { activeMakeupInput = nullptr; }},
    {"missing snapshot", [](Fixture&, Call&) { activeMakeupSnapshot.reset(); }},
    {"wrong system", [](Fixture& f, Call&) { activeMakeupSystem = &f.otherGraph; }},
    {"wrong object index", [](Fixture& f, Call& a) { a = f.arguments(1); }},
    {"initialization prediction", [](Fixture&, Call&) { livePrediction = 0; }},
    {"closed lease", [](Fixture&, Call&) { liveLeases.open = false; }},
    {"wrong lease prediction", [](Fixture& f, Call&) { f.lease.prediction = 0; }},
    {"wrong timestamp", [](Fixture& f, Call&) { f.lease.timestamp = 1; }},
    {"wrong graph", [](Fixture& f, Call&) { currentGraph = &f.otherGraph; }},
    {"wrong primary ref", [](Fixture&, Call& a) { a.primary = a.extra; }},
    {"wrong extra ref", [](Fixture&, Call& a) { a.extra = a.primary; }},
    {"null aux ref", [](Fixture&, Call& a) { a.auxiliary = nullptr; }},
    {"null primary pointee", [](Fixture& f, Call&) { f.objects[0][1] = nullptr; }},
    {"no owned face", [](Fixture& f, Call&) { put(f.duplicate.data(), 0x40, f.ownedFaces.data()); }},
    {"no original face", [](Fixture& f, Call&) { f.input.originals.count = 0; }},
    {"missing worker", [](Fixture&, Call&) { livePending.reset(); }},
    {"multiple worker faces", [](Fixture&, Call&) { livePending->faces.push_back(livePending->faces.front()); }},
    {"worker face id", [](Fixture&, Call&) { livePending->faces[0].id = 1; }},
    {"snapshot face id", [](Fixture&, Call&) { activeMakeupSnapshot->faceId = 1; }},
    {"source face id", [](Fixture& f, Call&) { put(f.source.bytes.data(), 0x40, 1); }},
    {"destination face id", [](Fixture& f, Call&) { put(f.destination.bytes.data(), 0x40, 1); }},
    {"source base replacement", [](Fixture& f, Call&) { f.ownedFaces[0] = f.alternate.bytes.data(); }},
    {"source point replacement", [](Fixture& f, Call&) { f.source.link(f.movedPoints); }},
    {"source bit mutation", [](Fixture& f, Call&) { f.source.xy[2] = std::nextafter(f.source.xy[2], 1.0f); }},
    {"signed zero mutation", [](Fixture& f, Call&) { f.source.xy[0] = -0.0f; f.destination.xy[0] = -0.0f; }},
    {"worker bit mutation", [](Fixture&, Call&) { livePending->faces[0].coordinates[2] = 0.5f; }},
    {"snapshot bit mutation", [](Fixture&, Call&) { activeMakeupSnapshot->points.coordinates[2] = 0.5f; }},
    {"base alias", [](Fixture& f, Call&) { f.objects[0][1] = f.source.bytes.data(); }},
    {"point alias", [](Fixture& f, Call&) { f.destination.link(f.source.xy); }},
    {"borrowed source mutation", [](Fixture& f, Call&) { f.borrowed.xy[2] = 0.5f; }},
    {"destination bit mutation", [](Fixture& f, Call&) { f.destination.xy[2] = 0.5f; }},
    {"invalid width", [](Fixture&, Call& a) { a.width = 0; }},
    {"invalid height", [](Fixture&, Call& a) { a.height = 4097; }},
  };
  for (const auto& [label, mutate] : mutations) run(label, [&] {
    Fixture fixture; fixture.install(); auto args = fixture.arguments();
    mutate(fixture, args); fixture.dispatch(args); callbackFailed(0);
    require(events("live_makeup_geometry_enter") == 0, "invalid entry emitted enter receipt");
    fixture.restored();
  });
}

void nativeFailures() {
  const std::vector<std::pair<std::string, std::function<void(Fixture&)>>> mutations{
    {"original throws", [](Fixture&) { throw std::runtime_error("original failure"); }},
    {"original reports error", [](Fixture&) { updateError = std::make_exception_ptr(std::runtime_error("native failure")); }},
    {"original changes graph", [](Fixture& f) { currentGraph = &f.otherGraph; }},
    {"original changes source bits", [](Fixture& f) { f.source.xy[2] = 0.5f; }},
    {"original changes point pointer", [](Fixture& f) { f.source.link(f.movedPoints); }},
    {"original replaces face", [](Fixture& f) { f.ownedFaces[0] = f.alternate.bytes.data(); }},
    {"original changes face id", [](Fixture& f) { put(f.source.bytes.data(), 0x40, 1); }},
    {"original changes worker", [](Fixture&) { livePending->faces[0].coordinates[2] = 0.5f; }},
    {"original changes borrowed points", [](Fixture& f) { f.borrowed.xy[2] = 0.5f; }},
  };
  for (const auto& [label, mutate] : mutations) run(label, [&] {
    Fixture fixture; fixture.install(); originalAction = [&] { mutate(fixture); };
    fixture.dispatch(fixture.arguments()); callbackFailed(1);
    require(events("live_makeup_geometry_enter") == 1, "original failure lost enter receipt");
    fixture.restored();
  });
  run("duplicate dispatch", [] {
    Fixture fixture; fixture.install(); const auto args = fixture.arguments();
    fixture.dispatch(args); fixture.dispatch(args);
    require(updateError && originalCalls.size() == 1 && liveGeometryCalls == 2, "duplicate reached original");
    require(events("live_makeup_geometry_complete") == 1, "duplicate generated completion");
    fixture.restored();
  });
  run("unknown object", [] {
    Fixture fixture;
    consumeMakeupGeometry(&fixture.graph, nullptr, nullptr, nullptr, 17, 31);
    callbackFailed(0);
  });
  run("snapshot recheck after update", [] {
    Fixture fixture; fixture.install(); fixture.dispatch(fixture.arguments());
    require(!updateError, "initial dispatch failed");
    fixture.source.link(fixture.movedPoints);
    rejects([] { verifyMakeupSnapshot(); }, "candidate changed");
    fixture.restored();
  });
}

void tableFailures() {
  for (size_t ordinal = 1; ordinal <= 10; ++ordinal) run("install read failure " + std::to_string(ordinal), [=] {
    Fixture fixture; failTableRead = ordinal;
    rejects([&] { fixture.install(); }, "unreadable makeup geometry consumer table");
    require(liveGeometry.size() == ordinal - 1, "failed read left an uninstalled entry");
    require(fixture.objects[ordinal - 1][0] == fixture.table(), "failed object was patched");
    fixture.restored();
  });
  for (size_t index : {size_t{0}, size_t{4}, size_t{9}}) {
    for (bool unreadable : {false, true}) run("restore failure " + std::to_string(index) + (unreadable ? " unreadable" : " foreign"), [=] {
      Fixture fixture; fixture.install(); auto* object = fixture.objects[index].data();
      void* replacement = object[0];
      if (unreadable) blockedRead = reinterpret_cast<uintptr_t>(object);
      else object[0] = &fixture.foreignTable;
      for (int retry = 0; retry < 2; ++retry) {
        rejects([] { restoreMakeupConsumers(); }, unreadable ? "unreadable" : "table changed");
        require(liveGeometry.size() == 1 && liveGeometry.contains(object), "independent tables not restored");
        for (size_t other = 0; other < 10; ++other)
          if (other != index) require(fixture.objects[other][0] == fixture.table(), "healthy object remained hooked");
        require(object[0] == (unreadable ? replacement : &fixture.foreignTable), "foreign/unreadable object overwritten");
      }
      blockedRead.reset(); object[0] = replacement; fixture.restored();
    });
  }
  run("duplicate installation", [] {
    Fixture fixture; fixture.install();
    rejects([&] { fixture.install(); }, "already installed");
    require(liveGeometry.size() == 10, "duplicate installation changed inventory"); fixture.restored();
  });
  run("unverified inventory", [] {
    Fixture fixture; put(fixture.system.data(), 0xd8, fixture.objectPointers.data() + 9);
    rejects([&] { fixture.install(); }, "unverified makeup geometry inventory"); fixture.restored();
  });
  run("unverified original callback", [] {
    Fixture fixture; fixture.nativeTable[4] = nullptr;
    rejects([&] { fixture.install(); }, "unverified makeup geometry consumer table");
    require(liveGeometry.empty(), "bad callback installed"); fixture.restored();
  });
  run("duplicate object inventory", [] {
    Fixture fixture; fixture.objectPointers[5] = fixture.objectPointers[0];
    rejects([&] { fixture.install(); }, "unverified makeup geometry consumer table");
    require(liveGeometry.size() == 5, "duplicate object replaced prior shadow"); fixture.restored();
  });
}
}

int main() {
  static_assert(sizeof(void*) == 8);
  validDispatch(); rejectedContexts(); nativeFailures(); tableFailures();
  std::cout << "makeup consumer: " << cases << " cases, " << checks << " checks, " << failures << " failures\n";
  return failures ? 1 : 0;
}
