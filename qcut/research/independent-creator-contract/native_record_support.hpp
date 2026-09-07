#pragma once

#include "record_restore.hpp"
#include "../independent-editor-contract/native_keyframes.hpp"

#include <bit>
#include <cstring>
#include <deque>
#include <limits>
#include <unordered_map>

namespace lvve { class Node; }

namespace creator_record_probe {
using Handle = editor_probe::KeyframeHandle;
using List = editor_probe::KeyframeList;
using NodeMap = std::unordered_map<std::string_view, std::shared_ptr<lvve::Node>>;
using namespace creator_contract;

struct Checks {
  std::size_t compared = 0;
  std::size_t cases = 0;
  void require(bool condition, const char* message) {
    ++compared;
    if (!condition) throw std::runtime_error(std::string(message) + " at case " +
        std::to_string(cases) + ", comparison " + std::to_string(compared));
  }
  void bits(double actual, double expected) {
    require(std::bit_cast<std::uint64_t>(actual) == std::bit_cast<std::uint64_t>(expected), "Payload bits differ");
  }
};

class Native {
 public:
  explicit Native(const editor_probe::Library& library) : factory(library), library_(library) {}
  editor_probe::KeyframeFactories factory;
  static const std::string& id(const Handle& object) {
    return *reinterpret_cast<const std::string*>(static_cast<const std::uint8_t*>(object.get()) + 8);
  }
  static editor_contract::MutationState state(const Handle& object) {
    auto* bytes = static_cast<const std::uint8_t*>(object.get());
    editor_contract::MutationState result;
    result.tracking = bytes[0x20];
    std::memcpy(&result.state_code, bytes + 0x24, 4);
    result.changed = bytes[0x28];
    return result;
  }
  static const List& list(const Handle& array, bool retained = false) {
    return *reinterpret_cast<const List*>(static_cast<const std::uint8_t*>(array.get()) + (retained ? 0x48 : 0x30));
  }
  static const std::shared_ptr<std::vector<double>>& values_owner(const Handle& frame) {
    return *reinterpret_cast<const std::shared_ptr<std::vector<double>>*>(
        static_cast<const std::uint8_t*>(frame.get()) + 0x58);
  }
  const Handle& point(const Handle& frame, bool right) const {
    return editor_probe::entry<const Handle& (*)(void*)>(library_, right ? 0xc7e0d4 : 0xc7dff0)(frame.get());
  }
  const std::string& text(const Handle& frame) const {
    return editor_probe::entry<const std::string& (*)(void*)>(library_, 0xc7e414)(frame.get());
  }
  const std::string& group_text(const Handle& group, bool property) const {
    return editor_probe::entry<const std::string& (*)(void*)>(library_, property ? 0xc84024 : 0xc83f30)(group.get());
  }
  void set_group_text(const Handle& group, bool property, const std::string& value) const {
    editor_probe::entry<void (*)(void*, const std::string&)>(library_, property ? 0xc8402c : 0xc83f38)
        (group.get(), value);
  }
  void set_text(const Handle& frame, const std::string& value) const {
    editor_probe::entry<void (*)(void*, const std::string&)>(library_, 0xc7e41c)(frame.get(), value);
  }
  Handle array(const Handle& group) const {
    return editor_probe::entry<const Handle& (*)(void*)>(library_, 0xc84124)(group.get());
  }
  void track(const Handle& object, bool enabled) const {
    editor_probe::entry<void (*)(void*, bool)>(library_, 0x36428c)(object.get(), enabled);
  }
  void track_children(const Handle& array_value, bool enabled) const {
    editor_probe::entry<void (*)(void*, bool)>(library_, 0xc86f7c)(array_value.get(), enabled);
  }
  void reset(const Handle& frame) const {
    editor_probe::entry<void (*)(void*)>(library_, 0xc7e98c)(frame.get());
  }
  void reset_group(const Handle& group) const {
    editor_probe::entry<void (*)(void*)>(library_, 0xc84530)(group.get());
  }
  void alias_controls(const Handle& frame) const {
    editor_probe::entry<void (*)(void*, const Handle&)>(library_, 0xc7e0dc)(frame.get(), point(frame, false));
  }
  void restore_frame(const Handle& destination, NodeMap& index, const Handle& source) const {
    editor_probe::entry<void (*)(void*, NodeMap&, const void*)>(library_, 0xc7f17c)
        (destination.get(), index, source.get());
  }
  void restore_group(const Handle& destination, NodeMap& index, const Handle& source) const {
    editor_probe::entry<void (*)(void*, NodeMap&, const void*)>(library_, 0xc84c48)
        (destination.get(), index, source.get());
  }
  Handle copy_frame(const Handle& source, NodeMap& index) const {
    void* raw = editor_probe::entry<void* (*)(void*, NodeMap&)>(library_, 0xc7f600)(source.get(), index);
    if (!raw || *static_cast<const void**>(raw) != library_.base + 0x4bce660) {
      throw std::runtime_error("Restore copy returned unexpected dynamic type");
    }
    // The API returns an owned raw Node; its verified deleting destructor releases the SDK allocation.
    return Handle(raw, editor_probe::entry<void (*)(void*)>(library_, 0xc82d0c));
  }
  Handle frame(std::size_t seed) const {
    const std::array<double, 8> numbers{0.0, -0.0, .37, -.8, std::numeric_limits<double>::infinity(),
        -std::numeric_limits<double>::infinity(), std::bit_cast<double>(std::uint64_t{0x7ff8000000004321}),
        std::bit_cast<double>(std::uint64_t{0xfff8000000009876})};
    auto result = factory.frame(static_cast<std::int64_t>(seed) - 300, .25);
    factory.set_curve(result, static_cast<std::int32_t>(seed % 5));
    factory.set_values(result, seed % 5 == 0 ? std::vector<double>{} :
        std::vector<double>{numbers[seed % 8], numbers[(seed / 8) % 8]});
    factory.set_control(result, false, {numbers[(seed + 2) % 8], numbers[(seed + 4) % 8]});
    factory.set_control(result, true, {numbers[(seed + 3) % 8], numbers[(seed + 5) % 8]});
    if (seed % 7 == 0) alias_controls(result);
    set_text(result, seed % 3 == 0 ? std::string("a\0b", 3) : std::string(seed % 50, 'q'));
    track(result, seed % 2 != 0);
    track(point(result, false), seed % 3 != 0);
    track(point(result, true), seed % 4 != 0);
    if (seed % 3 == 0) reset(result);
    if (seed % 4 == 1 || seed % 4 == 3) {
      auto temporary_group = factory.group();
      auto temporary_array = array(temporary_group);
      track_children(temporary_array, true);
      editor_probe::entry<void (*)(Handle, Handle)>(library_, 0x340bb70)(temporary_group, result);
      if (seed % 4 == 3) {
        editor_probe::entry<void (*)(void*, std::int32_t)>(library_, 0xc8ccf8)(temporary_array.get(), 0);
      }
    }
    return result;
  }
 private:
  editor_probe::Library library_;
};

struct Snapshot {
  const Native& native;
  std::unordered_map<void*, std::shared_ptr<RecordFrame>> frames;
  std::unordered_map<void*, std::shared_ptr<RecordPoint>> points;
  std::unordered_map<void*, std::shared_ptr<std::vector<double>>> values;
  explicit Snapshot(const Native& input) : native(input) {}
  std::shared_ptr<RecordPoint> point(const Handle& owner, bool right) {
    const auto actual = native.point(owner, right);
    auto& result = points[actual.get()];
    if (!result) {
      const auto coordinate = native.factory.control(owner, right);
      result = std::make_shared<RecordPoint>(RecordPoint{Native::id(actual), coordinate.time,
          coordinate.value, Native::state(actual)});
    }
    return result;
  }
  std::shared_ptr<RecordFrame> frame(const Handle& actual) {
    auto& result = frames[actual.get()];
    if (result) return result;
    if (native.factory.has_graph(actual)) throw std::runtime_error("Graph is outside native restore domain");
    auto& value = values[Native::values_owner(actual).get()];
    if (!value) value = std::make_shared<std::vector<double>>(native.factory.values(actual));
    result = std::make_shared<RecordFrame>(RecordFrame{Native::id(actual), native.factory.curve(actual),
        native.factory.time(actual), point(actual, false), point(actual, true), value, native.text(actual),
        Native::state(actual), false});
    return result;
  }
  RecordGroup group(const Handle& actual) {
    RecordGroup result;
    result.id = Native::id(actual);
    result.material_id = native.group_text(actual, false);
    result.property = native.group_text(actual, true);
    result.mutation = Native::state(actual);
    auto array = native.array(actual);
    result.frames.mutation = Native::state(array);
    result.frames.track_children = static_cast<const std::uint8_t*>(array.get())[0x60] != 0;
    for (bool retained : {false, true}) {
      for (const auto& element : Native::list(array, retained)) {
        (retained ? result.frames.retained : result.frames.active).push_back(frame(element));
      }
    }
    return result;
  }
};

struct Compare {
  const Native& native;
  Checks& checks;
  std::unordered_map<const void*, const void*> identities;
  std::unordered_map<const void*, const void*> reverse;
  void identity(const void* actual, const void* expected) {
    const auto [a, added_a] = identities.emplace(actual, expected);
    const auto [b, added_b] = reverse.emplace(expected, actual);
    checks.require(added_a || a->second == expected, "Native alias differs");
    checks.require(added_b || b->second == actual, "Independent alias differs");
  }
  void frame(const Handle& actual, const std::shared_ptr<RecordFrame>& expected) {
    identity(actual.get(), expected.get());
    checks.require(Native::id(actual) == expected->id, "Frame ID differs");
    checks.require(Native::state(actual) == expected->mutation, "Frame mutation differs");
    checks.require(native.factory.time(actual) == expected->time_offset, "Frame time differs");
    checks.require(native.factory.curve(actual) == expected->curve_type, "Frame curve differs");
    checks.require(native.text(actual) == expected->string_value, "String value differs");
    checks.require(!native.factory.has_graph(actual), "Unexpected graph");
    identity(Native::values_owner(actual).get(), expected->values.get());
    const auto& values = native.factory.values(actual);
    checks.require(values.size() == expected->values->size(), "Values count differs");
    for (std::size_t i = 0; i < values.size(); ++i) checks.bits(values[i], (*expected->values)[i]);
    for (const bool right : {false, true}) {
      const auto& point = native.point(actual, right);
      const auto& owned = right ? expected->right : expected->left;
      identity(point.get(), owned.get());
      checks.require(Native::id(point) == owned->id, "Control ID differs");
      checks.require(Native::state(point) == owned->mutation, "Control mutation differs");
      const auto coordinates = native.factory.control(actual, right);
      checks.bits(coordinates.time, owned->x);
      checks.bits(coordinates.value, owned->y);
    }
  }
  void group(const Handle& actual, const RecordGroup& expected) {
    checks.require(Native::id(actual) == expected.id, "Group ID differs");
    checks.require(Native::state(actual) == expected.mutation, "Group mutation differs");
    checks.require(native.group_text(actual, false) == expected.material_id, "Group material differs");
    checks.require(native.group_text(actual, true) == expected.property, "Group property differs");
    const auto array = native.array(actual);
    checks.require(Native::state(array) == expected.frames.mutation, "List mutation differs");
    checks.require((static_cast<const std::uint8_t*>(array.get())[0x60] != 0) ==
                   expected.frames.track_children, "Child tracking differs");
    for (const bool retained : {false, true}) {
      const auto& actual_list = Native::list(array, retained);
      const auto& owned = retained ? expected.frames.retained : expected.frames.active;
      checks.require(actual_list.size() == owned.size(), "List length differs");
      for (std::size_t i = 0; i < owned.size(); ++i) frame(actual_list[i], owned[i]);
    }
  }
};
}  // namespace creator_record_probe
