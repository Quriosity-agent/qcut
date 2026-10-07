import path from "node:path";
import { stageIndependentBeauty } from "./stage-independent-beauty";

const stagedProjects = new Set<string>();
export default function beforePack({
	packager,
}: {
	packager: { projectDir: string };
}) {
	const projectRoot = path.resolve(packager.projectDir);
	if (stagedProjects.has(projectRoot)) return;
	stageIndependentBeauty({
		sourceRoot: path.join(projectRoot, "research/independent-beauty"),
		outputRoot: path.join(projectRoot, "build/independent-beauty"),
	});
	stagedProjects.add(projectRoot);
}
