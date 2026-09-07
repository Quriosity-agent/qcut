#include "keyframe_controls.hpp"
#include "keyframe_insertion.hpp"
#include "../independent-editor-contract/native_keyframes.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <array>
#include <bit>
#include <cstring>
#include <iostream>
#include <limits>
#include <random>

namespace {
using Handle = editor_probe::KeyframeHandle;
using List = editor_probe::KeyframeList;
using creator_contract::CommonKeyframe;
using creator_contract::CommonKeyframeGroup;

struct Counters {
  std::size_t insertion_cases = 0;
  std::size_t control_cases = 0;
  std::size_t values = 0;
  void require(bool result) {
    ++values;
    if (!result) throw std::runtime_error("Native insertion/control contract mismatch");
  }
  void same(double a, double b) { require(std::bit_cast<std::uint64_t>(a) == std::bit_cast<std::uint64_t>(b)); }
};

editor_contract::MutationState mutation(const Handle& object) {
  const auto* bytes = static_cast<const std::uint8_t*>(object.get());
  editor_contract::MutationState result;
  result.tracking = bytes[0x20];
  std::memcpy(&result.state_code, bytes + 0x24, sizeof(result.state_code));
  result.changed = bytes[0x28];
  return result;
}

class Native {
 public:
  explicit Native(const editor_probe::Library& library) : factory(library), library_(library) {}
  editor_probe::KeyframeFactories factory;

  const Handle& point(const Handle& frame, bool right) const {
    return editor_probe::entry<const Handle& (*)(void*)>(library_, right ? 0xc7e0d4 : 0xc7dff0)(frame.get());
  }
  void set_xy(const Handle& point_value, double x, double y) const {
    editor_probe::entry<void (*)(void*, const double&)>(library_, 0xc8ebac)(point_value.get(), x);
    editor_probe::entry<void (*)(void*, const double&)>(library_, 0xc8ebfc)(point_value.get(), y);
  }
  double coordinate(const Handle& point_value, bool y) const {
    return editor_probe::entry<const double& (*)(void*)>(library_, y ? 0xc8ebf4 : 0xc8eba4)(point_value.get());
  }
  void curve(const Handle& frame, std::int32_t value) const {
    editor_probe::entry<void (*)(void*, const std::int32_t&)>(library_, 0xc7df78)(frame.get(), value);
  }
  Handle array(const Handle& group) const {
    return editor_probe::entry<const Handle& (*)(void*)>(library_, 0xc84124)(group.get());
  }
  void track_insertions(const Handle& group, bool enabled) const {
    editor_probe::entry<void (*)(void*, bool)>(library_, 0xc86f7c)(array(group).get(), enabled);
  }
  void insert(const Handle& group, const Handle& frame) const {
    editor_probe::entry<void (*)(Handle, Handle)>(library_, 0x340bb70)(group, frame);
  }
  void repair(const Handle& left, const Handle& right) const {
    editor_probe::entry<void (*)(Handle, Handle)>(library_, 0x340d9c0)(left, right);
  }
  void clear_graph(const Handle& group, const std::string& id) const {
    editor_probe::entry<void (*)(const Handle&, const std::string&)>(library_, 0x3410fc4)(group, id);
  }
  const std::string& id(const Handle& frame) const {
    return *reinterpret_cast<const std::string*>(static_cast<const std::uint8_t*>(frame.get()) + 8);
  }
  CommonKeyframe snapshot(const Handle& frame, std::int32_t curve_value) const {
    CommonKeyframe result;
    result.id = id(frame);
    result.time_offset = factory.time(frame);
    result.curve_type = curve_value;
    result.mutation = mutation(frame);
    for (const bool right : {false, true}) {
      const auto& native_point = point(frame, right);
      if (!native_point) continue;
      auto copy = std::make_shared<creator_contract::KeyframeControl>();
      copy->x = coordinate(native_point, false);
      copy->y = coordinate(native_point, true);
      copy->mutation = mutation(native_point);
      (right ? result.right_control : result.left_control) = copy;
    }
    return result;
  }
  void compare(Counters& counts, const Handle& frame, const CommonKeyframe& expected) const {
    counts.require(mutation(frame) == expected.mutation);
    for (const bool right : {false, true}) {
      const auto& actual = point(frame, right);
      const auto& control = right ? expected.right_control : expected.left_control;
      counts.require(static_cast<bool>(actual) == static_cast<bool>(control));
      if (!actual) continue;
      counts.same(coordinate(actual, false), control->x);
      counts.same(coordinate(actual, true), control->y);
      counts.require(mutation(actual) == control->mutation);
    }
  }

