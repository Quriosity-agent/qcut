// Isolated, version-locked completion experiment; not a product backend.
#include "../jianying-runtime-probe/probe-utils.h"
#include "../jianying-runtime-probe/filter-host-support.h"
#include "../jianying-runtime-probe/amazer-context-scope.h"
#include <cstdlib>
#include <type_traits>

namespace jianying_probe { namespace { struct SwingDeviceTextureDataProbe; } }

namespace {
using Seek = int (*)(void*, std::int64_t,
    const jianying_probe::SwingDeviceTextureDataProbe*,
    const jianying_probe::SwingDeviceTextureDataProbe*);
Seek nativeSeek = nullptr;
void* coreLibrary = nullptr;
bool loggedRenderer = false;
void skipHostFence(void*) {}

int completedSeek(void* manager, std::int64_t timestamp,
                  const jianying_probe::SwingDeviceTextureDataProbe* input,
                  const jianying_probe::SwingDeviceTextureDataProbe* output) {
  const int result = nativeSeek(manager, timestamp, input, output);
  if (result != 0) return result;
  Dl_info image{};
  if (dladdr(reinterpret_cast<void*>(nativeSeek), &image) == 0)
    throw std::runtime_error("missing completion image base");
  auto* base = static_cast<unsigned char*>(image.dli_fbase);
  using Context = void* (*)();
  using Getter = void* (*)(void*);
  using Finish = void (*)(void*);
  void* context = reinterpret_cast<Context>(base + 0x3f9f38)();
  if (context == nullptr) throw std::runtime_error("missing active BEF context");
  void* renderer = reinterpret_cast<Getter>(base + 0x3f9fd8)(context);
  if (renderer == nullptr) throw std::runtime_error("missing engine renderer");
  static const auto getAmazer = jianying_probe::resolveSymbol<Getter>(coreLibrary,
      "_ZNK13AmazingEngine12SwingManager9getAmazerEv");
  static const auto getDevice = jianying_probe::resolveSymbol<Getter>(coreLibrary,
      "_ZNK13AmazingEngine12SwingManager11getGPDeviceEv");
  static const auto finish = jianying_probe::resolveSymbol<Finish>(coreLibrary,
      "_ZN13AmazingEngine14RendererDevice6finishEv");
  if (!loggedRenderer) {
    std::cout << "[completion] renderer=" << renderer
              << " swing_device=" << getDevice(manager)
              << " active_context=" << context << " amazer=" << getAmazer(manager) << '\n';
    loggedRenderer = true;
  }
  if (std::getenv("QCUT_WAIT_ENGINE_RENDERER") != nullptr) finish(renderer);
  return result;
}

template <typename Function>
Function completionResolve(void* handle, std::string_view name) {
  Function original = jianying_probe::resolveSymbol<Function>(handle, name);
  if constexpr (std::is_same_v<Function, void (*)(void*)>) {
    // Only the host's resolved fence is replaced; vendor-internal calls stay intact.
    if (name == "_ZN13AmazingEngine14RendererDevice6finishEv") return skipHostFence;
  }
  if constexpr (std::is_same_v<Function, Seek>) {
    if (name == "bef_swing_manager_seek_frame_device_texture_with_data") {
      if (jianying_probe::runtimeImageUuid(reinterpret_cast<void*>(original)) !=
          "D6342ECD-5432-33F0-A2AD-0C28F5699994")
        throw std::runtime_error("unverified completion image UUID");
      nativeSeek = original;
      coreLibrary = handle;
      return completedSeek;
    }
  }
  return original;
}
}

#define resolveSymbol completionResolve
#include "../jianying-runtime-probe/filter-probe.mm"
#undef resolveSymbol
#include "../jianying-runtime-probe/filter-host-main.mm"
