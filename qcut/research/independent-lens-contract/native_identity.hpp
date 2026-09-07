#pragma once

#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <mach-o/loader.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>

namespace lens_contract::diagnostic {
constexpr char expected_sha[] =
    "8a081eb022a357048a59294c37d7571e125303fe91af052c39a4dc96d70dacdf";
constexpr std::array<unsigned char, 16> expected_uuid{
    0x24, 0x88, 0x72, 0xf2, 0x77, 0x36, 0x32, 0xa9,
    0xa4, 0x8b, 0xdc, 0x5d, 0xfe, 0xe2, 0x0c, 0x99};

inline void require(bool condition, const std::string& message) {
  if (!condition) throw std::runtime_error(message);
}

inline std::string sha256(const std::string& path) {
  std::ifstream stream(path, std::ios::binary);
  require(static_cast<bool>(stream), "Cannot read the library");
  CC_SHA256_CTX context{};
  CC_SHA256_Init(&context);
  std::array<char, 65536> block{};
  while (stream.read(block.data(), static_cast<std::streamsize>(block.size())) ||
         stream.gcount() != 0) {
    CC_SHA256_Update(&context, block.data(), static_cast<CC_LONG>(stream.gcount()));
  }
  require(stream.eof(), "Library read failed");
  std::array<unsigned char, CC_SHA256_DIGEST_LENGTH> digest{};
  CC_SHA256_Final(digest.data(), &context);
  std::ostringstream result;
  result << std::hex << std::setfill('0');
  for (unsigned char byte : digest) result << std::setw(2) << static_cast<unsigned>(byte);
  return result.str();
}

inline void validate_loaded_image(void* symbol) {
  Dl_info info{};
  require(dladdr(symbol, &info) != 0, "Cannot locate the loaded image");
  const auto* header = static_cast<const mach_header_64*>(info.dli_fbase);
  require(header && header->magic == MH_MAGIC_64 && header->cputype == CPU_TYPE_ARM64,
          "Unexpected loaded architecture");
  const auto* cursor = reinterpret_cast<const unsigned char*>(header + 1);
  const auto* end = cursor + header->sizeofcmds;
  for (std::uint32_t index = 0; index < header->ncmds; ++index) {
    require(cursor + sizeof(load_command) <= end, "Malformed load commands");
    const auto* command = reinterpret_cast<const load_command*>(cursor);
    require(command->cmdsize >= sizeof(load_command) && cursor + command->cmdsize <= end,
            "Malformed load command size");
    if (command->cmd == LC_UUID) {
      require(command->cmdsize >= sizeof(uuid_command), "Malformed UUID command");
      const auto* uuid = reinterpret_cast<const uuid_command*>(cursor);
      require(std::equal(expected_uuid.begin(), expected_uuid.end(), uuid->uuid),
              "Unknown loaded library UUID");
      return;
    }
    cursor += command->cmdsize;
  }
  throw std::runtime_error("Loaded library has no UUID");
}

class Oracle {
 public:
  explicit Oracle(const std::string& path) {
    require(std::filesystem::path(path).is_absolute(), "Library path must be absolute");
    require(sha256(path) == expected_sha, "Unknown library SHA256; no native call made");
    handle_ = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle_) throw std::runtime_error(dlerror());
  }
  ~Oracle() { if (handle_) dlclose(handle_); }
  Oracle(const Oracle&) = delete;
  Oracle& operator=(const Oracle&) = delete;

  template <typename Function>
  Function symbol(const char* name) const {
    void* address = dlsym(handle_, name);
    require(address != nullptr, std::string("Missing symbol: ") + name);
    validate_loaded_image(address);
    return reinterpret_cast<Function>(address);
  }

  template <typename Function>
  Function offset(const char* anchor, std::uintptr_t anchor_vm,
                  std::uintptr_t target_vm) const {
    const auto address = symbol<void (*)()>(anchor);
    Dl_info info{};
    require(dladdr(reinterpret_cast<void*>(address), &info) != 0,
            "Cannot locate native anchor");
    const auto base = reinterpret_cast<std::uintptr_t>(info.dli_fbase);
    require(reinterpret_cast<std::uintptr_t>(address) == base + anchor_vm,
            "Native anchor address differs from the pinned image");
    return reinterpret_cast<Function>(base + target_vm);
  }

 private:
  void* handle_ = nullptr;
};

}  // namespace lens_contract::diagnostic
