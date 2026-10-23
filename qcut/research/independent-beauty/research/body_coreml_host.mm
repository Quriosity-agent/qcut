#import <CoreML/CoreML.h>
#import <Foundation/Foundation.h>
#include <mach-o/dyld.h>
#include <cmath>
#include <cstdio>
#include <stdexcept>
#include <string>

static constexpr size_t MaxLine = 2 * 1024 * 1024;

struct IntegrityError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

static void checkIntegrity(bool value, const char *message) {
  if (!value) throw IntegrityError(message);
}

static void check(bool value, const char *message, NSError *error = nil) {
  if (!value) throw std::runtime_error(std::string(message) + ": " +
                                      (error.localizedDescription.UTF8String ?: ""));
}

static void emit(NSDictionary *message) {
  NSError *error = nil;
  NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:&error];
  check(data != nil, "cannot encode response", error);
  check(fwrite(data.bytes, 1, data.length, stdout) == data.length, "cannot write response");
  check(fputc('\n', stdout) != EOF && fflush(stdout) == 0, "cannot flush response");
}

static NSArray *systemImages() {
  NSMutableArray *images = [NSMutableArray array];
  for (uint32_t index = 0; index < _dyld_image_count(); ++index) {
    const char *raw = _dyld_get_image_name(index);
    checkIntegrity(raw != nullptr, "unnamed loaded image");
    NSString *name = [NSString stringWithUTF8String:raw];
    checkIntegrity(index == 0 || [name hasPrefix:@"/System/"] || [name hasPrefix:@"/usr/lib/"],
          "non-system library loaded");
    [images addObject:name];
  }
  return images;
}

static bool readLine(std::string &line) {
  line.clear();
  for (;;) {
    int value = fgetc(stdin);
    if (value == EOF) {
      check(line.empty(), "truncated request");
      return false;
    }
    if (value == '\n') return true;
    check(line.size() < MaxLine, "request exceeds size limit");
    line.push_back(static_cast<char>(value));
  }
}

static bool validSize(NSString *network, NSInteger height, NSInteger width) {
  if ([network isEqualToString:@"refine"]) return height == 192 && width == 144;
  return (height == 224 && (width == 128 || width == 176)) ||
         (width == 224 && (height == 128 || height == 176));
}

static NSInteger integer(NSNumber *value) {
  check([value isKindOfClass:[NSNumber class]] && CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID(),
        "integer field required");
  double number = value.doubleValue;
  check(std::isfinite(number) && number == std::trunc(number) && number >= 0 && number <= 1000000000,
        "invalid integer field");
  return value.integerValue;
}

static NSDictionary *predict(MLModel *model, NSString *network, NSString *inputName,
                             NSDictionary *channels, NSDictionary *request) {
  check(request.count == 4 && [request[@"type"] isEqual:@"predict"], "invalid request schema");
  NSInteger identifier = integer(request[@"id"]);
  NSArray *shape = request[@"shape"];
  check([shape isKindOfClass:[NSArray class]] && shape.count == 4, "NHWC shape required");
  NSInteger batch = integer(shape[0]), height = integer(shape[1]), width = integer(shape[2]);
  check(batch == 1 && integer(shape[3]) == 3 && validSize(network, height, width), "unsupported input shape");
  check([request[@"data"] isKindOfClass:[NSString class]], "base64 input required");
  NSData *data = [[NSData alloc] initWithBase64EncodedString:request[@"data"] options:0];
  check(data != nil && data.length == height * width * 3 * sizeof(float), "input byte count mismatch");
  const float *source = static_cast<const float *>(data.bytes);
  NSError *error = nil;
  MLMultiArray *array = [[MLMultiArray alloc] initWithShape:@[@1, @3, @(height), @(width)]
                                              dataType:MLMultiArrayDataTypeFloat32 error:&error];
  check(array != nil, "cannot allocate input", error);
  for (NSInteger y = 0; y < height; ++y) {
    for (NSInteger x = 0; x < width; ++x) {
      for (NSInteger c = 0; c < 3; ++c) {
        float value = source[(y * width + x) * 3 + c];
        check(std::isfinite(value), "non-finite input");
        array[(c * height + y) * width + x] = @(value);
      }
    }
  }
  MLDictionaryFeatureProvider *input = [[MLDictionaryFeatureProvider alloc]
      initWithDictionary:@{inputName: [MLFeatureValue featureValueWithMultiArray:array]} error:&error];
  check(input != nil, "cannot build input", error);
  id<MLFeatureProvider> prediction = [model predictionFromFeatures:input error:&error];
  check(prediction != nil, "CoreML prediction failed", error);
  check([prediction.featureNames isEqual:[NSSet setWithArray:channels.allKeys]], "unexpected outputs");
  NSMutableDictionary *outputs = [NSMutableDictionary dictionary];
  NSInteger outHeight = height / 8, outWidth = width / 8;
  for (NSString *name in channels) {
    NSInteger count = [channels[name] integerValue];
    MLMultiArray *result = [prediction featureValueForName:name].multiArrayValue;
    check(result != nil && [result.shape isEqual:@[@1, @(count), @(outHeight), @(outWidth)]],
          "unexpected output shape");
    NSMutableData *raw = [NSMutableData dataWithLength:outHeight * outWidth * count * sizeof(float)];
    float *target = static_cast<float *>(raw.mutableBytes);
    for (NSInteger y = 0; y < outHeight; ++y) {
      for (NSInteger x = 0; x < outWidth; ++x) {
        for (NSInteger c = 0; c < count; ++c) {
          float value = result[(c * outHeight + y) * outWidth + x].floatValue;
          check(std::isfinite(value), "non-finite output");
          target[(y * outWidth + x) * count + c] = value;
        }
      }
    }
    outputs[name] = @{@"shape": @[@1, @(outHeight), @(outWidth), @(count)],
                      @"data": [raw base64EncodedStringWithOptions:0]};
  }
  NSArray *images = systemImages();
  return @{@"type": @"result", @"id": @(identifier), @"outputs": outputs,
           @"systemLibrariesOnly": @YES, @"loadedImageCount": @(images.count)};
}

