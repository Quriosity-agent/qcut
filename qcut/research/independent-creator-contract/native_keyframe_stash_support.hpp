#pragma once

#include "keyframe_stash.hpp"
#include "native_history_support.hpp"

#include <dlfcn.h>

#include <array>
#include <string>
#include <utility>

namespace creator_record_probe {
// The five exported record entry points of this family, each resolved twice: once by its
// exported mangled name and once by its recorded unslid address. The two array levels are not
// exported and are reached through their objects' own vtables instead.
struct StashClass {
  const char* prefix;
  std::uintptr_t entry;
};

constexpr std::array<StashClass, 5> kStashClasses{{
    {"_ZN4lvve15CommonKeyframes", 0xc84570},
    {"_ZN4lvve14CommonKeyframe", 0xc7ea80},
    {"_ZN4lvve5Graph", 0xd984b0},
    {"_ZN4lvve10GraphPoint", 0xda3364},
    {"_ZN4lvve11CommonPoint", 0xc8edc8},
}};

// The two array instantiations. `vtable` is the value a live object stores at offset zero and
// `entry` is what its slot 0x38 must hold; a mismatch refuses the call rather than guessing.
struct StashArrayClass {
  std::uintptr_t vtable;
  std::uintptr_t entry;
  std::uintptr_t destructor;
};

constexpr StashArrayClass kFrameArrayClass{0x4bceb80, 0xc873f8, 0xc86f40};
constexpr StashArrayClass kGraphArrayClass{0x4bdd330, 0xd9b6e4, 0xd9b22c};

using StashEntry = void* (*)(void*, const NodeMap&, bool&, const NodeMap&, bool&);

class StashNative : public HistoryNative {
 public:
  // HistoryNative already gates the fifteen node-history entry points by name and address; this
  // constructor adds the five exported record entry points to the same gate.
  StashNative(const editor_probe::Library& library, const char* path)
      : HistoryNative(library, path), library_(library) {
    // RTLD_NOLOAD reuses the image load_verified already checked instead of opening a second one.
    void* handle = dlopen(path, RTLD_NOW | RTLD_LOCAL | RTLD_NOLOAD);
    if (!handle) throw std::runtime_error("The verified library image is not already loaded");
    try {
      for (const auto& node_class : kStashClasses) require_symbol(handle, name(node_class), node_class.entry);
    } catch (...) {
      dlclose(handle);
      throw;
    }
    dlclose(handle);
  }

  static std::string name(const StashClass& node_class) {
    // The history map is by const reference and the escape map follows the changed output, so
    // the whole suffix after the class name is one fixed string for every class in the family.
    static const std::string suffix =
        "14get_stash_copyERKNSt3__113unordered_mapINS1_17basic_string_viewIcNS1_11char_traitsIcEEEE"
        "NS1_10shared_ptrINS_4NodeEEENS1_4hashIS6_EENS1_8equal_toIS6_EENS1_9allocatorINS1_4pairIKS6_"
        "S9_EEEEEERbSL_SM_";
    return std::string(node_class.prefix) + suffix;
  }

  Handle stash_frame(const Handle& frame, const NodeMap& history, bool& changed, const NodeMap& escape,
                     bool& escaped) const {
    return own(editor_probe::entry<StashEntry>(library_, 0xc7ea80)(frame.get(), history, changed, escape, escaped),
               0x4bce660, 0xc82d0c);
  }
  Handle stash_group(const Handle& group, const NodeMap& history, bool& changed, const NodeMap& escape,
                     bool& escaped) const {
    return own(editor_probe::entry<StashEntry>(library_, 0xc84570)(group.get(), history, changed, escape, escaped),
               0x4bcea70, 0xc86b90);
  }
  // Both array levels go through the live object's own vtable slot, which is checked against the
  // recorded implementation address before the call.
  Handle stash_array(const Handle& array, const StashArrayClass& node_class, const NodeMap& history,
                     bool& changed, const NodeMap& escape, bool& escaped) const {
    const auto* vptr = *static_cast<const std::uint8_t* const*>(array.get());
    if (vptr != library_.base + node_class.vtable) throw std::runtime_error("Unexpected array dynamic type");
    const auto slot = *reinterpret_cast<const std::uint8_t* const*>(vptr + 0x38);
    if (slot != library_.base + node_class.entry) throw std::runtime_error("Relocated array record entry");
    return own(reinterpret_cast<StashEntry>(reinterpret_cast<std::uintptr_t>(slot))(
                   array.get(), history, changed, escape, escaped),
               node_class.vtable, node_class.destructor);
  }

