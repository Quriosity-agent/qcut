#pragma once

#include <array>

namespace editor_contract {

struct CurvePoint { float time; float value; };
struct CubicCurve { std::array<CurvePoint, 4> points; };

// Progress is the already-normalized interval fraction, not an absolute time.
float evaluate_cubic(const CubicCurve& curve, float progress) noexcept;

}  // namespace editor_contract
