#include "face_live_render_stage.h"

#include <array>
#include <cstdint>
#include <cstring>
#include <functional>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>

namespace {
void require(bool value, const std::string& context) {
  if (!value) throw std::runtime_error("render stage test failed: " + context);
}

void rejects(const std::function<void()>& call, const std::string& context) {
  try { call(); } catch (const std::exception&) { return; }
  throw std::runtime_error("render stage accepted: " + context);
}

struct Fixture {
  qcut_live::MakeupRenderStage stage;
  int feature = 0;
  int manager = 0;
  int otherFeature = 0;
  int otherManager = 0;
};

enum class Checkpoint : std::size_t {
  Fresh, Captured, Initializing, InitializationPredicted, AwaitingParameters,
  ApplyingParameters, Ready, Rendering, FinalPredicted, Complete
};

struct Step {
  const char* name;
  std::function<void(Fixture&)> call;
  const char* phase;
  bool initializing;
};

const std::array<Step, 9> steps = {{
  {"capture feature", [](Fixture& f) { f.stage.captureFeature(&f.feature); },
    "fresh", false},
  {"begin initialization", [](Fixture& f) { f.stage.beginSeek(&f.manager, 0, -1); },
    "initializing", true},
  {"initialization prediction", [](Fixture& f) { f.stage.prediction(0, 0); },
    "initializing", true},
  {"finish initialization without consumption",
    [](Fixture& f) { f.stage.finishSeek(0, true, false); }, "awaiting-parameters", false},
  {"begin parameters", [](Fixture& f) { f.stage.beginParameters(&f.feature); },
    "applying-parameters", false},
  {"end parameters", [](Fixture& f) { f.stage.endParameters(0); }, "ready", false},
  {"begin final render", [](Fixture& f) { f.stage.beginSeek(&f.manager, 0, 0); },
    "rendering", false},
  {"final prediction", [](Fixture& f) { f.stage.prediction(1, 0); }, "rendering", false},
  {"finish with publication and consumption",
    [](Fixture& f) { f.stage.finishSeek(0, true, true); }, "complete", false}
}};

std::size_t rejectedCases = 0;

void requireState(const Fixture& f, const char* phase, bool initializing,
                  const std::string& context) {
  const char* actual = f.stage.phase();
  require(actual != nullptr, context + ": null phase");
  require(std::strcmp(actual, phase) == 0,
          context + ": expected " + phase + ", got " + actual);
  require(f.stage.initializing() == initializing, context + ": initializing flag");
}

void advance(Fixture& f, Checkpoint checkpoint) {
  requireState(f, "fresh", false, "new stage");
  for (std::size_t index = 0; index < static_cast<std::size_t>(checkpoint); ++index) {
    const Step& step = steps[index];
    step.call(f);
    requireState(f, step.phase, step.initializing, step.name);
  }
}

void requireFailedClosed(Fixture& f, const std::string& context) {
  requireState(f, "failed", false, context);
  for (const Step& step : steps) {
    const std::string recovery = context + ": retry " + step.name;
    rejects([&] { step.call(f); }, recovery);
    requireState(f, "failed", false, recovery);
  }
  rejects([&] { f.stage.allowFrameOutput(); }, context + ": failed output");
  requireState(f, "failed", false, context + ": failed output remains terminal");
}

void poisonsAt(Checkpoint checkpoint, const std::function<void(Fixture&)>& call,
               const std::string& context) {
  Fixture f;
  advance(f, checkpoint);
  rejects([&] { call(f); }, context);
  requireFailedClosed(f, context);
  ++rejectedCases;
}

void testValidRuns() {
  for (bool initializationConsumed : {false, true}) {
    Fixture f;
    advance(f, Checkpoint::InitializationPredicted);
    f.stage.finishSeek(0, true, initializationConsumed);
    requireState(f, "awaiting-parameters", false, "initialization consumption is optional");
    for (std::size_t index = static_cast<std::size_t>(Checkpoint::AwaitingParameters);
         index < steps.size(); ++index) {
      const Step& step = steps[index];
      step.call(f);
      requireState(f, step.phase, step.initializing, step.name);
    }
    requireState(f, "complete", false, "repeat completed accessors");
  }
}

void testTransitionOrder() {
  for (std::size_t checkpoint = 0; checkpoint <= steps.size(); ++checkpoint) {
    for (std::size_t operation = 0; operation < steps.size(); ++operation) {
      const bool nextStep = operation == checkpoint;
      const bool consumedInitialization =
        checkpoint == static_cast<std::size_t>(Checkpoint::InitializationPredicted) &&
        operation == steps.size() - 1;
      if (nextStep || consumedInitialization) continue;
      const std::string context = std::string(steps[operation].name) + " after " +
        (checkpoint == 0 ? "construction" : steps[checkpoint - 1].name);
      poisonsAt(static_cast<Checkpoint>(checkpoint), steps[operation].call, context);
    }
  }
}

void testFeatureIdentity() {
  poisonsAt(Checkpoint::Fresh, [](Fixture& f) { f.stage.captureFeature(nullptr); },
            "null captured feature");
  for (std::size_t checkpoint = 1; checkpoint <= steps.size(); ++checkpoint) {
    poisonsAt(static_cast<Checkpoint>(checkpoint),
      [](Fixture& f) { f.stage.captureFeature(&f.otherFeature); },
      "replace captured feature at checkpoint " + std::to_string(checkpoint));
    poisonsAt(static_cast<Checkpoint>(checkpoint),
      [](Fixture& f) { f.stage.captureFeature(nullptr); },
      "clear captured feature at checkpoint " + std::to_string(checkpoint));
  }
  poisonsAt(Checkpoint::AwaitingParameters,
    [](Fixture& f) { f.stage.beginParameters(nullptr); }, "null parameter feature");
  poisonsAt(Checkpoint::AwaitingParameters,
    [](Fixture& f) { f.stage.beginParameters(&f.otherFeature); }, "different parameter feature");
  poisonsAt(Checkpoint::AwaitingParameters,
    [](Fixture& f) { f.stage.beginParameters(&f.manager); }, "manager used as parameter feature");
  for (std::uintptr_t identity : {std::uintptr_t{1}, std::uintptr_t{0x1234}}) {
    poisonsAt(Checkpoint::AwaitingParameters,
      [identity](Fixture& f) { f.stage.beginParameters(reinterpret_cast<void*>(identity)); },
      "unrelated opaque parameter feature " + std::to_string(identity));
    poisonsAt(Checkpoint::Ready,
      [identity](Fixture& f) { f.stage.beginSeek(reinterpret_cast<void*>(identity), 0, 0); },
      "unrelated opaque render manager " + std::to_string(identity));
  }
}

void testSeekArguments() {
  for (Checkpoint checkpoint : {Checkpoint::Captured, Checkpoint::Ready}) {
    const std::int64_t previous = checkpoint == Checkpoint::Captured ? -1 : 0;
    poisonsAt(checkpoint,
      [previous](Fixture& f) { f.stage.beginSeek(nullptr, 0, previous); }, "null seek manager");
    for (std::int64_t timestamp : std::array<std::int64_t, 4>{
        -1, 1, std::numeric_limits<std::int64_t>::min(),
        std::numeric_limits<std::int64_t>::max()}) {
      poisonsAt(checkpoint,
        [previous, timestamp](Fixture& f) { f.stage.beginSeek(&f.manager, timestamp, previous); },
        "nonzero seek timestamp " + std::to_string(timestamp));
    }
    for (std::int64_t prediction : std::array<std::int64_t, 7>{
        -2, -1, 0, 1, 2, std::numeric_limits<std::int64_t>::min(),
        std::numeric_limits<std::int64_t>::max()}) {
      if (prediction == previous) continue;
      poisonsAt(checkpoint,
        [prediction](Fixture& f) { f.stage.beginSeek(&f.manager, 0, prediction); },
        "wrong previous prediction " + std::to_string(prediction));
    }
  }
  poisonsAt(Checkpoint::Ready,
    [](Fixture& f) { f.stage.beginSeek(&f.otherManager, 0, 0); }, "changed final manager");
  poisonsAt(Checkpoint::Ready,
    [](Fixture& f) { f.stage.beginSeek(&f.feature, 0, 0); }, "feature used as final manager");
}

void testPredictionArguments() {
  for (Checkpoint checkpoint : {Checkpoint::Initializing, Checkpoint::Rendering}) {
    const std::int64_t expectedIndex = checkpoint == Checkpoint::Initializing ? 0 : 1;
    for (std::int64_t index : std::array<std::int64_t, 7>{
        -2, -1, 0, 1, 2, std::numeric_limits<std::int64_t>::min(),
        std::numeric_limits<std::int64_t>::max()}) {
      if (index == expectedIndex) continue;
      poisonsAt(checkpoint, [index](Fixture& f) { f.stage.prediction(index, 0); },
                "wrong prediction index " + std::to_string(index));
    }
    for (std::int64_t timestamp : std::array<std::int64_t, 4>{
        -1, 1, std::numeric_limits<std::int64_t>::min(),
        std::numeric_limits<std::int64_t>::max()}) {
      poisonsAt(checkpoint,
        [expectedIndex, timestamp](Fixture& f) { f.stage.prediction(expectedIndex, timestamp); },
        "nonzero prediction timestamp " + std::to_string(timestamp));
    }
  }
}

void testFinishRequirements() {
  for (Checkpoint checkpoint : {Checkpoint::InitializationPredicted, Checkpoint::FinalPredicted}) {
    for (int result : std::array<int, 5>{
        0, -1, 1, std::numeric_limits<int>::min(), std::numeric_limits<int>::max()}) {
      for (bool restoredPublication : {false, true}) {
        for (bool consumed : {false, true}) {
          const bool validFinish = result == 0 && restoredPublication &&
            (checkpoint == Checkpoint::InitializationPredicted || consumed);
          if (validFinish) continue;
          poisonsAt(checkpoint,
            [result, restoredPublication, consumed](Fixture& f) {
              f.stage.finishSeek(result, restoredPublication, consumed);
            }, "invalid finish result=" + std::to_string(result) +
               " publication=" + std::to_string(restoredPublication) +
               " consumed=" + std::to_string(consumed));
        }
      }
    }
  }

  for (bool initializationConsumed : {false, true}) {
    Fixture f;
    advance(f, Checkpoint::InitializationPredicted);
    f.stage.finishSeek(0, true, initializationConsumed);
    f.stage.beginParameters(&f.feature);
    f.stage.endParameters(0);
    f.stage.beginSeek(&f.manager, 0, 0);
    f.stage.prediction(1, 0);
    rejects([&] { f.stage.finishSeek(0, true, false); }, "publication is not final consumption");
    requireFailedClosed(f, "initialization cannot satisfy final consumption");
    ++rejectedCases;
  }
}

void testParameterErrors() {
  for (int result : std::array<int, 4>{
      -1, 1, std::numeric_limits<int>::min(), std::numeric_limits<int>::max()}) {
    poisonsAt(Checkpoint::ApplyingParameters,
      [result](Fixture& f) { f.stage.endParameters(result); },
      "failed parameter result " + std::to_string(result));
  }
}

void testTerminalReplay() {
  poisonsAt(Checkpoint::Complete,
    [](Fixture& f) { f.stage.beginSeek(&f.manager, 0, 1); },
    "third seek with otherwise continuous prediction history");
  for (Checkpoint checkpoint : {Checkpoint::FinalPredicted, Checkpoint::Complete}) {
    poisonsAt(checkpoint, [](Fixture& f) { f.stage.prediction(2, 0); },
              "extra prediction after final prediction");
  }
}

void testFrameOutputRequiresFinalConsumption() {
  for (std::size_t checkpoint = 0; checkpoint <= steps.size(); ++checkpoint) {
    const auto stage = static_cast<Checkpoint>(checkpoint);
    if (stage == Checkpoint::Ready || stage == Checkpoint::Complete) {
      Fixture fixture;
      advance(fixture, stage);
      require(fixture.stage.allowFrameOutput() == (stage == Checkpoint::Complete),
              "initialization output is not a final candidate frame");
      continue;
    }
    poisonsAt(stage, [](Fixture& f) { f.stage.allowFrameOutput(); },
              "output before completed stage " + std::to_string(checkpoint));
  }
}
}

int main() {
  testValidRuns();
  testTransitionOrder();
  testFeatureIdentity();
  testSeekArguments();
  testPredictionArguments();
  testFinishRequirements();
  testParameterErrors();
  testTerminalReplay();
  testFrameOutputRequiresFinalConsumption();
  std::cout << "makeup render stage: 2 valid runs and " << rejectedCases
            << " rejected cases with fail-closed retries passed (CPU only)\n";
}
