// Borrowed views are copied by the caller before another inference or cleanup.
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>

struct AlignmentTensorView {
  void *data;
  int32_t dims[4];
  int32_t raw[2];
};
static_assert(sizeof(AlignmentTensorView) == 32);

extern "C" int qcut_alignment_input(void *function, void *predictor,
                                     void *matrix, AlignmentTensorView *input,
                                     AlignmentTensorView *landmarks) {
  if (!function || !predictor || !matrix || !input || !landmarks) return -1;
  try {
    using Predict = int (*)(void *, const void *, bool);
    const int status = reinterpret_cast<Predict>(function)(predictor, matrix, false);
    if (status) return status;
    void *provider = nullptr;
    std::memcpy(&provider, static_cast<unsigned char *>(predictor) + 0x110,
                sizeof(provider));
    if (!provider) return -2;
    void **vtable = nullptr;
    std::memcpy(&vtable, provider, sizeof(vtable));
    if (!vtable || !vtable[2]) return -3;
    using Extract = AlignmentTensorView (*)(void *, const std::string &);
    const auto extract = reinterpret_cast<Extract>(vtable[2]);
    const auto *outputName = reinterpret_cast<const std::string *>(
        static_cast<unsigned char *>(predictor) + 0x48);
    if (outputName->empty() || outputName->size() > 128) return -4;
    *input = extract(provider, std::string("data"));
    *landmarks = extract(provider, *outputName);
    return input->data && landmarks->data ? 0 : -5;
  } catch (...) {
    return -6;
  }
}
