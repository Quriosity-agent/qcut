/**
 * Reference Image Selector Agent
 *
 * Intelligently selects the best character reference image for each shot
 * based on camera angle, shot type, and visible characters.
 *
 * Ported from: vimax/agents/reference_selector.py
 */

import {
  BaseAgent,
  type AgentConfig,
  type AgentResult,
  createAgentConfig,
  agentOk,
} from "./base-agent.js";
import type { ShotDescription } from "../types/shot.js";
import type { CharacterPortrait } from "../types/character.js";
import {
  CharacterPortraitRegistry,
  getPortraitViews,
  hasPortraitViews,
} from "../types/character.js";

export interface ReferenceSelectorConfig extends AgentConfig {
  use_llm_for_selection: boolean;
  llm_model: string;
}

export function createReferenceSelectorConfig(
  partial?: Partial<ReferenceSelectorConfig>
): ReferenceSelectorConfig {
  return {
    ...createAgentConfig({ name: "ReferenceImageSelector" }),
    use_llm_for_selection: false,
    llm_model: "kimi-k2.5",
    ...partial,
  };
}

export interface ReferenceSelectionResult {
  shot_id: string;
  selected_references: Record<string, string>;
  primary_reference?: string;
  selection_reason: string;
}

/** Camera angle → portrait view mapping. */
const ANGLE_TO_VIEW: Record<string, string> = {
  front: "front",
  eye_level: "front",
  straight_on: "front",
  face_on: "front",
  side: "side",
  profile: "side",
  left: "side",
  right: "side",
  back: "back",
  behind: "back",
  rear: "back",
  three_quarter: "three_quarter",
  "45_degree": "three_quarter",
  angled: "three_quarter",
};

/** Shot type → preferred view order. */
const SHOT_TYPE_PREFERENCE: Record<string, string[]> = {
  close_up: ["front", "three_quarter"],
  extreme_close_up: ["front"],
  medium: ["front", "three_quarter", "side"],
  wide: ["front", "side", "back"],
  establishing: ["front", "side"],
  over_the_shoulder: ["back", "three_quarter"],
  two_shot: ["front", "three_quarter", "side"],
  pov: [],
  insert: [],
};

export class ReferenceImageSelector extends BaseAgent<
  ShotDescription,
  ReferenceSelectionResult
> {
  constructor(config?: Partial<ReferenceSelectorConfig>) {
    super(createReferenceSelectorConfig(config));
  }

  async initialize(): Promise<boolean> {
    return true;
  }

  async process(
    shot: ShotDescription
  ): Promise<AgentResult<ReferenceSelectionResult>> {
    // Interface compatibility — use selectForShot() with registry instead
    return agentOk({
      shot_id: shot.shot_id,
      selected_references: {},
      selection_reason:
        "Use selectForShot() with registry for actual selection",
    });
  }

  /** Select best references for a single shot. */
  async selectForShot(
    shot: ShotDescription,
    registry: CharacterPortraitRegistry
  ): Promise<ReferenceSelectionResult> {
    const selected: Record<string, string> = {};
    const reasons: string[] = [];

    for (const charName of shot.characters) {
      const [portrait, matchedName] = this._findPortrait(charName, registry);
      if (!portrait) {
        reasons.push(`No portrait found for '${charName}'`);
        continue;
      }
      if (matchedName !== charName) {
        console.log(
          `[ref_selector] Fuzzy matched '${charName}' -> '${matchedName}'`
        );
      }

      if (!hasPortraitViews(portrait)) {
        reasons.push(`No views available for '${charName}'`);
        continue;
      }

      const bestView = this._selectBestView(
        portrait,
        shot.camera_angle,
        typeof shot.shot_type === "string" ? shot.shot_type : shot.shot_type
      );

      if (bestView) {
        selected[charName] = bestView;
        reasons.push(
          `${charName}: selected '${bestView}' (angle=${shot.camera_angle}, type=${shot.shot_type})`
        );
      }
    }

    const primaryValues = Object.values(selected);
    const primary = primaryValues.length > 0 ? primaryValues[0] : undefined;

    return {
      shot_id: shot.shot_id,
      selected_references: selected,
      primary_reference: primary,
      selection_reason:
        reasons.length > 0 ? reasons.join("; ") : "No references selected",
    };
  }

  /**
   * Get ordered view preference for a shot type and camera angle.
   * Returns an ordered list of preferred portrait views.
   */
  getViewPreference(shotType: string, cameraAngle?: string): string[] {
    const preferences: string[] = [];

    // Camera angle takes priority
    if (cameraAngle) {
      const angleView = ANGLE_TO_VIEW[cameraAngle.toLowerCase()];
      if (angleView) preferences.push(angleView);
    }

    // Then shot type preferences
    const shotPrefs = SHOT_TYPE_PREFERENCE[shotType] ?? ["front"];
    for (const pref of shotPrefs) {
      if (!preferences.includes(pref)) preferences.push(pref);
    }

    // Always include front as fallback
    if (!preferences.includes("front")) preferences.push("front");

    return preferences;
  }

  /** Select references for multiple shots. */
  async selectForShots(
    shots: ShotDescription[],
    registry: CharacterPortraitRegistry
  ): Promise<ReferenceSelectionResult[]> {
    const results: ReferenceSelectionResult[] = [];
    for (const shot of shots) {
      results.push(await this.selectForShot(shot, registry));
    }
    return results;
  }

  /**
   * Find a portrait by name with fuzzy fallback.
   *
   * Tries: exact → case-insensitive → substring → word overlap.
   */
  private _findPortrait(
    charName: string,
    registry: CharacterPortraitRegistry
  ): [CharacterPortrait | undefined, string] {
    // 1. Exact match
    const exact = registry.getPortrait(charName);
    if (exact) return [exact, charName];

    // 2. Case-insensitive
    const charLower = charName.toLowerCase();
    for (const regName of registry.listCharacters()) {
      if (regName.toLowerCase() === charLower) {
        return [registry.getPortrait(regName), regName];
      }
    }

    // 3. Substring match
    for (const regName of registry.listCharacters()) {
      const regLower = regName.toLowerCase();
      if (regLower.includes(charLower) || charLower.includes(regLower)) {
        return [registry.getPortrait(regName), regName];
      }
    }

    // 4. Word overlap
    const charWords = new Set(charLower.replace(/[()]/g, "").split(/\s+/));
    let bestMatch: string | undefined;
    let bestOverlap = 0;

    for (const regName of registry.listCharacters()) {
      const regWords = new Set(regName.toLowerCase().split(/\s+/));
      let overlap = 0;
      for (const word of charWords) {
        if (regWords.has(word)) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = regName;
      }
    }

    if (bestMatch && bestOverlap >= 1) {
      return [registry.getPortrait(bestMatch), bestMatch];
    }

    return [undefined, charName];
  }

  /** Select best portrait view for camera settings. */
  private _selectBestView(
    portrait: CharacterPortrait,
    cameraAngle: string,
    shotType: string
  ): string | undefined {
    const views = getPortraitViews(portrait);
    const viewKeys = Object.keys(views);
    if (viewKeys.length === 0) return;

    // Step 1: Try to match camera angle
    const preferredView = ANGLE_TO_VIEW[cameraAngle.toLowerCase()] ?? "front";
    if (preferredView in views) return views[preferredView];

    // Step 2: Fall back to shot type preferences
    const preferences = SHOT_TYPE_PREFERENCE[shotType] ?? ["front"];
    for (const pref of preferences) {
      if (pref in views) return views[pref];
    }

    // Step 3: Any available view
    return Object.values(views)[0];
  }
}
