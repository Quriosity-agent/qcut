// Version-pinned CPU oracle for espresso graphs. Tensors are exchanged in the
// runtime's own storage width: int8, int16 or float32 NHWC, each tagged with
// the (type, fraction bits) descriptor the runtime reports for the blob, so
// fixed-point networks can be compared bit for bit.
#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <unistd.h>
#include <array>
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

size_t widthOf(int32_t type) {
  if (type == 1) return 1;
  if (type == 2) return 2;
  if (type == 4) return 4;
  throw std::runtime_error("unsupported storage type " + std::to_string(type));
}

size_t elements(const int32_t *dims) {
  size_t count = 1;
  for (int i = 0; i < 4; ++i) {
    if (dims[i] < 1 || dims[i] > 16384 || count > MAX_BYTES / 4 / static_cast<size_t>(dims[i]))
      throw std::runtime_error("invalid tensor extent");
    count *= static_cast<size_t>(dims[i]);
  }
  return count;
}

int32_t integer(id value) {
  if (![value isKindOfClass:NSNumber.class] || CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID())
    throw std::runtime_error("integer required");
  double number = [value doubleValue];
  if (number != (double)(int32_t)number) throw std::runtime_error("integer required");
  return (int32_t)number;
}

NSString *nameOf(id value) {
  if (![value isKindOfClass:NSString.class] || [value length] == 0 || [value length] > 256) throw std::runtime_error("invalid blob name");
  return value;
}

fs::path localFile(const fs::path &directory, NSString *filename) {
  fs::path path([nameOf(filename) UTF8String]);
  if (path != path.filename() || path == "." || path == "..") throw std::runtime_error("invalid local filename");
  auto result = directory / path;
  if (fs::is_symlink(result)) throw std::runtime_error("symlink rejected");
  return result;
}

void writeExclusive(const fs::path &path, const char *data, size_t size) {
  int fd = ::open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (fd < 0) throw std::runtime_error("exclusive create failed: " + path.filename().string());
  size_t written = 0;
  while (written < size) {
    ssize_t count = ::write(fd, data + written, size - written);
    if (count <= 0) { ::close(fd); throw std::runtime_error("tensor write failed"); }
    written += static_cast<size_t>(count);
  }
  if (::close(fd)) throw std::runtime_error("tensor close failed");
}

NSDictionary *describe(NSString *name, const TensorView &view, NSString *file) {
  return @{@"name": name, @"file": file ?: @"", @"dims_nwhc": @[@(view.dims[0]), @(view.dims[1]), @(view.dims[2]), @(view.dims[3])],
           @"raw": @[@(view.raw[0]), @(view.raw[1])]};
}

