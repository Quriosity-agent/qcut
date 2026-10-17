// Capture the model bytes a host process hands to the pinned ByteNN runtime.
//
// Some Jianying model files are versioned wrappers whose payload is not a
// readable BM container on disk. The effect SDK unpacks them before creating a
// network, so recording what reaches the runtime in a headless host
// (DYLD_INSERT_LIBRARIES) yields exactly the bytes the runtime parses, without
// patching any vendor code. Nothing is captured unless QCUT_BYTENN_CAPTURE_DIR
// names a writable directory.
//
// Three recorders, because the runtime's own entry points are reached by
// intra-library calls that dyld interposing cannot see:
//   1. dyld interposing of the cross-library entry points: the IESNN::Net
//      CreateNet variants, the legacy espresso::Thrustor::CreateNet that the
//      SMASH face algorithms call directly (graph text + arena pointer), and
//      BYTENN::EngineFactory::Create.
//   2. Every engine returned by EngineFactory::Create gets a private copy of its
//      vtable whose Init(Config) / Init(ConfigExt) slots point at recorders. The
//      recorder dumps the config block and every BM container it points at.
//   3. After such an Init returns, readable private memory is scanned for graph
//      text, so a container the runtime decodes internally (packed BM v2) still
//      leaves its plaintext graph in the capture directory. Every stamp named by
//      a found graph header is then searched for as well, and the bytes before
//      each hit are dumped: a decoded arena ends with its graph's stamp, so the
//      arena is carved offline from that window by the graph's own byte count.
// In-place code patching of the intra-library entry points is not an option:
// executing a modified page of the signed runtime kills the host (SIGBUS).
//
// Build (link against the runtime so the replacee symbols bind at insert time):
//   clang++ -std=c++17 -O1 -dynamiclib -fobjc-arc -framework Foundation \
//     -L<runtime>/Frameworks -lbytenn -Wl,-rpath,<runtime>/Frameworks \
//     bytenn_model_capture.mm -o bytenn-model-capture.dylib
// Use:
//   QCUT_BYTENN_CAPTURE_DIR=<dir> DYLD_INSERT_LIBRARIES=<dylib> <host> ...
// QCUT_BYTENN_CAPTURE_ENGINE_IO=1 also records what crosses ByteNNEngine's
// SetInput / GetInputConfig / Inference / GetOutput (see the engine recorders).
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <algorithm>
#include <sstream>
#include <set>
#include <string>
#include <vector>

namespace BYTENN {
class ByteNNEngine;
}

