#include "pipeline.hpp"

#include "image_io.hpp"
#include "lut.hpp"

#include <charconv>
#include <chrono>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
struct Options {
    std::filesystem::path input, output, lut, trace;
    int width = 320, height = 180;
    double intensity = 1;
    bool demo = false;
};

template<typename Number> Number parse_number(const std::string& text) {
    Number value{};
    const auto parsed = std::from_chars(text.data(), text.data() + text.size(), value);
    if (parsed.ec != std::errc{} || parsed.ptr != text.data() + text.size()) {
        throw std::invalid_argument("Invalid numeric argument: " + text);
    }
    return value;
}

Options parse(int argc, char** argv) {
    Options options;
    for (int index = 1; index < argc; ++index) {
        const std::string flag(argv[index]);
        if (flag == "--demo") { options.demo = true; continue; }
        if (++index == argc) throw std::invalid_argument("Missing value for " + flag);
        const std::string value(argv[index]);
        if (flag == "--input") options.input = value;
        else if (flag == "--output") options.output = value;
        else if (flag == "--lut") options.lut = value;
        else if (flag == "--trace") options.trace = value;
        else if (flag == "--width") options.width = parse_number<int>(value);
        else if (flag == "--height") options.height = parse_number<int>(value);
        else if (flag == "--intensity") options.intensity = parse_number<double>(value);
        else throw std::invalid_argument("Unknown option: " + flag);
    }
    if (options.output.empty() || options.demo == !options.input.empty()) {
        throw std::invalid_argument("Provide --output and exactly one of --demo or --input");
    }
    fog_contract::parameters(options.intensity);
    return options;
}
} // namespace

int main(int argc, char** argv) {
    if (argc == 1 || (argc == 2 && std::string(argv[1]) == "--help")) {
        std::cout << "independent-fog --demo | --input IN.rgba --output OUT.rgba|OUT.ppm\n"
                     "  [--width 320 --height 180] [--intensity 1] [--lut LUT.rgba] [--trace DIR]\n"
                     "Input: opaque top-down RGBA8 SDR. LUT: 512x512 tiled 64-cube.\n"
                     "Omit --lut for an original identity atlas; the reference grade requires an external asset.\n";
        return 0;
    }
    try {
        const auto options = parse(argc, argv);
        const auto input = options.demo ? softglow::test_chart(options.width, options.height)
                                        : softglow::read_raw(options.input, options.width, options.height);
        const auto atlas = options.lut.empty() ? softglow::identity_lut()
                                             : softglow::read_raw(options.lut, 512, 512);
        softglow::StageSink sink;
        if (!options.trace.empty()) {
            std::filesystem::create_directories(options.trace);
            sink = [&](std::string_view name, const softglow::Image& image) {
                softglow::write_raw(options.trace / (std::string(name) + ".rgba"), image);
            };
        }
        const auto start = std::chrono::steady_clock::now();
        const auto result = fog_contract::render({input, atlas, options.intensity, sink});
        if (options.output.extension() == ".ppm") softglow::write_ppm(options.output, result);
        else softglow::write_raw(options.output, result);
        const double seconds = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
        std::cout << std::setprecision(17) << "{\"width\":" << result.width << ",\"height\":" << result.height
                  << ",\"intensity\":" << options.intensity << ",\"seconds\":" << seconds
                  << ",\"lut\":\"" << (options.lut.empty() ? "identity-demo" : "external-atlas") << "\"}\n";
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
