#include "dirty_tree.hpp"
#include "keyframe_insertion.hpp"
#include "../independent-editor-contract/native_segments.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <bit>
#include <array>
#include <cstring>
#include <iostream>
#include <limits>
#include <unordered_map>

namespace {
using Handle = editor_probe::KeyframeHandle;
using List = editor_probe::KeyframeList;
using creator_contract::CommonKeyframe;
using creator_contract::CommonKeyframeGroup;
using creator_contract::CommonKeyframeArray;

struct Counters {
  std::size_t frame_cases = 0;
  std::size_t array_cases = 0;
  std::size_t lifetime_cases = 0;
  std::size_t compared = 0;
  void require(bool value) {
    ++compared;
    if (!value) throw std::runtime_error("Native dirty/retained mismatch at comparison " +
        std::to_string(compared) + ", frame-list " + std::to_string(frame_cases) +
        ", group-array " + std::to_string(array_cases) + ", lifetime " + std::to_string(lifetime_cases));
  }
};

class Native {
 public:
  explicit Native(const editor_probe::Library& library)
      : factory(library), segments(library), library_(library) {}
  editor_probe::KeyframeFactories factory;
  editor_probe::SegmentFactories segments;

  static editor_contract::MutationState state(const Handle& value) {
    const auto* bytes = static_cast<const std::uint8_t*>(value.get());
    editor_contract::MutationState result;
    result.tracking = bytes[0x20];
    std::memcpy(&result.state_code, bytes + 0x24, sizeof(result.state_code));
    result.changed = bytes[0x28];
    return result;
  }
  static const List& list(const Handle& value, bool retained) {
    return *reinterpret_cast<const List*>(static_cast<const std::uint8_t*>(value.get()) + (retained ? 0x48 : 0x30));
  }
  static const std::string& id(const Handle& value) {
    return *reinterpret_cast<const std::string*>(static_cast<const std::uint8_t*>(value.get()) + 8);
  }
  const Handle& point(const Handle& frame, bool right) const {
    return editor_probe::entry<const Handle& (*)(void*)>(library_, right ? 0xc7e0d4 : 0xc7dff0)(frame.get());
  }
  const std::vector<double>& values(const Handle& frame) const {
    return editor_probe::entry<const std::vector<double>& (*)(void*)>(library_, 0xc7e1b8)(frame.get());
  }
  double coordinate(const Handle& point_value, bool y) const {
    return editor_probe::entry<const double& (*)(void*)>(library_, y ? 0xc8ebf4 : 0xc8eba4)(point_value.get());
  }
  Handle array(const Handle& parent, bool groups = false) const {
    return editor_probe::entry<const Handle& (*)(void*)>(library_, groups ? 0x12216c4 : 0xc84124)(parent.get());
  }
  void set_tracking(const Handle& object, bool enabled) const {
    editor_probe::entry<void (*)(void*, bool)>(library_, 0x36428c)(object.get(), enabled);
  }
  void set_child_tracking(const Handle& array_value, bool enabled, bool groups = false) const {
    editor_probe::entry<void (*)(void*, bool)>(library_, groups ? 0xe109f0 : 0xc86f7c)(array_value.get(), enabled);
  }
  void change_point(const Handle& frame, bool right, double value) const {
    editor_probe::entry<void (*)(void*, const double&)>(library_, 0xc8ebac)(point(frame, right).get(), value);
  }
  void insert(const Handle& group, const Handle& frame) const {
    editor_probe::entry<void (*)(Handle, Handle)>(library_, 0x340bb70)(group, frame);
  }
  Handle ensure(const Handle& segment, const std::string& property) const {
    return editor_probe::entry<Handle (*)(Handle, const editor_probe::KeyframeTypeKey&)>(library_, 0x340a010)
        (segment, {property, "qcut-record-only"});
  }
  void set_groups(const Handle& segment, const List& groups) const {
    editor_probe::entry<void (*)(void*, const List&)>(library_, 0x12216cc)(segment.get(), groups);
  }
  void remove(const Handle& array_value, std::size_t index, bool groups = false) const {
    if (index >= list(array_value, false).size()) throw std::out_of_range("Native removal index");
    editor_probe::entry<void (*)(void*, std::int32_t)>(library_, groups ? 0xe1676c : 0xc8ccf8)
        (array_value.get(), static_cast<std::int32_t>(index));
  }
  void reset_frame(const Handle& frame) const {
    editor_probe::entry<void (*)(void*)>(library_, 0xc7e98c)(frame.get());
  }
  void reset_group(const Handle& group) const {
    editor_probe::entry<void (*)(void*)>(library_, 0xc84530)(group.get());
  }
  void reset_array(const Handle& array_value) const {
    editor_probe::entry<void (*)(void*)>(library_, 0xe10a64)(array_value.get());
  }
  bool dirty_frame(const Handle& frame) const {
    return editor_probe::entry<bool (*)(void*)>(library_, 0xc7e9f4)(frame.get());
  }
  bool dirty_group(const Handle& group) const {
    return editor_probe::entry<bool (*)(void*)>(library_, 0xc84550)(group.get());
  }
  bool dirty_array(const Handle& array_value) const {
    return editor_probe::entry<bool (*)(void*)>(library_, 0xe109f8)(array_value.get());
  }

