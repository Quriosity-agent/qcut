/**
 * Stable multi-face identities for Beauty Lab video sessions.
 *
 * Track IDs only ever increase, so temporal state can never move from one person
 * to another. A track that misses frames (including frames skipped between
 * updates) keeps its ID through a bounded grace
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
	// Frame number of the last matched (or creating) detection.
	lastFrame: number;
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

/**
 * Maps each track (by index) to a detection index, or undefined if unmatched.
 *
 * Greedy first (best overlap, then older track, then lower detection index),
 * then every still-unmatched track tries to re-route a competing track onto
 * another eligible detection. Re-routing only ever adds matches, so the result
 * is a maximum-cardinality assignment that keeps the greedy overlap choices
 * wherever no re-route is needed.
 */
function matchTracks({
	tracks,
	detections,
	minIoU,
}: {
	tracks: Track[];
	detections: BeautyLabFaceBox[];
	minIoU: number;
}): Array<number | undefined> {
	const options = tracks.map((track) =>
		detections
			.flatMap((box, detection) => {
				const iou = faceBoxIoU({ left: track.box, right: box });
				return iou >= minIoU ? [{ detection, iou }] : [];
			})
			.sort(
				(left, right) =>
					right.iou - left.iou || left.detection - right.detection
			)
	);
	const matches: Array<number | undefined> = tracks.map(() => undefined);
	const holders = new Map<number, number>();
	const claim = (index: number, detection: number) => {
		matches[index] = detection;
		holders.set(detection, index);
		return true;
	};
	const pairs = options
		.flatMap((row, index) => row.map((option) => ({ index, ...option })))
		.sort(
			(left, right) =>
				right.iou - left.iou ||
				left.index - right.index ||
				left.detection - right.detection
		);
	for (const { index, detection } of pairs) {
		if (matches[index] === undefined && !holders.has(detection))
			claim(index, detection);
	}
	const reroute = (index: number, visited: Set<number>): boolean => {
		for (const { detection } of options[index]) {
			if (!holders.has(detection)) return claim(index, detection);
		}
		for (const { detection } of options[index]) {
			if (visited.has(detection)) continue;
			visited.add(detection);
			const holder = holders.get(detection);
			if (holder !== undefined && reroute(holder, visited))
				return claim(index, detection);
		}
		return false;
	};
	for (const index of tracks.keys()) {
		if (matches[index] === undefined) reroute(index, new Set());
	}
	return matches;
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
			// Frames skipped between updates were missed too, so a track already
			// past its grace period retires before it can claim a detection.
			const expired = tracks.filter(
				(track) => frameNumber - track.lastFrame - 1 > maxMissedFrames
			);
			for (const track of expired) ended.push(track.id);
			tracks = tracks.filter((track) => !expired.includes(track));
			const matches = matchTracks({ tracks, detections, minIoU });
			const matchedDetections = new Set<number>();
			const assignments: BeautyLabFaceAssignment[] = [];
			for (const [index, track] of tracks.entries()) {
				const detection = matches[index];
				if (detection === undefined) continue;
				matchedDetections.add(detection);
				assignments.push({
					trackId: track.id,
					detection,
					isNew: false,
					resetTemporalState: frameNumber - track.lastFrame > 1,
				});
				track.box = { ...detections[detection] };
				track.lastFrame = frameNumber;
			}
			const survivors: Track[] = [];
			for (const [index, track] of tracks.entries()) {
				if (
					matches[index] !== undefined ||
					frameNumber - track.lastFrame <= maxMissedFrames
				)
					survivors.push(track);
				else ended.push(track.id);
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
				tracks.push({ id, box: { ...box }, lastFrame: frameNumber });
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
