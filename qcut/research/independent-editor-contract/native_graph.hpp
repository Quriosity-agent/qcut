#pragma once

#include "graph.hpp"
#include "native_keyframes.hpp"

#include <array>
#include <bit>
#include <cstring>
#include <sys/mman.h>
#include <unistd.h>

namespace editor_probe {

// This is only the factory's read-only value-argument view. No SDK model or vtable is constructed here.
struct GraphPointInput {
  std::array<std::byte, 32> unused_prefix{};
  std::int32_t type = 0;
  std::array<std::byte, 36> unused_fields{};
  double x = 0, y = 0;
};
struct GraphInput {
  std::array<std::byte, 32> unused_prefix{};
  std::string resource_id = "qcut-original-graph-fixture";
  std::string resource_name = "independent graph diagnostic";
  std::int32_t platform = 0;
  std::vector<GraphPointInput> points;
};
struct FlatGraphPoint {
  std::int32_t type;
  double x, y;
};
static_assert(sizeof(GraphPointInput) == 0x58 && offsetof(GraphPointInput, type) == 0x20);
static_assert(offsetof(GraphPointInput, x) == 0x48 && offsetof(GraphPointInput, y) == 0x50);
static_assert(offsetof(GraphInput, resource_id) == 0x20 && offsetof(GraphInput, resource_name) == 0x38);
static_assert(offsetof(GraphInput, platform) == 0x50 && offsetof(GraphInput, points) == 0x58);
static_assert(sizeof(FlatGraphPoint) == 24 && offsetof(FlatGraphPoint, x) == 8);

class ReadOnlyGraphArgument {
 public:
  explicit ReadOnlyGraphArgument(GraphInput input) {
    const long page = sysconf(_SC_PAGESIZE);
    if (page <= 0 || static_cast<std::size_t>(page) < sizeof(GraphInput)) throw std::runtime_error("Invalid graph argument page size");
    page_size_ = static_cast<std::size_t>(page);
    pages_ = mmap(nullptr, page_size_ * 3, PROT_NONE, MAP_PRIVATE | MAP_ANON, -1, 0);
    if (pages_ == MAP_FAILED) throw std::runtime_error("Cannot allocate guarded graph argument");
    auto* middle = static_cast<std::byte*>(pages_) + page_size_;
    if (mprotect(middle, page_size_, PROT_READ | PROT_WRITE) != 0) {
      munmap(pages_, page_size_ * 3); pages_ = MAP_FAILED;
      throw std::runtime_error("Cannot prepare graph argument page");
    }
    value_ = new (middle + page_size_ - sizeof(GraphInput)) GraphInput(std::move(input));
    if (mprotect(middle, page_size_, PROT_READ) != 0) {
      std::destroy_at(value_); munmap(pages_, page_size_ * 3); pages_ = MAP_FAILED;
      throw std::runtime_error("Cannot protect graph argument from native writes");
    }
  }
  ReadOnlyGraphArgument(const ReadOnlyGraphArgument&) = delete;
  ReadOnlyGraphArgument& operator=(const ReadOnlyGraphArgument&) = delete;
  ~ReadOnlyGraphArgument() {
    if (pages_ == MAP_FAILED) return;
    if (mprotect(static_cast<std::byte*>(pages_) + page_size_, page_size_, PROT_READ | PROT_WRITE) == 0) std::destroy_at(value_);
    munmap(pages_, page_size_ * 3);
  }
  const GraphInput& get() const noexcept { return *value_; }
 private:
  void* pages_ = MAP_FAILED;
  std::size_t page_size_ = 0;
  GraphInput* value_ = nullptr;
};

template<class T> T graph_field(const KeyframeHandle& object, std::size_t offset) {
  if (!object) throw std::runtime_error("Cannot inspect a null native graph record");
  T result;
  std::memcpy(&result, static_cast<const std::byte*>(object.get()) + offset, sizeof(T));
  return result;
}

class GraphFactories {
 public:
  explicit GraphFactories(const Library& library) : library_(library) {}

