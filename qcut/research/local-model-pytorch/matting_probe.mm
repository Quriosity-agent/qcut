// Private local diagnostics; graph and tensor outputs must remain ignored.
#define main shotWeightDumpMain
#include "../jianying-shot-split-probe/weight-dump.mm"
#undef main
#include <filesystem>
#include <random>
#include <CommonCrypto/CommonDigest.h>
#include <array>
#include <map>
#include <set>

bool hashMatches(const std::string &path, const std::string &expected) {
  NSData *bytes = [NSData dataWithContentsOfFile:@(path.c_str())];
  if (!bytes || bytes.length > UINT32_MAX) return false;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(bytes.bytes, static_cast<CC_LONG>(bytes.length), digest);
  std::string actual;
  for (unsigned char byte : digest) {
    char hex[3]; snprintf(hex, sizeof(hex), "%02x", byte); actual += hex;
  }
  return actual == expected;
}

struct IesTensorView {
  int32_t dims[4];
  uint64_t reserved;
  void *data;
  int32_t unknown, dtype, memory, padding;
  std::string name;
};
static_assert(sizeof(IesTensorView) == 72);

size_t checkedCount(const IesTensorView &tensor, bool output) {
  const std::map<std::string, std::array<int32_t,4>> shapes = output
      ? std::map<std::string, std::array<int32_t,4>>{{"nn_3",{256,256,2,1}}, {"Add_196",{16,16,80,1}}, {"Add_213",{32,32,56,1}}, {"Add_230",{64,64,32,1}}}
      : std::map<std::string, std::array<int32_t,4>>{{"data",{256,256,3,1}}, {"data1",{16,16,80,1}}, {"data2",{32,32,56,1}}, {"data3",{64,64,32,1}}};
  auto shape = shapes.find(tensor.name);
  if (shape == shapes.end() || tensor.dtype != 4 || (!output && tensor.memory != 1)) return 0;
  size_t count=1;
  for (size_t i=0; i<4; ++i) {
    if (tensor.dims[i]!=shape->second[i] || tensor.dims[i]<=0 || count > (1u<<22)/tensor.dims[i]) return 0;
    count *= tensor.dims[i];
  }
  return count;
}

