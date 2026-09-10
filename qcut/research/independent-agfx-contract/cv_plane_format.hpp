#pragma once

#include <cstdint>

namespace agfx_contract {

// A CoreVideo four-character code plus the plane the caller wants to bind.
// The native entries compare plane_index against zero over its full 64-bit
// width: zero selects the luminance plane of a biplanar source and every other
// value selects chroma. prefer_bgra reaches only the GLES and Metal entries;
// the AMGPixelFormat entry has no such parameter and ignores the field.
struct PlaneFormatRequest {
  std::uint32_t source_format;
  std::uint64_t plane_index;
  bool prefer_bgra;
};

// The four GL words the native resolver may write. Three of the five accepted
// branches leave `flag` untouched and the rejection path writes nothing at all,
// so callers must seed every field they intend to read back.
struct GlesPlaneFormat {
  std::uint32_t format;
  std::uint32_t type;
  std::uint32_t internal_format;
  std::uint32_t flag;

  bool operator==(const GlesPlaneFormat&) const = default;
};

// Recognized sources are 'L008', '2C08', 'BGRA', 'RGhA', 'fdep' plus '420f' and
// '420v', which are folded onto 'L008'/'2C08' by plane. Only 'L008' and '2C08'
// write `flag`; 'BGRA', 'RGhA' and 'fdep' write the first three fields and leave
// `flag` alone; a rejected source leaves the whole structure unchanged.
// A true return does not establish that a device can allocate the texture.
[[nodiscard]] bool resolve_gles_plane_format(const PlaneFormatRequest& request,
                                             GlesPlaneFormat& output) noexcept;

// Same decision tree, resolved to an AMGPixelFormat. `output` keeps its value
// when the source is rejected. request.prefer_bgra is not part of this entry's
// native signature and never changes the result.
[[nodiscard]] bool resolve_amg_plane_format(const PlaneFormatRequest& request,
                                            std::uint32_t& output) noexcept;

// Resolves to an MTLPixelFormat over a *different* tree: no bit-0x10 folding,
// no per-plane key substitution, '2C08' is not accepted, and 'L008' answers
// A8Unorm rather than the R8Unorm that the AMGPixelFormat route reaches.
// Zero is MTLPixelFormatInvalid and is the in-band rejection signal; a caller
// has nothing else to test.
[[nodiscard]] std::uint64_t resolve_metal_plane_format(
    const PlaneFormatRequest& request) noexcept;

// Secondary entry, taken from the Metal V2 renderer rather than the shared
// resource manager. It reads the four-character code out of a CoreVideo buffer
// and has no plane parameter, so its domain is whatever CoreVideo will create.
// It accepts four codes the plane entries reject ('&BGA', '-BGA', 'hdis',
// 'l64r'), answers 15 rather than 2 for 'L008', and rejects '420f'/'420v'.
// Zero means unrecognized. Conclusions about this entry are bounded by the
// formats CoreVideo actually allocates and never by the exhaustive sweep that
// covers the three entries above.
[[nodiscard]] std::uint32_t resolve_buffer_pixel_format(std::uint32_t source_format,
                                                        bool prefer_bgra) noexcept;

}  // namespace agfx_contract
