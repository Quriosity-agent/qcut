#include "face_live_bridge_response.h"
#include <cstdio>
#include <functional>

namespace {
constexpr auto token = "0123456789abcdef";
int checks = 0;

NSMutableDictionary* packet() {
  NSMutableArray* points = [NSMutableArray array];
  for (int index = 0; index < 106; ++index) [points addObject:[@[@0.25, @0.75] mutableCopy]];
  return [@{@"ok":@YES, @"token":@(token), @"pid":@123, @"prediction":@2, @"timestamp_us":@500,
    @"result":[@{@"source":@"dependency-fed-research-inference", @"native_final_point_input_used":@NO,
      @"captured_tensor_input_used":@NO,
      @"faces":[NSMutableArray arrayWithObject:[@{@"id":@7, @"points":points} mutableCopy]]} mutableCopy]} mutableCopy];
}

qcut_live::Response parse(id value) {
  NSData* data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  if (!data) throw std::runtime_error("test fixture serialization failed");
  return qcut_live::parseResponse(data.bytes, data.length, @(token), 123, 2, 500);
}

void rejects(const std::function<void(NSMutableDictionary*)>& mutate) {
  auto value = packet();
  mutate(value);
  bool rejected = false;
  try { parse(value); }
  catch (const std::runtime_error&) { rejected = true; }
  if (!rejected) throw std::runtime_error("invalid live response accepted");
  ++checks;
}
}

int main() {
  @autoreleasepool {
    const auto accepted = parse(packet());
    if (accepted.prediction != 2 || accepted.timestamp != 500 || accepted.faces.size() != 1 ||
        accepted.faces[0].id != 7 || accepted.faces[0].points[0] != 0.25f ||
        accepted.faces[0].points[211] != 0.75f) return 1;
    ++checks;
    auto empty = packet();
    empty[@"result"][@"faces"] = @[];
    if (!parse(empty).faces.empty()) return 1;
    ++checks;
    for (NSString* key in @[@"pid", @"prediction", @"timestamp_us"]) {
      for (id value in @[@YES, @NO, @-1, @0.5, @"2", [NSNull null], @18446744073709551615ULL])
        rejects([=](NSMutableDictionary* row) { row[key] = value; });
    }
    for (id value in @[@1, @0, @NO, @"true", [NSNull null]])
      rejects([=](NSMutableDictionary* row) { row[@"ok"] = value; });
    rejects([](NSMutableDictionary* row) { row[@"pid"] = @124; });
    rejects([](NSMutableDictionary* row) { row[@"prediction"] = @3; });
    rejects([](NSMutableDictionary* row) { row[@"timestamp_us"] = @501; });
    rejects([](NSMutableDictionary* row) { row[@"token"] = @"other-session-key"; });
    for (NSString* key in @[@"native_final_point_input_used", @"captured_tensor_input_used"])
      for (id value in @[@0, @1, @YES, [NSNull null]])
        rejects([=](NSMutableDictionary* row) { row[@"result"][key] = value; });
    rejects([](NSMutableDictionary* row) { row[@"result"] = @[]; });
    rejects([](NSMutableDictionary* row) { row[@"result"][@"source"] = @"recorded-replay"; });
    for (id value in @[@{}, @[[NSNull null]], @[@"face"], @[@{}, @{}]])
      rejects([=](NSMutableDictionary* row) { row[@"result"][@"faces"] = value; });
    rejects([](NSMutableDictionary* row) { row[@"result"][@"faces"][0][@"id"] = @YES; });
    rejects([](NSMutableDictionary* row) { row[@"result"][@"faces"][0][@"points"] = @[]; });
    for (id value in @[@[@0.5], @{}, @[[NSNull null], @0.5], @[@{}, @0.5],
                      @[@YES, @0.5], @[@"0.5", @0.5], @[@-0.001, @0.5], @[@1.001, @0.5]])
      rejects([=](NSMutableDictionary* row) { row[@"result"][@"faces"][0][@"points"][0] = value; });
    for (size_t size : {size_t(0), size_t(128 * 1024 + 1)}) {
      bool rejected = false;
      try { qcut_live::parseResponse("{}", size, @(token), 123, 2, 500); }
      catch (const std::runtime_error&) { rejected = true; }
      if (!rejected) return 1;
      ++checks;
    }
    std::printf("%d native response contract checks passed; no runtime loaded\n", checks);
  }
}
