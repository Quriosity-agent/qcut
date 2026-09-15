// 本地权重导出:复用桥接的加载流程,加载完成后在进程内定位 ByteNN 引擎对象,
// 用 libbytenn 自己导出的接口逐层取权重。仅本机研究用,产物不入库。
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

// ---- 引擎发现与权重导出 ----
constexpr uintptr_t kLabGetLayersFileAddr = 0x2eb00;      // BYTENN::LabNetWork::GetLayers()
constexpr uintptr_t kEngineVtableFileAddr = 0x4a8190;     // vtable for BYTENN::ByteNNEngineImpl

using GetNetworkFn = void *(*)(void *);
using GetLayersFn = int (*)(void *);
using GetLayerNameFn = std::string (*)(void *, int);
using GetWeightFn = int (*)(void *, const std::string *, void *);
using TensorSizeFn = unsigned long (*)(const void *);

// 扫描可读写内存,找首字等于引擎 vptr 的对象
std::vector<void *> findEngines(uintptr_t vptr) {
  std::vector<void *> hits;
  std::vector<uintptr_t> buf(1024 * 128);           // 1 MiB 一块
  mach_vm_address_t addr = 0;
  size_t scanned = 0, regions = 0;
  while (true) {
    mach_vm_size_t size = 0;
    vm_region_basic_info_data_64_t info{};
    mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
    mach_port_t object = MACH_PORT_NULL;
    if (mach_vm_region(mach_task_self(), &addr, &size, VM_REGION_BASIC_INFO_64,
                       (vm_region_info_t)&info, &count, &object) != KERN_SUCCESS) break;
    if (size == 0) break;
    ++regions;
    bool rw = (info.protection & VM_PROT_READ) && (info.protection & VM_PROT_WRITE);
    if (rw && size <= 256ull * 1024 * 1024) {
      for (mach_vm_size_t off = 0; off < size; off += buf.size() * sizeof(uintptr_t)) {
        mach_vm_size_t chunk = std::min<mach_vm_size_t>(buf.size() * sizeof(uintptr_t), size - off);
        mach_vm_size_t got = 0;
        if (mach_vm_read_overwrite(mach_task_self(), addr + off, chunk,
                                   (mach_vm_address_t)buf.data(), &got) != KERN_SUCCESS || got == 0) continue;
        scanned += got;
        for (size_t i = 0, n = got / sizeof(uintptr_t); i < n; ++i)
          if (buf[i] == vptr) hits.push_back(reinterpret_cast<void *>(addr + off + i * sizeof(uintptr_t)));
      }
    }
    addr += size;
  }
  printf("   扫描 %zu 个区域,共 %.1f MiB\n", regions, scanned / 1048576.0);
  return hits;
}

// 直接遍历引擎内部的层对象:层表由 0x1fedec 从 impl+0x80 构造,元素 16 字节(shared_ptr),
// 层对象里 +0x18 是名字,+0x24 起四个维度,+0x78 是权重数据指针(与 Thrustor::GetWeight 读的一致)。
constexpr uintptr_t kLayerVecFileAddr = 0x1fedec;

