/**
 * ViMax CLI Subcommand Handlers
 *
 * Implements the 7 individual agent subcommands:
 * extract-characters, generate-script, generate-storyboard,
 * generate-portraits, create-registry, show-registry, list-models
 *
 * @module electron/native-pipeline/vimax-cli-handlers
 */

import * as fs from "fs";
import * as path from "path";
import type { CLIRunOptions, CLIResult } from "./cli-runner.js";
import { resolveOutputDir } from "./output-utils.js";
import { listModels } from "./cost-calculator.js";

type ProgressFn = (progress: {
  stage: string;
  percent: number;
  message: string;
  model?: string;
}) => void;

/** vimax:extract-characters — Extract characters from text using CharacterExtractor agent. */
export async function handleVimaxExtractCharacters(
  options: CLIRunOptions,
  onProgress: ProgressFn
): Promise<CLIResult> {
  const text = options.text || options.input;
  if (!text) {
    return {
      success: false,
      error: "Missing --text or --input (text or file path)",
    };
  }

  onProgress({
    stage: "starting",
    percent: 0,
    message: "Extracting characters...",
  });

  try {
    const { CharacterExtractor } = await import(
      "./vimax/agents/character-extractor.js"
    );

    let inputText = text;
    if (fs.existsSync(text)) {
      inputText = fs.readFileSync(text, "utf-8");
    }

    const startTime = Date.now();
    const extractor = new CharacterExtractor({
      model: options.llmModel,
    });

    const result = await extractor.process(inputText);

    onProgress({ stage: "complete", percent: 100, message: "Done" });

    if (!result.success) {
      return {
        success: false,
        error: `Character extraction failed: ${result.error}`,
      };
    }

    const outputDir = resolveOutputDir(options.outputDir, `cli-${Date.now()}`);
    const outputPath = path.join(outputDir, "characters.json");
    fs.writeFileSync(outputPath, JSON.stringify(result.result, null, 2));

    return {
      success: true,
      outputPath,
      duration: (Date.now() - startTime) / 1000,
      data: {
        characters: result.result,
        count: result.result?.length ?? 0,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Extract characters failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** vimax:generate-script — Generate screenplay from idea using Screenwriter agent. */
export async function handleVimaxGenerateScript(
  options: CLIRunOptions,
  onProgress: ProgressFn
): Promise<CLIResult> {
  const idea = options.idea || options.text;
  if (!idea) {
    return { success: false, error: "Missing --idea or --text" };
  }

  onProgress({
    stage: "starting",
    percent: 0,
    message: "Generating screenplay...",
  });

  try {
    const { Screenwriter } = await import("./vimax/agents/screenwriter.js");

    const startTime = Date.now();
    const writer = new Screenwriter({
      model: options.llmModel,
      target_duration: options.duration
        ? parseInt(options.duration, 10)
        : undefined,
    });

    const result = await writer.process(idea);

    onProgress({ stage: "complete", percent: 100, message: "Done" });

    if (!result.success) {
      return {
        success: false,
        error: `Script generation failed: ${result.error}`,
      };
    }

    const outputDir = resolveOutputDir(options.outputDir, `cli-${Date.now()}`);
    const outputPath = path.join(outputDir, "script.json");
    fs.writeFileSync(outputPath, JSON.stringify(result.result, null, 2));

    return {
      success: true,
      outputPath,
      duration: (Date.now() - startTime) / 1000,
      data: {
        title: result.result?.title,
        scenes: result.result?.scenes.length ?? 0,
        total_duration: result.result?.total_duration ?? 0,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Generate script failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** vimax:generate-storyboard — Generate storyboard images from script using StoryboardArtist. */
export async function handleVimaxGenerateStoryboard(
  options: CLIRunOptions,
  onProgress: ProgressFn
): Promise<CLIResult> {
  const scriptPath = options.script || options.input;
  if (!scriptPath) {
    return {
      success: false,
      error: "Missing --script or --input (script JSON path)",
    };
  }

  onProgress({
    stage: "starting",
    percent: 0,
    message: "Generating storyboard...",
  });

  try {
    const { StoryboardArtist } = await import(
      "./vimax/agents/storyboard-artist.js"
    );

    let scriptData: string;
    try {
      scriptData = fs.readFileSync(scriptPath, "utf-8");
    } catch {
      return { success: false, error: `Cannot read script: ${scriptPath}` };
    }

    const script = JSON.parse(scriptData);
    const startTime = Date.now();
    const sessionId = `cli-${Date.now()}`;
    const outputDir = resolveOutputDir(options.outputDir, sessionId);

    // Load portrait registry if --portraits is specified
    let portraitRegistry:
      | import("./vimax/types/character.js").CharacterPortraitRegistry
      | undefined;
    if (options.portraits) {
      try {
        const { CharacterPortraitRegistry } = await import(
          "./vimax/types/character.js"
        );
        const regContent = fs.readFileSync(options.portraits, "utf-8");
        portraitRegistry = CharacterPortraitRegistry.fromJSON(
          JSON.parse(regContent)
        );
      } catch {
        return {
          success: false,
          error: `Cannot read portrait registry: ${options.portraits}`,
        };
      }
    }

    const artist = new StoryboardArtist({
      image_model: options.imageModel,
      output_dir: outputDir,
      ...(options.style ? { style_prefix: options.style } : {}),
      ...(portraitRegistry ? { use_character_references: true } : {}),
      ...(options.referenceModel
        ? { reference_model: options.referenceModel }
        : {}),
      ...(options.referenceStrength != null
        ? { reference_strength: options.referenceStrength }
        : {}),
    });

    // If portrait registry is loaded, inject it into the script context
    if (portraitRegistry) {
      script._portrait_registry = portraitRegistry;
    }

    const result = await artist.process(script);

    onProgress({ stage: "complete", percent: 100, message: "Done" });

    if (!result.success) {
      return {
        success: false,
        error: `Storyboard generation failed: ${result.error}`,
      };
    }

    return {
      success: true,
      outputPath: outputDir,
      cost: result.result?.total_cost ?? 0,
      duration: (Date.now() - startTime) / 1000,
      data: {
        title: result.result?.title,
        images: result.result?.images.length ?? 0,
        total_cost: result.result?.total_cost ?? 0,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Generate storyboard failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** vimax:generate-portraits — Generate character portraits using CharacterPortraitsGenerator. */
export async function handleVimaxGeneratePortraits(
  options: CLIRunOptions,
  onProgress: ProgressFn
): Promise<CLIResult> {
  const text = options.text || options.input;
  if (!text) {
    return {
      success: false,
      error:
        "Missing --text or --input (text with characters, or character JSON path)",
    };
  }

  onProgress({
    stage: "starting",
    percent: 0,
    message: "Generating character portraits...",
  });

  try {
    const { CharacterExtractor } = await import(
      "./vimax/agents/character-extractor.js"
    );
    const { CharacterPortraitsGenerator } = await import(
      "./vimax/agents/character-portraits.js"
    );

    const startTime = Date.now();
    const sessionId = `cli-${Date.now()}`;
    const outputDir = resolveOutputDir(options.outputDir, sessionId);

    let characters;

    // Check if input is a JSON file with pre-extracted characters
    if (fs.existsSync(text) && text.endsWith(".json")) {
      const content = fs.readFileSync(text, "utf-8");
      const parsed = JSON.parse(content);
      characters = Array.isArray(parsed) ? parsed : parsed.characters;
    } else {
      // Extract characters from text first
      let inputText = text;
      if (fs.existsSync(text)) {
        inputText = fs.readFileSync(text, "utf-8");
      }

      onProgress({
        stage: "extracting",
        percent: 10,
        message: "Extracting characters from text...",
      });
      const extractor = new CharacterExtractor({ model: options.llmModel });
      const extractResult = await extractor.process(inputText);

      if (!extractResult.success || !extractResult.result) {
        return {
          success: false,
          error: `Character extraction failed: ${extractResult.error}`,
        };
      }
      characters = extractResult.result;
    }

    // Apply --max-characters limit (guard against NaN from bad CLI input)
    const rawMaxChars = options.maxCharacters ?? 5;
    const maxChars = Number.isNaN(rawMaxChars) ? 5 : rawMaxChars;
    if (characters.length > maxChars) {
      characters = characters.slice(0, maxChars);
    }

    // Parse --views (comma-separated: front,side,back,three_quarter)
    const views = options.views
      ? options.views.split(",").map((v: string) => v.trim())
      : undefined;

    onProgress({
      stage: "generating",
      percent: 30,
      message: `Generating portraits for ${characters.length} characters...`,
    });

    const generator = new CharacterPortraitsGenerator({
      image_model: options.imageModel,
      llm_model: options.llmModel,
      output_dir: path.join(outputDir, "portraits"),
      ...(views ? { views } : {}),
    });

    const batchResult = await generator.generateBatch(characters);

    onProgress({ stage: "complete", percent: 100, message: "Done" });

    if (!batchResult.success) {
      return {
        success: false,
        error: `Portrait generation failed: ${batchResult.error}`,
      };
    }

    const portraitCount = Object.keys(batchResult.result ?? {}).length;

    // Save portrait registry JSON (default: true, disable with --save-registry=false)
    const shouldSaveRegistry = options.saveRegistry !== false;
    let registryPath: string | undefined;
    if (shouldSaveRegistry && batchResult.result) {
      try {
        const { CharacterPortraitRegistry } = await import(
          "./vimax/types/character.js"
        );
        const registry = new CharacterPortraitRegistry(
          options.projectId || "cli-project"
        );
        for (const portrait of Object.values(
          batchResult.result as Record<
            string,
            import("./vimax/types/character.js").CharacterPortrait
          >
        )) {
          registry.addPortrait(portrait);
        }
        registryPath = path.join(outputDir, "portraits", "registry.json");
        fs.writeFileSync(
          registryPath,
          JSON.stringify(registry.toJSON(), null, 2)
        );
      } catch {
        // Non-fatal: registry save is optional
      }
    }

    return {
      success: true,
      outputPath: path.join(outputDir, "portraits"),
      cost: (batchResult.metadata.cost as number) ?? 0,
      duration: (Date.now() - startTime) / 1000,
      data: {
        characters: portraitCount,
        portraits_generated: portraitCount,
        registry_path: registryPath,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Generate portraits failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** vimax:create-registry — Create portrait registry from directory of portrait files. */
export async function handleVimaxCreateRegistry(
  options: CLIRunOptions
): Promise<CLIResult> {
  const portraitsDir = options.input;
  if (!portraitsDir) {
    return {
      success: false,
      error: "Missing --input (portraits directory path)",
    };
  }

  try {
    const { CharacterPortraitRegistry } = await import(
      "./vimax/types/character.js"
    );

    if (!fs.existsSync(portraitsDir)) {
      return {
        success: false,
        error: `Portraits directory not found: ${portraitsDir}`,
      };
    }

    const registry = new CharacterPortraitRegistry(
      options.projectId || "cli-project"
    );
    const entries = fs.readdirSync(portraitsDir, { withFileTypes: true });
    let characterCount = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const charDir = path.join(portraitsDir, entry.name);
      const portrait: Record<string, unknown> = {
        character_name: entry.name,
        description: "",
      };

      for (const viewFile of fs.readdirSync(charDir)) {
        const viewName = path
          .basename(viewFile, path.extname(viewFile))
          .toLowerCase();
        const viewPath = path.join(charDir, viewFile);

        if (!fs.statSync(viewPath).isFile()) continue;

        if (viewName === "front") portrait.front_view = viewPath;
        else if (viewName === "side") portrait.side_view = viewPath;
        else if (viewName === "back") portrait.back_view = viewPath;
        else if (viewName === "three_quarter")
          portrait.three_quarter_view = viewPath;
      }

      registry.addPortrait(
        portrait as unknown as import("./vimax/types/character.js").CharacterPortrait
      );
      characterCount++;
    }

    const registryData = registry.toJSON();
    const outputPath = path.join(portraitsDir, "registry.json");
    fs.writeFileSync(outputPath, JSON.stringify(registryData, null, 2));

    return {
      success: true,
      outputPath,
      data: {
        characters: characterCount,
        registry_path: outputPath,
        message: `Registry created with ${characterCount} characters`,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Create registry failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** vimax:show-registry — Display contents of a portrait registry file. */
export async function handleVimaxShowRegistry(
  options: CLIRunOptions
): Promise<CLIResult> {
  const registryPath = options.input;
  if (!registryPath) {
    return {
      success: false,
      error: "Missing --input (registry JSON file path)",
    };
  }

  try {
    const { CharacterPortraitRegistry, getPortraitViews } = await import(
      "./vimax/types/character.js"
    );

    if (!fs.existsSync(registryPath)) {
      return {
        success: false,
        error: `Registry file not found: ${registryPath}`,
      };
    }

    const content = fs.readFileSync(registryPath, "utf-8");
    const data = JSON.parse(content);
    const registry = CharacterPortraitRegistry.fromJSON(data);

    const characters = registry.listCharacters();
    const details: Record<string, unknown>[] = [];

    for (const name of characters) {
      const portrait = registry.getPortrait(name);
      if (!portrait) continue;

      const views = getPortraitViews(portrait);
      details.push({
        name,
        description: portrait.description || "(none)",
        views: Object.keys(views).join(", ") || "(none)",
        view_count: Object.keys(views).length,
      });
    }

    return {
      success: true,
      data: {
        project_id: registry.project_id,
        characters: details,
        total_characters: characters.length,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Show registry failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** vimax:idea2video — Full pipeline from idea to video. */
export async function handleVimaxIdea2Video(
  options: CLIRunOptions,
  onProgress: ProgressFn
): Promise<CLIResult> {
  const idea = options.idea || options.text;
  if (!idea) {
    return { success: false, error: "Missing --idea or --text" };
  }

  onProgress({
    stage: "starting",
    percent: 0,
    message: "Starting idea-to-video pipeline...",
  });

  try {
    const { Idea2VideoPipeline } = await import(
      "./vimax/pipelines/idea2video.js"
    );
    const sessionId = `cli-${Date.now()}`;
    const outputDir = resolveOutputDir(options.outputDir, sessionId);
    const startTime = Date.now();

    // Load config from YAML file if --config is specified
    const configOverrides: Record<string, unknown> = {};
    if (options.config) {
      try {
        const configContent = fs.readFileSync(options.config, "utf-8");
        // Simple YAML-like parsing for key: value pairs
        for (const line of configContent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const colonIdx = trimmed.indexOf(":");
          if (colonIdx > 0) {
            const key = trimmed.slice(0, colonIdx).trim();
            const val = trimmed.slice(colonIdx + 1).trim();
            configOverrides[key] =
              val === "true" ? true : val === "false" ? false : val;
          }
        }
      } catch {
        return {
          success: false,
          error: `Cannot read config: ${options.config}`,
        };
      }
    }

    // --no-references separates reference use from portrait generation
    const useReferences = !(options.noReferences ?? false);

    const pipeline = new Idea2VideoPipeline({
      output_dir: outputDir,
      generate_portraits: !(options.noPortraits ?? false),
      use_character_references: useReferences,
      video_model: options.videoModel,
      image_model: options.imageModel,
      llm_model: options.llmModel,
      target_duration: options.duration
        ? parseInt(options.duration, 10)
        : undefined,
      ...configOverrides,
    });

    const result = await pipeline.run(idea);

    return {
      success: result.success,
      outputPath: result.output?.final_video?.video_path,
      cost: result.total_cost,
      duration: (Date.now() - startTime) / 1000,
      data: {
        idea: result.idea,
        characters: result.characters.length,
        errors: result.errors,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Idea2Video failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** vimax:script2video — Pipeline from script JSON to video. */
export async function handleVimaxScript2Video(
  options: CLIRunOptions,
  onProgress: ProgressFn
): Promise<CLIResult> {
  const scriptPath = options.script || options.input;
  if (!scriptPath) {
    return { success: false, error: "Missing --script or --input (JSON path)" };
  }

  onProgress({
    stage: "starting",
    percent: 0,
    message: "Starting script-to-video pipeline...",
  });

  try {
    const { Script2VideoPipeline } = await import(
      "./vimax/pipelines/script2video.js"
    );
    const sessionId = `cli-${Date.now()}`;
    const outputDir = resolveOutputDir(options.outputDir, sessionId);
    const startTime = Date.now();

    let scriptData: string;
    try {
      scriptData = fs.readFileSync(scriptPath, "utf-8");
    } catch {
      return { success: false, error: `Cannot read script: ${scriptPath}` };
    }

    // Load portrait registry if --portraits is specified
    let portraitRegistry:
      | import("./vimax/types/character.js").CharacterPortraitRegistry
      | undefined;
    if (options.portraits) {
      try {
        const { CharacterPortraitRegistry } = await import(
          "./vimax/types/character.js"
        );
        const regContent = fs.readFileSync(options.portraits, "utf-8");
        portraitRegistry = CharacterPortraitRegistry.fromJSON(
          JSON.parse(regContent)
        );
      } catch {
        return {
          success: false,
          error: `Cannot read portrait registry: ${options.portraits}`,
        };
      }
    }

    const pipeline = new Script2VideoPipeline({
      output_dir: outputDir,
      video_model: options.videoModel,
      image_model: options.imageModel,
      use_character_references: !(options.noReferences ?? false),
    });

    const scriptObj = JSON.parse(scriptData);
    if (portraitRegistry) {
      scriptObj._portrait_registry = portraitRegistry;
    }

    const result = await pipeline.run(scriptObj);

    return {
      success: result.success,
      outputPath: result.output?.final_video?.video_path,
      cost: result.total_cost,
      duration: (Date.now() - startTime) / 1000,
      data: { errors: result.errors },
    };
  } catch (err) {
    return {
      success: false,
      error: `Script2Video failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** vimax:novel2movie — Pipeline from novel text to movie. */
export async function handleVimaxNovel2Movie(
  options: CLIRunOptions,
  onProgress: ProgressFn
): Promise<CLIResult> {
  const novelPath = options.novel || options.input;
  if (!novelPath) {
    return {
      success: false,
      error: "Missing --novel or --input (text file path)",
    };
  }

  onProgress({
    stage: "starting",
    percent: 0,
    message: "Starting novel-to-movie pipeline...",
  });

  try {
    const { Novel2MoviePipeline } = await import(
      "./vimax/pipelines/novel2movie.js"
    );
    const sessionId = `cli-${Date.now()}`;
    const outputDir = resolveOutputDir(options.outputDir, sessionId);
    const startTime = Date.now();

    let novelText: string;
    try {
      novelText = fs.readFileSync(novelPath, "utf-8");
    } catch {
      return { success: false, error: `Cannot read novel: ${novelPath}` };
    }

    const pipeline = new Novel2MoviePipeline({
      output_dir: outputDir,
      max_scenes: options.maxScenes,
      generate_portraits: !(options.noPortraits ?? false),
      use_character_references: true,
      scripts_only: options.scriptsOnly ?? false,
      storyboard_only: options.storyboardOnly ?? false,
      video_model: options.videoModel,
      image_model: options.imageModel,
      llm_model: options.llmModel,
    });

    const result = await pipeline.run(novelText, options.title);

    return {
      success: result.success,
      outputPath: result.output?.final_video?.video_path,
      cost: result.total_cost,
      duration: (Date.now() - startTime) / 1000,
      data: {
        novelTitle: result.novel_title,
        chapters: result.chapters.length,
        characters: result.characters.length,
        errors: result.errors,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Novel2Movie failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** vimax:list-models — List ViMax-specific models (image, video, LLM). */
export function handleVimaxListModels(): CLIResult {
  const vimaxCategories = new Set([
    "text_to_image",
    "text_to_video",
    "image_to_video",
    "image_to_image",
  ]);

  const allModels = listModels();
  const vimaxModels = allModels.filter((m) =>
    m.categories.some((c: string) => vimaxCategories.has(c))
  );

  const grouped: Record<
    string,
    { key: string; name: string; provider: string }[]
  > = {};
  for (const cat of vimaxCategories) {
    grouped[cat] = [];
  }

  for (const m of vimaxModels) {
    for (const cat of m.categories) {
      if (vimaxCategories.has(cat)) {
        grouped[cat].push({
          key: m.key,
          name: m.name,
          provider: m.provider,
        });
      }
    }
  }

  return {
    success: true,
    data: {
      models: vimaxModels.map((m) => ({
        key: m.key,
        name: m.name,
        provider: m.provider,
        categories: m.categories,
      })),
      count: vimaxModels.length,
      by_category: Object.fromEntries(
        Object.entries(grouped).map(([cat, models]) => [cat, models.length])
      ),
    },
  };
}
