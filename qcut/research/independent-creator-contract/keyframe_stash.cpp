#include "keyframe_stash.hpp"

#include <stdexcept>
#include <unordered_set>

namespace creator_contract {
namespace {
constexpr std::size_t kBudget = 1U << 20;

void require(bool condition, const char* message) {
  if (!condition) throw std::invalid_argument(message);
}

void validate_coordinate(const std::shared_ptr<RecordPoint>& point) {
  require(static_cast<bool>(point), "A keyframe control is dereferenced without a null test");
}

void validate_frame(const StashFrame& frame) {
  validate_coordinate(frame.left);
  validate_coordinate(frame.right);
  // Both the current and the historical value vector are loaded through their pointer with
  // no null test before the length subtraction, so an absent vector is refused here.
  require(static_cast<bool>(frame.values), "A keyframe value vector is dereferenced without a null test");
  require(frame.values->size() <= kBudget, "Keyframe value vector exceeds the independent budget");
  if (frame.graph) validate_graph_tree(*frame.graph);
}

void validate_array(const StashFrameArray& array) {
  require(array.nodes.active.size() <= kBudget && array.nodes.retained.size() <= kBudget,
          "Keyframe array exceeds the independent budget");
  require(static_cast<bool>(array.clock), "Keyframe array requires a clock ownership token");
  for (const auto& node : array.nodes.active) {
    require(static_cast<bool>(node), "A keyframe array element is dereferenced without a null test");
    validate_frame(*node);
  }
  // Retained entries are copied into the record by pointer and never dereferenced by this
  // walk; requiring them to be present is a QCut input policy, not an observed native gate.
  for (const auto& node : array.nodes.retained) {
    require(static_cast<bool>(node), "Null retained keyframe array element");
  }
}

void validate_group(const StashGroup& group) {
  require(static_cast<bool>(group.frames), "A keyframe group's array is dereferenced without a null test");
  validate_array(*group.frames);
}

// Deep copies stand for the SDK's deep_copy_raw(false): the ID is kept, and every child
// becomes a fresh object rather than a shared one.
std::shared_ptr<RecordGraphPoint> deep_graph_point(const RecordGraphPoint& source) {
  auto result = std::make_shared<RecordGraphPoint>(source);
  result->point = std::make_shared<RecordPoint>(*source.point);
  return result;
}

std::shared_ptr<GraphPointArray> deep_graph_array(const GraphPointArray& source) {
  auto result = std::make_shared<GraphPointArray>(source);
  result->nodes.active.clear();
  result->nodes.retained.clear();
  // The array level is the one node whose deep copy drops its tracking flag and takes a clock of
  // its own; the state code and the changed flag are still copied across, as at every other level.
  result->nodes.mutation.tracking = 0;
  result->clock = std::make_shared<RecordArrayClock>();
  result->transient = {};
  for (const auto& node : source.nodes.active) result->nodes.active.push_back(deep_graph_point(*node));
  for (const auto& node : source.nodes.retained) result->nodes.retained.push_back(deep_graph_point(*node));
  return result;
}

std::shared_ptr<GraphRecordTree> deep_graph(const GraphRecordTree& source) {
  auto result = std::make_shared<GraphRecordTree>(source);
  result->points = deep_graph_array(*source.points);
  return result;
}

std::shared_ptr<StashFrame> deep_frame(const StashFrame& source) {
  auto result = std::make_shared<StashFrame>(source);
  result->left = std::make_shared<RecordPoint>(*source.left);
  result->right = std::make_shared<RecordPoint>(*source.right);
  // A deep copy always allocates its own vector, even when the contents are identical.
  result->values = std::make_shared<std::vector<double>>(*source.values);
  if (source.graph) result->graph = deep_graph(*source.graph);
  return result;
}

std::shared_ptr<StashFrameArray> deep_frame_array(const StashFrameArray& source) {
  auto result = std::make_shared<StashFrameArray>(source);
  result->nodes.active.clear();
  result->nodes.retained.clear();
  result->nodes.mutation.tracking = 0;
  result->clock = std::make_shared<RecordArrayClock>();
  result->transient = {};
  for (const auto& node : source.nodes.active) result->nodes.active.push_back(deep_frame(*node));
  for (const auto& node : source.nodes.retained) result->nodes.retained.push_back(deep_frame(*node));
  return result;
}

std::shared_ptr<StashGroup> deep_group(const StashGroup& source) {
  auto result = std::make_shared<StashGroup>(source);
  result->frames = deep_frame_array(*source.frames);
  return result;
}

// The two projections the leaf and graph walks expect. They are built once per public call
// so a deep tree does not rebuild them at every level.
struct Context {
  const KeyframeStashIndex& index;
  RecordStashIndex points;
  GraphTreeIndex graphs;

