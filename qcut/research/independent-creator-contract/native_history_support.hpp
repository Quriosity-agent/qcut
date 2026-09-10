#pragma once

#include "history_index.hpp"
#include "native_graph_diff_support.hpp"

#include <dlfcn.h>

#include <array>
#include <string>
#include <utility>

namespace creator_record_probe {
// The five exported roots, in the order used as a case selector.
enum class HistoryLevel : unsigned { keyframes = 0, keyframe, graph, graph_point, point };
constexpr unsigned kHistoryLevels = 5;

struct HistoryClass {
  const char* prefix;
  std::uintptr_t all_nodes;
  std::uintptr_t escape_nodes;
  std::uintptr_t assign_nodes;
  HistoryNodeKind kind;
};

// Every root is resolved twice: once by its exported mangled name and once by the recorded
// unslid address, and the two must agree or the probe refuses to call anything.
constexpr std::array<HistoryClass, kHistoryLevels> kHistoryClasses{{
    {"_ZN4lvve15CommonKeyframes", 0xc8637c, 0xc86488, 0xc86498, HistoryNodeKind::keyframes},
    {"_ZN4lvve14CommonKeyframe", 0xc81fd0, 0xc82228, 0xc8228c, HistoryNodeKind::keyframe},
    {"_ZN4lvve5Graph", 0xd9a64c, 0xd9a758, 0xd9a768, HistoryNodeKind::graph},
    {"_ZN4lvve10GraphPoint", 0xda47dc, 0xda4c04, 0xda4c14, HistoryNodeKind::graph_point},
    {"_ZN4lvve11CommonPoint", 0xc8fbdc, 0xc8fbe0, 0xc8fbe4, HistoryNodeKind::point},
}};

class HistoryNative : public TreeNative {
 public:
  HistoryNative(const editor_probe::Library& library, const char* path)
      : TreeNative(library), library_(library) {
    // RTLD_NOLOAD reuses the image load_verified already checked instead of opening a second one.
    void* handle = dlopen(path, RTLD_NOW | RTLD_LOCAL | RTLD_NOLOAD);
    if (!handle) throw std::runtime_error("The verified library image is not already loaded");
    try {
      for (const auto& node_class : kHistoryClasses) {
        require_symbol(handle, name(node_class, 0), node_class.all_nodes);
        require_symbol(handle, name(node_class, 1), node_class.escape_nodes);
        require_symbol(handle, name(node_class, 2), node_class.assign_nodes);
      }
    } catch (...) {
      dlclose(handle);
      throw;
    }
    dlclose(handle);
  }

  static std::string name(const HistoryClass& node_class, unsigned which) {
    // The map argument is by mutable reference for the two getters and by const reference
    // for the setter; the rest of the signature is identical.
    static const std::string parameter =
        "NSt3__113unordered_mapINS1_17basic_string_viewIcNS1_11char_traitsIcEEEENS1_10shared_ptr"
        "INS_4NodeEEENS1_4hashIS6_EENS1_8equal_toIS6_EENS1_9allocatorINS1_4pairIKS6_S9_EEEEEE";
    static const std::array<const char*, 3> members{"13get_all_nodesER", "24get_escape_history_nodesER",
                                                    "24set_escape_history_nodesERK"};
    return std::string(node_class.prefix) + members.at(which) + parameter;
  }

  void all_nodes(const Handle& node, NodeMap& index, HistoryLevel level) const {
    call(level, &HistoryClass::all_nodes)(node.get(), index);
  }
  void escape_nodes(const Handle& node, NodeMap& index, HistoryLevel level) const {
    call(level, &HistoryClass::escape_nodes)(node.get(), index);
  }
  void assign_nodes(const Handle& node, const NodeMap& index, HistoryLevel level) const {
    editor_probe::entry<void (*)(void*, const NodeMap&)>(
        library_, kHistoryClasses.at(static_cast<unsigned>(level)).assign_nodes)(node.get(), index);
  }

  // Real SDK setters, so every fixture shape is produced by the library itself.
  void set_control(const Handle& frame, bool right, const Handle& value) const {
    editor_probe::entry<void (*)(void*, const Handle&)>(library_, right ? 0xc7e0dc : 0xc7dff8)(frame.get(), value);
  }
  void set_graph(const Handle& frame, const Handle& value) const {
    editor_probe::entry<void (*)(void*, const Handle&)>(library_, 0xc7e510)(frame.get(), value);
  }
  void set_coordinate(const Handle& graph_point, const Handle& value) const {
    editor_probe::entry<void (*)(void*, const Handle&)>(library_, 0xda3018)(graph_point.get(), value);
  }
  void set_frames(const Handle& group, const List& frames) const {
    editor_probe::entry<void (*)(void*, const List&)>(library_, 0xc8412c)(group.get(), frames);
  }
  Handle copy_graph_point(const Handle& source, NodeMap& index) const {
    return TreeNative::copy(source, index, false);
  }
  static const std::string& node_id(const void* object) {
    return *reinterpret_cast<const std::string*>(static_cast<const std::uint8_t*>(object) + 8);
  }
  static HistoryNodeKind kind_of(HistoryLevel level) {
    return kHistoryClasses.at(static_cast<unsigned>(level)).kind;
  }

