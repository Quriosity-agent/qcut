#pragma once

#include <cstdint>

namespace agfx_contract {

struct FormatRequest {
    std::uint32_t source_format;
    bool macos_11_or_newer;
};

// Recognized formats 164..191 return true without writing on older macOS.
// The return value alone does not establish device support or output validity.
bool convert_pixel_format(const FormatRequest& request, std::uint64_t& output) noexcept;

} // namespace agfx_contract
