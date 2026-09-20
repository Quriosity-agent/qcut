// Feed one BM container to the pinned ByteNN runtime through its public engine
// API, so a container the runtime decodes internally (packed BM v2/v4) can be
// captured by bytenn_model_capture.mm (DYLD_INSERT_LIBRARIES): the capture
// library records EngineFactory::Create, redirects Init(Config), and scans the
// heap for the decoded graph and its stamp afterwards. No vendor code is
// patched; the Config block mirrors the layout observed in captured Init calls
// (forward type, thread count, model pointer, model length).
//
// Build:
//   clang++ -std=c++17 -O1 -fobjc-arc -framework Foundation -L<runtime>/Frameworks \
//     -lbytenn -Wl,-rpath,<runtime>/Frameworks bytenn_init_host.mm -o bytenn-init-host
// Use:
//   DYLD_INSERT_LIBRARIES=<capture.dylib> QCUT_BYTENN_CAPTURE_DIR=<dir> bytenn-init-host CONTAINER.bm
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <vector>

namespace BYTENN {
class ByteNNEngine;
}
std::shared_ptr<BYTENN::ByteNNEngine> engineCreate() asm("__ZN6BYTENN13EngineFactory6CreateEv");

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: bytenn-init-host CONTAINER.bm\n");
    return 2;
  }
  std::ifstream input(argv[1], std::ios::binary | std::ios::ate);
  if (!input) return 2;
  std::vector<unsigned char> model(static_cast<size_t>(input.tellg()));
  input.seekg(0);
  input.read(reinterpret_cast<char *>(model.data()), static_cast<std::streamsize>(model.size()));
  std::shared_ptr<BYTENN::ByteNNEngine> engine = engineCreate();
  void **vtable = *reinterpret_cast<void ***>(engine.get());
  // Init(Config const&) is the slot whose symbol name says so. When the capture library
  // has replaced the object's vtable, that slot (and the later Init(ConfigExt) one)
  // point into the capture image instead; the first such slot is Init(Config).
  void *init = nullptr;
  for (int slot = 0; slot < 64 && !init; ++slot) {
    Dl_info info;
    if (!dladdr(vtable[slot], &info)) continue;
    const bool original = info.dli_sname && strstr(info.dli_sname, "ByteNNEngineImpl4InitERKNS_6ConfigE");
    const bool recorded = info.dli_fname && strstr(info.dli_fname, "bytenn-model-capture");
    if (original || recorded) init = vtable[slot];
  }
  if (!init) {
    fprintf(stderr, "Init(Config) slot not found\n");
    return 2;
  }
  // Config block as observed: int32 forward type (0 = CPU), int32 threads, model pointer,
  // uint32 model length, int32 buffer flag, then zeroed members (empty strings / vectors).
  alignas(16) unsigned char config[4096] = {};
  const int32_t forwardType = 0, threads = 1, bufferFlag = 1;
  const uint32_t length = static_cast<uint32_t>(model.size());
  const unsigned char *pointer = model.data();
  memcpy(config + 0, &forwardType, 4);
  memcpy(config + 4, &threads, 4);
  memcpy(config + 8, &pointer, 8);
  memcpy(config + 16, &length, 4);
  memcpy(config + 20, &bufferFlag, 4);
  const long result = reinterpret_cast<long (*)(void *, const void *)>(init)(engine.get(), config);
  printf("{\"init\": %ld, \"bytes\": %zu}\n", result, model.size());
  return result == 0 ? 0 : 1;
}
