// Version-pinned, read-only ABI bridge; tensors and frames remain caller-owned.
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

struct TensorView {
  void *data;
  int32_t dims[4];
  int32_t raw[2];
};
struct Box { float left, top, right, bottom, score; };
struct Rect { float x, y, width, height; };
static_assert(sizeof(TensorView) == 32);
static_assert(sizeof(Box) == 20);
static_assert(sizeof(std::vector<Box>) == 24);

template <typename T> T read(void *object, size_t offset) {
  T value;
  std::memcpy(&value, static_cast<unsigned char *>(object) + offset, sizeof(T));
  return value;
}

extern "C" int qcut_detector_decode(void *function, void *layer,
                                    TensorView *reg, TensorView *cls,
                                    int width, int height, Box *output, int capacity) {
  if (!function || !layer || !reg || !cls || !output || capacity < 200) return -1;
  std::vector<TensorView *> regressions, scores;
  for (int index = 0; index < 3; ++index) {
    regressions.push_back(reg + index);
    scores.push_back(cls + index);
  }
  using Decode = std::vector<Box> (*)(void *, std::vector<TensorView *> &,
                                    std::vector<TensorView *> &, int, int);
  auto boxes = reinterpret_cast<Decode>(function)(layer, regressions, scores, width, height);
  if (boxes.size() > static_cast<size_t>(capacity)) return -2;
  std::copy(boxes.begin(), boxes.end(), output);
  return static_cast<int>(boxes.size());
}

extern "C" int qcut_detector_heads(void *function, void *detector, TensorView *output) {
  if (!function || !detector || !output) return -1;
  auto *reg = reinterpret_cast<std::vector<std::string> *>(
      static_cast<unsigned char *>(detector) + 0xa0);
  auto *cls = reinterpret_cast<std::vector<std::string> *>(
      static_cast<unsigned char *>(detector) + 0xb8);
  void *predictor = read<void *>(detector, 0xe8);
  if (reg->size() != 3 || cls->size() != 3 || !predictor) return -2;
  using Extract = TensorView (*)(void *, const std::string &);
  auto extract = reinterpret_cast<Extract>(function);
  for (int index = 0; index < 3; ++index) {
    output[index] = extract(predictor, (*reg)[index]);
    output[index + 3] = extract(predictor, (*cls)[index]);
  }
  return 0;
}

extern "C" int qcut_detector_detect(void *function, void *detector, void *matrix,
                                    Rect *output, float *scores, int capacity) {
  if (!function || !detector || !matrix || !output || !scores || capacity < 200) return -1;
  std::vector<Rect> boxes;
  std::vector<int> flags;
  std::vector<float> confidence;
  // The nontrivial by-value Mat parameter is passed indirectly on this ABI.
  using Detect = int (*)(void *, void *, std::vector<Rect> &,
                        std::vector<int> &, std::vector<float> &);
  int status = reinterpret_cast<Detect>(function)(detector, matrix, boxes, flags, confidence);
  if (status || boxes.size() != confidence.size() || boxes.size() > static_cast<size_t>(capacity)) return -2;
  std::copy(boxes.begin(), boxes.end(), output);
  std::copy(confidence.begin(), confidence.end(), scores);
  return static_cast<int>(boxes.size());
}

extern "C" int qcut_detector_names(void *detector, char *output, int capacity) {
  if (!detector || !output || capacity < 2048) return -1;
  std::string joined;
  for (size_t offset : {size_t(0xa0), size_t(0xb8)}) {
    const auto *names = reinterpret_cast<std::vector<std::string> *>(
        static_cast<unsigned char *>(detector) + offset);
    if (names->size() != 3) return -2;
    for (const auto &name : *names) {
      if (name.empty() || name.size() > 128 || name.find('\n') != std::string::npos) return -3;
      joined += name + '\n';
    }
  }
  const auto *type = reinterpret_cast<std::string *>(
      static_cast<unsigned char *>(detector) + 0x108);
  if (type->empty() || type->size() > 128) return -4;
  joined += *type;
  if (joined.size() >= static_cast<size_t>(capacity)) return -5;
  std::memcpy(output, joined.c_str(), joined.size() + 1);
  return 0;
}

extern "C" int qcut_detector_nms(void *function, Box *input, int count,
                                 int before, int after, float threshold, Box *output) {
  if (!function || !input || !output || count < 0 || count > 20000 || before < 1 || after < 1) return -1;
  std::vector<Box> boxes(input, input + count);
  using Nms = void (*)(std::vector<Box> &, int, int, float);
  reinterpret_cast<Nms>(function)(boxes, before, after, threshold);
  std::copy(boxes.begin(), boxes.end(), output);
  return static_cast<int>(boxes.size());
}
