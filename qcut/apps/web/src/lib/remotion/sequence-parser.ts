/**
 * AST-based Sequence Parser for Remotion Components
 *
 * Parses component source code to automatically detect `<Sequence>` and
 * `<TransitionSeries>` elements and extract their props.
 *
 * @module lib/remotion/sequence-parser
 */

import { parse, type ParserOptions } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

// ============================================================================
// Types
// ============================================================================

/**
 * A parsed sequence from the component source code.
 * Values may be "dynamic" if they are computed at runtime.
 */
export interface ParsedSequence {
  /** Name from the name prop, if provided */
  name: string | null;
  /** Starting frame (0-based) or "dynamic" if computed */
  from: number | "dynamic";
  /** Duration in frames or "dynamic" if computed */
  durationInFrames: number | "dynamic";
  /** Source line number for debugging */
  line: number;
  /** Whether this is inside a TransitionSeries */
  isTransitionSequence: boolean;
}

/**
 * A parsed transition between sequences.
 */
export interface ParsedTransition {
  /** Duration of the transition or "dynamic" if computed */
  durationInFrames: number | "dynamic";
  /** Presentation type (fade, slide, wipe, etc.) */
  presentation: string | null;
  /** Index of the sequence this transition follows (0-based) */
  afterSequenceIndex: number;
  /** Source line number for debugging */
  line: number;
}

/**
 * Complete parsed structure from a component's source code.
 */
export interface ParsedStructure {
  /** All sequences found in the component */
  sequences: ParsedSequence[];
  /** All transitions found (only in TransitionSeries) */
  transitions: ParsedTransition[];
  /** Whether the component uses TransitionSeries */
  usesTransitionSeries: boolean;
  /** Any parsing errors encountered */
  errors: string[];
}

// ============================================================================
// Constants
// ============================================================================

/** Element names that represent sequences */
const SEQUENCE_ELEMENTS = new Set([
  "Sequence",
  "TransitionSeries.Sequence",
  "TS.Sequence",
]);

/** Element names that represent transitions */
const TRANSITION_ELEMENTS = new Set([
  "TransitionSeries.Transition",
  "TS.Transition",
]);

/** Parser options for Babel */
const PARSER_OPTIONS: ParserOptions = {
  sourceType: "module",
  plugins: [
    "jsx",
    "typescript",
    "decorators-legacy",
    "classProperties",
    "objectRestSpread",
  ],
  errorRecovery: true,
};

// ============================================================================
// Main Parser Function
// ============================================================================

/**
 * Extract sequences and transitions from Remotion component source code.
 *
 * @param sourceCode - The TypeScript/JSX source code to parse
 * @returns Parsed structure containing sequences, transitions, and metadata
 *
 * @example
 * ```typescript
 * const source = `
 *   <TransitionSeries>
 *     <TS.Sequence durationInFrames={60} name="Intro">
 *       <IntroScene />
 *     </TS.Sequence>
 *     <TS.Transition timing={springTiming({ durationInFrames: 15 })} />
 *     <TS.Sequence durationInFrames={90} name="Main">
 *       <MainScene />
 *     </TS.Sequence>
 *   </TransitionSeries>
 * `;
 *
 * const result = extractSequencesFromSource(source);
 * // result.sequences = [
 * //   { name: "Intro", from: 0, durationInFrames: 60, ... },
 * //   { name: "Main", from: "dynamic", durationInFrames: 90, ... }
 * // ]
 * // result.transitions = [
 * //   { durationInFrames: 15, presentation: "spring", ... }
 * // ]
 * ```
 */
