#pragma once

#include "image_warp_native_support.hpp"
#include "transform_plan.hpp"

namespace lens_contract::diagnostic {
constexpr char image_transform_constructor[] = "_ZN5smash14ImageTransformC1Ev";
using SetAnchors = void (*)(void*, const void*);
using TransformWarp = void (*)(void*, const void*, void*, const void*);

class NativeImageTransform {
 public:
  explicit NativeImageTransform(const Oracle& oracle)
      : destroy_(oracle.offset<Destroy>(image_transform_constructor, 0x3b23f4, 0x340bf8)),
        canonical_(oracle.symbol<SetAnchors>(
            "_ZN5smash14ImageTransform19setCanonicalAnchorsERKN9mobilecv23VecIfLi4EEE")),
        resize_(oracle.symbol<SetAnchors>(
            "_ZN5smash14ImageTransform25computeTransformForResizeERKN9mobilecv23VecIfLi4EEE")),
        warp_(oracle.symbol<TransformWarp>(
            "_ZN5smash14ImageTransform9warpImageERKN9mobilecv23MatERS2_RKNS1_5Size_IiEE")) {
    before_.fill(std::byte{0xa5});
    after_.fill(std::byte{0xa5});
    oracle.symbol<Destroy>(image_transform_constructor)(body_.data());
    guards();
    read_matrix(0);
    read_matrix(0x60);
  }
  ~NativeImageTransform() { destroy_(body_.data()); }
  NativeImageTransform(const NativeImageTransform&) = delete;
  NativeImageTransform& operator=(const NativeImageTransform&) = delete;

  TransformPlan resize(const AnchorResizeRequest& request) {
    canonical_(body_.data(), request.destination_points.data());
    resize_(body_.data(), request.source_points.data());
    guards();
    return {read_matrix(0), read_matrix(0x60)};
  }
  void warp(NativeMat& source, NativeMat& destination, std::array<int, 2> size) {
    warp_(body_.data(), source.address(), destination.address(), size.data());
    guards();
  }
  void guards() const {
    for (const auto& guard : {before_, after_}) {
      for (auto value : guard) require(value == std::byte{0xa5}, "ImageTransform guard changed");
    }
  }

 private:
  template <typename Value>
  Value field(std::size_t offset) const {
    Value result{};
    std::memcpy(&result, body_.data() + offset, sizeof(result));
    return result;
  }
  std::array<float, 6> read_matrix(std::size_t offset) const {
    require((field<int>(offset) & 0xfff) == 5 && field<int>(offset + 4) == 2 &&
                field<int>(offset + 8) == 2 && field<int>(offset + 12) == 3,
            "ImageTransform matrix layout differs");
    const auto* data = field<const std::byte*>(offset + 16);
    const auto stride = field<std::size_t>(offset + 80);
    require(data && stride == 12, "ImageTransform matrix data or stride differs");
    std::array<float, 6> result{};
    std::memcpy(result.data(), data, sizeof(result));
    return result;
  }
  Destroy destroy_;
  SetAnchors canonical_;
  SetAnchors resize_;
  TransformWarp warp_;
  alignas(16) std::array<std::byte, 32> before_{};
  alignas(16) std::array<std::byte, 0x1f0> body_{};
  std::array<std::byte, 32> after_{};
};
}  // namespace lens_contract::diagnostic
