/**
 * Remotion Integration Module
 *
 * This module provides the integration layer between QCut and Remotion,
 * enabling the use of Remotion components within the QCut video editor.
 *
 * @module lib/remotion
 */

// Types
export * from "./types";

// Components
export {
  RemotionPlayerWrapper,
  RemotionPlayerLoading,
  RemotionPlayerError,
  type RemotionPlayerWrapperProps,
  type RemotionPlayerHandle,
} from "./player-wrapper";

// Sync Manager
export {
  SyncManager,
  useSyncManager,
  globalToLocalFrame,
  localToGlobalFrame,
  timeToFrame,
  frameToTime,
  getActiveElements,
  isElementActive,
  DEFAULT_SYNC_CONFIG,
} from "./sync-manager";

// Keyframe Converter
export {
  createKeyframe,
  sortKeyframes,
  interpolateNumber,
  interpolateColor,
  generateRemotionKeyframes,
  convertToRemotionAnimations,
  type Keyframe,
  type EasingType,
  type RemotionKeyframeConfig,
  type AnimatedPropConfig,
} from "./keyframe-converter";

// Schema Parser
export {
  parseComponentSchema,
  extractPropsFromCode,
  getDefaultValueForType,
  isNumericType,
  isColorType,
  type ComponentSchema,
  type PropDefinition,
  type PropType,
} from "./schema-parser";

// Pre-renderer
export {
  RemotionPreRenderer,
  createPreRenderer,
  estimateTotalFrames,
  estimateRenderTime,
  getElementsForPreRender,
  DEFAULT_PRE_RENDER_CONFIG,
  type PreRenderConfig,
  type PreRenderResult,
  type PreRenderProgressCallback,
  type RenderMode,
} from "./pre-renderer";

// Compositor
export {
  FrameCompositor,
  createCompositor,
  computeLayerOrder,
  getVisibleRemotionElements,
  DEFAULT_TRANSFORM,
  type BlendMode,
  type LayerTransform,
  type CompositeLayer,
  type CompositeResult,
} from "./compositor";

// Export Engine
export {
  RemotionExportEngine,
  createRemotionExportEngine,
  requiresRemotionExport,
  DEFAULT_REMOTION_EXPORT_CONFIG,
  type RemotionExportPhase,
  type RemotionExportProgress,
  type RemotionExportConfig,
  type RemotionExportProgressCallback,
} from "./export-engine-remotion";

// Built-in Components
export {
  // Text Components
  Typewriter,
  TypewriterSchema,
  TypewriterDefinition,
  typewriterDefaultProps,
  FadeInText,
  FadeInTextSchema,
  FadeInTextDefinition,
  fadeInTextDefaultProps,
  BounceText,
  BounceTextSchema,
  BounceTextDefinition,
  bounceTextDefaultProps,
  SlideText,
  SlideTextSchema,
  SlideTextDefinition,
  slideTextDefaultProps,
  ScaleText,
  ScaleTextSchema,
  ScaleTextDefinition,
  scaleTextDefaultProps,
  textComponentDefinitions,
  textComponentsById,
  getTextComponent,
  isTextComponent,
  // Transition Components
  Wipe,
  WipeSchema,
  WipeDefinition,
  wipeDefaultProps,
  Dissolve,
  DissolveSchema,
  DissolveDefinition,
  dissolveDefaultProps,
  Slide,
  SlideSchema,
  SlideDefinition,
  slideDefaultProps,
  Zoom,
  ZoomSchema,
  ZoomDefinition,
  zoomDefaultProps,
  transitionComponentDefinitions,
  transitionComponentsById,
  getTransitionComponent,
  isTransitionComponent,
  // Template Components
  LowerThird,
  LowerThirdSchema,
  LowerThirdDefinition,
  lowerThirdDefaultProps,
  TitleCard,
  TitleCardSchema,
  TitleCardDefinition,
  titleCardDefaultProps,
  IntroScene,
  IntroSceneSchema,
  IntroSceneDefinition,
  introSceneDefaultProps,
  OutroScene,
  OutroSceneSchema,
  OutroSceneDefinition,
  outroSceneDefaultProps,
  templateComponentDefinitions,
  templateComponentsById,
  getTemplateComponent,
  isTemplateComponent,
  // All Built-in Components
  builtInComponentDefinitions,
  builtInComponentsById,
  getBuiltInComponent,
  isBuiltInComponent,
  getBuiltInComponentsByCategory,
  searchBuiltInComponents,
  getBuiltInComponentCounts,
} from "./built-in";

// Re-export from @remotion/player for convenience
export { Player, type PlayerRef } from "@remotion/player";
