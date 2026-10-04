// Opt-in post-predict dependency callback; no native point arrays are transmitted.
#import <Foundation/Foundation.h>
namespace {
void qcutFaceLivePrediction(void*, const void*, int, int, int, int, int, int) noexcept;
}
#define QCUT_FACE_LIVE_PREDICTION
#include "face_host_geometry_capture.mm"
#undef QCUT_FACE_LIVE_PREDICTION
#include "face_live_bridge_socket.h"

namespace {
NSDictionary* liveFilter(uintptr_t address, int count) {
  if (read<int>(address + 0x70) != count)
    throw std::runtime_error("unsupported live filter count");
  return @{@"alpha":@(read<float>(address + 0x60)), @"scale":@(read<float>(address + 0x78)),
    @"escale":@(read<float>(address + 0x7c)), @"width":@(read<int>(address + 0x98)),
    @"height":@(read<int>(address + 0x9c))};
}

NSDictionary* liveFace(uintptr_t object, uintptr_t record, size_t slot, uintptr_t base) {
  if (read<uint32_t>(object + 0x934) != 0x123456)
    throw std::runtime_error("unsupported live alignment owner");
  const auto first33 = read<uint8_t>(object + 0x10 + 0x74);
  const auto first73 = read<uint8_t>(object + 0x110 + 0x74);
  if (first33 > 1 || first33 != first73)
    throw std::runtime_error("partial live Base initialization");
  NSDictionary* allTables = tables(base);
  return @{@"id":@(read<int>(record + 0xc)), @"slot":@(slot), @"alignment":@(object),
    @"forward":matrix(object + 0x11d8, 2, 3), @"inverse":matrix(object + 0x1238, 2, 3),
    @"first":@(first33 != 0),
    @"tables":@{@"base":allTables[@"base"], @"order":allTables[@"order"]},
    @"smoothing":@[liveFilter(object + 0x10, 33), liveFilter(object + 0x110, 73)]};
}

void qcutFaceLivePrediction(void* handle, const void* pixels, int rc, int format,
                           int width, int height, int stride, int rotation) noexcept {
  using Failure = void (*)(const char*);
  const auto fail = reinterpret_cast<Failure>(dlsym(RTLD_DEFAULT, "qcut_face_live_failure"));
  @autoreleasepool {
    try {
      using Deliver = void (*)(const void*, size_t);
      using Timestamp = int64_t (*)();
      const auto deliver = reinterpret_cast<Deliver>(dlsym(RTLD_DEFAULT, "qcut_face_live_result"));
      const auto timestamp = reinterpret_cast<Timestamp>(dlsym(RTLD_DEFAULT, "qcut_face_live_timestamp"));
      if (!fail || !deliver || !timestamp) throw std::runtime_error("live host exports missing");
      if (rc != 0 || format != 0 || rotation != 0 || width < 1 || height < 1 || width > 4096 ||
          height > 4096 || stride != width * 4 || static_cast<size_t>(stride) * height > 16 * 1024 * 1024)
        throw std::runtime_error("unsupported live algorithm RGBA/profile");
      std::lock_guard<std::mutex> lock(mutex);
      const auto index = predictions++;
      if (index >= 4096 || (index != 0 && ownerThread != std::this_thread::get_id()))
        throw std::runtime_error("unsupported live prediction thread/count");
      ownerThread = std::this_thread::get_id();
      const auto base = lensBase(), owner = reinterpret_cast<uintptr_t>(handle);
      const auto begin = read<uintptr_t>(owner + 0x7c00), end = read<uintptr_t>(owner + 0x7c08);
      const auto capacity = read<uintptr_t>(owner + 0x7c10);
      if (!begin || end < begin || end - begin != 4000 || capacity < end || capacity - begin > 4000)
        throw std::runtime_error("unsupported live face pool");
      id face = [NSNull null];
      for (size_t slot = 0; slot < 10; ++slot) {
        const auto record = begin + slot * 400;
        if (!(read<uint8_t>(record + 8) & 1)) continue;
        if (face != [NSNull null]) throw std::runtime_error("live multi-face unsupported");
        face = liveFace(read<uintptr_t>(record), record, slot, base);
      }
      NSMutableArray* predictors = [NSMutableArray array];
      for (const auto offset : {0x7878, 0x7898}) {
        const auto object = read<uintptr_t>(owner + offset);
        const auto provider = read<uintptr_t>(object + 0x110), vtable = read<uintptr_t>(provider);
        if (read<uintptr_t>(vtable) - base != 0x319320 || read<uintptr_t>(vtable + 16) - base != 0x3196c8)
          throw std::runtime_error("unsupported live neural provider");
        [predictors addObject:@{@"network":@(read<uintptr_t>(provider + 0x48))}];
      }
      std::vector<unsigned char> copy(static_cast<size_t>(stride) * height);
      mach_vm_size_t copied = 0;
      if (mach_vm_read_overwrite(mach_task_self(), reinterpret_cast<mach_vm_address_t>(pixels), copy.size(),
          reinterpret_cast<mach_vm_address_t>(copy.data()), &copied) != KERN_SUCCESS || copied != copy.size())
        throw std::runtime_error("cannot own live algorithm pixels");
      const char* token = std::getenv("QCUT_FACE_LIVE_TOKEN");
      if (!token || std::strlen(token) < 16) throw std::runtime_error("live session token missing");
      NSDictionary* message = @{@"op":@"predict", @"token":@(token), @"pid":@(getpid()), @"prediction":@(index),
        @"data":@{@"owner":@(owner), @"width":@(width), @"height":@(height), @"stride":@(stride),
          @"format":@(format), @"orientation":@(rotation), @"runtime_state":runtimeState(owner),
          @"face":face, @"predictors":predictors, @"timestamp_us":@(timestamp())}};
      NSDictionary* reply = qcut_live::exchange(message, copy);
      NSData* bytes = [NSJSONSerialization dataWithJSONObject:reply options:0 error:nil];
      if (!bytes) throw std::runtime_error("cannot serialize live worker reply");
      deliver(bytes.bytes, bytes.length);
    } catch (const std::exception& error) {
      if (fail) fail(error.what());
      else std::abort();
    }
  }
}
}
