// Same-input CPU oracle; graph, weights and tensor files are private run inputs.
#include <dlfcn.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

template <typename T> T symbol(void *library, const char *name) {
  void *value = dlsym(library, name);
  if (!value) throw std::runtime_error(std::string("missing symbol: ") + name);
  return reinterpret_cast<T>(value);
}

struct TensorView { void *data; int32_t dims[4]; int32_t raw24, raw28; };
static_assert(sizeof(TensorView) == 32);
using Shape = std::array<int32_t, 4>;
using Tensors = std::map<std::string, std::vector<float>>;

std::vector<char> readBytes(const std::filesystem::path &path, size_t limit) {
  const auto bytes = std::filesystem::file_size(path);
  if (bytes == 0 || bytes > limit) throw std::runtime_error("invalid input file size");
  std::vector<char> data(bytes);
  std::ifstream stream(path, std::ios::binary);
  if (!stream.read(data.data(), data.size())) throw std::runtime_error("input read failed");
  return data;
}

void writeBytes(const std::filesystem::path &path, const void *data, size_t bytes) {
  std::ofstream stream(path, std::ios::binary);
  if (!stream.write(static_cast<const char *>(data), bytes)) throw std::runtime_error("output write failed");
}

size_t countElements(const Shape &shape) {
  size_t count = 1;
  for (int dim : shape) {
    if (dim < 1 || dim > 1024 || count > (1u << 24) / dim) throw std::runtime_error("invalid tensor shape");
    count *= dim;
  }
  return count;
}

void checkFinite(const float *data, size_t count) {
  for (size_t i = 0; i < count; ++i) {
    if (!std::isfinite(data[i])) throw std::runtime_error("nonfinite tensor");
  }
}

void checkView(const TensorView &view, const Shape &shape) {
  if (!view.data || !std::equal(shape.begin(), shape.end(), view.dims)) throw std::runtime_error("native NWHC shape mismatch");
  checkFinite(static_cast<const float *>(view.data), countElements(shape));
}

