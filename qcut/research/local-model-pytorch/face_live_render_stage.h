#pragma once
#include <cstdint>
#include <stdexcept>

namespace qcut_live {
class MakeupRenderStage {
 public:
  void captureFeature(void* feature) {
    check(state_ == State::Fresh && !feature_ && feature, "fresh makeup feature required");
    feature_ = feature;
  }

  void beginSeek(void* manager, int64_t timestamp, int64_t previousPrediction) {
    const bool first = state_ == State::Fresh;
    check(feature_ && manager && timestamp == 0 &&
          ((first && previousPrediction == -1) ||
           (state_ == State::Ready && manager == manager_ && previousPrediction == 0)),
          "makeup seek outside ordered single-frame stages");
    manager_ = manager;
    predictionSeen_ = false;
    state_ = first ? State::Initializing : State::Rendering;
  }

  void prediction(int64_t index, int64_t timestamp) {
    check((initializing() || state_ == State::Rendering) && !predictionSeen_ &&
          timestamp == 0 && index == (initializing() ? 0 : 1),
          "makeup stage requires one fresh associated prediction");
    predictionSeen_ = true;
  }

  void finishSeek(int nativeResult, bool restoredPublication, bool consumed) {
    check((initializing() || state_ == State::Rendering) && predictionSeen_ &&
          nativeResult == 0 && restoredPublication, "makeup stage lacks successful restored publication");
    check(initializing() || consumed, "makeup final rendering lacks landmark consumption");
    state_ = initializing() ? State::AwaitingParameters : State::Complete;
  }

  void beginParameters(void* feature) {
    check(state_ == State::AwaitingParameters && feature == feature_,
          "makeup parameters outside initialized feature scope");
    state_ = State::ApplyingParameters;
  }

  void endParameters(int result) {
    check(state_ == State::ApplyingParameters && result == 0,
          "makeup parameters were not successfully applied");
    state_ = State::Ready;
  }

  bool allowFrameOutput() {
    check(state_ == State::Ready || state_ == State::Complete,
          "makeup output outside completed render stage");
    return state_ == State::Complete;
  }

  bool initializing() const { return state_ == State::Initializing; }

  const char* phase() const {
    constexpr const char* names[] = {"fresh", "initializing", "awaiting-parameters", "applying-parameters",
                                   "ready", "rendering", "complete", "failed"};
    return names[static_cast<unsigned>(state_)];
  }

 private:
  enum class State { Fresh, Initializing, AwaitingParameters, ApplyingParameters, Ready, Rendering, Complete, Failed };
  void check(bool condition, const char* message) {
    if (state_ != State::Failed && condition) return;
    state_ = State::Failed;
    throw std::runtime_error(message);
  }
  State state_ = State::Fresh;
  void* feature_ = nullptr;
  void* manager_ = nullptr;
  bool predictionSeen_ = false;
};
}