  // std::make_shared<NodeArray<T>>(id, track_children, suppress). The keyframe helper and the
  // graph-point helper are the same 64 instructions apart from their two vtable constants, so
  // the argument check below is the same one the graph array factory already uses.
  Handle frame_array_factory(const std::string& id, bool track_children, bool suppress) const {
    Handle result;
    editor_probe::entry<void (*)(Handle&, const std::string&, bool, bool)>(library_, 0xc83ce4)(
        result, id, track_children, suppress);
    const auto* bytes = result ? static_cast<const std::uint8_t*>(result.get()) : nullptr;
    if (!bytes || *static_cast<const void**>(result.get()) != library_.base + kFrameArrayClass.vtable ||
        Native::id(result) != id || (bytes[0x60] != 0) != track_children || (bytes[0x61] != 0) != suppress) {
      throw std::runtime_error("Native keyframe array factory argument validation failed");
    }
    return result;
  }
  // NodeArray<T>::set_nodes. The keyframe and graph-point instances are byte-identical, and the
  // graph-point one is already the setter the earlier graph probes drive.
  void set_frame_array(const Handle& array, const List& frames) const {
    editor_probe::entry<void (*)(void*, const List&)>(library_, 0xc841c8)(array.get(), frames);
  }
  void set_material(const Handle& group, const std::string& value) const { set_group_text(group, false, value); }
  void set_property(const Handle& group, const std::string& value) const { set_group_text(group, true, value); }
  void set_time(const Handle& frame, std::int64_t value) const {
    editor_probe::entry<void (*)(void*, const std::int64_t&)>(library_, 0xc7dfb8)(frame.get(), value);
  }

 private:
  void require_symbol(void* handle, const std::string& symbol, std::uintptr_t address) const {
    // dlsym drops the Mach-O leading underscore, so the C++ mangled name is passed as is.
    const void* resolved = dlsym(handle, symbol.c_str());
    if (!resolved) throw std::runtime_error("Missing record entrypoint " + symbol);
    if (resolved != static_cast<const void*>(library_.base + address)) {
      throw std::runtime_error("Relocated record entrypoint " + symbol);
    }
  }
  Handle own(void* raw, std::uintptr_t vtable, std::uintptr_t destructor) const {
    if (!raw) return {};
    if (*static_cast<const void**>(raw) != library_.base + vtable) {
      throw std::runtime_error("Record returned an unexpected dynamic type");
    }
    // The record is an owned raw Node; its own class's deleting destructor releases it.
    return Handle(raw, editor_probe::entry<void (*)(void*)>(library_, destructor));
  }
  editor_probe::Library library_;
};

// Mirrors real SDK objects into the independent model. One snapshot covers both the historical
// and the current tree, so every native object has exactly one independent counterpart and the
// record's choice of child becomes an identity question instead of a value question.
struct StashSnapshot {
  const StashNative& native;
  TreeSnapshot graphs;
  std::unordered_map<const void*, std::shared_ptr<StashFrame>> frames;
  std::unordered_map<const void*, std::shared_ptr<StashFrameArray>> arrays;
  std::unordered_map<const void*, std::shared_ptr<StashGroup>> groups;
  std::unordered_map<const void*, std::shared_ptr<std::vector<double>>> payloads;
  // Every mirrored object by its native address, so an index the node-history walk filled can be
  // translated into the independent index without guessing a node's class from its pointer.
  std::unordered_map<const void*, KeyframeStashEntry> mirrored;

