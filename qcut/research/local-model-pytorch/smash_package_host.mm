// Unpack a SMASH model package with the vendor runtime's own reader.
//
// The wrapper files under the Filter runtime's Models directory (records named
// `detect`, `agenet`, `verify`, `multi`, ...) carry encrypted payloads; the
// reader that decrypts them is `smash::package::ModelPackage`, exported by
// liblens.dylib. This host constructs one, initializes it from the file and
// calls Extract for each record name, writing the plaintext payloads out. No
// vendor code is patched and no key is reconstructed: the library does its own
// decryption, exactly as it does when the effect SDK loads a model.
//
// Build:
//   clang++ -std=c++17 -O1 -fobjc-arc -framework Foundation smash_package_host.mm -o smash-package-host
// Use:
//   QCUT_SMASH_PACKAGE_KEY=<key> DYLD_LIBRARY_PATH=<runtime>/Frameworks \
//     smash-package-host <runtime>/Frameworks/liblens.dylib MODEL.model OUTDIR record...
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <string>
#include <vector>

namespace {

// The object's real size is unknown; a zeroed, generously sized block keeps the
// constructor and the reader inside memory this host owns.
constexpr size_t kObjectBytes = 1 << 20;

template <typename T> T symbol(void *library, const char *name) {
  void *value = dlsym(library, name);
  if (!value) {
    fprintf(stderr, "missing symbol: %s\n", name);
    exit(2);
  }
  return reinterpret_cast<T>(value);
}

void writeFile(const std::string &path, const std::string &bytes) {
  std::ofstream out(path, std::ios::binary);
  out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
}

std::string describe(const std::string &bytes) {
  char head[64] = {};
  const size_t count = bytes.size() < 16 ? bytes.size() : 16;
  for (size_t i = 0; i < count; ++i) snprintf(head + i * 2, 3, "%02x", static_cast<unsigned char>(bytes[i]));
  return head;
}

}  // namespace

int main(int argc, char **argv) {
  if (argc < 4) {
    fprintf(stderr, "usage: smash-package-host LIBLENS MODEL OUTDIR [record...]\n");
    return 2;
  }
  void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!library) {
    fprintf(stderr, "%s\n", dlerror());
    return 2;
  }
  auto construct = symbol<void (*)(void *, const std::string &)>(
      library, "_ZN5smash7package12ModelPackageC1ERKNSt3__112basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEE");
  auto getVersion = symbol<int (*)(void *, std::string &)>(
      library, "_ZN5smash7package12ModelPackage10GetVersionERNSt3__112basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEE");
  auto extract = symbol<int (*)(void *, const std::string &, std::map<std::string, std::string> &)>(
      library, "_ZN5smash7package12ModelPackage7ExtractERKNSt3__112basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEERNS2_3mapIS8_S8_NS2_4lessIS8_EENS6_INS2_4pairIS9_S8_EEEEEE");
  auto release = symbol<int (*)(void *)>(library, "_ZN5smash7package12ModelPackage7ReleaseEv");

  auto initFromBuf = symbol<int (*)(void *, const char *, int)>(library, "_ZN5smash7package12ModelPackage11InitFromBufEPKci");

  const std::string path(argv[2]), directory(argv[3]);
  std::ifstream input(path, std::ios::binary | std::ios::ate);
  std::string bytes(static_cast<size_t>(input.tellg()), '\0');
  input.seekg(0);
  input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
  // The reader's constructor takes the package key the effect SDK passes it. The key belongs to
  // the vendor runtime, so it is never stored here: it comes from QCUT_SMASH_PACKAGE_KEY, which
  // the operator fills from a local capture (see smash_package_capture.mm).
  const char *key = std::getenv("QCUT_SMASH_PACKAGE_KEY");
  const char *keyList = std::getenv("QCUT_SMASH_PACKAGE_KEYS");
  std::vector<std::string> keys;
  if (key && *key) keys.emplace_back(key);
  if (keyList && *keyList) {
    std::ifstream list(keyList);
    for (std::string line; std::getline(list, line);) {
      while (!line.empty() && (line.back() == '\r' || line.back() == '\n')) line.pop_back();
      if (!line.empty()) keys.push_back(line);
    }
  }
  if (keys.empty()) {
    fprintf(stderr, "QCUT_SMASH_PACKAGE_KEY or QCUT_SMASH_PACKAGE_KEYS is required\n");
    return 2;
  }
  // Each model family carries its own package key; try the supplied candidates and keep the
  // first the reader accepts.
  void *package = nullptr;
  int initialized = -1;
  size_t accepted = 0;
  for (size_t index = 0; index < keys.size(); ++index) {
    void *candidate = calloc(1, kObjectBytes);
    construct(candidate, keys[index]);
    const int result = initFromBuf(candidate, bytes.data(), static_cast<int>(bytes.size()));
    if (result == 0) {
      package = candidate;
      initialized = 0;
      accepted = index;
      break;
    }
    free(candidate);
  }
  printf("{\"keys_tried\": %zu, \"key_index\": %zu, ", keys.size(), accepted);
  if (!package) {
    printf("\"init\": %d, \"records\": []}\n", initialized);
    return 1;
  }
  std::string version;
  const int versioned = getVersion(package, version);
  printf("\"init\": %d, \"version_rc\": %d, \"version\": \"%s\", \"records\": [", initialized, versioned, version.c_str());
  bool first = true;
  for (int index = 4; index < argc; ++index) {
    const std::string name(argv[index]);
    std::map<std::string, std::string> payloads;
    const int result = extract(package, name, payloads);
    printf("%s{\"name\": \"%s\", \"rc\": %d, \"entries\": [", first ? "" : ", ", name.c_str(), result);
    first = false;
    bool firstEntry = true;
    for (const auto &entry : payloads) {
      const std::string file = directory + "/" + name + "." + entry.first + ".bin";
      writeFile(file, entry.second);
      printf("%s{\"key\": \"%s\", \"bytes\": %zu, \"head\": \"%s\"}", firstEntry ? "" : ", ", entry.first.c_str(),
             entry.second.size(), describe(entry.second).c_str());
      firstEntry = false;
    }
    printf("]}");
    fflush(stdout);
  }
  printf("]}\n");
  release(package);
  return initialized == 0 ? 0 : 1;
}
