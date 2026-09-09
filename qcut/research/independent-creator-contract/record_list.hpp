#pragma once

#include "mutation.hpp"

#include <memory>
#include <string>
#include <unordered_set>
#include <utility>
#include <vector>

namespace creator_contract {
template <class Node> struct RecordNodeList {
  std::vector<std::shared_ptr<Node>> active;
  std::vector<std::shared_ptr<Node>> retained;
  editor_contract::MutationState mutation;
  bool track_children = false;
};

namespace detail {
template <class List, class Index, class Restore, class Copy>
std::size_t reconcile_record_list(List& destination, const List& source, const Index& existing,
                                  Restore restore, Copy copy) {
  decltype(destination.active) restored;
  restored.reserve(source.active.size());
  std::unordered_set<std::string> requested_ids;
  for (const auto& node : source.active) {
    requested_ids.insert(node->id);
    const auto found = existing.find(node->id);
    if (found != existing.end() && found->second) {
      restore(*found->second, node.get());
      restored.push_back(found->second);
    } else restored.push_back(copy(*node));
  }
  std::unordered_set<std::string> previously_present;
  for (const auto& node : destination.active) {
    if (requested_ids.contains(node->id)) previously_present.insert(node->id);
    else destination.retained.push_back(node);
  }
  std::size_t clocks = 1;
  for (const auto& node : restored) {
    if (previously_present.contains(node->id)) continue;
    node->mutation.tracking = static_cast<std::uint8_t>(destination.track_children);
    if (destination.track_children) node->mutation.state_code = 1;
    else {
      mark_changed(node->mutation);
      mark_changed(destination.mutation);
    }
    ++clocks;
    mark_changed(node->mutation);
  }
  if (source.active.size() != destination.active.size()) mark_changed(destination.mutation);
  destination.active = std::move(restored);
  return clocks;
}

template <class List, class Index, class Restore, class Copy>
List copy_record_list(const List& source, const Index& existing, Restore restore, Copy copy) {
  auto result = source;
  result.active.clear();
  for (const auto& node : source.active) {
    const auto found = existing.find(node->id);
    if (found != existing.end() && found->second) {
      restore(*found->second, node.get());
      result.active.push_back(found->second);
      continue;
    }
    auto child = copy(*node);
    // A present-but-null/incompatible map entry bypasses insertion tracking.
    if (found == existing.end()) {
      child->mutation.tracking = static_cast<std::uint8_t>(result.track_children);
      if (result.track_children) child->mutation.state_code = 1;
      else {
        mark_changed(child->mutation);
        mark_changed(result.mutation);
      }
    }
    result.active.push_back(std::move(child));
  }
  return result;
}
}  // namespace detail
}  // namespace creator_contract