bool oracle(void *lib, void *net, const std::string &out) {
  void *interpreter = *reinterpret_cast<void **>(static_cast<char *>(net) + 0x108);
  void *session = *reinterpret_cast<void **>(static_cast<char *>(net) + 0x110);
  auto config = sym<int (*)(void *, std::vector<IesTensorView> &)>(lib, "_ZN5IESNN11Interpreter14GetInputConfigERNSt3__16vectorINS_6TensorENS1_9allocatorIS3_EEEE");
  auto input = sym<int (*)(void *, std::vector<IesTensorView> &)>(lib, "_ZN5IESNN11Interpreter14SetEngineInputERNSt3__16vectorINS_6TensorENS1_9allocatorIS3_EEEE");
  auto run = sym<int (*)(void *, void *, std::string)>(lib, "_ZN5IESNN11Interpreter10RunSessionEPNS_7SessionENSt3__112basic_stringIcNS3_11char_traitsIcEENS3_9allocatorIcEEEE");
  auto output = sym<int (*)(void *, void *, std::vector<IesTensorView> &)>(lib, "_ZN5IESNN11Interpreter15GetEngineOutputEPNS_7SessionERNSt3__16vectorINS_6TensorENS3_9allocatorIS5_EEEE");
  std::vector<IesTensorView> inputs, outputs;
  int rc = config(interpreter, inputs);
  printf("oracle input_config=%d tensors=%zu\n", rc, inputs.size());
  if (rc || inputs.size()!=4) return false;
  std::vector<std::vector<float>> data;
  std::set<std::string> names;
  for (auto &t : inputs) {
    printf("input %s dims=%d,%d,%d,%d dtype=%d memory=%d\n", t.name.c_str(), t.dims[0],t.dims[1],t.dims[2],t.dims[3],t.dtype,t.memory);
    const size_t count=checkedCount(t,false);
    if (!count || !names.insert(t.name).second) return false;
    data.emplace_back(count, 0.0f);
    t.data=data.back().data();
  }
  std::mt19937 generator(17);
  std::uniform_real_distribution<float> distribution(-1.0,1.0);
  for (size_t caseIndex=0; caseIndex<3; ++caseIndex) {
    const std::string dir=out+"/case-"+std::to_string(caseIndex);
    std::filesystem::create_directories(dir);
    std::ofstream table(dir+"/tensors.tsv");
    for (size_t i=0; i<inputs.size(); ++i) {
      for (float &v : data[i]) v=caseIndex==0 ? 0.0f : distribution(generator);
      auto &t=inputs[i];
      std::ofstream f(dir+"/in-"+t.name+".f32",std::ios::binary);
      f.write(reinterpret_cast<char *>(t.data),data[i].size()*4);
      table<<"input\t"<<t.name<<"\t"<<t.dims[0]<<"\t"<<t.dims[1]<<"\t"<<t.dims[2]<<"\t"<<t.dims[3]<<"\n";
    }
    rc=input(interpreter,inputs); printf("oracle set=%d\n",rc); if(rc) return false;
    rc=run(interpreter,session,""); printf("oracle run=%d\n",rc); if(rc) return false;
    outputs.clear(); rc=output(interpreter,session,outputs);
    printf("oracle output=%d tensors=%zu\n",rc,outputs.size()); if(rc || outputs.size()!=4) return false;
    names.clear();
    for (const auto &t : outputs) {
      // GetEngineOutput does not initialize the input-only memory tag.
      printf("output %s dims=%d,%d,%d,%d dtype=%d\n",t.name.c_str(),t.dims[0],t.dims[1],t.dims[2],t.dims[3],t.dtype);
      const size_t count=checkedCount(t,true);
      if (!count || !t.data || !names.insert(t.name).second) return false;
      std::ofstream f(dir+"/out-"+t.name+".f32",std::ios::binary);
      f.write(static_cast<char *>(t.data),count*4);
      table<<"output\t"<<t.name<<"\t"<<t.dims[0]<<"\t"<<t.dims[1]<<"\t"<<t.dims[2]<<"\t"<<t.dims[3]<<"\n";
    }
  }
  return true;
}

struct MattingInputView {
  const uint8_t *data;
  int32_t format, width, height, stride, orientation, reserved;
  bool invert;
};
struct MattingOutputView { uint8_t *alpha; int32_t width, height; };
static_assert(offsetof(MattingInputView, invert) == 0x20);

