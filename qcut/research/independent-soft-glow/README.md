# Independent cinematic soft glow in C++20

Readable, standalone CPU reconstruction of one Jianying filter's instantiated algorithm graph. The library and CLI use only the C++ standard library. No Jianying dylib, shader runtime, Lua, GPU API, or QCut dependency is used during compilation or rendering.

The subsequent [UNORM precision correction](../../docs/task/jianying-filter-runtime-research/soft-glow-unorm-precision-2026-09-07.zh.md) fixes float double rounding and implements the provider output blend with byte inputs and binary64 arithmetic. The original CGL conversion oracle matches 666,580 channels with zero differences; its old float-product negative control differs 127 times. At v3, six fixed native references gave RGB MAE 0.006529–0.050648, maximum error 6. This intentionally changes historical C++ output hashes; the report also records both improvements and regressions against existing UI export frames.

The [v4 blit correction](../../docs/task/jianying-filter-runtime-research/soft-glow-blit-precision-2026-09-07.zh.md) additionally recovers the measured M4 framebuffer resize profile, including source-Y direction at half-weight boundaries. An original CGL oracle verifies 111 cases / 444 blits, with 58,017,272 floating channels and the same number of byte channels exactly matching per process. Both Gaussian resize stages now match all three captured native fixtures exactly when replayed with native upstream inputs. Six complete pipelines retain residual RGB MAE 0.006380–0.046024, maximum 6. The seven local CTest groups include native float hashes from original generated fixtures; no native graphics runtime is required for these tests. Other shader sampling and full-pipeline equivalence remain unresolved.

See [Chinese build and validation report](README.zh.md), [algorithm explanation](algorithm.zh.md), and [graph evidence](graph-evidence.zh.md).

The [2026-09-07 native pass report](../../docs/task/jianying-filter-runtime-research/soft-glow-pass-precision-2026-09-07.zh.md) adds actual RGBA8 draw/blit readbacks and the standalone `soft-glow-stage-replay` executable. It replays 13 stages independently from supplied native upstream images, separating local residuals from accumulated pipeline error. Three fixtures reproduce the final Normal stage exactly; the complete effect still has numerical residuals. At that stage, exposing these APIs preserved all six historical pipeline outputs. This project now also participates in the shared five-project CMake and cross-platform CI.

The [semantic contract](semantic-contract.zh.md) and its [machine-readable JSON](semantic-contract.json) define the dataflow, units, formulas, channel layouts and lifecycle boundaries independently of the C++ implementation. Three inputs with nine single-factor substitutions plus a baseline produced 30 outputs: each substitution increased error against the fixed native reference. Those historical results apply to the static scene and provider output blending. A separate `ui-snapshot` intensity mode reconstructs measured editor export behavior without repairing or executing vendor scripts.

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j4
ctest --test-dir build --output-on-failure
./build/soft-glow --demo --output demo.ppm
```

The self-contained demo generates its own chart and identity LUT. To reproduce the measured color treatment, supply the corresponding private 512×512 RGBA8 LUT atlas explicitly:

```sh
./build/soft-glow --input input.rgba --width 320 --height 180 \
  --lut reference-map2.rgba --intensity 1 --output output.rgba --trace stages
```

Raw images are opaque, top-down, tightly packed RGBA8 SDR. The static library exposes `cinematic_soft_glow(PipelineRequest)`. The graph consists of Gaussian downsample/convolution/upsample, a centered 103% SoftLight layer, one glow node with separately packed RG/BA blur branches, a tiled 64-cube LUT, and a final Normal layer.

Both CLIs accept `--intensity-mode output-mix|ui-snapshot`. The default `output-mix` blends the complete effect with the input and preserves the measured local CGL provider contract. `ui-snapshot` uses threshold `1−0.175t` and brightness `3t` for `t≤0.8`, otherwise the scene values `0.84` and `2.4`; LUT opacity is `0.8t`. SoftLight and Normal stay fixed, with no final output blend. Zero therefore retains SoftLight, and 100% is byte-identical across modes. See the [intensity contract and evidence](intensity-modes.zh.md) and [stream protocol](stream.zh.md).

Release and Address/UndefinedBehavior sanitizer tests passed on macOS arm64 with AppleClang 21. Nine algorithm groups, stream tests and optional Python CLI tests cover the two modes, zero behavior, the 80/81 boundary, invocation order and protocol validation, alongside the numerical checks. Historical `output-mix` results for three synthetic inputs at 100% and 37% produced RGB MAE **0.006540–0.054485 out of 255**, maximum channel error **6**, and zero alpha error against stable native references. Those numbers and output hashes identify the historical build. This is not a bit-exact native claim or a complete editor/export acceptance result.

The source contains no vendor LUT, binary, shader, Lua, or model. The LUT is an external art asset; the identity demo is fully self-contained. Real-video processing and editor intensity observations are reported separately in the linked reports. Transparent pipeline inputs, HDR, complete package-event execution, arbitrary layer transforms, and cross-platform runtime equivalence remain outside this validation.
