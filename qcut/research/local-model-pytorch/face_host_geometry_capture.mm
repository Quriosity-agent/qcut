// Observe the initialized FsNew owner after prediction, never a fitted oracle instance.
#import <Foundation/Foundation.h>
#include <mach/mach_vm.h>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <dlfcn.h>
#include <fstream>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

namespace {
struct MatView {
  int32_t flags, dims, rows, cols;
  uintptr_t data, start, end, limit, allocator, owner, size, step;
  size_t steps[2];
};
static_assert(sizeof(MatView) == 96);
using Predict = int (*)(void*, const void*, int, int, int, int, int, void*, void*);
extern "C" int FsNew_DoPredict(void*, const void*, int, int, int, int, int, void*, void*);
extern "C" int FsNew_DoPredict240(void*, const void*, int, int, int, int, int, void*, void*);
std::mutex mutex;
std::thread::id ownerThread;
size_t predictions = 0;

const char* directory() {
  static const char* value = std::getenv("QCUT_FACE_GEOMETRY_DIR");
  return value && *value ? value : nullptr;
}

template <typename T> T read(uintptr_t address) {
  T value{};
  mach_vm_size_t copied = 0;
  if (address < 4096 || mach_vm_read_overwrite(mach_task_self(), address, sizeof(T),
      reinterpret_cast<mach_vm_address_t>(&value), &copied) != KERN_SUCCESS || copied != sizeof(T))
    throw std::runtime_error("unreadable geometry field");
  return value;
}

NSArray* floats(uintptr_t address, size_t count) {
  if (count > 280) throw std::runtime_error("geometry array exceeds bound");
  NSMutableArray* result = [NSMutableArray arrayWithCapacity:count];
  for (size_t index = 0; index < count; ++index) {
    float value = read<float>(address + index * sizeof(float));
    if (!std::isfinite(value) || std::abs(value) > 32768)
      throw std::runtime_error("nonfinite or unbounded geometry value");
    [result addObject:@(value)];
  }
  return result;
}

id matrix(uintptr_t address, int rows, int cols) {
  const auto view = read<MatView>(address);
  if (view.rows == 0 && view.cols == 0 && view.data == 0) return [NSNull null];
  if (view.dims != 2 || (view.flags & 0xfff) != 5 || view.rows != rows ||
      (cols != 0 && view.cols != cols) || view.cols < 1 || view.cols > 280 ||
      view.steps[0] < view.cols * sizeof(float) || view.steps[0] > 4096 || view.steps[1] != sizeof(float))
    throw std::runtime_error("unsupported geometry Mat descriptor at " + std::to_string(address) +
      " rows=" + std::to_string(view.rows) + " cols=" + std::to_string(view.cols) +
      " flags=" + std::to_string(view.flags) + " dims=" + std::to_string(view.dims) +
      " strides=" + std::to_string(view.steps[0]) + "," + std::to_string(view.steps[1]));
  NSMutableArray* result = [NSMutableArray arrayWithCapacity:rows];
  for (int row = 0; row < rows; ++row)
    [result addObject:floats(view.data + row * view.steps[0], view.cols)];
  return result;
}

uintptr_t lensBase() {
  Dl_info info{};
  if (!dladdr(reinterpret_cast<void*>(FsNew_DoPredict), &info) || !info.dli_fbase)
    throw std::runtime_error("missing lens image");
  const auto base = reinterpret_cast<uintptr_t>(info.dli_fbase);
  if (reinterpret_cast<uintptr_t>(FsNew_DoPredict) - base != 0x2c4dac)
    throw std::runtime_error("unsupported FsNew prediction profile");
  return base;
}

NSDictionary* tables(uintptr_t base) {
  NSMutableArray* order = [NSMutableArray arrayWithCapacity:106];
  bool seen[106]{};
  for (int index = 0; index < 106; ++index) {
    const int value = read<int>(base + 0x5dc370 + index * 4);
    if (value < 0 || value >= 106 || seen[value])
      throw std::runtime_error("unsupported initialized Stage1 order");
    seen[value] = true;
    [order addObject:@(value)];
  }
  return @{@"base":floats(base + 0x5dcd38, 212),
           @"tracking":floats(base + 0x5dc9e8, 212), @"order":order};
}

NSDictionary* alignment(uintptr_t address, size_t slot) {
  if (read<uint32_t>(address + 0x934) != 0x123456)
    throw std::runtime_error("unverified initialized alignment owner");
  const auto stage = read<MatView>(address + 0xaa8);
  if (stage.rows == 0 && stage.cols == 0 && stage.data == 0) return nil;
  const auto transform = address + 0x11d8;
  return @{@"slot":@(slot), @"alignment":@(address),
    @"stage1":matrix(address + 0xaa8, 2, 0),
    @"mapped":matrix(address + 0x7b48, 2, 0),
    @"tracked":matrix(address + 0xb08, 2, 0),
    @"forward":matrix(transform, 2, 3), @"inverse":matrix(transform + 96, 2, 3),
    @"cached_forward":matrix(address + 0x7740, 2, 3),
    @"cached_inverse":matrix(address + 0x77a0, 2, 3),
    @"detection_forward":matrix(address + 0xfe8, 2, 3),
    @"detection_inverse":matrix(address + 0xfe8 + 96, 2, 3),
    @"base_size":@[@(read<int>(address + 0x954)), @(read<int>(address + 0x958))],
    @"tracking_size":@[@(read<int>(address + 0x94c)), @(read<int>(address + 0x950))],
    @"tracking_scale":@(read<float>(address + 0x944)),
    @"frame_size":@[@(read<int>(address + 0x92c)), @(read<int>(address + 0x930))]};
}

void save(NSDictionary* value, size_t index) {
  NSError* error = nil;
  NSData* bytes = [NSJSONSerialization dataWithJSONObject:value options:0 error:&error];
  if (!bytes) throw std::runtime_error("geometry JSON serialization failed");
  const std::string path = std::string(directory()) + "/prediction-" + std::to_string(index) + ".json";
  std::ofstream stream(path, std::ios::binary);
  stream.write(static_cast<const char*>(bytes.bytes), bytes.length);
  if (!stream) throw std::runtime_error("geometry snapshot write failed");
}

void capture(void* handle, const char* api, int rc, int format, int width, int height,
             int stride, int rotation) noexcept {
  if (!directory()) return;
  std::lock_guard<std::mutex> lock(mutex);
  const auto index = predictions++;
  @autoreleasepool {
    try {
      if (index >= 64 || (index != 0 && ownerThread != std::this_thread::get_id()))
        throw std::runtime_error("unsupported geometry thread or prediction limit");
      ownerThread = std::this_thread::get_id();
      const auto base = lensBase(), owner = reinterpret_cast<uintptr_t>(handle);
      using Counter = int (*)();
      const auto counter = reinterpret_cast<Counter>(dlsym(RTLD_DEFAULT, "qcut_bytenn_capture_sequence"));
      if (!counter || counter() < 0) throw std::runtime_error("missing neural capture sequence");
      const int neuralSequence = counter();
      const auto begin = read<uintptr_t>(owner + 0x7c00), end = read<uintptr_t>(owner + 0x7c08);
      const auto capacity = read<uintptr_t>(owner + 0x7c10);
      if (rc != 0 || !begin || end < begin || capacity < end || end - begin != 4000 || capacity - begin > 4000)
        throw std::runtime_error("unsupported prediction result or face pool");
      NSMutableArray* faces = [NSMutableArray array];
      for (size_t slot = 0; slot < 10; ++slot) {
        const auto object = read<uintptr_t>(begin + slot * 400);
        NSDictionary* value = alignment(object, slot);
        if (value) [faces addObject:value];
      }
      NSMutableArray* predictors = [NSMutableArray array];
      for (const auto offset : {0x7878, 0x7898}) {
        const auto object = read<uintptr_t>(owner + offset);
        const auto provider = read<uintptr_t>(object + 0x110);
        const auto vtable = read<uintptr_t>(provider);
        if (read<uintptr_t>(vtable) - base != 0x319320 || read<uintptr_t>(vtable + 16) - base != 0x3196c8)
          throw std::runtime_error("unsupported initialized espresso provider");
        [predictors addObject:@{@"predictor":@(object), @"provider":@(provider),
          @"network":@(read<uintptr_t>(provider + 0x48)),
          @"predict_offset":@(read<uintptr_t>(vtable) - base),
          @"extract_offset":@(read<uintptr_t>(vtable + 16) - base),
          @"size":@[@(read<int>(object + 0x3c)), @(read<int>(object + 0x40))]}];
      }
      save(@{@"index":@(index), @"api":@(api), @"rc":@(rc), @"handle":@(owner),
        @"request":@[@(format), @(width), @(height), @(stride), @(rotation)], @"bytenn_sequence":@(neuralSequence),
        @"predictors":predictors, @"faces":faces, @"tables":tables(base)}, index);
    } catch (const std::exception& error) {
      try { save(@{@"index":@(index), @"error":@(error.what())}, index); } catch (...) {}
    }
  }
}

int observe(void* h, const void* pixels, int f, int w, int y, int stride, int rotation,
            void* args, void* output, Predict original, const char* api) {
  const int rc = original(h, pixels, f, w, y, stride, rotation, args, output);
  capture(h, api, rc, f, w, y, stride, rotation);
  return rc;
}

int predict(void* h, const void* p, int f, int w, int y, int s, int r, void* a, void* o) {
  return observe(h, p, f, w, y, s, r, a, o, FsNew_DoPredict, "FsNew_DoPredict");
}
int predict240(void* h, const void* p, int f, int w, int y, int s, int r, void* a, void* o) {
  return observe(h, p, f, w, y, s, r, a, o, FsNew_DoPredict240, "FsNew_DoPredict240");
}
struct Interpose { const void* replacement; const void* original; };
__attribute__((used, section("__DATA,__interpose"))) const Interpose hooks[] = {
  {reinterpret_cast<const void*>(predict), reinterpret_cast<const void*>(FsNew_DoPredict)},
  {reinterpret_cast<const void*>(predict240), reinterpret_cast<const void*>(FsNew_DoPredict240)},
};
}