int main(int argc, char **argv) {
  @autoreleasepool {
    try {
      if (argc != 5) throw std::runtime_error("usage: espresso-oracle LIBRARY GRAPH ARENA REQUEST.json");
      const auto libraryBytes = readFile(fs::canonical(argv[1]));
      if (sha256(libraryBytes) != RUNTIME_SHA) throw std::runtime_error("unsupported runtime SHA-256");
      const auto graphBytes = readFile(argv[2], 16 * 1024 * 1024);
      auto arena = readFile(argv[3]);
      const auto requestBytes = readFile(argv[4], 1024 * 1024);
      NSError *error = nil;
      id request = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:requestBytes.data() length:requestBytes.size()] options:0 error:&error];
      if (![request isKindOfClass:NSDictionary.class] || ![request[@"version"] isEqual:@2]) throw std::runtime_error("invalid request version");
      NSArray *inputs = request[@"inputs"], *outputs = request[@"outputs"];
      if (![inputs isKindOfClass:NSArray.class] || [inputs count] < 1 || [inputs count] > 16) throw std::runtime_error("one to sixteen inputs required");
      if (![outputs isKindOfClass:NSArray.class] || [outputs count] < 1 || [outputs count] > 512) throw std::runtime_error("one to 512 outputs required");
      fs::path directory = fs::canonical(fs::path(argv[4]).parent_path());
      void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
      if (!library) throw std::runtime_error(dlerror());
      void *engine = calloc(1, 65536);
      symbol<void (*)(void *)>(library, "_ZN8espresso8ThrustorC1Ev")(engine);
      symbol<void (*)(void *)>(library, "_ZN8espresso25ThrustorEnforceCPURuntimeEPNS_8ThrustorE")(engine);
      auto create = symbol<int (*)(void *, const std::string &, void *, std::vector<std::string> &)>(library,
        "_ZN8espresso8Thrustor9CreateNetERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPvRNS1_6vectorIS7_NS5_IS7_EEEE");
      auto setInput = symbol<int (*)(void *, std::string, void *, int, int, int)>(library,
        "_ZN8espresso8Thrustor8SetInputENSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEEPviii");
      auto extract = symbol<TensorView (*)(void *, const std::string &)>(library,
        "_ZN8espresso8Thrustor7ExtractERKNSt3__112basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE");
      auto inference = symbol<int (*)(void *)>(library, "_ZN8espresso8Thrustor9InferenceEv");
      auto reinfer = symbol<int (*)(void *, int, int)>(library, "_ZN8espresso8Thrustor12ReInferShapeEii");
      std::vector<std::string> names;
      for (id name in outputs) names.push_back([nameOf(name) UTF8String]);
      for (NSDictionary *input in inputs) names.push_back([nameOf(input[@"name"]) UTF8String]);
      if (create(engine, std::string(graphBytes.begin(), graphBytes.end()), arena.data(), names)) throw std::runtime_error("CreateNet failed");
      NSArray *shape = request[@"reinfer"];
      if ([shape isKindOfClass:NSArray.class] && [shape count] == 2) {
        if (reinfer(engine, integer(shape[0]), integer(shape[1]))) throw std::runtime_error("ReInferShape failed");
      }
      NSMutableArray *echoes = [NSMutableArray array], *results = [NSMutableArray array];
      std::vector<std::vector<char>> retained;
      for (NSDictionary *input in inputs) {
        NSString *name = nameOf(input[@"name"]);
        TensorView view = extract(engine, [name UTF8String]);
        if (!view.data) throw std::runtime_error("unknown input blob");
        NSArray *dims = input[@"dims_nwhc"], *raw = input[@"raw"];
        if (![dims isKindOfClass:NSArray.class] || [dims count] != 4 || ![raw isKindOfClass:NSArray.class] || [raw count] != 2)
          throw std::runtime_error("input descriptor required");
        for (int i = 0; i < 4; ++i) if (integer(dims[i]) != view.dims[i]) throw std::runtime_error("input extent differs from the runtime blob");
        if (integer(raw[0]) != view.raw[0] || integer(raw[1]) != view.raw[1]) throw std::runtime_error("input storage differs from the runtime blob");
        retained.push_back(readFile(localFile(directory, input[@"file"])));
        auto &bytes = retained.back();
        if (bytes.size() != elements(view.dims) * widthOf(view.raw[0])) throw std::runtime_error("input byte count mismatch");
        if (setInput(engine, [name UTF8String], bytes.data(), static_cast<int>(bytes.size()), 0, 0)) throw std::runtime_error("SetInput failed");
        TensorView echoed = extract(engine, [name UTF8String]);
        if (!echoed.data || memcmp(echoed.data, bytes.data(), bytes.size())) throw std::runtime_error("input echo mismatch");
        [echoes addObject:describe(name, echoed, nil)];
      }
      if (inference(engine)) throw std::runtime_error("Inference failed");
      for (id name in outputs) {
        TensorView view = extract(engine, [nameOf(name) UTF8String]);
        if (!view.data) throw std::runtime_error(std::string("unknown output blob ") + [name UTF8String]);
        const size_t size = elements(view.dims) * widthOf(view.raw[0]);
        auto file = [NSString stringWithFormat:@"output-%lu.raw", (unsigned long)[results count]];
        writeExclusive(directory / [file UTF8String], static_cast<const char *>(view.data), size);
        [results addObject:describe(name, view, file)];
      }
      NSDictionary *response = @{@"version": @2, @"forced_cpu": @YES, @"api": @"espresso",
        @"runtime_sha256": [NSString stringWithUTF8String:RUNTIME_SHA],
        @"graph_sha256": [NSString stringWithUTF8String:sha256(graphBytes).c_str()],
        @"arena_sha256": [NSString stringWithUTF8String:sha256(arena).c_str()], @"inputs": echoes, @"outputs": results};
      NSData *json = [NSJSONSerialization dataWithJSONObject:response options:NSJSONWritingPrettyPrinted error:&error];
      if (!json || ![json writeToFile:[NSString stringWithUTF8String:(directory / "response.json").c_str()] atomically:YES])
        throw std::runtime_error("response write failed");
      symbol<void (*)(void *)>(library, "_ZN8espresso8ThrustorD1Ev")(engine);
      return 0;
    } catch (const std::exception &error) { fprintf(stderr, "%s\n", error.what()); return 1; }
  }
}