std::map<std::string, Shape> readSchema(const std::filesystem::path &path) {
  std::ifstream file(path);
  std::map<std::string, Shape> schema;
  std::string name;
  Shape shape;
  while (file >> name) {
    if (name.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.") != std::string::npos ||
        !(file >> shape[0] >> shape[1] >> shape[2] >> shape[3])) throw std::runtime_error("invalid schema");
    countElements(shape);
    if (!schema.emplace(name, shape).second) throw std::runtime_error("duplicate tensor name");
  }
  if (!file.eof() || schema.empty()) throw std::runtime_error("empty or invalid schema");
  return schema;
}

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  if (argc == 5 && std::string(argv[1]) == "--expand-fp16") {
    try {
      void *library = dlopen(argv[2], RTLD_NOW | RTLD_GLOBAL);
      if (!library) throw std::runtime_error(dlerror());
      auto source = readBytes(argv[3], 16 << 20);
      if (source.size() < 6 || source.size() % 2) throw std::runtime_error("invalid half arena");
      const size_t count = (source.size() - 4) / 2;
      std::vector<float> target(count);
      symbol<void (*)(const uint16_t *, float *, int)>(library, "_ZN6BYTENN30float16buffer_to_float32bufferEPtPfi")(
          reinterpret_cast<const uint16_t *>(source.data()), target.data(), static_cast<int>(count));
      checkFinite(target.data(), count);
      writeBytes(argv[4], target.data(), count * sizeof(float));
      printf("native_expanded_values=%zu\n", count);
      return 0;
    } catch (const std::exception &error) {
      fprintf(stderr, "%s\n", error.what());
      return 1;
    }
  }
  if (argc != 6) {
    fprintf(stderr, "usage: matting_cpu_oracle <library> <decoded-graph> <arena> <run-dir> <cpu|default>\n");
    return 2;
  }
  try {
    const std::filesystem::path out = std::filesystem::canonical(argv[4]);
    // The launcher confines this directory; vendor caches must not reach the repo.
    std::filesystem::current_path(out);
    const auto inputs = readSchema(out / "inputs.tsv");
    const auto outputs = readSchema(out / "outputs.tsv");
    auto graphBytes = readBytes(argv[2], 1 << 20);
    const std::string graph(graphBytes.begin(), graphBytes.end());
    auto weights = readBytes(argv[3], 32 << 20);
    const std::string mode = argv[5];
    if (mode != "cpu" && mode != "default") throw std::runtime_error("unknown backend mode");
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
    if (!library) throw std::runtime_error(dlerror());
    alignas(16) unsigned char engine[256]{};
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorC1Ev")(engine);
    if (mode == "cpu") symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu25ThrustorEnforceCPURuntimeEPNS_8ThrustorE")(engine);
    auto create = symbol<int (*)(void *, const std::string &, void *, std::vector<std::string> &)>(library,
      "_ZN10bytenn_cpu8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
    std::vector<std::string> names;
    for (const auto &[name, shape] : outputs) names.push_back(name);
    const int createResult = create(engine, graph, weights.data(), names);
    printf("create=%d declared_outputs=%zu\n", createResult, names.size());
    if (createResult) throw std::runtime_error("CreateNet failed");
    const int forwardType = symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor14GetForwardTypeEv")(engine);
    printf("requested=%s forward_type=%d\n", mode.c_str(), forwardType);
    std::ofstream runtime(out / "native-runtime.json");
    runtime << "{\"forced_cpu\":" << (mode == "cpu" ? "true" : "false") << ",\"forward_type\":" << forwardType << "}\n";
    runtime.close();
    if (mode == "cpu" && forwardType != 0) throw std::runtime_error("forced CPU was not selected");
    auto set = symbol<int (*)(void *, std::string, void *, int, int, int)>(library,
      "_ZN10bytenn_cpu8Thrustor8SetInputENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPviii");
    auto run = symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor9InferenceEv");
    auto extract = symbol<TensorView (*)(void *, const std::string &)>(library,
      "_ZN10bytenn_cpu8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
    std::vector<std::filesystem::path> cases;
    for (const auto &entry : std::filesystem::directory_iterator(out)) {
      if (entry.is_directory() && entry.path().filename().string().rfind("case-", 0) == 0) cases.push_back(entry.path());
    }
    std::sort(cases.begin(), cases.end());
    if (cases.empty()) throw std::runtime_error("empty native case set");
    Tensors feedback;
    const std::map<std::string, std::string> stateOutputs = {{"data1", "Add_196"}, {"data2", "Add_213"}, {"data3", "Add_230"}};
    for (const auto &path : cases) {
      Tensors buffers;
      const bool useFeedback = std::filesystem::exists(path / "feedback");
      std::ofstream descriptors(path / "native-descriptors.tsv");
      for (const auto &[name, shape] : inputs) {
        const size_t count = countElements(shape);
        auto &buffer = buffers[name];
        if (useFeedback && stateOutputs.count(name)) {
          if (!feedback.count(stateOutputs.at(name))) throw std::runtime_error("missing recurrent feedback");
          buffer = feedback.at(stateOutputs.at(name));
        } else {
          auto bytes = readBytes(path / ("in-" + name + ".f32"), count * sizeof(float));
          if (bytes.size() != count * sizeof(float)) throw std::runtime_error("input tensor length mismatch");
          buffer.resize(count);
          std::memcpy(buffer.data(), bytes.data(), bytes.size());
        }
        if (buffer.size() != count) throw std::runtime_error("feedback tensor length mismatch");
        checkFinite(buffer.data(), count);
        // First integer is BYTES, not height/width/elements.
        if (set(engine, name, buffer.data(), static_cast<int>(count * sizeof(float)), 0, 0)) throw std::runtime_error("SetInput failed");
        const TensorView echo = extract(engine, name);
        checkView(echo, shape);
        if (std::memcmp(echo.data, buffer.data(), count * sizeof(float))) throw std::runtime_error("native input echo mismatch");
        writeBytes(path / ("applied-" + name + ".f32"), buffer.data(), count * sizeof(float));
        writeBytes(path / ("echo-" + name + ".f32"), echo.data, count * sizeof(float));
        descriptors << "input\t" << name;
        for (int dim : echo.dims) descriptors << '\t' << dim;
        descriptors << '\t' << echo.raw24 << '\t' << echo.raw28 << '\n';
      }
      if (run(engine)) throw std::runtime_error("Inference failed");
      feedback.clear();
      for (const auto &[name, shape] : outputs) {
        const TensorView value = extract(engine, name);
        printf("%s %s dims=%d,%d,%d,%d raw=%d,%d\n", path.filename().c_str(), name.c_str(), value.dims[0], value.dims[1], value.dims[2], value.dims[3], value.raw24, value.raw28);
        checkView(value, shape);
        const size_t count = countElements(shape);
        writeBytes(path / ("out-" + name + ".f32"), value.data, count * sizeof(float));
        const auto data = static_cast<const float *>(value.data);
        feedback[name] = std::vector<float>(data, data + count);
        descriptors << "output\t" << name;
        for (int dim : value.dims) descriptors << '\t' << dim;
        descriptors << '\t' << value.raw24 << '\t' << value.raw28 << '\n';
      }
    }
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorD1Ev")(engine);
    return 0;
  } catch (const std::exception &error) {
    fprintf(stderr, "%s\n", error.what());
    return 1;
  }
}
