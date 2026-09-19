// Local CPU oracle. The caller pins library/model hashes before invocation.
#include <dlfcn.h>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

template <typename T> T symbol(void *library, const char *name) {
  void *value = dlsym(library, name);
  if (!value) throw std::runtime_error(std::string("missing symbol: ") + name);
  return reinterpret_cast<T>(value);
}

struct TensorView { void *data; int32_t dims[4]; int32_t dtype, other; };
static_assert(sizeof(TensorView) == 32);

std::vector<char> read(const std::filesystem::path &path, size_t limit) {
  const auto bytes = std::filesystem::file_size(path);
  if (bytes == 0 || bytes > limit) throw std::runtime_error("invalid input file size");
  std::vector<char> data(bytes);
  std::ifstream stream(path, std::ios::binary);
  if (!stream.read(data.data(), data.size())) throw std::runtime_error("input read failed");
  return data;
}

void write(const std::filesystem::path &path, const void *data, size_t bytes) {
  std::ofstream stream(path, std::ios::binary);
  if (!stream.write(static_cast<const char *>(data), bytes)) throw std::runtime_error("output write failed");
}

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  if (argc != 6) {
    fprintf(stderr, "usage: facefitting_oracle <library> <graph> <arena> <cases-dir> <output-name>\n");
    return 2;
  }
  try {
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
    if (!library) throw std::runtime_error(dlerror());
    auto graphBytes = read(argv[2], 8192);
    const std::string graph(graphBytes.begin(), graphBytes.end());
    auto weights = read(argv[3], 4 * 1024 * 1024);
    alignas(16) unsigned char engine[256]{};
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorC1Ev")(engine);
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu25ThrustorEnforceCPURuntimeEPNS_8ThrustorE")(engine);
    auto create = symbol<int (*)(void *, const std::string &, void *, std::vector<std::string> &)>(library,
      "_ZN10bytenn_cpu8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
    std::vector<std::string> names;
    int rc = create(engine, graph, weights.data(), names);
    printf("create=%d output_names=%zu\n", rc, names.size());
    if (rc) return 1;
    const int forwardType = symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor14GetForwardTypeEv")(engine);
    printf("forced_cpu=true forward_type=%d\n", forwardType);
    if (forwardType != 0) throw std::runtime_error("CPU forward type not selected");
    std::ofstream runtime(std::filesystem::path(argv[4]) / "native-runtime.json");
    runtime << "{\"forced_cpu\":true,\"forward_type\":" << forwardType << "}\n";
    runtime.close();
    auto set = symbol<int (*)(void *, std::string, void *, int, int, int)>(library,
      "_ZN10bytenn_cpu8Thrustor8SetInputENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPviii");
    auto run = symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor9InferenceEv");
    auto extract = symbol<TensorView (*)(void *, const std::string &)>(library,
      "_ZN10bytenn_cpu8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
    size_t cases = 0;
    for (const auto &entry : std::filesystem::directory_iterator(argv[4])) {
      if (!entry.is_directory() || entry.path().filename().string().rfind("case-", 0) != 0) continue;
      const auto path = entry.path();
      auto inputBytes = read(path / "input.f32", 212 * sizeof(float));
      if (inputBytes.size() != 212 * sizeof(float)) throw std::runtime_error("expected 212 input floats");
      // SetInput's first integer is a byte count, not an image dimension.
      rc = set(engine, "data", inputBytes.data(), static_cast<int>(inputBytes.size()), 0, 0);
      printf("%s set=%d\n", path.filename().c_str(), rc);
      if (rc) return 1;
      TensorView echoed = extract(engine, "data");
      if (!echoed.data) throw std::runtime_error("missing native input echo");
      size_t inputCount = 1;
      for (int dim : echoed.dims) {
        if (dim < 1 || dim > 1024) throw std::runtime_error("invalid echoed input shape");
        inputCount *= dim;
      }
      if (inputCount != 212) throw std::runtime_error("native input shape mismatch");
      write(path / "native-input.f32", echoed.data, inputBytes.size());
      rc = run(engine);
      printf("%s run=%d\n", path.filename().c_str(), rc);
      if (rc) return 1;
      const std::string outputName = argv[5];
      TensorView output = extract(engine, outputName);
      if (!output.data) throw std::runtime_error("missing declared graph output");
      size_t count = 1;
      for (int dim : output.dims) {
        if (dim < 1 || dim > 1024) throw std::runtime_error("invalid native output shape");
        count *= dim;
      }
      if (count != 442) throw std::runtime_error("expected 442 output floats");
      write(path / "native-output.f32", output.data, count * sizeof(float));
      std::ofstream shape(path / "native-shape.json");
      shape << "[" << output.dims[0] << "," << output.dims[1] << "," << output.dims[2] << "," << output.dims[3] << "]\n";
      printf("%s output=%d,%d,%d,%d\n", path.filename().c_str(), output.dims[0], output.dims[1], output.dims[2], output.dims[3]);
      ++cases;
    }
    if (cases == 0) throw std::runtime_error("empty native case set");
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorD1Ev")(engine);
    printf("completed_cases=%zu\n", cases);
    return 0;
  } catch (const std::exception &error) {
    fprintf(stderr, "%s\n", error.what());
    return 1;
  }
}