int main(int argc, char **argv) {
  setvbuf(stdout, nullptr, _IONBF, 0);
  setvbuf(stderr, nullptr, _IONBF, 0);
  if (argc != 4) {
    fprintf(stderr, "usage: matting_probe <runtime> <model> <private-output>\n");
    return 2;
  }
  const std::string runtime = std::filesystem::absolute(argv[1]).string();
  const std::string model = std::filesystem::absolute(argv[2]).string();
  const std::string out = std::filesystem::absolute(argv[3]).string();
  const auto privateRoot = std::filesystem::weakly_canonical(".local/jianying-model-pytorch");
  const auto destination = std::filesystem::weakly_canonical(out);
  auto [rootEnd, destinationEnd] = std::mismatch(privateRoot.begin(), privateRoot.end(), destination.begin(), destination.end());
  if (rootEnd != privateRoot.end() || destination == privateRoot) {
    fprintf(stderr, "output must be a child of the private ignored root\n"); return 2;
  }
  if (!hashMatches(model, "101688825490be3704babc7ce49f6d002cdb4fe69e879556b4687ac9006f8596") ||
      !hashMatches(runtime + "/Frameworks/libbytenn.dylib", "febfce4549cd6337c232c22ed00463a54cda7b255c4961426a33bfc78542b863") ||
      !hashMatches(runtime + "/Frameworks/libcccreator.dylib", "0c39324edc0d8997d7c998c6a0867803b667fd40969e231a90ea502cc1e815b9")) {
    fprintf(stderr, "unsupported model/runtime hash; offsets are version-pinned\n"); return 2;
  }
  std::filesystem::create_directories(out);
  for (const auto &entry : std::filesystem::directory_iterator(out)) {
    if (entry.path().filename().string().rfind("case-", 0) == 0 || entry.path().filename().string().rfind("engine-", 0) == 0) {
      fprintf(stderr, "use a fresh evidence directory; stale tensors are not accepted\n"); return 2;
    }
  }
  // Vendor session construction may write its device-config cache to cwd.
  std::filesystem::current_path(destination);
  void *core = dlopen((runtime + "/Frameworks/libcccreator.dylib").c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!core) { fprintf(stderr, "dlopen: %s\n", dlerror()); return 1; }
  auto create = sym<int (*)(void **)>(core, "bef_Portrait_Matting_CreateHandle");
  auto init = sym<int (*)(void *, int, const char *)>(core, "bef_Portrait_Matting_InitModel");
  auto set = sym<int (*)(void *, int, int)>(core, "bef_MP_SetParam");
  auto get = sym<int (*)(void *, int, int *)>(core, "bef_Portrait_Matting_GetParam");
  auto size = sym<int (*)(void *, int, int, int *, int *)>(core, "bef_MP_GetAlphaSize");
  auto process = sym<int (*)(void *, const MattingInputView *, MattingOutputView *)>(core, "bef_Portrait_Matting_DoPortraitMatting");
  void *handle = nullptr;
  int rc = create(&handle);
  printf("create status=%d\n", rc);
  if (rc || !handle) return 1;
  rc = init(handle, 4, model.c_str());
  printf("init status=%d\n", rc);
  if (rc) return 1;
  int kind = -1;
  rc = get(handle, 6, &kind);
  printf("model_type status=%d value=%d\n", rc, kind);
  if (rc || kind != 6) return 1;
  for (const auto [key, value] : std::vector<std::pair<int, int>>{{5,1},{6,-1},{7,1},{8,1},{1,15},{0,1},{5,1}}) {
    rc = set(handle, key, value);
    printf("parameter=%d value=%d status=%d\n", key, value, rc);
    if (rc) return 1;
  }
  int width = 0, height = 0;
  rc = size(handle, 256, 256, &width, &height);
  printf("alpha_size status=%d width=%d height=%d\n", rc, width, height);
  if (rc || width <= 0 || height <= 0 || width > 256 || height > 256) return 1;
  std::vector<uint8_t> bgr(256 * 256 * 3, 127), alpha(width * height);
  MattingInputView input{bgr.data(),2,256,256,256*3,0,0,false};
  MattingOutputView output{alpha.data(),width,height};
  rc = process(handle, &input, &output);
  printf("frame status=%d\n", rc);
  if (rc) return 1;
  std::ofstream f(out + "/frame.gray", std::ios::binary);
  f.write(reinterpret_cast<const char *>(alpha.data()), alpha.size()); f.close();
  void *bytenn = dlopen((runtime + "/Frameworks/libbytenn.dylib").c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!bytenn) return 1;
  auto getNetwork = sym<GetNetworkFn>(bytenn, "_ZN6BYTENN16ByteNNEngineImpl10GetNetworkEv");
  const auto vtable = reinterpret_cast<uintptr_t>(sym<void *>(bytenn, "_ZTVN6BYTENN16ByteNNEngineImplE")) + 16;
  const auto labVtable = reinterpret_cast<uintptr_t>(sym<void *>(bytenn, "_ZTVN6BYTENN10LabNetWorkE")) + 16;
  g_slide = reinterpret_cast<uintptr_t>(sym<void *>(bytenn, "_ZN6BYTENN10LabNetWork9GetLayersEv")) - kLabGetLayersFileAddr;
  const auto engines = findEngines(vtable);
  printf("engines=%zu\n", engines.size());
  bool oraclePassed = false;
  for (void *engine : engines) {
    void *net=getNetwork(engine);
    uintptr_t actual=0; mach_vm_size_t got=0;
    if (!net || mach_vm_read_overwrite(mach_task_self(),reinterpret_cast<uintptr_t>(net),8,reinterpret_cast<uintptr_t>(&actual),&got)!=KERN_SUCCESS) continue;
    if (actual != reinterpret_cast<uintptr_t>(sym<void *>(bytenn,"_ZTVN6BYTENN10IESNetworkE"))+16) continue;
    oraclePassed = oracle(bytenn,net,out);
    break;
  }
  for (size_t i = 0; i < engines.size(); ++i) {
    const pid_t child = fork();
    if (child < 0) return 1;
    if (child != 0) {
      int status = 0;
      waitpid(child, &status, 0);
      printf("dump engine=%zu child_status=%d\n", i, status);
      continue;
    }
    void *net = getNetwork(engines[i]);
    if (!net) _exit(0);
    const auto actualVtable = *reinterpret_cast<uintptr_t *>(net);
    printf("engine=%zu network_vtable_offset=0x%lx lab=%d\n", i, actualVtable-g_slide, actualVtable==labVtable);
    if (actualVtable == labVtable) { dumpEngine(bytenn, engines[i], i, out); fflush(nullptr); _exit(0); }
    const std::string dir = out + "/engine-" + std::to_string(i);
    std::filesystem::create_directories(dir);
    for (int offset : {0x20, 0x28}) {
      char *config = *reinterpret_cast<char **>(static_cast<char *>(net) + offset);
      if (!config) continue;
      const void *loaded = *reinterpret_cast<void **>(config + 8);
      const int loadedSize = *reinterpret_cast<int *>(config + 0x10);
      printf("loaded_buffer_size=%d\n", loadedSize);
      if (loaded && loadedSize > 0 && loadedSize < 128*1024*1024) {
        std::ofstream loadedOut(dir + "/loaded-buffer.bin", std::ios::binary);
        loadedOut.write(static_cast<const char *>(loaded), loadedSize);
      }
      const std::string graph = *reinterpret_cast<std::string *>(config + 0xf8);
      printf("config_offset=%x graph_size=%zu\n", offset, graph.size());
      if (graph.size() > 0 && graph.size() < 1024*1024) {
        std::ofstream graphOut(dir + "/graph-" + std::to_string(offset) + ".txt", std::ios::binary);
        graphOut.write(graph.data(), graph.size());
      }
      void *weight = *reinterpret_cast<void **>(config + 0xc0);
      size_t length = *reinterpret_cast<size_t *>(config + 0xe0);
      printf("weight_size=%zu pointer=%p\n", length, weight);
      if (weight && length > 0 && length < 128*1024*1024) {
        std::ofstream weightOut(dir + "/weights-" + std::to_string(offset) + ".bin", std::ios::binary);
        weightOut.write(static_cast<char *>(weight), length);
      }
      for (int p = 0; p < 0xf8; p += 8) {
        const auto address = *reinterpret_cast<uintptr_t *>(config + p);
        unsigned char head[32] = {}; mach_vm_size_t got = 0;
        if (address < 0x10000 || mach_vm_read_overwrite(mach_task_self(), address, sizeof(head), reinterpret_cast<mach_vm_address_t>(head), &got) != KERN_SUCCESS) continue;
        printf("pointer_field=%x head=", p);
        for (unsigned char byte : head) printf("%02x", byte);
        printf("\n");
        if (p >= 0xc0 && length > 0 && length < 128*1024*1024) {
          std::vector<unsigned char> candidate(length);
          if (mach_vm_read_overwrite(mach_task_self(), address, length, reinterpret_cast<mach_vm_address_t>(candidate.data()), &got) == KERN_SUCCESS && got == length) {
            std::ofstream candidateOut(dir + "/candidate-" + std::to_string(p) + ".bin", std::ios::binary);
            candidateOut.write(reinterpret_cast<char *>(candidate.data()), candidate.size());
          }
        }
      }
    }
    fflush(nullptr); _exit(0);
  }
  return oraclePassed ? 0 : 1;
}
