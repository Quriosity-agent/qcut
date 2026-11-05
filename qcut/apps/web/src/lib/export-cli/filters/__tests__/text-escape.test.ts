import { describe, expect, it } from "vitest";
import { colorToFFmpeg } from "../text-escape";

describe("colorToFFmpeg", () => {
	it("writes hex and bare hex as FFmpeg colours", () => {
		expect(colorToFFmpeg("#ffffff")).toBe("0xffffff");
		expect(colorToFFmpeg("#F00")).toBe("0xff0000");
		expect(colorToFFmpeg("ff0000")).toBe("0xff0000");
	});

	it("writes a CSS colour as what it means, not 0xred", () => {
		expect(colorToFFmpeg("red")).toBe("0xff0000");
		expect(colorToFFmpeg("rgb(0, 255, 0)")).toBe("0x00ff00");
		expect(colorToFFmpeg("hsl(240, 100%, 50%)")).toBe("0x0000ff");
	});

	it("keeps a colour's own alpha", () => {
		expect(colorToFFmpeg("#ff000080")).toBe("0xff000080");
		expect(colorToFFmpeg("rgba(255, 0, 0, 0.5)")).toBe("0xff000080");
	});

	it("draws what it cannot read white rather than abort the filtergraph", () => {
		expect(colorToFFmpeg("oklch(0.6 0.2 30)")).toBe("0xffffff");
	});
});
