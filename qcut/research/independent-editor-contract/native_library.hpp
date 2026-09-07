#pragma once

#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <mach-o/loader.h>
#include <uuid/uuid.h>

#include <array>
#include <cstdint>
#include <stdexcept>

namespace editor_probe {

constexpr char kSha256[] =
    "ee33e4e68ecf3dc05501d04c4415a3a52ce60c6a6ed3615330963e78be4c25ab";
constexpr char kUuid[] = "22337058-B217-3CAF-9979-CFECA7302CF7";

struct Library {
  const std::uint8_t* base;
  NSString* sha256;
  NSString* uuid;
};

inline NSString* hash_file(const char* path) {
  NSData* bytes = [NSData dataWithContentsOfFile:@(path)
                                      options:NSDataReadingMappedIfSafe error:nil];
  if (!bytes || bytes.length > UINT32_MAX) throw std::runtime_error("Cannot hash library");
  std::array<unsigned char, CC_SHA256_DIGEST_LENGTH> digest{};
  CC_SHA256(bytes.bytes, static_cast<CC_LONG>(bytes.length), digest.data());
  NSMutableString* hash = [NSMutableString string];
  for (const auto byte : digest) [hash appendFormat:@"%02x", byte];
  return hash;
}

inline Library load_verified(const char* path) {
  if (!path || path[0] != '/') throw std::runtime_error("Library path must be absolute");
  const auto hash = hash_file(path);
  if (![hash isEqualToString:@(kSha256)]) {
    throw std::runtime_error("Unknown libvideoeditor SHA-256; refusing private ABI");
  }
  void* handle = dlopen(path, RTLD_NOW | RTLD_LOCAL);
  if (!handle) throw std::runtime_error(dlerror());
  Dl_info image{};
  void* anchor = dlsym(handle, "_ZNK4lvve14MaterialEffect9get_valueEv");
  if (!anchor || !dladdr(anchor, &image) ||
      ![hash_file(image.dli_fname) isEqualToString:hash]) {
    throw std::runtime_error("Loaded libvideoeditor image identity differs");
  }
  const auto* header = static_cast<const mach_header_64*>(image.dli_fbase);
  if (header->magic != MH_MAGIC_64 || header->cputype != CPU_TYPE_ARM64) {
    throw std::runtime_error("Only the verified arm64 ABI is supported");
  }
  const auto* cursor = reinterpret_cast<const std::uint8_t*>(header + 1);
  const auto* end = cursor + header->sizeofcmds;
  NSString* found_uuid = nil;
  for (std::uint32_t index = 0; index < header->ncmds; ++index) {
    if (cursor > end || static_cast<std::size_t>(end - cursor) < sizeof(load_command)) {
      throw std::runtime_error("Truncated Mach-O load command");
    }
    const auto* command = reinterpret_cast<const load_command*>(cursor);
    if (command->cmdsize < sizeof(load_command) ||
        command->cmdsize > static_cast<std::size_t>(end - cursor)) {
      throw std::runtime_error("Invalid Mach-O load command size");
    }
    if (command->cmd == LC_UUID) {
      if (command->cmdsize < sizeof(uuid_command)) throw std::runtime_error("Truncated UUID");
      std::array<char, 37> text{};
      uuid_unparse_upper(reinterpret_cast<const uuid_command*>(command)->uuid, text.data());
      found_uuid = @(text.data());
    }
    cursor += command->cmdsize;
  }
  if (![found_uuid isEqualToString:@(kUuid)]) {
    throw std::runtime_error("Unknown libvideoeditor UUID; refusing private ABI");
  }
  // The verified leaf entrypoint also anchors the unslid VM-address convention.
  const auto* base = static_cast<const std::uint8_t*>(image.dli_fbase);
  if (anchor != base + 0xf1cc6c) throw std::runtime_error("Unexpected image address layout");
  return {base, hash, found_uuid};
}

template <typename Function>
Function entry(const Library& library, std::uintptr_t offset) {
  return reinterpret_cast<Function>(const_cast<std::uint8_t*>(library.base) + offset);
}

}  // namespace editor_probe
