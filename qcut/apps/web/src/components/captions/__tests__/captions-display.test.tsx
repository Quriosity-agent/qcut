import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SUBTITLE_STYLE } from "@/lib/captions/subtitle-style";
import type { TranscriptionSegment } from "@/types/captions";
import { WORD_FILTER_STATE } from "@/types/word-timeline";
import { CaptionsDisplay } from "../captions-display";

const segment: TranscriptionSegment = {
	id: 1,
	seek: 0,
	start: 0,
	end: 2,
	text: "Hello world",
	tokens: [],
	temperature: 0,
	avg_logprob: -0.5,
	compression_ratio: 1,
	no_speech_prob: 0,
};

describe("CaptionsDisplay", () => {
	it("uses the available canvas width for plain caption wrapping", () => {
		render(
			<CaptionsDisplay
				segments={[segment]}
				currentTime={0.5}
				canvasScale={0.5}
			/>
		);

		const layout = screen.getByTestId("caption-layout");
		expect(layout.style.display).toBe("flex");
		expect(layout.style.width).toBe("100%");
		expect(screen.getByText("Hello world").style.fontSize).toBe("24px");
	});

	it("breaks lines where the caption does, without an empty first or last line", () => {
		render(
			<CaptionsDisplay
				segments={[{ ...segment, text: "\nRound one\n第一回合\n" }]}
				currentTime={0.5}
			/>
		);

		const text = screen.getByText(/Round one/);
		expect(text.textContent).toBe("Round one\n第一回合");
		// pre-line draws the break as a new line, as both exports do.
		expect(text.style.whiteSpace).toBe("pre-line");
	});

	it("draws a bilingual caption's second line under it in its own look", () => {
		render(
			<CaptionsDisplay
				segments={[{ ...segment, text: "第一回合" }]}
				currentTime={0.5}
				canvasScale={0.5}
				subtitleStyle={{
					...DEFAULT_SUBTITLE_STYLE,
					fontSize: 34,
					bold: true,
					secondary: {
						fontFamily: "Futura",
						fontSize: 24,
						fontColor: "#ffcc00",
					},
				}}
				secondaryText=" Round one "
			/>
		);

		const second = screen.getByTestId("caption-secondary");
		expect(second.textContent).toBe("Round one");
		expect(second.style.fontFamily).toContain("Futura");
		expect(second.style.fontSize).toBe("12px");
		// Weight and slant left out are the caption's own.
		expect(second.style.fontWeight).toBe("bold");
		expect(second.style.fontStyle).toBe("normal");
		expect(second.style.color).toBe("rgb(255, 204, 0)");
		// The same box as the first line.
		expect(second.parentElement?.textContent).toBe("第一回合Round one");
	});

	it("renders timed words through the karaoke renderer", () => {
		render(
			<CaptionsDisplay
				segments={[segment]}
				currentTime={0.5}
				subtitleStyle={{
					...DEFAULT_SUBTITLE_STYLE,
					karaokeMode: "karaoke",
					highlightColor: "#22d3ee",
					upcomingColor: "#d4d4d8",
				}}
				words={[
					{
						id: "hello",
						text: "Hello",
						start: 0,
						end: 1,
						type: "word",
						filterState: WORD_FILTER_STATE.NONE,
					},
					{
						id: "world",
						text: "world",
						start: 1,
						end: 2,
						type: "word",
						filterState: WORD_FILTER_STATE.NONE,
					},
				]}
			/>
		);

		expect(screen.getByTestId("karaoke-renderer")).toHaveTextContent("Hello");
		expect(screen.getByText("Hello").getAttribute("style")).toContain(
			"-webkit-text-fill-color: transparent"
		);
		expect(screen.getByText("world")).toBeVisible();
	});
});
