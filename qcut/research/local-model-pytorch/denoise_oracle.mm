// Use the exported CPU graph API; generated tensors remain private.
#include <dlfcn.h>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <filesystem>
#include <random>
#include <string>
#include <vector>

template <typename T> T symbol(void *library, const char *name) {
  void *value = dlsym(library, name);
  if (!value) { fprintf(stderr, "missing symbol: %s\n", name); exit(2); }
  return reinterpret_cast<T>(value);
}
struct Tensor { void *data; int32_t dims[4]; int32_t raw24, raw28; };
static_assert(sizeof(Tensor) == 32);

bool readableShape(const Tensor &tensor, int height, int width) {
  return tensor.data && tensor.dims[0] == 1 && tensor.dims[1] == width &&
         tensor.dims[2] == height && tensor.dims[3] == 3;
}

void recordTensor(std::ostream &stream, const std::string &name, const Tensor &tensor) {
  stream << name;
  for (int dim : tensor.dims) stream << '\t' << dim;
  stream << '\t' << tensor.raw24 << '\t' << tensor.raw28 << '\n';
}

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  if (argc == 2 && std::string(argv[1]) == "--self-test") {
    Tensor test{reinterpret_cast<void *>(1), {1, 64, 32, 3}, 0, 0};
    if (!readableShape(test, 32, 64) || readableShape(test, 64, 32)) return 1;
    for (int axis = 0; axis < 4; ++axis) {
      Tensor mismatch = test; mismatch.dims[axis] = 0;
      if (readableShape(mismatch, 32, 64)) return 1;
    }
    test.data = nullptr;
    if (readableShape(test, 32, 64)) return 1;
    puts("native tensor shape guards passed");
    return 0;
  }
  if (argc != 7) return 2;
  void *lib = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!lib) { fprintf(stderr, "%s\n", dlerror()); return 1; }
  std::ifstream graphFile(argv[2]);
  std::string graph((std::istreambuf_iterator<char>(graphFile)), {});
  std::ifstream weightFile(argv[3], std::ios::binary);
  std::vector<char> weights((std::istreambuf_iterator<char>(weightFile)), {});
  const std::string out = argv[4];
  const int height = atoi(argv[5]), width = atoi(argv[6]);
  if (height < 16 || height > 1920 || height % 16 || width < 16 || width > 1920 || width % 16 || graph.empty() || weights.empty()) return 2;
  std::filesystem::create_directories(out);
  alignas(16) char engine[256] = {};
  symbol<void (*)(void *)>(lib, "_ZN10bytenn_cpu8ThrustorC1Ev")(engine);
  auto create = symbol<int (*)(void *, const std::string &, void *, std::vector<std::string> &)>(lib,
    "_ZN10bytenn_cpu8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
  std::vector<std::string> outputs;
  int rc = create(engine, graph, weights.data(), outputs);
  printf("create=%d outputs=%zu\n", rc, outputs.size());
  if (rc) return 1;
  auto set = symbol<int (*)(void *, std::string, void *, int, int, int)>(lib,
    "_ZN10bytenn_cpu8Thrustor8SetInputENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPviii");
  auto run = symbol<int (*)(void *)>(lib, "_ZN10bytenn_cpu8Thrustor9InferenceEv");
  auto extract = symbol<Tensor (*)(void *, const std::string &)>(lib,
    "_ZN10bytenn_cpu8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
  for (int index = 0; index < 3; ++index) {
    const std::string dir = out + "/case-" + std::to_string(index);
    std::filesystem::create_directories(dir);
    std::ofstream schema(dir + "/schema.json");
    schema << "{\"layout\":\"NHWC\",\"storage_dtype\":\"float32\",\"native_trailing_fields\":\"uninterpreted\",\"shape\":[1," << height << "," << width << ",3],\"native_dims_order\":\"NWHC\",\"inputs\":[\"data0\",\"data1\",\"data2\"],\"output\":\"Add_38\"}\n";
    std::ofstream descriptors(dir + "/tensor-descriptors.tsv");
    std::mt19937 random(17 + 24 * index);
    std::uniform_real_distribution<float> uniform(-1.0, 1.0);
    std::vector<std::vector<float>> inputs(3, std::vector<float>(height * width * 3));
    for (int input = 0; input < 3; ++input) {
      for (float &v : inputs[input]) v = index == 0 ? 0 : uniform(random);
      std::string name = "data" + std::to_string(input);
      std::ofstream file(dir + "/" + name + ".f32", std::ios::binary);
      file.write(reinterpret_cast<char *>(inputs[input].data()), inputs[input].size() * 4);
      // The first integer is a byte count, not height; the remaining two are unused here.
      rc = set(engine, name, inputs[input].data(), static_cast<int>(inputs[input].size() * 4), 0, 0);
      printf("set %s=%d\n", name.c_str(), rc);
      if (rc) return 1;
      Tensor actual = extract(engine, name);
      if (!readableShape(actual, height, width)) {
        fprintf(stderr, "input descriptor mismatch: %s\n", name.c_str());
        return 1;
      }
      recordTensor(descriptors, name, actual);
      std::ofstream observed(dir + "/observed-" + name + ".f32", std::ios::binary);
      observed.write(static_cast<char *>(actual.data), inputs[input].size() * 4);
    }
    rc = run(engine); printf("run=%d\n", rc); if (rc) return 1;
    const std::string outputName = "Add_38";
    Tensor tensor = extract(engine, outputName);
    printf("out=%p dims=%d,%d,%d,%d\n", tensor.data, tensor.dims[0], tensor.dims[1], tensor.dims[2], tensor.dims[3]);
    size_t count = 1;
    for (int dim : tensor.dims) { if (dim < 1 || dim > 1920) return 1; count *= dim; }
    if (!readableShape(tensor, height, width) || count != inputs[0].size()) return 1;
    recordTensor(descriptors, outputName, tensor);
    std::ofstream result(dir + "/Add_38.f32", std::ios::binary);
    result.write(static_cast<char *>(tensor.data), count * 4);
  }
  return 0;
}
