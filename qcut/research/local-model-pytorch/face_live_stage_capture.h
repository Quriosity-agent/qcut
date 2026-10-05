#pragma once
// Private diagnostic sink only; native coordinates never enter the worker packet.

NSString* stageDigest(const void* bytes, size_t count) {
  if (count > 16 * 1024 * 1024) throw std::runtime_error("stage digest exceeds bound");
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(bytes, static_cast<CC_LONG>(count), digest);
  char result[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  for (size_t index = 0; index < CC_SHA256_DIGEST_LENGTH; ++index)
    snprintf(result + index * 2, 3, "%02x", digest[index]);
  return @(result);
}

void captureLiveStages(uintptr_t owner, size_t index, int width, int height, int64_t timestamp,
                       const std::vector<unsigned char>& pixels, const char* token) {
  const char* directory = std::getenv("QCUT_FACE_LIVE_STAGE_DIR");
  if (!directory) return;
  if (!*directory || directory[0] != '/' || index > 1 || timestamp != 0)
    throw std::runtime_error("stage diagnostics require explicit cold single-frame directory");
  const auto begin = read<uintptr_t>(owner + 0x7c00);
  NSMutableArray* faces = [NSMutableArray array];
  for (size_t slot = 0; slot < 10; ++slot) {
    const auto record = begin + slot * 400;
    if (!(read<uint8_t>(record + 8) & 1)) continue;
    const auto object = read<uintptr_t>(record);
    NSDictionary* geometry = alignment(object, slot);
    if (!geometry) throw std::runtime_error("stage diagnostics require initialized alignment");
    NSMutableDictionary* face = [geometry mutableCopy];
    face[@"id"] = @(read<int>(record + 0xc));
    face[@"published"] = publishedPoints(record);
    face[@"filters"] = @[filterState(object + 0x10, 33), filterState(object + 0x110, 73)];
    [faces addObject:face];
  }
  if (faces.count != 1) throw std::runtime_error("stage diagnostics require exactly one face");
  NSDictionary* snapshot = @{@"schema":@"face-live-native-stages-v1", @"pid":@(getpid()),
    @"prediction":@(index), @"timestamp_us":@(timestamp), @"owner":@(owner),
    @"token_sha256":stageDigest(token, std::strlen(token)),
    @"width":@(width), @"height":@(height), @"algorithm_rgba_sha256":stageDigest(pixels.data(), pixels.size()),
    @"runtime_state":runtimeState(owner), @"faces":faces,
    @"observation":@"post-native-predict-before-worker", @"native_points_sent_to_worker":@NO,
    @"product_parity_verified":@NO};
  NSError* error = nil;
  NSData* encoded = [NSJSONSerialization dataWithJSONObject:snapshot options:0 error:&error];
  NSString* path = [@(directory) stringByAppendingPathComponent:
    [NSString stringWithFormat:@"native-%zu.json", index]];
  if (!encoded || ![encoded writeToFile:path options:NSDataWritingWithoutOverwriting error:&error])
    throw std::runtime_error("cannot exclusively write native stage diagnostic");
}