namespace {

constexpr size_t kConfigDumpLimit = 4096;
constexpr size_t kModelDumpLimit = 256u * 1024u * 1024u;
constexpr size_t kVtableSlots = 256;
constexpr size_t kHeapRegionLimit = 512u * 1024u * 1024u;
constexpr size_t kHeapWindow = 4u * 1024u * 1024u;
constexpr size_t kStampWindow = 16u * 1024u * 1024u;

std::mutex captureMutex;
std::atomic<int> sequence{0};

const char *captureDirectory() {
  static const char *directory = std::getenv("QCUT_BYTENN_CAPTURE_DIR");
  return directory && *directory ? directory : nullptr;
}

std::string capturePath(int index, const char *kind, const char *extension) {
  char name[512];
  std::snprintf(name, sizeof name, "%s/%03d-%s.%s", captureDirectory(), index, kind, extension);
  return name;
}

// Every dump goes through mach_vm_read_overwrite: a region that reports itself
// readable can still fault on a direct access (the body-keypoint package's
// config block did), and a kernel copy fails cleanly instead.
std::vector<unsigned char> copyMemory(const void *data, size_t size) {
  std::vector<unsigned char> copy(size);
  mach_vm_size_t copied = 0;
  if (!size || mach_vm_read_overwrite(mach_task_self(), reinterpret_cast<mach_vm_address_t>(data), size,
                                      reinterpret_cast<mach_vm_address_t>(copy.data()), &copied) != KERN_SUCCESS) {
    return {};
  }
  copy.resize(static_cast<size_t>(copied));
  return copy;
}

// Writes what could be copied and returns that count, so callers can record a
// short or failed dump instead of describing it with the requested size.
size_t writeBytes(const std::string &path, const void *data, size_t size) {
  const std::vector<unsigned char> copy = copyMemory(data, size);
  std::ofstream output(path, std::ios::binary);
  output.write(reinterpret_cast<const char *>(copy.data()), static_cast<std::streamsize>(copy.size()));
  return output ? copy.size() : 0;
}

std::string dumpDetail(size_t requested, size_t written) {
  return written == requested ? std::string() : " requested=" + std::to_string(requested) + " written=" + std::to_string(written);
}

void writeMeta(int index, const char *kind, const std::string &detail, size_t size) {
  std::ofstream output(capturePath(index, kind, "json"));
  output << "{\"index\": " << index << ", \"kind\": \"" << kind << "\", \"bytes\": " << size
         << ", \"detail\": \"" << detail << "\"}\n";
}

bool regionAt(mach_vm_address_t address, mach_vm_address_t *start, mach_vm_size_t *size,
              vm_region_basic_info_data_64_t *info) {
  mach_msg_type_number_t count = VM_REGION_BASIC_INFO_COUNT_64;
  mach_port_t object = MACH_PORT_NULL;
  *start = address;
  return mach_vm_region(mach_task_self(), start, size, VM_REGION_BASIC_INFO_64, reinterpret_cast<vm_region_info_t>(info),
                        &count, &object) == KERN_SUCCESS;
}

// Bytes reachable from `data` without touching unmapped memory. Contiguous
// readable regions are chained, because a large allocation can straddle the
// boundary between two mapped regions.
size_t mappedExtent(const void *data, size_t limit) {
  const mach_vm_address_t address = reinterpret_cast<mach_vm_address_t>(data);
  mach_vm_address_t cursor = address;
  while (cursor - address < limit) {
    mach_vm_address_t start = 0;
    mach_vm_size_t size = 0;
    vm_region_basic_info_data_64_t info;
    if (!regionAt(cursor, &start, &size, &info) || start > cursor || !(info.protection & VM_PROT_READ)) break;
    cursor = start + size;
  }
  const size_t available = static_cast<size_t>(cursor - address);
  return available < limit ? available : limit;
}

void captureBuffer(const char *kind, const std::string &detail, const void *data, size_t size) {
  if (!captureDirectory() || !data || !size) return;
  std::lock_guard<std::mutex> lock(captureMutex);
  const int index = sequence++;
  const size_t written = writeBytes(capturePath(index, kind, "bin"), data, size);
  writeMeta(index, kind, detail + dumpDetail(size, written), written);
}

// A BM container declares its own byte length at offset 4.
size_t bmContainerLength(const unsigned char *data, size_t extent) {
  // `data` holds at least the 12-byte header; `extent` bounds the container length.
  if (extent < 12 || std::memcmp(data, "BM\0", 3) != 0 || data[3] < 2 || data[3] > 5) return 0;
  uint32_t length = 0;
  std::memcpy(&length, data + 4, sizeof length);
  return length >= 12 && length <= extent ? length : 0;
}

std::string hex(const unsigned char *data, size_t size) {
  static const char digits[] = "0123456789abcdef";
  std::string text;
  for (size_t i = 0; i < size; ++i) {
    text += digits[data[i] >> 4];
    text += digits[data[i] & 15];
  }
  return text;
}

bool graphTextByte(unsigned char value) { return (value >= 32 && value < 127) || value == '\n' || value == '\r' || value == '\t'; }

// The stamp is the third field of the `<inputs> <layers> <stamp>` header line, after an optional letter line.
bool headerStamp(const std::string &text, uint32_t *stamp) {
  size_t cursor = 0;
  for (int line = 0; line < 2 && cursor < text.size(); ++line) {
    const size_t end = text.find('\n', cursor);
    const std::string row = text.substr(cursor, end == std::string::npos ? std::string::npos : end - cursor);
    cursor = end == std::string::npos ? text.size() : end + 1;
    unsigned inputs = 0, layers = 0;
    unsigned long long value = 0;
    if (std::sscanf(row.c_str(), "%u %u %llu", &inputs, &layers, &value) == 3 && value <= 0xFFFFFFFFull) {
      *stamp = static_cast<uint32_t>(value);
      return true;
    }
  }
  return false;
}

// Copy every readable, non-shared, non-executable region and hand it to `visit`.
template <typename Visit> void forEachRegion(Visit visit, size_t *scanned, int *regions, int *unreadable) {
  std::vector<unsigned char> copy;
  mach_vm_address_t cursor = 1;
  while (*scanned < 8ull * 1024u * 1024u * 1024u) {
    mach_vm_address_t start = 0;
    mach_vm_size_t size = 0;
    vm_region_basic_info_data_64_t info;
    if (!regionAt(cursor, &start, &size, &info)) break;
    cursor = start + size;
    if (!(info.protection & VM_PROT_READ) || (info.protection & VM_PROT_EXECUTE) || info.shared || size > kHeapRegionLimit) continue;
    copy.resize(static_cast<size_t>(size));
    mach_vm_size_t copied = 0;
    if (mach_vm_read_overwrite(mach_task_self(), start, size, reinterpret_cast<mach_vm_address_t>(copy.data()), &copied) != KERN_SUCCESS ||
        copied != size) {
      ++*unreadable;
      continue;
    }
    ++*regions;
    *scanned += static_cast<size_t>(size);
    visit(start, copy.data(), copy.size());
  }
}

int dumpStampWindows(const char *kind, const std::set<uint32_t> &stamps);

// Scan readable, non-shared, non-executable memory for graph text and dump each
// distinct hit with a bounded window after it (the arena of a decoded packed
// container follows its graph text). Regions are copied with
// mach_vm_read_overwrite, which fails cleanly where a direct read would fault.
void scanHeapForGraphs(const char *kind) {
  if (!captureDirectory()) return;
  static const char needle[] = "\nDataV2 ";
  std::set<std::string> seen;
  std::set<uint32_t> stamps;
  size_t scanned = 0;
  int hits = 0, regions = 0, unreadable = 0;
  forEachRegion([&](mach_vm_address_t start, const unsigned char *base, size_t size) {
    const unsigned char *end = base + size;
    for (const unsigned char *hit = base; hit < end;) {
      hit = static_cast<const unsigned char *>(memmem(hit, static_cast<size_t>(end - hit), needle, sizeof needle - 1));
      if (!hit) break;
      const unsigned char *textStart = hit;
      while (textStart > base && hit - textStart < 65536 && graphTextByte(textStart[-1])) --textStart;
      const unsigned char *textEnd = hit;
      while (textEnd < end && textEnd - textStart < 1024 * 1024 && graphTextByte(*textEnd)) ++textEnd;
      std::string text(reinterpret_cast<const char *>(textStart), static_cast<size_t>(textEnd - textStart));
      hit = textEnd;
      if (text.size() < 64 || !seen.insert(text).second) continue;
      uint32_t stamp = 0;
      if (headerStamp(text, &stamp)) stamps.insert(stamp);
      const int index = sequence++;
      char name[64];
      std::snprintf(name, sizeof name, "%s-heap-graph", kind);
      writeBytes(capturePath(index, name, "txt"), text.data(), text.size());
      const size_t window = static_cast<size_t>(end - textEnd) < kHeapWindow ? static_cast<size_t>(end - textEnd) : kHeapWindow;
      std::snprintf(name, sizeof name, "%s-heap-window", kind);
      writeBytes(capturePath(index, name, "bin"), textEnd, window);
      std::snprintf(name, sizeof name, "%s-heap", kind);
      writeMeta(index, name,
                "text_address=" + std::to_string(start + static_cast<mach_vm_address_t>(textStart - base)) +
                    " region_start=" + std::to_string(start) + " region_bytes=" + std::to_string(size) +
                    " window_bytes=" + std::to_string(window) + " stamp=" + std::to_string(stamp),
                text.size());
      ++hits;
    }
  }, &scanned, &regions, &unreadable);
  const int stampHits = dumpStampWindows(kind, stamps);
  writeMeta(sequence++, "heap-scan",
            std::string(kind) + " regions=" + std::to_string(regions) + " unreadable=" + std::to_string(unreadable) +
                " scanned_bytes=" + std::to_string(scanned) + " hits=" + std::to_string(hits) + " stamps=" + std::to_string(stamps.size()) +
                " stamp_hits=" + std::to_string(stampHits),
            0);
}

// The bytes before every occurrence of each stamp (a decoded arena ends with
// its graph's stamp); at most 64 windows per call.
int dumpStampWindows(const char *kind, const std::set<uint32_t> &stamps) {
  int stampHits = 0;
  size_t scannedAgain = 0;
  int regionsAgain = 0, unreadableAgain = 0;
  forEachRegion([&](mach_vm_address_t start, const unsigned char *base, size_t size) {
    for (uint32_t stamp : stamps) {
      unsigned char bytes[4];
      std::memcpy(bytes, &stamp, 4);
      const unsigned char *end = base + size;
      for (const unsigned char *hit = base; hit + 4 <= end && stampHits < 64;) {
        hit = static_cast<const unsigned char *>(memmem(hit, static_cast<size_t>(end - hit), bytes, 4));
        if (!hit) break;
        const size_t window = static_cast<size_t>(hit + 4 - base) < kStampWindow ? static_cast<size_t>(hit + 4 - base) : kStampWindow;
        const int index = sequence++;
        char name[64];
        std::snprintf(name, sizeof name, "%s-heap-stamp", kind);
        writeBytes(capturePath(index, name, "bin"), hit + 4 - window, window);
        writeMeta(index, name,
                  "stamp=" + std::to_string(stamp) + " stamp_end_address=" + std::to_string(start + static_cast<mach_vm_address_t>(hit + 4 - base)) +
                      " region_start=" + std::to_string(start) + " window_bytes=" + std::to_string(window),
                  window);
        ++stampHits;
        hit += 4;
      }
    }
  }, &scannedAgain, &regionsAgain, &unreadableAgain);
  return stampHits;
}

// Dump a config block handed to Engine::Init and every BM container reachable
// from a pointer-sized word inside it. The word layout is recorded so the
// offsets of the model pointer and length can be confirmed offline.
void captureConfig(const char *kind, const void *config) {
  if (!captureDirectory() || !config) return;
  std::lock_guard<std::mutex> lock(captureMutex);
  const int index = sequence++;
  const size_t requested = mappedExtent(config, kConfigDumpLimit);
  const std::vector<unsigned char> block = copyMemory(config, requested);
  const unsigned char *bytes = block.data();
  const size_t extent = block.size();
  const size_t written = writeBytes(capturePath(index, kind, "bin"), config, extent);
  std::ofstream words(capturePath(index, kind, "words.txt"));
  int models = 0;
  for (size_t offset = 0; offset + 8 <= extent; offset += 8) {
    uintptr_t word = 0;
    std::memcpy(&word, bytes + offset, sizeof word);
    words << offset << "\t0x" << std::hex << word << std::dec;
    const auto *target = reinterpret_cast<const unsigned char *>(word);
    const size_t targetExtent = word >= 0x100000000ull ? mappedExtent(target, kModelDumpLimit) : 0;
    const std::vector<unsigned char> head = targetExtent ? copyMemory(target, targetExtent < 16 ? targetExtent : 16) : std::vector<unsigned char>{};
    if (!head.empty()) {
      words << "\tmapped=" << targetExtent << "\thead=" << hex(head.data(), head.size());
      const size_t length = bmContainerLength(head.data(), head.size() < 12 ? head.size() : targetExtent);
      if (length) {
        char name[64];
        std::snprintf(name, sizeof name, "%s-model-%d", kind, models++);
        const size_t modelWritten = writeBytes(capturePath(index, name, "bin"), target, length);
        words << "\tbm=" << length << (modelWritten == length ? "" : "\tpartial=" + std::to_string(modelWritten));
      }
    }
    words << "\n";
  }
  writeMeta(index, kind, "models=" + std::to_string(models) + dumpDetail(requested, written), written);
}

}  // namespace

