// Private ABI oracle; the Python caller pins the source and runtime hashes.
#include <dlfcn.h>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

template <typename T> T symbol(void *library, const char *name) {
  void *value = dlsym(library, name);
  if (!value) throw std::runtime_error(std::string("missing symbol: ") + name);
  return reinterpret_cast<T>(value);
}
struct TensorView { void *data; int32_t dims[4]; int32_t dtype, shift; };
static_assert(sizeof(TensorView) == 32);
using Extract = TensorView (*)(void *, const std::string &);

std::vector<char> read(const std::filesystem::path &path, size_t limit) {
  const auto size = std::filesystem::file_size(path);
  if (!size || size > limit) throw std::runtime_error("invalid file size");
  std::vector<char> bytes(size);
  std::ifstream stream(path, std::ios::binary);
  if (!stream.read(bytes.data(), size)) throw std::runtime_error("read failed");
  return bytes;
}
size_t byteSize(const TensorView &value) {
  if (!value.data || (value.dtype != 2 && value.dtype != 4)) throw std::runtime_error("unsupported tensor dtype");
  size_t count = 1;
  for (const auto dim : value.dims) {
    if (dim < 1 || dim > 4096) throw std::runtime_error("invalid native dimension");
    count *= dim;
    if (count > (1u << 24)) throw std::runtime_error("oversized native tensor");
  }
  return count * value.dtype;
}
void dump(const std::filesystem::path &root, const std::string &prefix,
          const std::string &name, const TensorView &tensor, std::ofstream &index) {
  const size_t bytes = byteSize(tensor);
  std::ofstream stream(root / (prefix + name + ".bin"), std::ios::binary);
  if (!stream.write(static_cast<const char *>(tensor.data), bytes)) throw std::runtime_error("write failed");
  index << name;
  for (const auto dim : tensor.dims) index << '\t' << dim;
  index << '\t' << tensor.dtype << '\t' << tensor.shift << '\t' << bytes << '\n';
}

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  if (argc != 5 && argc != 6) {
    fprintf(stderr, "usage: tracking_oracle library graph arena run-directory\n");
    return 2;
  }
  try {
    const std::filesystem::path root = argv[4];
    auto graphBytes = read(argv[2], 1u << 20);
    const std::string graph(graphBytes.begin(), graphBytes.end());
    auto arena = read(argv[3], 1u << 24);
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
    if (!library) throw std::runtime_error(dlerror());
    alignas(16) unsigned char engine[256]{};
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorC1Ev")(engine);
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu25ThrustorEnforceCPURuntimeEPNS_8ThrustorE")(engine);
    std::vector<std::string> outputs;
    const auto create = symbol<int (*)(void *, const std::string &, void *, std::vector<std::string> &)>(library,
      "_ZN10bytenn_cpu8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
    if (create(engine, graph, arena.data(), outputs)) throw std::runtime_error("CreateNet failed");
    const int backend = symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor14GetForwardTypeEv")(engine);
    if (backend != 0) throw std::runtime_error("CPU runtime was not selected");
    if (argc == 6 && std::string(argv[5]) == "--inspect") {
      Dl_info image{};
      if (!dladdr(dlsym(library, "_ZN10bytenn_cpu8ThrustorC1Ev"), &image)) throw std::runtime_error("missing runtime image");
      const auto base = reinterpret_cast<uintptr_t>(image.dli_fbase);
      void *impl = *reinterpret_cast<void **>(engine + 8);
      alignas(16) char vector[64]{};
      reinterpret_cast<void (*)(void *, void *)>(base + 0x1fedec)(vector, static_cast<char *>(impl) + 0x80);
      char *begin = *reinterpret_cast<char **>(vector), *end = *reinterpret_cast<char **>(vector + 8);
      if (!begin || end < begin || end - begin > 256 * 16) throw std::runtime_error("invalid layer vector");
      std::ofstream layers(root / "native-layer-slots.tsv");
      for (char *entry = begin; entry < end; entry += 16) {
        const char *layer = *reinterpret_cast<char **>(entry);
        const auto &name = *reinterpret_cast<const std::string *>(layer + 0x18);
        const auto &kind = *reinterpret_cast<const std::string *>(layer + 0x30);
        if (name.size() > 256 || kind.size() > 256) throw std::runtime_error("invalid layer name");
        layers << name << '\t' << kind;
        void **table = *reinterpret_cast<void ***>(const_cast<char *>(layer));
        for (int slot = 0; slot < 20; ++slot) layers << '\t' << std::hex << reinterpret_cast<uintptr_t>(table[slot]) - base;
        layers << '\n';
      }
    }
    std::ofstream runtime(root / "native-runtime.json");
    runtime << "{\"forced_cpu\":true,\"forward_type\":0}\n";
    runtime.close();
    const auto extract = symbol<Extract>(library,
      "_ZN10bytenn_cpu8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
    std::ifstream requests(root / "requests.txt");
    std::string input, name;
    if (!(requests >> input)) throw std::runtime_error("missing input name");
    std::vector<std::string> names;
    while (requests >> name) {
      if (name.find('/') != std::string::npos || name == "..") throw std::runtime_error("unsafe tensor name");
      names.push_back(name);
    }
    if (names.empty()) throw std::runtime_error("empty output request");
    std::ofstream outputNames(root / "native-created-names.txt");
    for (const auto &value : outputs) outputNames << value << '\n';
    const auto set = symbol<int (*)(void *, std::string, void *, int, int, int)>(library,
      "_ZN10bytenn_cpu8Thrustor8SetInputENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPviii");
    const auto run = symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor9InferenceEv");
    const size_t inputBytes = byteSize(extract(engine, input));
    size_t count = 0;
    for (const auto &entry : std::filesystem::directory_iterator(root)) {
      if (!entry.is_directory() || entry.path().filename().string().rfind("case-", 0)) continue;
      const auto dir = entry.path();
      auto bytes = read(dir / "input.bin", inputBytes);
      if (bytes.size() != inputBytes) throw std::runtime_error("wrong input byte count");
      // SetInput copies bytes without float-to-fixed conversion.
      if (set(engine, input, bytes.data(), static_cast<int>(bytes.size()), 0, 0)) throw std::runtime_error("SetInput failed");
      std::ofstream index(dir / "native-tensors.tsv");
      dump(dir, "native-", input, extract(engine, input), index);
      if (run(engine)) throw std::runtime_error("Inference failed");
      for (const auto &value : names) dump(dir, "native-", value, extract(engine, value), index);
      printf("%s outputs=%zu\n", dir.filename().c_str(), names.size());
      ++count;
    }
    if (!count) throw std::runtime_error("no cases");
    symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorD1Ev")(engine);
    return 0;
  } catch (const std::exception &error) {
    fprintf(stderr, "%s\n", error.what());
    return 1;
  }
}
