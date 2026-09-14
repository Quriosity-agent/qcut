// 本地探针:不经剪映、不经 Bach,直接用 ByteNN 导出的接口加载 .bytenn 并列出层与权重。
// 每个尝试放在 fork 的子进程里,崩溃不影响后续。仅本机研究用。
#include <dlfcn.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <fstream>
#include <sys/wait.h>
#include <unistd.h>

struct TensorView { void *data; int d0, d1, d2, d3; int e0, e1; };

static void *g_lib = nullptr;
template <typename T> static T sym(const char *name) {
  void *p = dlsym(g_lib, name);
  if (!p) fprintf(stderr, "   [缺符号] %s\n", name);
  return reinterpret_cast<T>(p);
}

// 在子进程里跑,返回子进程退出码
static int attempt(const char *label, void (*body)(const std::string &), const std::string &arg) {
  fflush(nullptr);
  pid_t pid = fork();
  if (pid == 0) { body(arg); fflush(nullptr); _exit(0); }
  int st = 0; waitpid(pid, &st, 0);
  if (WIFSIGNALED(st)) printf("   %s -> 崩溃 (signal %d)\n", label, WTERMSIG(st));
  return st;
}

static void tryCreateNetFromFile(const std::string &path) {
  auto fn = sym<void *(*)(const char *)>("_ZN5IESNN3Net17CreateNetFromFileEPKc");
  if (!fn) return;
  void *net = fn(path.c_str());
  printf("   CreateNetFromFile -> %p\n", net);
  if (!net) return;
  auto getIes = sym<void *(*)(void *)>("_ZNK5IESNN3Net9GetIESNetEv");
  void *ies = getIes ? getIes(net) : nullptr;
  printf("   GetIESNet -> %p\n", ies);

  // 在 IESNet 对象里找疑似 std::vector<Layer*>:begin/end/cap 三元组
  if (!ies) return;
  unsigned char *p = (unsigned char *)ies;
  printf("   扫描 IESNet 前 0x200 字节里的向量三元组:\n");
  for (size_t off = 0; off + 24 <= 0x200; off += 8) {
    unsigned char *vb = *(unsigned char **)(p + off);
    unsigned char *ve = *(unsigned char **)(p + off + 8);
    unsigned char *vc = *(unsigned char **)(p + off + 16);
    if (!vb || ve <= vb || vc < ve) continue;
    size_t span = (size_t)(ve - vb);
    if (span % 8 || span > 1u << 20) continue;
    printf("     +0x%03zx: begin=%p 元素数=%zu(按8字节)\n", off, vb, span / 8);
  }

  // 配置调用另起子进程,避免崩溃丢掉上面的结果
  if (fork() == 0) {
  // 输入/输出张量描述(导出接口,无需猜结构)
  auto inCfg = sym<int (*)(void *, void *)>("_ZN5IESNN3Net14GetInputConfigERNSt3__16vectorINS_6TensorENS1_9allocatorIS3_EEEE");
  auto outCfg = sym<int (*)(void *, void *)>("_ZN5IESNN3Net15GetOutputConfigERNSt3__16vectorINS_6TensorENS1_9allocatorIS3_EEEE");
  for (int which = 0; which < 2; ++which) {
    auto fnCfg = which == 0 ? inCfg : outCfg;
    if (!fnCfg) continue;
    unsigned char vec[24] = {};          // std::vector: begin/end/cap
    int rc = fnCfg(net, vec);
    unsigned char *b = *(unsigned char **)(vec + 0), *e = *(unsigned char **)(vec + 8);
    size_t bytes = (b && e && e > b) ? (size_t)(e - b) : 0;
    printf("   %s rc=%d 字节数=%zu\n", which == 0 ? "GetInputConfig " : "GetOutputConfig", rc, bytes);
    for (size_t off = 0; off < bytes && off < 192; off += 16) {
      printf("     +%03zu:", off);
      for (int k = 0; k < 16 && off + k < bytes; ++k) printf(" %02x", b[off + k]);
      printf("\n");
    }
  }

    _exit(0);
  } else { int st; wait(&st); if (WIFSIGNALED(st)) printf("   GetInput/OutputConfig -> 崩溃\n"); }
}

static void tryThrustor(const std::string &path) {
  auto ctor = sym<void *(*)(void *)>("_ZN10bytenn_cpu8ThrustorC1Ev");
  auto createNet = sym<int (*)(void *, const std::string *, void *, std::vector<std::string> *)>(
      "_ZN10bytenn_cpu8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
  auto getLayers = sym<int (*)(void *)>("_ZN10bytenn_cpu8Thrustor9getLayersEv");
  auto layerName = sym<void (*)(void *, void *, int)>("_ZN10bytenn_cpu8Thrustor9LayerNameEi");
  auto getWeight = sym<void (*)(void *, TensorView *, const std::string *)>(
      "_ZN10bytenn_cpu8Thrustor9GetWeightERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
  if (!ctor || !createNet) return;

  alignas(16) unsigned char obj[256] = {};
  ctor(obj);
  std::ifstream in(path, std::ios::binary);
  std::string blob((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
  printf("   模型字节数 %zu\n", blob.size());

  std::vector<std::string> names;
  // 形态 1:字符串 = 路径,void* = 文件缓冲
  int rc = createNet(obj, &path, (void *)blob.data(), &names);
  printf("   CreateNet(路径, 缓冲) -> %d, 输出名 %zu\n", rc, names.size());
  if (rc != 0) {
    // 形态 2:字符串 = 模型内容,void* = 非空哑指针
    static int dummy = 0;
    names.clear();
    rc = createNet(obj, &blob, (void *)&dummy, &names);
    printf("   CreateNet(内容, 哑指针) -> %d, 输出名 %zu\n", rc, names.size());
  }
  if (rc != 0) return;
  for (auto &n : names) printf("     输出: %s\n", n.c_str());
  if (getLayers) {
    int n = getLayers(obj);
    printf("   getLayers -> %d\n", n);
    for (int i = 0; i < n && i < 12; ++i) {
      std::string nm;
      if (layerName) layerName(obj, &nm, i);
      TensorView t{};
      if (getWeight && !nm.empty()) getWeight(obj, &t, &nm);
      printf("     [%2d] %-28s data=%p dims=%d,%d,%d,%d e=%d,%d\n", i, nm.c_str(), t.data, t.d0, t.d1, t.d2, t.d3, t.e0, t.e1);
    }
  }
}

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);
  if (argc < 3) { fprintf(stderr, "用法: bytenn-probe <runtime-dir> <model.bytenn>\n"); return 2; }
  std::string runtime = argv[1], model = argv[2];
  std::string lib = runtime + "/Frameworks/libbytenn.dylib";
  g_lib = dlopen(lib.c_str(), RTLD_NOW | RTLD_GLOBAL);
  printf("P1 %s dlopen %s\n", g_lib ? "OK " : "FAIL", lib.c_str());
  if (!g_lib) { fprintf(stderr, "   %s\n", dlerror()); return 1; }

  printf("P2 尝试 IESNN::Net::CreateNetFromFile\n");
  attempt("CreateNetFromFile", tryCreateNetFromFile, model);
  printf("P3 尝试 bytenn_cpu::Thrustor\n");
  attempt("Thrustor", tryThrustor, model);
  return 0;
}
