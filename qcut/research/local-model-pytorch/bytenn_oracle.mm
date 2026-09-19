// Version-pinned CPU graph oracle. All exchanged tensors are private float32 NHWC.
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <unistd.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs = std::filesystem;
constexpr size_t MAX_BYTES = 256 * 1024 * 1024;
constexpr const char *RUNTIME_SHA = "1bf9be7855a9bb6202a5595e2a1c5bdbb9750efd74749b8bdf589d1023c53ad0";
struct TensorView { void *data; int32_t dims[4]; int32_t raw[2]; };
static_assert(sizeof(TensorView) == 32);

template <typename T> T symbol(void *library, const char *name) {
  void *value = dlsym(library, name);
  if (!value) throw std::runtime_error(std::string("missing symbol: ") + name);
  return reinterpret_cast<T>(value);
}

std::vector<char> readFile(const fs::path &path, size_t limit = MAX_BYTES) {
  if (fs::is_symlink(path)) throw std::runtime_error("symlink input rejected");
  const auto size = fs::file_size(path);
  if (size == 0 || size > limit) throw std::runtime_error("invalid file length");
  std::vector<char> bytes(size);
  std::ifstream input(path, std::ios::binary);
  if (!input.read(bytes.data(), size)) throw std::runtime_error("file read failed");
  return bytes;
}

std::string sha256(const std::vector<char> &bytes) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(bytes.data(), static_cast<CC_LONG>(bytes.size()), digest);
  char result[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  for (size_t i = 0; i < CC_SHA256_DIGEST_LENGTH; ++i) snprintf(result + i * 2, 3, "%02x", digest[i]);
  return result;
}

size_t elements(const std::array<int32_t, 4> &shape) {
  size_t count = 1;
  for (int32_t dim : shape) {
    if (dim < 1 || dim > 16384 || count > MAX_BYTES / sizeof(float) / dim)
      throw std::runtime_error("invalid tensor shape or byte limit");
    count *= dim;
  }
  return count;
}

std::array<int32_t, 4> parseShape(id value) {
  if (![value isKindOfClass:NSArray.class] || [value count] != 4) throw std::runtime_error("four dimensions required");
  std::array<int32_t, 4> shape;
  for (size_t i = 0; i < 4; ++i) {
    id number = value[i];
    if (![number isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)number) == CFBooleanGetTypeID())
      throw std::runtime_error("integer dimensions required");
    double dimension = [number doubleValue];
    if (!std::isfinite(dimension) || dimension != std::floor(dimension) || dimension < 1 || dimension > 16384)
      throw std::runtime_error("invalid dimension");
    shape[i] = static_cast<int32_t>(dimension);
  }
  elements(shape);
  return shape;
}

void validateView(const TensorView &view, const std::array<int32_t, 4> &shape) {
  if (!view.data) throw std::runtime_error("null tensor view");
  if (!std::equal(shape.begin(), shape.end(), view.dims)) throw std::runtime_error("native tensor shape mismatch");
  elements(shape);
}

NSString *nameOf(NSDictionary *tensor) {
  id name = tensor[@"name"];
  if (![name isKindOfClass:NSString.class] || [name length] == 0 || [name length] > 256 || [name rangeOfString:@"\0"].location != NSNotFound)
    throw std::runtime_error("invalid tensor name");
  return name;
}

fs::path localFile(const fs::path &directory, NSString *filename) {
  if (![filename isKindOfClass:NSString.class]) throw std::runtime_error("filename required");
  fs::path path([filename UTF8String]);
  if (path.empty() || path != path.filename() || path == "." || path == "..") throw std::runtime_error("invalid local filename");
  auto result = directory / path;
  if (fs::is_symlink(result)) throw std::runtime_error("symlink output rejected");
  return result;
}

// Generated tensors are created exclusively: an existing file or symlink at
// the path is rejected instead of followed, so a caller that can write into
// the output directory cannot redirect a tensor write elsewhere.
void writeExclusive(const fs::path &path, const char *data, size_t size) {
  int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) throw std::runtime_error("exclusive tensor create failed: " + path.filename().string());
  size_t written = 0;
  while (written < size) {
    ssize_t count = ::write(fd, data + written, size - written);
    if (count <= 0) { ::close(fd); throw std::runtime_error("tensor write failed"); }
    written += static_cast<size_t>(count);
  }
  if (::close(fd)) throw std::runtime_error("tensor close failed");
}

NSDictionary *writeTensor(const fs::path &path, NSString *name, const TensorView &view, const std::array<int32_t, 4> &shape) {
  validateView(view, shape);
  size_t count = elements(shape);
  const float *values = static_cast<const float *>(view.data);
  for (size_t i = 0; i < count; ++i) if (!std::isfinite(values[i])) throw std::runtime_error("nonfinite native tensor");
  writeExclusive(path, static_cast<const char *>(view.data), count * sizeof(float));
  return @{@"name": name, @"file": [NSString stringWithUTF8String:path.filename().c_str()],
           @"shape_nwhc": @[@(shape[0]), @(shape[1]), @(shape[2]), @(shape[3])],
           @"raw_i32": @[@(view.raw[0]), @(view.raw[1])]};
}

void writeJson(const fs::path &path, NSDictionary *value) {
  NSError *error = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:&error];
  if (!json || ![json writeToFile:[NSString stringWithUTF8String:path.c_str()] atomically:YES])
    throw std::runtime_error("JSON write failed");
}

