#include "native_record_support.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <iostream>

namespace {
using namespace creator_record_probe;
using creator_record_probe::Handle;

void frame_cases(const Native& native, Checks& checks) {
  for (std::size_t test = 0; test < 2048; ++test) {
    auto source = native.frame(test);
    auto destination = test % 11 == 0 ? source : native.frame(test + 99);
    Snapshot model(native);
    auto from = model.frame(source);
    auto to = model.frame(destination);
    NodeMap index;
    if (test % 13 == 0) {
      native.restore_frame(destination, index, {});
      restore_frame_from(*to, nullptr);
    } else {
      native.restore_frame(destination, index, source);
      restore_frame_from(*to, from.get());
    }
    Compare compare{native, checks, {}, {}};
    compare.frame(destination, to);
    compare.frame(source, from);
    checks.require(index.empty(), "Frame restore unexpectedly changes index");
    ++checks.cases;
  }
}

void copy_cases(const Native& native, Checks& checks) {
  for (std::size_t test = 0; test < 1024; ++test) {
    auto source = native.frame(test);
    Snapshot model(native);
    auto from = model.frame(source);
    NodeMap index;
    auto copied = native.copy_frame(source, index);
    auto own = restore_frame_copy(*from);
    Compare compare{native, checks, {}, {}};
    compare.frame(source, from);
    compare.frame(copied, own);
    checks.require(index.empty(), "Restore copy unexpectedly changes index");
    // A replacement setter must detach the shared value storage from the source snapshot.
    native.factory.set_values(copied, {42.5, -0.0});
    auto source_for_values = *own;
    source_for_values.values = std::make_shared<std::vector<double>>(std::initializer_list<double>{42.5, -0.0});
    restore_frame_from(*own, &source_for_values);
    Compare after{native, checks, {}, {}};
    after.frame(source, from);
    // Only values are compared here: restore_frame_from also visits NaN controls.
    const auto& values = native.factory.values(copied);
    checks.require(values.size() == own->values->size(), "Detached value length differs");
    for (std::size_t i = 0; i < values.size(); ++i) checks.bits(values[i], (*own->values)[i]);
    checks.require(Native::values_owner(copied).get() != Native::values_owner(source).get(), "Native values failed to detach");
    checks.require(own->values != from->values, "Independent values failed to detach");
    ++checks.cases;
  }
}

void group_cases(const Native& native, Checks& checks) {
  for (std::size_t test = 0; test < 768; ++test) {
    auto destination = native.factory.group();
    auto source = native.factory.group();
    std::vector<Handle> live, history;
    NodeMap empty;
    for (std::size_t item = 0; item < 4; ++item) {
      live.push_back(native.frame(test * 4 + item));
      history.push_back(native.copy_frame(live.back(), empty));
      native.factory.set_values(history.back(), {static_cast<double>(item), .13 * static_cast<double>(test % 9)});
    }
    if (test % 3 == 0) history.push_back(history.front());
    if (test % 5 == 0) history.erase(history.begin() + 1);
    if (test % 7 == 0) history.push_back(native.frame(test + 10000));
    if (test % 11 == 0) history.clear();
    if (test % 13 == 0) live.push_back(live.front());
    if (test % 17 == 0) live.clear();
    if (test % 2 == 0) native.factory.set_list(destination, {native.frame(test + 20000)});
    if (test % 3 == 0) native.factory.set_list(source, {native.frame(test + 30000)});
    native.factory.set_list(destination, live);
    native.factory.set_list(source, history);
    native.set_group_text(source, false, std::string(test % 41, 'm'));
    native.set_group_text(source, true, test % 3 == 0 ? std::string("p\0v", 3) : "property");
    native.track(destination, test % 2 != 0);
    native.track(native.array(destination), test % 3 != 0);
    native.track_children(native.array(destination), test % 2 != 0);
    if (test % 4 == 0) native.reset_group(destination);
    if (test % 19 == 0) source = destination;
    Snapshot model(native);
    auto own_destination = model.group(destination);
    auto own_source = model.group(source);
    NodeMap index;
    RecordFrameIndex owned_index;
    std::deque<std::string> stable_keys;
    for (std::size_t item = 0; item < live.size(); ++item) {
      if ((item + test) % 4 == 0) continue;
      stable_keys.push_back(Native::id(live[item]));
      const bool null_entry = (item + test) % 5 == 0;
      const bool wrong_type = (item + test) % 7 == 0;
      const auto value = null_entry ? Handle{} : wrong_type ? destination : live[item];
      index.emplace(stable_keys.back(), std::shared_ptr<lvve::Node>(value, static_cast<lvve::Node*>(value.get())));
      owned_index.emplace(stable_keys.back(), null_entry || wrong_type ? nullptr : model.frame(live[item]));
    }
    const auto index_size = index.size();
    native.restore_group(destination, index, source);
    const auto clocks = restore_group_from(own_destination, &own_source, owned_index);
    checks.require(clocks >= 1, "List restore must write its clock");
    Compare compare{native, checks, {}, {}};
    compare.group(destination, own_destination);
    compare.group(source, source == destination ? own_destination : own_source);
    for (const auto& frame : live) compare.frame(frame, model.frames.at(frame.get()));
    checks.require(index.size() == index_size, "List restore unexpectedly inserts into index");
    ++checks.cases;
  }
}

void lifetime_cases(const Native& native, Checks& checks) {
  for (bool indexed : {false, true}) {
    auto destination = native.factory.group();
    auto source = native.factory.group();
    auto live = native.frame(42);
    NodeMap index;
    auto history = native.copy_frame(live, index);
    native.factory.set_list(destination, {live});
    native.factory.set_list(source, {history});
    const std::string stable_key = Native::id(live);
    if (indexed) index.emplace(stable_key, std::shared_ptr<lvve::Node>(live, static_cast<lvve::Node*>(live.get())));
    std::weak_ptr<void> old = live;
    std::weak_ptr<void> old_point = native.point(live, false);
    std::weak_ptr<std::vector<double>> old_values = Native::values_owner(live);
    live.reset();
    native.restore_group(destination, index, source);
    checks.require(old.expired() == !indexed, "Replaced same-ID object lifetime differs");
    checks.require(old_point.expired() == !indexed, "Old control lifetime differs");
    checks.require(!old_values.expired(), "Shared values prematurely freed");
    index.clear();
    history.reset();
    source.reset();
    checks.require(!old_values.expired(), "Restored live values must outlive history");
    destination.reset();
    checks.require(old.expired() && old_point.expired() && old_values.expired(), "Restore reference leak");
    ++checks.cases;
  }
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    try {
      if (argc != 2) throw std::invalid_argument("Usage: creator-native-record /absolute/libvideoeditor.dylib");
      creator_record_probe::Checks checks;
      {
        editor_probe::NativeOutputScope quiet;
        const creator_record_probe::Native native(editor_probe::load_verified(argv[1]));
        frame_cases(native, checks);
        copy_cases(native, checks);
        group_cases(native, checks);
        lifetime_cases(native, checks);
      }
      std::cout << "{\"frame_restore_cases\":2048,\"copy_cases\":1024,\"group_cases\":768,"
                   "\"lifetime_cases\":2,\"total_cases\":" << checks.cases << ",\"comparisons\":"
                << checks.compared << ",\"mismatches\":0}\n";
      return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
  }
}
