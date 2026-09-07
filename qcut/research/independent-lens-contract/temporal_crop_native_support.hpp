#pragma once

#include "native_identity.hpp"
#include "temporal_crop.hpp"

#include <cstring>

namespace lens_contract::diagnostic {
inline constexpr char smoother_constructor[] =
    "_ZN4LENS9ALGORITHM10OnlineMove12RectSmootherC1Ev";

template <class T> T read_temporal_crop_field(const void* object, std::size_t offset) {
  T result;
  std::memcpy(&result, static_cast<const std::uint8_t*>(object) + offset, sizeof(T));
  return result;
}
inline TemporalCropState read_temporal_crop_state(const void* object) {
  TemporalCropState result;
  result.frame_width = read_temporal_crop_field<std::int32_t>(object, 0);
  result.frame_height = read_temporal_crop_field<std::int32_t>(object, 4);
  result.history_limit = read_temporal_crop_field<float>(object, 8);
  result.motion_fraction = read_temporal_crop_field<float>(object, 12);
  result.center_x = read_temporal_crop_field<float>(object, 16);
  result.center_y = read_temporal_crop_field<float>(object, 20);
  result.horizontal_extent = read_temporal_crop_field<float>(object, 24);
  const auto first = read_temporal_crop_field<std::uint8_t>(object, 28);
  require(first <= 1, "Unexpected first-frame representation");
  result.first_frame = first != 0;
  result.processed_frames = read_temporal_crop_field<std::uint32_t>(object, 32);
  result.output = {read_temporal_crop_field<std::int32_t>(object, 36), read_temporal_crop_field<std::int32_t>(object, 40),
                   read_temporal_crop_field<std::int32_t>(object, 44), read_temporal_crop_field<std::int32_t>(object, 48)};
  return result;
}

class NativeTemporalCrop {
 public:
  explicit NativeTemporalCrop(const Oracle& oracle)
      : destroy_(oracle.symbol<void (*)(void*)>(
            "_ZN4LENS9ALGORITHM10OnlineMove12RectSmootherD1Ev")),
        reset_(oracle.symbol<void (*)(void*)>(
            "_ZN4LENS9ALGORITHM10OnlineMove12RectSmoother5resetEv")),
        process_(oracle.symbol<void (*)(void*, int, int, int, int, int, int, float, float)>(
            "_ZN4LENS9ALGORITHM10OnlineMove12RectSmoother7ProcessEiiiiiiff")),
        crop_(oracle.symbol<CropFunction>(
            "_ZN4LENS9ALGORITHM10OnlineMove12RectSmoother7GetCropEfiiiiiifRfS3_S3_S3_")) {
    storage_.fill(0xa5);
    oracle.symbol<void (*)(void*)>(smoother_constructor)(data());
    guards();
  }
  ~NativeTemporalCrop() { destroy_(data()); }
  NativeTemporalCrop(const NativeTemporalCrop&) = delete;
  NativeTemporalCrop& operator=(const NativeTemporalCrop&) = delete;

  void reset() { reset_(data()); guards(); }
  void process(const TemporalCropRequest& request) {
    const auto& box = request.rectangle;
    process_(data(), box.x, box.y, box.width, box.height, request.frame_width,
             request.frame_height, request.history_limit, request.motion_fraction);
    guards();
  }
  CropBounds interpolate(const CropInterpolationRequest& r) {
    const auto before = storage_;
    CropBounds output{};
    crop_(data(), r.history_weight, r.current_x, r.current_y, r.current_extent,
          r.previous_x, r.previous_y, r.previous_extent, r.aspect_ratio,
          output.left, output.right, output.top, output.bottom);
    require(storage_ == before, "GetCrop changed the real smoother object");
    return output;
  }
  TemporalCropState state() const {
    return read_temporal_crop_state(storage_.data() + guard_size);
  }
  void guards() const {
    for (std::size_t index = 0; index < storage_.size(); ++index) {
      if (index < guard_size || index >= guard_size + object_capacity) {
        require(storage_[index] == 0xa5, "Native smoother exceeded guarded object storage");
      }
    }
  }

 private:
  using CropFunction = void (*)(void*, float, int, int, int, int, int, int, float,
                                float&, float&, float&, float&);
  // The real shared allocation is 80 bytes, with the element at +24.
  static constexpr std::size_t object_capacity = 56;
  static constexpr std::size_t guard_size = 32;
  alignas(16) std::array<std::uint8_t, guard_size * 2 + object_capacity> storage_{};
  void (*destroy_)(void*);
  void (*reset_)(void*);
  void (*process_)(void*, int, int, int, int, int, int, float, float);
  CropFunction crop_;
  void* data() { return storage_.data() + guard_size; }

};
}  // namespace lens_contract::diagnostic
