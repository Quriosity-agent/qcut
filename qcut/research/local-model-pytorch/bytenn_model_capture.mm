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

// Scan readable, non-shared, non-executable memory for graph text and dump each
// distinct hit with a bounded window after it (the arena of a decoded packed
// container follows its graph text). Regions are copied with
// mach_vm_read_overwrite, which fails cleanly where a direct read would fault.
void scanHeapForGraphs(const char *kind) {
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
  // Second pass: the bytes before every occurrence of a found stamp.
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
  writeMeta(sequence++, "heap-scan",
            std::string(kind) + " regions=" + std::to_string(regions) + " unreadable=" + std::to_string(unreadable) +
                " scanned_bytes=" + std::to_string(scanned) + " hits=" + std::to_string(hits) + " stamps=" + std::to_string(stamps.size()) +
                " stamp_hits=" + std::to_string(stampHits),
            0);
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

struct NetState {
  std::vector<std::string> inputs;  // declared by the graph, plus whatever SetInput named
  int inferences = 0;                // completed Inference calls
};
std::map<void *, NetState> netStates;

bool captureIO() {
  static const char *flag = std::getenv("QCUT_BYTENN_CAPTURE_IO");
  return captureDirectory() && flag && *flag == '1';
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
  if (captureIO()) {
    std::vector<std::string> names;
    {
      std::lock_guard<std::mutex> lock(captureMutex);
      NetState &state = netStates[self];
      names = state.inputs;
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

long recordedInitConfig(void *self, const void *config) {
  captureConfig("engine-config", config);
  const long result = originalInitConfig(self, config);
  scanHeapForGraphs("engine-config");
  return result;
}

long recordedInitConfigExt(void *self, const void *config) {
  captureConfig("engine-configext", config);
  const long result = originalInitConfigExt(self, config);
  scanHeapForGraphs("engine-configext");
  return result;
}

const char *symbolName(const void *address) {
  Dl_info info;
  return dladdr(address, &info) && info.dli_sname ? info.dli_sname : "";
}

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
    }
  }
  patchedVtables[vptr] = copy + 2;
  *static_cast<void ***>(engine) = copy + 2;
}

}  // namespace

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
