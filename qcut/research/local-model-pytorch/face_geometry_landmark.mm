// Synthetic tensor provider for the pinned SDK's landmark-ordering function.
// Only the provider is synthetic; no SDK instructions or weights are modified.
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <new>
#include <string>

struct TensorView {
  void *data;
  int32_t dims[4];
  int32_t raw[2];
};
static_assert(sizeof(TensorView) == 32);

struct MatView {
  int32_t flags, dims, rows, cols;
  void *data, *start, *end, *limit, *allocator, *owner;
  int32_t *size;
  size_t *step;
  size_t steps[2];
};
static_assert(sizeof(MatView) == 96);
static_assert(offsetof(MatView, data) == 16);

class SyntheticProvider {
 public:
  explicit SyntheticProvider(float *values) : values_(values) {}
  virtual ~SyntheticProvider() = default;
  virtual TensorView extract(const std::string &) {
    return {values_, {1, 1, 1, 212}, {4, 0}};
  }

 private:
  float *values_;
};

extern "C" int qcut_geometry_reorder(void *function, void *cleanup,
                                     float *input, float *output) {
  if (!function || !cleanup || !input || !output) return 2;
  alignas(16) std::array<unsigned char, 512> predictor{};
  std::array<float, 212> scratch{};
  auto *matrix = new (predictor.data() + 0xb0) MatView{};
  matrix->flags = 0x42ff4005;
  matrix->dims = 2;
  matrix->rows = 2;
  matrix->cols = 106;
  matrix->data = matrix->start = scratch.data();
  matrix->end = matrix->limit = scratch.data() + scratch.size();
  matrix->size = &matrix->rows;
  matrix->step = matrix->steps;
  matrix->steps[0] = 106 * sizeof(float);
  matrix->steps[1] = sizeof(float);
  SyntheticProvider provider(input);
  void *providerPointer = &provider;
  std::memcpy(predictor.data() + 0x110, &providerPointer, sizeof(providerPointer));
  using GetLandmark = MatView (*)(void *);
  using DestroyMat = void (*)(void *);
  const auto get = reinterpret_cast<GetLandmark>(function);
  const auto destroy = reinterpret_cast<DestroyMat>(cleanup);
  MatView result = get(predictor.data());
  const bool valid = result.rows == 2 && result.cols == 106 && result.data &&
                     (result.flags & 0xfff) == 5 && result.steps[0] >= 106 * sizeof(float);
  if (valid) {
    const auto *x = static_cast<const float *>(result.data);
    const auto *y = reinterpret_cast<const float *>(
        static_cast<const unsigned char *>(result.data) + result.steps[0]);
    for (size_t index = 0; index < 106; ++index) {
      output[index * 2] = x[index];
      output[index * 2 + 1] = y[index];
    }
  }
  destroy(&result);
  return valid ? 0 : 3;
}
