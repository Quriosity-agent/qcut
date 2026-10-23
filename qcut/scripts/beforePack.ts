import path from "node:path";
import { stageIndependentBeauty } from "./stage-independent-beauty";
import { stageBodyPhotoBuild } from "./stage-body-photo";

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
	stageBodyPhotoBuild({
		sourceRoot: path.join(projectRoot, "research/body-photo"),
		sharedEngineRoot: path.join(
			projectRoot,
			"research/independent-beauty/research"
		),
		destinationRoot: path.join(projectRoot, "build/body-photo"),
	});
	stagedProjects.add(projectRoot);
}
