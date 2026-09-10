#include "keyframe_stash.hpp"
#include "test_support.hpp"

#include <bit>
#include <limits>

namespace {
using namespace creator_contract;

constexpr double kInfinity = std::numeric_limits<double>::infinity();
const double kQuietNan = std::bit_cast<double>(std::uint64_t{0x7ff8000000004321});
const double kOtherNan = std::bit_cast<double>(std::uint64_t{0xfff8000000009876});

std::shared_ptr<RecordPoint> control(const std::string& id, double x = .25, double y = -.5) {
  return std::make_shared<RecordPoint>(RecordPoint{id, x, y, {1, 2, 0}});
}

std::shared_ptr<StashFrame> frame(const std::string& id, std::vector<double> values = {.5, -.25}) {
  auto result = std::make_shared<StashFrame>();
  result->id = id;
  result->curve_type = 3;
  result->time_offset = -700;
  result->left = control(id + "-l");
  result->right = control(id + "-r", -.75, .125);
  result->values = std::make_shared<std::vector<double>>(std::move(values));
  result->string_value = std::string("t\0x", 3);
  result->mutation = {1, 2, 0};
  return result;
}

std::shared_ptr<GraphRecordTree> graph(const std::string& id) {
  auto result = std::make_shared<GraphRecordTree>();
  result->id = id;
  result->resource_id = "resource";
  result->resource_name = "name";
  result->mutation = {1, 2, 0};
  result->points = std::make_shared<GraphPointArray>();
  result->points->id = id + "-points";
  result->points->nodes.active = {std::make_shared<RecordGraphPoint>(
      RecordGraphPoint{id + "-p", 1, control(id + "-pxy"), {1, 2, 0}})};
  return result;
}

std::shared_ptr<StashFrameArray> array(const std::string& id,
                                       std::vector<std::shared_ptr<StashFrame>> nodes) {
  auto result = std::make_shared<StashFrameArray>();
  result->id = id;
  result->nodes.active = std::move(nodes);
  result->nodes.mutation = {1, 2, 0};
  return result;
}

std::shared_ptr<StashGroup> group(const std::string& id, const std::shared_ptr<StashFrameArray>& frames) {
  auto result = std::make_shared<StashGroup>();
  result->id = id;
  result->material_id = "material";
  result->property = "property";
  result->frames = frames;
  result->mutation = {1, 2, 0};
  return result;
}

void register_frame(KeyframeStashIndex& index, const std::shared_ptr<StashFrame>& value) {
  index[value->id] = value;
  index[value->left->id] = value->left;
  index[value->right->id] = value->right;
  if (!value->graph) return;
  index[value->graph->id] = value->graph;
  index[value->graph->points->id] = value->graph->points;
  for (const auto& node : value->graph->points->nodes.active) {
    index[node->id] = node;
    index[node->point->id] = node->point;
  }
}

std::shared_ptr<StashFrame> copy_frame(const std::shared_ptr<StashFrame>& source) {
  auto result = std::make_shared<StashFrame>(*source);
  result->left = std::make_shared<RecordPoint>(*source->left);
  result->right = std::make_shared<RecordPoint>(*source->right);
  result->values = std::make_shared<std::vector<double>>(*source->values);
  return result;
}

void frame_checks(Checks& checks) {
  const auto previous = frame("f"), current = copy_frame(previous);
  KeyframeStashIndex history;
  register_frame(history, previous);
  bool changed = false;
  checks.require(!stash_keyframe(*current, history, changed) && !changed, "Equal frame produces no record");

  current->curve_type = -1;
  auto record = stash_keyframe(*current, history, changed);
  checks.require(record && changed && record->curve_type == -1, "Curve difference produces a record");
  checks.require(record->left == previous->left && record->right == previous->right,
                 "Unchanged controls stay the historical objects");
  checks.require(record->values == previous->values, "Unchanged payload shares the historical vector");
  checks.require(record->mutation.tracking == 1 && record->mutation.state_code == current->mutation.state_code,
                 "Record keeps historical tracking and the current state code");

  current->curve_type = previous->curve_type;
  current->time_offset = std::numeric_limits<std::int64_t>::min();
  changed = false;
  record = stash_keyframe(*current, history, changed);
  checks.require(record && changed && record->time_offset == std::numeric_limits<std::int64_t>::min(),
                 "Time difference produces a record");
  current->time_offset = previous->time_offset;

  current->string_value = std::string("t\0y", 3);
  changed = false;
  record = stash_keyframe(*current, history, changed);
  checks.require(record && changed && record->string_value == current->string_value,
                 "A difference after an embedded NUL is still observed");
  current->string_value = previous->string_value;

  // The current node's own dirty flag alone produces a record made of historical payload.
  current->mutation.changed = 1;
  changed = false;
  record = stash_keyframe(*current, history, changed);
  checks.require(record && changed && record->mutation.changed == 1, "A dirty frame produces a record");
  checks.require(record->curve_type == previous->curve_type && record->values == previous->values,
                 "A dirty frame with equal payload copies the historical payload");
  current->mutation.changed = 0;
}

void payload_checks(Checks& checks) {
  const auto previous = frame("f", {0.0, kInfinity}), current = copy_frame(previous);
  KeyframeStashIndex history;
  register_frame(history, previous);
  bool changed = false;
  // Signed zeros compare equal, so a sign flip is invisible to this walk.
  (*current->values)[0] = -0.0;
  checks.require(!stash_keyframe(*current, history, changed) && !changed,
                 "Opposite signed zeros produce no record");
  (*current->values)[1] = -kInfinity;
  auto record = stash_keyframe(*current, history, changed);
  checks.require(record && changed, "Opposite infinities produce a record");
  checks.same_bits((*record->values)[0], -0.0, "Replacement payload takes the current zero bits");
  checks.require(record->values != current->values && record->values != previous->values,
                 "A replaced payload is a new vector, not either input");

  (*current->values) = *previous->values;
  (*current->values)[0] = kQuietNan;
  previous->values->at(0) = kQuietNan;
  changed = false;
  record = stash_keyframe(*current, history, changed);
  checks.require(record && changed, "A NaN is unequal to itself and forces a record");
  checks.same_bits((*record->values)[0], kQuietNan, "Replacement payload keeps the current NaN payload");
  previous->values->at(0) = kOtherNan;
  changed = false;
  checks.require(stash_keyframe(*current, history, changed) && changed, "Distinct NaN payloads also differ");

  previous->values->at(0) = 0.0;
  current->values = std::make_shared<std::vector<double>>();
  changed = false;
  record = stash_keyframe(*current, history, changed);
  checks.require(record && changed && record->values->empty(), "A shorter payload produces a record");
  current->values = std::make_shared<std::vector<double>>(std::vector<double>{0.0, kInfinity, 1});
  changed = false;
  checks.require(stash_keyframe(*current, history, changed) && changed, "A longer payload produces a record");
}

void control_checks(Checks& checks) {
  const auto previous = frame("f"), current = copy_frame(previous);
  KeyframeStashIndex history;
  register_frame(history, previous);
  bool changed = false;
  // A control reports through the caller's flag; the frame level never writes it for a control.
  current->left->mutation.changed = 1;
  auto record = stash_keyframe(*current, history, changed);
  checks.require(record && changed && record->left != previous->left, "A dirty control produces its own record");
  checks.require(record->left != current->left && record->left->x == current->left->x,
                 "A control record copies the current control");
  checks.require(record->right == previous->right, "The clean control stays the historical object");
  current->left->mutation.changed = 0;

  // A clean control with a differing coordinate is not compared by value at all.
  current->left->x = 900;
  changed = false;
  checks.require(!stash_keyframe(*current, history, changed) && !changed,
                 "A clean control is gated by its dirty flag, not by its coordinates");

  // Aliased controls are one object visited twice, so both slots take the same record.
  current->right = current->left;
  current->left->mutation.changed = 1;
  changed = false;
  record = stash_keyframe(*current, history, changed);
  checks.require(record && record->left != record->right, "Two visits of one aliased control produce two records");
  checks.require(record->left->id == record->right->id, "Both records carry the aliased control ID");
}

void graph_checks(Checks& checks) {
  auto previous = frame("f");
  previous->graph = graph("g");
  auto current = copy_frame(previous);
  KeyframeStashIndex history;
  register_frame(history, previous);
  bool changed = false;
  checks.require(!stash_keyframe(*current, history, changed) && !changed, "An equal graph produces no record");

  current->graph = nullptr;
  auto record = stash_keyframe(*current, history, changed);
  checks.require(record && changed && !record->graph, "Losing a graph clears the record's graph slot");

  // Gaining a graph is reported by the graph walk, not by this level.
  auto without = frame("h");
  auto gained = copy_frame(without);
  gained->graph = graph("g2");
  KeyframeStashIndex plain;
  register_frame(plain, without);
  changed = false;
  record = stash_keyframe(*gained, plain, changed);
  checks.require(record && changed && record->graph && record->graph != gained->graph,
                 "A graph absent from history is deep-copied into the record");
  changed = false;
  checks.require(!stash_keyframe(*without, plain, changed) && !changed,
                 "Neither node holding a graph produces no record");
}

void miss_checks(Checks& checks) {
  const auto current = frame("f");
  current->graph = graph("g");
  bool changed = false;
  auto record = stash_keyframe(*current, {}, changed);
  checks.require(record && changed && record->id == current->id, "A missing frame history deep-copies the frame");
  checks.require(record->left != current->left && record->right != current->right,
                 "The deep branch rebuilds both controls");
  checks.require(record->values != current->values && *record->values == *current->values,
                 "The deep branch allocates its own payload vector");
  checks.require(record->graph != current->graph && record->graph->points != current->graph->points,
                 "The deep branch rebuilds the graph subtree");
  checks.require(record->graph->points->nodes.mutation.tracking == 0 &&
                     record->graph->points->nodes.mutation.state_code ==
                         current->graph->points->nodes.mutation.state_code,
                 "A deep-copied array drops tracking but keeps its state code");
  checks.require(record->graph->points->clock != current->graph->points->clock,
                 "A deep-copied array takes a clock owner of its own");

  // A present-but-null entry and a foreign type are both the native lookup failing.
  KeyframeStashIndex history;
  history[current->id] = std::monostate{};
  changed = false;
  checks.require(stash_keyframe(*current, history, changed) && changed, "A null history entry is a miss");
  history[current->id] = control("other");
  changed = false;
  checks.require(stash_keyframe(*current, history, changed) && changed, "A foreign history type is a miss");
}

void array_checks(Checks& checks) {
  const auto first = frame("a"), second = frame("b");
  const auto previous = array("list", {first, second});
  auto current = std::make_shared<StashFrameArray>(*previous);
  current->nodes.active = {copy_frame(first), copy_frame(second)};
  KeyframeStashIndex history;
  history[previous->id] = previous;
  register_frame(history, first);
  register_frame(history, second);

  bool changed = false;
  checks.require(!stash_keyframe_array(*current, history, changed) && !changed,
                 "An array of equal elements produces no record");

  current->nodes.active[0]->curve_type = 9;
  auto record = stash_keyframe_array(*current, history, changed);
  checks.require(record && changed && record->nodes.active.size() == 2, "A dirty element rebuilds the array");
  checks.require(record->nodes.active[1] == second, "A clean sibling becomes the historical object");
  checks.require(record->clock == current->clock, "An array record shares the current clock owner");
  current->nodes.active[0]->curve_type = first->curve_type;

  // An element whose own walk produced nothing but whose ID is not in the historical active
  // set still counts as a replacement.
  const auto stranger = frame("c");
  register_frame(history, stranger);
  current->nodes.active.push_back(copy_frame(stranger));
  changed = false;
  record = stash_keyframe_array(*current, history, changed);
  checks.require(record && changed && record->nodes.active[2] == stranger,
                 "A history hit outside the historical active set marks the array");

  // The suppression flag keeps the record but withholds the caller's flag.
  current->suppress_change_flag = true;
  changed = false;
  record = stash_keyframe_array(*current, history, changed);
  checks.require(record && !changed, "Suppression produces a record without reporting a change");
  current->suppress_change_flag = false;

  current->nodes.active.pop_back();
  current->nodes.retained = {copy_frame(first)};
  changed = false;
  record = stash_keyframe_array(*current, history, changed);
  checks.require(record && changed && record->nodes.retained == current->nodes.retained,
                 "A retained list alone produces a record and shares its entries");
  checks.require(record->transient == std::array<std::uint64_t, 2>{}, "An array record clears the transient words");
  current->nodes.retained.clear();

  // The membership test uses the historical object's own ID, not the key it was found under.
  auto renamed = frame("a");
  renamed->id = "renamed";
  history["a"] = renamed;
  changed = false;
  record = stash_keyframe_array(*current, history, changed);
  checks.require(record && changed && record->nodes.active[0] == renamed,
                 "A key whose object carries a different ID counts as a replacement");
  history["a"] = first;

  // A duplicate element is visited twice and each visit resolves independently.
  current->nodes.active = {copy_frame(first), copy_frame(first)};
  changed = false;
  checks.require(!stash_keyframe_array(*current, history, changed) && !changed,
                 "Repeating one clean element still produces no record");
  StashFrameArray empty;
  empty.id = "empty";
  changed = false;
  checks.require(!stash_keyframe_array(empty, {}, changed) && !changed,
                 "A missing empty array history still produces no record");
}

void group_checks(Checks& checks) {
  const auto only = frame("a");
  const auto previous_array = array("list", {only});
  const auto previous = group("g", previous_array);
  auto current_array = std::make_shared<StashFrameArray>(*previous_array);
  current_array->nodes.active = {copy_frame(only)};
  auto current = std::make_shared<StashGroup>(*previous);
  current->frames = current_array;

  KeyframeStashIndex history;
  history[previous->id] = previous;
  history[previous_array->id] = previous_array;
  register_frame(history, only);

  bool changed = false;
  checks.require(!stash_keyframe_group(*current, history, changed) && !changed,
                 "An equal group produces no record");
  current->material_id = "other";
  auto record = stash_keyframe_group(*current, history, changed);
  checks.require(record && changed && record->material_id == "other", "A material difference produces a record");
  checks.require(record->frames == previous_array, "An unchanged array stays the historical object");
  current->material_id = previous->material_id;

  current->property = std::string("p\0q", 3);
  changed = false;
  record = stash_keyframe_group(*current, history, changed);
  checks.require(record && changed && record->property == current->property,
                 "A property difference produces a record");
  current->property = previous->property;

  current->frames->nodes.active[0]->time_offset = 5;
  changed = false;
  record = stash_keyframe_group(*current, history, changed);
  checks.require(record && changed && record->frames != previous_array, "A dirty grandchild rebuilds the group");
  checks.require(record->material_id == previous->material_id, "Unchanged group strings stay historical");

  changed = false;
  record = stash_keyframe_group(*current, {}, changed);
  checks.require(record && changed && record->frames != current->frames,
                 "A missing group history deep-copies the whole group");
  checks.require(record->frames->nodes.active[0] != current->frames->nodes.active[0],
                 "The group deep branch rebuilds its elements");
  checks.require(record->frames->nodes.mutation.tracking == 0 &&
                     record->frames->nodes.mutation.state_code == current->frames->nodes.mutation.state_code,
                 "The deep-copied keyframe array drops tracking and keeps its state code");
  checks.require(record->frames->clock != current->frames->clock,
                 "The deep-copied keyframe array takes a clock owner of its own");
}

// The two array walks are one class template. Driving the graph element type through the same
// reconstruction and comparing it with the separately written stash_graph_array turns that
// reading of the binary into an executable claim.
void shared_template_checks(Checks& checks) {
  const auto make_point = [](const std::string& id, double x) {
    return std::make_shared<RecordGraphPoint>(RecordGraphPoint{id, 2, control(id + "-xy", x), {1, 2, 0}});
  };
  const auto previous = std::make_shared<GraphPointArray>();
  previous->id = "points";
  previous->nodes.active = {make_point("p", .5), make_point("q", -.5)};
  previous->nodes.mutation = {1, 2, 0};

  GraphTreeIndex graph_history{{previous->id, previous}};
  KeyframeStashIndex shared_history{{previous->id, previous}};
  for (const auto& node : previous->nodes.active) {
    graph_history[node->id] = node;
    graph_history[node->point->id] = node->point;
    shared_history[node->id] = node;
    shared_history[node->point->id] = node->point;
  }

  for (unsigned variant = 0; variant < 8; ++variant) {
    auto current = std::make_shared<GraphPointArray>(*previous);
    current->nodes.active.clear();
    for (const auto& node : previous->nodes.active) {
      auto copy = std::make_shared<RecordGraphPoint>(*node);
      copy->point = std::make_shared<RecordPoint>(*node->point);
      current->nodes.active.push_back(copy);
    }
    if (variant & 1U) current->nodes.active[0]->mutation.changed = 1;
    if (variant & 2U) current->nodes.retained = {current->nodes.active[1]};
    if (variant & 4U) current->suppress_change_flag = true;
    bool first_changed = false, second_changed = false;
    const auto expected = stash_graph_array(*current, graph_history, first_changed);
    const auto actual = stash_shared_graph_array(*current, shared_history, second_changed);
    checks.require(first_changed == second_changed, "Both array instances report the same changed output");
    checks.require(static_cast<bool>(expected) == static_cast<bool>(actual),
                   "Both array instances agree on producing a record");
    if (!expected || !actual) continue;
    checks.require(expected->nodes.active.size() == actual->nodes.active.size(),
                   "Both array instances collect the same element count");
    for (std::size_t i = 0; i < expected->nodes.active.size(); ++i) {
      const bool historical = expected->nodes.active[i] == previous->nodes.active[i];
      checks.require(historical == (actual->nodes.active[i] == previous->nodes.active[i]),
                     "Both array instances make the same historical-or-new choice");
    }
    checks.require(expected->nodes.retained == actual->nodes.retained,
                   "Both array instances keep the same retained entries");
  }
}

void rejection_checks(Checks& checks) {
  const auto rejects = [&checks](auto call, std::string_view message) {
    bool threw = false;
    try {
      call();
    } catch (const std::invalid_argument&) {
      threw = true;
    }
    checks.require(threw, message);
  };
  bool changed = false;
  auto value = frame("f");
  value->left = nullptr;
  rejects([&] { stash_keyframe(*value, {}, changed); }, "A null control is rejected");
  value = frame("f");
  value->values = nullptr;
  rejects([&] { stash_keyframe(*value, {}, changed); }, "A null payload vector is rejected");
  auto list = array("list", {frame("a"), nullptr});
  rejects([&] { stash_keyframe_array(*list, {}, changed); }, "A null array element is rejected");
  auto holder = group("g", nullptr);
  rejects([&] { stash_keyframe_group(*holder, {}, changed); }, "A group without an array is rejected");
  auto broken = frame("f");
  broken->values = nullptr;
  KeyframeStashIndex history;
  history["f"] = broken;
  const auto usable = frame("f");
  rejects([&] { stash_keyframe(*usable, history, changed); }, "A malformed history frame is rejected");
  checks.require(!changed, "No rejected input reported a change");

  // The validators are the same preflight the walks run, and are exposed so a caller can check a
  // tree once instead of at every level.
  auto clean = frame("f");
  auto shaped = array("list", {clean});
  validate_stash_frame(*clean);
  validate_stash_frame_array(*shaped);
  validate_stash_group(*group("g", shaped));
  validate_keyframe_stash_index({{"g", shaped}});
  checks.require(true, "A well-formed tree passes the exposed validators");
  shaped->nodes.retained = {nullptr};
  rejects([&] { validate_stash_frame_array(*shaped); }, "A null retained entry is rejected by the validator");
}

// Recorded from a real SDK run of creator-native-keyframe-stash; the SDK's IDs are runtime
// UUIDs, so the pinned form is the role-labelled outcome, with the raw values kept in
// batch5/creator/native-keyframe-stash.json.
void golden_checks(Checks& checks) {
  const auto previous = frame("golden");
  previous->graph = graph("golden-graph");
  auto current = copy_frame(previous);
  current->graph = previous->graph;
  KeyframeStashIndex history;
  register_frame(history, previous);

  current->mutation.state_code = 3;
  current->mutation.changed = 1;
  current->curve_type = 11;
  bool changed = false;
  const auto record = stash_keyframe(*current, history, changed);
  checks.require(record && changed, "golden: dirty frame with a curve change produces a record");
  checks.require(record->mutation.tracking == 1 && record->mutation.state_code == 3 &&
                     record->mutation.changed == 1,
                 "golden: the record wears historical tracking and current state");
  checks.require(record->curve_type == 11 && record->time_offset == previous->time_offset,
                 "golden: only the differing scalar is written");
  checks.require(record->left == previous->left && record->right == previous->right &&
                     record->values == previous->values && record->graph == previous->graph,
                 "golden: every equal child stays the historical object");

  // Recorded as array-clean / array-dirty / array-dirty-suppressed: two clean twins of the
  // historical elements, then the first twin dirtied, then the same array with suppression on.
  const auto first = frame("e0"), second = frame("e1");
  const auto historical = array("list", {first, second});
  KeyframeStashIndex index;
  index[historical->id] = historical;
  register_frame(index, first);
  register_frame(index, second);
  auto present = std::make_shared<StashFrameArray>(*historical);
  present->nodes.active = {copy_frame(first), copy_frame(second)};
  bool reported = false;
  checks.require(!stash_keyframe_array(*present, index, reported) && !reported,
                 "golden array-clean: two clean twins produce no record");
  present->nodes.active[0]->curve_type += 7;
  auto list = stash_keyframe_array(*present, index, reported);
  checks.require(list && reported && list->nodes.active.size() == 2,
                 "golden array-dirty: one dirty twin produces a record");
  checks.require(list->nodes.active[0] != first && list->nodes.active[0] != present->nodes.active[0],
                 "golden array-dirty: the dirty element becomes a new object");
  checks.require(list->nodes.active[1] == second, "golden array-dirty: the clean element stays historical");
  present->suppress_change_flag = true;
  reported = false;
  list = stash_keyframe_array(*present, index, reported);
  checks.require(list && !reported && list->nodes.active[1] == second,
                 "golden array-dirty-suppressed: the same record without a reported change");
}
}  // namespace

int main() {
  Checks checks;
  try {
    frame_checks(checks);
    payload_checks(checks);
    control_checks(checks);
    graph_checks(checks);
    miss_checks(checks);
    array_checks(checks);
    group_checks(checks);
    shared_template_checks(checks);
    rejection_checks(checks);
    golden_checks(checks);
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
  return checks.finish();
}