void walkLayers(void *bytenn, uintptr_t slide, void *net, const std::string &dir) {
  auto byteSize = reinterpret_cast<unsigned long (*)(const void *)>(
      dlsym(bytenn, "_ZNK6BYTENN6Tensor11GetByteSizeEv"));
  auto dataCount = reinterpret_cast<unsigned long (*)(const void *)>(
      dlsym(bytenn, "_ZNK6BYTENN6Tensor12GetDataCountEv"));
  void *thrustor = *reinterpret_cast<void **>(static_cast<char *>(net) + 0x40);
  if (!thrustor) { printf("  没有 Thrustor\n"); return; }
  void *impl = *reinterpret_cast<void **>(static_cast<char *>(thrustor) + 0x8);
  if (!impl) { printf("  没有 impl\n"); return; }
  auto getWeightLen = reinterpret_cast<int (*)(void *)>(dlsym(bytenn, "_ZN10bytenn_cpu8Thrustor12GetWeightLenEv"));
  if (getWeightLen) printf("  Thrustor::GetWeightLen() = %d\n", getWeightLen(thrustor));
  auto buildLayerVec = reinterpret_cast<void (*)(void *, void *)>(slide + kLayerVecFileAddr);
  alignas(16) char vec[64] = {};
  buildLayerVec(vec, static_cast<char *>(impl) + 0x80);
  char *begin = *reinterpret_cast<char **>(vec);
  char *end = *reinterpret_cast<char **>(vec + 8);
  if (!begin || end < begin) { printf("  层表为空\n"); return; }
  size_t count = (size_t)(end - begin) / 16;
  if (count > 20000) { printf("  层表项数不合理(%zu),跳过\n", count); return; }
  printf("  层表: %zu 项\n", count);

  FILE *idx = fopen((dir + "/weights.tsv").c_str(), "w");
  if (idx) fprintf(idx, "序号\t层名\td0\td1\td2\td3\t字节数\t元素数\n");
  FILE *params = fopen((dir + "/params.tsv").c_str(), "w");
  if (params) fprintf(params, "序号\t层名\t类型\tkh\tkw\tcin\tcout\tih\tiw\tf120\tf128\tf130\tf138\tf148\tf180\ts190\ts1c0\n");
  size_t dumped = 0, totalBytes = 0;
  for (size_t i = 0; i < count; ++i) {
    void *layer = *reinterpret_cast<void **>(begin + i * 16);
    if (!layer) continue;
    const std::string &name = *reinterpret_cast<std::string *>(static_cast<char *>(layer) + 0x18);
    void *data = *reinterpret_cast<void **>(static_cast<char *>(layer) + 0x78);
    const int32_t *src = reinterpret_cast<const int32_t *>(static_cast<char *>(layer) + 0x24);
    // 照 Thrustor::GetWeight 的交错方式拼出 Tensor,再用官方接口算长度
    alignas(16) unsigned char tensor[64] = {};
    *reinterpret_cast<void **>(tensor) = data;
    int32_t *td = reinterpret_cast<int32_t *>(tensor + 8);
    td[0] = src[0]; td[1] = src[2]; td[2] = src[1]; td[3] = src[3];
    *reinterpret_cast<int32_t *>(tensor + 0x18) = *reinterpret_cast<const int32_t *>(static_cast<char *>(layer) + 0x3c);
    *reinterpret_cast<int32_t *>(tensor + 0x1c) = *reinterpret_cast<const int32_t *>(static_cast<char *>(layer) + 0x44);
    unsigned long bytes = (data && byteSize) ? byteSize(tensor) : 0;
    unsigned long elems = (data && dataCount) ? dataCount(tensor) : 0;
    // 导出每层参数:类型、卷积核、输入输出通道(供离线把权重段切分到层)
    const std::string &kind = *reinterpret_cast<const std::string *>(static_cast<char *>(layer) + 0x30);
    const int32_t *p118 = reinterpret_cast<const int32_t *>(static_cast<char *>(layer) + 0x118);
    const int32_t *p140 = reinterpret_cast<const int32_t *>(static_cast<char *>(layer) + 0x140);
    const int32_t *p158 = reinterpret_cast<const int32_t *>(static_cast<char *>(layer) + 0x158);
    int kh = p118[0], kw = p118[1], cin = p140[0], cout = p140[1], ih = p158[0], iw = p158[1];
    // 更多字段:步长/padding/膨胀在 +0x120..+0x138,+0x190 与 +0x1c0 疑似输入输出张量名
    auto i32 = [layer](int off) { return *reinterpret_cast<const int32_t *>(static_cast<const char *>(layer) + off); };
    auto strAt = [layer](int off) -> std::string {
      const std::string &v = *reinterpret_cast<const std::string *>(static_cast<const char *>(layer) + off);
      return (v.size() < 512) ? v : std::string("?");
    };
    if (params)
      fprintf(params,
              "%zu\t%s\t%s\t%d\t%d\t%d\t%d\t%d\t%d"
              "\t%d,%d\t%d,%d\t%d,%d\t%d,%d\t%d,%d\t%d\t%s\t%s\n",
              i, name.c_str(), kind.c_str(), kh, kw, cin, cout, ih, iw,
              i32(0x120), i32(0x124), i32(0x128), i32(0x12c), i32(0x130), i32(0x134),
              i32(0x138), i32(0x13c), i32(0x148), i32(0x14c), i32(0x180),
              strAt(0x190).c_str(), strAt(0x1c0).c_str());
    if (i < 4)
      printf("    [%3zu] %-44s %-30s k=%dx%d %dx%d in=%dx%d\n", i, name.c_str(), kind.c_str(), kh, kw, cin, cout, ih, iw);
    if (idx) fprintf(idx, "%zu\t%s\t%d\t%d\t%d\t%d\t%lu\t%lu\n", i, name.c_str(), td[0], td[1], td[2], td[3], bytes, elems);
    if (data && bytes > 0 && bytes < (1ul << 27)) {
      std::string safe = name.empty() ? ("layer" + std::to_string(i)) : name;
      for (auto &c : safe) if (c == '/' || c == ' ') c = '_';
      FILE *f = fopen((dir + "/" + std::to_string(i) + "-" + safe + ".bin").c_str(), "wb");
      if (f) { fwrite(data, 1, bytes, f); fclose(f); ++dumped; totalBytes += bytes; }
    }
  }
  if (idx) fclose(idx);
  if (params) fclose(params);
  printf("  ✓ 导出 %zu 个权重张量,共 %.2f MiB -> %s\n", dumped, totalBytes / 1048576.0, dir.c_str());
}

