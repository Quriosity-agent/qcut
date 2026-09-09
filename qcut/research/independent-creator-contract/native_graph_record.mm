#include "native_graph_record_support.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <iostream>

namespace {
using namespace creator_record_probe;
using creator_record_probe::Handle;

void graph_cases(const GraphNative& native, Checks& checks) {
  for (std::size_t test = 0; test < 1536; ++test) {
    NodeMap empty;
    auto current = native.fixture(test);
    auto source = native.copy(current, empty, true);
    native.metadata(source, test + 1);
    auto points = Native::list(native.graph_array(source));
    if (!points.empty()) {
      native.coordinate_value(points[0], false, test % 2 ? -.75 : 0.0);
      native.point_type(points[0], static_cast<std::int32_t>(test));
      if (test % 2 == 0) points.push_back(points.front());
      if (test % 3 == 0) points.erase(points.begin());
    }
    if (test % 5 == 0) points.clear();
    native.set_points(source, points);
    if (test % 17 == 0) source = current;
    Snapshot snapshot(native);
    auto own_current = snapshot.graph(current);
    auto own_source = snapshot.graph(source);
    NodeMap index;
    RecordGraphPointIndex own_index;
    std::deque<std::string> keys;
    const auto live = Native::list(native.graph_array(current));
    for (std::size_t i = 0; i < live.size(); ++i) {
      if ((test + i) % 4 == 0) continue;
      keys.push_back(Native::id(live[i]));
      const bool null_value = (test + i) % 5 == 0;
      const bool wrong_type = (test + i) % 7 == 0;
      Handle entry = null_value ? Handle{} : wrong_type ? native.coordinate(live[i]) : live[i];
      index[keys.back()] = std::shared_ptr<lvve::Node>(entry, static_cast<lvve::Node*>(entry.get()));
      own_index[keys.back()] = null_value || wrong_type ? nullptr : snapshot.graph_point(live[i]);
    }
    const auto index_size = index.size();
    if (test % 2 == 0) {
      auto copied = native.copy(source, index, true);
      auto own_copy = restore_graph_copy(*own_source, own_index);
      Compare comparison{native, checks, {}, {}};
      comparison.graph(source, own_source);
      comparison.graph(current, own_current);
      comparison.graph(copied, own_copy);
    } else {
      native.restore(current, index, test % 19 == 0 ? Handle{} : source, true);
      restore_graph_from(*own_current, test % 19 == 0 ? nullptr : own_source.get(), own_index);
      Compare comparison{native, checks, {}, {}};
      comparison.graph(source, own_source);
      comparison.graph(current, own_current);
    }
    checks.require(index.size() == index_size, "Graph restore changed ID index");
    ++checks.cases;
  }
}

void frame_graph_cases(const GraphNative& native, Checks& checks) {
  for (std::size_t test = 0; test < 1024; ++test) {
    auto current = native.frame(test);
    auto source = native.frame(test + 5);
    if (test % 4 < 2) native.graphs.attach(current, native.fixture(test));
    if (test % 4 != 0) native.graphs.attach(source, native.fixture(test + 19));
    if (test % 17 == 0 && native.graph(current)) native.graphs.attach(source, native.graph(current));
    if (test % 13 == 0) source = current;
    Snapshot snapshot(native);
    auto own_current = snapshot.frame(current);
    auto own_source = snapshot.frame(source);
    NodeMap index;
    if (test % 3 == 0) {
      const auto copy = native.copy_frame(source, index);
      const auto own_copy = restore_frame_copy(*own_source);
      Compare comparison{native, checks, {}, {}};
      comparison.frame(source, own_source);
      comparison.frame(copy, own_copy);
    } else {
      native.restore_frame(current, index, source);
      restore_frame_from(*own_current, own_source.get());
      Compare comparison{native, checks, {}, {}};
      comparison.frame(source, own_source);
      comparison.frame(current, own_current);
    }
    checks.require(index.empty(), "Frame graph restore changed ID index");
    ++checks.cases;
  }
}

void group_copy_cases(const GraphNative& native, Checks& checks) {
  for (std::size_t test = 0; test < 512; ++test) {
    auto group = native.factory.group();
    auto live = native.frame(test);
    native.graphs.attach(live, native.fixture(test + 5));
    native.factory.set_list(group, {native.frame(test + 3000)});
    native.factory.set_list(group, test % 11 == 0 ? List{} : List{live, live});
    native.track(group, test % 2 != 0);
    native.track(native.array(group), test % 3 != 0);
    native.track_children(native.array(group), test % 5 != 0);
    if (test % 7 == 0) native.reset_group(group);
    Snapshot snapshot(native);
    auto own_group = snapshot.group(group);
    NodeMap index;
    RecordFrameIndex own_index;
    const std::string key = Native::id(live);
    if (test % 3 != 0) {
      Handle entry = test % 3 == 1 ? live : Handle{};
      index[key] = std::shared_ptr<lvve::Node>(entry, static_cast<lvve::Node*>(entry.get()));
      own_index[key] = entry ? snapshot.frame(live) : nullptr;
    }
    auto copied = native.copy_group(group, index);
    auto own_copy = restore_group_copy(own_group, own_index);
    Compare comparison{native, checks, {}, {}};
    comparison.group(group, own_group);
    comparison.group(copied, *own_copy);
    ++checks.cases;
  }
}

void stash_cases(const GraphNative& native, Checks& checks) {
  for (std::size_t test = 0; test < 1536; ++test) {
    auto current_graph = native.fixture(test * 6 + 1);
    auto previous_graph = native.fixture(test * 6 + 7);
    auto current = Native::list(native.graph_array(current_graph)).front();
    auto previous = Native::list(native.graph_array(previous_graph)).front();
    native.track(current, test % 2 != 0);
    native.track(previous, test % 2 == 0);
    if (test % 3 == 0) native.reset_point(current);
    if (test % 4 == 0) native.point_type(current, Native::integer(previous, 0x2c));
    if (test % 5 == 0) native.coordinate_value(current, false, .125);
    if (test % 7 == 0) native.alias_coordinates(current, previous);
    if (test % 11 == 0) native.reset_point(current);
    Snapshot snapshot(native);
    auto own_current = snapshot.graph_point(current);
    auto own_previous = snapshot.graph_point(previous);
    const std::string point_key = Native::id(current);
    const std::string coordinate_key = Native::id(native.coordinate(current));
    NodeMap history, escape;
    RecordStashIndex own_history;
    auto add = [&](const std::string& key, const Handle& value) {
      history[key] = std::shared_ptr<lvve::Node>(value, static_cast<lvve::Node*>(value.get()));
    };
    if (test % 4 != 0) {
      const Handle value = test % 4 == 1 ? Handle{} : test % 4 == 2 ? native.coordinate(previous) : previous;
      add(point_key, value);
      own_history.graph_points[point_key] = test % 4 == 3 ? own_previous : nullptr;
    }
    if ((test / 4) % 4 != 0) {
      const Handle value = (test / 4) % 4 == 1 ? Handle{} : (test / 4) % 4 == 2 ? previous : native.coordinate(previous);
      add(coordinate_key, value);
      own_history.coordinates[coordinate_key] = (test / 4) % 4 == 3 ? own_previous->point : nullptr;
    }
    if (test % 2 == 0) escape = history;
    bool changed = test % 13 == 0;
    bool own_changed = changed;
    bool escaped = test % 2 == 0;
    const bool original_escaped = escaped;
    const auto size = history.size();
    auto actual = native.stash(current, history, changed, escape, escaped);
    auto expected = stash_graph_point(*own_current, own_history, own_changed);
    checks.require(static_cast<bool>(actual) == static_cast<bool>(expected), "Stash replacement selection differs");
    checks.require(changed == own_changed, "Stash changed flag differs");
    checks.require(escaped == original_escaped, "Graph-point stash unexpectedly changes escape flag");
    checks.require(history.size() == size, "Stash changes history map");
    Compare comparison{native, checks, {}, {}};
    comparison.graph_point(current, own_current);
    comparison.graph_point(previous, own_previous);
    if (actual) comparison.graph_point(actual, expected);
    ++checks.cases;
  }
}

void lifetime_cases(const GraphNative& native, Checks& checks) {
  {
    auto source = native.fixture(1);
    native.reset_graph(source);
    const std::weak_ptr<void> graph_weak = source;
    const std::weak_ptr<void> point_weak = Native::list(native.graph_array(source)).front();
    const std::weak_ptr<void> coordinate_weak = native.coordinate(Native::list(native.graph_array(source)).front());
    NodeMap index;
    auto copy = native.copy(source, index, true);
    source.reset();
    checks.require(graph_weak.expired() && point_weak.expired() && coordinate_weak.expired(),
                   "Independent graph copy retained source active subtree");
    const std::weak_ptr<void> copy_weak = copy;
    const std::weak_ptr<void> copied_coordinate = native.coordinate(Native::list(native.graph_array(copy)).front());
    copy.reset();
    checks.require(copy_weak.expired() && copied_coordinate.expired(), "SDK deleting destructor did not release copied graph subtree");
    ++checks.cases;
  }
  {
    auto current_graph = native.fixture(1);
    auto previous_graph = native.fixture(7);
    auto current = Native::list(native.graph_array(current_graph)).front();
    auto previous = Native::list(native.graph_array(previous_graph)).front();
    native.reset_point(current);
    native.point_type(current, Native::integer(previous, 0x2c) + 1);
    const std::weak_ptr<void> historical_coordinate = native.coordinate(previous);
    const std::string current_id = Native::id(current);
    const std::string point_id = Native::id(native.coordinate(current));
    NodeMap history;
    history[current_id] = std::shared_ptr<lvve::Node>(previous, static_cast<lvve::Node*>(previous.get()));
    auto prior_coordinate = native.coordinate(previous);
    history[point_id] = std::shared_ptr<lvve::Node>(prior_coordinate, static_cast<lvve::Node*>(prior_coordinate.get()));
    bool changed = false, escaped = false;
    auto snapshot = native.stash(current, history, changed, {}, escaped);
    checks.require(snapshot && native.coordinate(snapshot).get() == prior_coordinate.get(), "Type-only stash must share historical coordinate");
    history.clear(); previous.reset(); previous_graph.reset(); prior_coordinate.reset();
    checks.require(!historical_coordinate.expired(), "Stash must retain historical coordinate lifetime");
    const std::weak_ptr<void> snapshot_weak = snapshot;
    snapshot.reset();
    checks.require(snapshot_weak.expired() && historical_coordinate.expired(), "Stash deleting destructor did not release historical coordinate");
    ++checks.cases;
  }
}

void controlled_stash_cases(const GraphNative& native, Checks& checks) {
  std::size_t null_results = 0, replacement_results = 0;
  for (std::size_t test = 0; test < 128; ++test) {
    auto graph = native.fixture(test * 6 + 1);
    auto current = Native::list(native.graph_array(graph)).front();
    NodeMap empty;
    auto prior = native.copy(current, empty, false);
    native.track(current, test % 2 != 0);
    native.track(prior, test % 2 == 0);
    native.reset_point(current);
    native.reset_point(prior);
    native.coordinate_value(prior, false, 2.25);
    if (test & 1U) native.point_type(current, Native::integer(prior, 0x2c) + 1);
    if (test & 2U) native.coordinate_value(current, true, -.125);
    if (test & 4U) {
      const auto type = Native::integer(current, 0x2c);
      native.point_type(current, type + 1);
      native.point_type(current, type);
    }
    Snapshot snapshot(native);
    auto own_current = snapshot.graph_point(current), own_prior = snapshot.graph_point(prior);
    const std::string point_key = Native::id(current), coordinate_key = Native::id(native.coordinate(current));
    NodeMap history;
    RecordStashIndex own_history;
    if (!(test & 32U)) {
      history[point_key] = std::shared_ptr<lvve::Node>(prior, static_cast<lvve::Node*>(prior.get()));
      own_history.graph_points[point_key] = own_prior;
    }
    if (!(test & 16U)) {
      auto coordinate = native.coordinate(prior);
      history[coordinate_key] = std::shared_ptr<lvve::Node>(coordinate, static_cast<lvve::Node*>(coordinate.get()));
      own_history.coordinates[coordinate_key] = own_prior->point;
    }
    bool changed = (test & 8U) != 0, expected_changed = changed;
    bool escaped = (test & 64U) != 0;
    const bool original_escape = escaped;
    auto actual = native.stash(current, history, changed, {}, escaped);
    auto expected = stash_graph_point(*own_current, own_history, expected_changed);
    if (actual) ++replacement_results;
    else ++null_results;
    checks.require(static_cast<bool>(actual) == static_cast<bool>(expected), "Controlled stash replacement selection differs");
    checks.require(changed == expected_changed && escaped == original_escape, "Controlled stash flags differ");
    Compare comparison{native, checks, {}, {}};
    comparison.graph_point(current, own_current);
    comparison.graph_point(prior, own_prior);
    if (actual) comparison.graph_point(actual, expected);
    ++checks.cases;
  }
  checks.require(null_results == 4 && replacement_results == 124, "Controlled stash branch coverage differs");
}
}  // namespace

int main(int argc, char** argv) {
  @autoreleasepool {
    Checks checks;
    try {
      if (argc != 2) throw std::invalid_argument("Usage: creator-native-graph-record /absolute/libvideoeditor.dylib");
      {
        editor_probe::NativeOutputScope quiet;
        const auto library = editor_probe::load_verified(argv[1]);
        GraphNative native(library);
        graph_cases(native, checks);
        frame_graph_cases(native, checks);
        group_copy_cases(native, checks);
        stash_cases(native, checks);
        controlled_stash_cases(native, checks);
        lifetime_cases(native, checks);
      }
      std::cout << "{\"passed\":true,\"cases\":" << checks.cases << ",\"comparisons\":" << checks.compared
                << ",\"mismatches\":0}\n";
      return 0;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      std::cout << "{\"passed\":false,\"cases\":" << checks.cases << ",\"comparisons\":" << checks.compared << "}\n";
      return 1;
    }
  }
}