// Original entry points of the pinned runtime, named by their mangled symbols.
extern "C" {
long originalCreateNetBytes(void *self, const unsigned char *data, unsigned long size)
    asm("__ZN5IESNN3Net9CreateNetEPKhm");
long originalCreateNetNamed(void *self, const std::string &name, const unsigned char *data, unsigned long size)
    asm("__ZN5IESNN3Net9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPKhm");
long originalCreateNetConfig(void *self, const std::string &name, const unsigned char *data, unsigned long size,
                             const void *config)
    asm("__ZN5IESNN3Net9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPKhmRK8NNConfig");
long originalCreateNetFromFile(void *self, const char *path) asm("__ZN5IESNN3Net17CreateNetFromFileEPKc");
int originalThrustorCreateNet(void *self, const std::string &graph, void *arena, std::vector<std::string> &names)
    asm("__ZN10bytenn_cpu8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
// Legacy espresso API used directly by the SMASH face algorithms in libcccreator / liblens.
int originalEspressoCreateNet(void *self, const std::string &graph, void *arena, std::vector<std::string> &names)
    asm("__ZN8espresso8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
int originalEspressoReInferShape(void *self, int width, int height) asm("__ZN8espresso8Thrustor12ReInferShapeEii");
// Inference-time entry points, used to record the tensors the product actually feeds and reads.
int originalEspressoSetInput(void *self, std::string name, void *data, int first, int second, int third)
    asm("__ZN8espresso8Thrustor8SetInputENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPviii");
int originalEspressoInference(void *self) asm("__ZN8espresso8Thrustor9InferenceEv");
struct TensorView {
  void *data;
  int32_t dims[4];  // n, w, h, c
  int32_t raw[2];   // storage type, fraction bits
};
static_assert(sizeof(TensorView) == 32, "espresso::TensorView layout");
TensorView originalEspressoExtract(void *self, const std::string &name)
    asm("__ZN8espresso8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
}
std::shared_ptr<BYTENN::ByteNNEngine> originalEngineCreate() asm("__ZN6BYTENN13EngineFactory6CreateEv");

long capturedCreateNetBytes(void *self, const unsigned char *data, unsigned long size) {
  captureBuffer("iesnn-bytes", "", data, size);
  return originalCreateNetBytes(self, data, size);
}

long capturedCreateNetNamed(void *self, const std::string &name, const unsigned char *data, unsigned long size) {
  captureBuffer("iesnn-named", name, data, size);
  return originalCreateNetNamed(self, name, data, size);
}

long capturedCreateNetConfig(void *self, const std::string &name, const unsigned char *data, unsigned long size,
                             const void *config) {
  captureBuffer("iesnn-config", name, data, size);
  return originalCreateNetConfig(self, name, data, size, config);
}

long capturedCreateNetFromFile(void *self, const char *path) {
  if (captureDirectory() && path) {
    std::lock_guard<std::mutex> lock(captureMutex);
    writeMeta(sequence++, "iesnn-file", path, 0);
  }
  return originalCreateNetFromFile(self, path);
}

// The arena length is not passed; dump the readable extent (bounded) and trim
// offline with the graph's parameter count and trailing stamp. The arena
// usually lives inside the unpacked model buffer, so that whole mapped region
// is dumped once per region for offline reading of the pack layout.
void captureThrustorNet(const char *kind, void *self, const std::string &graph, const void *arena,
                        const std::vector<std::string> &names) {
  if (!captureDirectory()) return;
  std::lock_guard<std::mutex> lock(captureMutex);
  const int index = sequence++;
  const size_t graphWritten = writeBytes(capturePath(index, kind, "graph.txt"), graph.data(), graph.size());
  const size_t extent = mappedExtent(arena, kModelDumpLimit);
  const size_t arenaWritten = extent ? writeBytes(capturePath(index, kind, "arena.bin"), arena, extent) : 0;
  std::string detail = "self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " outputs=";
  for (const std::string &name : names) detail += name + ";";
  if (graphWritten != graph.size()) detail += " graph" + dumpDetail(graph.size(), graphWritten);
  detail += dumpDetail(extent, arenaWritten);
  mach_vm_address_t start = 0;
  mach_vm_size_t size = 0;
  vm_region_basic_info_data_64_t info;
  const mach_vm_address_t address = reinterpret_cast<mach_vm_address_t>(arena);
  if (regionAt(address, &start, &size, &info) && start <= address) {
    static std::set<mach_vm_address_t> dumpedRegions;
    detail += " region_start=" + std::to_string(start) + " region_bytes=" + std::to_string(size) +
              " arena_offset=" + std::to_string(address - start);
    if (dumpedRegions.insert(start).second) {
      const size_t regionExtent = mappedExtent(reinterpret_cast<const void *>(start), kModelDumpLimit);
      const size_t regionWritten = writeBytes(capturePath(index, kind, "region.bin"), reinterpret_cast<const void *>(start), regionExtent);
      if (regionWritten != regionExtent) detail += " region" + dumpDetail(regionExtent, regionWritten);
    }
  }
  writeMeta(index, kind, detail, arenaWritten);
}

int capturedThrustorCreateNet(void *self, const std::string &graph, void *arena, std::vector<std::string> &names) {
  captureThrustorNet("thrustor", self, graph, arena, names);
  return originalThrustorCreateNet(self, graph, arena, names);
}

// --- Inference-time tensors ---------------------------------------------------
//
// QCUT_BYTENN_CAPTURE_IO=1 records, per network object, the input blobs as they
// stand when Inference starts and every blob the caller extracts afterwards.
// The inputs are read back through the engine's own Extract, so they are the
// bytes the network consumes, not the caller's staging buffer.
// QCUT_BYTENN_CAPTURE_TERMINALS=1 also reads the five declared Stage1 heads
// after successful Inference, including heads a rejecting caller never reads.

struct NetState {
  std::vector<std::string> inputs;  // declared by the graph, plus whatever SetInput named
  std::vector<std::string> terminalOutputs;
  int inferences = 0;                // completed Inference calls
};
std::map<void *, NetState> netStates;

bool captureIO() {
  static const char *flag = std::getenv("QCUT_BYTENN_CAPTURE_IO");
  return captureDirectory() && flag && *flag == '1';
}

bool captureTerminals() {
  static const char *flag = std::getenv("QCUT_BYTENN_CAPTURE_TERMINALS");
  return captureIO() && flag && std::strcmp(flag, "1") == 0;
}

std::vector<std::string> stage1TerminalNames(const std::vector<std::string> &names) {
  static const std::set<std::string> heads = {"fc_landmark_s1", "prob", "fc_pitch", "fc_yaw", "fc_visible"};
  if (names.size() != heads.size()) return {};
  std::set<std::string> seen;
  for (const std::string &name : names) {
    if (name.size() > 14 || !heads.count(name) || !seen.insert(name).second) return {};
  }
  return names;
}

// A graph row `DataV2 <name> ...` or legacy `<name> n h w c ...` declares an input.
std::vector<std::string> graphInputNames(const std::string &graph) {
  std::vector<std::string> names;
  size_t position = 0;
  bool first = true;
  while (position < graph.size()) {
    size_t end = graph.find('\n', position);
    if (end == std::string::npos) end = graph.size();
    const std::string line = graph.substr(position, end - position);
    position = end + 1;
    if (line.empty()) continue;
    if (first) {  // optional storage marker line, then the header row
      first = false;
      if (line.find(' ') == std::string::npos) continue;
      if (line.find_first_not_of("0123456789 ") == std::string::npos) continue;
    }
    if (line.find_first_not_of("0123456789 ") == std::string::npos) continue;  // header row
    std::istringstream row(line);
    std::string op, name;
    row >> op >> name;
    if (op == "DataV2" || op == "data") {
      names.push_back(op == "DataV2" ? name : op);
    } else {
      break;  // inputs come first
    }
  }
  return names;
}

size_t elementBytes(int type) { return type == 1 ? 1 : type == 2 ? 2 : type == 3 ? 2 : 4; }

void remember(void *self, const std::string &name) {
  NetState &state = netStates[self];
  if (std::find(state.inputs.begin(), state.inputs.end(), name) == state.inputs.end()) state.inputs.push_back(name);
}

void recordTensor(const char *kind, void *self, const std::string &name, const TensorView &view, int inference) {
  size_t count = 1;
  for (int d : view.dims) count *= d > 0 ? static_cast<size_t>(d) : 0;
  const size_t size = count * elementBytes(view.raw[0]);
  std::string detail = "self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " name=" + name +
                       " inference=" + std::to_string(inference) + " dims=" + std::to_string(view.dims[0]) + "," +
                       std::to_string(view.dims[1]) + "," + std::to_string(view.dims[2]) + "," + std::to_string(view.dims[3]) +
                       " raw=" + std::to_string(view.raw[0]) + "," + std::to_string(view.raw[1]);
  const int index = sequence++;
  size_t written = 0;
  if (view.data && size && size <= kModelDumpLimit) written = writeBytes(capturePath(index, kind, "bin"), view.data, size);
  else detail += " skipped";
  writeMeta(index, kind, detail + dumpDetail(size, written), written);
}

int capturedEspressoSetInput(void *self, std::string name, void *data, int first, int second, int third) {
  if (captureIO()) {
    std::lock_guard<std::mutex> lock(captureMutex);
    remember(self, name);
    writeMeta(sequence++, "espresso-setinput",
              "self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " name=" + name + " data=" +
                  std::to_string(reinterpret_cast<uintptr_t>(data)) + " args=" + std::to_string(first) + "," +
                  std::to_string(second) + "," + std::to_string(third),
              0);
  }
  return originalEspressoSetInput(self, std::move(name), data, first, second, third);
}

int capturedEspressoInference(void *self) {
  int inference = 0;
  std::vector<std::string> terminals;
  if (captureIO()) {
    std::vector<std::string> names;
    {
      std::lock_guard<std::mutex> lock(captureMutex);
      NetState &state = netStates[self];
      names = state.inputs;
      if (captureTerminals()) terminals = state.terminalOutputs;
      inference = state.inferences;
    }
    for (const std::string &name : names) {
      const TensorView view = originalEspressoExtract(self, name);
      std::lock_guard<std::mutex> lock(captureMutex);
      recordTensor("espresso-input", self, name, view, inference);
    }
  }
  const int result = originalEspressoInference(self);
  if (captureIO()) {
    std::lock_guard<std::mutex> lock(captureMutex);
    netStates[self].inferences = inference + 1;
    writeMeta(sequence++, "espresso-inference",
              "self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " inference=" + std::to_string(inference) +
                  " rc=" + std::to_string(result),
              0);
  }
  if (result == 0) {
    for (const std::string &name : terminals) {
      const TensorView view = originalEspressoExtract(self, name);
      std::lock_guard<std::mutex> lock(captureMutex);
      recordTensor("espresso-output", self, name, view, inference);
    }
  }
  return result;
}

TensorView capturedEspressoExtract(void *self, const std::string &name) {
  const TensorView view = originalEspressoExtract(self, name);
  if (captureIO()) {
    std::lock_guard<std::mutex> lock(captureMutex);
    recordTensor("espresso-output", self, name, view, netStates[self].inferences - 1);
  }
  return view;
}

int capturedEspressoCreateNet(void *self, const std::string &graph, void *arena, std::vector<std::string> &names) {
  captureThrustorNet("espresso", self, graph, arena, names);
  if (captureIO()) {
    std::lock_guard<std::mutex> lock(captureMutex);
    NetState &state = netStates[self];
    state.inputs = graphInputNames(graph);
    state.terminalOutputs = stage1TerminalNames(names);
    state.inferences = 0;
  }
  const int result = originalEspressoCreateNet(self, graph, arena, names);
  // A compressed arena (graph headers such as `USTQ`) is expanded during CreateNet, so the plain
  // weights only exist afterwards; QCUT_BYTENN_SCAN_AFTER_CREATE asks for a heap sweep that picks
  // the expanded buffer up through its trailing graph stamp.
  const char *sweep = std::getenv("QCUT_BYTENN_SCAN_AFTER_CREATE");
  if (sweep && *sweep == '1') scanHeapForGraphs("espresso-post");
  return result;
}

int capturedEspressoReInferShape(void *self, int width, int height) {
  if (captureDirectory()) {
    std::lock_guard<std::mutex> lock(captureMutex);
    // espresso::Thrustor::ReInferShape takes (width, height).
    writeMeta(sequence++, "espresso-reinfer",
              "self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " width=" + std::to_string(width) +
                  " height=" + std::to_string(height),
              0);
  }
  return originalEspressoReInferShape(self, width, height);
}

// --- Engine::Init recorders installed through a per-object vtable copy -------

namespace {

using InitFunction = long (*)(void *self, const void *config);
InitFunction originalInitConfig = nullptr;
InitFunction originalInitConfigExt = nullptr;
std::map<void **, void **> patchedVtables;

// QCUT_BYTENN_SKIP_INIT_SCAN=1 keeps the config dumps but skips the heap sweep
// after Init (about a gigabyte per body-package run), for I/O-only captures.
bool skipInitScan() {
  static const char *flag = std::getenv("QCUT_BYTENN_SKIP_INIT_SCAN");
  return flag && *flag == '1';
}

long recordedInitConfig(void *self, const void *config) {
  captureConfig("engine-config", config);
  const long result = originalInitConfig(self, config);
  if (!skipInitScan()) scanHeapForGraphs("engine-config");
  return result;
}

long recordedInitConfigExt(void *self, const void *config) {
  captureConfig("engine-configext", config);
  const long result = originalInitConfigExt(self, config);
  if (!skipInitScan()) scanHeapForGraphs("engine-configext");
  return result;
}

const char *symbolName(const void *address) {
  Dl_info info;
  return dladdr(address, &info) && info.dli_sname ? info.dli_sname : "";
}

// --- Engine inference recorders (QCUT_BYTENN_CAPTURE_ENGINE_IO=1) -----------
//
// Networks such as the body keypoint model run through ByteNNEngine rather than
// espresso::Thrustor, so the espresso I/O recorders never see them. These slots
// of the same vtable copy record what crosses the engine boundary. The tensor
// layout is not public, so each record keeps the raw vector elements and, for
// every aligned word in them that points into mapped memory, the bytes there
// (bounded); the layout is then read offline from those dumps.

using EngineVectorCall = long (*)(void *self, void *tensors);
using EngineVoidCall = long (*)(void *self);
using EngineNamedCall = long (*)(void *self, const void *name);
EngineVectorCall originalSetInput = nullptr;
EngineVectorCall originalSetInputExt = nullptr;
EngineVectorCall originalGetInputConfig = nullptr;
EngineVectorCall originalGetInputConfigExt = nullptr;
EngineVectorCall originalGetOutput = nullptr;
EngineVectorCall originalGetOutputExt = nullptr;
EngineVoidCall originalInference = nullptr;
EngineVoidCall originalInferenceTextureIO = nullptr;
EngineNamedCall originalInferenceNamed = nullptr;

constexpr size_t kEngineElementLimit = 4096;
constexpr size_t kEnginePointeeLimit = 2u * 1024u * 1024u;
constexpr int kEngineInferenceLimit = 6;  // per engine object

struct EngineState {
  int inferences = 0;
  std::vector<unsigned char> inputElements;  // last SetInput / GetInputConfig vector, copied
  bool inputExt = false;
};
std::map<void *, EngineState> engineStates;

bool captureEngineIO() {
  static const char *flag = std::getenv("QCUT_BYTENN_CAPTURE_ENGINE_IO");
  return captureDirectory() && flag && *flag == '1';
}

std::vector<unsigned char> vectorElements(const void *tensors) {
  struct Raw { const unsigned char *begin, *end, *capacity; };
  const std::vector<unsigned char> header = copyMemory(tensors, sizeof(Raw));
  if (header.size() != sizeof(Raw)) return {};
  Raw raw;
  std::memcpy(&raw, header.data(), sizeof raw);
  if (!raw.begin || raw.end < raw.begin) return {};
  return copyMemory(raw.begin, std::min(static_cast<size_t>(raw.end - raw.begin), kEngineElementLimit));
}

bool plausiblePointer(uintptr_t value) { return value >= 0x100000000ull && value < 0x0000800000000000ull; }

// Dumps the bytes behind every pointer-like word of `bytes`; `depth` follows
// one more level (shared_ptr<TensorExt> elements point at objects).
void dumpPointees(int index, const std::string &kind, const std::vector<unsigned char> &bytes, int depth,
                  std::ostringstream &listing) {
  for (size_t offset = 0; offset + 8 <= bytes.size(); offset += 8) {
    uintptr_t value;
    std::memcpy(&value, bytes.data() + offset, 8);
    if (!plausiblePointer(value)) continue;
    const void *address = reinterpret_cast<const void *>(value);
    const size_t extent = mappedExtent(address, depth > 0 ? 512 : kEnginePointeeLimit);
    if (!extent) continue;
    const std::string name = kind + "-at" + std::to_string(offset);
    const size_t written = writeBytes(capturePath(index, name.c_str(), "bin"), address, extent);
    listing << name << "\t" << value << "\t" << extent << "\t" << written << "\t" << symbolName(address) << "\n";
    if (depth > 0) dumpPointees(index, name, copyMemory(address, extent), depth - 1, listing);
  }
}

void recordEngineTensors(const char *kind, void *self, const std::vector<unsigned char> &elements, bool ext,
                         const std::string &extra) {
  std::lock_guard<std::mutex> lock(captureMutex);
  EngineState &state = engineStates[self];
  if (state.inferences >= kEngineInferenceLimit) return;
  const int index = sequence++;
  const size_t written = writeBytes(capturePath(index, kind, "bin"), elements.data(), elements.size());
  std::ostringstream listing;
  dumpPointees(index, kind, elements, ext ? 1 : 0, listing);
  std::ofstream(capturePath(index, kind, "pointees.txt")) << listing.str();
  writeMeta(index, kind,
            "self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " inference=" +
                std::to_string(state.inferences) + " ext=" + (ext ? "1" : "0") + extra,
            written);
}

long recordedSetInput(void *self, void *tensors) {
  if (captureEngineIO()) {
    const std::vector<unsigned char> elements = vectorElements(tensors);
    recordEngineTensors("engine-setinput", self, elements, false, "");
    std::lock_guard<std::mutex> lock(captureMutex);
    engineStates[self].inputElements = elements;
    engineStates[self].inputExt = false;
  }
  return originalSetInput(self, tensors);
}

long recordedSetInputExt(void *self, void *tensors) {
  if (captureEngineIO()) {
    const std::vector<unsigned char> elements = vectorElements(tensors);
    recordEngineTensors("engine-setinput-ext", self, elements, true, "");
    std::lock_guard<std::mutex> lock(captureMutex);
    engineStates[self].inputElements = elements;
    engineStates[self].inputExt = true;
  }
  return originalSetInputExt(self, tensors);
}

long recordedGetInputConfig(void *self, void *tensors) {
  const long result = originalGetInputConfig(self, tensors);
  if (captureEngineIO()) {
    const std::vector<unsigned char> elements = vectorElements(tensors);
    recordEngineTensors("engine-inputconfig", self, elements, false, " rc=" + std::to_string(result));
    std::lock_guard<std::mutex> lock(captureMutex);
    engineStates[self].inputElements = elements;
    engineStates[self].inputExt = false;
  }
  return result;
}

long recordedGetInputConfigExt(void *self, void *tensors) {
  const long result = originalGetInputConfigExt(self, tensors);
  if (captureEngineIO()) {
    const std::vector<unsigned char> elements = vectorElements(tensors);
    recordEngineTensors("engine-inputconfig-ext", self, elements, true, " rc=" + std::to_string(result));
    std::lock_guard<std::mutex> lock(captureMutex);
    engineStates[self].inputElements = elements;
    engineStates[self].inputExt = true;
  }
  return result;
}

// The caller may write pixels straight into buffers it got earlier, so the
// remembered input elements are dumped again as Inference starts.
void recordInferenceStart(void *self, const char *variant) {
  std::vector<unsigned char> elements;
  bool ext = false;
  {
    std::lock_guard<std::mutex> lock(captureMutex);
    elements = engineStates[self].inputElements;
    ext = engineStates[self].inputExt;
  }
  recordEngineTensors("engine-inference-input", self, elements, ext, std::string(" variant=") + variant);
}

// QCUT_BYTENN_STAMPS_AFTER_INFERENCE=<stamp>,<stamp>... dumps, once per engine
// after its first Inference, the bytes before every occurrence of those graph
// stamps: the weights the engine has just run with are certainly live then.
std::set<uint32_t> stampsAfterInference() {
  std::set<uint32_t> stamps;
  const char *list = std::getenv("QCUT_BYTENN_STAMPS_AFTER_INFERENCE");
  for (const char *cursor = list; cursor && *cursor;) {
    char *next = nullptr;
    const unsigned long long value = std::strtoull(cursor, &next, 10);
    if (next == cursor) break;
    if (value <= 0xFFFFFFFFull) stamps.insert(static_cast<uint32_t>(value));
    cursor = *next == ',' ? next + 1 : next;
  }
  return stamps;
}

void recordInferenceEnd(void *self, const char *variant, long result) {
  int completed = 0;
  {
    std::lock_guard<std::mutex> lock(captureMutex);
    EngineState &state = engineStates[self];
    writeMeta(sequence++, "engine-inference",
              "self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " inference=" +
                  std::to_string(state.inferences) + " variant=" + variant + " rc=" + std::to_string(result),
              0);
    completed = ++state.inferences;
  }
  static const std::set<uint32_t> stamps = stampsAfterInference();
  if (completed == 1 && !stamps.empty()) dumpStampWindows("engine-inference", stamps);
}

long recordedInference(void *self) {
  if (captureEngineIO()) recordInferenceStart(self, "plain");
  const long result = originalInference(self);
  if (captureEngineIO()) recordInferenceEnd(self, "plain", result);
  return result;
}

long recordedInferenceTextureIO(void *self) {
  if (captureEngineIO()) recordInferenceStart(self, "texture-io-async");
  const long result = originalInferenceTextureIO(self);
  if (captureEngineIO()) recordInferenceEnd(self, "texture-io-async", result);
  return result;
}

long recordedInferenceNamed(void *self, const void *name) {
  if (captureEngineIO()) recordInferenceStart(self, "named");
  const long result = originalInferenceNamed(self, name);
  if (captureEngineIO()) recordInferenceEnd(self, "named", result);
  return result;
}

long recordedGetOutput(void *self, void *tensors) {
  const long result = originalGetOutput(self, tensors);
  if (captureEngineIO())
    recordEngineTensors("engine-getoutput", self, vectorElements(tensors), false, " rc=" + std::to_string(result));
  return result;
}

long recordedGetOutputExt(void *self, void *tensors) {
  const long result = originalGetOutputExt(self, tensors);
  if (captureEngineIO())
    recordEngineTensors("engine-getoutput-ext", self, vectorElements(tensors), true, " rc=" + std::to_string(result));
  return result;
}

struct EngineSlot {
  const char *symbol;
  void **original;
  void *recorder;
};

// Matched by symbol substring; the Tensor and TensorExt overloads differ in the vector element type.
const EngineSlot kEngineSlots[] = {
    {"ByteNNEngineImpl8SetInputERKNSt3__16vectorINS_6TensorE", reinterpret_cast<void **>(&originalSetInput),
     reinterpret_cast<void *>(&recordedSetInput)},
    {"ByteNNEngineImpl8SetInputERKNSt3__16vectorINS1_10shared_ptrINS_9TensorExtE",
     reinterpret_cast<void **>(&originalSetInputExt), reinterpret_cast<void *>(&recordedSetInputExt)},
    {"ByteNNEngineImpl14GetInputConfigERNSt3__16vectorINS_6TensorE",
     reinterpret_cast<void **>(&originalGetInputConfig), reinterpret_cast<void *>(&recordedGetInputConfig)},
    {"ByteNNEngineImpl14GetInputConfigERNSt3__16vectorINS1_10shared_ptrINS_9TensorExtE",
     reinterpret_cast<void **>(&originalGetInputConfigExt), reinterpret_cast<void *>(&recordedGetInputConfigExt)},
    {"ByteNNEngineImpl9InferenceEv", reinterpret_cast<void **>(&originalInference),
     reinterpret_cast<void *>(&recordedInference)},
    {"ByteNNEngineImpl23InferenceTextureIOAsyncEv", reinterpret_cast<void **>(&originalInferenceTextureIO),
     reinterpret_cast<void *>(&recordedInferenceTextureIO)},
    {"ByteNNEngineImpl9InferenceERKNSt3__112basic_string", reinterpret_cast<void **>(&originalInferenceNamed),
     reinterpret_cast<void *>(&recordedInferenceNamed)},
    {"ByteNNEngineImpl9GetOutputEPNSt3__16vectorINS_6TensorE", reinterpret_cast<void **>(&originalGetOutput),
     reinterpret_cast<void *>(&recordedGetOutput)},
    {"ByteNNEngineImpl9GetOutputEPNSt3__16vectorINS1_10shared_ptrINS_9TensorExtE",
     reinterpret_cast<void **>(&originalGetOutputExt), reinterpret_cast<void *>(&recordedGetOutputExt)},
};

// Copy the object's vtable (with the two words that precede it, so RTTI keeps
// working), redirect the Init slots, and point the object at the copy. Slots
// are found by symbol name so the layout is never hard-coded.
void installInitRecorders(void *engine) {
  if (!captureDirectory() || !engine) return;
  std::lock_guard<std::mutex> lock(captureMutex);
  void **vptr = *static_cast<void ***>(engine);
  auto patched = patchedVtables.find(vptr);
  if (patched != patchedVtables.end()) {
    *static_cast<void ***>(engine) = patched->second;
    return;
  }
  if (mappedExtent(vptr - 2, 16) < 16) return;
  const size_t slots = mappedExtent(vptr, kVtableSlots * sizeof(void *)) / sizeof(void *);
  void **copy = new void *[slots + 2];
  std::memcpy(copy, vptr - 2, (slots + 2) * sizeof(void *));
  std::ofstream listing(capturePath(sequence++, "engine-vtable", "txt"));
  for (size_t slot = 0; slot < slots; ++slot) {
    const char *name = symbolName(vptr[slot]);
    listing << slot << "\t" << name << "\n";
    if (std::strstr(name, "ByteNNEngineImpl4InitERKNS_6ConfigE")) {
      originalInitConfig = reinterpret_cast<InitFunction>(vptr[slot]);
      copy[slot + 2] = reinterpret_cast<void *>(&recordedInitConfig);
    } else if (std::strstr(name, "ByteNNEngineImpl4InitERKNS_9ConfigExtE")) {
      originalInitConfigExt = reinterpret_cast<InitFunction>(vptr[slot]);
      copy[slot + 2] = reinterpret_cast<void *>(&recordedInitConfigExt);
    } else if (captureEngineIO()) {
      for (const EngineSlot &entry : kEngineSlots) {
        if (!std::strstr(name, entry.symbol)) continue;
        *entry.original = vptr[slot];
        copy[slot + 2] = entry.recorder;
        break;
      }
    }
  }
  patchedVtables[vptr] = copy + 2;
  *static_cast<void ***>(engine) = copy + 2;
}

}  // namespace

extern "C" int qcut_bytenn_capture_sequence() {
  return captureIO() ? sequence.load() : -1;
}

std::shared_ptr<BYTENN::ByteNNEngine> capturedEngineCreate() {
  std::shared_ptr<BYTENN::ByteNNEngine> engine = originalEngineCreate();
  installInitRecorders(engine.get());
  return engine;
}

#define QCUT_INTERPOSE(replacement, replacee)                                             \
  __attribute__((used)) static struct {                                                   \
    const void *replacement_;                                                             \
    const void *replacee_;                                                                \
  } interpose_##replacement __attribute__((section("__DATA,__interpose"))) = {            \
      reinterpret_cast<const void *>(&replacement), reinterpret_cast<const void *>(&replacee)};

QCUT_INTERPOSE(capturedCreateNetBytes, originalCreateNetBytes)
QCUT_INTERPOSE(capturedCreateNetNamed, originalCreateNetNamed)
QCUT_INTERPOSE(capturedCreateNetConfig, originalCreateNetConfig)
QCUT_INTERPOSE(capturedCreateNetFromFile, originalCreateNetFromFile)
QCUT_INTERPOSE(capturedThrustorCreateNet, originalThrustorCreateNet)
QCUT_INTERPOSE(capturedEspressoCreateNet, originalEspressoCreateNet)
QCUT_INTERPOSE(capturedEspressoReInferShape, originalEspressoReInferShape)
QCUT_INTERPOSE(capturedEspressoSetInput, originalEspressoSetInput)
QCUT_INTERPOSE(capturedEspressoInference, originalEspressoInference)
QCUT_INTERPOSE(capturedEspressoExtract, originalEspressoExtract)
QCUT_INTERPOSE(capturedEngineCreate, originalEngineCreate)
