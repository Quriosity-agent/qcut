// 逐层真值追踪:ByteNN 复用内存池,前向跑完后中间层缓冲区已被覆写(feature-dump 只能拿到
// 形状唯一的几层)。这里给每种层类型的 forward 虚函数挂钩子,**每层刚算完就立刻 Extract**,
// 于是 118 层全部是真值。forward 在虚表里的槽位靠计数探测(本地符号被剥了,dladdr 认不出)。
// 仅本机研究用,产物不入库。
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
#include <map>
#include <set>

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


// ---- 虚表钩子 ----
constexpr int kSlots = 64;
void *g_orig[kSlots];              // 探测阶段:被替换掉的原函数
long g_hits[kSlots];
int g_order[16]; int g_orderN = 0;          // 前 16 次调用的槽位顺序
using Slot8 = long (*)(long, long, long, long, long, long, long, long);
#define PROBE(N) static long probe_##N(long a0, long a1, long a2, long a3, long a4, long a5, long a6, long a7) { \
  ++g_hits[N]; if (g_orderN < 16) g_order[g_orderN++] = N; return reinterpret_cast<Slot8>(g_orig[N])(a0, a1, a2, a3, a4, a5, a6, a7); }
PROBE(0) PROBE(1) PROBE(2) PROBE(3) PROBE(4) PROBE(5) PROBE(6) PROBE(7) PROBE(8) PROBE(9) PROBE(10) PROBE(11) PROBE(12) PROBE(13) PROBE(14) PROBE(15) PROBE(16) PROBE(17) PROBE(18) PROBE(19) PROBE(20) PROBE(21) PROBE(22) PROBE(23) PROBE(24) PROBE(25) PROBE(26) PROBE(27) PROBE(28) PROBE(29) PROBE(30) PROBE(31) PROBE(32) PROBE(33) PROBE(34) PROBE(35) PROBE(36) PROBE(37) PROBE(38) PROBE(39) PROBE(40) PROBE(41) PROBE(42) PROBE(43) PROBE(44) PROBE(45) PROBE(46) PROBE(47) PROBE(48) PROBE(49) PROBE(50) PROBE(51) PROBE(52) PROBE(53) PROBE(54) PROBE(55) PROBE(56) PROBE(57) PROBE(58) PROBE(59) PROBE(60) PROBE(61) PROBE(62) PROBE(63) 
void *g_probes[kSlots] = {
  (void*)probe_0,(void*)probe_1,(void*)probe_2,(void*)probe_3,(void*)probe_4,(void*)probe_5,(void*)probe_6,(void*)probe_7,
  (void*)probe_8,(void*)probe_9,(void*)probe_10,(void*)probe_11,(void*)probe_12,(void*)probe_13,(void*)probe_14,(void*)probe_15,
  (void*)probe_16,(void*)probe_17,(void*)probe_18,(void*)probe_19,(void*)probe_20,(void*)probe_21,(void*)probe_22,(void*)probe_23,
  (void*)probe_24,(void*)probe_25,(void*)probe_26,(void*)probe_27,(void*)probe_28,(void*)probe_29,(void*)probe_30,(void*)probe_31,
  (void*)probe_32,(void*)probe_33,(void*)probe_34,(void*)probe_35,(void*)probe_36,(void*)probe_37,(void*)probe_38,(void*)probe_39,
  (void*)probe_40,(void*)probe_41,(void*)probe_42,(void*)probe_43,(void*)probe_44,(void*)probe_45,(void*)probe_46,(void*)probe_47,
  (void*)probe_48,(void*)probe_49,(void*)probe_50,(void*)probe_51,(void*)probe_52,(void*)probe_53,(void*)probe_54,(void*)probe_55,
  (void*)probe_56,(void*)probe_57,(void*)probe_58,(void*)probe_59,(void*)probe_60,(void*)probe_61,(void*)probe_62,(void*)probe_63};

bool makeWritable(void *addr, size_t len) {
  uintptr_t page = reinterpret_cast<uintptr_t>(addr) & ~(uintptr_t)0x3fff;
  uintptr_t end = (reinterpret_cast<uintptr_t>(addr) + len + 0x3fff) & ~(uintptr_t)0x3fff;
  return vm_protect(mach_task_self(), page, end - page, FALSE, VM_PROT_READ | VM_PROT_WRITE | VM_PROT_COPY) == KERN_SUCCESS;
}

