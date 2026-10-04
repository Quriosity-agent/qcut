#define QCUT_FACE_LIVE_LIFECYCLE_TEST
#include "face_live_bridge_host.mm"
#include <array>
#include <iostream>
#include <string>
#include <vector>

namespace {
void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

template <typename Call>
void rejects(Call call, const char* expected) {
  try {
    call();
  } catch (const std::exception& error) {
    require(std::string(error.what()).find(expected) != std::string::npos,
            "wrong lifecycle rejection");
    return;
  }
  throw std::runtime_error("missing lifecycle rejection");
}

struct Graph { void* raw = nullptr; };
struct Receipt { int64_t prediction; uint64_t binding; uint64_t graph; bool converted; };

struct Fixture {
  int source = 1;
  int clone = 2;
  int replacement = 3;
  int sourceReleases = 0;
  int fences = 0;
  int restores = 0;
  std::vector<Receipt> receipts;
  qcut_live::CloneLeaseScope scope;

  explicit Fixture(bool cold = false) : scope(cold) {}

  void bind(Graph& graph, bool converted = true) {
    graph.raw = &source;
    scope.reserve(&graph, &clone, std::shared_ptr<void>(&source, [&](void*) { ++sourceReleases; }));
    graph.raw = &clone;
    scope.published(&graph);
    if (converted) scope.converted(&graph);
  }

