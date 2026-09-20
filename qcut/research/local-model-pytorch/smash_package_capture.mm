// Record how the effect SDK drives the vendor's own encrypted-package reader.
//
// `smash::package::ModelPackage` lives in liblens.dylib and the face/body
// algorithms in libcccreator.dylib call it across the library boundary, so dyld
// interposing sees every call. This library logs the constructor argument, the
// init route and its result, and writes out every payload the reader returns
// from Extract. Nothing is patched and no key is reconstructed: the runtime
// decrypts its own packages, and this only observes the result.
//
// Build (link against liblens so the replacee symbols bind at insert time):
//   clang++ -std=c++17 -O1 -fobjc-arc -framework Foundation -L<runtime>/Frameworks -llens \
//     -Wl,-rpath,<runtime>/Frameworks smash_package_capture.mm -o smash-package-capture.dylib
// Use:
//   QCUT_SMASH_CAPTURE_DIR=<dir> DYLD_INSERT_LIBRARIES=<dylib> <host> ...
#import <Foundation/Foundation.h>
#include <atomic>
#include <cstdio>
#include <fstream>
#include <map>
#include <mutex>
#include <string>

namespace {

std::mutex captureMutex;
std::atomic<int> sequence{0};

const char *captureDirectory() {
  static const char *directory = std::getenv("QCUT_SMASH_CAPTURE_DIR");
  return directory && *directory ? directory : nullptr;
}

void note(const std::string &line) {
  if (!captureDirectory()) return;
  std::lock_guard<std::mutex> lock(captureMutex);
  std::ofstream log(std::string(captureDirectory()) + "/calls.log", std::ios::app);
  log << line << "\n";
}

std::string sanitize(const std::string &name) {
  std::string safe;
  for (char c : name) safe += (isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '-' || c == '_') ? c : '_';
  return safe.empty() ? "unnamed" : safe;
}

}  // namespace

extern "C" {
void originalConstruct(void *self, const std::string &argument)
    asm("__ZN5smash7package12ModelPackageC1ERKNSt3__112basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEE");
int originalInitFromPath(void *self, const std::string &path)
    asm("__ZN5smash7package12ModelPackage12InitFromPathERKNSt3__112basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEE");
int originalInitFromBuf(void *self, const char *data, int size)
    asm("__ZN5smash7package12ModelPackage11InitFromBufEPKci");
int originalExtract(void *self, const std::string &name, std::map<std::string, std::string> &payloads)
    asm("__ZN5smash7package12ModelPackage7ExtractERKNSt3__112basic_stringIcNS2_11char_traitsIcEENS2_9allocatorIcEEEERNS2_3mapIS8_S8_NS2_4lessIS8_EENS6_INS2_4pairIS9_S8_EEEEEE");
}

void capturedConstruct(void *self, const std::string &argument) {
  note("construct self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " argument=" + argument);
  originalConstruct(self, argument);
}

int capturedInitFromPath(void *self, const std::string &path) {
  const int result = originalInitFromPath(self, path);
  note("init-path self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " rc=" + std::to_string(result) + " path=" + path);
  return result;
}

int capturedInitFromBuf(void *self, const char *data, int size) {
  const int result = originalInitFromBuf(self, data, size);
  note("init-buf self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " rc=" + std::to_string(result) +
       " bytes=" + std::to_string(size));
  return result;
}

int capturedExtract(void *self, const std::string &name, std::map<std::string, std::string> &payloads) {
  const int result = originalExtract(self, name, payloads);
  if (captureDirectory()) {
    const int index = sequence++;
    std::string detail = "extract self=" + std::to_string(reinterpret_cast<uintptr_t>(self)) + " rc=" + std::to_string(result) +
                         " name=" + name + " entries=" + std::to_string(payloads.size());
    for (const auto &entry : payloads) {
      char path[1024];
      std::snprintf(path, sizeof path, "%s/%03d-%s.%s.bin", captureDirectory(), index, sanitize(name).c_str(),
                    sanitize(entry.first).c_str());
      std::ofstream out(path, std::ios::binary);
      out.write(entry.second.data(), static_cast<std::streamsize>(entry.second.size()));
      detail += " [" + entry.first + "=" + std::to_string(entry.second.size()) + "]";
    }
    note(detail);
  }
  return result;
}

#define QCUT_INTERPOSE(replacement, replacee)                                        \
  __attribute__((used)) static struct {                                              \
    const void *replacement_;                                                        \
    const void *replacee_;                                                           \
  } interpose_##replacement __attribute__((section("__DATA,__interpose"))) = {       \
      reinterpret_cast<const void *>(&replacement), reinterpret_cast<const void *>(&replacee)};

QCUT_INTERPOSE(capturedConstruct, originalConstruct)
QCUT_INTERPOSE(capturedInitFromPath, originalInitFromPath)
QCUT_INTERPOSE(capturedInitFromBuf, originalInitFromBuf)
QCUT_INTERPOSE(capturedExtract, originalExtract)
