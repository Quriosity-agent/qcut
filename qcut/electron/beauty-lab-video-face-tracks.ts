/**
 * Stable multi-face identities for Beauty Lab video sessions.
 *
 * Track IDs only ever increase, so temporal state can never move from one person
 * to another. A track that misses frames keeps its ID through a bounded grace
 * period (occlusion) but restarts its temporal state when it returns; past the
 * grace period it retires and a returning face gets a new ID. A new generation
 * (seek or source change) retires every track.
 */

export interface BeautyLabFaceBox {
	// Normalized to the frame: 0..1 on both axes.
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BeautyLabFaceAssignment {
	trackId: number;
	detection: number;
	isNew: boolean;
	resetTemporalState: boolean;
}

interface Track {
	id: number;
	box: BeautyLabFaceBox;
	missed: number;
}

function validBox({ box }: { box: BeautyLabFaceBox }) {
	const values = [box.x, box.y, box.width, box.height];
	return (
		values.every(Number.isFinite) &&
		box.x >= 0 &&
		box.y >= 0 &&
		box.width > 0 &&
		box.height > 0 &&
		box.x + box.width <= 1 &&
		box.y + box.height <= 1
	);
}

export function faceBoxIoU({
	left,
	right,
}: {
	left: BeautyLabFaceBox;
	right: BeautyLabFaceBox;
}): number {
	const width =
		Math.min(left.x + left.width, right.x + right.width) -
		Math.max(left.x, right.x);
	const height =
		Math.min(left.y + left.height, right.y + right.height) -
		Math.max(left.y, right.y);
	if (width <= 0 || height <= 0) return 0;
	const intersection = width * height;
	return (
		intersection /
		(left.width * left.height + right.width * right.height - intersection)
	);
}

export function createBeautyLabFaceTracker({
	minIoU,
	maxMissedFrames,
	maxTracks,
}: {
	minIoU: number;
	maxMissedFrames: number;
	maxTracks: number;
}) {
	if (
		!(minIoU > 0 && minIoU < 1) ||
		!Number.isSafeInteger(maxMissedFrames) ||
		maxMissedFrames < 0 ||
		!Number.isSafeInteger(maxTracks) ||
		maxTracks < 1 ||
		maxTracks > 16
	)
		throw new Error("Invalid face tracker options");
	let tracks: Track[] = [];
	let nextId = 1;
	let generation: number | undefined;
	let lastFrame: number | undefined;

	function retireAll(): number[] {
		const ended = tracks.map((track) => track.id);
		tracks = [];
		return ended;
	}

	return {
		update({
			generation: current,
			frameNumber,
			detections,
		}: {
			generation: number;
			frameNumber: number;
			detections: BeautyLabFaceBox[];
		}) {
			if (
				!Number.isSafeInteger(current) ||
				current < 0 ||
				!Number.isSafeInteger(frameNumber) ||
				frameNumber < 0 ||
				detections.length > 64 ||
				!detections.every((box) => validBox({ box }))
			)
				throw new Error("Invalid face tracking input");
			const ended: number[] = [];
			if (generation !== current) {
				if (generation !== undefined && current < generation)
					throw new Error("Face tracking generation moved backwards");
				ended.push(...retireAll());
				generation = current;
				lastFrame = undefined;
			}
			if (lastFrame !== undefined && frameNumber <= lastFrame)
				throw new Error(
					"Face tracking frames must increase within a generation"
				);
			lastFrame = frameNumber;
			const pairs: Array<{ track: Track; detection: number; iou: number }> = [];
			for (const track of tracks) {
				for (const [detection, box] of detections.entries()) {
					const iou = faceBoxIoU({ left: track.box, right: box });
					if (iou >= minIoU) pairs.push({ track, detection, iou });
				}
			}
			// Deterministic greedy matching: best overlap, then older track, then lower index.
			pairs.sort(
				(left, right) =>
					right.iou - left.iou ||
					left.track.id - right.track.id ||
					left.detection - right.detection
			);
			const matchedTracks = new Set<number>();
			const matchedDetections = new Set<number>();
			const assignments: BeautyLabFaceAssignment[] = [];
			for (const { track, detection } of pairs) {
				if (matchedTracks.has(track.id) || matchedDetections.has(detection))
					continue;
				matchedTracks.add(track.id);
				matchedDetections.add(detection);
				assignments.push({
					trackId: track.id,
					detection,
					isNew: false,
					resetTemporalState: track.missed > 0,
				});
				track.box = { ...detections[detection] };
				track.missed = 0;
			}
			const survivors: Track[] = [];
			for (const track of tracks) {
				if (matchedTracks.has(track.id)) {
					survivors.push(track);
					continue;
				}
				track.missed += 1;
				if (track.missed > maxMissedFrames) ended.push(track.id);
				else survivors.push(track);
			}
			tracks = survivors;
			let overflow = 0;
			for (const [detection, box] of detections.entries()) {
				if (matchedDetections.has(detection)) continue;
				if (tracks.length >= maxTracks) {
					overflow += 1;
					continue;
				}
				const id = nextId;
				nextId += 1;
				tracks.push({ id, box: { ...box }, missed: 0 });
				assignments.push({
					trackId: id,
					detection,
					isNew: true,
					resetTemporalState: true,
				});
			}
			assignments.sort((left, right) => left.detection - right.detection);
			return { assignments, ended, overflow };
		},
		activeTrackIds: () => tracks.map((track) => track.id),
	};
}
