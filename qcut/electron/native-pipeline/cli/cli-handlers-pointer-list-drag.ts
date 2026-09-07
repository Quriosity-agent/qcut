/**
 * Flattened list detection and index-based drag destinations for the editor pointer CLI.
 *
 * @module electron/native-pipeline/cli/cli-handlers-pointer-list-drag
 */

import type {
	AgentPointerTarget,
	EditorSnapshotElement,
} from "../../types/claude-api.js";

export interface ListDragContext {
	source: EditorSnapshotElement;
	siblings: EditorSnapshotElement[];
	sourceIndex: number;
	destination: AgentPointerTarget;
}

function visibleSiblings({
	elements,
	parentRef,
}: {
	elements: EditorSnapshotElement[];
	parentRef: string | null;
}): EditorSnapshotElement[] {
	return elements
		.filter(
			(element) =>
				element.parentRef === parentRef &&
				element.bounds.width > 0 &&
				element.bounds.height > 0
		)
		.sort((left, right) => {
			const verticalDelta = left.bounds.y - right.bounds.y;
			if (Math.abs(verticalDelta) > 3) return verticalDelta;
			return left.bounds.x - right.bounds.x;
		});
}

function sameListItemShape({
	source,
	candidate,
}: {
	source: EditorSnapshotElement;
	candidate: EditorSnapshotElement;
}): boolean {
	if (candidate.role !== source.role || candidate.tagName !== source.tagName) {
		return false;
	}

	const widthTolerance = Math.max(4, source.bounds.width * 0.2);
	const heightTolerance = Math.max(4, source.bounds.height * 0.2);
	return (
		Math.abs(candidate.bounds.width - source.bounds.width) <= widthTolerance &&
		Math.abs(candidate.bounds.height - source.bounds.height) <= heightTolerance
	);
}

function clusterAroundSource({
	items,
	source,
	axis,
}: {
	items: EditorSnapshotElement[];
	source: EditorSnapshotElement;
	axis: "x" | "y";
}): EditorSnapshotElement[] {
	const sorted = [...items].sort(
		(left, right) => left.bounds[axis] - right.bounds[axis]
	);
	if (sorted.length < 3) return sorted;

	const gaps = sorted
		.slice(1)
		.map((item, index) => ({
			index,
			distance: item.bounds[axis] - sorted[index].bounds[axis],
		}))
		.sort((left, right) => right.distance - left.distance);
	const largest = gaps[0];
	const secondLargest = gaps[1]?.distance ?? 0;
	const itemSpan = axis === "y" ? source.bounds.height : source.bounds.width;
	if (
		!largest ||
		largest.distance <= Math.max(itemSpan * 3, secondLargest * 1.75)
	) {
		return sorted;
	}

	const beforeGap = sorted.slice(0, largest.index + 1);
	const afterGap = sorted.slice(largest.index + 1);
	return beforeGap.some((item) => item.ref === source.ref)
		? beforeGap
		: afterGap;
}

function flattenedListSiblings({
	elements,
	source,
}: {
	elements: EditorSnapshotElement[];
	source: EditorSnapshotElement;
}): EditorSnapshotElement[] {
	const shaped = elements.filter(
		(candidate) =>
			candidate.bounds.width > 0 &&
			candidate.bounds.height > 0 &&
			sameListItemShape({ source, candidate })
	);
	if (source.testId) {
		const matchingTestIds = shaped.filter(
			(candidate) => candidate.testId === source.testId
		);
		const verticalSpan =
			Math.max(...matchingTestIds.map((item) => item.bounds.y)) -
			Math.min(...matchingTestIds.map((item) => item.bounds.y));
		const horizontalSpan =
			Math.max(...matchingTestIds.map((item) => item.bounds.x)) -
			Math.min(...matchingTestIds.map((item) => item.bounds.x));
		return clusterAroundSource({
			items: matchingTestIds,
			source,
			axis: verticalSpan >= horizontalSpan ? "y" : "x",
		});
	}

	const widthTolerance = Math.max(4, source.bounds.width * 0.2);
	const heightTolerance = Math.max(4, source.bounds.height * 0.2);
	const column = shaped.filter(
		(candidate) =>
			Math.abs(candidate.bounds.x - source.bounds.x) <= widthTolerance
	);
	const row = shaped.filter(
		(candidate) =>
			Math.abs(candidate.bounds.y - source.bounds.y) <= heightTolerance
	);
	return column.length >= row.length
		? clusterAroundSource({ items: column, source, axis: "y" })
		: clusterAroundSource({ items: row, source, axis: "x" });
}

export function findSnapshotElement({
	elements,
	source,
}: {
	elements: EditorSnapshotElement[];
	source: EditorSnapshotElement;
}): EditorSnapshotElement | undefined {
	const hasSemanticIdentity = Boolean(source.testId || source.name);
	const matchesIdentity = (element: EditorSnapshotElement) =>
		element.testId === source.testId &&
		element.name === source.name &&
		element.role === source.role &&
		element.tagName === source.tagName;
	const refMatch = elements.find((element) => element.ref === source.ref);
	if (refMatch && (!hasSemanticIdentity || matchesIdentity(refMatch))) {
		return refMatch;
	}
	return hasSemanticIdentity
		? elements.find((element) => matchesIdentity(element))
		: undefined;
}

export function resolveListDragContext({
	elements,
	fromRef,
	toIndex,
}: {
	elements: EditorSnapshotElement[];
	fromRef: string;
	toIndex: number;
}): ListDragContext {
	let source = elements.find((element) => element.ref === fromRef);
	if (!source) throw new Error(`Snapshot ref not found: ${fromRef}`);
	let siblings: EditorSnapshotElement[] = [];
	const flattenedSource = source;

	while (source && source.parentRef) {
		siblings = visibleSiblings({ elements, parentRef: source.parentRef });
		if (
			siblings.length > toIndex &&
			siblings.some((candidate) => candidate.ref === source!.ref)
		) {
			break;
		}
		if (!source.parentRef) break;
		const parent = elements.find(
			(element) => element.ref === source!.parentRef
		);
		if (!parent) break;
		source = parent;
	}
	if (siblings.length <= toIndex || !siblings.includes(source)) {
		source = flattenedSource;
		siblings = flattenedListSiblings({ elements, source });
	}

	const sourceIndex = siblings.findIndex(
		(candidate) => candidate.ref === source!.ref
	);
	if (sourceIndex < 0 || toIndex < 0 || toIndex >= siblings.length) {
		throw new Error(
			`Cannot resolve list index ${toIndex}; detected ${siblings.length} sibling item(s)`
		);
	}

	const target = siblings[toIndex];
	const verticalSpan =
		Math.max(...siblings.map((item) => item.bounds.y)) -
		Math.min(...siblings.map((item) => item.bounds.y));
	const horizontalSpan =
		Math.max(...siblings.map((item) => item.bounds.x)) -
		Math.min(...siblings.map((item) => item.bounds.x));
	const movingEarlier = toIndex < sourceIndex;
	const destination =
		verticalSpan >= horizontalSpan
			? {
					x: target.bounds.x + target.bounds.width / 2,
					y:
						target.bounds.y +
						target.bounds.height * (movingEarlier ? 0.2 : 0.8),
				}
			: {
					x:
						target.bounds.x + target.bounds.width * (movingEarlier ? 0.2 : 0.8),
					y: target.bounds.y + target.bounds.height / 2,
				};

	return { source, siblings, sourceIndex, destination };
}
