#pragma once

#include "native_record_support.hpp"
#include "record_stash.hpp"
#include "../independent-editor-contract/native_graph.hpp"

namespace creator_record_probe {
class GraphNative : public Native {
 public:
  explicit GraphNative(const editor_probe::Library& library)
      : Native(library), graphs(library), library_(library) {}
  editor_probe::GraphFactories graphs;
  Handle copy(const Handle& source, NodeMap& index, bool graph_value) const {
    return own(editor_probe::entry<void* (*)(void*, NodeMap&)>(library_, graph_value ? 0xd98f24 : 0xda3830)
                   (source.get(), index), graph_value ? 0x4bdd220 : 0x4bdd6b0, graph_value ? 0xd9ae7c : 0xda51b8);
  }
  Handle copy_group(const Handle& source, NodeMap& index) const {
    return own(editor_probe::entry<void* (*)(void*, NodeMap&)>(library_, 0xc84edc)(source.get(), index),
               0x4bcea70, 0xc86b90);
  }
  void restore(const Handle& destination, NodeMap& index, const Handle& source, bool graph_value) const {
    editor_probe::entry<void (*)(void*, NodeMap&, const void*)>(library_, graph_value ? 0xd98c5c : 0xda3704)
        (destination.get(), index, source.get());
  }
  void set_points(const Handle& graph_value, const List& points) const {
    editor_probe::entry<void (*)(void*, const List&)>(library_, 0xd98084)(graph_value.get(), points);
  }
  void reset_graph(const Handle& graph_value) const {
    editor_probe::entry<void (*)(void*)>(library_, 0xd98470)(graph_value.get());
  }
  void reset_point(const Handle& point_value) const {
    editor_probe::entry<void (*)(void*)>(library_, 0xda3324)(point_value.get());
  }
  Handle stash(const Handle& point_value, const NodeMap& history, bool& changed,
               const NodeMap& escape, bool& escaped) const {
    auto* raw = editor_probe::entry<void* (*)(void*, const NodeMap&, bool&, const NodeMap&, bool&)>
        (library_, 0xda3364)(point_value.get(), history, changed, escape, escaped);
    return raw ? own(raw, 0x4bdd6b0, 0xda51b8) : Handle{};
  }
  void coordinate_value(const Handle& graph_point, bool y, double value) const {
    editor_probe::entry<void (*)(void*, const double&)>(library_, y ? 0xc8ebfc : 0xc8ebac)
        (coordinate(graph_point).get(), value);
  }
  void point_type(const Handle& point_value, std::int32_t type) const {
    editor_probe::entry<void (*)(void*, const std::int32_t&)>(library_, 0xda2fd8)(point_value.get(), type);
  }
  void alias_coordinates(const Handle& first, const Handle& second) const {
    editor_probe::entry<void (*)(void*, const Handle&)>(library_, 0xda3018)(first.get(), coordinate(second));
  }
  void metadata(const Handle& graph_value, std::size_t seed) const {
    const std::string id = seed % 3 == 0 ? std::string("r\0s", 3) : std::string(seed % 41, 'i');
    const std::string name = seed % 2 == 0 ? "" : std::string(seed % 47, 'n');
    const std::int32_t platform = seed % 2 == 0 ? std::numeric_limits<std::int32_t>::min() : std::numeric_limits<std::int32_t>::max();
    editor_probe::entry<void (*)(void*, const std::string&)>(library_, 0xd97e50)(graph_value.get(), id);
    editor_probe::entry<void (*)(void*, const std::string&)>(library_, 0xd97f44)(graph_value.get(), name);
    editor_probe::entry<void (*)(void*, const std::int32_t&)>(library_, 0xd98038)(graph_value.get(), platform);
  }
  Handle fixture(std::size_t seed) const {
    const std::array<double, 8> values{0.0, -0.0, .37, -.8, std::numeric_limits<double>::infinity(),
      -std::numeric_limits<double>::infinity(), std::bit_cast<double>(std::uint64_t{0x7ff8000000001234}),
      std::bit_cast<double>(std::uint64_t{0xfff8000000005678})};
    std::vector<editor_contract::GraphPoint> input;
    for (std::size_t i = 0; i < seed % 6; ++i) {
      input.push_back({static_cast<std::int32_t>((seed + i) % 7) - 3,
                       values[(seed + i) % 8], values[(seed / 8 + i) % 8]});
    }
    auto result = graphs.create(input);
    auto points = list(graph_array(result));
    track(result, seed % 2 != 0);
    track(graph_array(result), seed % 3 != 0);
    track_children(graph_array(result), seed % 4 != 0);
    for (std::size_t i = 0; i < points.size(); ++i) {
      track(points[i], (seed + i) % 2 != 0);
      track(coordinate(points[i]), (seed + i) % 3 != 0);
    }
    if (points.size() > 1 && seed % 5 == 0) alias_coordinates(points[0], points[1]);
    if (!points.empty() && seed % 7 == 0) points.push_back(points[0]);
    if (points.size() > 1 && seed % 11 == 0) points.erase(points.begin());
    set_points(result, points);
    metadata(result, seed);
    if (seed % 3 == 0) reset_graph(result);
    return result;
  }
 private:
  Handle own(void* raw, std::uintptr_t vtable, std::uintptr_t destructor) const {
    if (!raw || *static_cast<const void**>(raw) != library_.base + vtable) {
      throw std::runtime_error("Graph restore copy returned unexpected dynamic type");
    }
    return Handle(raw, editor_probe::entry<void (*)(void*)>(library_, destructor));
  }
  editor_probe::Library library_;
};
}  // namespace creator_record_probe