void selfTest() {
  float value = 1;
  TensorView view{&value, {1, 2, 3, 4}, {4, 0}};
  validateView(view, {1, 2, 3, 4});
  int rejected = 0;
  for (int index = 0; index < 4; ++index) {
    auto bad = view;
    bad.dims[index]++;
    try { validateView(bad, {1, 2, 3, 4}); } catch (const std::exception &) { ++rejected; }
  }
  try { elements({16384, 16384, 16384, 16384}); } catch (const std::exception &) { ++rejected; }
  try { validateView({nullptr, {1, 2, 3, 4}, {4, 0}}, {1, 2, 3, 4}); } catch (const std::exception &) { ++rejected; }
  if (rejected != 6) throw std::runtime_error("shape guard self-test failed");
  puts("native shape guards: 6 passed");
}

int main(int argc, char **argv) {
  @autoreleasepool {
    try {
      if (argc == 2 && std::string(argv[1]) == "--self-test") { selfTest(); return 0; }
      if (argc != 5) throw std::runtime_error("usage: oracle LIBRARY GRAPH ARENA REQUEST.json");
      const auto libraryBytes = readFile(fs::canonical(argv[1]));
      if (sha256(libraryBytes) != RUNTIME_SHA) throw std::runtime_error("unsupported runtime SHA-256");
      const auto graphBytes = readFile(argv[2], 16 * 1024 * 1024);
      auto arena = readFile(argv[3]);
      const auto requestBytes = readFile(argv[4], 1024 * 1024);
      NSData *json = [NSData dataWithBytes:requestBytes.data() length:requestBytes.size()];
      NSError *error = nil;
      id request = [NSJSONSerialization JSONObjectWithData:json options:0 error:&error];
      if (![request isKindOfClass:NSDictionary.class] || ![request[@"version"] isEqual:@1]) throw std::runtime_error("invalid request version");
      NSArray *inputs = request[@"inputs"], *outputs = request[@"outputs"];
      for (id list in @[inputs ?: @[], outputs ?: @[]])
        if (![list isKindOfClass:NSArray.class] || [list count] < 1 || [list count] > 64) throw std::runtime_error("nonempty bounded tensors required");
      fs::path directory = fs::canonical(fs::path(argv[4]).parent_path());
      void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
      if (!library) throw std::runtime_error(dlerror());
      alignas(16) unsigned char engine[256]{};
      symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorC1Ev")(engine);
      symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu25ThrustorEnforceCPURuntimeEPNS_8ThrustorE")(engine);
      auto create = symbol<int (*)(void *, const std::string &, void *, std::vector<std::string> &)>(library,
        "_ZN10bytenn_cpu8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
      std::vector<std::string> names;
      if (create(engine, std::string(graphBytes.begin(), graphBytes.end()), arena.data(), names)) throw std::runtime_error("CreateNet failed");
      const int forwardType = symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor14GetForwardTypeEv")(engine);
      if (forwardType != 0) throw std::runtime_error("CPU backend not selected");
      auto set = symbol<int (*)(void *, std::string, void *, int, int, int)>(library,
        "_ZN10bytenn_cpu8Thrustor8SetInputENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPviii");
      auto extract = symbol<TensorView (*)(void *, const std::string &)>(library,
        "_ZN10bytenn_cpu8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
      NSMutableArray *echoes = [NSMutableArray array], *results = [NSMutableArray array];
      NSMutableSet *seen = [NSMutableSet set];
      std::vector<std::vector<char>> retained;
      for (NSDictionary *input in inputs) {
        NSString *name = nameOf(input);
        if ([seen containsObject:name]) throw std::runtime_error("duplicate input");
        [seen addObject:name];
        auto shape = parseShape(input[@"shape_nwhc"]);
        retained.push_back(readFile(localFile(directory, input[@"file"])));
        auto &bytes = retained.back();
        if (bytes.size() != elements(shape) * sizeof(float)) throw std::runtime_error("input byte count mismatch");
        if (set(engine, [name UTF8String], bytes.data(), static_cast<int>(bytes.size()), 0, 0)) throw std::runtime_error("SetInput failed");
        auto echoed = extract(engine, [name UTF8String]);
        validateView(echoed, shape);
        if (memcmp(echoed.data, bytes.data(), bytes.size())) throw std::runtime_error("native input echo mismatch");
        auto file = directory / ("echo-" + std::to_string([echoes count]) + ".f32");
        [echoes addObject:writeTensor(file, name, echoed, shape)];
      }
      if (symbol<int (*)(void *)>(library, "_ZN10bytenn_cpu8Thrustor9InferenceEv")(engine)) throw std::runtime_error("Inference failed");
      [seen removeAllObjects];
      for (NSDictionary *output in outputs) {
        NSString *name = nameOf(output);
        if ([seen containsObject:name]) throw std::runtime_error("duplicate output");
        [seen addObject:name];
        auto view = extract(engine, [name UTF8String]);
        auto shape = parseShape(output[@"shape_nwhc"]);
        auto file = directory / ("output-" + std::to_string([results count]) + ".f32");
        [results addObject:writeTensor(file, name, view, shape)];
      }
      writeJson(directory / "response.json", @{@"version": @1, @"forced_cpu": @YES, @"forward_type": @(forwardType),
        @"runtime_sha256": [NSString stringWithUTF8String:RUNTIME_SHA],
        @"graph_sha256": [NSString stringWithUTF8String:sha256(graphBytes).c_str()],
        @"arena_sha256": [NSString stringWithUTF8String:sha256(arena).c_str()], @"inputs": echoes, @"outputs": results});
      symbol<void (*)(void *)>(library, "_ZN10bytenn_cpu8ThrustorD1Ev")(engine);
      return 0;
    } catch (const std::exception &error) { fprintf(stderr, "%s\n", error.what()); return 1; }
  }
}
