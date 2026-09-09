#pragma once

#include "native_graph_record_support.hpp"
#include "graph_diff.hpp"

namespace creator_record_probe {
class TreeNative : public GraphNative {
 public:
  explicit TreeNative(const editor_probe::Library& library) : GraphNative(library), library_(library) {}
  Handle array_factory(const std::string& id, bool track_children, bool suppress) const {
    Handle result;
    editor_probe::entry<void (*)(Handle&, const std::string&, bool, bool)>(library_, 0xd97bfc)
        (result, id, track_children, suppress);
    if (!result || *static_cast<const void**>(result.get()) != library_.base + 0x4bdd330 ||
        Native::id(result) != id || (static_cast<const std::uint8_t*>(result.get())[0x60] != 0) != track_children ||
        (static_cast<const std::uint8_t*>(result.get())[0x61] != 0) != suppress) {
      throw std::runtime_error("Native array factory argument validation failed");
    }
    return result;
  }
  void set_array(const Handle& array, const List& points) const {
    editor_probe::entry<void (*)(void*, const List&)>(library_, 0xd98120)(array.get(), points);
  }
  void reset_array(const Handle& array) const {
    editor_probe::entry<void (*)(void*)>(library_, 0xd9b2dc)(array.get());
  }
  Handle stash_tree(const Handle& source, const NodeMap& history, bool& changed,
                    const NodeMap& escape, bool& escaped, bool array = false) const {
    void* raw = editor_probe::entry<void* (*)(void*, const NodeMap&, bool&, const NodeMap&, bool&)>
        (library_, array ? 0xd9b6e4 : 0xd984b0)(source.get(), history, changed, escape, escaped);
    return owned(raw, array);
  }
  Handle deep(const Handle& source, bool array = false) const {
    void* raw = editor_probe::entry<void* (*)(void*, bool)>(library_, array ? 0xd9b390 : 0xd98218)(source.get(), false);
    return owned(raw, array);
  }
  void diff(const Handle& source, NodeMap& before, NodeMap& after, NodeMap& replacements,
            NodeMap& shared, bool& replaced, bool& enabled, unsigned level) const {
    const std::array<std::uintptr_t, 4> addresses{0xd9a778, 0xd9c9a4, 0xda4c24, 0xc8fbe8};
    if (level >= addresses.size()) throw std::invalid_argument("Unknown native diff node");
    editor_probe::entry<void (*)(void*, NodeMap&, NodeMap&, NodeMap&, NodeMap&, bool&, bool&)>
        (library_, addresses[level])(source.get(), before, after, replacements, shared, replaced, enabled);
  }
  static std::uint64_t word(const Handle& node, std::size_t offset) {
    std::uint64_t value; std::memcpy(&value, static_cast<const std::byte*>(node.get()) + offset, sizeof(value)); return value;
  }
  static const void* clock(const Handle& array) {
    const void* value; std::memcpy(&value, static_cast<const std::byte*>(array.get()) + 0x68, sizeof(value)); return value;
  }
 private:
  Handle owned(void* raw, bool array) const {
    if (!raw) return {};
    if (*static_cast<const void**>(raw) != library_.base + (array ? 0x4bdd330 : 0x4bdd220)) {
      throw std::runtime_error("Tree factory returned unexpected type");
    }
    return Handle(raw, editor_probe::entry<void (*)(void*)>(library_, array ? 0xd9b22c : 0xd9ae7c));
  }
  editor_probe::Library library_;
};

struct TreeSnapshot {
  const TreeNative& native;
  Snapshot leaves;
  std::unordered_map<const void*, std::shared_ptr<GraphRecordTree>> trees;
  std::unordered_map<const void*, std::shared_ptr<GraphPointArray>> arrays;
  std::unordered_map<const void*, std::shared_ptr<RecordArrayClock>> clocks;
  explicit TreeSnapshot(const TreeNative& input) : native(input), leaves(input) {}
  std::shared_ptr<GraphPointArray> array(const Handle& source) {
    auto& result = arrays[source.get()];
    if (result) return result;
    result = std::make_shared<GraphPointArray>();
    result->id = Native::id(source);
    result->nodes.mutation = Native::state(source);
    const auto* bytes = static_cast<const std::uint8_t*>(source.get());
    result->nodes.track_children = bytes[0x60] != 0;
    result->suppress_change_flag = bytes[0x61] != 0;
    auto& token = clocks[TreeNative::clock(source)];
    if (!token) token = std::make_shared<RecordArrayClock>();
    result->clock = token;
    result->transient = {TreeNative::word(source, 0x78), TreeNative::word(source, 0x80)};
    for (bool retained : {false, true}) {
      for (const auto& child : Native::list(source, retained)) {
        (retained ? result->nodes.retained : result->nodes.active).push_back(leaves.graph_point(child));
      }
    }
    return result;
  }
  std::shared_ptr<GraphRecordTree> tree(const Handle& source) {
    if (!source) return {};
    auto& result = trees[source.get()];
    if (result) return result;
    result = std::make_shared<GraphRecordTree>();
    result->id = Native::id(source);
    result->resource_id = native.graph_text(source, false);
    result->resource_name = native.graph_text(source, true);
    result->source_platform = Native::integer(source, 0x60);
    result->mutation = Native::state(source);
    result->points = array(native.graph_array(source));
    return result;
  }
  GraphTreeEntry entry(const Handle& source, unsigned level) {
    if (!source) return std::monostate{};
    if (level == 0) return tree(source);
    if (level == 1) return array(source);
    if (level == 2) return leaves.graph_point(source);
    auto& point = leaves.points[source.get()];
    if (!point) point = std::make_shared<RecordPoint>(RecordPoint{Native::id(source),
        Native::number(source, 0x30), Native::number(source, 0x38), Native::state(source)});
    return point;
  }
};

struct TreeCompare {
  const TreeNative& native;
  Checks& checks;
  Compare leaves;
  TreeCompare(const TreeNative& input, Checks& output) : native(input), checks(output), leaves{input, output, {}, {}} {}
  void coordinate(const Handle& actual, const std::shared_ptr<RecordPoint>& expected) {
    leaves.identity(actual.get(), expected.get());
    checks.require(Native::id(actual) == expected->id, "Coordinate ID differs");
    checks.require(Native::state(actual) == expected->mutation, "Coordinate state differs");
    checks.bits(Native::number(actual, 0x30), expected->x); checks.bits(Native::number(actual, 0x38), expected->y);
  }
  void array(const Handle& actual, const std::shared_ptr<GraphPointArray>& expected) {
    leaves.identity(actual.get(), expected.get());
    checks.require(Native::id(actual) == expected->id, "Array ID differs");
    checks.require(Native::state(actual) == expected->nodes.mutation, "Array state differs");
    const auto* bytes = static_cast<const std::uint8_t*>(actual.get());
    checks.require((bytes[0x60] != 0) == expected->nodes.track_children, "Child tracking differs");
    checks.require((bytes[0x61] != 0) == expected->suppress_change_flag, "Change suppression differs");
    leaves.identity(TreeNative::clock(actual), expected->clock.get());
    checks.require(TreeNative::word(actual, 0x78) == expected->transient[0] &&
        TreeNative::word(actual, 0x80) == expected->transient[1], "Transient clock fields differ");
    for (bool retained : {false, true}) {
      const auto& observed = Native::list(actual, retained);
      const auto& own = retained ? expected->nodes.retained : expected->nodes.active;
      checks.require(observed.size() == own.size(), "Tree list size differs");
      for (std::size_t i = 0; i < own.size(); ++i) leaves.graph_point(observed[i], own[i]);
    }
  }
  void tree(const Handle& actual, const std::shared_ptr<GraphRecordTree>& expected) {
    leaves.identity(actual.get(), expected.get());
    checks.require(Native::id(actual) == expected->id, "Tree ID differs");
    checks.require(Native::state(actual) == expected->mutation, "Tree mutation differs");
    checks.require(native.graph_text(actual, false) == expected->resource_id, "Tree resource differs");
    checks.require(native.graph_text(actual, true) == expected->resource_name, "Tree name differs");
    checks.require(Native::integer(actual, 0x60) == expected->source_platform, "Tree platform differs");
    array(native.graph_array(actual), expected->points);
  }
  void entry(const Handle& actual, const GraphTreeEntry& expected) {
    if (const auto value = std::get_if<std::shared_ptr<GraphRecordTree>>(&expected)) tree(actual, *value);
    else if (const auto value = std::get_if<std::shared_ptr<GraphPointArray>>(&expected)) array(actual, *value);
    else if (const auto value = std::get_if<std::shared_ptr<RecordGraphPoint>>(&expected)) leaves.graph_point(actual, *value);
    else if (const auto value = std::get_if<std::shared_ptr<RecordPoint>>(&expected)) coordinate(actual, *value);
    else checks.require(!actual, "Null index entry differs");
  }
};
struct TreeMap {
  NodeMap native;
  GraphTreeIndex own;
  std::deque<std::string> keys;
  void add(const std::string& key, const Handle& value, TreeSnapshot& snapshot, unsigned level) {
    keys.push_back(key);
    native[keys.back()] = std::shared_ptr<lvve::Node>(value, static_cast<lvve::Node*>(value.get()));
    own[keys.back()] = snapshot.entry(value, level);
  }
  void compare(TreeCompare& comparison) const {
    comparison.checks.require(native.size() == own.size(), "Diff changed map key count differently");
    for (const auto& [key, value] : native) {
      const auto found = own.find(std::string(key));
      comparison.checks.require(found != own.end(), "Diff map key missing");
      comparison.entry(Handle(value, value.get()), found->second);
    }
  }
};
}  // namespace creator_record_probe
