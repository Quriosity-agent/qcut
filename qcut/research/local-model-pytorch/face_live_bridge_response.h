#pragma once
#import <Foundation/Foundation.h>
#include <array>
#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace qcut_live {
struct FaceResponse { int id; std::array<float, 212> points; };
struct Response { int64_t prediction; int64_t timestamp; std::vector<FaceResponse> faces; };

inline bool boolean(id value, bool expected) {
  return value && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID() &&
         [value boolValue] == expected;
}

inline bool numeric(id value) {
  return [value isKindOfClass:[NSNumber class]] &&
         CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID();
}

inline int64_t integer(id value, int64_t minimum, int64_t maximum) {
  if (!numeric(value) || !std::isfinite([value doubleValue]) ||
      [value compare:@(minimum)] == NSOrderedAscending || [value compare:@(maximum)] == NSOrderedDescending ||
      [value doubleValue] != [value longLongValue])
    throw std::runtime_error("invalid typed live integer");
  return [value longLongValue];
}

inline Response parseResponse(const void* bytes, size_t size, NSString* token,
                              int64_t pid, int64_t prediction, int64_t timestamp) {
  if (!bytes || size == 0 || size > 128 * 1024 || token.length < 16 || token.length > 128)
    throw std::runtime_error("bounded live response and session token required");
  id reply = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:bytes length:size] options:0 error:nil];
  if (![reply isKindOfClass:[NSDictionary class]] || !boolean(reply[@"ok"], true) ||
      ![reply[@"token"] isKindOfClass:[NSString class]] || ![reply[@"token"] isEqual:token] ||
      integer(reply[@"pid"], 1, INT32_MAX) != pid ||
      integer(reply[@"prediction"], 0, 4095) != prediction ||
      integer(reply[@"timestamp_us"], 0, INT64_MAX) != timestamp)
    throw std::runtime_error("live response association mismatch");
  id result = reply[@"result"];
  if (![result isKindOfClass:[NSDictionary class]] ||
      ![result[@"source"] isEqual:@"dependency-fed-research-inference"] ||
      !boolean(result[@"native_final_point_input_used"], false) ||
      !boolean(result[@"captured_tensor_input_used"], false))
    throw std::runtime_error("live result provenance missing");
  id faces = result[@"faces"];
  if (![faces isKindOfClass:[NSArray class]] || [faces count] > 1)
    throw std::runtime_error("live single-face result required");
  Response response{prediction, timestamp, {}};
  for (id face in faces) {
    if (![face isKindOfClass:[NSDictionary class]])
      throw std::runtime_error("live face object required");
    FaceResponse item{static_cast<int>(integer(face[@"id"], 0, INT32_MAX)), {}};
    id points = face[@"points"];
    if (![points isKindOfClass:[NSArray class]] || [points count] != 106)
      throw std::runtime_error("live 106 points required");
    for (size_t index = 0; index < 106; ++index) {
      id pair = points[index];
      if (![pair isKindOfClass:[NSArray class]] || [pair count] != 2)
        throw std::runtime_error("live XY pair required");
      for (size_t axis = 0; axis < 2; ++axis) {
        id number = pair[axis];
        if (!numeric(number)) throw std::runtime_error("live numeric coordinate required");
        const double value = [number doubleValue];
        if (!std::isfinite(value) || value < 0 || value > 1)
          throw std::runtime_error("live normalized coordinate required");
        item.points[index * 2 + axis] = static_cast<float>(value);
      }
    }
    response.faces.push_back(item);
  }
  return response;
}
}