  bool finish(bool fenceFails = false, bool restoreFails = false) {
    return scope.finish([&] {
      ++fences;
      require(sourceReleases == 0, "source released before completion");
      if (fenceFails) throw std::runtime_error("test fence failed");
    }, [](void* graph) { return static_cast<Graph*>(graph)->raw; },
    [&](void* graph, void* original) {
      require(fences > 0, "restoration preceded fence");
      ++restores;
      if (!restoreFails) static_cast<Graph*>(graph)->raw = original;
    }, [&](const qcut_live::CloneLease& lease) {
      require(static_cast<Graph*>(lease.graph)->raw == lease.source.get(), "false restoration receipt");
      receipts.push_back({lease.prediction, lease.bindingId, lease.graphId, lease.converted});
    });
  }
};

void inspectionCannotLease() {
  Fixture fixture;
  Graph graph;
  require(!fixture.scope.injecting(), "scope initially open");
  for (int64_t prediction : {0, 1}) {
    fixture.scope.begin(prediction, 0);
    require(fixture.scope.injecting(), "prediction did not open scope");
    require(fixture.finish(), "first finish did not close scope");
    require(!fixture.scope.injecting(), "inspection can inject after finish");
    rejects([&] { fixture.scope.requireGraph(&graph); }, "outside prediction scope");
    require(!fixture.scope.consumed(), "inspection claimed consumption");
    fixture.scope.validateConsumption();
  }
  fixture.scope.begin(2, 0);
  fixture.bind(graph);
  fixture.finish();
  require(fixture.receipts.size() == 1 && fixture.receipts[0].prediction == 2,
          "bootstrap inspection leaked a receipt or lease");
  require(fixture.sourceReleases == 1, "source lease leaked after restoration");
}

void perGraphLeasesAndIdempotence() {
  Fixture fixture;
  Graph first, second;
  fixture.scope.begin(2, 17000);
  fixture.bind(first);
  rejects([&] { fixture.scope.requireGraph(&first); }, "duplicate live graph");
  fixture.bind(second);
  rejects([&] { fixture.scope.begin(3, 17000); }, "undrained graph leases");
  fixture.finish();
  require(fixture.fences == 1 && fixture.restores == 2 && fixture.sourceReleases == 2,
          "per-graph restoration or retention incorrect");
  require(fixture.receipts.size() == 2, "missing graph restoration receipts");
  for (const auto& receipt : fixture.receipts) {
    require(receipt.prediction == 2 && receipt.converted, "receipt attributed to wrong prediction");
  }
  require(fixture.receipts[0].binding != fixture.receipts[1].binding &&
          fixture.receipts[0].graph != fixture.receipts[1].graph, "ambiguous lease receipts");
  require(!fixture.finish() && fixture.fences == 1 && fixture.receipts.size() == 2,
          "catch-path cleanup replayed a receipt or fence");
  fixture.scope.begin(3, 17000);
  fixture.sourceReleases = 0;
  fixture.bind(first);
  fixture.finish();
  require(fixture.receipts.back().prediction == 3 && fixture.receipts.back().binding == 3,
          "next prediction reused a binding receipt");
}

void overwrittenSlotFailsClosed() {
  Fixture fixture;
  Graph graph;
  fixture.scope.begin(2, 0);
  fixture.bind(graph);
  graph.raw = &fixture.replacement;
  rejects([&] { fixture.finish(); }, "clone overwritten");
  require(graph.raw == &fixture.replacement && fixture.restores == 0 && fixture.receipts.empty(),
          "superseding native result overwritten or falsely acknowledged");
  require(fixture.sourceReleases == 0 && !fixture.scope.injecting(), "failed lease released or left open");
  require(!fixture.finish() && fixture.fences == 1, "failed cleanup was not idempotent");
  rejects([&] { fixture.scope.begin(3, 0); }, "clone overwritten");
}

void fenceFailureRetainsOwners() {
  Fixture fixture;
  Graph graph;
  fixture.scope.begin(2, 0);
  fixture.bind(graph);
  rejects([&] { fixture.finish(true); }, "test fence failed");
  require(graph.raw == &fixture.clone && fixture.sourceReleases == 0 && fixture.receipts.empty(),
          "uncompleted GPU lease was restored or released");
  require(!fixture.finish() && fixture.fences == 1, "fence failure was retried from catch");
  rejects([&] { fixture.scope.begin(3, 0); }, "test fence failed");
}

void restorationFailureIsNotSuccess() {
  Fixture fixture;
  Graph graph;
  fixture.scope.begin(2, 0);
  fixture.bind(graph);
  rejects([&] { fixture.finish(false, true); }, "source restoration failed");
  require(fixture.receipts.empty() && fixture.sourceReleases == 0, "failed restoration emitted success");
  rejects([&] { fixture.scope.begin(3, 0); }, "source restoration failed");
}

void failedConversionRollsBackAfterFence() {
  Fixture fixture;
  Graph graph;
  fixture.scope.begin(2, 0);
  fixture.bind(graph, false);
  fixture.finish();
  require(fixture.receipts.size() == 1 && !fixture.receipts[0].converted,
          "failed conversion masqueraded as a consumed frame");
  require(fixture.restores == 1 && fixture.fences == 1 && !fixture.scope.consumed(),
          "conversion rollback lost the fence or claimed consumption");
  rejects([&] { fixture.scope.begin(3, 0); }, "unconsumed predecessor");
}

void unpublishedLeaseAndMissingConsumer() {
  Fixture fixture;
  Graph graph{&fixture.source};
  fixture.scope.begin(2, 0);
  fixture.scope.reserve(&graph, &fixture.clone,
      std::shared_ptr<void>(&fixture.source, [&](void*) { ++fixture.sourceReleases; }));
  rejects([&] { fixture.scope.converted(&graph); }, "unique published lease");
  fixture.finish();
  require(fixture.restores == 0 && fixture.sourceReleases == 1 && !fixture.scope.consumed(),
          "unpublished lease was treated as a rendered clone");
  rejects([&] { fixture.scope.begin(3, 0); }, "unconsumed predecessor");
}

void independentGraphsDrainOnFailure() {
  Fixture fixture;
  Graph first, second;
  fixture.scope.begin(2, 0);
  fixture.bind(first);
  fixture.bind(second);
  first.raw = &fixture.replacement;
  rejects([&] { fixture.finish(); }, "clone overwritten");
  require(second.raw == &fixture.source && fixture.receipts.size() == 1 && fixture.sourceReleases == 1,
          "one bad graph prevented independent lease restoration");
}

void boundedGraphsAndDuplicateConsumption() {
  Fixture fixture;
  std::array<Graph, 11> graphs;
  fixture.scope.begin(2, 0);
  for (size_t index = 0; index < 10; ++index) fixture.bind(graphs[index]);
  rejects([&] { fixture.scope.requireGraph(&graphs[10]); }, "bounded live graph");
  rejects([&] { fixture.scope.converted(&graphs[0]); }, "unique published lease");
  fixture.finish();
  require(fixture.sourceReleases == 10 && fixture.receipts.size() == 10,
          "bounded graph leases were not all drained");
}

void coldPredictionsHaveNoBootstrapExemption() {
  Fixture fixture(true);
  rejects([&] { fixture.scope.validateConsumption(); }, "missing or not consumed");
  fixture.scope.begin(0, 0);
  require(fixture.scope.requiresConsumption(), "cold prediction zero was exempted");
  fixture.finish();
  rejects([&] { fixture.scope.validateConsumption(); }, "missing or not consumed");
  rejects([&] { fixture.scope.begin(1, 0); }, "unconsumed predecessor");
  require(fixture.receipts.empty() && fixture.fences == 0,
          "cold inspection fabricated consumption or a fence");
}

void coldFirstTwoPredictionsRestoreRealLeases() {
  Fixture fixture(true);
  Graph graph;
  for (int64_t prediction : {0, 1}) {
    fixture.sourceReleases = 0;
    fixture.scope.begin(prediction, 0);
    fixture.bind(graph);
    fixture.finish();
    fixture.scope.validateConsumption();
    require(!fixture.scope.injecting(), "cold inspection could inject");
    rejects([&] { fixture.scope.requireGraph(&graph); }, "outside prediction scope");
    require(fixture.receipts.back().prediction == prediction &&
            fixture.receipts.back().converted && graph.raw == &fixture.source,
            "cold bootstrap lost its actual conversion/restoration receipt");
  }
  require(fixture.receipts.size() == 2 && fixture.fences == 2,
          "cold predictions did not complete independently");
}

void coldPublicationAloneDoesNotConsume() {
  Fixture fixture(true);
  Graph graph;
  fixture.scope.begin(0, 0);
  fixture.bind(graph, false);
  fixture.finish();
  rejects([&] { fixture.scope.validateConsumption(); }, "missing or not consumed");
  rejects([&] { fixture.scope.begin(1, 0); }, "unconsumed predecessor");
  require(fixture.receipts.size() == 1 && !fixture.receipts.front().converted,
          "cold publication counted as native consumption");
}

void coldSetupWaitsForWorkerAndRunsOnce() {
  qcut_live::DeferredColdSetup setup;
  int manager = 0, installs = 0;
  bool algorithmsReady = false;
  setup.prepare(&manager);
  require(setup.active() && installs == 0, "pre-seek touched uncreated algorithms");
  algorithmsReady = true;
  const auto install = [&](void* received) {
    require(algorithmsReady && received == &manager, "callback lost its ready manager");
    ++installs;
  };
  require(setup.installForPrediction(0, install), "prediction zero did not install hooks");
  require(setup.finish() && !setup.active() && !setup.finish(), "cold seek did not close once");
  setup.prepare(&manager);
  require(!setup.installForPrediction(1, install) && installs == 1,
          "later prediction reinstalled cold hooks");
  setup.finish();
}

void coldSetupReadinessFailureCannotWarmUpOrRetry() {
  qcut_live::DeferredColdSetup setup;
  int manager = 0, attempts = 0;
  setup.prepare(&manager);
  rejects([&] {
    setup.installForPrediction(0, [&](void*) {
      ++attempts;
      throw std::runtime_error("cold callback algorithm list is empty");
    });
  }, "algorithm list is empty");
  setup.finish();
  rejects([&] { setup.prepare(&manager); }, "algorithm list is empty");
  rejects([&] { setup.installForPrediction(1, [&](void*) { ++attempts; }); }, "algorithm list is empty");
  require(attempts == 1, "failed cold setup silently retried after warming");
}

void coldSetupRejectsWrongBoundaryAndManager() {
  int manager = 0, other = 0, installs = 0;
  const auto install = [&](void*) { ++installs; };
  qcut_live::DeferredColdSetup outside;
  rejects([&] { outside.installForPrediction(0, install); }, "outside native seek");
  qcut_live::DeferredColdSetup late;
  late.prepare(&manager);
  rejects([&] { late.installForPrediction(1, install); }, "prediction zero");
  qcut_live::DeferredColdSetup changed;
  changed.prepare(&manager);
  changed.finish();
  rejects([&] { changed.prepare(&other); }, "manager missing, changed or reentered");
  qcut_live::DeferredColdSetup nested;
  nested.prepare(&manager);
  rejects([&] { nested.prepare(&manager); }, "manager missing, changed or reentered");
  require(installs == 0, "invalid cold boundary installed hooks");
}
}

int main() {
  inspectionCannotLease();
  perGraphLeasesAndIdempotence();
  overwrittenSlotFailsClosed();
  fenceFailureRetainsOwners();
  restorationFailureIsNotSuccess();
  failedConversionRollsBackAfterFence();
  unpublishedLeaseAndMissingConsumer();
  independentGraphsDrainOnFailure();
  boundedGraphsAndDuplicateConsumption();
  coldPredictionsHaveNoBootstrapExemption();
  coldFirstTwoPredictionsRestoreRealLeases();
  coldPublicationAloneDoesNotConsume();
  coldSetupWaitsForWorkerAndRunsOnce();
  coldSetupReadinessFailureCannotWarmUpOrRetry();
  coldSetupRejectsWrongBoundaryAndManager();
  std::cout << "15 CPU-only clone lifecycle tests passed\n";
}
