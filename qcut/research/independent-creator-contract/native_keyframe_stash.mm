#include "native_keyframe_stash_support.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <algorithm>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>

namespace {
using namespace creator_record_probe;
using creator_record_probe::Handle;

// Which branches the corpus actually reached, so the totals below are not taken on trust.
struct Coverage {
  std::array<std::size_t, 3> roots{};
  std::size_t records = 0, no_record = 0, reported = 0, silent = 0;
  std::size_t history_miss = 0, null_entry = 0, foreign_entry = 0;
  std::size_t graph_present = 0, graph_dropped = 0, graph_gained = 0;
  std::size_t retained_lists = 0, suppressed = 0, historical_elements = 0;
  // The four element outcomes a suppressed array can reach, counted from the fixture itself so
  // the suppression gate is not reported as covered on the strength of one branch.
  std::size_t suppressed_dirty = 0, suppressed_orphan = 0, suppressed_stranger = 0, suppressed_retained = 0;
};
Coverage coverage;

std::string text(std::size_t seed, char filler, std::size_t span) {
  if (seed % 4 == 0) return {};
  if (seed % 4 == 1) return std::string("a\0b", 3);
  return std::string(seed % span, filler);
}

// One real SDK group. Every object comes from a factory or a public setter.
Handle build_group(const StashNative& native, std::size_t seed, std::vector<Handle>& alive) {
  auto group = native.factory.group();
  native.set_material(group, text(seed, 'm', 40));
  native.set_property(group, text(seed / 4, 'p', 19));
  List frames;
  for (std::size_t i = 0; i < seed % 4; ++i) {
    auto frame = native.frame(seed * 5 + i);
    if ((seed + i) % 3 == 0) {
      auto attached = (seed + i) % 6 == 0 ? native.fixture(seed + i) : native.graphs.create(
          std::array<editor_contract::GraphPoint, 1>{editor_contract::GraphPoint{1, .25, -.5}});
      native.set_graph(frame, attached);
      alive.push_back(attached);
    }
    frames.push_back(frame);
  }
  native.set_frames(group, frames);
  const auto list = native.array(group);
  native.track(group, seed % 2 != 0);
  native.track(list, seed % 3 != 0);
  native.track_children(list, seed % 4 != 0);
  return group;
}

// Real setters only. Every branch below is chosen so that some case reaches every comparison
// the record walk performs, including the two that only a graph transition can produce.
void perturb(const StashNative& native, const Handle& group, std::size_t seed, std::vector<Handle>& alive) {
  if (seed % 7 == 0) native.set_material(group, text(seed + 1, 'q', 33));
  if (seed % 11 == 0) native.set_property(group, text(seed + 2, 'r', 23));
  const auto frames = Native::list(native.array(group));
  for (std::size_t i = 0; i < frames.size(); ++i) {
    const auto& frame = frames[i];
    // Divided by three so that the choice is independent of the seed's root selector; otherwise
    // the pure dirty-flag case below could never land on a case whose root is a single frame.
    const std::size_t choice = (seed / 3 + i) % 9;
    switch (choice) {
      case 0: {
        // A dirty node with an unchanged payload: reset the subtree first so that neither control
        // can report anything of its own, then set a value away and back again, which leaves the
        // changed flag raised while every compared field stays equal.
        native.reset(frame);
        const auto curve = native.factory.curve(frame);
        native.factory.set_curve(frame, curve + 1);
        native.factory.set_curve(frame, curve);
        break;
      }
      case 1: native.factory.set_curve(frame, static_cast<std::int32_t>(seed) - 4); break;
      case 2: native.set_time(frame, static_cast<std::int64_t>(seed) * -3 - 1); break;
      case 3: native.set_text(frame, text(seed + i, 'z', 60)); break;
      case 4:
        native.factory.set_values(frame, std::vector<double>{-0.0, std::numeric_limits<double>::infinity()});
        break;
      case 5:
        native.factory.set_values(frame, std::vector<double>{
            std::bit_cast<double>(std::uint64_t{0x7ff8000000004321})});
        break;
      case 6:
        // Chosen so that it lands on the frames the builder gave a graph to: a current node that
        // lost its graph is the one transition the frame level reports by itself.
        if (native.factory.has_graph(frame)) {
          native.set_graph(frame, {});
          ++coverage.graph_dropped;
        }
        break;
      case 7: native.factory.set_control(frame, (seed + i) % 2 == 0, {.5, -.5}); break;
      default:
        if (!native.factory.has_graph(frame)) {
          auto attached = native.fixture(seed + i + 5);
          native.set_graph(frame, attached);
          alive.push_back(attached);
          ++coverage.graph_gained;
        }
        break;
    }
  }
  if (seed % 13 == 0 && !frames.empty()) {
    List kept(frames.begin(), frames.end() - 1);  // the dropped frame becomes a retained entry
    native.set_frames(group, kept);
  } else if (seed % 17 == 0 && frames.size() > 1) {
    List reordered(frames.rbegin(), frames.rend());
    native.set_frames(group, reordered);
  }
}

struct Case {
  StashSnapshot snapshot;
  StashMap map;
  NodeMap escape;
  explicit Case(const StashNative& native) : snapshot(native) {}
};

// The node-history walk delivered in the previous batch fills the native index; its output is
// translated here into the independent index, so the two batches are chained in one process.
void fill_history(const StashNative& native, Case& state, const Handle& history, std::size_t seed) {
  state.snapshot.group(history);
  if (seed % 5 == 0) return;  // an empty index exercises the miss branch at every level
  state.map.seed(HistoryNative::node_id(history.get()), history, state.snapshot, 0);
  native.all_nodes(history, state.map.native, HistoryLevel::keyframes);
  for (const auto& [key, value] : state.map.native) {
    const std::string owned(key);
    if (state.map.own.count(owned) != 0) continue;
    const auto found = state.snapshot.mirrored.find(static_cast<const void*>(value.get()));
    if (found == state.snapshot.mirrored.end()) {
      throw std::runtime_error("The node-history index reached an object outside the mirrored tree");
    }
    state.map.own[owned] = found->second;
  }
  if (state.map.native.size() != state.map.own.size()) {
    throw std::runtime_error("The translated index lost or gained a key");
  }
}

// Deliberately damaged entries: the present-but-null and the present-but-foreign-type cases the
// native lookup rejects with its own dynamic_cast.
void damage_history(const StashNative& native, Case& state, const Handle& current, std::size_t seed) {
  if (seed % 6 != 0) return;
  const auto frames = Native::list(native.array(current));
  if (frames.empty()) return;
  const std::string key = HistoryNative::node_id(frames.front().get());
  state.map.native.erase(key);
  state.map.own.erase(key);
  // Every multiple of twelve is also a multiple of four, which is the seed that builds an empty
  // group, so the null branch is selected on the other half of the six-multiples instead.
  if (seed % 24 < 12) {
    state.map.seed(key, {}, state.snapshot, 2);
    ++coverage.null_entry;
  } else {
    auto foreign = native.fixture(seed + 91);
    state.map.seed(key, foreign, state.snapshot, 3);
    ++coverage.foreign_entry;
  }
}

void count(const StashNative& native, const Handle& current, const Handle& history, bool produced,
           bool reported) {
  if (produced) ++coverage.records;
  else ++coverage.no_record;
  if (reported) ++coverage.reported;
  else ++coverage.silent;
  const auto list = native.array(current);
  if (!Native::list(list, true).empty()) ++coverage.retained_lists;
  if (static_cast<const std::uint8_t*>(list.get())[0x61] != 0) ++coverage.suppressed;
  for (const auto& frame : Native::list(list)) {
    if (native.factory.has_graph(frame)) ++coverage.graph_present;
  }
  (void)history;
}

void run_case(const StashNative& native, Checks& checks, std::size_t seed) {
  std::vector<Handle> alive;
  const auto history = build_group(native, seed, alive);
  NodeMap scratch;
  const auto current = native.copy_group(history, scratch);
  if (!scratch.empty()) throw std::runtime_error("The restore copy unexpectedly changed the ID index");
  perturb(native, current, seed, alive);

  Case state(native);
  fill_history(native, state, history, seed);
  damage_history(native, state, current, seed);
  if (state.map.native.empty()) ++coverage.history_miss;
  const auto own_current = state.snapshot.group(current);

  // A populated escape map on both sides, so an inserting escape channel could not hide in an
  // empty one. The independent API has no escape output at all, which is the claim under test.
  if (seed % 3 == 0) native.escape_nodes(history, state.escape, HistoryLevel::keyframes);
  const std::size_t escape_size = state.escape.size();
  const bool escape_seed = seed % 4 == 0;
  bool escaped = escape_seed;

  const unsigned level = static_cast<unsigned>(seed % 3);
  coverage.roots.at(level)++;
  bool native_changed = seed % 8 == 3, own_changed = native_changed;
  Handle record;
  std::shared_ptr<StashGroup> own_group;
  std::shared_ptr<StashFrameArray> own_array;
  std::shared_ptr<StashFrame> own_frame;
  Handle root = current;
  if (level == 0) {
    record = native.stash_group(current, state.map.native, native_changed, state.escape, escaped);
    own_group = stash_keyframe_group(*own_current, state.map.own, own_changed);
  } else if (level == 1) {
    root = native.array(current);
    record = native.stash_array(root, kFrameArrayClass, state.map.native, native_changed, state.escape, escaped);
    own_array = stash_keyframe_array(*own_current->frames, state.map.own, own_changed);
  } else {
    const auto frames = Native::list(native.array(current));
    if (frames.empty()) {
      record = native.stash_group(current, state.map.native, native_changed, state.escape, escaped);
      own_group = stash_keyframe_group(*own_current, state.map.own, own_changed);
      coverage.roots.at(level)--;
      coverage.roots.at(0)++;
    } else {
      root = frames.front();
      record = native.stash_frame(root, state.map.native, native_changed, state.escape, escaped);
      own_frame = stash_keyframe(*state.snapshot.frame(root), state.map.own, own_changed);
    }
  }

  StashCompare compare(native, checks);
  checks.require(native_changed == own_changed, "Reported change differs");
  checks.require(escaped == escape_seed, "The record walk wrote the escape flag");
  checks.require(state.escape.size() == escape_size, "The record walk changed the escape map");
  const bool produced = static_cast<bool>(record);
  checks.require(produced == (own_group || own_array || own_frame), "Record presence differs");
  if (produced) {
    if (own_group) compare.group(record, own_group);
    else if (own_array) compare.array(record, own_array);
    else compare.frame(record, own_frame);
  }
  // Both inputs are compared against the mirror taken before the call, which is at once an
  // unchanged-input check and the cross-check that the record picked the object it claims.
  compare.group(current, own_current);
  compare.group(history, state.snapshot.group(history));
  count(native, current, history, produced, native_changed != (seed % 8 == 3));
  (void)root;
  ++checks.cases;
}

// The array level with the element-selection branches driven directly: two standalone arrays
// sharing an ID, so the historical active-ID set is populated and the suppression flag can be
// set by the same factory the graph probes already use.
void array_cases(const StashNative& native, Checks& checks, std::size_t seed) {
  const std::string id = "qcut-array-" + std::to_string(seed);
  const auto history = native.frame_array_factory(id, seed % 2 == 0, false);
  const auto current = native.frame_array_factory(id, seed % 2 == 0, seed % 5 == 0);
  NodeMap scratch;
  List historical, present, indexed;
  std::vector<Handle> alive;
  for (std::size_t i = 0; i < 1 + seed % 3; ++i) {
    auto frame = native.frame(seed * 3 + i);
    historical.push_back(frame);
    indexed.push_back(frame);
    auto twin = native.copy_frame(frame, scratch);
    alive.push_back(twin);
    present.push_back(twin);
  }
  if (seed % 4 == 0) {
    // Indexed by ID but never held by the historical array, so the element resolves through the
    // index and still misses the historical active-ID set.
    auto stranger = native.frame(seed + 777);
    alive.push_back(stranger);
    indexed.push_back(stranger);
    auto twin = native.copy_frame(stranger, scratch);
    alive.push_back(twin);
    present.push_back(twin);
  }
  if (seed % 5 == 0) {
    // Deliberately left out of the index, so this element takes the deep-copy branch. The same
    // seed switches suppression on, which is how that branch is reached with the gate closed.
    auto orphan = native.frame(seed + 555);
    alive.push_back(orphan);
    present.push_back(orphan);
  }
  if (seed % 7 == 0 && present.size() > 1) present.push_back(present.front());
  native.set_frame_array(history, historical);
  native.set_frame_array(current, present);
  if (seed % 9 == 0 && present.size() > 1) {
    List kept(present.begin(), present.end() - 1);
    native.set_frame_array(current, kept);  // the dropped element becomes retained
  }
  // Inserting a node into an untracked list marks that node dirty, so a twin that has to stay
  // byte-equal to its historical original is reset once it is already in place.
  if (seed % 3 != 2) {
    for (const auto& frame : Native::list(current)) native.reset(frame);
  }
  if (seed % 6 == 0 && !Native::list(current).empty()) {
    const auto frame = Native::list(current).front();
    native.factory.set_curve(frame, native.factory.curve(frame) + 3);
  }

  Case state(native);
  state.snapshot.array(history);
  state.map.seed(id, seed % 11 == 0 ? Handle{} : history, state.snapshot, 1);
  for (const auto& frame : indexed) {
    state.map.seed(HistoryNative::node_id(frame.get()), frame, state.snapshot, 2);
    for (const bool right : {false, true}) {
      const auto point = native.point(frame, right);
      state.map.seed(HistoryNative::node_id(point.get()), point, state.snapshot, 6);
    }
  }
  const auto own_current = state.snapshot.array(current);
  bool native_changed = false, own_changed = false, escaped = false;
  const auto record =
      native.stash_array(current, kFrameArrayClass, state.map.native, native_changed, state.escape, escaped);
  const auto own_record = stash_keyframe_array(*own_current, state.map.own, own_changed);
  StashCompare compare(native, checks);
  checks.require(native_changed == own_changed, "Array-level reported change differs");
  checks.require(!escaped, "The array record walk wrote the escape flag");
  checks.require(static_cast<bool>(record) == static_cast<bool>(own_record), "Array record presence differs");
  if (record && own_record) compare.array(record, own_record);
  compare.array(current, own_current);
  compare.array(history, state.snapshot.array(history));
  if (static_cast<const std::uint8_t*>(current.get())[0x61] != 0) {
    ++coverage.suppressed;
    if (seed % 6 == 0) ++coverage.suppressed_dirty;
    ++coverage.suppressed_orphan;  // the orphan element and the suppression share this seed
    if (seed % 4 == 0) ++coverage.suppressed_stranger;
    if (!Native::list(current, true).empty()) ++coverage.suppressed_retained;
  }
  if (!Native::list(current, true).empty()) ++coverage.retained_lists;
  if (own_record) {
    for (const auto& node : own_record->nodes.active) {
      for (const auto& historical_node : state.snapshot.array(history)->nodes.active) {
        if (node == historical_node) ++coverage.historical_elements;
      }
    }
  }
  ++checks.cases;
}

// The second instantiation of the same array template, driven through the graph-point element
// type. Both the native comparison and the agreement with the separately written graph walk are
// checked, which is what makes the shared-template reading executable rather than asserted.
void graph_array_cases(const StashNative& native, Checks& checks, std::size_t seed) {
  const std::string id = "qcut-graph-array-" + std::to_string(seed);
  const auto history = native.array_factory(id, seed % 2 == 0, false);
  const auto current = native.array_factory(id, seed % 2 == 0, seed % 5 == 0);
  NodeMap scratch;
  List historical, present;
  std::vector<Handle> alive;
  for (std::size_t i = 0; i < 1 + seed % 3; ++i) {
    auto graph = native.fixture(seed * 3 + i + 1);
    alive.push_back(graph);
    const auto points = Native::list(native.graph_array(graph));
    if (points.empty()) continue;
    historical.push_back(points.front());
    auto twin = native.copy_graph_point(points.front(), scratch);
    alive.push_back(twin);
    present.push_back(twin);
  }
  if (historical.empty()) return;
  native.set_array(history, historical);
  native.set_array(current, present);
  if (seed % 6 == 0) native.point_type(present.front(), static_cast<std::int32_t>(seed) - 2);

  Case state(native);
  state.snapshot.graph_array(history);
  state.map.seed(id, history, state.snapshot, 4);
  for (const auto& point : historical) {
    state.map.seed(HistoryNative::node_id(point.get()), point, state.snapshot, 5);
    const auto coordinate = native.coordinate(point);
    state.map.seed(HistoryNative::node_id(coordinate.get()), coordinate, state.snapshot, 6);
  }
  const auto own_current = state.snapshot.graph_array(current);
  bool native_changed = false, own_changed = false, escaped = false;
  const auto record =
      native.stash_array(current, kGraphArrayClass, state.map.native, native_changed, state.escape, escaped);
  const auto own_record = stash_shared_graph_array(*own_current, state.map.own, own_changed);
  StashCompare compare(native, checks);
  checks.require(native_changed == own_changed, "Graph-array reported change differs");
  checks.require(!escaped, "The graph-array record walk wrote the escape flag");
  checks.require(static_cast<bool>(record) == static_cast<bool>(own_record), "Graph-array record presence differs");
  if (record && own_record) {
    compare.trees.array(record, own_record);
    // The graph half already has its own reconstruction; the two must agree element for element.
    GraphTreeIndex legacy;
    for (const auto& [key, value] : state.map.own) {
      if (const auto point = std::get_if<std::shared_ptr<RecordPoint>>(&value)) legacy[key] = *point;
      if (const auto point = std::get_if<std::shared_ptr<RecordGraphPoint>>(&value)) legacy[key] = *point;
      if (const auto array = std::get_if<std::shared_ptr<GraphPointArray>>(&value)) legacy[key] = *array;
    }
    bool legacy_changed = false;
    const auto expected = stash_graph_array(*own_current, legacy, legacy_changed);
    checks.require(legacy_changed == own_changed, "The two array instances report different changes");
    checks.require(static_cast<bool>(expected), "The two array instances disagree on producing a record");
    if (expected) {
      checks.require(expected->nodes.active.size() == own_record->nodes.active.size(),
                     "The two array instances collect different element counts");
      const auto& historical = state.snapshot.graph_array(history)->nodes.active;
      for (std::size_t i = 0; i < expected->nodes.active.size() && i < own_record->nodes.active.size(); ++i) {
        const auto& left = expected->nodes.active[i];
        const auto& right = own_record->nodes.active[i];
        // Two separately built new elements are distinct objects by construction, so what has to
        // agree is the choice between reusing a historical object and building a new one, and
        // then the contents of whatever was built.
        const bool left_historical = std::find(historical.begin(), historical.end(), left) != historical.end();
        const bool right_historical = std::find(historical.begin(), historical.end(), right) != historical.end();
        checks.require(left_historical == right_historical,
                       "The two array instances disagree on reusing the historical element");
        if (left_historical) {
          checks.require(left == right, "The two array instances reused different historical elements");
          continue;
        }
        checks.require(left->id == right->id && left->type == right->type && left->mutation == right->mutation,
                       "The two array instances built different elements");
        checks.require(left->point->id == right->point->id && left->point->mutation == right->point->mutation,
                       "The two array instances built different coordinates");
        checks.bits(left->point->x, right->point->x);
        checks.bits(left->point->y, right->point->y);
      }
    }
  }
  compare.trees.array(current, own_current);
  ++checks.cases;
}

std::string quote(const std::string& value) {
  std::ostringstream out;
  out << '"';
  for (const char character : value) {
    const auto byte = static_cast<unsigned char>(character);
    if (byte == '"' || byte == '\\') out << '\\' << character;
    else if (byte < 0x20 || byte > 0x7e)
      out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<unsigned>(byte) << std::dec
          << std::setfill(' ');
    else out << character;
  }
  out << '"';
  return out.str();
}

// Named cases whose outcome is pinned into the default CTest. The SDK generates its IDs at
// runtime, so the pinned form is the role-labelled outcome and the raw IDs are recorded here.
std::string golden(const StashNative& native, Checks& checks, const std::string& name, std::size_t seed) {
  std::vector<Handle> alive;
  const auto history = build_group(native, seed, alive);
  NodeMap scratch;
  const auto current = native.copy_group(history, scratch);
  perturb(native, current, seed, alive);
  Case state(native);
  fill_history(native, state, history, seed);
  const auto own_current = state.snapshot.group(current);
  bool native_changed = false, own_changed = false, escaped = false;
  const auto record = native.stash_group(current, state.map.native, native_changed, state.escape, escaped);
  const auto own_record = stash_keyframe_group(*own_current, state.map.own, own_changed);
  StashCompare compare(native, checks);
  checks.require(native_changed == own_changed, "Golden reported change differs");
  checks.require(static_cast<bool>(record) == static_cast<bool>(own_record), "Golden record presence differs");
  if (record && own_record) compare.group(record, own_record);
  ++checks.cases;

  std::ostringstream out;
  out << "{\"name\":" << quote(name) << ",\"record\":" << (record ? "true" : "false")
      << ",\"changed\":" << (native_changed ? "true" : "false");
  if (own_record) {
    const auto& list = own_record->frames->nodes.active;
    out << ",\"elements\":" << list.size() << ",\"roles\":[";
    for (std::size_t i = 0; i < list.size(); ++i) {
      const auto& historical = state.snapshot.group(history)->frames->nodes.active;
      const auto& present = own_current->frames->nodes.active;
      std::string role = "new";
      if (i < historical.size() && list[i] == historical[i]) role = "historical";
      else if (i < present.size() && list[i] == present[i]) role = "current";
      out << (i ? "," : "") << quote(role);
    }
    out << "],\"materialFromHistory\":"
        << (own_record->material_id == state.snapshot.group(history)->material_id ? "true" : "false");
    out << ",\"rawId\":" << quote(own_record->id);
  }
  out << "}";
  return out.str();
}

// The array level's own golden: two standalone arrays sharing an ID, one clean twin and one
// perturbed twin, so the record's per-element choice between the historical object and a new one
// is what gets pinned.
std::string golden_array(const StashNative& native, Checks& checks, const std::string& name, bool dirty,
                         bool suppress) {
  const std::string id = "qcut-golden-array-" + name;
  const auto history = native.frame_array_factory(id, false, false);
  const auto current = native.frame_array_factory(id, false, suppress);
  NodeMap scratch;
  List historical, present;
  std::vector<Handle> alive;
  for (std::size_t i = 0; i < 2; ++i) {
    auto frame = native.frame(400 + i);
    historical.push_back(frame);
    auto twin = native.copy_frame(frame, scratch);
    alive.push_back(twin);
    present.push_back(twin);
  }
  native.set_frame_array(history, historical);
  native.set_frame_array(current, present);
  for (const auto& frame : present) native.reset(frame);
  if (dirty) native.factory.set_curve(present.front(), native.factory.curve(present.front()) + 7);

  Case state(native);
  const auto own_history = state.snapshot.array(history);
  state.map.seed(id, history, state.snapshot, 1);
  for (const auto& frame : historical) {
    state.map.seed(HistoryNative::node_id(frame.get()), frame, state.snapshot, 2);
    for (const bool right : {false, true}) {
      const auto point = native.point(frame, right);
      state.map.seed(HistoryNative::node_id(point.get()), point, state.snapshot, 6);
    }
  }
  const auto own_current = state.snapshot.array(current);
  bool native_changed = false, own_changed = false, escaped = false;
  const auto record =
      native.stash_array(current, kFrameArrayClass, state.map.native, native_changed, state.escape, escaped);
  const auto own_record = stash_keyframe_array(*own_current, state.map.own, own_changed);
  StashCompare compare(native, checks);
  checks.require(native_changed == own_changed, "Golden array reported change differs");
  checks.require(static_cast<bool>(record) == static_cast<bool>(own_record), "Golden array record presence differs");
  if (record && own_record) compare.array(record, own_record);
  ++checks.cases;

  std::ostringstream out;
  out << "{\"name\":" << quote("array-" + name) << ",\"record\":" << (record ? "true" : "false")
      << ",\"changed\":" << (native_changed ? "true" : "false") << ",\"roles\":[";
  if (own_record) {
    for (std::size_t i = 0; i < own_record->nodes.active.size(); ++i) {
      const auto& node = own_record->nodes.active[i];
      const bool historical_role = std::find(own_history->nodes.active.begin(), own_history->nodes.active.end(),
                                             node) != own_history->nodes.active.end();
      out << (i ? "," : "") << quote(historical_role ? "historical" : "new");
    }
  }
  out << "]}";
  return out.str();
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    Checks checks;
    std::vector<std::string> goldens;
    try {
      if (argc != 2) throw std::invalid_argument("Usage: creator-native-keyframe-stash /absolute/libvideoeditor.dylib");
      {
        editor_probe::NativeOutputScope quiet;
        const auto library = editor_probe::load_verified(argv[1]);
        const StashNative native(library, argv[1]);
        for (std::size_t test = 0; test < 1200; ++test) run_case(native, checks, test);
        for (std::size_t test = 0; test < 600; ++test) array_cases(native, checks, test);
        for (std::size_t test = 0; test < 400; ++test) graph_array_cases(native, checks, test);
        for (const std::size_t seed : {3U, 6U, 9U, 21U}) {
          goldens.push_back(golden(native, checks, "group-seed-" + std::to_string(seed), seed));
        }
        goldens.push_back(golden_array(native, checks, "clean", false, false));
        goldens.push_back(golden_array(native, checks, "dirty", true, false));
        goldens.push_back(golden_array(native, checks, "dirty-suppressed", true, true));
      }
      std::cout << "{\"passed\":true,\"cases\":" << checks.cases << ",\"comparisons\":" << checks.compared
                << ",\"mismatches\":0,\"coverage\":{\"groupRoots\":" << coverage.roots[0]
                << ",\"arrayRoots\":" << coverage.roots[1] << ",\"frameRoots\":" << coverage.roots[2]
                << ",\"records\":" << coverage.records << ",\"noRecord\":" << coverage.no_record
                << ",\"reportedChange\":" << coverage.reported << ",\"silent\":" << coverage.silent
                << ",\"emptyHistory\":" << coverage.history_miss << ",\"nullEntries\":" << coverage.null_entry
                << ",\"foreignEntries\":" << coverage.foreign_entry
                << ",\"graphsPresent\":" << coverage.graph_present << ",\"graphsDropped\":" << coverage.graph_dropped
                << ",\"graphsGained\":" << coverage.graph_gained
                << ",\"retainedLists\":" << coverage.retained_lists << ",\"suppressedArrays\":" << coverage.suppressed
                << ",\"historicalElements\":" << coverage.historical_elements
                << ",\"suppressedWithDirtyElement\":" << coverage.suppressed_dirty
                << ",\"suppressedWithUnindexedElement\":" << coverage.suppressed_orphan
                << ",\"suppressedWithOutOfSetElement\":" << coverage.suppressed_stranger
                << ",\"suppressedWithRetained\":" << coverage.suppressed_retained << "},\"golden\":[";
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
