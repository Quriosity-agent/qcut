// Load a skeleton model through the effect library's exported SMASH C API so the
// capture library (DYLD_INSERT_LIBRARIES) can record what reaches ByteNN. The
// SDK decrypts its own package format; nothing is patched. Model types are
// enumerated because the header is not available: every type that returns 0
// is reported.
//
// Build:
//   clang++ -std=c++17 -O1 -fobjc-arc -framework Foundation smash_sk_host.mm -o smash-sk-host
// Use:
//   DYLD_LIBRARY_PATH=<runtime>/Frameworks DYLD_INSERT_LIBRARIES=<capture.dylib> \
//     QCUT_BYTENN_CAPTURE_DIR=<dir> smash-sk-host <runtime>/Frameworks/libcccreator.dylib MODEL.model [maxType]
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <cstdio>
#include <cstdlib>

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: smash-sk-host LIBCCCREATOR MODEL [maxType]\n");
    return 2;
  }
  void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!library) {
    fprintf(stderr, "%s\n", dlerror());
    return 2;
  }
  auto create = reinterpret_cast<int (*)(void **)>(dlsym(library, "SK_CreateHandle"));
  auto initModel = reinterpret_cast<int (*)(void *, int, const char *)>(dlsym(library, "SK_InitModel"));
  auto release = reinterpret_cast<int (*)(void *)>(dlsym(library, "SK_ReleaseHandle"));
  if (!create || !initModel || !release) {
    fprintf(stderr, "SK symbols missing\n");
    return 2;
  }
  auto initFromBuffer = reinterpret_cast<int (*)(void *, int, const unsigned char *, unsigned int)>(dlsym(library, "SK_InitModelFromBuf"));
  const int maxType = argc > 3 ? atoi(argv[3]) : 8;
  NSData *bytes = [NSData dataWithContentsOfFile:[NSString stringWithUTF8String:argv[2]]];
  void *handle = nullptr;
  const int created = create(&handle);
  printf("{\"create\": %d, \"bytes\": %lu, \"types\": [", created, (unsigned long)[bytes length]);
  bool first = true;
  for (int type = 0; type <= maxType; ++type) {
    const int fromPath = initModel(handle, type, argv[2]);
    const int fromBuffer = initFromBuffer && bytes ? initFromBuffer(handle, type, static_cast<const unsigned char *>([bytes bytes]), (unsigned int)[bytes length]) : -999;
    printf("%s{\"type\": %d, \"path\": %d, \"buffer\": %d}", first ? "" : ", ", type, fromPath, fromBuffer);
    first = false;
    fflush(stdout);
  }
  printf("]}\n");
  release(handle);
  return 0;
}