// 收集层表:{层指针,名字,虚表}
struct LayerRef { void *layer; std::string name; void **vtable; };
std::vector<LayerRef> collectLayers(uintptr_t slide, void *net) {
  std::vector<LayerRef> out;
  void *thrustor = *reinterpret_cast<void **>(static_cast<char *>(net) + 0x40);
  void *impl = thrustor ? *reinterpret_cast<void **>(static_cast<char *>(thrustor) + 0x8) : nullptr;
  if (!impl) return out;
  auto buildLayerVec = reinterpret_cast<void (*)(void *, void *)>(slide + kLayerVecFileAddr);
  alignas(16) char vec[64] = {};
  buildLayerVec(vec, static_cast<char *>(impl) + 0x80);
  char *begin = *reinterpret_cast<char **>(vec), *end = *reinterpret_cast<char **>(vec + 8);
  if (!begin || end < begin) return out;
  for (size_t i = 0, n = (size_t)(end - begin) / 16; i < n; ++i) {
    void *layer = *reinterpret_cast<void **>(begin + i * 16);
    if (!layer) continue;
    const std::string &nm = *reinterpret_cast<std::string *>(static_cast<char *>(layer) + 0x18);
    out.push_back({layer, nm.size() < 400 ? nm : std::string(), *reinterpret_cast<void ***>(layer)});
  }
  return out;
}

// 正式阶段:候选槽位全部挂钩,每层每个槽位一返回就 Extract 一次;同一层后调用的覆盖先调用的,
// 留在磁盘上的就是前向完成后的输出。
void *g_thrustor = nullptr;
ExtractFn g_extract = nullptr;
std::string g_outDir;
std::vector<int> g_traceSlots;
std::map<void **, std::map<int, void *>> g_origBySlot;             // 虚表 -> 槽位 -> 原函数
std::map<void *, std::pair<size_t, std::string>> g_layerIndex;     // 层指针 -> (序号, 名字)
std::map<size_t, std::string> g_indexLines;

