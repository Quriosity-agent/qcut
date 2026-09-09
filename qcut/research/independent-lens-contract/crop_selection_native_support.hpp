#pragma once

#include "crop_selection.hpp"
#include "temporal_crop_native_support.hpp"

#include <cstring>
#include <vector>

#if !defined(_LIBCPP_VERSION)
#error "The fixed native vector ABI requires Apple libc++"
#endif

namespace lens_contract::diagnostic {
template <typename T> T read_crop_field(const void* object, std::size_t offset) {
  T result;
  std::memcpy(&result, static_cast<const std::uint8_t*>(object) + offset, sizeof(T));
  return result;
}
inline DetectionBounds read_detection_vector(const void* object, std::size_t offset) {
  const auto* begin = read_crop_field<const float*>(object, offset);
  const auto* end = read_crop_field<const float*>(object, offset + 8);
  require(begin && end == begin + 4, "Unexpected native bbox vector layout");
  DetectionBounds result;
  std::memcpy(result.data(), begin, sizeof(result));
  return result;
}
inline CropPlannerState read_crop_planner(const void* object) {
  require(read_crop_field<float>(object, 0) == 0.5F &&
          read_crop_field<float>(object, 4) == 0.5F &&
          read_crop_field<float>(object, 8) == 0.05F, "Unexpected native cropper constants");
  CropPlannerState state;
  state.configured_scale = read_crop_field<float>(object, 52);
  state.previous_scale = read_crop_field<float>(object, 56);
  const auto expand = read_crop_field<std::uint8_t>(object, 60);
  require(expand <= 1, "Unexpected cropper bool");
  state.expand_detection = expand != 0;
  state.frame_width = read_crop_field<std::int32_t>(object, 12);
  state.frame_height = read_crop_field<std::int32_t>(object, 16);
  for (std::size_t index = 0; index < 4; ++index) state.information[index] = read_crop_field<float>(object, 20 + index * 4);
  const auto left = read_crop_field<std::int32_t>(object, 36);
  const auto right = read_crop_field<std::int32_t>(object, 40);
  const auto top = read_crop_field<std::int32_t>(object, 44);
  const auto bottom = read_crop_field<std::int32_t>(object, 48);
  state.output = {left, top, right - left, bottom - top};
  return state;
}

class NativeCropPlanner {
 public:
  explicit NativeCropPlanner(const Oracle& oracle, float scale, bool expand = true)
      : destroy_(oracle.symbol<void (*)(void*)>("_ZN4LENS9ALGORITHM10OnlineMove11RectCropperD1Ev")),
        reset_(oracle.symbol<void (*)(void*)>("_ZN4LENS9ALGORITHM10OnlineMove11RectCropper5resetEv")),
        process_(oracle.symbol<void (*)(void*, int, int, float*, float, int)>(
            "_ZN4LENS9ALGORITHM10OnlineMove11RectCropper7ProcessEiiPffi")) {
    storage_.fill(0xa5);
    oracle.symbol<void (*)(void*)>("_ZN4LENS9ALGORITHM10OnlineMove11RectCropperC1Ev")(data());
    oracle.symbol<void (*)(void*, float, bool)>("_ZN4LENS9ALGORITHM10OnlineMove11RectCropper4InitEfb")(data(), scale, expand);
    guards();
  }
  ~NativeCropPlanner() { destroy_(data()); }
  NativeCropPlanner(const NativeCropPlanner&) = delete;
  NativeCropPlanner& operator=(const NativeCropPlanner&) = delete;
  void reset() { reset_(data()); guards(); }
  void process(const CropPlannerRequest& request) {
    auto input = request.bounds;
    process_(data(), request.frame_width, request.frame_height, input.data(), request.requested_scale, request.has_detection ? 1 : 0);
    require(std::memcmp(input.data(), request.bounds.data(), sizeof(input)) == 0, "Native cropper changed source bounds");
    guards();
  }
  CropPlannerState state() const { return read_crop_planner(data()); }
  void guards() const {
    for (std::size_t index = 0; index < storage_.size(); ++index) {
      if (index < guard_size || index >= guard_size + object_capacity)
        require(storage_[index] == 0xa5, "RectCropper exceeded real object allocation");
    }
  }

