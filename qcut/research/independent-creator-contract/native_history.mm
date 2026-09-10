#include "native_history_support.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <algorithm>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>

namespace {
using namespace creator_record_probe;
using creator_record_probe::Handle;

// Which branches the corpus actually reached, so the reported totals are not taken on trust.
struct Coverage {
  std::array<std::size_t, kHistoryLevels> levels{};
  std::size_t nonempty = 0, seeded = 0, retained = 0, shared_ids = 0, with_graph = 0;
};
Coverage coverage;

// Every object a case needs kept alive, plus the exported root it is walked from.
struct Fixture {
  Handle root;
  HistoryLevel level = HistoryLevel::keyframes;
  Handle group;
  List frames;
  std::vector<Handle> alive;
};

Handle single_point_graph(const HistoryNative& native, std::size_t seed) {
  const std::array<editor_contract::GraphPoint, 1> points{
      editor_contract::GraphPoint{static_cast<std::int32_t>(seed % 5), .25, -.5}};
  return native.graphs.create(points);
}

// Builds one real SDK group. The collision branches use restore copies, which is how the SDK
// itself produces two live objects that carry one ID.
Fixture build(const HistoryNative& native, std::size_t seed) {
  Fixture fixture;
  NodeMap scratch;
  fixture.group = native.factory.group();
  const std::size_t count = seed % 4;
  for (std::size_t i = 0; i < count; ++i) {
    auto frame = native.frame(seed * 7 + i);
    if ((seed + i) % 3 == 0) {
      auto attached = (seed + i) % 6 == 0 ? native.fixture(seed + i) : single_point_graph(native, seed + i);
      native.set_graph(frame, attached);
      fixture.alive.push_back(attached);
      auto points = Native::list(native.graph_array(attached));
      if (!points.empty() && (seed + i) % 9 == 0) {
        // A control that carries the graph coordinate's ID but is a different object.
        auto twin = native.copy_graph_point(points.front(), scratch);
        native.set_control(frame, false, native.coordinate(twin));
        fixture.alive.push_back(twin);
      }
      if (points.size() > 1 && (seed + i) % 11 == 0) {
        points.pop_back();  // the dropped point moves to the array's retained list
        native.set_points(attached, points);
      }
    }
    if ((seed + i) % 5 == 0) native.alias_controls(frame);
    if ((seed + i) % 7 == 0) {
      auto twin = native.copy_frame(frame, scratch);
      native.set_control(frame, true, native.point(twin, false));
      fixture.alive.push_back(twin);
    }
    fixture.frames.push_back(frame);
    if ((seed + i) % 13 == 0) fixture.frames.push_back(frame);
    if ((seed + i) % 17 == 0) {
      auto twin = native.copy_frame(frame, scratch);
      fixture.frames.push_back(twin);
      fixture.alive.push_back(twin);
    }
  }
  native.set_frames(fixture.group, fixture.frames);
  if (seed % 8 == 0 && !fixture.frames.empty()) {
    List kept(fixture.frames.begin(), fixture.frames.end() - 1);
    native.set_frames(fixture.group, kept);  // the removed frame becomes retained
  }
  if (!scratch.empty()) throw std::runtime_error("Restore copies unexpectedly changed the ID index");

  fixture.level = static_cast<HistoryLevel>(seed % kHistoryLevels);
  const auto active = Native::list(native.array(fixture.group));
  const Handle frame = active.empty() ? Handle{} : active.front();
  const Handle attached = frame ? native.graph(frame) : Handle{};
  const List points = attached ? Native::list(native.graph_array(attached)) : List{};
  switch (fixture.level) {
    case HistoryLevel::keyframes: fixture.root = fixture.group; break;
    case HistoryLevel::keyframe: fixture.root = frame; break;
    case HistoryLevel::graph: fixture.root = attached; break;
    case HistoryLevel::graph_point: fixture.root = points.empty() ? Handle{} : points.front(); break;
    case HistoryLevel::point: fixture.root = frame ? native.point(frame, false) : Handle{}; break;
  }
  if (!fixture.root) {
    fixture.root = fixture.group;
    fixture.level = HistoryLevel::keyframes;
  }
  return fixture;
}

void seed_map(const HistoryNative& native, HistoryMap& map, HistorySnapshot& snapshot,
              const Fixture& fixture, std::size_t seed) {
  if (seed % 4 == 0) return;
  auto foreign = native.frame(seed + 4001);
  const auto active = Native::list(native.array(fixture.group));
  if (seed % 4 == 1) {
    map.seed("qcut-foreign-" + std::to_string(seed), foreign, snapshot, HistoryNodeKind::keyframe);
  } else if (seed % 4 == 2 && !active.empty()) {
    // The colliding key must survive with the pre-seeded value, not the walked node.
    map.seed(HistoryNative::node_id(active.front().get()), foreign, snapshot, HistoryNodeKind::keyframe);
  } else if (!active.empty()) {
    map.seed(HistoryNative::node_id(active.front().get()), {}, snapshot, HistoryNodeKind::keyframe);
  }
  (void)native;
}

void run_case(const HistoryNative& native, Checks& checks, const Fixture& fixture, std::size_t seed,
              bool escape_only) {
  HistorySnapshot snapshot(native);
  const auto root = snapshot.node(fixture.root, HistoryNative::kind_of(fixture.level));
  HistoryMap map;
  seed_map(native, map, snapshot, fixture, seed);
  if (escape_only && seed % 3 == 0) {
    // Start from a populated map so an inserting escape hook could not hide in an empty one.
    native.all_nodes(fixture.root, map.native, fixture.level);
    collect_history_nodes(*root, map.own);
  }
  std::vector<std::pair<long, long>> before;
  before.reserve(snapshot.mirrored.size());
  for (const auto& [handle, owned] : snapshot.mirrored) before.emplace_back(handle.use_count(), owned.use_count());
  const std::size_t size_before = map.native.size();
  if (escape_only) {
    native.escape_nodes(fixture.root, map.native, fixture.level);
    collect_escape_history_nodes(*root, map.own);
    native.assign_nodes(fixture.root, map.native, fixture.level);
    assign_escape_history_nodes(*root, map.own);
    checks.require(map.native.size() == size_before, "Escape hooks changed the native map size");
  } else {
    native.all_nodes(fixture.root, map.native, fixture.level);
    collect_history_nodes(*root, map.own);
  }
  HistoryCompare compare{checks, snapshot};
  compare.maps(map.native, map.own);
  compare.tree_unchanged(snapshot);
  for (std::size_t i = 0; i < snapshot.mirrored.size(); ++i) {
    const auto& [handle, owned] = snapshot.mirrored[i];
    checks.require(handle.use_count() - before[i].first == owned.use_count() - before[i].second,
                   "Strong reference delta differs");
  }
  coverage.levels.at(static_cast<unsigned>(fixture.level))++;
  if (!map.native.empty()) ++coverage.nonempty;
  if (!map.keys.empty()) ++coverage.seeded;
  std::unordered_map<std::string, std::size_t> identifiers;
  bool retained = false, graph_present = false;
  for (const auto& [handle, owned] : snapshot.mirrored) {
    (void)handle;
    ++identifiers[owned->id];
    if (!owned->retained.empty()) retained = true;
    if (owned->kind == HistoryNodeKind::graph) graph_present = true;
  }
  if (retained) ++coverage.retained;
  if (graph_present) ++coverage.with_graph;
  for (const auto& [identifier, count] : identifiers) {
    (void)identifier;
    if (count > 1) { ++coverage.shared_ids; break; }
  }
  ++checks.cases;
}

void structure_cases(const HistoryNative& native, Checks& checks) {
  for (std::size_t test = 0; test < 2048; ++test) {
    const auto fixture = build(native, test);
    run_case(native, checks, fixture, test, false);
  }
}

// Every branch here forces two live objects to share one ID, which is the only way the
// visiting order becomes observable at all.
void duplicate_cases(const HistoryNative& native, Checks& checks) {
  std::size_t control_pairs = 0, graph_pairs = 0, array_pairs = 0;
  for (std::size_t test = 0; test < 1536; ++test) {
    NodeMap scratch;
    Fixture fixture;
    fixture.group = native.factory.group();
    auto frame = native.frame(test * 3 + 1);
    auto attached = test % 2 == 0 ? single_point_graph(native, test) : native.fixture(test + 3);
    native.set_graph(frame, attached);
    fixture.alive.push_back(attached);
    const auto points = Native::list(native.graph_array(attached));
    if (test % 3 != 2) {
      auto twin = native.copy_frame(frame, scratch);
      native.set_control(frame, true, native.point(twin, false));
      fixture.alive.push_back(twin);
      ++control_pairs;
    }
    if (test % 3 != 1 && !points.empty()) {
      auto twin = native.copy_graph_point(points.front(), scratch);
      native.set_control(frame, false, native.coordinate(twin));
      fixture.alive.push_back(twin);
      ++graph_pairs;
    }
    fixture.frames.push_back(frame);
    if (test % 4 != 3) {
      auto twin = native.copy_frame(frame, scratch);
      if (test % 8 < 4) fixture.frames.push_back(twin);
      else fixture.frames.insert(fixture.frames.begin(), twin);
      fixture.alive.push_back(twin);
      ++array_pairs;
    }
    native.set_frames(fixture.group, fixture.frames);
    fixture.level = static_cast<HistoryLevel>(test % kHistoryLevels);
    const auto active = Native::list(native.array(fixture.group));
    switch (fixture.level) {
      case HistoryLevel::keyframes: fixture.root = fixture.group; break;
      case HistoryLevel::keyframe: fixture.root = active.front(); break;
      case HistoryLevel::graph: fixture.root = native.graph(active.front()); break;
      case HistoryLevel::graph_point:
        fixture.root = points.empty() ? fixture.group : points.front();
        if (points.empty()) fixture.level = HistoryLevel::keyframes;
        break;
      case HistoryLevel::point: fixture.root = native.point(active.front(), false); break;
    }
    run_case(native, checks, fixture, test, false);
  }
  checks.require(control_pairs > 0 && graph_pairs > 0 && array_pairs > 0, "Missing a required collision branch");
}

void escape_cases(const HistoryNative& native, Checks& checks) {
  for (std::size_t test = 0; test < 1024; ++test) {
    const auto fixture = build(native, test * 5 + 2);
    run_case(native, checks, fixture, test, true);
  }
}

void lifetime_cases(const HistoryNative& native, Checks& checks) {
  {
    auto frame = native.frame(77);
    const std::weak_ptr<void> control = native.point(frame, false);
    const std::string bytes = HistoryNative::node_id(native.point(frame, false).get());
    HistoryMap map;
    {
      // The mirror is released before the lifetime question, so only the map still owns anything.
      HistorySnapshot snapshot(native);
      const auto root = snapshot.node(frame, HistoryNodeKind::keyframe);
      native.all_nodes(frame, map.native, HistoryLevel::keyframe);
      collect_history_nodes(*root, map.own);
      HistoryCompare compare{checks, snapshot};
      compare.maps(map.native, map.own);
    }
    frame.reset();
    checks.require(!control.expired(), "The map's strong copy outlives the parent keyframe");
    checks.require(map.native.find(bytes) != map.native.end(), "The stored key stays usable after the parent dies");
    map.native.clear();
    map.own.clear();
    checks.require(control.expired(), "Clearing the map releases the final control reference");
    ++checks.cases;
  }
  {
    // A duplicate key must not leave an extra reference behind on the losing object.
    NodeMap scratch;
    auto frame = native.frame(91);
    auto twin = native.copy_frame(frame, scratch);
    native.set_control(frame, true, native.point(twin, false));
    const std::weak_ptr<void> loser = native.point(frame, true);
    HistoryMap map;
    {
      HistorySnapshot snapshot(native);
      const auto root = snapshot.node(frame, HistoryNodeKind::keyframe);
      native.all_nodes(frame, map.native, HistoryLevel::keyframe);
      collect_history_nodes(*root, map.own);
      HistoryCompare compare{checks, snapshot};
      compare.maps(map.native, map.own);
      checks.require(map.native.size() == 1 && map.own.size() == 1, "The colliding controls share one entry");
    }
    native.set_control(frame, true, native.point(frame, false));
    twin.reset();
    checks.require(loser.expired(), "The rejected duplicate kept no reference in the map");
    ++checks.cases;
  }
}

// Named cases whose outcome is pinned into the default CTest. IDs are SDK-generated, so the
// pinned form is the role-labelled key set, recorded here alongside the raw IDs.
std::string quote(const std::string& text) {
  std::ostringstream out;
  out << '"';
  for (const char character : text) {
    const auto byte = static_cast<unsigned char>(character);
    if (byte == '"' || byte == '\\') out << '\\' << character;
    else if (byte < 0x20 || byte > 0x7e) out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                                             << static_cast<unsigned>(byte) << std::dec << std::setfill(' ');
    else out << character;
  }
  out << '"';
  return out.str();
}

std::string golden(const HistoryNative& native, Checks& checks, const std::string& name, const Handle& root,
                   HistoryLevel level, const std::map<std::string, std::string>& roles) {
  HistorySnapshot snapshot(native);
  const auto owned = snapshot.node(root, HistoryNative::kind_of(level));
  HistoryMap map;
  native.all_nodes(root, map.native, level);
  collect_history_nodes(*owned, map.own);
  HistoryCompare compare{checks, snapshot};
  compare.maps(map.native, map.own);
  ++checks.cases;
  std::vector<std::string> labels;
  std::ostringstream raw;
  bool first = true;
  for (const auto& [key, value] : map.native) {
    const auto role = roles.find(std::string(key));
    if (role == roles.end()) throw std::runtime_error("Golden case produced an unlabelled key: " + name);
    const auto winner = roles.find(HistoryNative::node_id(static_cast<const void*>(value.get())) +
                                   "@" + std::to_string(reinterpret_cast<std::uintptr_t>(value.get())));
    labels.push_back(role->second + "=" + (winner == roles.end() ? std::string("?") : winner->second));
    raw << (first ? "" : ",") << quote(std::string(key));
    first = false;
  }
  std::sort(labels.begin(), labels.end());
  std::ostringstream out;
  out << "{\"name\":" << quote(name) << ",\"keys\":" << map.native.size() << ",\"entries\":[";
  for (std::size_t i = 0; i < labels.size(); ++i) out << (i ? "," : "") << quote(labels[i]);
  out << "],\"rawKeys\":[" << raw.str() << "]}";
  return out.str();
}

std::vector<std::string> golden_cases(const HistoryNative& native, Checks& checks) {
  std::vector<std::string> results;
  const auto label = [](std::map<std::string, std::string>& roles, const Handle& node, const std::string& role) {
    const auto& id = HistoryNative::node_id(node.get());
    roles.emplace(id, role);
    roles[id + "@" + std::to_string(reinterpret_cast<std::uintptr_t>(node.get()))] = role;
  };
  {
    auto frame = native.frame(4);
    auto attached = single_point_graph(native, 1);
    native.set_graph(frame, attached);
    const auto point = Native::list(native.graph_array(attached)).front();
    std::map<std::string, std::string> roles;
    label(roles, native.point(frame, false), "kl");
    label(roles, native.point(frame, true), "kr");
    label(roles, attached, "g");
    label(roles, native.graph_array(attached), "g-points");
    label(roles, point, "p");
    label(roles, native.coordinate(point), "c");
    results.push_back(golden(native, checks, "frame-with-graph", frame, HistoryLevel::keyframe, roles));
  }
  {
    NodeMap scratch;
    auto frame = native.frame(6);
    auto twin = native.copy_frame(frame, scratch);
    native.set_control(frame, true, native.point(twin, false));
    std::map<std::string, std::string> roles;
    label(roles, native.point(frame, false), "d");
    roles[HistoryNative::node_id(native.point(frame, true).get()) + "@" +
          std::to_string(reinterpret_cast<std::uintptr_t>(native.point(frame, true).get()))] = "right";
    roles[HistoryNative::node_id(native.point(frame, false).get()) + "@" +
          std::to_string(reinterpret_cast<std::uintptr_t>(native.point(frame, false).get()))] = "left";
    results.push_back(golden(native, checks, "duplicate-controls", frame, HistoryLevel::keyframe, roles));
  }
  {
    NodeMap scratch;
    auto frame = native.frame(8);
    auto attached = single_point_graph(native, 2);
    native.set_graph(frame, attached);
    const auto point = Native::list(native.graph_array(attached)).front();
    auto twin = native.copy_graph_point(point, scratch);
    native.set_control(frame, false, native.coordinate(twin));
    std::map<std::string, std::string> roles;
    label(roles, native.point(frame, true), "kr");
    label(roles, attached, "g");
    label(roles, native.graph_array(attached), "g-points");
    label(roles, point, "p");
    roles.emplace(HistoryNative::node_id(native.point(frame, false).get()), "x");
    roles[HistoryNative::node_id(native.point(frame, false).get()) + "@" +
          std::to_string(reinterpret_cast<std::uintptr_t>(native.point(frame, false).get()))] = "control";
    roles[HistoryNative::node_id(native.coordinate(point).get()) + "@" +
          std::to_string(reinterpret_cast<std::uintptr_t>(native.coordinate(point).get()))] = "coordinate";
    results.push_back(golden(native, checks, "duplicate-across-graph", frame, HistoryLevel::keyframe, roles));
  }
  {
    auto group = native.factory.group();
    auto live = native.frame(10), gone = native.frame(12);
    native.set_frames(group, List{live, gone});
    native.set_frames(group, List{live});
    std::map<std::string, std::string> roles;
    label(roles, native.array(group), "g-frames");
    label(roles, live, "live");
    label(roles, native.point(live, false), "ll");
    label(roles, native.point(live, true), "lr");
    results.push_back(golden(native, checks, "group-retained", group, HistoryLevel::keyframes, roles));
  }
  return results;
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    Checks checks;
    std::vector<std::string> goldens;
    try {
      if (argc != 2) throw std::invalid_argument("Usage: creator-native-history /absolute/libvideoeditor.dylib");
      {
        editor_probe::NativeOutputScope quiet;
        const auto library = editor_probe::load_verified(argv[1]);
        const HistoryNative native(library, argv[1]);
        structure_cases(native, checks);
        duplicate_cases(native, checks);
        escape_cases(native, checks);
        lifetime_cases(native, checks);
        goldens = golden_cases(native, checks);
      }
      std::cout << "{\"passed\":true,\"cases\":" << checks.cases << ",\"comparisons\":" << checks.compared
                << ",\"mismatches\":0,\"coverage\":{\"keyframesRoots\":" << coverage.levels[0]
                << ",\"keyframeRoots\":" << coverage.levels[1] << ",\"graphRoots\":" << coverage.levels[2]
                << ",\"graphPointRoots\":" << coverage.levels[3] << ",\"pointRoots\":" << coverage.levels[4]
                << ",\"nonemptyMaps\":" << coverage.nonempty << ",\"preSeededMaps\":" << coverage.seeded
                << ",\"treesWithRetained\":" << coverage.retained << ",\"treesWithSharedIds\":" << coverage.shared_ids
                << ",\"treesWithGraph\":" << coverage.with_graph << "},\"golden\":[";
      for (std::size_t i = 0; i < goldens.size(); ++i) std::cout << (i ? "," : "") << goldens[i];
      std::cout << "]}\n";
      return 0;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      std::cout << "{\"passed\":false,\"cases\":" << checks.cases << ",\"comparisons\":" << checks.compared << "}\n";
      return 1;
    }
  }
}
