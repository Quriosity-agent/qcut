// Standalone probe for 剪映 智能镜头分割 (Bach COMPRESS_SHOT_DETECT) driven from the
// private runtime snapshot, without the 剪映 app. Milestones are verified one by one:
//   M1 load the 23-library closure          M2 create a Bach algorithm system
//   M3 init it with our own resource finder  M4 load the graph + models from the snapshot
//   M5 execute frames / read cut points (input layout still under reverse engineering)
// Everything here is written against the symbol map in SYMBOLS.md; nothing is copied
// from 剪映. Vendor libraries and models stay in the private runtime directory.
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <fstream>
#include <cerrno>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <sstream>
#include <chrono>

namespace {
std::string g_runtime;      // .../JianyingShotSplit/current
std::string g_modelDir;     // .../Resources/models

template <typename T> T sym(void *lib, const char *name) {
  void *p = dlsym(lib, name);
  if (!p) { fprintf(stderr, "missing symbol %s: %s\n", name, dlerror()); exit(2); }
  return reinterpret_cast<T>(p);
}
template <typename Fn> Fn slot(void *object, int index) {
  void **vtable = *reinterpret_cast<void ***>(object);
  return reinterpret_cast<Fn>(vtable[index]);
}

// Bach::BachAlgorithmModel as observed in TEBachAlgorithmFinder::findResource:
//   +0x00 std::string name   +0x24 uint8 pathOnly   +0x28 void* data   +0x30 int64 length   +0x38 std::string path
struct BachAlgorithmModelView {
  std::string name;      // 0x00
  uint8_t pad[0xc];      // 0x18..0x24
  uint8_t pathOnly;      // 0x24
  uint8_t pad2[3];
  void *data;            // 0x28
  long long length;      // 0x30
  std::string path;      // 0x38
};
static_assert(offsetof(BachAlgorithmModelView, pathOnly) == 0x24, "layout");
static_assert(offsetof(BachAlgorithmModelView, data) == 0x28, "layout");
static_assert(offsetof(BachAlgorithmModelView, path) == 0x38, "layout");

std::string resolveModelPath(const std::string &name) {
  // 剪映 asks by bare model name ("jy_compressShotDetectBackbone_new"); files are
  // <name>_v1.0_size0.bytenn in the snapshot's models directory.
  const char *suffixes[] = {"_v1.0_size0.bytenn", ".bytenn", ".model", ""};
  for (const char *s : suffixes) {
    std::string candidate = g_modelDir + "/" + name + s;
    if (FILE *f = fopen(candidate.c_str(), "rb")) { fclose(f); return candidate; }
  }
  return "";
}

// Our finder: a C++ object whose vtable mirrors TEBachAlgorithmFinder's slot order.
struct ProbeFinder;
using FindResourceFn = bool (*)(ProbeFinder *, BachAlgorithmModelView *);
struct ProbeFinder { void **vtable; };

bool finder_findResource(ProbeFinder *, BachAlgorithmModelView *model) {
  std::string path = resolveModelPath(model->name);
  printf("[finder] findResource(name=%s pathOnly=%d) -> %s\n", model->name.c_str(), model->pathOnly, path.empty() ? "NOT FOUND" : path.c_str());
  if (path.empty()) return false;
  model->path = path;
  if (model->pathOnly) return true;
  std::ifstream in(path, std::ios::binary); std::stringstream ss; ss << in.rdbuf();
  std::string bytes = ss.str();
  void *buf = malloc(bytes.size()); memcpy(buf, bytes.data(), bytes.size());
  model->data = buf; model->length = (long long)bytes.size();
  printf("[finder]   loaded %lld bytes\n", model->length);
  return true;
}
void finder_dtor(ProbeFinder *) {}
long finder_unknown3(ProbeFinder *, void *a, void *b) { printf("[finder] slot3 called (%p,%p)\n", a, b); return 0; }
long finder_unknown4(ProbeFinder *, void *a, void *b) { printf("[finder] slot4 called (%p,%p)\n", a, b); return 0; }
long finder_unknown5(ProbeFinder *, void *a, void *b) { printf("[finder] slot5 called (%p,%p)\n", a, b); return 0; }
// sret std::string findResourcePath(const char* name)
std::string *finder_findResourcePath(std::string *out, ProbeFinder *, const char *name) {
  std::string path = resolveModelPath(name ? name : "");
  printf("[finder] findResourcePath(%s) -> %s\n", name ? name : "(null)", path.empty() ? "NOT FOUND" : path.c_str());
  new (out) std::string(path);
  return out;
}
void *g_finderVtable[8] = {
  (void *)finder_dtor, (void *)finder_dtor, (void *)finder_findResource, (void *)finder_unknown3,
  (void *)finder_unknown4, (void *)finder_unknown5, (void *)finder_findResourcePath, nullptr};

// Bach::BachInitConfig as built by TEBachVideoAutoSplit::initBachSystem: finder*, string, string, then zeros.
struct BachInitConfigView {
  void *finder;          // 0x00
  std::string first;     // 0x08
  std::string second;    // 0x20
  uint64_t zero[4] = {0, 0, 0, 0};
};
static_assert(offsetof(BachInitConfigView, second) == 0x20, "layout");

// ---- M5: input objects mirrored from TEBachVideoAutoSplit::executeFrame ----
// The two TE wrapper classes only have virtual destructors, so we reuse their real
// vtables (slide-adjusted file addresses) and reproduce the field layout.
constexpr uintptr_t kFactorySymbolFileAddr = 0xc6d21c;   // Bach::BachAlgorithmFactory::CreateAlgorithmSystem
constexpr uintptr_t kInputVtableFileAddr = 0x36c5d58;     // vptr stored by executeFrame for the input object
constexpr uintptr_t kImageVtableFileAddr = 0x36c4840;     // vptr stored for the image buffer object
constexpr uintptr_t kMapFindFileAddr = 0xb5ebc8;          // unordered_map<std::string,…>::find used by getBachResult
constexpr uintptr_t kVectorOpFileAddr = 0xbc11fc;         // Bach::BachObject::operator PrimitiveVector<int>() (exported too)

struct ImageBufferView {          // sp+0x78 in executeFrame
  void *vptr;                      // 0x00
  int32_t f08 = 0;                 // 0x08
  int32_t width = 0;               // 0x0c
  int32_t height = 0;              // 0x10
  int32_t f14 = 0;                 // 0x14
  void *data = nullptr;            // 0x18
  int32_t f20 = 0;                 // 0x20 (rotation, converted by teRotateMode2bachRotateMode)
  int32_t format = 0;              // 0x24 (frame pixel format, must be < 4)
  int32_t f28 = 0;                 // 0x28
  int32_t f2c = 0;                 // 0x2c
  double timestamp = 0;            // 0x30 (seconds)
  uint64_t tail[4] = {0, 0, 0, 0}; // slack
};
static_assert(offsetof(ImageBufferView, data) == 0x18 && offsetof(ImageBufferView, format) == 0x24 && offsetof(ImageBufferView, timestamp) == 0x30, "layout");
struct AlgorithmInputView {       // x29-0x70 in executeFrame
  void *vptr;                      // 0x00
  int32_t f08 = 1;                 // 0x08
  int32_t pad0c = 0;
  ImageBufferView *image;          // 0x10
  void *data;                      // 0x18 (raw pixels again)
  int32_t count = 1;               // 0x20 (0 for the EOF frame)
  int32_t pad24 = 0;
  uint64_t tail[4] = {0, 0, 0, 0};
};
static_assert(offsetof(AlgorithmInputView, image) == 0x10 && offsetof(AlgorithmInputView, count) == 0x20, "layout");

uintptr_t imageBase(void *lib) {
  void *factory = dlsym(lib, "_ZN4Bach20BachAlgorithmFactory21CreateAlgorithmSystemEv");
  return reinterpret_cast<uintptr_t>(factory) - kFactorySymbolFileAddr;
}

std::vector<int> readIntResult(void *lib, void *system, const char *key) {
  // getBachResult: type=182 → getResult(const AlgorithmType&) → container; [+0x18,+0x20) vector of
  // entries; entry+0x10 is an unordered_map<std::string, {…, BachObject @+0x28}>.
  int type = 182;
  auto getResult = slot<void *(*)(void *, const int *)>(system, 6);
  void *container = getResult(system, &type);
  std::vector<int> out;
  if (!container) { printf("[result] getResult(182) returned null\n"); return out; }
  auto begin = *reinterpret_cast<void ***>(reinterpret_cast<char *>(container) + 0x18);
  auto end = *reinterpret_cast<void ***>(reinterpret_cast<char *>(container) + 0x20);
  printf("[result] container=%p entries=%ld\n", container, (long)(end - begin));
  if (begin == end || !*begin) return out;
  void *entry = *begin;
  void *map = reinterpret_cast<char *>(entry) + 0x10;
  auto mapFind = reinterpret_cast<void *(*)(void *, const std::string *)>(imageBase(lib) + kMapFindFileAddr);
  std::string k(key);
  void *node = mapFind(map, &k);
  if (!node) { printf("[result] key %s not found\n", key); return out; }
  void *object = reinterpret_cast<char *>(node) + 0x28;
  // BachObject: scalar payload at +0, type tag at +0x80 (getBachResult compares frame_received
  // against an object built as {value=1, type=31}); only vectors go through the conversion.
  int32_t typeTag = *reinterpret_cast<int32_t *>(reinterpret_cast<char *>(object) + 0x80);
  uint64_t payload = *reinterpret_cast<uint64_t *>(object);
  printf("[result] %s: BachObject type=%d payload=0x%llx\n", key, typeTag, (unsigned long long)payload);
  if (typeTag == 31) { out.push_back((int)payload); return out; }
  if (typeTag == 14 && payload) {
    // vector-typed BachObject: payload is the AmazingEngine::PrimitiveVector<int> impl, elements in [+0x10, +0x18)
    auto vbegin = *reinterpret_cast<int **>(payload + 0x10);
    auto vend = *reinterpret_cast<int **>(payload + 0x18);
    long n = (!vbegin && !vend) ? 0 : (vbegin && vend >= vbegin ? (long)(vend - vbegin) : -1);  // empty vector = null/null
    printf("[result] %s: vector impl %p begin=%p end=%p n=%ld\n", key, (void *)payload, (void *)vbegin, (void *)vend, n);
    if (n >= 0 && n < 1000000) { for (long i = 0; i < n; ++i) out.push_back(vbegin[i]); return out; }
  }
  auto toVector = reinterpret_cast<void *(*)(void *, const void *)>(imageBase(lib) + kVectorOpFileAddr);
  void *handle = nullptr;               // sret: AmazingEngine::PrimitiveVector<int> (a handle object)
  toVector(&handle, object);
  if (!handle) { printf("[result] %s: vector handle null\n", key); return out; }
  auto vbegin = *reinterpret_cast<int **>(reinterpret_cast<char *>(handle) + 0x10);
  auto vend = *reinterpret_cast<int **>(reinterpret_cast<char *>(handle) + 0x18);
  for (int *p = vbegin; p && p < vend; ++p) out.push_back(*p);
  printf("[result] %s: %zu ints\n", key, out.size());
  return out;
}
} // namespace

