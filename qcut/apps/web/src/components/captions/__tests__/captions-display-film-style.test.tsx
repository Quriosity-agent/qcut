import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SUBTITLE_STYLE } from "@/lib/captions/subtitle-style";
import type { TranscriptionSegment } from "@/types/captions";
import { CaptionsDisplay } from "../captions-display";

/**
 * N25 (2026-10-30 trailer report): style D of the trailer's film subtitles
 * in the preview — SemiBold, its own spacing per line, two soft shadows
 * under both lines, a 4-frame fade-in and a 3-frame fade-out.
 */

const segment: TranscriptionSegment = {
	id: 1,
	seek: 0,
	start: 2,
	end: 3,
	text: "三年前",
	tokens: [],
	temperature: 0,
	avg_logprob: -0.5,
	compression_ratio: 1,
	no_speech_prob: 0,
};

const STYLE_D = {
	...DEFAULT_SUBTITLE_STYLE,
	fontFamily: "Source Han Serif CN",
	fontSize: 28,
	fontWeight: 600,
	bold: true,
	letterSpacing: 2.8,
	fontColor: "#f4efe6",
	outlineWidth: 0,
	bgOpacity: 0,
	shadows: [
		{ color: "#000000", opacity: 0.75, blur: 3.2, x: 0, y: 2 },
		{ color: "#000000", opacity: 0.38, blur: 18, x: 0, y: 0 },
	],
	fadeInFrames: 4,
	fadeOutFrames: 3,
	secondary: {
		fontFamily: "Gill Sans",
		fontSize: 22,
		bold: false,
		letterSpacing: 0.66,
		fontColor: "#ded6c6",
	},
};

function show(currentTime: number) {
	return render(
		<CaptionsDisplay
			segments={[segment]}
			currentTime={currentTime}
			canvasScale={2}
			subtitleStyle={STYLE_D}
			secondaryText="Three years ago"
			fps={24}
		/>
	);
}

describe("film subtitles in the preview", () => {
	it("casts both shadows from a see-through copy under both lines", () => {
		show(2.5);
		const shadows = screen.getByTestId("caption-shadows");
		expect(shadows.style.textShadow).toBe(
			"0px 4px 6.4px rgba(0, 0, 0, 0.75), 0px 0px 36px rgba(0, 0, 0, 0.38)"
		);
		expect(shadows.style.color).toBe("transparent");
		expect(shadows.style.zIndex).toBe("-1");
		expect(shadows.textContent).toBe("三年前Three years ago");
		// The text itself casts none; its box keeps the shadows behind it.
		const box = shadows.parentElement as HTMLElement;
		expect(box.style.textShadow).toBe("none");
		expect(box.style.isolation).toBe("isolate");
		expect(box.style.fontWeight).toBe("600");
		expect(box.style.letterSpacing).toBe("5.6px");
	});

	it("gives the second line its own weight and spacing", () => {
		show(2.5);
		const second = screen.getByTestId("caption-secondary");
		expect(second.style.fontWeight).toBe("normal");
		expect(second.style.letterSpacing).toBe("1.32px");
		expect(second.style.color).toBe("rgb(222, 214, 198)");
	});

	it("fades in over 4 frames and out over 3", () => {
		const opacity = (time: number) => {
			const { unmount } = show(time);
			const value = screen.getByTestId("caption-layout").style.opacity;
			unmount();
			return Number(value).toFixed(3);
		};
		expect([2, 2 + 1 / 24, 2 + 2 / 24, 2 + 4 / 24].map(opacity)).toEqual([
			"0.000",
			"0.250",
			"0.500",
			"1.000",
		]);
		expect(opacity(3 - 1 / 24)).toBe("0.333");
	});
});
