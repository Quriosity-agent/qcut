#pragma once

#include "lens_contract.hpp"

#include <cstddef>
#include <span>
#include <vector>

namespace lens_contract {

// The three SettingInfo fields MergeUtil dereferences. The full native record
// is 0x44 bytes; only these three offsets are ever loaded, and the +0x10 load
// at 0xb0f34 is stored to a stack slot the rest of the function never reads.
// It is modelled here so a test can state that fact instead of implying the
// record has two fields.
struct MergeSettings {
  float width;         // SettingInfo +0x00
  float height;        // SettingInfo +0x04
  float unused_field;  // SettingInfo +0x10, loaded once and discarded
};

// Which gate refused, so a caller can attribute a rejection to one stage
// instead of reporting an undifferentiated failure. Small frames legitimately
// leave the motion stage's translation domain, and that has to stay visible.
enum class MergeStage : unsigned char {
  accepted,
  // Also covers the FE_TONEAREST precondition: it is a global setting the
  // whole chain depends on, checked once before anything else.
  settings,
  template_vector,
  box_vector,
  rigid_to_lock,
  motion,
  lock_to_rigid,
};

// Both input vectors are indexed with operator[] and no bounds check, so fewer
// than four elements is undefined behaviour in the native entry; this one
// refuses instead. Elements past the fourth are ignored, as native ignores
// them.
inline constexpr std::size_t merge_vector_length = 4;

// MoveSys::MergeUtil. `current` is a normalized template rigid whose physical
// order is {scale, degrees, tx, ty}; `box` is a pixel rectangle
// {x0, y0, x1, y1}. The chain is Rigid2Lock about the frame center, a pixel
// translation by the box-center offset, Move::Run with border mode 11, then
// Lock2Rigid about the BOX center, and finally a permuted four-element result
// in the same {scale, degrees, tx, ty} order as the input.
//
// Output is written only on acceptance and is always four elements. `output`
// may alias the storage either span refers to: every input value is read
// before the first write.
MergeStage merge_util(const MergeSettings& settings, std::span<const float> current,
                      std::span<const float> box, std::vector<float>& output);

}  // namespace lens_contract