  explicit StashSnapshot(const StashNative& input) : native(input), graphs(input) {}

  template <class T> std::shared_ptr<T> record(const Handle& source, std::shared_ptr<T> value) {
    mirrored[source.get()] = value;
    return value;
  }
  std::shared_ptr<RecordPoint> coordinate(const Handle& source) {
    auto& result = graphs.leaves.points[source.get()];
    if (!result) {
      result = std::make_shared<RecordPoint>(RecordPoint{Native::id(source), Native::number(source, 0x30),
                                                         Native::number(source, 0x38), Native::state(source)});
    }
    return record(source, result);
  }
  std::shared_ptr<RecordGraphPoint> graph_point(const Handle& source) {
    auto result = graphs.leaves.graph_point(source);
    coordinate(native.coordinate(source));
    return record(source, result);
  }
  std::shared_ptr<GraphPointArray> graph_array(const Handle& source) {
    auto result = graphs.array(source);
    for (const bool retained : {false, true}) {
      for (const auto& child : Native::list(source, retained)) graph_point(child);
    }
    return record(source, result);
  }
  std::shared_ptr<GraphRecordTree> graph_tree(const Handle& source) {
    if (!source) return {};
    auto result = graphs.tree(source);
    graph_array(native.graph_array(source));
    return record(source, result);
  }
  std::shared_ptr<StashFrame> frame(const Handle& source) {
    auto& result = frames[source.get()];
    if (result) return result;
    result = std::make_shared<StashFrame>();
    // Registered before the children are visited so a cycle-free shared child maps to one object.
    result->id = Native::id(source);
    result->curve_type = native.factory.curve(source);
    result->time_offset = native.factory.time(source);
    result->left = coordinate(native.point(source, false));
    result->right = coordinate(native.point(source, true));
    auto& payload = payloads[Native::values_owner(source).get()];
    if (!payload) payload = std::make_shared<std::vector<double>>(native.factory.values(source));
    result->values = payload;
    result->string_value = native.text(source);
    result->graph = graph_tree(native.graph(source));
    result->mutation = Native::state(source);
    return record(source, result);
  }
  std::shared_ptr<StashFrameArray> array(const Handle& source) {
    auto& result = arrays[source.get()];
    if (result) return result;
    result = std::make_shared<StashFrameArray>();
    result->id = Native::id(source);
    result->nodes.mutation = Native::state(source);
    const auto* bytes = static_cast<const std::uint8_t*>(source.get());
    result->nodes.track_children = bytes[0x60] != 0;
    result->suppress_change_flag = bytes[0x61] != 0;
    auto& token = graphs.clocks[TreeNative::clock(source)];
    if (!token) token = std::make_shared<RecordArrayClock>();
    result->clock = token;
    result->transient = {TreeNative::word(source, 0x78), TreeNative::word(source, 0x80)};
    for (const bool retained : {false, true}) {
      for (const auto& child : Native::list(source, retained)) {
        (retained ? result->nodes.retained : result->nodes.active).push_back(frame(child));
      }
    }
    return record(source, result);
  }
  std::shared_ptr<StashGroup> group(const Handle& source) {
    auto& result = groups[source.get()];
    if (result) return result;
    result = std::make_shared<StashGroup>();
    result->id = Native::id(source);
    result->material_id = native.group_text(source, false);
    result->property = native.group_text(source, true);
    result->frames = array(native.array(source));
    result->mutation = Native::state(source);
    return record(source, result);
  }
  KeyframeStashEntry entry(const Handle& source, unsigned level) {
    if (!source) return std::monostate{};
    switch (level) {
      case 0: return group(source);
      case 1: return array(source);
      case 2: return frame(source);
      case 3: return graph_tree(source);
      case 4: return graph_array(source);
      case 5: return graph_point(source);
      default: return coordinate(source);
    }
  }
};

struct StashCompare {
  const StashNative& native;
  Checks& checks;
  TreeCompare trees;
  StashCompare(const StashNative& input, Checks& output) : native(input), checks(output), trees(input, output) {}

