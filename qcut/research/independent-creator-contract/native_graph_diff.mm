#include "native_graph_diff_support.hpp"
#include "../independent-editor-contract/native_output.hpp"

#include <iostream>

namespace {
using namespace creator_record_probe;
using creator_record_probe::Handle;

void add_tree(TreeMap& map, const Handle& source, TreeSnapshot& snapshot, unsigned mode) {
  const auto array = snapshot.native.graph_array(source);
  if (mode % 4 != 0) map.add(Native::id(source), mode % 4 == 1 ? Handle{} : mode % 4 == 2 ? array : source, snapshot, mode % 4 == 2 ? 1 : 0);
  if (mode % 5 != 0) map.add(Native::id(array), array, snapshot, 1);
  for (const auto& child : Native::list(array)) {
    map.add(Native::id(child), child, snapshot, 2);
    const auto coordinate = snapshot.native.coordinate(child);
    map.add(Native::id(coordinate), coordinate, snapshot, 3);
  }
}

void stash_cases(const TreeNative& native, Checks& checks) {
  for (std::size_t test = 0; test < 1024; ++test) {
    auto current = native.fixture(test);
    auto previous = native.deep(current);
    native.reset_graph(current);
    if (test % 2 != 0) native.metadata(current, test + 123);
    auto children = Native::list(native.graph_array(current));
    if (!children.empty() && test % 3 == 0) native.coordinate_value(children[0], false, .625);
    if (test % 5 == 0 && !children.empty()) children.push_back(children[0]);
    if (test % 7 == 0 && !children.empty()) children.erase(children.begin());
    if (test % 11 == 0) children.clear();
    native.set_points(current, children);
    if (test % 13 == 0) previous = current;
    TreeSnapshot snapshot(native);
    const auto own_current = snapshot.tree(current), own_previous = snapshot.tree(previous);
    TreeMap history, escape;
    add_tree(history, previous, snapshot, static_cast<unsigned>(test % 20));
    bool changed = test % 17 == 0, own_changed = changed, escaped = test % 2 == 0;
    const bool original_escaped = escaped;
    const bool array_mode = test % 2 == 0;
    const auto actual = native.stash_tree(array_mode ? native.graph_array(current) : current,
        history.native, changed, escape.native, escaped, array_mode);
    const auto expected_tree = array_mode ? nullptr : stash_graph_tree(*own_current, history.own, own_changed);
    const auto expected_array = array_mode ? stash_graph_array(*own_current->points, history.own, own_changed) : nullptr;
    checks.require(static_cast<bool>(actual) == static_cast<bool>(array_mode ? static_cast<void*>(expected_array.get()) : expected_tree.get()), "Tree stash selection differs");
    checks.require(changed == own_changed && escaped == original_escaped, "Tree stash flags differ");
    TreeCompare comparison(native, checks);
    comparison.tree(current, own_current); comparison.tree(previous, own_previous);
    if (actual) {
      if (array_mode) comparison.array(actual, expected_array);
      else comparison.tree(actual, expected_tree);
    }
    history.compare(comparison); escape.compare(comparison);
    ++checks.cases;
  }
}

void add_parallel(TreeMap& map, const Handle& key_tree, const Handle& value_tree,
                  TreeSnapshot& snapshot, std::size_t mode, bool full) {
  const auto& native = snapshot.native;
  const auto key_array = native.graph_array(key_tree), value_array = native.graph_array(value_tree);
  auto add = [&](const Handle& key, const Handle& value, unsigned level, std::size_t index) {
    const auto branch = full ? 3U : static_cast<unsigned>((mode + index) % 11);
    if (branch == 0) return;
    if (branch == 1) map.add(Native::id(key), {}, snapshot, level);
    else if (branch == 2) map.add(Native::id(key), level == 1 ? value_tree : value_array, snapshot, level == 1 ? 0U : 1U);
    else map.add(Native::id(key), value, snapshot, level);
  };
  add(key_tree, value_tree, 0, 0); add(key_array, value_array, 1, 1);
  const auto& keys = Native::list(key_array);
  const auto& values = Native::list(value_array);
  if (keys.size() != values.size()) throw std::runtime_error("Parallel tree fixture shape differs");
  for (std::size_t i = 0; i < keys.size(); ++i) {
    add(keys[i], values[i], 2, i + 2);
    add(native.coordinate(keys[i]), native.coordinate(values[i]), 3, i + 5);
  }
}

void diff_cases(const TreeNative& native, Checks& checks) {
  for (std::size_t test = 0; test < 4096; ++test) {
    auto current = native.fixture(test * 6 + 5);
    auto before = native.deep(current), after = native.deep(current), replacement = native.deep(current);
    if (test % 2 == 0) native.metadata(after, test + 301);
    const auto children = Native::list(native.graph_array(after));
    for (std::size_t i = 0; i < children.size(); ++i) {
      if (test % 3 == 0) native.point_type(children[i], static_cast<std::int32_t>(test) - 99);
      native.coordinate_value(children[i], false, test % 7 == 0 ? -0.0 : static_cast<double>(test));
      if (test % 5 == 0) native.coordinate_value(children[i], true, std::bit_cast<double>(std::uint64_t{0x7ff8000000008888}));
    }
    if (test % 13 == 0) after = before;
    if (test % 17 == 0) before = current;
    if (test % 19 == 0) after = current;
    TreeSnapshot snapshot(native);
    const auto own_current = snapshot.tree(current), own_before = snapshot.tree(before);
    const auto own_after = snapshot.tree(after), own_replacement = snapshot.tree(replacement);
    TreeMap before_map, after_map, replace_map, shared_map;
    add_parallel(before_map, current, before, snapshot, test / 4, false);
    add_parallel(after_map, current, after, snapshot, test / 44, false);
    if (test % 5 != 0) add_parallel(replace_map, current, replacement, snapshot, 0, true);
    if (test % 7 != 0) add_parallel(shared_map, current, test % 3 == 0 ? before : current, snapshot, 0, true);
    const unsigned level = static_cast<unsigned>(test % 4);
    const auto array = native.graph_array(current);
    const auto child = Native::list(array).front();
    const Handle node = level == 0 ? current : level == 1 ? array : level == 2 ? child : native.coordinate(child);
    const auto owned = snapshot.entry(node, level);
    bool replaced = test % 23 == 0, own_replaced = replaced, enabled = (test / 4) % 2 == 0, own_enabled = enabled;
    native.diff(node, before_map.native, after_map.native, replace_map.native, shared_map.native, replaced, enabled, level);
    const GraphDiffRequest request{before_map.own, after_map.own, replace_map.own, shared_map.own, own_replaced, own_enabled};
    if (level == 0) restore_graph_tree_diff(*own_current, request);
    if (level == 1) restore_graph_array_diff(*own_current->points, request);
    if (level == 2) restore_graph_point_diff(*std::get<std::shared_ptr<RecordGraphPoint>>(owned), request);
    if (level == 3) restore_coordinate_diff(*std::get<std::shared_ptr<RecordPoint>>(owned), request);
    checks.require(replaced == own_replaced && enabled == own_enabled, "Diff boolean outputs differ");
    TreeCompare comparison(native, checks);
    comparison.tree(current, own_current); comparison.tree(before, own_before);
    comparison.tree(after, own_after); comparison.tree(replacement, own_replacement);
    before_map.compare(comparison); after_map.compare(comparison);
    replace_map.compare(comparison); shared_map.compare(comparison);
    ++checks.cases;
  }
}

void controlled_array_cases(const TreeNative& native, Checks& checks) {
  std::size_t no_snapshot = 0, snapshots = 0, suppressed = 0;
  for (std::size_t test = 0; test < 512; ++test) {
    const auto source_tree = native.fixture(test * 6 + 2);
    const auto source_points = Native::list(native.graph_array(source_tree));
    auto current = native.array_factory("owned-array-" + std::to_string(test), test % 2 == 0, test % 4 < 2);
    native.set_array(current, source_points);
    native.reset_array(current);
    auto previous = native.deep(current, true);
    auto points = Native::list(current);
    if (test % 8 == 0) native.coordinate_value(points.front(), false, .8125);
    if (test % 8 == 1) native.point_type(points.front(), 345);
    if (test % 8 == 2) { std::reverse(points.begin(), points.end()); native.set_array(current, points); }
    if (test % 8 == 3) { points.pop_back(); native.set_array(current, points); }
    if (test % 8 == 4) { points.push_back(points.front()); native.set_array(current, points); }
    if (test % 8 == 5) native.track(current, true);
    if (test % 8 == 6) native.set_array(current, {});
    TreeSnapshot snapshot(native);
    const auto owned = snapshot.array(current), prior = snapshot.array(previous);
    TreeMap history, escape;
    if (test % 16 != 0) history.add(Native::id(current), previous, snapshot, 1);
    for (const auto& child : Native::list(previous)) {
      history.add(Native::id(child), child, snapshot, 2);
      history.add(Native::id(native.coordinate(child)), native.coordinate(child), snapshot, 3);
    }
    bool changed = false, own_changed = false, escaped = test % 2 == 0;
    const bool original_escaped = escaped;
    auto actual = native.stash_tree(current, history.native, changed, escape.native, escaped, true);
    auto expected = stash_graph_array(*owned, history.own, own_changed);
    checks.require(static_cast<bool>(actual) == static_cast<bool>(expected), "Controlled array stash selection differs");
    checks.require(changed == own_changed && escaped == original_escaped, "Controlled array flags differ");
    actual ? ++snapshots : ++no_snapshot;
    if (actual && !changed) ++suppressed;
    TreeCompare comparison(native, checks);
    comparison.array(current, owned); comparison.array(previous, prior);
    if (actual) comparison.array(actual, expected);
    history.compare(comparison); escape.compare(comparison);
    ++checks.cases;
  }
  checks.require(no_snapshot > 0 && snapshots > 0 && suppressed > 0, "Missing required array stash branches");
}

void identifier_cases(const TreeNative& native, Checks& checks) {
  for (std::size_t test = 0; test < 256; ++test) {
    auto current = native.fixture(1), before = native.fixture(13), after = native.fixture(19);
    native.reset_graph(current);
    TreeSnapshot snapshot(native);
    const auto own_current = snapshot.tree(current), own_before = snapshot.tree(before), own_after = snapshot.tree(after);
    TreeMap first, last, replacements, shared;
    add_parallel(first, current, before, snapshot, 0, true);
    add_parallel(last, current, after, snapshot, 0, true);
    const unsigned level = static_cast<unsigned>(test % 4);
    const auto array = native.graph_array(current), child = Native::list(array).front();
    const Handle selected = level == 0 ? current : level == 1 ? array : level == 2 ? child : native.coordinate(child);
    const auto owned = snapshot.entry(selected, level);
    bool changed = test % 5 == 0, own_changed = changed, enabled = false, own_enabled = false;
    auto& actual_last = test % 8 < 4 ? first.native : last.native;
    auto& own_last = test % 8 < 4 ? first.own : last.own;
    native.diff(selected, first.native, actual_last, replacements.native, shared.native, changed, enabled, level);
    const GraphDiffRequest request{first.own, own_last, replacements.own, shared.own, own_changed, own_enabled};
    if (level == 0) restore_graph_tree_diff(*own_current, request);
    if (level == 1) restore_graph_array_diff(*own_current->points, request);
    if (level == 2) restore_graph_point_diff(*std::get<std::shared_ptr<RecordGraphPoint>>(owned), request);
    if (level == 3) restore_coordinate_diff(*std::get<std::shared_ptr<RecordPoint>>(owned), request);
    checks.require(changed == own_changed && enabled == own_enabled, "Renamed diff flags differ");
    TreeCompare comparison(native, checks);
    comparison.tree(current, own_current); comparison.tree(before, own_before); comparison.tree(after, own_after);
    first.compare(comparison); last.compare(comparison); replacements.compare(comparison); shared.compare(comparison);
    ++checks.cases;
  }
}

void lifetime_cases(const TreeNative& native, Checks& checks) {
  {
    auto current = native.fixture(1), previous = native.deep(current);
    native.reset_graph(current);
    native.metadata(current, 302);
    const std::weak_ptr<void> previous_array = native.graph_array(previous);
    TreeSnapshot snapshot(native);
    TreeMap history, escape;
    add_parallel(history, current, previous, snapshot, 0, true);
    bool changed = false, escaped = false;
    auto result = native.stash_tree(current, history.native, changed, escape.native, escaped);
    checks.require(result && changed && native.graph_array(result) == native.graph_array(previous), "Metadata stash must share historical array");
    history.native.clear(); previous.reset();
    checks.require(!previous_array.expired(), "Returned stash retains historical child owner");
    result.reset();
    checks.require(previous_array.expired(), "Deleting stash releases final historical child owner");
    ++checks.cases;
  }
  {
    auto current = native.fixture(1), before = native.deep(current), after = native.deep(current);
    auto replacement = native.deep(current);
    const auto current_point = Native::list(native.graph_array(current)).front();
    const std::weak_ptr<void> old_coordinate = native.coordinate(current_point);
    const std::weak_ptr<void> new_coordinate = native.coordinate(Native::list(native.graph_array(replacement)).front());
    TreeSnapshot snapshot(native);
    TreeMap first, last, replacements, shared;
    add_parallel(first, current, before, snapshot, 0, true); add_parallel(last, current, after, snapshot, 0, true);
    add_parallel(replacements, current, replacement, snapshot, 0, true); add_parallel(shared, current, current, snapshot, 0, true);
    bool changed = false, enabled = true;
    native.diff(current_point, first.native, last.native, replacements.native, shared.native, changed, enabled, 2);
    checks.require(changed && !old_coordinate.expired(), "Shared map keeps replaced old coordinate alive");
    shared.native.clear();
    checks.require(old_coordinate.expired(), "Clearing shared map releases final old coordinate");
    replacements.native.clear(); replacement.reset();
    checks.require(!new_coordinate.expired(), "Live graph point retains replacement coordinate");
    ++checks.cases;
  }
}
}

int main(int argc, char** argv) {
  @autoreleasepool {
    Checks checks;
    try {
      if (argc != 2) throw std::invalid_argument("Usage: creator-native-graph-diff /absolute/libvideoeditor.dylib");
      {
        editor_probe::NativeOutputScope quiet;
        const auto library = editor_probe::load_verified(argv[1]);
        const TreeNative native(library);
        stash_cases(native, checks);
        diff_cases(native, checks);
        controlled_array_cases(native, checks);
        identifier_cases(native, checks);
        lifetime_cases(native, checks);
      }
      std::cout << "{\"passed\":true,\"cases\":" << checks.cases << ",\"comparisons\":" << checks.compared << ",\"mismatches\":0}\n";
      return 0;
    } catch (const std::exception& error) {
      std::cerr << error.what() << '\n';
      std::cout << "{\"passed\":false,\"cases\":" << checks.cases << ",\"comparisons\":" << checks.compared << "}\n";
      return 1;
    }
  }
}
