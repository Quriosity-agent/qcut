/**
 * A timeline cut by time, not by frame, must export frame for frame.
 *
 * Four clips on the main track whose edges and in-points sit between frames
 * (a ripple delete on bar lines leaves them so), taken in turn from a file
 * tagged BT.709 and from an untagged copy of it, with three overlay cards
 * above them. Every source frame carries its own number as a grey level, so
 * the exported file says which frame of which clip each of its frames shows,
 * whatever colour matrix a decoder assumes. Measured on the native export:
 * - every frame shows the source frame the timeline has there, and the file
 *   is as long as the timeline (clips used to be rounded up to whole frames
 *   one by one, and the picture ran later than the sound cut by cut);
 * - every overlay starts on its own first frame (they started 2–5 frames in
 *   after the picture's colour tags changed) and the picture beside them
 *   keeps its levels (one overlay used to darken every frame);
 * - every click sounds where the timeline has it;
 * - the job has no warnings, `--exclude-tracks` leaves the overlays out,
 *   and `--keep-temp` leaves the intermediate files and their commands.
 * Then `timeline snap --to frames` puts every edge on a frame without moving
 * what the clips show or play, and `editing insert-gap` opens a second of
 * black and silence at the head.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { isolatedElectronTest as test } from "./helpers/isolated-electron-fixture";

const FFMPEG = path.resolve("electron/resources/ffmpeg/darwin-arm64/ffmpeg");
const W = 320;
const H = 180;
const FPS = 24;
const RATE = 48_000;
const SOURCE_SECONDS = 6;
const CARD_SECONDS = 2;
/** Source seconds of the clicks in both main-track files. */
const CLICKS = [0.6, 2.1, 3.4];
/** Grey levels: frame n is 40 + 9 (n mod 20) on the left, 40 + 12 ⌊n/20⌋ on the right. */
const RAMP = { base: 40, phaseStep: 9, cycle: 20, cycleStep: 12 };
/** The card's lower half, brighter than anything in the picture under it. */
const CARD_MARK = 230;
/** The main track: where each clip starts and reads its file from; the last ends at 4.5 s. */
const MAIN = [
	{ file: "tagged.mp4", startTime: 0, trimStart: 0 },
	{ file: "untagged.mp4", startTime: 1.2, trimStart: 1.7 },
	{ file: "tagged.mp4", startTime: 2.011, trimStart: 0.5113 },
	{ file: "untagged.mp4", startTime: 3.05, trimStart: 2.3 },
];
const MAIN_END = 4.5;
/** The cards: the last starts and ends between frames. */
const CARDS = [0.5, 1.5, 3.2];
const CARD_LENGTH = 0.75;
/** Where each part of the picture is read (crop: width, height, x, y). */
const REGIONS = {
	phase: "80:40:20:120",
	cycle: "80:30:200:130",
	cardNumber: "80:24:180:14",
	cardMark: "80:24:180:62",
};

type Json = Record<string, unknown>;

interface Clip {
	id: string;
	sourceName?: string;
	startTime: number;
	endTime: number;
	trimStart?: number;
}

interface ExportedTimeline {
	duration: number;
	frameAlignment?: {
		fps: number;
		offFrameClips: number;
		mainTrackOffFrameClips: number;
	};
	tracks: Array<{
		id: string;
		type: string;
		isMain?: boolean;
		elements: Clip[];
	}>;
}

interface ExportJob {
	status: string;
	outputPath?: string;
	warnings?: string[];
	intermediates?: string;
}

function cli<T>({
	apiPort,
	args,
	timeout = 300_000,
}: {
	apiPort: number;
	args: string[];
	timeout?: number;
}): T {
	const child = spawnSync(
		"bun",
		["--silent", "run", "qcut", "--", ...args, "--json", "--flat"],
		{
			cwd: path.resolve("."),
			env: { ...process.env, QCUT_API_PORT: String(apiPort) },
			maxBuffer: 32 * 1024 * 1024,
			timeout,
			encoding: "utf8",
		}
	);
	if (child.status !== 0) {
		throw new Error(`${args[0]} failed: ${child.stdout}\n${child.stderr}`);
	}
	const last = child.stdout.trimEnd().lastIndexOf("\n{");
	return JSON.parse(child.stdout.slice(last + 1)) as T;
}