std::map<std::string, int> g_calls;
int g_frameIndex = -1;                      // 当前正在喂的帧序号(feed 里维护)
std::vector<float> g_fileArena;            // 预测头文件权重区,用来反查层对象指针指向的缓冲区
void loadFileArena() {
  if (!g_fileArena.empty()) return;
  FILE *f = fopen((g_modelDir + "/jy_compressShotDetectPredHead_new_v1.0_size0.bytenn").c_str(), "rb");
  if (!f) return;
  g_fileArena.resize(303236); fseek(f, 2911, SEEK_SET);
  g_fileArena.resize(fread(g_fileArena.data(), 4, g_fileArena.size(), f)); fclose(f);
}
long long findInArena(const float *probe, int n) {
  for (size_t i = 0; i + n <= g_fileArena.size(); ++i)
    if (g_fileArena[i] == probe[0] && memcmp(&g_fileArena[i], probe, n * 4) == 0) return (long long)i;
  return -1;
}
void dumpLayer(void *self) {
  auto it = g_layerIndex.find(self);
  if (it != g_layerIndex.end()) ++g_calls[it->second.second];
  // 逐帧概率序列:Sigmoid_52 每帧被三个槽位各钩一次,取第三次(forward 之后)
  if (it != g_layerIndex.end() && it->second.second == "Sigmoid_52" && g_calls["Sigmoid_52"] % 3 == 0 && g_extract && g_thrustor) {
    RawTensor t{}; t = g_extract(g_thrustor, &it->second.second);
    float *d = *reinterpret_cast<float **>(t.raw);
    if (d) { FILE *f = fopen((g_outDir + "/scores.tsv").c_str(), "a"); if (f) { fprintf(f, "%d\t%.8f\n", g_frameIndex, d[0]); fclose(f); } }
  }
  if (it == g_layerIndex.end() || !g_extract || !g_thrustor || it->second.second.empty()) return;
  RawTensor t{};
  t = g_extract(g_thrustor, &it->second.second);
  void *data = *reinterpret_cast<void **>(t.raw);
  unsigned long bytes = data ? tensorBytes(t.raw) : 0;
  for (int off : {0x1c0, 0x190}) {          // 层名不是 blob 名时(GRU),试层对象里的另两个字符串
    if (bytes) break;
    const std::string &alt = *reinterpret_cast<const std::string *>(static_cast<char *>(self) + off);
    if (alt.empty() || alt.size() > 200) continue;
    t = g_extract(g_thrustor, &alt);
    data = *reinterpret_cast<void **>(t.raw); bytes = data ? tensorBytes(t.raw) : 0;
  }
  if (!bytes) {
    // Extract 按名找不到(GRU 系列层):blob 名一定以字符串形式躺在层对象里(内联短串或指针指向的长串)。
    // 把 0x600 字节内所有可打印串和指针目标的可打印串都收集起来,逐个喂 Extract,命中的就是真张量。
    std::string safe = it->second.second;
    for (auto &c : safe) if (c == '/' || c == ' ') c = '_';
    char buf[16]; snprintf(buf, sizeof(buf), "%03zu", it->second.first);
    std::vector<std::string> cands;
    auto harvest = [&](const unsigned char *mem, size_t len) {
      size_t i = 0;
      while (i < len) {
        size_t j = i;
        while (j < len && mem[j] >= 0x20 && mem[j] < 0x7f) ++j;
        if (j - i >= 3 && j - i <= 120) cands.emplace_back(reinterpret_cast<const char *>(mem + i), j - i);
        i = j + 1;
      }
    };
    harvest(static_cast<const unsigned char *>(self), 0x600);
    std::vector<unsigned char> tmp(160);
    for (int off = 0; off < 0x600; off += 8) {
      uintptr_t p = *reinterpret_cast<uintptr_t *>(static_cast<char *>(self) + off);
      mach_vm_size_t got = 0;
      if (p < 0x10000 || mach_vm_read_overwrite(mach_task_self(), (mach_vm_address_t)p, tmp.size(), (mach_vm_address_t)tmp.data(), &got) != KERN_SUCCESS) continue;
      harvest(tmp.data(), (size_t)got);
    }
    static std::set<std::string> logged;
    int found = 0;
    for (const std::string &cand : cands) {
      if (cand == it->second.second) continue;
      RawTensor u{};
      u = g_extract(g_thrustor, &cand);
      void *d2 = *reinterpret_cast<void **>(u.raw);
      unsigned long b2 = d2 ? tensorBytes(u.raw) : 0;
      if (!b2) continue;
      const int32_t *dd = reinterpret_cast<const int32_t *>(u.raw + 8);
      std::string cs = cand; for (auto &c : cs) if (c == '/' || c == ' ' || c == ':') c = '_';
      writeTensor(g_outDir + "/" + buf + "-" + safe + ".blob-" + cs + ".f32", d2, b2);
      std::string key = it->second.second + "|" + cand;
      if (logged.insert(key).second)
        fprintf(stderr, "[trace-blob] %s <- blob \"%s\" dims %d,%d,%d,%d\n", it->second.second.c_str(), cand.c_str(), dd[0], dd[1], dd[2], dd[3]);
      ++found;
    }
    // 权重指针反查:每个指针字段(含二级)读 8 个 float 去文件权重区里找
    if (logged.insert(it->second.second + "|ptrscan").second) {
      loadFileArena();
      std::set<std::string> uniq(cands.begin(), cands.end());
      fprintf(stderr, "[trace-strings] %s: %zu 个不同串:", it->second.second.c_str(), uniq.size());
      for (const std::string &c : uniq) fprintf(stderr, " \"%s\"", c.c_str());
      fprintf(stderr, "\n");
      for (int off = 0; off < 0x600; off += 8) {
        uintptr_t p = *reinterpret_cast<uintptr_t *>(static_cast<char *>(self) + off);
        for (int level = 0; level < 2 && p >= 0x10000; ++level) {
          float probe[8]; mach_vm_size_t got = 0;
          if (mach_vm_read_overwrite(mach_task_self(), (mach_vm_address_t)p, sizeof(probe), (mach_vm_address_t)probe, &got) != KERN_SUCCESS) break;
          bool trivial = true; for (float v : probe) if (v != 0.0f && std::isfinite(v)) { trivial = false; break; }
          if (!trivial) {
            long long at = findInArena(probe, 8);
            if (at >= 0) fprintf(stderr, "[trace-ptr] %s 字段 +0x%03x%s -> 文件权重区 float %lld\n", it->second.second.c_str(), off, level ? "(二级)" : "", at);
          }
          uintptr_t q = 0; got = 0;
          if (mach_vm_read_overwrite(mach_task_self(), (mach_vm_address_t)p, 8, (mach_vm_address_t)&q, &got) != KERN_SUCCESS) break;
          p = q;
        }
      }
    }
    if (!found && logged.insert(it->second.second).second) {
      fprintf(stderr, "[trace-miss] %s: 收集到 %zu 个串,无一可 Extract;串样本:", it->second.second.c_str(), cands.size());
      for (size_t i = 0; i < cands.size() && i < 12; ++i) fprintf(stderr, " \"%s\"", cands[i].c_str());
      fprintf(stderr, "\n");
    }
    return;
  }
  const int32_t *d = reinterpret_cast<const int32_t *>(t.raw + 8);
  std::string safe = it->second.second;
  for (auto &c : safe) if (c == '/' || c == ' ') c = '_';
  char buf[16]; snprintf(buf, sizeof(buf), "%03zu", it->second.first);
  writeTensor(g_outDir + "/" + buf + "-" + safe + ".f32", data, bytes);
  char line[512];
  snprintf(line, sizeof(line), "%zu\t%s\t%d\t%d\t%d\t%d\t%lu\t%lu\n", it->second.first, it->second.second.c_str(), d[0], d[1], d[2], d[3], bytes / 4, bytes);
  g_indexLines[it->second.first] = line;
}
#define TRACED(N) static long traced_##N(long a0, long a1, long a2, long a3, long a4, long a5, long a6, long a7) { \
  void *self = reinterpret_cast<void *>(a0); void **vt = *reinterpret_cast<void ***>(self); \
  long r = reinterpret_cast<Slot8>(g_origBySlot[vt][N])(a0, a1, a2, a3, a4, a5, a6, a7); dumpLayer(self); return r; }
