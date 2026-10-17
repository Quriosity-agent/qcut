import { describe, expect, it } from "vitest";
import {
	buildComposeFinishingArgs,
	buildComposeNormalizeArgs,
	buildComposeTimelineArgs,
} from "../compose-ffmpeg";

describe("compose FFmpeg compiler", () => {
	it("normalizes a silent clip with a generated stereo track", () => {
		const args = buildComposeNormalizeArgs({
			input: "/tmp/a.mp4",
			output: "/tmp/a-normalized.mp4",
			trimIn: 0.25,
			duration: 2,
			width: 640,
			height: 360,
			fps: 24,
			hasAudio: false,
		});
		const command = args.join(" ");

		expect(command).toContain("anullsrc=channel_layout=stereo");
		expect(command).toContain("trim=start=0.25:duration=2");
		expect(command).toContain("scale=640:360");
		expect(command).toContain("fps=24");
	});

	it("compiles crossfade and hard-cut boundaries into one timeline graph", () => {
		const result = buildComposeTimelineArgs({
			clips: [
				{ path: "a.mp4", duration: 2 },
				{ path: "b.mp4", duration: 3 },
				{ path: "c.mp4", duration: 1 },
			],
			transitionsByCut: [
				{ between: ["a", "b"], preset: "crossfade", duration: 0.5 },
				undefined,
			],
			videoOutput: "timeline-video.mp4",
			audioOutput: "timeline-audio.m4a",
			output: "joined.mp4",
		});
		const videoCommand = result.videoArgs.join(" ");
		const audioCommand = result.audioArgs.join(" ");
		const muxCommand = result.muxArgs.join(" ");

		expect(result.duration).toBe(5.5);
		expect(videoCommand).toContain(
			"xfade=transition=fade:duration=0.5:offset=1.5"
		);
		expect(videoCommand).toContain("concat=n=2:v=1:a=0");
		expect(videoCommand).not.toContain("acrossfade");
		expect(audioCommand).toContain("acrossfade=d=0.5");
		expect(audioCommand).not.toContain("xfade");
		expect(muxCommand).toContain("-c copy");
	});

	it("mixes independent stickers and sound effects in the finishing pass", () => {
		const args = buildComposeFinishingArgs({
			input: "timeline.mp4",
			output: "final.mp4",
			duration: 4,
			canvasWidth: 640,
			canvasHeight: 360,
			fps: 30,
			overlays: [
				{
					path: "badge.png",
					overlay: {
						type: "sticker",
						source: "badge.png",
						start: 0.5,
						duration: 1,
						transform: { x: 0.1, y: 0.2, scale: 0.25, rotation: 0 },
						opacity: 1,
						fadeIn: 0,
						fadeOut: 0,
					},
				},
			],
			audio: [
				{
					sourcePath: "pop.wav",
					duration: 0.8,
					identity: { sha256: "a".repeat(64), bytes: 10 },
					media: {
						duration: 1,
						width: 0,
						height: 0,
						frameRate: 0,
						hasVideo: false,
						hasAudio: true,
					},
					audio: {
						type: "sound-effect",
						source: "pop.wav",
						start: 1,
						trim: { in: 0, out: 0.8 },
						volume: 0.5,
						fadeIn: 0,
						fadeOut: 0.1,
						volumeKeyframes: [],
					},
				},
			],
		});
		const command = args.join(" ");

		// Centre at ((1 + x) / 2, (1 + y) / 2) of the canvas and width 25% of
		// the 360 px short side, as in the editor.
		expect(command).toContain("scale=90:-1");
		expect(command).toContain("overlay=x=352-overlay_w/2:y=216-overlay_h/2");
		expect(command).toContain("volume=0.5");
		expect(command).toContain("adelay=1000:all=1");
		expect(command).toContain("amix=inputs=2");
		// A safety limiter that neither delays the mix nor lifts it to full scale.
		expect(command).toContain("alimiter=limit=0.95:level=0:latency=1");
	});

	it("gives a keyframed sound its envelope instead of a fixed volume", () => {
		const command = buildComposeFinishingArgs({
			input: "timeline.mp4",
			output: "final.mp4",
			duration: 4,
			canvasWidth: 640,
			canvasHeight: 360,
			fps: 30,
			overlays: [],
			audio: [
				{
					sourcePath: "music.wav",
					duration: 4,
					identity: { sha256: "b".repeat(64), bytes: 10 },
					media: {
						duration: 4,
						width: 0,
						height: 0,
						frameRate: 0,
						hasVideo: false,
						hasAudio: true,
					},
					audio: {
						type: "sound-effect",
						source: "music.wav",
						start: 0,
						trim: { in: 0 },
						volume: 1,
						fadeIn: 0,
						fadeOut: 0,
						volumeKeyframes: [
							{ time: 1, volumeDb: 0 },
							{ time: 2, volumeDb: -18 },
						],
					},
				},
			],
		}).join(" ");

		expect(command).toContain(
			"asetnsamples=n=256:p=0,volume='pow(10,(if(lt(t,1),0,if(lt(t,2),0+(-18)*(t-1)/1,-18)))/20)':eval=frame"
		);
		expect(command).not.toContain("volume=1,");
	});
});
