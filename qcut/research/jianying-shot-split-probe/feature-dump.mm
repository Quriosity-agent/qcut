// 本地特征导出:复用桥接的加载流程,喂若干帧后在进程内定位 ByteNN 引擎对象,
// 用 libbytenn 导出的 Thrustor::Extract 逐层取**真实激活**,并取网络真正看到的输入张量。
// 这样复现实现可以逐层对拍,不用猜预处理。仅本机研究用,产物不入库。
// (加载基础设施与 shot-split-bridge.mm 同源)
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
#include <cmath>
#include <algorithm>
#include <sys/stat.h>
#include <sys/wait.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>

namespace {
uintptr_t g_slide = 0;
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

}  // namespace

// ---- 引擎发现 + 逐层激活导出 ----
constexpr uintptr_t kLabGetLayersFileAddr = 0x2eb00;      // BYTENN::LabNetWork::GetLayers()
constexpr uintptr_t kEngineVtableFileAddr = 0x4a8190;     // vtable for BYTENN::ByteNNEngineImpl
constexpr uintptr_t kLayerVecFileAddr = 0x1fedec;         // 内部层表构造函数

// Thrustor::Extract / ThrustorGetInput 都用 sret(x8)返回 Tensor;把返回类型声明成
// 大于 16 字节的 POD,编译器就会按同一套 ABI 传隐藏指针。实际 Tensor 只有 32 字节。
struct RawTensor { unsigned char raw[256]; };
using ExtractFn = RawTensor (*)(void *thrustor, const std::string *name);
using GetInputFn = RawTensor (*)(void *thrustor);
using TensorSizeFn = unsigned long (*)(const void *);

// GetByteSize() 对 Extract 返回的张量给 0(它读的 dtype 字段在推理态没填),
// 直接按维度算:四维都是正数且乘积合理就认。
unsigned long tensorBytes(const unsigned char *raw) {
  const int32_t *d = reinterpret_cast<const int32_t *>(raw + 8);
  long long n = 1;
  for (int i = 0; i < 4; ++i) {
    if (d[i] <= 0 || d[i] > 65536) return 0;
    n *= d[i];
  }
  return (n > 0 && n < (1ll << 24)) ? (unsigned long)(n * 4) : 0;
}

std::vector<void *> findEngines(uintptr_t vptr) {
  std::vector<void *> hits;
  std::vector<uintptr_t> buf(1024 * 128);
  mach_vm_address_t addr = 0;
  while (true) {
    mach_vm_size_t size = 0;
    vm_region_basic_info_data_64_t info{};
    mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
    mach_port_t object = MACH_PORT_NULL;
    if (mach_vm_region(mach_task_self(), &addr, &size, VM_REGION_BASIC_INFO_64,
                       (vm_region_info_t)&info, &count, &object) != KERN_SUCCESS) break;
    if (size == 0) break;
    bool rw = (info.protection & VM_PROT_READ) && (info.protection & VM_PROT_WRITE);
    if (rw && size <= 256ull * 1024 * 1024) {
      for (mach_vm_size_t off = 0; off < size; off += buf.size() * sizeof(uintptr_t)) {
        mach_vm_size_t chunk = std::min<mach_vm_size_t>(buf.size() * sizeof(uintptr_t), size - off);
        mach_vm_size_t got = 0;
        if (mach_vm_read_overwrite(mach_task_self(), addr + off, chunk,
                                   (mach_vm_address_t)buf.data(), &got) != KERN_SUCCESS || got == 0) continue;
        for (size_t i = 0, n = got / sizeof(uintptr_t); i < n; ++i)
          if (buf[i] == vptr) hits.push_back(reinterpret_cast<void *>(addr + off + i * sizeof(uintptr_t)));
      }
    }
    addr += size;
  }
  return hits;
}

// 取出层表里每一层的名字(名字即该层输出 blob 名)
std::vector<std::string> layerNames(uintptr_t slide, void *net) {
  std::vector<std::string> names;
  void *thrustor = *reinterpret_cast<void **>(static_cast<char *>(net) + 0x40);
  if (!thrustor) return names;
  void *impl = *reinterpret_cast<void **>(static_cast<char *>(thrustor) + 0x8);
  if (!impl) return names;
  auto buildLayerVec = reinterpret_cast<void (*)(void *, void *)>(slide + kLayerVecFileAddr);
  alignas(16) char vec[64] = {};
  buildLayerVec(vec, static_cast<char *>(impl) + 0x80);
  char *begin = *reinterpret_cast<char **>(vec);
  char *end = *reinterpret_cast<char **>(vec + 8);
  if (!begin || end < begin) return names;
  for (size_t i = 0, n = (size_t)(end - begin) / 16; i < n; ++i) {
    void *layer = *reinterpret_cast<void **>(begin + i * 16);
    if (!layer) { names.push_back(""); continue; }
    const std::string &name = *reinterpret_cast<std::string *>(static_cast<char *>(layer) + 0x18);
    names.push_back(name.size() < 512 ? name : std::string());
  }
  return names;
}

