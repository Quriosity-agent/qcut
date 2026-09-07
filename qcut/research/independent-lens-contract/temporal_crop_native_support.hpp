#pragma once

#include "native_identity.hpp"
#include "temporal_crop.hpp"

#include <cstring>

namespace lens_contract::diagnostic {
inline constexpr char smoother_constructor[] =
    "_ZN4LENS9ALGORITHM10OnlineMove12RectSmootherC1Ev";

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
    TemporalCropState result;
    result.frame_width = read<std::int32_t>(0);
    result.frame_height = read<std::int32_t>(4);
    result.history_limit = read<float>(8);
    result.motion_fraction = read<float>(12);
    result.center_x = read<float>(16);
    result.center_y = read<float>(20);
    result.horizontal_extent = read<float>(24);
    const auto first = read<std::uint8_t>(28);
    require(first <= 1, "Unexpected first-frame representation");
    result.first_frame = first != 0;
    result.processed_frames = read<std::uint32_t>(32);
    result.output = {read<std::int32_t>(36), read<std::int32_t>(40),
                     read<std::int32_t>(44), read<std::int32_t>(48)};
    return result;
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
  template <class T> T read(std::size_t offset) const {
    T result;
    std::memcpy(&result, storage_.data() + guard_size + offset, sizeof(T));
    return result;
  }
};
}  // namespace lens_contract::diagnostic
