// Private OCR probe; caller pins source/runtime hashes and confines all output.
#include <dlfcn.h>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

template <typename T> T symbol(void *library, const char *name) {
  auto value = dlsym(library, name);
  if (!value) throw std::runtime_error(std::string("missing symbol: ") + name);
  return reinterpret_cast<T>(value);
}
struct Tensor { void *data; int32_t dims[4]; int32_t raw24, raw28; };
static_assert(sizeof(Tensor) == 32);

std::vector<char> read(const std::filesystem::path &path, size_t limit) {
  auto size = std::filesystem::file_size(path);
  if (!size || size > limit) throw std::runtime_error("invalid file size");
  std::vector<char> bytes(size);
  std::ifstream stream(path, std::ios::binary);
  if (!stream.read(bytes.data(), size)) throw std::runtime_error("read failed");
  return bytes;
}
void dump(const std::filesystem::path &path, const Tensor &tensor, std::ostream &desc, const std::string &name) {
  size_t count = 1;
  for (int size : tensor.dims) {
    if (size < 1 || size > 16384) throw std::runtime_error("invalid native dimensions");
    count *= size;
  }
  if (!tensor.data || count > 64 * 1024 * 1024) throw std::runtime_error("invalid tensor storage");
  std::ofstream file(path, std::ios::binary);
  if (!file.write(static_cast<char *>(tensor.data), count * 4)) throw std::runtime_error("write failed");
  desc << name;
  for (int size : tensor.dims) desc << '\t' << size;
  desc << '\t' << tensor.raw24 << '\t' << tensor.raw28 << '\n';
}

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  if (argc != 5) return 2;
  try {
    const bool conversionOnly = std::string(argv[1]) == "--widen";
    auto library = dlopen(argv[conversionOnly ? 2 : 1], RTLD_NOW | RTLD_GLOBAL);
    if (!library) throw std::runtime_error(dlerror());
    if (conversionOnly) {
      auto bytes = read(argv[3], 1024 * 1024);
      if (bytes.size() % 2) throw std::runtime_error("odd FP16 byte count");
      std::vector<float> values(bytes.size() / 2);
      symbol<void (*)(uint16_t *, float *, int)>(library,
        "_ZN6BYTENN30float16buffer_to_float32bufferEPtPfi")(
          reinterpret_cast<uint16_t *>(bytes.data()), values.data(), static_cast<int>(values.size()));
      std::ofstream(argv[4], std::ios::binary).write(reinterpret_cast<char *>(values.data()), values.size() * 4);
      return 0;
    }
    auto graphBytes = read(argv[2], 65536);
    std::string graph(graphBytes.begin(), graphBytes.end());
    auto arena = read(argv[3], 32 * 1024 * 1024);
    const std::filesystem::path out(argv[4]);
    if (graph.rfind("E\\n\n", 0) != 0 || arena.size() < 6 || (arena.size() - 4) % 2)
      throw std::runtime_error("expected bounded E-prefix FP16 model");
    const size_t elements = (arena.size() - 4) / 2;
    std::vector<float> expanded(elements + 1);
    symbol<void (*)(uint16_t *, float *, int)>(library,
      "_ZN6BYTENN30float16buffer_to_float32bufferEPtPfi")(
        reinterpret_cast<uint16_t *>(arena.data()), expanded.data(), static_cast<int>(elements));
    std::memcpy(expanded.data() + elements, arena.data() + arena.size() - 4, 4);
    // CheckFp16AndConvertModel removes E and widens only the payload, retaining the graph stamp.
    graph = graph.substr(4);
    std::ofstream(out / "native-expanded.private.bin", std::ios::binary).write(
      reinterpret_cast<char *>(expanded.data()), expanded.size() * 4);
    std::ofstream(out / "native-graph.private.txt") << graph;
    alignas(16) unsigned char engine[256]{};
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorC1Ev")(engine);
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu25ThrustorEnforceCPURuntimeEPNS_8ThrustorE")(engine);
    std::vector<std::string> requested;
    std::ifstream requestedFile(out / "outputs.txt");
    std::string name;
    while (std::getline(requestedFile, name)) if (!name.empty()) requested.push_back(name);
    if (requested.empty()) throw std::runtime_error("empty requested tensor list");
    auto create = symbol<int (*)(void *, const std::string &, void *, std::vector<std::string> &)>(library,
      "_ZN10bytenn_cpu8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
    auto retained = requested;
    int rc = create(engine, graph, expanded.data(), retained);
    printf("create=%d\n", rc);
    if (rc) return 1;
    int type = symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor14GetForwardTypeEv")(engine);
    if (type != 0) throw std::runtime_error("CPU was not selected");
    std::ofstream(out / "runtime.json") << "{\"forced_cpu\":true,\"forward_type\":0}\n";
    auto reshape = symbol<int (*)(void *, int, int)>(library, "_ZN10bytenn_cpu8Thrustor12ReInferShapeEii");
    auto extract = symbol<Tensor (*)(void *, const std::string &)>(library,
      "_ZN10bytenn_cpu8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
    const auto declared = extract(engine, "data");
    std::ofstream(out / "declared-input-shape.json") << "[" << declared.dims[0] << ","
      << declared.dims[1] << "," << declared.dims[2] << "," << declared.dims[3] << "]\n";
    auto set = symbol<int (*)(void *, std::string, void *, int, int, int)>(library,
      "_ZN10bytenn_cpu8Thrustor8SetInputENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPviii");
    auto run = symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor9InferenceEv");
    size_t cases = 0;
    for (const auto &entry : std::filesystem::directory_iterator(out)) {
      if (!entry.is_directory() || entry.path().filename().string().rfind("case-", 0) != 0) continue;
      const auto path = entry.path();
      std::ifstream shape(path / "shape.txt");
      int height = 0, width = 0;
      shape >> height >> width;
      if (height < 32 || width < 32 || height > 2048 || width > 2048 || height % 32 || width % 32)
        throw std::runtime_error("invalid research shape");
      rc = std::filesystem::exists(out / "keep-original-shape") ? 0 : reshape(engine, width, height);
      printf("%s reshape=%d width=%d height=%d\n", path.filename().c_str(), rc, width, height);
      if (rc) return 1;
      auto input = read(path / "input.f32", 2048 * 2048 * 3 * 4);
      if (input.size() != size_t(height) * width * 3 * 4) throw std::runtime_error("input byte count mismatch");
      rc = set(engine, "data", input.data(), static_cast<int>(input.size()), 0, 0);
      if (rc) throw std::runtime_error("SetInput failed");
      auto echo = extract(engine, "data");
      const int expected[] = {1, width, height, 3};
      if (!echo.data || std::memcmp(echo.dims, expected, sizeof(expected)) != 0)
        throw std::runtime_error("input descriptor differs from NWHC");
      if (std::memcmp(echo.data, input.data(), input.size()) != 0) throw std::runtime_error("input echo differs");
      std::ofstream desc(path / "descriptors.tsv");
      dump(path / "native-input.f32", echo, desc, "data");
      rc = run(engine);
      printf("%s inference=%d\n", path.filename().c_str(), rc);
      if (rc) return 1;
      for (size_t i = 0; i < requested.size(); ++i)
        dump(path / ("native-" + std::to_string(i) + ".f32"), extract(engine, requested[i]), desc, requested[i]);
      ++cases;
    }
    if (!cases) throw std::runtime_error("empty native case set");
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorD1Ev")(engine);
    printf("completed_cases=%zu\n", cases);
    return 0;
  } catch (const std::exception &error) {
    fprintf(stderr, "%s\n", error.what());
    return 1;
  }
}
