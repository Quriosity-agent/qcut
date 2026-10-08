import { runIndependentBeautyJob } from "./beauty-lab-independent-process.js";

export const independentBeautyPythonPackages = {
	onnxruntime: "1.22.1",
	onnx: "1.19.0",
	numpy: "2.5.3",
	pillow: "12.2.0",
	"opencv-python-headless": "4.12.0.88",
} as const;

export function independentBeautyEnvironment({
	environment,
}: {
	environment: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
	return {
		...Object.fromEntries(
			Object.entries(environment).filter(
				([key]) =>
					!key.startsWith("DYLD_") &&
					!["PYTHONPATH", "PYTHONHOME"].includes(key)
			)
		),
		PYTHONDONTWRITEBYTECODE: "1",
	};
}

const pythonProbe = `
import sys, json, importlib.metadata as metadata
if sys.version_info[:2] != (3, 12):
    raise RuntimeError("Independent beauty requires Python 3.12")
for name, expected in json.loads(sys.argv[1]).items():
    actual = metadata.version(name)
    if actual != expected:
        raise RuntimeError(f"{name}: expected {expected}, found {actual}")
import numpy as np, cv2, onnx, onnxruntime as ort
from PIL import Image
from onnx import helper, TensorProto
sample = np.ones((2, 2, 3), dtype=np.uint8)
assert cv2.cvtColor(sample, cv2.COLOR_RGB2GRAY).shape == (2, 2)
assert np.array(Image.fromarray(sample)).shape == sample.shape
tensor = helper.make_tensor_value_info("x", TensorProto.FLOAT, [1])
output = helper.make_tensor_value_info("y", TensorProto.FLOAT, [1])
model = helper.make_model(helper.make_graph([helper.make_node("Identity", ["x"], ["y"])], "probe", [tensor], [output]), opset_imports=[helper.make_opsetid("", 13)], ir_version=10)
session = ort.InferenceSession(model.SerializeToString(), providers=["CPUExecutionProvider"])
assert session.get_providers()[0] == "CPUExecutionProvider"
assert session.run(None, {"x": np.array([1], dtype=np.float32)})[0].tolist() == [1]
`;

export async function verifyIndependentBeautyEnvironment({
	python,
	bun,
	cwd,
	environment = process.env,
	signal = new AbortController().signal,
	runJob = runIndependentBeautyJob,
}: {
	python: string;
	bun: string;
	cwd: string;
	environment?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	runJob?: typeof runIndependentBeautyJob;
}) {
	const cleanEnvironment = independentBeautyEnvironment({ environment });
	const probes = [
		{
			name: "Python packages / CPU inference",
			python,
			args: [
				"-I",
				"-B",
				"-c",
				pythonProbe,
				JSON.stringify(independentBeautyPythonPackages),
			],
		},
		{
			name: "Bun planner",
			python: bun,
			args: [
				"--eval",
				'if (typeof Bun === "undefined" || !Bun.version) throw new Error("Bun runtime required"); const a = new Float32Array([1, 2]); if (a[1] !== 2) throw new Error("Typed array probe failed");',
			],
		},
		{
			name: "Swift compiler",
			python: "/usr/bin/xcrun",
			args: ["swiftc", "--version"],
		},
		{
			name: "Metal device / runtime shader compiler",
			python: "/usr/bin/xcrun",
			args: [
				"swift",
				"-e",
				'import Metal\nguard let device = MTLCreateSystemDefaultDevice() else { fatalError("Metal device required") }\nlet library = try device.makeLibrary(source: "#include <metal_stdlib>\\nusing namespace metal; kernel void probe(uint id [[thread_position_in_grid]]) {}", options: nil)\nguard library.makeFunction(name: "probe") != nil else { fatalError("Metal shader compilation failed") }',
			],
		},
	];
	const results = await Promise.allSettled(
		probes.map(async ({ name, ...command }) => {
			try {
				await runJob({
					...command,
					cwd,
					environment: cleanEnvironment,
					signal,
					timeoutMs: 30_000,
				});
			} catch (error) {
				throw new Error(`Independent environment ${name}: ${String(error)}`);
			}
		})
	);
	const failure = results.find((entry) => entry.status === "rejected");
	if (failure?.status === "rejected") throw failure.reason;
	return {
		pythonVersion: "3.12",
		packages: independentBeautyPythonPackages,
		cpuInferenceVerified: true,
		compilerExecutionVerified: true,
		metalShaderVerified: true,
		gpuRenderVerified: false,
	};
}