  explicit Context(const KeyframeStashIndex& source) : index(source) {
    for (const auto& [key, value] : source) {
      if (const auto point = std::get_if<std::shared_ptr<RecordPoint>>(&value)) {
        points.coordinates[key] = *point;
        graphs[key] = *point;
      } else if (const auto node = std::get_if<std::shared_ptr<RecordGraphPoint>>(&value)) {
        points.graph_points[key] = *node;
        graphs[key] = *node;
      } else if (const auto array = std::get_if<std::shared_ptr<GraphPointArray>>(&value)) {
        graphs[key] = *array;
      } else if (const auto tree = std::get_if<std::shared_ptr<GraphRecordTree>>(&value)) {
        graphs[key] = *tree;
      }
      // A keyframe-level entry is deliberately absent from both projections: the leaf and
      // graph walks look their own classes up and treat a foreign type as a miss.
    }
  }
};

bool payload_differs(const std::vector<double>& current, const std::vector<double>& previous) {
  if (current.size() != previous.size()) return true;
  for (std::size_t i = 0; i < current.size(); ++i) {
    // An IEEE comparison, not a bit comparison: the two signed zeros stay equal and any NaN
    // is unequal to itself, so a NaN payload always forces a replacement vector.
    if (!(current[i] == previous[i])) return true;
  }
  return false;
}

std::shared_ptr<StashFrame> stash_frame(const StashFrame& current, const Context& context, bool& changed) {
  const auto previous = keyframe_stash_find<StashFrame>(context.index, current.id);
  if (!previous) {
    changed = true;
    return deep_frame(current);
  }
  // The record starts as the historical payload wearing the current node's state code and
  // changed flag; every later field is written only where the two nodes actually differ.
  auto shallow = [&] {
    auto result = std::make_shared<StashFrame>(*previous);
    result->mutation.state_code = current.mutation.state_code;
    result->mutation.changed = current.mutation.changed;
    return result;
  };
  std::shared_ptr<StashFrame> result;
  if (current.mutation.changed) {
    changed = true;
    result = shallow();
  }
  if (current.curve_type != previous->curve_type) {
    if (!result) result = shallow();
    result->curve_type = current.curve_type;
    changed = true;
  }
  if (current.time_offset != previous->time_offset) {
    if (!result) result = shallow();
    result->time_offset = current.time_offset;
    changed = true;
  }
  if (current.string_value != previous->string_value) {
    if (!result) result = shallow();
    result->string_value = current.string_value;
    changed = true;
  }
  if (payload_differs(*current.values, *previous->values)) {
    if (!result) result = shallow();
    result->values = std::make_shared<std::vector<double>>(*current.values);
    changed = true;
  }
  // Both controls report through the caller's own flag, so a control that produced a record
  // marks the whole traversal without this level writing the flag itself.
  if (auto left = stash_point(*current.left, context.points, changed)) {
    if (!result) result = shallow();
    result->left = std::move(left);
  }
  if (auto right = stash_point(*current.right, context.points, changed)) {
    if (!result) result = shallow();
    result->right = std::move(right);
  }
  if (current.graph) {
    if (auto graph = stash_graph_tree(*current.graph, context.graphs, changed)) {
      if (!result) result = shallow();
      result->graph = std::move(graph);
    }
  } else if (previous->graph) {
    // Losing a graph is the one graph transition this level reports by itself, because the
    // graph walk it would otherwise delegate to is never entered.
    if (!result) result = shallow();
    result->graph = {};
    changed = true;
  }
  return result;
}

// One reconstruction of the array walk, instantiated for both element types. `Policy` supplies
// the two index lookups, the child walk and the child deep copy; nothing else differs.
template <class Policy>
std::shared_ptr<typename Policy::Array> stash_array(const typename Policy::Array& current,
                                                    const Policy& policy, bool& changed) {
  std::unordered_set<std::string> historical_ids;
  if (const auto previous = policy.previous_array(current.id)) {
    for (const auto& node : previous->nodes.active) historical_ids.insert(node->id);
  }
  std::vector<std::shared_ptr<typename Policy::Node>> active;
  active.reserve(current.nodes.active.size());
  bool replacement = false;
  for (const auto& node : current.nodes.active) {
    // Each element reports into a fresh flag of its own; only this level decides whether that
    // reaches the caller, which is what the suppression flag gates.
    bool child_changed = false;
    if (auto child = policy.stash_node(*node, child_changed)) {
      active.push_back(std::move(child));
      replacement = true;
      if (!current.suppress_change_flag && child_changed) changed = true;
      continue;
    }
    if (auto previous = policy.previous_node(node->id)) {
      active.push_back(previous);
      // The membership test uses the historical object's own ID, which an index seeded by the
      // caller can make differ from the key the object was found under.
      if (historical_ids.contains(previous->id)) continue;
    } else {
      active.push_back(policy.deep_node(*node));
    }
    replacement = true;
    if (!current.suppress_change_flag) changed = true;
  }
  if (!replacement && current.nodes.retained.empty()) return {};
  auto result = std::make_shared<typename Policy::Array>(current);
  result->nodes.active = std::move(active);
  result->transient = {};
  if (!current.suppress_change_flag && !current.nodes.retained.empty()) changed = true;
  return result;
}

struct FrameArrayPolicy {
  using Array = StashFrameArray;
  using Node = StashFrame;
  const Context& context;
  std::shared_ptr<Array> previous_array(const std::string& id) const {
    return keyframe_stash_find<Array>(context.index, id);
  }
  std::shared_ptr<Node> previous_node(const std::string& id) const {
    return keyframe_stash_find<Node>(context.index, id);
  }
  std::shared_ptr<Node> stash_node(const Node& node, bool& child_changed) const {
    return stash_frame(node, context, child_changed);
  }
  std::shared_ptr<Node> deep_node(const Node& node) const { return deep_frame(node); }
};

struct GraphArrayPolicy {
  using Array = GraphPointArray;
  using Node = RecordGraphPoint;
  const Context& context;
  std::shared_ptr<Array> previous_array(const std::string& id) const {
    return keyframe_stash_find<Array>(context.index, id);
  }
  std::shared_ptr<Node> previous_node(const std::string& id) const {
    return keyframe_stash_find<Node>(context.index, id);
  }
  std::shared_ptr<Node> stash_node(const Node& node, bool& child_changed) const {
    return stash_graph_point(node, context.points, child_changed);
  }
  std::shared_ptr<Node> deep_node(const Node& node) const { return deep_graph_point(node); }
};

std::shared_ptr<StashGroup> stash_group(const StashGroup& current, const Context& context, bool& changed) {
  const auto previous = keyframe_stash_find<StashGroup>(context.index, current.id);
  if (!previous) {
    changed = true;
    return deep_group(current);
  }
  auto shallow = [&] {
    auto result = std::make_shared<StashGroup>(*previous);
    result->mutation.state_code = current.mutation.state_code;
    result->mutation.changed = current.mutation.changed;
    return result;
  };
  std::shared_ptr<StashGroup> result;
  if (current.mutation.changed) {
    changed = true;
    result = shallow();
  }
  if (current.material_id != previous->material_id) {
    if (!result) result = shallow();
    result->material_id = current.material_id;
    changed = true;
  }
  if (current.property != previous->property) {
    if (!result) result = shallow();
    result->property = current.property;
    changed = true;
  }
  if (auto frames = stash_array(*current.frames, FrameArrayPolicy{context}, changed)) {
    if (!result) result = shallow();
    result->frames = std::move(frames);
  }
  return result;
}
}  // namespace

void validate_stash_frame(const StashFrame& frame) { validate_frame(frame); }
void validate_stash_frame_array(const StashFrameArray& array) { validate_array(array); }
void validate_stash_group(const StashGroup& group) { validate_group(group); }

void validate_keyframe_stash_index(const KeyframeStashIndex& index) {
  require(index.size() <= kBudget, "Keyframe stash index exceeds the independent budget");
  for (const auto& [key, value] : index) {
    (void)key;
    if (const auto node = std::get_if<std::shared_ptr<StashGroup>>(&value); node && *node) validate_group(**node);
    if (const auto node = std::get_if<std::shared_ptr<StashFrameArray>>(&value); node && *node) validate_array(**node);
    if (const auto node = std::get_if<std::shared_ptr<StashFrame>>(&value); node && *node) validate_frame(**node);
    if (const auto node = std::get_if<std::shared_ptr<GraphRecordTree>>(&value); node && *node) {
      validate_graph_tree(**node);
    }
    if (const auto node = std::get_if<std::shared_ptr<GraphPointArray>>(&value); node && *node) {
      validate_graph_array(**node);
    }
    if (const auto node = std::get_if<std::shared_ptr<RecordGraphPoint>>(&value); node && *node) {
      require(static_cast<bool>((*node)->point), "Historical graph point requires a coordinate object");
    }
  }
}

std::shared_ptr<StashFrame> stash_keyframe(const StashFrame& current, const KeyframeStashIndex& history,
                                           bool& changed) {
  validate_frame(current);
  validate_keyframe_stash_index(history);
  return stash_frame(current, Context(history), changed);
}

std::shared_ptr<StashFrameArray> stash_keyframe_array(const StashFrameArray& current,
                                                      const KeyframeStashIndex& history, bool& changed) {
  validate_array(current);
  validate_keyframe_stash_index(history);
  const Context context(history);
  return stash_array(current, FrameArrayPolicy{context}, changed);
}

std::shared_ptr<StashGroup> stash_keyframe_group(const StashGroup& current, const KeyframeStashIndex& history,
                                                 bool& changed) {
  validate_group(current);
  validate_keyframe_stash_index(history);
  return stash_group(current, Context(history), changed);
}

std::shared_ptr<GraphPointArray> stash_shared_graph_array(const GraphPointArray& current,
                                                          const KeyframeStashIndex& history, bool& changed) {
  validate_graph_array(current);
  validate_keyframe_stash_index(history);
  const Context context(history);
  return stash_array(current, GraphArrayPolicy{context}, changed);
}
}  // namespace creator_contract