function ffmpeg(args: string[]) {
	execFileSync(FFMPEG, ["-v", "error", "-y", ...args]);
}

/** The main-track file: numbered grey frames and three clicks over a quiet bed. */
function makeMainSource({ file, tagged }: { file: string; tagged: boolean }) {
	const bursts = CLICKS.map(
		(time) => `between(t\\,${time}\\,${time + 0.01})`
	).join("+");
	const lum =
		`if(lt(X\\,W/2)\\,${RAMP.base}+${RAMP.phaseStep}*mod(N\\,${RAMP.cycle})` +
		`\\,${RAMP.base}+${RAMP.cycleStep}*floor(N/${RAMP.cycle}))`;
	ffmpeg([
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${W}x${H}:r=${FPS}:d=${SOURCE_SECONDS},format=yuv420p,geq=lum='${lum}':cb=128:cr=128`,
		"-f",
		"lavfi",
		"-i",
		`aevalsrc=0.05*sin(2*PI*200*t)+0.8*sin(2*PI*1000*t)*(${bursts}):s=${RATE}:c=stereo:d=${SOURCE_SECONDS}`,
		...(tagged
			? [
					"-vf",
					"setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709",
					"-color_range",
					"tv",
					"-colorspace",
					"bt709",
					"-color_primaries",
					"bt709",
					"-color_trc",
					"bt709",
				]
			: []),
		"-c:v",
		"libx264",
		"-crf",
		"10",
		"-g",
		"24",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		file,
	]);
}

/** The card: its own frame number above, a bright bar below; no sound. */
function makeCard({ file }: { file: string }) {
	const lum = `if(lt(Y\\,H/2)\\,${RAMP.base}+${RAMP.phaseStep}*mod(N\\,${RAMP.cycle})\\,${CARD_MARK})`;
	ffmpeg([
		"-f",
		"lavfi",
		"-i",
		`color=c=black:s=${W / 2}x${H / 2}:r=${FPS}:d=${CARD_SECONDS},format=yuv420p,geq=lum='${lum}':cb=128:cr=128`,
		"-c:v",
		"libx264",
		"-crf",
		"10",
		"-pix_fmt",
		"yuv420p",
		file,
	]);
}

/**
 * The mean luma of `region` in every frame of `file`, as stored: read as
 * YUV, so no range or matrix is applied on the way.
 */
function regionLuma({ file, region }: { file: string; region: string }) {
	const result = spawnSync(
		FFMPEG,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vf",
			`crop=${region},scale=1:1:flags=area`,
			"-f",
			"rawvideo",
			"-pix_fmt",
			"yuv444p",
			"-",
		],
		{ maxBuffer: 16 * 1024 * 1024 }
	);
	if (result.status !== 0) throw new Error(result.stderr.toString());
	// One pixel a frame: its Y, U and V.
	return [...result.stdout].filter((_value, index) => index % 3 === 0);
}

interface Measured {
	/** Source frame of the main track in each frame; −1 where it is black. */
	main: number[];
	/** The card's frame number in each frame; −1 where no card is drawn. */
	card: number[];
	phaseLuma: number[];
	cycleLuma: number[];
}

function measure({ file }: { file: string }): Measured {
	const luma = (region: string) => regionLuma({ file, region });
	const phaseLuma = luma(REGIONS.phase);
	const cycleLuma = luma(REGIONS.cycle);
	const cardNumber = luma(REGIONS.cardNumber);
	const cardMark = luma(REGIONS.cardMark);
	const number = (value: number) =>
		Math.round((value - RAMP.base) / RAMP.phaseStep);
	return {
		phaseLuma,
		cycleLuma,
		main: phaseLuma.map((value, frame) =>
			value < RAMP.base - 12
				? -1
				: Math.round((cycleLuma[frame] - RAMP.base) / RAMP.cycleStep) *
						RAMP.cycle +
					number(value)
		),
		card: cardMark.map((value, frame) =>
			value > CARD_MARK - 10 ? number(cardNumber[frame]) : -1
		),
	};
}

/** The first output frame at or after `time` (the preview's 1 ms rule). */
function frameAt(time: number): number {
	return Math.max(0, Math.ceil((time - 0.001) * FPS - 1e-9));
}

/** What each output frame shows of `clips`: the source frame, or −1 for none. */
function expectedFrames({
	clips,
	frames,
}: {
	clips: Clip[];
	frames: number;
}): number[] {
	return Array.from({ length: frames }, (_unused, frame) => {
		const clip = clips.find(
			(candidate) =>
				frameAt(candidate.startTime) <= frame &&
				frame < frameAt(candidate.endTime)
		);
		if (!clip) return -1;
		const sourceTime =
			(clip.trimStart ?? 0) + frame / FPS + 0.001 - clip.startTime;
		return Math.floor(sourceTime * FPS + 1e-9);
	});
}

/** Seconds where a burst starts after at least 50 ms of quiet. */
function clickTimes({ file }: { file: string }): number[] {
	const result = spawnSync(
		FFMPEG,
		[
			"-v",
			"error",
			"-i",
			file,
			"-vn",
			"-ac",
			"1",
			"-ar",
			String(RATE),
			"-f",
			"f32le",
			"-",
		],
		{ maxBuffer: 64 * 1024 * 1024 }
	);
	if (result.status !== 0) throw new Error(result.stderr.toString());
	const bytes = result.stdout;
	const samples = new Float32Array(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
	);
	const times: number[] = [];
	let quiet = 0;
	for (const [index, sample] of samples.entries()) {
		if (Math.abs(sample) > 0.3) {
			if (quiet > 0.05 * RATE) times.push(index / RATE);
			quiet = 0;
		} else quiet += 1;
	}
	return times;
}

/** Timeline seconds of the click inside each main-track clip. */
function expectedClicks({ clips }: { clips: Clip[] }): number[] {
	return clips.flatMap((clip) => {
		const trimStart = clip.trimStart ?? 0;
		const length = clip.endTime - clip.startTime;
		return CLICKS.filter(
			(click) => click > trimStart && click < trimStart + length
		).map((click) => clip.startTime + click - trimStart);
	});
}

function mean(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

test.use({ captureScreenshotVideo: false });
test.setTimeout(900_000);

test("clips cut between frames export frame for frame, with overlays, a frame snap and an inserted gap", async ({
	apiPort,
	page,
}) => {
	test.skip(!existsSync(FFMPEG), "bundled ffmpeg missing");
	await page.waitForLoadState("domcontentloaded");
	const run = <T>(...args: string[]) => cli<T>({ apiPort, args });
	const workDir = mkdtempSync(path.join(tmpdir(), "qcut-off-frame-"));
	let intermediates: string | undefined;
	try {
		makeMainSource({ file: path.join(workDir, "tagged.mp4"), tagged: true });
		makeMainSource({
			file: path.join(workDir, "untagged.mp4"),
			tagged: false,
		});
		makeCard({ file: path.join(workDir, "card.mp4") });

		const { projectId } = run<{ projectId: string }>(
			"editor:project:create",
			"--name",
			"Off-frame cuts",
			"--width",
			String(W),
			"--height",
			String(H),
			"--fps",
			String(FPS),
			"--open",
			"--wait-ready"
		);
		const pid = ["--project-id", projectId];
		const { tracks } = run<{
			tracks: Array<{ id: string; isMain?: boolean }>;
		}>("editor:track:list", ...pid);
		const mainId = tracks.find((track) => track.isMain)?.id as string;
		run(
			"editor:media:batch-import",
			...pid,
			"--sources",
			["tagged.mp4", "untagged.mp4", "card.mp4"]
				.map((file) => path.join(workDir, file))
				.join(",")
		);
		for (const [index, clip] of MAIN.entries()) {
			const endTime = MAIN[index + 1]?.startTime ?? MAIN_END;
			run(
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({
					type: "media",
					sourceName: clip.file,
					trackId: mainId,
					startTime: clip.startTime,
					duration: SOURCE_SECONDS,
					trimStart: clip.trimStart,
					trimEnd: SOURCE_SECONDS - clip.trimStart - (endTime - clip.startTime),
				})
			);
		}
		const overlay = run<{ trackId: string }>(
			"editor:track:create",
			...pid,
			"--type",
			"media",
			"--name",
			"Cards",
			"--index",
			"0"
		);
		for (const startTime of CARDS) {
			const added = run<{ elementId: string }>(
				"editor:timeline:add-element",
				...pid,
				"--data",
				JSON.stringify({
					type: "media",
					sourceName: "card.mp4",
					trackId: overlay.trackId,
					startTime,
					duration: CARD_SECONDS,
					trimStart: 0,
					trimEnd: CARD_SECONDS - CARD_LENGTH,
				})
			);
			// A quarter of the picture, up and to the right of its centre.
			run(
				"editor:element:patch",
				...pid,
				"--element-id",
				added.elementId,
				"--set",
				JSON.stringify({ x: 60, y: -40, scaleX: 0.5, scaleY: 0.5 })
			);
		}

		const readTimeline = () => {
			const timeline = run<ExportedTimeline>("editor:timeline:export", ...pid);
			const byStart = (left: Clip, right: Clip) =>
				left.startTime - right.startTime;
			return {
				timeline,
				main: [
					...(timeline.tracks.find((track) => track.isMain)?.elements ?? []),
				].sort(byStart),
				cards: [
					...(timeline.tracks.find((track) => track.id === overlay.trackId)
						?.elements ?? []),
				].sort(byStart),
			};
		};
		const exportTo = ({
			name,
			engine = "native",
			extra = [],
		}: {
			name: string;
			engine?: "native" | "muxer";
			extra?: string[];
		}) => {
			const outputPath = path.join(workDir, `${name}.mp4`);
			const job = cli<ExportJob>({
				apiPort,
				timeout: 600_000,
				args: [
					"editor:export:start",
					...pid,
					"--output",
					outputPath,
					"--engine",
					engine,
					...extra,
					"--poll",
				],
			});
			expect(job.status, `${name} export`).toBe("completed");
			expect(existsSync(outputPath), `${name} written`).toBe(true);
			return { job, outputPath };
		};
		/** The file against what the timeline has on every frame and at every click. */
		const expectTimeline = ({
			name,
			file,
			main,
			cards,
			duration,
		}: {
			name: string;
			file: string;
			main: Clip[];
			cards: Clip[];
			duration: number;
		}): Measured => {
			const frames = frameAt(duration);
			const measured = measure({ file });
			expect(measured.main.length, `${name} frames`).toBe(frames);
			const wrong = (shown: number[], want: number[]) =>
				shown.flatMap((value, frame) =>
					value === want[frame]
						? []
						: [`${frame}: ${value}, want ${want[frame]}`]
				);
			expect(
				wrong(measured.main, expectedFrames({ clips: main, frames })),
				`${name} main-track frames`
			).toEqual([]);
			expect(
				wrong(measured.card, expectedFrames({ clips: cards, frames })),
				`${name} card frames`
			).toEqual([]);
			const heard = clickTimes({ file });
			const clicks = expectedClicks({ clips: main });
			const errorsMs = heard.map((time, index) =>
				Number(((time - clicks[index]) * 1000).toFixed(2))
			);
			console.log(`${name} click error (ms)`, errorsMs.join(" "));
			expect(heard, `${name} clicks`).toHaveLength(clicks.length);
			for (const error of errorsMs) expect(Math.abs(error)).toBeLessThan(1);
			return measured;
		};

		// The timeline says which clips sit between frames.
		const cut = readTimeline();
		expect(cut.main).toHaveLength(MAIN.length);
		expect(cut.cards).toHaveLength(CARDS.length);
		expect(cut.timeline.frameAlignment).toMatchObject({
			fps: FPS,
			offFrameClips: 5,
			mainTrackOffFrameClips: 4,
		});

		// As cut: frame for frame, no warnings, the files kept on request.
		const kept = exportTo({ name: "cut", extra: ["--keep-temp"] });
		intermediates = kept.job.intermediates;
		expect(kept.job.warnings ?? [], "warnings").toEqual([]);
		expect(intermediates && existsSync(intermediates)).toBe(true);
		const commands = readFileSync(
			path.join(intermediates as string, "ffmpeg-commands.sh"),
			"utf8"
		);
		expect(commands).toContain("concat-video-list.txt");
		expect(commands).toContain("-reinit_filter 0");
		const withCards = expectTimeline({
			name: "cut",
			file: kept.outputPath,
			...cut,
			duration: cut.timeline.duration,
		});

		// Without the card track: the same picture and sound, no card, and the
		// picture beside the cards at the levels it has with them.
		const plate = exportTo({
			name: "plate",
			extra: ["--exclude-tracks", overlay.trackId],
		});
		expect(plate.job.warnings ?? [], "plate warnings").toEqual([]);
		const withoutCards = expectTimeline({
			name: "plate",
			file: plate.outputPath,
			main: cut.main,
			cards: [],
			duration: cut.timeline.duration,
		});
		const lumaShift = {
			phase: mean(withCards.phaseLuma) - mean(withoutCards.phaseLuma),
			cycle: mean(withCards.cycleLuma) - mean(withoutCards.cycleLuma),
		};
		console.log("luma with cards − without", JSON.stringify(lumaShift));
		expect(Math.abs(lumaShift.phase)).toBeLessThan(0.5);
		expect(Math.abs(lumaShift.cycle)).toBeLessThan(0.5);
		// Leaving a track out changes nothing in the project.
		expect(readTimeline().cards).toHaveLength(CARDS.length);

		// Every edge onto a frame, as one step; what the clips show stays put.
		const plan = run<{ changed: Json[]; skipped: Json[] }>(
			"editor:timeline:snap",
			"--to",
			"frames",
			"--dry-run",
			...pid
		);
		expect(plan.changed).toHaveLength(5);
		expect(plan.skipped).toEqual([]);
		expect(readTimeline().timeline.frameAlignment?.offFrameClips).toBe(5);
		const snappedResult = run<{ changed: Json[]; skipped: Json[] }>(
			"editor:timeline:snap",
			"--to",
			"frames",
			...pid
		);
		expect(snappedResult.changed).toHaveLength(5);
		expect(snappedResult.skipped).toEqual([]);
		const snapped = readTimeline();
		expect(snapped.timeline.frameAlignment?.offFrameClips).toBe(0);
		for (const [index, clip] of snapped.main.entries()) {
			const before = cut.main[index];
			// The same source time at the same timeline time.
			expect(
				(clip.trimStart ?? 0) - clip.startTime,
				`clip ${index} content`
			).toBeCloseTo((before.trimStart ?? 0) - before.startTime, 6);
			if (index > 0) {
				expect(clip.startTime).toBeCloseTo(snapped.main[index - 1].endTime, 6);
			}
		}
		expect(
			snapped.main.map((clip) => Math.round(clip.startTime * FPS))
		).toEqual([0, 29, 48, 73]);
		const onFrames = exportTo({ name: "snapped" });
		expect(onFrames.job.warnings ?? [], "snapped warnings").toEqual([]);
		expectTimeline({
			name: "snapped",
			file: onFrames.outputPath,
			...snapped,
			duration: snapped.timeline.duration,
		});

		// A second of room at the head: 1.02 s asked for, 24 frames with
		// --snap-frames, black and silent in the export.
		const gap = run<{
			duration: number;
			movedElements: number;
			snapped?: { fps: number; duration: number };
		}>(
			"editor:editing:insert-gap",
			"--at",
			"0",
			"--duration",
			"1.02",
			"--snap-frames",
			...pid
		);
		expect(gap.snapped).toMatchObject({ fps: FPS, duration: 1 });
		expect(gap.movedElements).toBe(MAIN.length + CARDS.length);
		const moved = readTimeline();
		expect(moved.main[0].startTime).toBeCloseTo(1, 6);
		expect(moved.timeline.duration).toBeCloseTo(
			snapped.timeline.duration + 1,
			6
		);
		const withGap = exportTo({ name: "gap" });
		expect(withGap.job.warnings ?? [], "gap warnings").toEqual([]);
		const gapMeasured = expectTimeline({
			name: "gap",
			file: withGap.outputPath,
			...moved,
			duration: moved.timeline.duration,
		});
		expect(gapMeasured.main.slice(0, FPS)).toEqual(
			Array.from({ length: FPS }, () => -1)
		);
		expect(gapMeasured.main[FPS]).toBe(0);
	} finally {
		if (intermediates) rmSync(intermediates, { recursive: true, force: true });
		rmSync(workDir, { recursive: true, force: true });
	}
});
