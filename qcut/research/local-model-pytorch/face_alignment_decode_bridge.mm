// Copy original Stage1 results before another inference invalidates borrowed views.
#include <cstddef>
#include <cstdint>
#include <cstring>
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

extern "C" int qcut_alignment_decode(void *function, void *cleanup,
                                      void *predictor, TensorView *input,
                                      TensorView *raw, float *decoded) {
  if (!function || !cleanup || !predictor || !input || !raw || !decoded) return 1;
  try {
    void *provider = nullptr;
    std::memcpy(&provider, static_cast<unsigned char *>(predictor) + 0x110,
                sizeof(provider));
    if (!provider) return 2;
    void **vtable = nullptr;
    std::memcpy(&vtable, provider, sizeof(vtable));
    if (!vtable || !vtable[2]) return 3;
    const auto *name = reinterpret_cast<const std::string *>(
        static_cast<unsigned char *>(predictor) + 0x48);
    if (name->empty() || name->size() > 128) return 4;
    using Extract = TensorView (*)(void *, const std::string &);
    const auto extract = reinterpret_cast<Extract>(vtable[2]);
    *input = extract(provider, std::string("data"));
    *raw = extract(provider, *name);
    if (!input->data || !raw->data) return 5;
    using GetLandmark = MatView (*)(void *);
    using DestroyMat = void (*)(void *);
    MatView result = reinterpret_cast<GetLandmark>(function)(predictor);
    const bool valid = result.dims == 2 && result.rows == 2 && result.cols == 106 &&
                       result.data && (result.flags & 0xfff) == 5 &&
                       result.steps[0] >= 106 * sizeof(float) && result.steps[0] <= 4096;
    if (valid) {
      const auto *x = static_cast<const float *>(result.data);
      const auto *y = reinterpret_cast<const float *>(
          static_cast<const unsigned char *>(result.data) + result.steps[0]);
      for (size_t index = 0; index < 106; ++index) {
        decoded[index * 2] = x[index];
        decoded[index * 2 + 1] = y[index];
      }
    }
    reinterpret_cast<DestroyMat>(cleanup)(&result);
    return valid ? 0 : 6;
  } catch (...) {
    return 7;
  }
}