 private:
  // Shared allocation is 88 bytes; real C1 element starts at +24.
  static constexpr std::size_t object_capacity = 64;
  static constexpr std::size_t guard_size = 32;
  alignas(16) std::array<std::uint8_t, guard_size * 2 + object_capacity> storage_{};
  void (*destroy_)(void*);
  void (*reset_)(void*);
  void (*process_)(void*, int, int, float*, float, int);
  void* data() { return storage_.data() + guard_size; }
  const void* data() const { return storage_.data() + guard_size; }
};

class NativeCenterFocus {
 public:
  explicit NativeCenterFocus(const Oracle& oracle)
      : destroy_(oracle.symbol<void (*)(void*)>("_ZN4LENS9ALGORITHM10OnlineMove11CenterFocusD1Ev")),
        init_(oracle.symbol<int (*)(void*, float, float, float, int, int)>("_ZN4LENS9ALGORITHM10OnlineMove11CenterFocus4InitEfffii")),
        reset_(oracle.symbol<void (*)(void*)>("_ZN4LENS9ALGORITHM10OnlineMove11CenterFocus5resetEv")),
        process_(oracle.symbol<std::vector<float> (*)(void*, std::vector<float>)>(
            "_ZN4LENS9ALGORITHM10OnlineMove11CenterFocus7ProcessENSt3__16vectorIfNS3_9allocatorIfEEEE")) {
    static_assert(sizeof(std::vector<float>) == 24);
    storage_.fill(0xa5);
    oracle.symbol<void (*)(void*)>("_ZN4LENS9ALGORITHM10OnlineMove11CenterFocusC1Ev")(data());
    guards();
  }
  ~NativeCenterFocus() { destroy_(data()); }
  NativeCenterFocus(const NativeCenterFocus&) = delete;
  NativeCenterFocus& operator=(const NativeCenterFocus&) = delete;
  void initialize(const CenterFocusConfiguration& config) {
    require(init_(data(), config.anchor_x, config.anchor_y, config.scale, config.frame_width, config.frame_height) == 0,
            "CenterFocus Init failed");
    guards();
  }
  void reset() { reset_(data()); guards(); }
  DetectionBounds process(std::span<const float> bounds) {
    std::vector<float> input(bounds.begin(), bounds.end());
    const auto before = input;
    const auto output = process_(data(), input);
    require((input.empty() || std::memcmp(input.data(), before.data(), input.size() * sizeof(float)) == 0) && output.size() == 4, "Native vector call changed source or returned unexpected size");
    DetectionBounds result;
    std::copy(output.begin(), output.end(), result.begin());
    guards();
    return result;
  }
  CenterFocusState state() const {
    CenterFocusState state;
    state.configuration = {read<float>(0), read<float>(4), read<float>(16), read<std::int32_t>(8), read<std::int32_t>(12)};
    const auto initialized = read<std::uint8_t>(20);
    require(initialized <= 1, "Unexpected CenterFocus bool");
    state.initialized_bounds = initialized != 0;
    state.ready = state.initialized_bounds;
    state.previous = read_detection_vector(data(), 24);
    state.incoming = read_detection_vector(data(), 48);
    state.adjusted = read_detection_vector(data(), 72);
    return state;
  }
  CropPlannerState planner_state() const { return read_crop_planner(child(112)); }
  TemporalCropState smoother_state() const { return read_temporal_crop_state(child(96)); }
  void guards() const {
    for (std::size_t index = 0; index < storage_.size(); ++index) {
      if (index < guard_size || index >= guard_size + object_capacity)
        require(storage_[index] == 0xa5, "CenterFocus exceeded real object allocation");
    }
  }

 private:
  // Shared allocation: 152 bytes; actual C1 element starts at +24.
  static constexpr std::size_t object_capacity = 128;
  static constexpr std::size_t guard_size = 32;
  alignas(16) std::array<std::uint8_t, guard_size * 2 + object_capacity> storage_{};
  void (*destroy_)(void*);
  int (*init_)(void*, float, float, float, int, int);
  void (*reset_)(void*);
  std::vector<float> (*process_)(void*, std::vector<float>);
  void* data() { return storage_.data() + guard_size; }
  const void* data() const { return storage_.data() + guard_size; }
  template <typename T> T read(std::size_t offset) const { return read_crop_field<T>(data(), offset); }
  const void* child(std::size_t offset) const {
    const auto* result = read<const void*>(offset);
    require(result != nullptr, "Missing true factory child");
    return result;
  }
};
}  // namespace lens_contract::diagnostic