int main(int argc, char **argv) {
  @autoreleasepool {
    NSString *phase = @"initialization";
    @try {
    try {
      check(argc == 3, "usage: body-coreml-host MODEL.mlmodelc NETWORK");
      NSString *network = @(argv[2]);
      check([network isEqual:@"coarse"] || [network isEqual:@"refine"], "unknown body network");
      NSString *inputName = [network isEqual:@"coarse"] ? @"input" : @"x_1";
      NSDictionary *channels = [network isEqual:@"coarse"]
          ? @{@"heatmap_output_0": @19, @"vectormap_output_0": @38} : @{@"output_0": @34};
      MLModelConfiguration *configuration = [MLModelConfiguration new];
      configuration.computeUnits = MLComputeUnitsAll;
      NSError *error = nil;
      MLModel *model = [MLModel modelWithContentsOfURL:[NSURL fileURLWithPath:@(argv[1])]
                                       configuration:configuration error:&error];
      systemImages();
      check(model != nil, "cannot initialize CoreML model", error);
      checkIntegrity([model.modelDescription.inputDescriptionsByName.allKeys isEqual:@[inputName]], "unexpected model input");
      checkIntegrity([[NSSet setWithArray:model.modelDescription.outputDescriptionsByName.allKeys]
          isEqual:[NSSet setWithArray:channels.allKeys]], "unexpected model outputs");
      emit(@{@"type": @"ready", @"protocol": @1, @"network": network, @"inputName": inputName,
             @"computeUnits": @"All", @"loadedImages": systemImages()});
      phase = @"runtime";
      std::string line;
      while (readLine(line)) {
        @autoreleasepool {
          NSData *data = [NSData dataWithBytes:line.data() length:line.size()];
          NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
          check([request isKindOfClass:[NSDictionary class]], "invalid JSON request", error);
          emit(predict(model, network, inputName, channels, request));
        }
      }
      return 0;
    } catch (const std::exception &error) {
      NSString *kind = dynamic_cast<const IntegrityError *>(&error) ? @"integrity" : phase;
      @try { emit(@{@"type": @"fatal", @"error": @(error.what()), @"errorKind": kind}); }
      @catch (NSException *exception) { fprintf(stderr, "cannot report CoreML failure\n"); }
      return 1;
    }
    } @catch (NSException *error) {
      @try { emit(@{@"type": @"fatal", @"error": error.reason ?: @"CoreML exception", @"errorKind": phase}); }
      @catch (NSException *exception) { fprintf(stderr, "cannot report CoreML exception\n"); }
      fprintf(stderr, "%s\n", error.reason.UTF8String);
      return 1;
    }
  }
}
