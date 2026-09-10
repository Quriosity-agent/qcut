#pragma once

#include "merge_util.hpp"
#include "native_identity.hpp"

#include <array>
#include <cstdint>
#include <cstring>
#include <vector>

#if !defined(_LIBCPP_VERSION)
#error "The fixed native object ABI requires Apple libc++"
#endif

namespace lens_contract::diagnostic {

inline constexpr char merge_anchor[] =
    "_ZN4LENS9ALGORITHM7MoveSys4Util10Rigid2LockERNS1_5RigidEffff";
inline constexpr std::uintptr_t merge_anchor_vm = 0x967f8;
inline constexpr std::uintptr_t setting_info_constructor_vm = 0x1126d8;
inline constexpr std::uintptr_t vector_index_vm = 0x94ff4;
inline constexpr std::size_t setting_info_size = 0x44;
inline constexpr std::size_t setting_info_offset = 0x2b8;
inline constexpr std::size_t pipeline_size = 0x330;

// Same 0xa5 sentinel discipline as MotionStorage, but this one also reports
// how far the writes actually reached, so the 816-byte pipeline and the
// 0x44-byte SettingInfo are measured rather than assumed. Both objects start
// from the same fill, which is why the two padding runs inside SettingInfo
// (+0x19..+0x1b and +0x32..+0x33, written by neither constructor) compare
// equal below; a native write into them would trip the comparison, not hide.
template <std::size_t Capacity> class PipelineStorage {
 public:
  PipelineStorage() { bytes_.fill(0xa5); }
  void* data() { return bytes_.data() + 64; }
  const void* data() const { return bytes_.data() + 64; }
  std::size_t written_extent() const {
    std::size_t extent = 0;
    for (std::size_t index = 0; index < Capacity; ++index) {
      if (bytes_[64 + index] != 0xa5) extent = index + 1;
    }
    return extent;
  }
  void guards() const {
    for (std::size_t index = 0; index < bytes_.size(); ++index) {
      if (index < 64 || index >= 64 + Capacity) {
        require(bytes_[index] == 0xa5, "Native pipeline object exceeded allocation");
      }
    }
  }

 private:
  alignas(16) std::array<std::uint8_t, Capacity + 128> bytes_{};
};

using SettingImage = std::array<std::uint8_t, setting_info_size>;

// Everything here goes through a real factory: SmartMotionPipeline's exported
// constructor builds the SettingInfo at +0x2b8, and its exported init writes
// the frame size into it. The only bytes this code writes into a native object
// are the two int32 scalars the config exposes at +0x8/+0xc, and the read-back
// gate below proves the library read them as width and height.
class NativeMergeUtil {
 public:
  using Merge = std::vector<float> (*)(std::vector<float>&, std::vector<float>&, const void*);

  explicit NativeMergeUtil(const Oracle& oracle)
      : construct_(oracle.symbol<void (*)(void*)>(
            "_ZN4LENS9ALGORITHM19SmartMotionPipelineC1Ev")),
        destroy_(oracle.symbol<void (*)(void*)>(
            "_ZN4LENS9ALGORITHM19SmartMotionPipelineD1Ev")),
        initialize_(oracle.symbol<bool (*)(void*, void*)>(
            "_ZN4LENS9ALGORITHM19SmartMotionPipeline4initEPNS0_24lens_smart_motion_configE")),
        merge_(oracle.symbol<Merge>(
            "_ZN4LENS9ALGORITHM7MoveSys9MergeUtilERNSt3__16vectorIfNS2_9allocatorIfEEEES7_RKNS1_"
            "11SettingInfoE")),
        construct_settings_(oracle.offset<void (*)(void*)>(merge_anchor, merge_anchor_vm,
                                                           setting_info_constructor_vm)),
        index_(oracle.offset<float* (*)(void*, std::size_t)>(merge_anchor, merge_anchor_vm,
                                                             vector_index_vm)) {
    // The vendor image and this diagnostic must agree on std::vector<float>
    // before any result is compared; liblens links /usr/lib/libc++.1.dylib.
    std::vector<float> probe{0.0F, 1.0F, 2.0F, 3.0F};
    require(index_(&probe, 0) == probe.data() &&
                index_(&probe, merge_vector_length - 1) == probe.data() + 3,
            "Native std::vector<float> layout differs");

    PipelineStorage<2 * setting_info_size> reference;
    construct_settings_(reference.data());
    reference.guards();
    require(reference.written_extent() == setting_info_size,
            "SettingInfo default constructor wrote an unexpected extent");
    std::memcpy(default_settings_.data(), reference.data(), default_settings_.size());

    construct_(host_.data());
    host_.guards();
    require(host_.written_extent() == pipeline_size, "SmartMotionPipeline size differs");
    try {
      construct_(config_.data());
      config_.guards();
      require(config_.written_extent() == pipeline_size, "SmartMotionPipeline size differs");
    } catch (...) {
      destroy_(host_.data());
      throw;
    }
    constructed_ = true;
  }

