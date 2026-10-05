#pragma once
// Native crop/mean dependencies only; never publish native point arrays to the worker.
NSDictionary* liveExtraGeometry(uintptr_t owner, uintptr_t object, uintptr_t base) {
  const auto configs = owner + 0x7e58, face = owner + 0x7a40;
  if (read<int>(face + 0x3c) != 1 || read<int>(face + 0x68) != 0 ||
      (read<uint8_t>(configs + 0xb) & 1) || (read<uint8_t>(configs + 0x20) & 1) ||
      (read<uint8_t>(configs + 0x21) & 1))
    throw std::runtime_error("unsupported live Extra refinement profile");
  const auto crop = read<MatView>(object + 0x7ae8);
  if (crop.rows != 160 || crop.cols != 160 || crop.dims != 2 || (crop.flags & 0xfff) != 16)
    throw std::runtime_error("unsupported live Extra crop dimensions");
  return @{@"schema":@"face-live-extra-geometry-v1",
    @"profile":@{@"extra_mode":@1, @"smooth_type":@0, @"optimized":@NO,
                 @"secondary_warp":@NO, @"suppressed":@NO},
    @"forward":matrix(object + 0x1b10, 2, 3), @"inverse":matrix(object + 0x1b70, 2, 3),
    @"stage2_forward":matrix(object + 0x7d28, 2, 3), @"stage2_inverse":matrix(object + 0x7d88, 2, 3),
    @"primary_mean":floats(base + 0x5dd088, 212)};
}
