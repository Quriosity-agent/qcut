#import <CoreML/CoreML.h>
#import <Foundation/Foundation.h>
#include <fstream>
#include <stdexcept>
#include <vector>

static void check(bool ok, const char *message, NSError *error = nil) {
  if (!ok) {
    throw std::runtime_error(std::string(message) + ": " +
                             (error.localizedDescription.UTF8String ?: ""));
  }
}

int main(int argc, char **argv) {
  @autoreleasepool {
    try {
      check(argc == 4, "usage: coreml-oracle MODEL.mlmodelc REQUEST.json OUTPUT_DIR");
      NSError *error = nil;
      NSData *requestData = [NSData dataWithContentsOfFile:@(argv[2])];
      check(requestData != nil, "cannot read request");
      NSDictionary *request = [NSJSONSerialization JSONObjectWithData:requestData options:0 error:&error];
      check(request != nil, "invalid request", error);
      MLModelConfiguration *config = [MLModelConfiguration new];
      config.computeUnits = MLComputeUnitsCPUOnly;
      MLModel *model = [MLModel modelWithContentsOfURL:[NSURL fileURLWithPath:@(argv[1])]
                                       configuration:config error:&error];
      check(model != nil, "cannot load CoreML", error);
      NSMutableDictionary *features = [NSMutableDictionary dictionary];
      for (NSString *name in request) {
        NSDictionary *entry = request[name];
        MLMultiArray *array = [[MLMultiArray alloc] initWithShape:entry[@"shape"]
                                  dataType:MLMultiArrayDataTypeFloat32 error:&error];
        check(array != nil, "cannot allocate tensor", error);
        NSData *raw = [NSData dataWithContentsOfFile:entry[@"path"]];
        check(raw != nil && raw.length == array.count * sizeof(float), "input size mismatch");
        const float *values = static_cast<const float *>(raw.bytes);
        for (NSInteger i = 0; i < array.count; i++) array[i] = @(values[i]);
        features[name] = [MLFeatureValue featureValueWithMultiArray:array];
      }
      MLDictionaryFeatureProvider *input = [[MLDictionaryFeatureProvider alloc]
                                             initWithDictionary:features error:&error];
      check(input != nil, "cannot build features", error);
      id<MLFeatureProvider> result = [model predictionFromFeatures:input error:&error];
      check(result != nil, "CoreML prediction failed", error);
      NSMutableDictionary *outputs = [NSMutableDictionary dictionary];
      NSInteger index = 0;
      for (NSString *name in result.featureNames) {
        MLMultiArray *array = [result featureValueForName:name].multiArrayValue;
        check(array != nil, "output is not a tensor");
        std::vector<float> values(array.count);
        for (NSInteger i = 0; i < array.count; i++) values[i] = array[i].floatValue;
        NSString *path = [@(argv[3]) stringByAppendingPathComponent:
                         [NSString stringWithFormat:@"output-%ld.f32", (long)index++]];
        NSData *raw = [NSData dataWithBytes:values.data() length:values.size() * sizeof(float)];
        check([raw writeToFile:path atomically:YES], "cannot write tensor");
        outputs[name] = @{@"path": path, @"shape": array.shape};
      }
      NSData *json = [NSJSONSerialization dataWithJSONObject:outputs options:NSJSONWritingPrettyPrinted error:&error];
      check(json != nil, "cannot encode outputs", error);
      check([json writeToFile:[@(argv[3]) stringByAppendingPathComponent:@"outputs.json"] atomically:YES], "cannot write outputs");
      return 0;
    } catch (const std::exception &error) {
      fprintf(stderr, "%s\n", error.what());
      return 1;
    }
  }
}
