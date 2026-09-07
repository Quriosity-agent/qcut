#include "gaussian.hpp"
#include "glow.hpp"
#include "image_io.hpp"
#include "layer.hpp"
#include "lut.hpp"
#include "pipeline.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <stdexcept>

namespace {

int dimension(std::string_view value) {
    int result = 0;
    const auto parsed = std::from_chars(value.data(), value.data() + value.size(), result);
    if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size() || result < 1 || result > 16384) {
        throw std::invalid_argument("Replay dimensions must be integers in [1, 16384]");
    }
    return result;
}

void replay(const std::filesystem::path& input, const std::filesystem::path& output,
            const std::filesystem::path& lut_path, int width, int height) {
    using namespace softglow;
    if (std::filesystem::exists(output)) throw std::invalid_argument("Replay output directory must be new");
    const auto source = read_raw(input / "00-input.rgba", width, height);
    const auto lut = read_raw(lut_path, 512, 512);
    const auto parameters = pipeline_parameters({1, IntensityMode::output_mix});
    const auto gaussian = gaussian_plan({width, height});
    const auto [glow_w, glow_h, radius] = glow_plan({width, height, parameters.glow});
    const auto read_gaussian = [&](const char* name) {
        return read_raw(input / (std::string(name) + ".rgba"), gaussian.work_width, gaussian.work_height);
    };
    const auto read_glow = [&](const char* name) {
        return read_raw(input / (std::string(name) + ".rgba"), glow_w, glow_h);
    };
    const auto downsampled = read_gaussian("gaussian.downsample");
    const auto horizontal = read_gaussian("gaussian.x");
    const auto vertical = read_gaussian("gaussian.y");
    const auto blurred = read_raw(input / "gaussian.output.rgba", width, height);
    const auto base = read_raw(input / "02-soft-light.rgba", width, height);
    const auto mask = read_glow("glow.mask");
    const auto horizontal_rg = read_glow("glow.horizontal_rg");
    const auto vertical_rg = read_glow("glow.vertical_rg");
    const auto horizontal_ba = read_glow("glow.horizontal_ba");
    const auto vertical_ba = read_glow("glow.vertical_ba");
    const auto glowing = read_raw(input / "03-glow.rgba", width, height);
    const auto graded = read_raw(input / "04-lut.rgba", width, height);
    std::filesystem::create_directories(output);
    const auto write = [&](const char* name, const Image& image) {
        write_raw(output / (std::string(name) + ".rgba"), image);
    };
    write("gaussian.downsample", resize(source, gaussian.work_width, gaussian.work_height));
    write("gaussian.x", gaussian_axis({downsampled, width, height, {}, GaussianDirection::horizontal}));
    write("gaussian.y", gaussian_axis({horizontal, width, height, {}, GaussianDirection::vertical}));
    write("gaussian.output", resize(vertical, width, height));
    write("02-soft-light", composite_layer({source, blurred, parameters.soft_light}));
    write("glow.mask", glow_mask({base, parameters.glow, glow_w, glow_h}));
    write("glow.horizontal_rg", glow_blur_pass({mask, parameters.glow, radius, false, 0}));
    write("glow.vertical_rg", glow_blur_pass({horizontal_rg, parameters.glow, radius, true, 0}));
    write("glow.horizontal_ba", glow_blur_pass({mask, parameters.glow, radius, false, 2}));
    write("glow.vertical_ba", glow_blur_pass({horizontal_ba, parameters.glow, radius, true, 2}));
    write("03-glow", glow_composite({base, vertical_rg, vertical_ba, parameters.glow}));
    write("04-lut", apply_lut(glowing, lut, parameters.lut_opacity));
    write("05-normal", composite_layer({base, graded, parameters.normal}));
}

} // namespace

int main(int argc, char** argv) {
    try {
        if (argc != 6) throw std::invalid_argument("Usage: soft-glow-stage-replay input-directory width height lut.rgba new-output-directory");
        replay(argv[1], argv[5], argv[4], dimension(argv[2]), dimension(argv[3]));
        std::cout << "Replayed 13 stages using their supplied upstream inputs\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