 private:
  editor_probe::Library library_;
};

void insertion_cases(const Native& native, Counters& counts) {
  std::mt19937_64 random(0x496e73657274ULL);
  for (std::size_t test = 0; test < 1200; ++test) {
    auto group = native.factory.group();
    List objects;
    CommonKeyframeGroup own;
    for (std::size_t i = 0; i < test % 19; ++i) {
      auto object = native.factory.frame(static_cast<std::int64_t>(random() % 21) - 10, 0.5);
      objects.push_back(object);
      own.keyframes.push_back(std::make_shared<CommonKeyframe>(native.snapshot(object, 0)));
    }
    native.factory.set_list(group, objects);
    own.track_inserted_children = test % 2 != 0;
    native.track_insertions(group, own.track_inserted_children);
    own.list_mutation = mutation(native.array(group));
    const std::int64_t time = test % 9 == 0 ? std::numeric_limits<std::int64_t>::max() :
        test % 9 == 1 ? std::numeric_limits<std::int64_t>::min() : static_cast<std::int64_t>(random() % 31) - 15;
    auto added = native.factory.frame(time, 0.7);
    auto own_added = std::make_shared<CommonKeyframe>(native.snapshot(added, 0));
    creator_contract::insert_keyframe_ordered(own, own_added);
    native.insert(group, added);
    const auto& actual = native.factory.list(group);
    counts.require(actual.size() == own.keyframes.size());
    for (std::size_t i = 0; i < actual.size(); ++i) {
      counts.require(native.id(actual[i]) == own.keyframes[i]->id);
      counts.require(native.factory.time(actual[i]) == own.keyframes[i]->time_offset);
    }
    counts.require(mutation(added) == own_added->mutation);
    counts.require(mutation(native.array(group)) == own.list_mutation);
    native.clear_graph(group, native.id(added));
    creator_contract::clear_keyframe_graph(*own_added);
    counts.require(mutation(added) == own_added->mutation);
    ++counts.insertion_cases;
  }
}

void control_cases(const Native& native, Counters& counts) {
  const double nan = std::bit_cast<double>(std::uint64_t{0x7ff8000000001234});
  const std::array values{0.0, -0.0, 1.0, -1.0, 4000.0, -4000.0, 10000.0, -10000.0,
                          20000.0, -20000.0, nan, std::numeric_limits<double>::infinity(),
                          -std::numeric_limits<double>::infinity()};
  for (std::size_t test = 0; test < 3000; ++test) {
    const std::int64_t t0 = test % 7 == 0 ? std::numeric_limits<std::int64_t>::max() : 1000;
    const std::int64_t t1 = test % 7 == 0 ? std::numeric_limits<std::int64_t>::min() :
        test % 7 == 1 ? -9000 : test % 7 == 2 ? 1000 : 11000;
    auto left = native.factory.frame(t0, 1);
    auto right = native.factory.frame(t1, 2);
    const auto left_curve = static_cast<std::int32_t>(test % 4);
    const auto right_curve = static_cast<std::int32_t>((test / 4) % 4);
    native.curve(left, left_curve);
    native.curve(right, right_curve);
    native.set_xy(native.point(left, true), values[test % values.size()], 7);
    native.set_xy(native.point(right, false), values[(test / values.size()) % values.size()], 8);
    auto own_left = native.snapshot(left, left_curve);
    auto own_right = native.snapshot(right, right_curve);
    native.repair(left, right);
    creator_contract::repair_control_pair(&own_left, &own_right);
    native.compare(counts, left, own_left);
    native.compare(counts, right, own_right);
    ++counts.control_cases;
  }
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::invalid_argument("Usage: creator-native-insertion /absolute/libvideoeditor.dylib");
      Counters counts;
      {
        editor_probe::NativeOutputScope quiet;
        const auto library = editor_probe::load_verified(argv[1]);
        const Native native(library);
        insertion_cases(native, counts);
        control_cases(native, counts);
      }
      const std::string report = "{\"insertion_cases\":" + std::to_string(counts.insertion_cases) +
          ",\"control_cases\":" + std::to_string(counts.control_cases) + ",\"values_compared\":" +
          std::to_string(counts.values) + ",\"mismatches\":0}\n";
      std::cout << report;
      return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
  }
}