TRACED(0) TRACED(1) TRACED(2) TRACED(3) TRACED(4) TRACED(5) TRACED(6) TRACED(7) TRACED(8) TRACED(9) TRACED(10) TRACED(11) TRACED(12) TRACED(13) TRACED(14) TRACED(15) TRACED(16) TRACED(17) TRACED(18) TRACED(19) TRACED(20) TRACED(21) TRACED(22) TRACED(23) TRACED(24) TRACED(25) TRACED(26) TRACED(27) TRACED(28) TRACED(29) TRACED(30) TRACED(31) TRACED(32) TRACED(33) TRACED(34) TRACED(35) TRACED(36) TRACED(37) TRACED(38) TRACED(39) TRACED(40) TRACED(41) TRACED(42) TRACED(43) TRACED(44) TRACED(45) TRACED(46) TRACED(47) TRACED(48) TRACED(49) TRACED(50) TRACED(51) TRACED(52) TRACED(53) TRACED(54) TRACED(55) TRACED(56) TRACED(57) TRACED(58) TRACED(59) TRACED(60) TRACED(61) TRACED(62) TRACED(63) 
void *g_traced[kSlots] = {(void*)traced_0,(void*)traced_1,(void*)traced_2,(void*)traced_3,(void*)traced_4,(void*)traced_5,(void*)traced_6,(void*)traced_7,(void*)traced_8,(void*)traced_9,(void*)traced_10,(void*)traced_11,(void*)traced_12,(void*)traced_13,(void*)traced_14,(void*)traced_15,(void*)traced_16,(void*)traced_17,(void*)traced_18,(void*)traced_19,(void*)traced_20,(void*)traced_21,(void*)traced_22,(void*)traced_23,(void*)traced_24,(void*)traced_25,(void*)traced_26,(void*)traced_27,(void*)traced_28,(void*)traced_29,(void*)traced_30,(void*)traced_31,(void*)traced_32,(void*)traced_33,(void*)traced_34,(void*)traced_35,(void*)traced_36,(void*)traced_37,(void*)traced_38,(void*)traced_39,(void*)traced_40,(void*)traced_41,(void*)traced_42,(void*)traced_43,(void*)traced_44,(void*)traced_45,(void*)traced_46,(void*)traced_47,(void*)traced_48,(void*)traced_49,(void*)traced_50,(void*)traced_51,(void*)traced_52,(void*)traced_53,(void*)traced_54,(void*)traced_55,(void*)traced_56,(void*)traced_57,(void*)traced_58,(void*)traced_59,(void*)traced_60,(void*)traced_61,(void*)traced_62,(void*)traced_63};

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);
  if (argc < 6) {
    fprintf(stderr, "用法: layer-trace <runtime-dir> <frames.rgba> <width> <height> <out-dir> [帧数] [引擎层数=118] [槽位,如 5,18,19]\n");
    return 2;
  }
  g_runtime = argv[1]; g_modelDir = g_runtime + "/Resources/models";
  std::string rawPath = argv[2]; int width = atoi(argv[3]), height = atoi(argv[4]);
  g_outDir = argv[5]; int wantFrames = argc > 6 ? atoi(argv[6]) : 1; int wantLayers = argc > 7 ? atoi(argv[7]) : 118;
  if (argc > 8) { for (const char *c = argv[8]; *c; ) { g_traceSlots.push_back(atoi(c)); while (*c && *c != ',') ++c; if (*c) ++c; } }
  std::string graph = g_runtime + "/Resources/SceneEditDetection/config.json";

  void *lib = dlopen((g_runtime + "/Frameworks/libcccreator.dylib").c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!lib) { fprintf(stderr, "T1 FAIL dlopen: %s\n", dlerror()); return 1; }
  auto createSystem = sym<void *(*)()>(lib, "_ZN4Bach20BachAlgorithmFactory21CreateAlgorithmSystemEv");
  void *system = createSystem();
  ProbeFinder finder{g_finderVtable};
  BachInitConfigView config; config.finder = &finder; config.first = "VESDK"; config.second = "";
  if (slot<int (*)(void *, const BachInitConfigView *)>(system, 2)(system, &config) != 0) { fprintf(stderr, "T2 FAIL init\n"); return 1; }
  if (slot<int (*)(void *, const std::string *)>(system, 3)(system, &graph) != 0) { fprintf(stderr, "T3 FAIL initGraph\n"); return 1; }
  if (slot<int (*)(void *)>(system, 32)(system) != 0) { fprintf(stderr, "T4 FAIL loadModel\n"); return 1; }
  printf("T1-T4 OK  模型已加载\n");

  void *bytenn = dlopen((g_runtime + "/Frameworks/libbytenn.dylib").c_str(), RTLD_NOW | RTLD_GLOBAL);
  uintptr_t slide = reinterpret_cast<uintptr_t>(sym<void *>(bytenn, "_ZN6BYTENN10LabNetWork9GetLayersEv")) - kLabGetLayersFileAddr;   // 缺符号就明确退出,不算出野 slide
  g_extract = reinterpret_cast<ExtractFn>(dlsym(bytenn, "_ZN10bytenn_cpu8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"));
  auto getNetwork = sym<void *(*)(void *)>(bytenn, "_ZN6BYTENN16ByteNNEngineImpl10GetNetworkEv");
  std::vector<void *> engines = findEngines(slide + kEngineVtableFileAddr + 16);
  void *net = nullptr; std::vector<LayerRef> layers;
  for (void *e : engines) {
    void *n = getNetwork(e); if (!n) continue;
    std::vector<LayerRef> ls = collectLayers(slide, n);
    if ((int)ls.size() == wantLayers) { net = n; layers = ls; break; }
  }
  if (!net) { fprintf(stderr, "T5 FAIL 没找到 %d 层的引擎\n", wantLayers); return 1; }
  g_thrustor = *reinterpret_cast<void **>(static_cast<char *>(net) + 0x40);
  printf("T5 OK  引擎 %d 层,Thrustor %p\n", wantLayers, g_thrustor);

  // 喂帧的准备
  int rawFd = open(rawPath.c_str(), O_RDONLY);
  if (rawFd < 0) { fprintf(stderr, "打不开 %s\n", rawPath.c_str()); return 1; }
  size_t frameBytes = (size_t)width * height * 4;
  std::vector<unsigned char> pixels(frameBytes);
  uintptr_t base = imageBase(lib);
  auto execute = slot<int (*)(void *, const AlgorithmInputView *)>(system, 5);
  static int g_totalFed = 0;
  auto feed = [&](int count) {
    int fed = 0;
    while (fed < count) {
      size_t got = 0;
      while (got < frameBytes) { ssize_t r = read(rawFd, pixels.data() + got, frameBytes - got); if (r <= 0) break; got += (size_t)r; }
      if (got < frameBytes) break;
      ImageBufferView image{}; image.vptr = reinterpret_cast<void *>(base + kImageVtableFileAddr);
      image.width = width; image.height = height; image.data = pixels.data(); image.format = 0; image.timestamp = g_totalFed / 24.0;
      AlgorithmInputView input{}; input.vptr = reinterpret_cast<void *>(base + kInputVtableFileAddr);
      input.image = &image; input.data = pixels.data(); input.count = 1; input.f08 = 1;
      g_frameIndex = g_totalFed; execute(system, &input); ++fed; ++g_totalFed;
    }
    return fed;
  };

  int fed = 0;
  if (g_traceSlots.empty()) {
  // 阶段一:拿第一个 Convolution 层的虚表,全部槽位换成计数探针,喂一帧,看哪个槽被调了 33 次
    void **convVt = nullptr; int convCount = 0;
    for (auto &l : layers) {
      const std::string &kind = *reinterpret_cast<const std::string *>(static_cast<char *>(l.layer) + 0x30);
      if (kind.size() < 200 && kind == "Convolution" && !convVt) convVt = l.vtable;
    }
    for (auto &l : layers) if (l.vtable == convVt) ++convCount;
    if (!convVt || !makeWritable(convVt, kSlots * sizeof(void *))) { fprintf(stderr, "T6 FAIL 虚表不可写\n"); return 1; }
    int usable = 0;
    for (int i = 0; i < kSlots; ++i) {
      uintptr_t fn = reinterpret_cast<uintptr_t>(convVt[i]);
      if (fn < slide || fn > slide + (64u << 20)) break;     // 出了 libbytenn 就到虚表尾了
      g_orig[i] = convVt[i]; convVt[i] = g_probes[i]; ++usable;
    }
    printf("T6 OK  Convolution 虚表 %p,%d 个槽位挂上探针(该类型 %d 层)\n", convVt, usable, convCount);
    fed = feed(1);
    for (int i = 0; i < usable; ++i) convVt[i] = g_orig[i];
    printf("T7 OK  喂 %d 帧后各槽命中:", fed);
    for (int i = 0; i < usable; ++i) if (g_hits[i]) { printf(" [%d]=%ld", i, g_hits[i]); if (g_hits[i] == (long)convCount) g_traceSlots.push_back(i); }
    printf("\n       前几次调用顺序:"); for (int i = 0; i < g_orderN; ++i) printf(" %d", g_order[i]); printf("\n");
    if (g_traceSlots.empty()) { fprintf(stderr, "T7 FAIL 没有恰好命中 %d 次的槽\n", convCount); return 1; }
    printf("T7 OK  每层各调一次的槽位:"); for (int sl : g_traceSlots) printf(" %d", sl); printf("\n");
  } else { printf("T6-T7 跳过探测,使用指定槽位:"); for (int sl : g_traceSlots) printf(" %d", sl); printf("\n"); }

  // 阶段二:每种虚表的该槽位换成追踪钩子,再喂帧;最后一帧的每层输出即时落盘
  mkdir(g_outDir.c_str(), 0700);
  int maxSlot = g_traceSlots.back();
  for (size_t i = 0; i < layers.size(); ++i) {
    g_layerIndex[layers[i].layer] = {i, layers[i].name};
    if (g_origBySlot.count(layers[i].vtable)) continue;
    if (!makeWritable(layers[i].vtable, (maxSlot + 1) * sizeof(void *))) continue;
    for (int sl : g_traceSlots) {
      uintptr_t fn = reinterpret_cast<uintptr_t>(layers[i].vtable[sl]);
      if (fn < slide || fn > slide + (64u << 20)) continue;      // 这种层类型的虚表没这么长
      g_origBySlot[layers[i].vtable][sl] = layers[i].vtable[sl];
      layers[i].vtable[sl] = g_traced[sl];
    }
  }
  printf("T8 OK  %zu 种层类型挂上追踪钩子\n", g_origBySlot.size());
  fed += feed(wantFrames - 1);                 // 每层每帧都会重写同名文件,最后留下的是最后一帧
  close(rawFd);
  FILE *idx = fopen((g_outDir + "/features.tsv").c_str(), "w");
  if (idx) { fprintf(idx, "序号\t名字\td0\td1\td2\td3\t元素数\t字节数\n"); for (auto &kv : g_indexLines) fputs(kv.second.c_str(), idx); fclose(idx); }
  printf("T9 OK  逐层落盘 %zu 层\n", g_indexLines.size());
  for (size_t i = 0; i < layers.size() && i < 9; ++i) printf("       层 %zu %-28s 钩子调用 %d 次\n", i, layers[i].name.c_str(), g_calls[layers[i].name]);
  printf("T9 OK  共喂 %d 帧;逐层真值 -> %s\n", fed, g_outDir.c_str());
  return 0;
}
