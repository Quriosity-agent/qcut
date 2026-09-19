// Reuse the authored ABI probe; isolate heap-scan false positives before tracing.
#define main previousLayerTraceMain
#include "../jianying-shot-split-probe/layer-trace.mm"
#undef main

int main(int argc, char **argv) {
  if (argc != 8) {
    fprintf(stderr, "usage: legacy_shot_trace runtime rgba width height output frames layers\n");
    return 2;
  }
  setvbuf(stdout, nullptr, _IONBF, 0);
  g_runtime = argv[1]; g_modelDir = g_runtime + "/Resources/models"; g_outDir = argv[5];
  int width = atoi(argv[3]), height = atoi(argv[4]), frames = atoi(argv[6]), expected = atoi(argv[7]);
  if (width != 128 || height != 128 || frames < 12 || frames > 1000 || (expected != 118 && expected != 39)) return 2;
  void *lib = dlopen((g_runtime + "/Frameworks/libcccreator.dylib").c_str(), RTLD_NOW | RTLD_GLOBAL);
  if (!lib) { fprintf(stderr, "%s\n", dlerror()); return 1; }
  void *system = sym<void *(*)()>(lib, "_ZN4Bach20BachAlgorithmFactory21CreateAlgorithmSystemEv")();
  ProbeFinder finder{g_finderVtable};
  BachInitConfigView config; config.finder = &finder; config.first = "VESDK";
  std::string graph = g_runtime + "/Resources/SceneEditDetection/config.json";
  if (slot<int (*)(void *, const BachInitConfigView *)>(system, 2)(system, &config) ||
      slot<int (*)(void *, const std::string *)>(system, 3)(system, &graph) ||
      slot<int (*)(void *)>(system, 32)(system)) return 1;
  void *bytenn = dlopen((g_runtime + "/Frameworks/libbytenn.dylib").c_str(), RTLD_NOW | RTLD_GLOBAL);
  uintptr_t slide = reinterpret_cast<uintptr_t>(sym<void *>(bytenn, "_ZN6BYTENN10LabNetWork9GetLayersEv")) - kLabGetLayersFileAddr;
  auto getNetwork = sym<void *(*)(void *)>(bytenn, "_ZN6BYTENN16ByteNNEngineImpl10GetNetworkEv");
  std::vector<LayerRef> layers;
  for (void *engine : findEngines(slide + kEngineVtableFileAddr + 16)) {
    pid_t child = fork();
    if (child < 0) return 1;
    if (!child) {
      void *net = getNetwork(engine);
      _exit(net && collectLayers(slide, net).size() == static_cast<size_t>(expected) ? 0 : 3);
    }
    int status = 0;
    if (waitpid(child, &status, 0) < 0) return 1;
    if (!WIFEXITED(status) || WEXITSTATUS(status)) continue;
    void *net = getNetwork(engine);
    layers = collectLayers(slide, net);
    g_thrustor = *reinterpret_cast<void **>(static_cast<char *>(net) + 0x40);
    break;
  }
  if (layers.empty()) return 1;
  g_extract = sym<ExtractFn>(bytenn, "_ZN10bytenn_cpu8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
  mkdir(g_outDir.c_str(), 0700);
  for (size_t i = 0; i < layers.size(); ++i) {
    auto &layer = layers[i]; g_layerIndex[layer.layer] = {i, layer.name};
    if (g_origBySlot.count(layer.vtable)) continue;
    if (!makeWritable(layer.vtable, 20 * sizeof(void *))) return 1;
    for (int slot : {5, 18, 19}) {
      g_origBySlot[layer.vtable][slot] = layer.vtable[slot];
      layer.vtable[slot] = g_traced[slot];
    }
  }
  std::ifstream raw(argv[2], std::ios::binary);
  std::vector<unsigned char> pixels(static_cast<size_t>(width) * height * 4);
  uintptr_t base = imageBase(lib);
  auto execute = slot<int (*)(void *, const AlgorithmInputView *)>(system, 5);
  for (int frame = 0; frame < frames; ++frame) {
    if (!raw.read(reinterpret_cast<char *>(pixels.data()), pixels.size())) return 1;
    ImageBufferView image{}; image.vptr = reinterpret_cast<void *>(base + kImageVtableFileAddr);
    image.width = width; image.height = height; image.data = pixels.data(); image.timestamp = frame / 24.0;
    AlgorithmInputView input{}; input.vptr = reinterpret_cast<void *>(base + kInputVtableFileAddr);
    input.image = &image; input.data = pixels.data(); input.count = 1; input.f08 = 1;
    g_frameIndex = frame;
    if (execute(system, &input)) return 1;
  }
  FILE *index = fopen((g_outDir + "/features.tsv").c_str(), "w");
  if (!index) return 1;
  fprintf(index, "序号\t名字\td0\td1\td2\td3\t元素数\t字节数\n");
  for (const auto &entry : g_indexLines) fputs(entry.second.c_str(), index);
  fclose(index);
  printf("captured=%zu expected=%d frames=%d\n", g_indexLines.size(), expected, frames);
  return g_indexLines.empty() ? 1 : 0;
}