  ~NativeMergeUtil() {
    if (constructed_) {
      destroy_(config_.data());
      destroy_(host_.data());
    }
  }
  NativeMergeUtil(const NativeMergeUtil&) = delete;
  NativeMergeUtil& operator=(const NativeMergeUtil&) = delete;

  // The config member sits at pipeline+0 (init's first act is
  // lens_smart_motion_config::operator= on `this`), and 0x10f488-0x10f4ac
  // converts its +0x8/+0xc int32 pair with scvtf into SettingInfo width and
  // height. Re-initialising the same pipeline is supported: init calls deinit
  // first when the object is already initialised.
  void configure(int width, int height) {
    auto* config = static_cast<std::uint8_t*>(config_.data());
    const std::int32_t requested_width = width;
    const std::int32_t requested_height = height;
    std::memcpy(config + 0x8, &requested_width, sizeof(requested_width));
    std::memcpy(config + 0xc, &requested_height, sizeof(requested_height));
    require(initialize_(host_.data(), config_.data()),
            "SmartMotionPipeline::init refused the frame size");
    host_.guards();
    config_.guards();
    std::memcpy(expected_settings_.data(), settings(), expected_settings_.size());

    // Read-back gate. init does NOT touch only two fields: it copies the whole
    // record out of the config, and the config's own defaults for +0x08/+0x0c
    // differ from SettingInfo's default constructor. What is asserted is what
    // MergeUtil actually reads: +0x00 and +0x04 are exactly the requested
    // extents, +0x10 is untouched, and so is every byte after it.
    const float expected_width = static_cast<float>(width);
    const float expected_height = static_cast<float>(height);
    require(std::memcmp(expected_settings_.data(), &expected_width, sizeof(float)) == 0 &&
                std::memcmp(expected_settings_.data() + 4, &expected_height, sizeof(float)) == 0,
            "SettingInfo did not read back the configured frame size");
    require(std::memcmp(expected_settings_.data() + 0x10, default_settings_.data() + 0x10,
                        setting_info_size - 0x10) == 0,
            "init changed a SettingInfo field at or after +0x10");
    static constexpr std::array<std::uint32_t, 2> config_derived{0x3e4ccccdU, 0x3f19999aU};
    std::array<std::uint32_t, 2> observed{};
    std::memcpy(observed.data(), expected_settings_.data() + 8, sizeof(observed));
    require(observed == config_derived, "config-derived SettingInfo fields changed");
    configured_ = true;
  }

  std::vector<float> run(std::vector<float>& current, std::vector<float>& box) {
    require(configured_, "MergeUtil called before the frame size was configured");
    settings_unchanged();
    const std::vector<float> current_before = current;
    const std::vector<float> box_before = box;
    std::vector<float> result = merge_(current, box, settings());
    host_.guards();
    config_.guards();
    settings_unchanged();
    require(current == current_before && box == box_before,
            "Native MergeUtil modified one of its input vectors");
    require(result.size() == merge_vector_length,
            "Native MergeUtil returned an unexpected element count");
    return result;
  }

  const SettingImage& settings_image() const { return expected_settings_; }
  const SettingImage& default_settings_image() const { return default_settings_; }

 private:
  const void* settings() const {
    return static_cast<const std::uint8_t*>(host_.data()) + setting_info_offset;
  }
  void settings_unchanged() const {
    require(std::memcmp(settings(), expected_settings_.data(), expected_settings_.size()) == 0,
            "Native SettingInfo changed between calls");
  }

  void (*construct_)(void*);
  void (*destroy_)(void*);
  bool (*initialize_)(void*, void*);
  Merge merge_;
  void (*construct_settings_)(void*);
  float* (*index_)(void*, std::size_t);
  PipelineStorage<2 * pipeline_size> host_;
  PipelineStorage<2 * pipeline_size> config_;
  SettingImage default_settings_{};
  SettingImage expected_settings_{};
  bool constructed_ = false;
  bool configured_ = false;
};

}  // namespace lens_contract::diagnostic
