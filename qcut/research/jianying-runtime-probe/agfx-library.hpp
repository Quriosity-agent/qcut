#pragma once

#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <mach-o/loader.h>
#include <uuid/uuid.h>

#include <array>
#include <cstdint>
#include <stdexcept>
#include <string>

namespace agfx_probe {

constexpr char kLibrarySha256[] =
    "4fa8758d914743dc682f8f1f9e667f1cc0b429cd2bd7437a25cdec7d4d7489aa";
constexpr char kArm64Uuid[] = "408EB610-AD47-3846-9595-14B6A3ABF537";

struct LibraryRequest { const char* path; };

struct LibraryIdentity {
  void* handle;
  const std::uint8_t* base;
  NSString* sha256;
  NSString* uuid;
};

inline NSString* hashLibrary(const LibraryRequest& request) {
  NSData* data = [NSData dataWithContentsOfFile:@(request.path)
                                      options:NSDataReadingMappedIfSafe
                                        error:nil];
  if (!data || data.length > UINT32_MAX) {
    throw std::runtime_error("Cannot read bounded library file.");
  }
  std::array<unsigned char, CC_SHA256_DIGEST_LENGTH> digest{};
  CC_SHA256(data.bytes, static_cast<CC_LONG>(data.length), digest.data());
  NSMutableString* hash = [NSMutableString string];
  for (const auto byte : digest) {
    [hash appendFormat:@"%02x", byte];
  }
  return hash;
}

inline LibraryIdentity loadVerifiedLibrary(const LibraryRequest& request) {
  if (!request.path || request.path[0] != '/') throw std::runtime_error("AGFX path must be absolute");
  const auto hash = hashLibrary(request);
  if (![hash isEqualToString:@(kLibrarySha256)]) {
    throw std::runtime_error("Unknown libAGFX SHA-256; refusing private ABI.");
  }
  void* handle = dlopen(request.path, RTLD_NOW | RTLD_LOCAL);
  if (!handle) {
    throw std::runtime_error(dlerror());
  }
  Dl_info image{};
  void* anchor = dlsym(
      handle, "_ZN13AmazingEngine8GPDevice12createDeviceENS_12RendererTypeEj");
  if (!anchor || !dladdr(anchor, &image)) {
    throw std::runtime_error("Cannot identify loaded AGFX image.");
  }
  if (![hashLibrary({image.dli_fname}) isEqualToString:hash]) {
    throw std::runtime_error("Loaded AGFX image differs from requested file.");
  }
  const auto* header = static_cast<const mach_header_64*>(image.dli_fbase);
  if (header->magic != MH_MAGIC_64 || header->cputype != CPU_TYPE_ARM64) {
    throw std::runtime_error("Probe requires the verified arm64 slice.");
  }
  const auto* begin = reinterpret_cast<const std::uint8_t*>(header + 1);
  const auto* cursor = begin;
  const auto* end = begin + header->sizeofcmds;
  NSString* foundUuid = nil;
  for (std::uint32_t index = 0; index < header->ncmds; ++index) {
    if (cursor > end || static_cast<std::size_t>(end - cursor) < sizeof(load_command)) {
      throw std::runtime_error("Truncated loaded Mach-O command.");
    }
    const auto* command = reinterpret_cast<const load_command*>(cursor);
    if (command->cmdsize < sizeof(load_command) ||
        command->cmdsize > static_cast<std::size_t>(end - cursor)) {
      throw std::runtime_error("Invalid loaded Mach-O command size.");
    }
    if (command->cmd == LC_UUID) {
      if (command->cmdsize < sizeof(uuid_command)) {
        throw std::runtime_error("Truncated loaded UUID command.");
      }
      const auto* uuid = reinterpret_cast<const uuid_command*>(command);
      std::array<char, 37> text{};
      uuid_unparse_upper(uuid->uuid, text.data());
      foundUuid = @(text.data());
    }
    cursor += command->cmdsize;
  }
  if (![foundUuid isEqualToString:@(kArm64Uuid)]) {
    throw std::runtime_error("Unknown libAGFX arm64 UUID; refusing private ABI.");
  }
  return {handle, static_cast<const std::uint8_t*>(image.dli_fbase), hash, foundUuid};
}


template <typename Function>
Function resolve(const LibraryIdentity& library, const char* name) {
  dlerror();
  void* address = dlsym(library.handle, name);
  const char* error = dlerror();
  if (!address || error) throw std::runtime_error(std::string("Missing AGFX symbol: ") + name);
  return reinterpret_cast<Function>(address);
}

} // namespace agfx_probe
