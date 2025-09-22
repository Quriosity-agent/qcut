export interface EffectParameters {
  brightness?: number; // -100 to 100
  contrast?: number; // -100 to 100
  saturation?: number; // -100 to 100
  blur?: number; // 0 to 20
  hue?: number; // 0 to 360
  grayscale?: number; // 0 to 100
}

export class FFmpegFilterChain {
  private filters: string[] = [];

  addBrightness(value: number): this {
    const ffmpegValue = value / 100;
    this.filters.push(`eq=brightness=${ffmpegValue}`);
    return this;
  }

  addContrast(value: number): this {
    const ffmpegValue = 1 + value / 100;
    this.filters.push(`eq=contrast=${ffmpegValue}`);
    return this;
  }

  addSaturation(value: number): this {
    const ffmpegValue = 1 + value / 100;
    this.filters.push(`eq=saturation=${ffmpegValue}`);
    return this;
  }

  addBlur(radius: number): this {
    this.filters.push(`boxblur=${radius}:1`);
    return this;
  }

  addHue(degrees: number): this {
    this.filters.push(`hue=h=${degrees}`);
    return this;
  }

  addGrayscale(value: number): this {
    // FFmpeg grayscale: hue=s=0 removes all saturation (100% grayscale)
    // For partial grayscale, reduce saturation: hue=s=(1-value/100)
    const saturationValue = 1 - (value / 100);
    this.filters.push(`hue=s=${saturationValue}`);
    return this;
  }

  build(): string {
    return this.filters.join(",");
  }

  static fromEffectParameters(params: EffectParameters): string {
    const chain = new FFmpegFilterChain();

    if (params.brightness !== undefined) chain.addBrightness(params.brightness);
    if (params.contrast !== undefined) chain.addContrast(params.contrast);
    if (params.saturation !== undefined) chain.addSaturation(params.saturation);
    if (params.blur !== undefined) chain.addBlur(params.blur);
    if (params.hue !== undefined) chain.addHue(params.hue);
    if (params.grayscale !== undefined) chain.addGrayscale(params.grayscale);

    return chain.build();
  }
}
