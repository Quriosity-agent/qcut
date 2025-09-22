import { FFmpegFilterChain } from "../lib/ffmpeg-filter-chain";

describe("FFmpegFilterChain", () => {
  it("should convert brightness correctly", () => {
    const chain = new FFmpegFilterChain().addBrightness(20).build();
    expect(chain).toBe("eq=brightness=0.2");
  });

  it("should convert contrast correctly", () => {
    const chain = new FFmpegFilterChain().addContrast(10).build();
    expect(chain).toBe("eq=contrast=1.1");
  });

  it("should handle multiple effects", () => {
    const chain = new FFmpegFilterChain()
      .addBrightness(10)
      .addContrast(-5)
      .addBlur(3)
      .build();
    expect(chain).toBe("eq=brightness=0.1,eq=contrast=0.95,boxblur=3:1");
  });

  it("should handle static conversion", () => {
    const params = { brightness: 15, contrast: -10, blur: 2 };
    const chain = FFmpegFilterChain.fromEffectParameters(params);
    expect(chain).toBe("eq=brightness=0.15,eq=contrast=0.9,boxblur=2:1");
  });

  it("should handle saturation correctly", () => {
    const chain = new FFmpegFilterChain().addSaturation(50).build();
    expect(chain).toBe("eq=saturation=1.5");
  });

  it("should handle hue rotation correctly", () => {
    const chain = new FFmpegFilterChain().addHue(180).build();
    expect(chain).toBe("hue=h=180");
  });

  it("should handle negative values correctly", () => {
    const chain = new FFmpegFilterChain()
      .addBrightness(-30)
      .addContrast(-20)
      .build();
    expect(chain).toBe("eq=brightness=-0.3,eq=contrast=0.8");
  });

  it("should return empty string for no effects", () => {
    const chain = new FFmpegFilterChain().build();
    expect(chain).toBe("");
  });

  it("should handle empty parameters object", () => {
    const chain = FFmpegFilterChain.fromEffectParameters({});
    expect(chain).toBe("");
  });

  it("should handle partial parameters", () => {
    const params = { brightness: 25, blur: 1 };
    const chain = FFmpegFilterChain.fromEffectParameters(params);
    expect(chain).toBe("eq=brightness=0.25,boxblur=1:1");
  });

  it("should handle grayscale effect", () => {
    const params = { grayscale: 100 };
    const chain = FFmpegFilterChain.fromEffectParameters(params);
    expect(chain).toBe("hue=s=0");
  });

  it("should handle partial grayscale effect", () => {
    const params = { grayscale: 50 };
    const chain = FFmpegFilterChain.fromEffectParameters(params);
    expect(chain).toBe("hue=s=0.5");
  });
});