  CommonKeyframe snapshot_frame(const Handle& frame) const {
    const auto& graph = editor_probe::entry<const Handle& (*)(void*)>(library_, 0xc7e508)(frame.get());
    if (graph) throw std::runtime_error("Graph-backed frame is outside this native diagnostic domain");
    CommonKeyframe result;
    result.id = id(frame);
    result.time_offset = factory.time(frame);
    result.values = values(frame);
    result.mutation = state(frame);
    for (const bool right : {false, true}) {
      const auto& actual = point(frame, right);
      if (!actual) throw std::runtime_error("Native factory returned a null control");
      auto control = std::make_shared<creator_contract::KeyframeControl>();
      control->x = coordinate(actual, false);
      control->y = coordinate(actual, true);
      control->mutation = state(actual);
      (right ? result.right_control : result.left_control) = control;
    }
    return result;
  }
  CommonKeyframeGroup snapshot_group(const Handle& group) const {
    CommonKeyframeGroup result;
    const auto array_value = array(group);
    result.mutation = state(group);
    result.list_mutation = state(array_value);
    result.track_inserted_children = static_cast<const std::uint8_t*>(array_value.get())[0x60] != 0;
    std::unordered_map<void*, std::shared_ptr<CommonKeyframe>> identity;
    for (bool retained : {false, true}) {
      for (const auto& item : list(array_value, retained)) {
        auto& owned = identity[item.get()];
        if (!owned) owned = std::make_shared<CommonKeyframe>(snapshot_frame(item));
        (retained ? result.retained_keyframes : result.keyframes).push_back(owned);
      }
    }
    return result;
  }
  void compare_frame(Counters& counts, const Handle& actual, const CommonKeyframe& expected) const {
    counts.require(state(actual) == expected.mutation);
    counts.require(factory.time(actual) == expected.time_offset && id(actual) == expected.id);
    counts.require(values(actual).size() == expected.values.size());
    for (std::size_t i = 0; i < expected.values.size(); ++i) {
      counts.require(std::bit_cast<std::uint64_t>(values(actual)[i]) == std::bit_cast<std::uint64_t>(expected.values[i]));
    }
    for (const bool right : {false, true}) {
      const auto& p = point(actual, right);
      const auto& e = right ? expected.right_control : expected.left_control;
      counts.require(state(p) == e->mutation);
      counts.require(std::bit_cast<std::uint64_t>(coordinate(p, false)) == std::bit_cast<std::uint64_t>(e->x));
      counts.require(std::bit_cast<std::uint64_t>(coordinate(p, true)) == std::bit_cast<std::uint64_t>(e->y));
    }
    counts.require(dirty_frame(actual) == creator_contract::keyframe_is_dirty(expected));
  }
  void compare_group(Counters& counts, const Handle& group, const CommonKeyframeGroup& expected) const {
    const auto array_value = array(group);
    counts.require(state(group) == expected.mutation && state(array_value) == expected.list_mutation);
    counts.require(dirty_group(group) == creator_contract::group_is_dirty(expected));
    for (bool retained : {false, true}) {
      const auto& actual = list(array_value, retained);
      const auto& owned = retained ? expected.retained_keyframes : expected.keyframes;
      counts.require(actual.size() == owned.size());
      for (std::size_t i = 0; i < actual.size(); ++i) compare_frame(counts, actual[i], *owned[i]);
    }
  }