void writeTensor(const std::string &path, const void *data, unsigned long bytes) {
  FILE *f = fopen(path.c_str(), "wb");
  if (!f) return;
  fwrite(data, 1, bytes, f);
  fclose(f);
}

void dumpFeatures(void *bytenn, uintptr_t slide, void *engine, int index, const std::string &outDir) {
  auto getNetwork = sym<void *(*)(void *)>(bytenn, "_ZN6BYTENN16ByteNNEngineImpl10GetNetworkEv");
  auto extract = reinterpret_cast<ExtractFn>(dlsym(bytenn,
      "_ZN10bytenn_cpu8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"));
  auto getInput = reinterpret_cast<GetInputFn>(dlsym(bytenn, "_ZN10bytenn_cpu16ThrustorGetInputEPNS_8ThrustorE"));
  auto byteSize = reinterpret_cast<TensorSizeFn>(dlsym(bytenn, "_ZNK6BYTENN6Tensor11GetByteSizeEv"));
  auto dataCount = reinterpret_cast<TensorSizeFn>(dlsym(bytenn, "_ZNK6BYTENN6Tensor12GetDataCountEv"));
  if (!extract) { printf("  没有 Thrustor::Extract\n"); return; }

  void *net = getNetwork(engine);
  if (!net) { printf("  引擎 %d 没有 LabNetWork\n", index); return; }
  void *thrustor = *reinterpret_cast<void **>(static_cast<char *>(net) + 0x40);
  if (!thrustor) { printf("  引擎 %d 没有 Thrustor\n", index); return; }

  std::vector<std::string> names = layerNames(slide, net);
  printf("  引擎 %d: %zu 层\n", index, names.size());
  if (names.empty()) return;

  std::string dir = outDir + "/engine-" + std::to_string(index);
  mkdir(outDir.c_str(), 0700);
  mkdir(dir.c_str(), 0700);
  FILE *idx = fopen((dir + "/features.tsv").c_str(), "w");
  if (idx) fprintf(idx, "序号\t名字\td0\td1\td2\td3\t元素数\t字节数\n");

  // 网络真正看到的输入张量(定死预处理)
  if (getInput) {
    RawTensor t{};
    t = getInput(thrustor);
    void *data = *reinterpret_cast<void **>(t.raw);
    unsigned long bytes = data ? tensorBytes(t.raw) : 0;
    const int32_t *d = reinterpret_cast<const int32_t *>(t.raw + 8);
    printf("    输入张量 data=%p dims=%d,%d,%d,%d bytes=%lu\n", data, d[0], d[1], d[2], d[3], bytes);
    if (data && bytes > 0) {
      writeTensor(dir + "/__input.f32", data, bytes);
      if (idx) fprintf(idx, "-1\t__input\t%d\t%d\t%d\t%d\t%lu\t%lu\n", d[0], d[1], d[2], d[3], bytes / 4, bytes);
    }
  }


  size_t written = 0;
  for (size_t i = 0; i < names.size(); ++i) {
    if (names[i].empty()) continue;
    RawTensor t{};
    t = extract(thrustor, &names[i]);
    void *data = *reinterpret_cast<void **>(t.raw);
    if (!data) continue;
    unsigned long bytes = tensorBytes(t.raw);
    unsigned long count = bytes / 4;
    if (bytes == 0) continue;
    const int32_t *d = reinterpret_cast<const int32_t *>(t.raw + 8);
    std::string safe = names[i];
    for (auto &c : safe) if (c == '/' || c == ' ') c = '_';
    char buf[16];
    snprintf(buf, sizeof(buf), "%03zu", i);
    writeTensor(dir + "/" + buf + "-" + safe + ".f32", data, bytes);
    if (idx) fprintf(idx, "%zu\t%s\t%d\t%d\t%d\t%d\t%lu\t%lu\n", i, names[i].c_str(), d[0], d[1], d[2], d[3], count, bytes);
    ++written;
  }
  if (idx) fclose(idx);
  printf("  ✓ 引擎 %d 导出 %zu 个激活张量 -> %s\n", index, written, dir.c_str());
}

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);
  if (argc < 6) {
    fprintf(stderr, "用法: feature-dump <runtime-dir> <frames.rgba> <width> <height> <out-dir> [帧数] [graph.json]\n");
    return 2;
  }
  g_runtime = argv[1];
  g_modelDir = g_runtime + "/Resources/models";
  std::string rawPath = argv[2];
  int width = atoi(argv[3]), height = atoi(argv[4]);
  std::string outDir = argv[5];
  int wantFrames = argc > 6 ? atoi(argv[6]) : 1;
  std::string graph = argc > 7 ? argv[7] : g_runtime + "/Resources/SceneEditDetection/config.json";

  std::string core = g_runtime + "/Frameworks/libcccreator.dylib";
  void *lib = dlopen(core.c_str(), RTLD_NOW | RTLD_GLOBAL);
  printf("F1 %s dlopen libcccreator\n", lib ? "OK " : "FAIL");
  if (!lib) { fprintf(stderr, "   %s\n", dlerror()); return 1; }

  auto createSystem = sym<void *(*)()>(lib, "_ZN4Bach20BachAlgorithmFactory21CreateAlgorithmSystemEv");
  void *system = createSystem();
  printf("F2 %s 算法系统 %p\n", system ? "OK " : "FAIL", system);
  if (!system) return 1;

  ProbeFinder finder{g_finderVtable};
  BachInitConfigView config; config.finder = &finder; config.first = "VESDK"; config.second = "";
  auto init = slot<int (*)(void *, const BachInitConfigView *)>(system, 2);
  int rc = init(system, &config);
  printf("F3 %s init -> %d\n", rc == 0 ? "OK " : "FAIL", rc);
  if (rc != 0) return 1;

  auto initGraph = slot<int (*)(void *, const std::string *)>(system, 3);
  rc = initGraph(system, &graph);
  printf("F4 %s initGraph -> %d\n", rc == 0 ? "OK " : "FAIL", rc);
  if (rc != 0) return 1;
  auto loadModel = slot<int (*)(void *)>(system, 32);
  rc = loadModel(system);
  printf("F5 %s loadModel -> %d\n", rc == 0 ? "OK " : "FAIL", rc);
  if (rc != 0) return 1;

  // 喂帧:最后一帧留在网络内部,随后原样取出每层激活
  int rawFd = open(rawPath.c_str(), O_RDONLY);
  if (rawFd < 0) { fprintf(stderr, "打不开 %s: %s\n", rawPath.c_str(), strerror(errno)); return 1; }
  size_t frameBytes = (size_t)width * height * 4;
  std::vector<unsigned char> pixels(frameBytes);
  uintptr_t base = imageBase(lib);
  auto execute = slot<int (*)(void *, const AlgorithmInputView *)>(system, 5);
  int fed = 0;
  while (fed < wantFrames) {
    size_t got = 0;
    while (got < frameBytes) {
      ssize_t r = read(rawFd, pixels.data() + got, frameBytes - got);
      if (r <= 0) break;
      got += (size_t)r;
    }
    if (got < frameBytes) break;
    ImageBufferView image{};
    image.vptr = reinterpret_cast<void *>(base + kImageVtableFileAddr);
    image.width = width; image.height = height; image.data = pixels.data(); image.format = 0;
    image.timestamp = fed / 24.0;
    AlgorithmInputView input{};
    input.vptr = reinterpret_cast<void *>(base + kInputVtableFileAddr);
    input.image = &image; input.data = pixels.data(); input.count = 1; input.f08 = 1;
    execute(system, &input);
    ++fed;
  }
  close(rawFd);
  printf("F6 OK  喂了 %d 帧(%dx%d rgba),最后一帧的激活留在网络里\n", fed, width, height);
  if (fed == 0) return 1;

  std::string bytennPath = g_runtime + "/Frameworks/libbytenn.dylib";
  void *bytenn = dlopen(bytennPath.c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!bytenn) { fprintf(stderr, "F7 FAIL dlopen libbytenn: %s\n", dlerror()); return 1; }
  uintptr_t slide = reinterpret_cast<uintptr_t>(sym<void *>(bytenn, "_ZN6BYTENN10LabNetWork9GetLayersEv")) - kLabGetLayersFileAddr;   // 缺符号就明确退出,不算出野 slide
  uintptr_t vptr = slide + kEngineVtableFileAddr + 16;
  g_slide = slide;
  std::vector<void *> engines = findEngines(vptr);
  printf("F7 OK  找到 %zu 个引擎对象\n", engines.size());

  for (size_t i = 0; i < engines.size(); ++i) {
    fflush(nullptr);
    pid_t pid = fork();                       // 一个引擎崩了不拖垮其它引擎
    if (pid == 0) { dumpFeatures(bytenn, slide, engines[i], (int)i, outDir); fflush(nullptr); _exit(0); }
    int st = 0; waitpid(pid, &st, 0);
    if (WIFSIGNALED(st)) printf("  引擎 %zu 处理时崩溃 (signal %d)\n", i, WTERMSIG(st));
  }
  return 0;
}
