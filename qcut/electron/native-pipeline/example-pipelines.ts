/**
 * Example Pipeline Generator
 *
 * Creates sample YAML pipeline configurations for users to learn from.
 *
 * @module electron/native-pipeline/example-pipelines
 */

import * as fs from "fs";
import * as path from "path";

const EXAMPLES: Record<string, string> = {
	"text-to-video-basic.yaml": `# Basic text-to-video pipeline
name: text-to-video-basic
steps:
  - type: text_to_video
    model: kling_2_6_pro
    params:
      duration: "5"
      aspect_ratio: "16:9"
config:
  save_intermediates: false
`,

	"image-to-video-chain.yaml": `# Image generation then video creation
name: image-to-video-chain
steps:
  - type: text_to_image
    model: flux_dev
    params:
      image_size: landscape_16_9
  - type: image_to_video
    model: kling_2_6_pro_i2v
    params:
      duration: "5"
config:
  save_intermediates: true
`,

	"multi-step-pipeline.yaml": `# Multi-step: prompt enhancement + image + video
name: multi-step-pipeline
steps:
  - type: prompt_generation
    model: openrouter_video_cinematic
    params: {}
  - type: text_to_image
    model: flux_dev
    params:
      image_size: landscape_16_9
  - type: image_to_video
    model: wan_2_6
    params:
      duration: "5"
config:
  save_intermediates: true
`,

	"parallel-pipeline.yaml": `# Parallel image generation with different models
name: parallel-pipeline
steps:
  - type: parallel_group
    merge_strategy: COLLECT_ALL
    steps:
      - type: text_to_image
        model: flux_dev
        params:
          image_size: landscape_16_9
      - type: text_to_image
        model: flux_schnell
        params:
          image_size: landscape_16_9
config:
  parallel: true
  save_intermediates: true
`,

	"avatar-generation.yaml": `# Avatar video generation
name: avatar-generation
steps:
  - type: avatar
    model: omnihuman_v1_5
    params:
      resolution: "1080p"
config:
  save_intermediates: false
`,
};

export function createExamples(outputDir: string): string[] {
	fs.mkdirSync(outputDir, { recursive: true });
	const created: string[] = [];

	for (const [filename, content] of Object.entries(EXAMPLES)) {
		const filePath = path.join(outputDir, filename);
		fs.writeFileSync(filePath, content, "utf-8");
		created.push(filePath);
	}

	return created;
}

export function getExampleNames(): string[] {
	return Object.keys(EXAMPLES);
}