  void frame(const Handle& actual, const std::shared_ptr<StashFrame>& expected) {
    trees.leaves.identity(actual.get(), expected.get());
    checks.require(Native::id(actual) == expected->id, "Frame record ID differs");
    checks.require(Native::state(actual) == expected->mutation, "Frame record mutation differs");
    checks.require(native.factory.curve(actual) == expected->curve_type, "Frame record curve differs");
    checks.require(native.factory.time(actual) == expected->time_offset, "Frame record time differs");
    checks.require(native.text(actual) == expected->string_value, "Frame record string differs");
    trees.leaves.identity(Native::values_owner(actual).get(), expected->values.get());
    const auto& payload = native.factory.values(actual);
    checks.require(payload.size() == expected->values->size(), "Frame record payload length differs");
    for (std::size_t i = 0; i < payload.size(); ++i) checks.bits(payload[i], (*expected->values)[i]);
    trees.coordinate(native.point(actual, false), expected->left);
    trees.coordinate(native.point(actual, true), expected->right);
    const auto graph = native.graph(actual);
    checks.require(static_cast<bool>(graph) == static_cast<bool>(expected->graph), "Frame record graph slot differs");
    if (graph) trees.tree(graph, expected->graph);
  }
  void array(const Handle& actual, const std::shared_ptr<StashFrameArray>& expected) {
    trees.leaves.identity(actual.get(), expected.get());
    checks.require(Native::id(actual) == expected->id, "Array record ID differs");
    checks.require(Native::state(actual) == expected->nodes.mutation, "Array record mutation differs");
    const auto* bytes = static_cast<const std::uint8_t*>(actual.get());
    checks.require((bytes[0x60] != 0) == expected->nodes.track_children, "Array record child tracking differs");
    checks.require((bytes[0x61] != 0) == expected->suppress_change_flag, "Array record suppression differs");
    trees.leaves.identity(TreeNative::clock(actual), expected->clock.get());
    checks.require(TreeNative::word(actual, 0x78) == expected->transient[0] &&
                       TreeNative::word(actual, 0x80) == expected->transient[1],
                   "Array record transient words differ");
    for (const bool retained : {false, true}) {
      const auto& observed = Native::list(actual, retained);
      const auto& owned = retained ? expected->nodes.retained : expected->nodes.active;
      checks.require(observed.size() == owned.size(), "Array record list length differs");
      for (std::size_t i = 0; i < owned.size() && i < observed.size(); ++i) frame(observed[i], owned[i]);
    }
  }
  void group(const Handle& actual, const std::shared_ptr<StashGroup>& expected) {
    trees.leaves.identity(actual.get(), expected.get());
    checks.require(Native::id(actual) == expected->id, "Group record ID differs");
    checks.require(Native::state(actual) == expected->mutation, "Group record mutation differs");
    checks.require(native.group_text(actual, false) == expected->material_id, "Group record material differs");
    checks.require(native.group_text(actual, true) == expected->property, "Group record property differs");
    array(native.array(actual), expected->frames);
  }
};

// The caller's index on both sides at once, so a key can be seeded with a value the walk would
// never have picked itself. The native map keys are views over the strings kept here.
struct StashMap {
  NodeMap native;
  KeyframeStashIndex own;
  std::deque<std::string> keys;
  void seed(const std::string& key, const Handle& value, StashSnapshot& snapshot, unsigned level) {
    keys.push_back(key);
    const std::string_view view(keys.back());
    native[view] = value ? std::shared_ptr<lvve::Node>(value, static_cast<lvve::Node*>(value.get()))
                         : std::shared_ptr<lvve::Node>{};
    own[keys.back()] = value ? snapshot.entry(value, level) : KeyframeStashEntry{std::monostate{}};
  }
};
}  // namespace creator_record_probe
