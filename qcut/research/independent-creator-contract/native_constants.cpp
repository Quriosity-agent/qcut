#include "selection.hpp"

#include <CommonCrypto/CommonDigest.h>
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <mach-o/loader.h>
#include <uuid/uuid.h>

#include <array>
#include <bit>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>

namespace {
constexpr char expected_sha[] = "fb2082654df3a54c39e99d6828abf8189b011c4a1eaf48a5332b18525df7b62b";
constexpr char expected_uuid[] = "C4A59C03-BCE4-30E9-801E-BDC096397FD3";

std::string hash_file(const std::filesystem::path& path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) throw std::runtime_error("Cannot read library");
  CC_SHA256_CTX context{};
  CC_SHA256_Init(&context);
  std::array<char, 65536> buffer{};
  while (input.read(buffer.data(), static_cast<std::streamsize>(buffer.size())) || input.gcount() > 0) {
    CC_SHA256_Update(&context, buffer.data(), static_cast<CC_LONG>(input.gcount()));
  }
  if (!input.eof()) throw std::runtime_error("Cannot finish library hash");
  std::array<unsigned char, CC_SHA256_DIGEST_LENGTH> digest{};
  CC_SHA256_Final(digest.data(), &context);
  std::ostringstream text;
  for (auto value : digest) text << std::hex << std::setw(2) << std::setfill('0') << static_cast<unsigned>(value);
  return text.str();
}

const mach_header_64* load_verified(const std::filesystem::path& path) {
  if (!path.is_absolute() || hash_file(path) != expected_sha) {
    throw std::runtime_error("Unknown VECreator SHA-256; no native call attempted");
  }
  if (!dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL)) {
    throw std::runtime_error(dlerror());
  }
  const mach_header_64* header = nullptr;
  for (std::uint32_t i = 0; i < _dyld_image_count(); ++i) {
    if (std::filesystem::path(_dyld_get_image_name(i)) == path) {
      header = reinterpret_cast<const mach_header_64*>(_dyld_get_image_header(i));
    }
  }
  if (!header || header->magic != MH_MAGIC_64 || header->cputype != CPU_TYPE_ARM64 ||
      header->sizeofcmds > 1048576 || hash_file(path) != expected_sha) {
    throw std::runtime_error("Cannot identify verified loaded arm64 image");
  }
  const auto* cursor = reinterpret_cast<const std::byte*>(header + 1);
  const auto* end = cursor + header->sizeofcmds;
  bool uuid_ok = false;
  bool executable_constants = false;
  for (std::uint32_t i = 0; i < header->ncmds; ++i) {
    if (static_cast<std::size_t>(end - cursor) < sizeof(load_command)) throw std::runtime_error("Truncated load command");
    load_command command{};
    std::memcpy(&command, cursor, sizeof(command));
    if (command.cmdsize < sizeof(command) || command.cmdsize > static_cast<std::size_t>(end - cursor)) {
      throw std::runtime_error("Invalid load command size");
    }
    if (command.cmd == LC_UUID) {
      if (command.cmdsize < sizeof(uuid_command)) throw std::runtime_error("Truncated UUID");
      uuid_command uuid{};
      std::memcpy(&uuid, cursor, sizeof(uuid));
      std::array<char, 37> text{};
      uuid_unparse_upper(uuid.uuid, text.data());
      uuid_ok = std::string(text.data()) == expected_uuid;
    }
    if (command.cmd == LC_SEGMENT_64) {
      if (command.cmdsize < sizeof(segment_command_64)) throw std::runtime_error("Truncated segment");
      segment_command_64 segment{};
      std::memcpy(&segment, cursor, sizeof(segment));
      if (segment.vmaddr <= 0x847b54 && segment.vmsize >= 0x847b74 - segment.vmaddr &&
          (segment.initprot & VM_PROT_EXECUTE) != 0) executable_constants = true;
    }
    cursor += command.cmdsize;
  }
  if (!uuid_ok || !executable_constants) throw std::runtime_error("UUID or constant function range mismatch");
  return header;
}
}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 2) throw std::runtime_error("usage: creator-native-constants /absolute/libVECreator.dylib");
    const std::filesystem::path requested_path(argv[1]);
    if (!requested_path.is_absolute()) throw std::runtime_error("Library path must be absolute");
    const auto path = std::filesystem::canonical(requested_path);
    const auto* base = reinterpret_cast<const std::byte*>(load_verified(path));
    const auto default_value = reinterpret_cast<double (*)()>(const_cast<std::byte*>(base + 0x847b54));
    const auto precision = reinterpret_cast<double (*)()>(const_cast<std::byte*>(base + 0x847b5c));
    for (unsigned i = 0; i < 1024; ++i) {
      if (std::bit_cast<std::uint64_t>(default_value()) != std::bit_cast<std::uint64_t>(creator_contract::filter_default_intensity) ||
          std::bit_cast<std::uint64_t>(precision()) != std::bit_cast<std::uint64_t>(creator_contract::filter_intensity_precision)) {
        throw std::runtime_error("Native constant mismatch");
      }
    }
    std::cout << "{\"status\":\"passed\",\"calls\":2048,\"default\":1,\"precision\":0.001,\"sha256\":\""
              << expected_sha << "\",\"uuid\":\"" << expected_uuid << "\"}\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
