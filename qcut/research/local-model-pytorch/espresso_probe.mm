// Structural probe for a captured espresso graph on the pinned ByteNN runtime.
//
// Creates the network from graph text plus a weight arena, then reports what
// the runtime itself says about it: the number of weight bytes it consumed
// (GetWeightLen), the default input extent, and for each named blob its
// extent and raw storage descriptor (type, fraction bits). Nothing is
// inferred; no tensors are exchanged.
//
// Build:
//   clang++ -std=c++17 -O1 -fobjc-arc -framework Foundation espresso_probe.mm -o espresso-probe
// Use:
//   espresso-probe LIBRARY GRAPH.txt ARENA.bin|zero:BYTES|guard:ARENA.bin:BYTES NAME...
// `guard:` places the first BYTES of the arena directly in front of an
// inaccessible page and runs one inference on zero input, so any read past
// BYTES faults; a bisection over BYTES then yields the exact arena length of a
// graph whose text carries no trailing stamp.
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <sys/mman.h>
#include <unistd.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

struct TensorView {
  void *data;
  int32_t dims[4];
  int32_t raw[2];
};
static_assert(sizeof(TensorView) == 32);

template <typename T> T symbol(void *library, const char *name) {
  void *value = dlsym(library, name);
  if (!value) {
    fprintf(stderr, "missing symbol: %s\n", name);
    exit(2);
  }
  return reinterpret_cast<T>(value);
}

std::vector<char> readFile(const char *path) {
  std::ifstream input(path, std::ios::binary | std::ios::ate);
  if (!input) {
    fprintf(stderr, "cannot read %s\n", path);
    exit(2);
  }
  std::vector<char> bytes(static_cast<size_t>(input.tellg()));
  input.seekg(0);
  input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
  return bytes;
}

int main(int argc, char **argv) {
  if (argc < 4) {
    fprintf(stderr, "usage: espresso-probe LIBRARY GRAPH ARENA|zero:BYTES [NAME...]\n");
    return 2;
  }
  void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!library) {
    fprintf(stderr, "%s\n", dlerror());
    return 2;
  }
  const auto graphBytes = readFile(argv[2]);
  std::vector<char> arena;
  if (strncmp(argv[3], "zero:", 5) == 0) {
    arena.assign(static_cast<size_t>(strtoull(argv[3] + 5, nullptr, 10)), 0);
  } else if (strncmp(argv[3], "guard:", 6) != 0) {
    arena = readFile(argv[3]);
  }
  std::vector<std::string> names(argv + 4, argv + argc);
  void *arenaData = arena.data();
  bool guarded = false;
  if (strncmp(argv[3], "guard:", 6) == 0) {
    const std::string spec(argv[3] + 6);
    const size_t colon = spec.rfind(':');
    if (colon == std::string::npos) return 2;
    const auto file = readFile(spec.substr(0, colon).c_str());
    const size_t length = static_cast<size_t>(strtoull(spec.c_str() + colon + 1, nullptr, 10));
    if (length > file.size()) return 2;
    const size_t page = static_cast<size_t>(getpagesize());
    const size_t pages = (length + page - 1) / page;
    auto *mapping = static_cast<unsigned char *>(
        mmap(nullptr, (pages + 1) * page, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0));
    if (mapping == MAP_FAILED || mprotect(mapping + pages * page, page, PROT_NONE) != 0) return 2;
    arenaData = mapping + pages * page - length;
    memcpy(arenaData, file.data(), length);
    arena.assign(length, 0);
    guarded = true;
  }
  void *engine = calloc(1, 65536);
  symbol<void (*)(void *)>(library, "_ZN8espresso8ThrustorC1Ev")(engine);
  symbol<void (*)(void *)>(library, "_ZN8espresso25ThrustorEnforceCPURuntimeEPNS_8ThrustorE")(engine);
  auto create = symbol<int (*)(void *, const std::string &, void *, std::vector<std::string> &)>(
      library, "_ZN8espresso8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
  auto weightLength = symbol<long (*)(void *)>(library, "_ZN8espresso8Thrustor12GetWeightLenEv");
  auto defaultInSize = symbol<void (*)(void *, int &, int &)>(library, "_ZN8espresso21ThrustorDefaultInSizeEPNS_8ThrustorERiS2_");
  auto extract = symbol<TensorView (*)(void *, const std::string &)>(
      library, "_ZN8espresso8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
  const std::string graph(graphBytes.begin(), graphBytes.end());
  const int created = create(engine, graph, arenaData, names);
  int height = -1, width = -1;
  defaultInSize(engine, height, width);
  int inference = -1;
  if (guarded && created == 0 && !names.empty()) {
    // Zero input of the blob's own storage width, then one inference, so weights
    // the runtime reads lazily are touched as well.
    auto setInput = symbol<int (*)(void *, std::string, void *, int, int, int)>(
        library, "_ZN8espresso8Thrustor8SetInputENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPviii");
    TensorView input = extract(engine, names[0]);
    const size_t width = input.raw[0] == 1 ? 1 : input.raw[0] == 2 ? 2 : 4;
    std::vector<char> zeros(static_cast<size_t>(input.dims[0]) * input.dims[1] * input.dims[2] * input.dims[3] * width, 0);
    if (setInput(engine, names[0], zeros.data(), static_cast<int>(zeros.size()), 0, 0) == 0) {
      inference = symbol<int (*)(void *)>(library, "_ZN8espresso8Thrustor9InferenceEv")(engine);
    }
  }
  printf("{\"create\": %d, \"inference\": %d, \"weight_len\": %ld, \"default_in\": [%d, %d], \"arena_bytes\": %zu, \"names\": [", created,
         inference, weightLength(engine), height, width, arena.size());
  for (size_t index = 0; index < names.size(); ++index) {
    TensorView view = extract(engine, names[index]);
    printf("%s{\"name\": \"%s\", \"dims\": [%d, %d, %d, %d], \"raw\": [%d, %d], \"null\": %s}", index ? ", " : "",
           names[index].c_str(), view.dims[0], view.dims[1], view.dims[2], view.dims[3], view.raw[0], view.raw[1],
           view.data ? "false" : "true");
  }
  printf("]}\n");
  return created ? 1 : 0;
}
