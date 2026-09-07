#pragma once

#include "image_warp.hpp"

namespace lens_contract {

struct AnchorResizeRequest {
  std::array<float, 4> source_points;
  std::array<float, 4> destination_points;
};

struct TransformPlan {
  std::array<float, 6> source_to_destination;
  std::array<float, 6> destination_to_source;
  bool operator==(const TransformPlan&) const = default;
};

struct CropResizeRequest {
  float x;
  float y;
  float width;
  float height;
  int destination_width;
  int destination_height;
};

// Point pairs are (x0,y0,x1,y1), with no implicit half-pixel offset.
bool plan_anchor_resize(const AnchorResizeRequest& request, TransformPlan& output);
bool plan_crop_resize(const CropResizeRequest& request, TransformPlan& output);
bool warp_crop_rgba(const RgbaImageView& source, const CropResizeRequest& request,
                    AffineWarpResult& output);

}  // namespace lens_contract
