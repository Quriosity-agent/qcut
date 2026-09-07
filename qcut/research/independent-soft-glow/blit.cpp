#include "blit.hpp"

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace softglow {
namespace {

struct AxisSample {
    std::size_t lower;
    std::size_t upper;
    std::uint32_t weight;
};

std::vector<AxisSample> axis_samples(int source, int destination, bool reverse = false) {
    std::vector<AxisSample> result;
    result.reserve(static_cast<std::size_t>(destination));
    const std::int64_t denominator = 2 * static_cast<std::int64_t>(destination);
    for (int index = 0; index < destination; ++index) {
        const auto center = 2 * static_cast<std::int64_t>(index) + 1;
        const std::int64_t numerator = (reverse ? denominator - center : center) * source - destination;
        const std::int64_t lower = numerator >= 0 ? numerator / denominator
                                                  : -((-numerator + denominator - 1) / denominator);
        const auto remainder = numerator - lower * denominator;
        const auto weight = static_cast<std::uint32_t>((remainder * 256 + destination) / denominator);
        result.push_back({static_cast<std::size_t>(std::clamp<std::int64_t>(lower, 0, source - 1)),
                          static_cast<std::size_t>(std::clamp<std::int64_t>(lower + 1, 0, source - 1)), weight});
    }
    return result;
}

} // namespace

Image blit_resize(const BlitResizeRequest& request) {
    if (request.target != BlitTarget::rgba8 && request.target != BlitTarget::rgba32f) {
        throw std::invalid_argument("Unknown blit target format");
    }
    const auto bytes = to_rgba8(request.source);
    Image output(request.width, request.height);
    const auto columns = axis_samples(request.source.width, request.width);
    const auto rows = axis_samples(request.source.height, request.height, request.reverse_source_y);
    const auto stride = static_cast<std::size_t>(request.source.width) * 4;
    for (std::size_t y = 0; y < rows.size(); ++y) {
        const auto& row = rows[y];
        for (std::size_t x = 0; x < columns.size(); ++x) {
            const auto& column = columns[x];
            Pixel value{};
            for (std::size_t channel = 0; channel < 4; ++channel) {
                const auto upper = bytes[row.lower * stride + column.lower * 4 + channel] * (256 - column.weight)
                                 + bytes[row.lower * stride + column.upper * 4 + channel] * column.weight;
                const auto lower = bytes[row.upper * stride + column.lower * 4 + channel] * (256 - column.weight)
                                 + bytes[row.upper * stride + column.upper * 4 + channel] * column.weight;
                const auto weighted = upper * (256 - row.weight) + lower * row.weight;
                // Round the combined four-tap sum once, before normalized float conversion.
                value[channel] = static_cast<float>((weighted + 2048) / 4096) / 4080.0F;
            }
            output.pixels[y * columns.size() + x] = request.target == BlitTarget::rgba8 ? rgba8(value) : value;
        }
    }
    return output;
}

} // namespace softglow