void dumpEngine(void *bytenn, void *engine, int index, const std::string &outDir) {
  auto getNetwork = sym<GetNetworkFn>(bytenn, "_ZN6BYTENN16ByteNNEngineImpl10GetNetworkEv");
  auto getLayers = sym<GetLayersFn>(bytenn, "_ZN6BYTENN10LabNetWork9GetLayersEv");
  auto getLayerName = sym<GetLayerNameFn>(bytenn, "_ZN6BYTENN10LabNetWork12GetLayerNameEi");
  auto getWeight = sym<GetWeightFn>(bytenn,
      "_ZN6BYTENN10LabNetWork9GetWeightERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPNS_6TensorE");
  auto byteSize = reinterpret_cast<TensorSizeFn>(dlsym(bytenn, "_ZNK6BYTENN6Tensor11GetByteSizeEv"));
  auto dataCount = reinterpret_cast<TensorSizeFn>(dlsym(bytenn, "_ZNK6BYTENN6Tensor12GetDataCountEv"));

  void *net = getNetwork(engine);
  printf("  引擎 %d: %p -> LabNetWork %p\n", index, engine, net);
  if (!net) return;
  int layers = getLayers(net);
  printf("  层数: %d\n", layers);
  if (layers <= 0 || layers > 20000) { printf("  层数不合理,跳过\n"); return; }

  std::string dir = outDir + "/engine-" + std::to_string(index);
  mkdir(outDir.c_str(), 0700); mkdir(dir.c_str(), 0700);
  FILE *idx = fopen((dir + "/index.tsv").c_str(), "w");
  if (idx) fprintf(idx, "层号\t层名\t字节数\t元素数\td0\td1\td2\td3\n");
  int withWeights = 0;
  for (int i = 0; i < layers; ++i) {
    std::string name = getLayerName(net, i);
    alignas(16) unsigned char tensor[256] = {};
    int rc = -1;          // 首次尝试的返回值,仅用于打印
    bool found = false;   // 只有某个后缀真正拿到数据指针才算成功;失败时 tensor 保持清零
    std::string used;
    if (!name.empty()) {
      const char *suffixes[] = {"", ".weight", "_weight", ".w", ".conv.weight", "/weight"};
      for (const char *sfx : suffixes) {
        std::string candidate = name + sfx;
        memset(tensor, 0, sizeof(tensor));
        int r = getWeight(net, &candidate, tensor);
        if (rc == -1) rc = r;
        if (r == 0 && *reinterpret_cast<void **>(tensor)) { rc = r; used = candidate; found = true; break; }
      }
      if (!found) memset(tensor, 0, sizeof(tensor));
      if (!used.empty()) name = used;
    }
    void *data = found ? *reinterpret_cast<void **>(tensor) : nullptr;
    int32_t *dims = reinterpret_cast<int32_t *>(tensor + 8);
    unsigned long bytes = (found && byteSize) ? byteSize(tensor) : 0;
    unsigned long count = (found && dataCount) ? dataCount(tensor) : 0;
    if (i < 8 || (data && i % 50 == 0))
      printf("    [%3d] %-34s rc=%d data=%p dims=%d,%d,%d,%d bytes=%lu count=%lu\n",
             i, name.c_str(), rc, data, dims[0], dims[1], dims[2], dims[3], bytes, count);
    if (idx) fprintf(idx, "%d\t%s\t%lu\t%lu\t%d\t%d\t%d\t%d\n", i, name.c_str(), bytes, count, dims[0], dims[1], dims[2], dims[3]);
    if (data && bytes > 0 && bytes < (1ul << 28)) {
      std::string safe = name.empty() ? ("layer" + std::to_string(i)) : name;
      for (auto &c : safe) if (c == '/' || c == ' ') c = '_';
      FILE *f = fopen((dir + "/" + std::to_string(i) + "-" + safe + ".bin").c_str(), "wb");
      if (f) { fwrite(data, 1, bytes, f); fclose(f); ++withWeights; }
    }
  }
  if (idx) fclose(idx);
  printf("  带权重的层: %d,已写入 %s\n", withWeights, dir.c_str());

  walkLayers(bytenn, g_slide, net, dir);

  // SaveModel:把加载后的模型序列化回磁盘,权重会一并写出
  auto saveModel = reinterpret_cast<int (*)(void *, void *)>(
      dlsym(bytenn, "_ZN6BYTENN10LabNetWork9SaveModelEPv"));
  if (saveModel) {
    for (int form = 0; form < 2; ++form) {
      std::string path = dir + "/saved-form" + std::to_string(form) + ".bytenn";
      unlink(path.c_str());
      fflush(nullptr);
      pid_t pid = fork();
      if (pid == 0) {
        int rc = form == 0 ? saveModel(net, &path)
                           : saveModel(net, (void *)path.c_str());
        printf("    SaveModel 形态%d -> %d\n", form, rc);
        fflush(nullptr); _exit(0);
      }
      int st = 0; waitpid(pid, &st, 0);
      if (WIFSIGNALED(st)) printf("    SaveModel 形态%d 崩溃\n", form);
      struct stat sb{};
      if (stat(path.c_str(), &sb) == 0 && sb.st_size > 0)
        printf("    ✓ 形态%d 写出 %lld 字节: %s\n", form, (long long)sb.st_size, path.c_str());
    }
  }
}

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);
  if (argc < 2) { fprintf(stderr, "用法: weight-dump <runtime-dir> [graph.json] [out-dir]\n"); return 2; }
  g_runtime = argv[1];
  g_modelDir = g_runtime + "/Resources/models";
  std::string graph = argc > 2 ? argv[2] : g_runtime + "/Resources/SceneEditDetection/config.json";
  std::string outDir = argc > 3 ? argv[3] : "weights";

  std::string core = g_runtime + "/Frameworks/libcccreator.dylib";
  void *lib = dlopen(core.c_str(), RTLD_NOW | RTLD_GLOBAL);
  printf("W1 %s dlopen libcccreator\n", lib ? "OK " : "FAIL");
  if (!lib) { fprintf(stderr, "   %s\n", dlerror()); return 1; }

  auto createSystem = sym<void *(*)()>(lib, "_ZN4Bach20BachAlgorithmFactory21CreateAlgorithmSystemEv");
  void *system = createSystem();
  printf("W2 %s 算法系统 %p\n", system ? "OK " : "FAIL", system);
  if (!system) return 1;

  ProbeFinder finder{g_finderVtable};
  BachInitConfigView config; config.finder = &finder; config.first = "VESDK"; config.second = "";
  auto init = slot<int (*)(void *, const BachInitConfigView *)>(system, 2);
  int rc = init(system, &config);
  printf("W3 %s init -> %d\n", rc == 0 ? "OK " : "FAIL", rc);
  if (rc != 0) return 1;

  auto initGraph = slot<int (*)(void *, const std::string *)>(system, 3);
  rc = initGraph(system, &graph);
  printf("W4 %s initGraph -> %d\n", rc == 0 ? "OK " : "FAIL", rc);
  if (rc != 0) return 1;
  auto loadModel = slot<int (*)(void *)>(system, 32);
  rc = loadModel(system);
  printf("W5 %s loadModel -> %d\n", rc == 0 ? "OK " : "FAIL", rc);
  if (rc != 0) return 1;

  std::string bytennPath = g_runtime + "/Frameworks/libbytenn.dylib";
  void *bytenn = dlopen(bytennPath.c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!bytenn) { fprintf(stderr, "W6 FAIL dlopen libbytenn: %s\n", dlerror()); return 1; }
  uintptr_t slide = reinterpret_cast<uintptr_t>(sym<void *>(bytenn, "_ZN6BYTENN10LabNetWork9GetLayersEv")) - kLabGetLayersFileAddr;   // 缺符号就明确退出,不算出野 slide
  uintptr_t vptr = slide + kEngineVtableFileAddr + 16;   // Itanium ABI:对象首字指向虚表第 3 个槽
  g_slide = slide;
  printf("W6 OK  libbytenn slide=0x%lx 引擎 vptr=0x%lx\n", (unsigned long)slide, (unsigned long)vptr);

  std::vector<void *> engines = findEngines(vptr);
  printf("W7 内存中找到 %zu 个引擎对象\n", engines.size());
  for (size_t i = 0; i < engines.size(); ++i) {
    fflush(nullptr);
    pid_t pid = fork();
    if (pid == 0) { dumpEngine(bytenn, engines[i], (int)i, outDir); fflush(nullptr); _exit(0); }
    int st = 0; waitpid(pid, &st, 0);
    if (WIFSIGNALED(st)) printf("  引擎 %zu 处理时崩溃 (signal %d)\n", i, WTERMSIG(st));
  }
  return 0;
}
