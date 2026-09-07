#include "gaussian.hpp"
#include "glow.hpp"
#include "pipeline.hpp"

#include <cmath>
#include <iostream>
#include <limits>
#include <map>
#include <stdexcept>
#include <string>

namespace {
using namespace softglow;
unsigned checks = 0;

void require(bool valid, const std::string& message) {
    ++checks;
    if (!valid) throw std::runtime_error(message);
}

void near(float actual, float expected, const std::string& message, float tolerance = 0.00001F) {
    require(std::isfinite(actual) && std::abs(actual - expected) <= tolerance, message);
}

void bytes(const Image& image, const std::vector<std::uint8_t>& expected, const std::string& label) {
    require(to_rgba8(image) == expected, label);
}

template <typename Action>
void rejects(Action action, const std::string& label) {
    bool rejected = false;
    try { action(); } catch (const std::invalid_argument&) { rejected = true; }
    require(rejected, label);
}

void mask_goldens() {
    GlowParameters parameters;
    const Image source(1, 1, {0.75F, 0.25F, 0, 0.5F});
    bytes(glow_mask({source, parameters, 1, 1}), {96, 32, 0, 64},
          "threshold .5: selected .5 / RGB sum1, alpha receives same gain");
    parameters.threshold = 1;
    bytes(glow_mask({Image(1, 1, {1, 1, 1, 1}), parameters, 1, 1}), {0, 0, 0, 0},
          "strict threshold comparison avoids 0/0 at cutoff1");
    parameters.threshold = 0.5F;
    parameters.threshold_color = {0.25F, 1, 0};
    bytes(glow_mask({source, parameters, 1, 1}), {0, 0, 0, 0},
          "per-channel cutoff and greater-than equality");
    parameters.threshold_color = {0, 0, 0};
    parameters.glow_from_alpha = 1;
    bytes(glow_mask({source, parameters, 1, 1}), {255, 255, 255, 128},
          "alpha-derived mode makes RGB white without replacing source alpha");
    parameters.glow_from_alpha = 0;
    bytes(glow_mask({Image(1, 1, {0, 0, 0, 1}), parameters, 1, 1}), {0, 0, 0, 0},
          "black mask finite with nonzero denominator floor");
    const auto enlarged = glow_mask({source, parameters, 3, 2});
    require(enlarged.width == 3 && enlarged.height == 2, "explicit mask target dimensions");
    for (const auto& pixel : enlarged.pixels) require(pixel == enlarged.pixels[0], "constant mask resampling");
}

void glow_plan_bounds() {
    GlowParameters parameters;
    parameters.glow_width = 0.13F;
    const auto scene = glow_plan({320, 180, parameters});
    require(scene.width == 240 && scene.height == 135, "scene target is 240x135");
    near(scene.radius, 31.2F, "radius in working pixels");
    parameters.quality = 0;
    const auto low = glow_plan({1280, 720, parameters});
    require(low.width == 120 && low.height == 67, "minimum cap and floor aspect scaling");
    parameters.quality = 1;
    const auto high = glow_plan({1280, 720, parameters});
    require(high.width == 360 && high.height == 202, "maximum cap and floor aspect scaling");
    const auto small = glow_plan({80, 11, parameters});
    require(small.width == 80 && small.height == 11, "small input does not upscale");
    parameters.quality = 0.201F;
    const auto fractional = glow_plan({320, 180, parameters});
    require(fractional.width == 241 && fractional.height == 135, "fractional cap dimensions floor");
    near(fractional.radius, 31.356F, "radius uses cap before integer dimension floor", 0.0001F);
    for (const int dimension : {0, -1, 16385, std::numeric_limits<int>::max()}) {
        rejects([&] { glow_plan({dimension, 1, parameters}); }, "invalid plan width");
        rejects([&] { glow_plan({1, dimension, parameters}); }, "invalid plan height");
    }
    rejects([&] { glow_plan({16384, 1, parameters}); }, "aspect ratio would produce empty height");
}

void packed_pass_goldens() {
    GlowParameters parameters;
    parameters.width_red = parameters.width_green = parameters.width_blue = 1;
    const Image source(1, 1, {0.25F, 0.5F, 0.75F, 1});
    const auto rg = glow_blur_pass({source, parameters, 0, false, 0});
    const auto ba = glow_blur_pass({source, parameters, 0, false, 2});
    bytes(rg, {63, 191, 127, 128}, "RG is two floor/fraction byte pairs");
    bytes(ba, {191, 64, 255, 0}, "BA reads channels2/3 before packing");
    bytes(glow_blur_pass({rg, parameters, 0, true, 0}), {63, 191, 127, 128},
          "vertical pass decodes packed RG before repacking");
    bytes(glow_blur_pass({ba, parameters, 0, true, 2}), {191, 64, 255, 0},
          "vertical BA uses pair decoder, not raw channels2/3");
    bytes(glow_blur_pass({source, parameters, 1, false, 0}), {63, 191, 127, 128},
          "reflect constant normalization preserves pair");
    parameters.edge = GlowEdge::transparent;
    // One tap on each side is outside; divisor is 1 + 2*exp(-2.88).
    bytes(glow_blur_pass({source, parameters, 1, false, 0}), {57, 80, 114, 161},
          "transparent edge keeps outside weights in denominator");
    bytes(glow_blur_pass({source, parameters, 1, false, 2}), {171, 241, 229, 67},
          "transparent edge alpha has independent packed slot");
    parameters.width_red = parameters.width_green = parameters.width_blue = 0;
    bytes(glow_blur_pass({source, parameters, 20, false, 2}), {191, 64, 255, 0},
          "all-zero RGB radii stop kernel even with nonzero alpha radius");
}

void composite_goldens() {
    const Image source(1, 1, {0.2F, 0.4F, 0.8F, 0.25F});
    const Image rg = from_rgba8({51, 0, 102, 0}, 1, 1);
    const Image ba = from_rgba8({153, 0, 127, 128}, 1, 1);
    GlowParameters parameters;
    parameters.brightness = 1;
    const std::array<std::pair<GlowCombine, std::vector<std::uint8_t>>, 5> expected{{
        {GlowCombine::screen, {92, 163, 235, 159}},
        {GlowCombine::add, {102, 204, 255, 159}},
        {GlowCombine::multiply, {10, 41, 122, 159}},
        {GlowCombine::difference, {0, 0, 51, 159}},
        {GlowCombine::overlay, {20, 82, 214, 159}},
    }};
    for (const auto& [mode, pixel] : expected) {
        parameters.combine = mode;
        bytes(glow_composite({source, rg, ba, parameters}), pixel, "known composite equation and unchanged alpha formula");
    }
    parameters.combine = GlowCombine::screen;
    parameters.light_background = 1;
    bytes(glow_composite({source, rg, ba, parameters}), {51, 102, 204, 159},
          "light background suppresses RGB glow but not glow alpha");
    parameters.light_background = 0;
    parameters.glow_under_source = 1;
    bytes(glow_composite({source, rg, ba, parameters}), {92, 163, 245, 159},
          "under-source RGB uses original while alpha still uses blur");
    parameters.glow_under_source = 0;
    parameters.source_opacity = 0;
    parameters.glow_color = {0, 1, 0};
    bytes(glow_composite({source, rg, ba, parameters}), {0, 102, 0, 159},
          "channel tint affects RGB only");
    const Image wide(3, 2, source.pixels[0]);
    const auto sampled = glow_composite({wide, rg, ba, parameters});
    require(sampled.width == 3 && sampled.height == 2, "composite returns full source dimensions");
    for (const auto& pixel : sampled.pixels) require(pixel == sampled.pixels[0], "packed targets may be smaller than source");
}

void gaussian_axis_goldens() {
    GaussianParams parameters;
    parameters.intensity = 1;
    parameters.quality = 0.5F;
    parameters.normalization_size = 1;
    parameters.radius_over_sigma = 1;
    parameters.inverse_gamma = false;
    parameters.direction = GaussianDirection::horizontal;
    const Image source = from_rgba8({0, 0, 0, 255, 255, 0, 0, 0}, 2, 1);
    // Two taps at .25/.5 UV; weights exp(-.125), exp(-.5).
    bytes(gaussian_axis({source, 4, 2, parameters, GaussianDirection::horizontal}),
          {79, 0, 0, 176, 176, 0, 0, 79}, "renormalized two-pixel analytic Gaussian");
    parameters.border = GaussianBorder::black;
    bytes(gaussian_axis({source, 4, 2, parameters, GaussianDirection::horizontal}),
          {67, 0, 0, 149, 149, 0, 0, 67}, "black Gaussian keeps missing sample weight");
    parameters.blur_alpha = false;
    bytes(gaussian_axis({source, 4, 2, parameters, GaussianDirection::horizontal}),
          {67, 0, 0, 255, 149, 0, 0, 0}, "disabled alpha blur retains center alpha");
    parameters.direction = GaussianDirection::vertical;
    const Image column = from_rgba8({0, 0, 0, 255, 255, 0, 0, 0}, 1, 2);
    bytes(gaussian_axis({column, 2, 4, parameters, GaussianDirection::vertical}),
          {67, 0, 0, 255, 149, 0, 0, 0}, "vertical axis uses original height consistently");
    rejects([&] { gaussian_axis({source, 4, 2, parameters, GaussianDirection::horizontal}); }, "disabled axis rejected");
    rejects([&] { gaussian_axis({column, 2, 4, parameters, GaussianDirection::both}); }, "axis cannot select both");
    rejects([&] { gaussian_axis({column, 2, 4, parameters, static_cast<GaussianDirection>(90)}); }, "invalid axis enum");
    rejects([&] { gaussian_axis({source, 2, 4, parameters, GaussianDirection::vertical}); }, "working dimensions must match plan");
}

void parameter_goldens() {
    for (const auto mode : {IntensityMode::output_mix, IntensityMode::ui_snapshot}) {
        const auto zero = pipeline_parameters({0, mode});
        const auto full = pipeline_parameters({1, mode});
        near(zero.soft_light.opacity, 0.7F, "fixed soft-light opacity");
        near(zero.soft_light.scale_x, 1.03F, "fixed soft-light scale");
        near(zero.normal.opacity, 0.64F, "fixed final opacity");
        near(full.glow.threshold, 0.84F, "full strength scene threshold");
        near(full.glow.brightness, 2.4F, "full strength scene brightness");
        near(full.lut_opacity, 0.8F, "full strength LUT opacity");
        near(zero.glow.threshold, mode == IntensityMode::output_mix ? 0.84F : 1, "zero modes differ at threshold");
        near(zero.lut_opacity, mode == IntensityMode::output_mix ? 0.8F : 0, "zero modes differ at LUT");
    }
    const auto middle = pipeline_parameters({0.37F, IntensityMode::ui_snapshot});
    near(middle.glow.threshold, 0.93525F, "UI37 threshold");
    near(middle.glow.brightness, 1.11F, "UI37 brightness");
    near(middle.lut_opacity, 0.296F, "UI37 LUT");
    const auto boundary = pipeline_parameters({0.8F, IntensityMode::ui_snapshot});
    const auto after = pipeline_parameters({std::nextafter(0.8F, 1.0F), IntensityMode::ui_snapshot});
    near(boundary.glow.threshold, 0.86F, "exact .8 takes low branch");
    near(after.glow.threshold, 0.84F, "next representable strength takes scene branch");
    for (const auto value : {-0.01F, 1.01F, std::numeric_limits<float>::infinity(), std::numeric_limits<float>::quiet_NaN()}) {
        rejects([&] { pipeline_parameters({value, IntensityMode::ui_snapshot}); }, "invalid pipeline intensity");
    }
    rejects([] { pipeline_parameters({0.5F, static_cast<IntensityMode>(-1)}); }, "invalid intensity mode");
}

void invalid_stages() {
    const Image source(1, 1);
    GlowParameters parameters;
    const float nan = std::numeric_limits<float>::quiet_NaN();
    for (const auto member : {&GlowParameters::threshold, &GlowParameters::brightness,
          &GlowParameters::glow_width, &GlowParameters::width_x, &GlowParameters::width_y,
          &GlowParameters::width_red, &GlowParameters::width_green, &GlowParameters::width_blue,
          &GlowParameters::source_opacity, &GlowParameters::quality, &GlowParameters::dither,
          &GlowParameters::glow_from_alpha, &GlowParameters::glow_under_source,
          &GlowParameters::bg_brightness, &GlowParameters::light_background}) {
        auto invalid = parameters;
        invalid.*member = nan;
        rejects([&] { glow_plan({1, 1, invalid}); }, "NaN glow plan parameter");
        rejects([&] { glow_mask({source, invalid, 1, 1}); }, "NaN mask parameter");
        rejects([&] { glow_blur_pass({source, invalid, 0, false, 0}); }, "NaN blur parameter");
        rejects([&] { glow_composite({source, source, source, invalid}); }, "NaN composite parameter");
    }
    for (const float radius : {-1.0F, 360.1F, nan, std::numeric_limits<float>::infinity()}) {
        rejects([&] { glow_blur_pass({source, parameters, radius, false, 0}); }, "invalid radius");
    }
    for (const std::size_t channel : {std::size_t{1}, std::size_t{3}, std::numeric_limits<std::size_t>::max()}) {
        rejects([&] { glow_blur_pass({source, parameters, 0, false, channel}); }, "invalid channel pair");
    }
    for (int dimension : {0, -1, 16385}) {
        rejects([&] { glow_mask({source, parameters, dimension, 1}); }, "invalid mask width");
        rejects([&] { glow_mask({source, parameters, 1, dimension}); }, "invalid mask height");
    }
    auto invalid = parameters;
    invalid.edge = static_cast<GlowEdge>(-1);
    rejects([&] { glow_blur_pass({source, invalid, 0, false, 0}); }, "invalid edge enum");
    invalid = parameters;
    invalid.combine = static_cast<GlowCombine>(99);
    rejects([&] { glow_composite({source, source, source, invalid}); }, "invalid combine enum");
    invalid = parameters;
    invalid.glow_color[2] = nan;
    rejects([&] { glow_mask({source, invalid, 1, 1}); }, "NaN color parameter");
    rejects([&] { glow_composite({source, source, Image(2, 1), parameters}); }, "packed texture dimensions differ");
    Image malformed(1, 1);
    malformed.pixels.clear();
    rejects([&] { glow_mask({malformed, parameters, 1, 1}); }, "truncated mask input");
    rejects([&] { glow_blur_pass({malformed, parameters, 0, false, 0}); }, "truncated blur input");
    rejects([&] { glow_composite({source, source, malformed, parameters}); }, "truncated packed input");
    malformed = source;
    malformed.pixels[0][0] = nan;
    rejects([&] { glow_mask({malformed, parameters, 1, 1}); }, "nonfinite mask input");
    rejects([&] { gaussian_axis({malformed, 2, 2}); }, "nonfinite axis input");
    for (const auto member : {&GaussianParams::intensity, &GaussianParams::quality,
          &GaussianParams::horizontal_strength, &GaussianParams::vertical_strength,
          &GaussianParams::gamma, &GaussianParams::normalization_size,
          &GaussianParams::radius_over_sigma, &GaussianParams::space_dither}) {
        GaussianParams params;
        params.*member = nan;
        rejects([&] { gaussian_axis({source, 2, 2, params}); }, "NaN Gaussian stage parameter");
    }
}

void public_replay() {
    Image source(7, 5);
    for (int y = 0; y < source.height; ++y) {
        for (int x = 0; x < source.width; ++x) {
            source.at(x, y) = {x / 6.0F, y / 4.0F, (x + y) / 10.0F, 1};
        }
    }
    const auto parameters = pipeline_parameters({0.37F, IntensityMode::ui_snapshot}).glow;
    std::map<std::string, Image> recorded;
    const auto output = glow(source, parameters, [&](std::string_view name, const Image& image) {
        recorded.emplace(std::string(name), image);
    });
    const auto plan = glow_plan({source.width, source.height, parameters});
    const auto mask = glow_mask({source, parameters, plan.width, plan.height});
    const auto hrg = glow_blur_pass({mask, parameters, plan.radius, false, 0});
    const auto hba = glow_blur_pass({mask, parameters, plan.radius, false, 2});
    const auto vrg = glow_blur_pass({hrg, parameters, plan.radius, true, 0});
    const auto vba = glow_blur_pass({hba, parameters, plan.radius, true, 2});
    bytes(mask, to_rgba8(recorded.at("glow.mask")), "public mask connected to graph");
    bytes(hrg, to_rgba8(recorded.at("glow.horizontal_rg")), "public RG connected to graph");
    bytes(hba, to_rgba8(recorded.at("glow.horizontal_ba")), "public BA connected to independent mask input");
    bytes(glow_composite({source, vrg, vba, parameters}), to_rgba8(output), "public pass replay connects to graph output");
    require(recorded.size() == 6, "six named SGlow stages");
}
}

int main() {
    mask_goldens();
    glow_plan_bounds();
    packed_pass_goldens();
    composite_goldens();
    gaussian_axis_goldens();
    parameter_goldens();
    invalid_stages();
    public_replay();
    std::cout << checks << " stage contract checks passed\n";
}