export function extractSequencesFromSource(sourceCode: string): ParsedStructure {
  const result: ParsedStructure = {
    sequences: [],
    transitions: [],
    usesTransitionSeries: false,
    errors: [],
  };

  if (!sourceCode || sourceCode.trim().length === 0) {
    return result;
  }

  let ast: ReturnType<typeof parse>;

  try {
    ast = parse(sourceCode, PARSER_OPTIONS);

    // Capture parser recovery errors (errorRecovery: true stores errors on AST)
    if (ast.errors && ast.errors.length > 0) {
      for (const err of ast.errors) {
        result.errors.push(
          `Parse error at line ${err.loc?.line ?? "unknown"}: ${err.message}`
        );
      }
    }
  } catch (error) {
    result.errors.push(
      `Failed to parse source code: ${error instanceof Error ? error.message : String(error)}`
    );
    return result;
  }

  // Track sequence index for associating transitions
  let sequenceIndex = 0;

  // Track if we're inside a TransitionSeries
  let insideTransitionSeries = false;

  try {
    traverse(ast, {
      JSXElement: {
        enter(path) {
          const elementName = getElementName(path.node.openingElement.name);

          // Detect TransitionSeries container
          if (elementName === "TransitionSeries") {
            result.usesTransitionSeries = true;
            insideTransitionSeries = true;
          }

          // Detect sequences
          if (isSequenceElement(elementName)) {
            const sequenceProps = extractSequenceProps(path.node);
            result.sequences.push({
              ...sequenceProps,
              isTransitionSequence:
                insideTransitionSeries ||
                elementName.includes("TransitionSeries") ||
                elementName.startsWith("TS."),
            });
            sequenceIndex++;
          }

          // Detect transitions
          if (isTransitionElement(elementName)) {
            const transitionProps = extractTransitionProps(path.node);
            result.transitions.push({
              ...transitionProps,
              afterSequenceIndex: sequenceIndex - 1,
            });
          }
        },
        exit(path) {
          const elementName = getElementName(path.node.openingElement.name);
          if (elementName === "TransitionSeries") {
            insideTransitionSeries = false;
          }
        },
      },
    });
  } catch (error) {
    result.errors.push(
      `Error traversing AST: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the string name of a JSX element, handling member expressions.
 */
function getElementName(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string {
  if (t.isJSXIdentifier(name)) {
    return name.name;
  }

  if (t.isJSXMemberExpression(name)) {
    // Handle: TransitionSeries.Sequence, TS.Sequence
    const objectName = t.isJSXIdentifier(name.object)
      ? name.object.name
      : t.isJSXMemberExpression(name.object)
        ? getElementName(name.object)
        : "";
    const propertyName = t.isJSXIdentifier(name.property)
      ? name.property.name
      : "";
    return `${objectName}.${propertyName}`;
  }

  if (t.isJSXNamespacedName(name)) {
    return `${name.namespace.name}:${name.name.name}`;
  }

  return "";
}

/**
 * Check if an element name represents a Sequence component.
 */
function isSequenceElement(name: string): boolean {
  return SEQUENCE_ELEMENTS.has(name);
}

/**
 * Check if an element name represents a Transition component.
 */
function isTransitionElement(name: string): boolean {
  return TRANSITION_ELEMENTS.has(name);
}

/**
 * Extract props from a Sequence element.
 */
function extractSequenceProps(
  node: t.JSXElement
): Omit<ParsedSequence, "isTransitionSequence"> {
  const props = extractJSXProps(node.openingElement.attributes);

  return {
    name: typeof props.name === "string" ? props.name : null,
    from: typeof props.from === "number" ? props.from : props.from === undefined ? 0 : "dynamic",
    durationInFrames:
      typeof props.durationInFrames === "number"
        ? props.durationInFrames
        : "dynamic",
    line: node.loc?.start.line ?? 0,
  };
}

/**
 * Extract props from a Transition element.
 */
function extractTransitionProps(
  node: t.JSXElement
): Omit<ParsedTransition, "afterSequenceIndex"> {
  const props = extractJSXProps(node.openingElement.attributes);

  // Filter out boolean values as they're not valid for timing/presentation
  const timing = typeof props.timing === "boolean" ? undefined : props.timing;
  const presentation = typeof props.presentation === "boolean" ? undefined : props.presentation;

  return {
    durationInFrames: extractTimingDuration(timing),
    presentation: extractPresentationName(presentation),
    line: node.loc?.start.line ?? 0,
  };
}

/**
 * Extract all JSX props as a key-value map.
 * Handles string literals, numeric literals, and marks expressions as "dynamic".
 */
function extractJSXProps(
  attributes: (t.JSXAttribute | t.JSXSpreadAttribute)[]
): Record<string, string | number | boolean | "dynamic" | t.Expression> {
  const props: Record<string, string | number | boolean | "dynamic" | t.Expression> = {};

  for (const attr of attributes) {
    if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name)) {
      continue;
    }

    const name = attr.name.name;
    const value = attr.value;

    if (value === null) {
      // Boolean attribute like <Sequence layout />
      props[name] = true;
    } else if (t.isStringLiteral(value)) {
      props[name] = value.value;
    } else if (t.isJSXExpressionContainer(value)) {
      const expr = value.expression;

      if (t.isNumericLiteral(expr)) {
        props[name] = expr.value;
      } else if (t.isStringLiteral(expr)) {
        props[name] = expr.value;
      } else if (t.isTemplateLiteral(expr) && expr.quasis.length === 1) {
        // Simple template literal without expressions
        props[name] = expr.quasis[0].value.raw;
      } else if (!t.isJSXEmptyExpression(expr)) {
        // Keep the expression for further analysis
        props[name] = expr;
      }
    }
  }

  return props;
}

/**
 * Try to extract duration from a timing function call.
 *
 * Handles patterns like:
 * - `springTiming({ durationInFrames: 30 })`
 * - `linearTiming({ durationInFrames: 30 })`
 */
function extractTimingDuration(
  timing: string | number | "dynamic" | t.Expression | undefined
): number | "dynamic" {
  if (typeof timing === "number") {
    return timing;
  }

  if (!timing || typeof timing === "string") {
    return "dynamic";
  }

  // Check if it's a call expression like springTiming({ ... })
  if (t.isCallExpression(timing) && timing.arguments.length > 0) {
    const arg = timing.arguments[0];

    if (t.isObjectExpression(arg)) {
      // Look for durationInFrames property
      for (const prop of arg.properties) {
        if (
          t.isObjectProperty(prop) &&
          t.isIdentifier(prop.key) &&
          prop.key.name === "durationInFrames" &&
          t.isNumericLiteral(prop.value)
        ) {
          return prop.value.value;
        }
      }

      // Look for config.damping to estimate spring duration
      // Spring animations typically complete in ~20-30 frames with default config
      for (const prop of arg.properties) {
        if (
          t.isObjectProperty(prop) &&
          t.isIdentifier(prop.key) &&
          prop.key.name === "config" &&
          t.isObjectExpression(prop.value)
        ) {
          // Has config object, likely a spring timing
          // We can't calculate exact duration without running the animation
          return "dynamic";
        }
      }
    }
  }

  return "dynamic";
}

/**
 * Try to extract the presentation name from a presentation function call.
 *
 * Handles patterns like:
 * - `fade()`
 * - `slide({ direction: "from-left" })`
 * - `wipe()`
 */
function extractPresentationName(
  presentation: string | number | "dynamic" | t.Expression | undefined
): string | null {
  if (typeof presentation === "string") {
    return presentation;
  }

  if (!presentation || typeof presentation === "number") {
    return null;
  }

  // Check if it's a call expression like fade(), slide(), etc.
  if (t.isCallExpression(presentation)) {
    const callee = presentation.callee;

    if (t.isIdentifier(callee)) {
      return callee.name;
    }

    // Handle member expressions like Transitions.fade()
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
      return callee.property.name;
    }
  }

  return null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert parsed structure to SequenceStructure format for visualization.
 * Only includes sequences/transitions with known (non-dynamic) values.
 */
export function toSequenceStructure(
  parsed: ParsedStructure,
  defaultDuration = 30
): import("./types").SequenceStructure | null {
  if (parsed.sequences.length === 0) {
    return null;
  }

  const sequences: import("./types").SequenceMetadata[] = [];
  let currentFrom = 0;

  for (const seq of parsed.sequences) {
    const duration =
      seq.durationInFrames === "dynamic"
        ? defaultDuration
        : seq.durationInFrames;

    sequences.push({
      name: seq.name ?? `Sequence ${sequences.length + 1}`,
      from: currentFrom,
      durationInFrames: duration,
    });

    currentFrom += duration;
  }

  // Only include transitions if we have valid durations
  const transitions: import("./types").TransitionMetadata[] = [];

  for (const trans of parsed.transitions) {
    if (
      trans.afterSequenceIndex >= 0 &&
      trans.afterSequenceIndex < sequences.length - 1
    ) {
      const duration =
        trans.durationInFrames === "dynamic" ? 15 : trans.durationInFrames;

      transitions.push({
        afterSequenceIndex: trans.afterSequenceIndex,
        durationInFrames: duration,
        presentation: (trans.presentation as "fade" | "slide" | "wipe" | "zoom" | "custom") ?? undefined,
      });

      // Adjust subsequent sequence positions for overlap
      for (let i = trans.afterSequenceIndex + 1; i < sequences.length; i++) {
        sequences[i].from -= duration;
      }
    }
  }

  return {
    sequences,
    transitions: transitions.length > 0 ? transitions : undefined,
  };
}

/**
 * Check if a parsed structure has any dynamic values.
 */
export function hasDynamicValues(parsed: ParsedStructure): boolean {
  for (const seq of parsed.sequences) {
    if (seq.from === "dynamic" || seq.durationInFrames === "dynamic") {
      return true;
    }
  }

  for (const trans of parsed.transitions) {
    if (trans.durationInFrames === "dynamic") {
      return true;
    }
  }

  return false;
}