 private:
  editor_probe::Library library_;
};

void frame_cases(const Native& native, Counters& counts) {
  const std::array payloads{-0.0, 0.37, std::bit_cast<double>(std::uint64_t{0x7ff8000000004321}),
                            std::numeric_limits<double>::infinity()};
  for (std::size_t test = 0; test < 2000; ++test) {
    auto group = native.factory.group();
    auto array = native.array(group);
    native.set_child_tracking(array, test % 2 != 0);
    List frames;
    for (std::size_t i = 0; i < 1 + test % 7; ++i) {
      auto frame = native.factory.frame(static_cast<std::int64_t>(i), payloads[(test + i) % payloads.size()]);
      native.insert(group, frame);
      frames.push_back(frame);
    }
    if (test % 3 == 0) native.insert(group, frames.front());
    if (test % 11 != 0) native.reset_group(group);
    native.set_tracking(group, test % 5 == 0);
    native.set_tracking(array, test % 7 == 0);
    for (std::size_t i = 0; i < frames.size(); ++i) {
      const bool right = (test + i) % 2 != 0;
      native.set_tracking(native.point(frames[i], right), (test + i) % 3 == 0);
      native.change_point(frames[i], right, static_cast<double>(test + i + 1));
      if ((test + i) % 4 == 0) native.set_tracking(frames[i], false);
    }
    auto own = native.snapshot_group(group);
    native.compare_group(counts, group, own);
    const auto removed = creator_contract::remove_keyframe_at(own, 0);
    auto removed_actual = Native::list(array, false).front();
    native.remove(array, 0);
    native.compare_group(counts, group, own);
    native.reset_group(group);
    creator_contract::reset_group_dirty(own);
    native.compare_group(counts, group, own);
    native.compare_frame(counts, removed_actual, *removed.keyframe);
    native.reset_group(group);
    creator_contract::reset_group_dirty(own);
    native.compare_group(counts, group, own);
    ++counts.frame_cases;
  }
}

void group_array_cases(const Native& native, Counters& counts) {
  for (std::size_t test = 0; test < 240; ++test) {
    auto segment = native.segments.video();
    auto array = native.array(segment, true);
    native.set_child_tracking(array, test % 2 != 0, true);
    List groups;
    CommonKeyframeArray own;
    for (std::size_t i = 0; i < 1 + test % 4; ++i) {
      auto group = native.ensure(segment, "qcut-property-" + std::to_string(i));
      auto frame = native.factory.frame(static_cast<std::int64_t>(i), 0.5);
      native.insert(group, frame);
      native.reset_group(group);
      native.change_point(frame, false, static_cast<double>(test + 1));
      groups.push_back(group);
    }
    if (test % 3 == 0) {
      groups.push_back(groups.front());
      native.set_groups(segment, groups);
      native.set_child_tracking(array, test % 2 != 0, true);
    }
    std::unordered_map<void*, std::shared_ptr<CommonKeyframeGroup>> identity;
    for (const auto& group : groups) {
      auto& snapshot = identity[group.get()];
      if (!snapshot) snapshot = std::make_shared<CommonKeyframeGroup>(native.snapshot_group(group));
      own.active.push_back(snapshot);
    }
    for (const auto& group : Native::list(array, true)) {
      auto& snapshot = identity[group.get()];
      if (!snapshot) snapshot = std::make_shared<CommonKeyframeGroup>(native.snapshot_group(group));
      own.retained.push_back(snapshot);
    }
    own.mutation = Native::state(array);
    own.track_removed_children = test % 2 != 0;
    counts.require(native.dirty_array(array) == creator_contract::common_array_is_dirty(own));
    const auto removed = creator_contract::remove_common_group_at(own, 0);
    native.remove(array, 0, true);
    counts.require(Native::state(array) == own.mutation && Native::list(array, true).size() == own.retained.size());
    for (std::size_t i = 0; i < own.retained.size(); ++i) {
      counts.require(identity.at(Native::list(array, true)[i].get()) == own.retained[i]);
    }
    native.compare_group(counts, groups[0], *removed.group);
    native.reset_array(array);
    creator_contract::reset_common_array_dirty(own);
    counts.require(Native::state(array) == own.mutation && Native::list(array, true).empty());
    counts.require(native.dirty_array(array) == creator_contract::common_array_is_dirty(own));
    counts.require(Native::list(array, false).size() == own.active.size());
    for (std::size_t i = 0; i < own.active.size(); ++i) {
      counts.require(Native::list(array, false)[i] == groups[i + 1]);
      native.compare_group(counts, groups[i + 1], *own.active[i]);
    }
    native.compare_group(counts, groups[0], *removed.group);
    ++counts.array_cases;
  }
}

void lifetime_cases(const Native& native, Counters& counts) {
  for (const bool alias : {false, true}) {
    auto group = native.factory.group();
    auto array = native.array(group);
    std::weak_ptr<void> weak;
    {
      auto frame = native.factory.frame(1, 0.5);
      weak = frame;
      native.insert(group, frame);
      if (alias) native.insert(group, frame);
    }
    native.remove(array, 0);
    counts.require(!weak.expired());
    native.reset_group(group);
    counts.require(weak.expired() == !alias);
    group.reset();
    array.reset();
    counts.require(weak.expired());
    ++counts.lifetime_cases;
  }
  for (const bool alias : {false, true}) {
    auto segment = native.segments.video();
    auto array = native.array(segment, true);
    std::weak_ptr<void> weak_group;
    std::weak_ptr<void> weak_frame;
    {
      auto group = native.ensure(segment, "lifetime-only");
      auto frame = native.factory.frame(0, 0.5);
      weak_group = group;
      weak_frame = frame;
      native.insert(group, frame);
      if (alias) native.set_groups(segment, {group, group});
    }
    native.remove(array, 0, true);
    counts.require(!weak_group.expired() && !weak_frame.expired());
    native.reset_array(array);
    counts.require(weak_group.expired() == !alias && weak_frame.expired() == !alias);
    segment.reset();
    array.reset();
    counts.require(weak_group.expired() && weak_frame.expired());
    ++counts.lifetime_cases;
  }
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::invalid_argument("Usage: creator-native-dirty /absolute/libvideoeditor.dylib");
      Counters counts;
      {
        editor_probe::NativeOutputScope quiet;
        const Native native(editor_probe::load_verified(argv[1]));
        frame_cases(native, counts);
        group_array_cases(native, counts);
        lifetime_cases(native, counts);
      }
      std::cout << "{\"frame_list_cases\":" << counts.frame_cases << ",\"group_array_cases\":"
                << counts.array_cases << ",\"lifetime_cases\":" << counts.lifetime_cases
                << ",\"values_compared\":" << counts.compared << ",\"mismatches\":0}\n";
      return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
  }
}