  KeyframeHandle create(std::span<const editor_contract::GraphPoint> points) const {
    if (points.size() > (1U << 20)) throw std::length_error("Native graph fixture exceeds the independent budget");
    GraphInput input;
    for (const auto& point : points) {
      GraphPointInput value;
      value.type = point.type;
      value.x = point.time_fraction;
      value.y = point.value_fraction;
      input.points.push_back(value);
    }
    const ReadOnlyGraphArgument argument(std::move(input));
    auto result = entry<KeyframeHandle (*)(const GraphInput&)>(library_, 0x340c4a0)(argument.get());
    if (!result) throw std::runtime_error("Native graph factory returned no object");
    const auto& native_points = entry<const KeyframeList& (*)(void*)>(library_, 0xd98070)(result.get());
    if (native_points.size() != points.size()) throw std::runtime_error("Graph factory point count differs");
    const auto direct = convert(result);
    if (direct.size() != points.size()) throw std::runtime_error("Graph factory conversion count differs");
    const auto& id = entry<const std::string& (*)(void*)>(library_, 0xd97e48)(result.get());
    const auto& name = entry<const std::string& (*)(void*)>(library_, 0xd97f3c)(result.get());
    if (id != argument.get().resource_id || name != argument.get().resource_name) {
      throw std::runtime_error("Graph factory resource metadata differs");
    }
    for (std::size_t i = 0; i < points.size(); ++i) {
      if (direct[i].type != points[i].type) throw std::runtime_error("Graph factory point type differs");
      const auto& point = entry<const KeyframeHandle& (*)(void*)>(library_, 0xda3010)(native_points[i].get());
      if (!point) throw std::runtime_error("Native graph point factory returned no coordinate object");
      for (const bool y : {false, true}) {
        const double actual = y ? direct[i].y : direct[i].x;
        const double requested = y ? points[i].value_fraction : points[i].time_fraction;
        if (std::bit_cast<std::uint64_t>(actual) == std::bit_cast<std::uint64_t>(requested)) continue;
        if (actual != 0 || requested != 0) throw std::runtime_error("Graph factory coordinate bits differ");
        // Only equal signed zeros need correction after verifying the factory's direct output.
        const double seed = 1;
        const auto set = entry<void (*)(void*, const double&)>(library_, y ? 0xc8ebfc : 0xc8ebac);
        set(point.get(), seed);
        set(point.get(), requested);
      }
    }
    return result;
  }
  std::vector<FlatGraphPoint> convert(const KeyframeHandle& graph) const {
    return entry<std::vector<FlatGraphPoint> (*)(const KeyframeHandle&)>(library_, 0x1e90318)(graph);
  }
  void attach(const KeyframeHandle& frame, const KeyframeHandle& graph) const {
    entry<void (*)(void*, const KeyframeHandle&)>(library_, 0xc7e510)(frame.get(), graph);
  }
  KeyframeHandle pack(const KeyframeHandle& frame) const {
    auto result = entry<KeyframeHandle (*)(const KeyframeHandle&, bool)>(library_, 0x1e91c80)(frame, true);
    if (!result) throw std::runtime_error("Native record factory returned no object");
    return result;
  }
  KeyframeList expand(const KeyframeHandle& left, const KeyframeHandle& right) const {
    return entry<KeyframeList (*)(const KeyframeHandle&, const KeyframeHandle&)>(library_, 0x3a13eb0)(left, right);
  }
  static const std::vector<double>& values(const KeyframeHandle& record, std::size_t offset) {
    if (!record) throw std::runtime_error("Cannot inspect a null native record vector");
    return *reinterpret_cast<const std::vector<double>*>(static_cast<const std::byte*>(record.get()) + offset);
  }
  static editor_contract::GraphRecord snapshot(const KeyframeHandle& record) {
    return {graph_field<std::int64_t>(record, 0), graph_field<std::int32_t>(record, 8), values(record, 0x10),
      {graph_field<double>(record, 0x40), graph_field<double>(record, 0x48)},
      {graph_field<double>(record, 0x50), graph_field<double>(record, 0x58)},
      {graph_field<std::int64_t>(record, 0x78), values(record, 0x98)},
      {graph_field<std::int64_t>(record, 0xb0), values(record, 0xb8)}};
  }
 private:
  Library library_;
};

}  // namespace editor_probe