 private:
  void require_symbol(void* handle, const std::string& symbol, std::uintptr_t address) const {
    // dlsym drops the Mach-O leading underscore, so the C++ mangled name is passed as is.
    const void* resolved = dlsym(handle, symbol.c_str());
    if (!resolved) throw std::runtime_error("Missing history entrypoint " + symbol);
    if (resolved != static_cast<const void*>(library_.base + address)) {
      throw std::runtime_error("Relocated history entrypoint " + symbol);
    }
  }
  using Walk = void (*)(void*, NodeMap&);
  Walk call(HistoryLevel level, std::uintptr_t HistoryClass::*member) const {
    return editor_probe::entry<Walk>(library_, kHistoryClasses.at(static_cast<unsigned>(level)).*member);
  }
  editor_probe::Library library_;
};

// Mirrors a real SDK subtree into the independent model. Every node is registered before its
// children are visited, so shared children map to one independent object.
struct HistorySnapshot {
  const HistoryNative& native;
  std::unordered_map<const void*, std::shared_ptr<HistoryNode>> nodes;
  std::vector<std::pair<Handle, std::shared_ptr<HistoryNode>>> mirrored;
  explicit HistorySnapshot(const HistoryNative& input) : native(input) {}

  std::shared_ptr<HistoryNode> node(const Handle& source, HistoryNodeKind kind) {
    if (!source) return {};
    const auto found = nodes.find(source.get());
    if (found != nodes.end()) {
      if (found->second->kind != kind) throw std::runtime_error("Mirrored node kind conflicts");
      return found->second;
    }
    auto result = std::make_shared<HistoryNode>();
    result->kind = kind;
    result->id = HistoryNative::node_id(source.get());
    nodes.emplace(source.get(), result);
    mirrored.emplace_back(source, result);
    switch (kind) {
      case HistoryNodeKind::point:
        break;
      case HistoryNodeKind::keyframe:
        result->slots = {node(native.point(source, false), HistoryNodeKind::point),
                         node(native.point(source, true), HistoryNodeKind::point),
                         node(native.graph(source), HistoryNodeKind::graph)};
        break;
      case HistoryNodeKind::keyframes:
        result->slots = {node(native.array(source), HistoryNodeKind::keyframe_array)};
        break;
      case HistoryNodeKind::graph:
        result->slots = {node(native.graph_array(source), HistoryNodeKind::graph_point_array)};
        break;
      case HistoryNodeKind::graph_point:
        result->slots = {node(native.coordinate(source), HistoryNodeKind::point)};
        break;
      case HistoryNodeKind::keyframe_array:
      case HistoryNodeKind::graph_point_array: {
        const auto child = kind == HistoryNodeKind::keyframe_array ? HistoryNodeKind::keyframe
                                                                  : HistoryNodeKind::graph_point;
        for (const bool retained : {false, true}) {
          for (const auto& element : Native::list(source, retained)) {
            (retained ? result->retained : result->active).push_back(node(element, child));
          }
        }
        break;
      }
    }
    return result;
  }
};

// A caller map that exists on both sides at once. The key bytes live in `keys`, so a
// pre-seeded key can be told apart from one the walk took from a node's own ID.
struct HistoryMap {
  NodeMap native;
  HistoryIndex own;
  std::deque<std::string> keys;
  void seed(const std::string& key, const Handle& value, HistorySnapshot& snapshot, HistoryNodeKind kind) {
    keys.push_back(key);
    const std::string_view view(keys.back());
    native[view] = value ? std::shared_ptr<lvve::Node>(value, static_cast<lvve::Node*>(value.get()))
                         : std::shared_ptr<lvve::Node>{};
    own[view] = value ? snapshot.node(value, kind) : std::shared_ptr<HistoryNode>{};
  }
};

struct HistoryCompare {
  Checks& checks;
  HistorySnapshot& snapshot;
  void maps(const NodeMap& actual, const HistoryIndex& expected) {
    checks.require(actual.size() == expected.size(), "History map size differs");
    for (const auto& [key, value] : actual) {
      const auto found = expected.find(key);
      checks.require(found != expected.end(), "History map key missing");
      if (found == expected.end()) continue;
      checks.require(static_cast<bool>(value) == static_cast<bool>(found->second), "History map null entry differs");
      if (!value) continue;
      const auto mirror = snapshot.nodes.find(static_cast<const void*>(value.get()));
      checks.require(mirror != snapshot.nodes.end(), "History map value is outside the mirrored tree");
      if (mirror == snapshot.nodes.end()) continue;
      checks.require(mirror->second == found->second, "History map value identity differs");
      const auto& stored = HistoryNative::node_id(static_cast<const void*>(value.get()));
      const bool native_owns = key.data() == stored.data() && key.size() == stored.size();
      const bool own_owns = found->first.data() == found->second->id.data() &&
                            found->first.size() == found->second->id.size();
      checks.require(native_owns == own_owns, "History key provenance differs");
    }
  }
  // The walk reads the tree and takes strong references; nothing about a node may change.
  void tree_unchanged(const HistorySnapshot& source) {
    for (const auto& [handle, owned] : source.mirrored) {
      checks.require(HistoryNative::node_id(handle.get()) == owned->id, "Walked node ID changed");
      if (owned->kind != HistoryNodeKind::keyframe_array && owned->kind != HistoryNodeKind::graph_point_array) continue;
      checks.require(Native::list(handle, false).size() == owned->active.size() &&
                         Native::list(handle, true).size() == owned->retained.size(),
                     "Walked array length changed");
    }
  }
};
}  // namespace creator_record_probe
