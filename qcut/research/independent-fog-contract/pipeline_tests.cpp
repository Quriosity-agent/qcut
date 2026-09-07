#include "pipeline.hpp"
#include "blur.hpp"
#include "composite.hpp"
#include "test_support.hpp"

#include "image_io.hpp"
#include "lut.hpp"
#include "output_mix.hpp"

#include <iostream>
#include <limits>
#include <string>
#include <vector>

namespace {
using namespace fog_contract;
using namespace fog_test;
using softglow::Image;

void blend() {
    const Image original(1, 1, {0.25F, 0.25F, 0.25F, 1});
    const Image bright(1, 1, {0.75F, 0.75F, 0.75F, 0});
    // No shadow mask: softened=3/4, screen=13/16, quarter-mix=51/64; half original=67/128.
    const auto output = softglow::to_rgba8(composite({original, bright, 0.5F}));
    require(output[0] == 133 && output[1] == 133 && output[2] == 133 && output[3] == 255, "Fog composite arithmetic changed");
    const Image dark_mask(1, 1, {0.75F, 0.75F, 0.75F, 1});
    require(softglow::to_rgba8(composite({original, dark_mask, 0.5F}))[0] == 110, "Shadow mask coefficient changed");
    require(softglow::to_rgba8(composite({original, bright, 1})) == softglow::to_rgba8(original), "Full original weight is not identity");
    const Image translucent(1, 1, {0.1F, 0.1F, 0.1F, 0.2F});
    const auto clamped = softglow::to_rgba8(composite({translucent, bright, 0}));
    require(clamped == std::vector<std::uint8_t>({51, 51, 51, 51}), "Composite did not clamp to original alpha");
    rejects([&] { composite({original, Image(2, 1), 0.5F}); });
    rejects([&] { composite({original, bright, -1}); });
}

void graph() {
    const auto atlas = softglow::identity_lut();
    const auto source = softglow::test_chart(43, 29);
    const auto before = softglow::to_rgba8(source);
    std::vector<std::string> stages;
    softglow::StageSink sink = [&](std::string_view name, const Image& image) {
        stages.emplace_back(name);
        require(image.width == source.width && image.height == source.height, "Graph resized a full-resolution target");
        require(softglow::to_rgba8(image).size() == before.size(), "Trace output shape differs");
        for (const auto& pixel : image.pixels)
            require(pixel == softglow::rgba8(pixel), "A pass skipped its RGBA8 target conversion");
    };
    const auto zero = render({source, atlas, 0, sink});
    require(softglow::to_rgba8(zero) == before, "Zero strength is not exact identity");
    require(stages == std::vector<std::string>({"00-input", "01-blur-x", "02-blur-y", "03-fog", "04-lut"}), "Graph dependency/trace order changed");
    const auto full = render({source, atlas, 1, {}});
    const auto partial = render({source, atlas, 0.37, {}});
    require(softglow::to_rgba8(partial) != softglow::to_rgba8(softglow::mix_output({source, full, 0.37})),
        "Intensity was replaced by final output mixing");
    for (double strength : {0.37, 1.0, 0.0, 1.0, 0.37}) {
        const auto output = softglow::to_rgba8(render({source, atlas, strength, {}}));
        const auto expected = strength == 0 ? before : softglow::to_rgba8(strength == 1 ? full : partial);
        require(output == expected, "Rendering depends on prior invocation order");
        for (std::size_t channel = 3; channel < output.size(); channel += 4) require(output[channel] == 255, "Output alpha changed");
    }
    require(softglow::to_rgba8(source) == before, "Source was mutated");
    const auto p = parameters(0.37);
    require(p.blur_size == 1.332F && p.original_weight == 0.815F && p.lut_opacity == 0.37F, "Intensity uniform conversion changed");
    rejects([&] { render({source, Image(4, 4), 0, {}}); });
    rejects([&] { render({Image(1, 1, {0, 0, 0, 0.5F}), atlas, 1, {}}); });
    for (double strength : {-0.01, 1.01, std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()})
        rejects([&] { render({source, atlas, strength, {}}); });
    const Image black(1, 1, {0, 0, 0, 1}), white(1, 1, {1, 1, 1, 1});
    require(softglow::to_rgba8(render({black, atlas, 1, {}})) == softglow::to_rgba8(black), "Tiny black changed");
    require(softglow::to_rgba8(render({white, atlas, 1, {}})) == softglow::to_rgba8(white), "Tiny white changed");
}
} // namespace

int main() {
    try {
        blend(); graph();
        std::cout << fog_test::checks << " fog pipeline checks passed\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n'; return 1;
    }
}