// Reads exactly n bytes or returns false at EOF. A pipe handed over by Node/Bun may be
// non-blocking, so EAGAIN waits on poll() instead of ending the stream early.
static bool readFully(int fd, unsigned char *buf, size_t n) {
  size_t got = 0;
  while (got < n) {
    ssize_t r = read(fd, buf + got, n - got);
    if (r > 0) { got += (size_t)r; continue; }
    if (r == 0) return false;
    if (errno == EINTR) continue;
    if (errno == EAGAIN || errno == EWOULDBLOCK) { struct pollfd p{fd, POLLIN, 0}; poll(&p, 1, -1); continue; }
    fprintf(stderr, "read failed: %s\n", strerror(errno));
    return false;
  }
  return true;
}

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0); setvbuf(stderr, nullptr, _IONBF, 0);  // a crash must not eat the log
  if (argc < 2) { fprintf(stderr, "usage: shot-split-bridge <runtime-dir> [appName] [second] [graph.json] [frames.rgba|- width height fps [format [inputType [maxFrames]]]]\n"); return 2; }
  g_runtime = argv[1];
  g_modelDir = g_runtime + "/Resources/models";
  std::string appName = argc > 2 ? argv[2] : "VESDK";
  std::string second = argc > 3 ? argv[3] : "";
  std::string graph = argc > 4 ? argv[4] : g_runtime + "/Resources/SceneEditDetection/config.json";

  // M1: load the closure (dependencies resolve through @rpath = <runtime>/Frameworks)
  std::string core = g_runtime + "/Frameworks/libcccreator.dylib";
  void *lib = dlopen(core.c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!lib) { fprintf(stderr, "M1 FAIL dlopen: %s\n", dlerror()); return 1; }
  printf("M1 OK  loaded %s\n", core.c_str());

  // M2: create the algorithm system through the exported factory
  auto createSystem = sym<void *(*)()>(lib, "_ZN4Bach20BachAlgorithmFactory21CreateAlgorithmSystemEv");
  void *system = createSystem();
  printf("M2 %s  BachAlgorithmSystem=%p\n", system ? "OK " : "FAIL", system);
  if (!system) return 1;

  // M3: init with our finder. vtable slot 2 = init(const BachInitConfig&)
  ProbeFinder finder{g_finderVtable};
  BachInitConfigView config; config.finder = &finder; config.first = appName; config.second = second;
  auto init = slot<int (*)(void *, const BachInitConfigView *)>(system, 2);
  int rc = init(system, &config);
  printf("M3 %s  init(appName=\"%s\", second=\"%s\") -> %d\n", rc == 0 ? "OK " : "FAIL", appName.c_str(), second.c_str(), rc);
  if (rc != 0) return 1;

  // M4: graph + models. slot 3 = initGraph(const std::string&)
  auto initGraph = slot<int (*)(void *, const std::string *)>(system, 3);
  rc = initGraph(system, &graph);
  printf("M4 %s  initGraph(%s) -> %d\n", rc == 0 ? "OK " : "FAIL", graph.c_str(), rc);
  if (rc != 0) {
    std::ifstream in(graph); std::stringstream ss; ss << in.rdbuf(); std::string content = ss.str();
    rc = initGraph(system, &content);
    printf("M4b %s initGraph(<json content %zu bytes>) -> %d\n", rc == 0 ? "OK " : "FAIL", content.size(), rc);
    if (rc != 0) return 1;
  }
  auto loadModel = slot<int (*)(void *)>(system, 32);
  rc = loadModel(system);
  printf("M4c %s loadModel() -> %d\n", rc == 0 ? "OK " : "FAIL", rc);
  if (argc < 9) { printf("done (no frames given; M5 skipped)\n"); return 0; }

  // M5: feed raw RGBA frames, then the EOF frame, then read predict_result.
  std::string rawPath = argv[5]; int width = atoi(argv[6]), height = atoi(argv[7]); double fps = atof(argv[8]);
  int format = argc > 9 ? atoi(argv[9]) : 0;
  int inputType = argc > 10 ? atoi(argv[10]) : 1;   // BachAlgorithmInput +0x08 (TE uses 1)
  int maxFrames = argc > 11 ? atoi(argv[11]) : 1 << 30;
  int rawFd = rawPath == "-" ? STDIN_FILENO : open(rawPath.c_str(), O_RDONLY);   // "-" streams frames from stdin (an ffmpeg pipe)
  if (rawFd < 0) { fprintf(stderr, "cannot open %s: %s\n", rawPath.c_str(), strerror(errno)); return 1; }
  size_t frameBytes = (size_t)width * height * 4;
  std::vector<unsigned char> pixels(frameBytes);
  uintptr_t base = imageBase(lib);
  auto execute = slot<int (*)(void *, const AlgorithmInputView *)>(system, 5);
  int frameIndex = 0, failures = 0;
  auto t0 = std::chrono::steady_clock::now();
  while (frameIndex < maxFrames && readFully(rawFd, pixels.data(), frameBytes)) {
    ImageBufferView image{}; image.vptr = reinterpret_cast<void *>(base + kImageVtableFileAddr);
    image.width = width; image.height = height; image.data = pixels.data(); image.format = format;
    image.timestamp = frameIndex / fps;
    AlgorithmInputView input{}; input.vptr = reinterpret_cast<void *>(base + kInputVtableFileAddr);
    input.image = &image; input.data = pixels.data(); input.count = 1; input.f08 = inputType;
    int r = execute(system, &input);
    if (r != 0) { failures++; if (failures < 4) printf("[execute] frame %d -> %d\n", frameIndex, r); }
    if (frameIndex == 0) printf("[execute] first frame -> %d\n", r);
    frameIndex++;
    if (frameIndex % 240 == 0) printf("[progress] fed %d frames\n", frameIndex);   // machine-readable heartbeat
  }
  double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  printf("M5a fed %d frames (%dx%d rgba fmt=%d type=%d fps=%.2f) in %.0f ms, failures=%d\n", frameIndex, width, height, format, inputType, fps, ms, failures);
  // EOF frame exactly as executeFrame builds it for a null frame: 1x1, 4 zero bytes, count=0
  uint32_t zero = 0;
  ImageBufferView eofImage{}; eofImage.vptr = reinterpret_cast<void *>(base + kImageVtableFileAddr);
  eofImage.width = 1; eofImage.height = 1; eofImage.data = &zero;
  AlgorithmInputView eof{}; eof.vptr = reinterpret_cast<void *>(base + kInputVtableFileAddr);
  eof.image = &eofImage; eof.data = &zero; eof.count = 0; eof.f08 = inputType;
  int r = execute(system, &eof);
  printf("M5b EOF frame -> %d\n", r);
  std::vector<int> received = readIntResult(lib, system, "frame_received");
  std::vector<int> predict = readIntResult(lib, system, "predict_result");
  printf("frame_received: "); for (int v : received) printf("%d ", v); printf("\n");
  printf("predict_result: "); for (int v : predict) printf("%d ", v); printf("\n");
  if (!predict.empty()) {
    printf("cut points (frame/fps): ");
    for (int v : predict) printf("%.3f ", v / fps);
    printf("\n");
  }
  return 0;
}
