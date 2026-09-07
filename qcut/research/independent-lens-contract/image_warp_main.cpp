#include "image_warp.hpp"

#include <charconv>
#include <cstdio>
#include <iostream>
#include <stdexcept>
#include <string_view>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace {
template <typename Value>
Value number(const char* argument) {
  const std::string_view text(argument);
  Value value{};
  const auto parsed = std::from_chars(text.data(), text.data() + text.size(), value);
  if (parsed.ec != std::errc{} || parsed.ptr != text.data() + text.size()) {
    throw std::runtime_error("Invalid numeric argument");
  }
  return value;
}

std::size_t pixel_count(int width, int height) {
  if (width <= 0 || height <= 0 || width > lens_contract::max_image_dimension ||
      height > lens_contract::max_image_dimension) throw std::runtime_error("Invalid dimensions");
  const auto count = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
  if (count > lens_contract::max_image_pixels) throw std::runtime_error("Image exceeds pixel limit");
  return count;
}
}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 11) {
      throw std::runtime_error("Usage: lens-image-warp W H OUT_W OUT_H a b tx c d ty < input.rgba > output.rgba");
    }
#ifdef _WIN32
    if (_setmode(_fileno(stdin), _O_BINARY) == -1 ||
        _setmode(_fileno(stdout), _O_BINARY) == -1) throw std::runtime_error("Cannot set binary I/O");
#endif
    const int width = number<int>(argv[1]);
    const int height = number<int>(argv[2]);
    lens_contract::AffineWarpRequest request{{}, number<int>(argv[3]), number<int>(argv[4])};
    pixel_count(request.width, request.height);
    for (std::size_t index = 0; index < 6; ++index) {
      request.source_to_destination[index] = number<float>(argv[index + 5]);
    }
    std::vector<std::uint8_t> input(pixel_count(width, height) * 4);
    std::cin.read(reinterpret_cast<char*>(input.data()), static_cast<std::streamsize>(input.size()));
    if (std::cin.gcount() != static_cast<std::streamsize>(input.size()) ||
        std::cin.peek() != std::char_traits<char>::eof() || std::cin.bad()) {
      throw std::runtime_error("Input must contain exactly W * H * 4 packed RGBA bytes");
    }
    lens_contract::AffineWarpResult output;
    if (!lens_contract::warp_affine_rgba({input, width, height, static_cast<std::size_t>(width) * 4},
                                        request, output)) {
      throw std::runtime_error("Affine request outside the supported finite domain");
    }
    std::cout.write(reinterpret_cast<const char*>(output.rgba.data()),
                    static_cast<std::streamsize>(output.rgba.size()));
    std::cout.flush();
    if (!std::cout) throw std::runtime_error("Output write failed");
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
