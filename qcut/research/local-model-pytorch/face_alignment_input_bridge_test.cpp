#include "face_alignment_input_bridge.mm"

#include <cstdio>
#include <stdexcept>

struct Provider {
  void **vtable;
  std::string test;
};

struct Predictor {
  unsigned char prefix[0x48]{};
  std::string outputName{"fc_landmark_s1"};
  unsigned char suffix[0x110 - 0x48 - sizeof(std::string)]{};
  void *provider{nullptr};
};
static_assert(offsetof(Predictor, outputName) == 0x48);
static_assert(offsetof(Predictor, provider) == 0x110);

std::string testCase;
int32_t tensorData{42};

int predict(void *, const void *, bool cleanup) {
  if (cleanup) return 99;
  if (testCase == "predict-standard") throw std::runtime_error("prediction");
  if (testCase == "predict-nonstandard") throw 42;
  return testCase == "native-status" ? 73 : 0;
}

AlignmentTensorView extract(void *pointer, const std::string &name) {
  const auto &test = static_cast<Provider *>(pointer)->test;
  if ((test == "extract-data" && name == "data") ||
      (test == "extract-landmarks" && name == "fc_landmark_s1")) {
    throw std::runtime_error("extraction");
  }
  return {test == "missing-data" ? nullptr : &tensorData,
          {1, 1, 1, 1}, {4, 0}};
}

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  testCase = argv[1];
  void *vtable[3]{nullptr, nullptr, reinterpret_cast<void *>(extract)};
  Provider provider{vtable, testCase};
  Predictor predictor;
  predictor.provider = &provider;
  if (testCase == "provider-null") predictor.provider = nullptr;
  if (testCase == "vtable-null") provider.vtable = nullptr;
  if (testCase == "empty-name") predictor.outputName.clear();
  if (testCase == "long-name") predictor.outputName.assign(129, 'x');
  AlignmentTensorView input{}, landmarks{};
  int matrix = 0;
  const int status = qcut_alignment_input(reinterpret_cast<void *>(predict),
      testCase == "predictor-null" ? nullptr : &predictor,
      &matrix, &input, &landmarks);
  if (status == 0 && (input.data != &tensorData || landmarks.data != &tensorData ||
                     input.dims[3] != 1 || landmarks.raw[0] != 4)) return 3;
  std::printf("%d\n", status);
  return 0;
}
