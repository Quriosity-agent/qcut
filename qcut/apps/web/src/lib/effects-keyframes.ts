import { EffectKeyframe, AnimatedParameter, EffectParameters } from "@/types/effects";

/**
 * Easing functions for smooth animations
 */
const easingFunctions = {
  linear: (t: number) => t,
  "ease-in": (t: number) => t * t,
  "ease-out": (t: number) => t * (2 - t),
  "ease-in-out": (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  "cubic-bezier": (t: number, cp: [number, number, number, number]) => {
    // Simplified cubic bezier approximation
    const [x1, y1, x2, y2] = cp;
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;
    
    // Newton-Raphson iteration to find t for given x
    let t2 = t;
    for (let i = 0; i < 4; i++) {
      const x = ((ax * t2 + bx) * t2 + cx) * t2;
      const dx = (3 * ax * t2 + 2 * bx) * t2 + cx;
      if (Math.abs(x - t) < 0.001) break;
      t2 -= (x - t) / dx;
    }
    
    return ((ay * t2 + by) * t2 + cy) * t2;
  },
};

/**
 * Find the two keyframes that surround a given time
 */
function findSurroundingKeyframes(
  keyframes: EffectKeyframe[],
  time: number
): [EffectKeyframe | null, EffectKeyframe | null] {
  if (keyframes.length === 0) return [null, null];
  if (keyframes.length === 1) return [keyframes[0], keyframes[0]];
  
  // Sort keyframes by time
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  
  // Before first keyframe
  if (time <= sorted[0].time) {
    return [sorted[0], sorted[0]];
  }
  
  // After last keyframe
  if (time >= sorted[sorted.length - 1].time) {
    return [sorted[sorted.length - 1], sorted[sorted.length - 1]];
  }
  
  // Find surrounding keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      return [sorted[i], sorted[i + 1]];
    }
  }
  
  return [null, null];
}

/**
 * Interpolate a value between two keyframes
 */
export function interpolateKeyframes(
  keyframes: EffectKeyframe[],
  time: number,
  interpolation: "linear" | "step" | "smooth" = "linear"
): number {
  const [kf1, kf2] = findSurroundingKeyframes(keyframes, time);
  
  if (!kf1 || !kf2) return 0;
  if (kf1 === kf2) return kf1.value;
  
  // Step interpolation
  if (interpolation === "step") {
    return kf1.value;
  }
  
  // Calculate progress between keyframes
  const duration = kf2.time - kf1.time;
  const elapsed = time - kf1.time;
  let progress = elapsed / duration;
  
  // Apply easing
  const easing = kf1.easing || "linear";
  if (easing === "cubic-bezier" && kf1.controlPoints) {
    progress = easingFunctions["cubic-bezier"](progress, kf1.controlPoints as [number, number, number, number]);
  } else if (easing in easingFunctions && easing !== "cubic-bezier") {
    progress = easingFunctions[easing as keyof typeof easingFunctions](progress);
  }
  
  // Smooth interpolation with cubic hermite spline
  if (interpolation === "smooth") {
    const t = progress;
    const t2 = t * t;
    const t3 = t2 * t;
    const h1 = 2 * t3 - 3 * t2 + 1;
    const h2 = -2 * t3 + 3 * t2;
    const h3 = t3 - 2 * t2 + t;
    const h4 = t3 - t2;
    
    // Estimate tangents (simplified)
    const m1 = 0; // Could be calculated from neighboring keyframes
    const m2 = 0;
    
    return h1 * kf1.value + h2 * kf2.value + h3 * m1 * duration + h4 * m2 * duration;
  }
  
  // Linear interpolation
  return kf1.value + (kf2.value - kf1.value) * progress;
}

/**
 * Get animated parameter values at a specific time
 */
export function getAnimatedParameters(
  animations: AnimatedParameter[] | undefined,
  time: number,
  baseParameters: EffectParameters
): EffectParameters {
  if (!animations || animations.length === 0) {
    return baseParameters;
  }
  
  const animatedParams = { ...baseParameters };
  
  for (const animation of animations) {
    const value = interpolateKeyframes(
      animation.keyframes,
      time,
      animation.interpolation
    );
    (animatedParams as any)[animation.parameter] = value;
  }
  
  return animatedParams;
}

/**
 * Add a keyframe to an animated parameter
 */
export function addKeyframe(
  animation: AnimatedParameter,
  time: number,
  value: number,
  easing?: EffectKeyframe["easing"]
): AnimatedParameter {
  const newKeyframe: EffectKeyframe = { time, value, easing };
  const keyframes = [...animation.keyframes, newKeyframe].sort((a, b) => a.time - b.time);
  
  return {
    ...animation,
    keyframes,
  };
}

/**
 * Remove a keyframe from an animated parameter
 */
export function removeKeyframe(
  animation: AnimatedParameter,
  time: number
): AnimatedParameter {
  const keyframes = animation.keyframes.filter(kf => Math.abs(kf.time - time) > 0.01);
  
  return {
    ...animation,
    keyframes,
  };
}

/**
 * Update a keyframe value
 */
export function updateKeyframe(
  animation: AnimatedParameter,
  time: number,
  value: number
): AnimatedParameter {
  const keyframes = animation.keyframes.map(kf =>
    Math.abs(kf.time - time) < 0.01 ? { ...kf, value } : kf
  );
  
  return {
    ...animation,
    keyframes,
  };
}

/**
 * Create a default animation for a parameter
 */
export function createAnimation(
  parameter: keyof EffectParameters,
  startValue: number,
  endValue: number,
  duration: number,
  easing: EffectKeyframe["easing"] = "linear"
): AnimatedParameter {
  return {
    parameter,
    keyframes: [
      { time: 0, value: startValue, easing },
      { time: duration, value: endValue },
    ],
    interpolation: "linear",
  };
}

/**
 * Generate transition keyframes
 */
export function createTransition(
  parameter: keyof EffectParameters,
  type: "fade-in" | "fade-out" | "pulse" | "bounce",
  duration: number,
  intensity: number = 100
): AnimatedParameter {
  switch (type) {
    case "fade-in":
      return createAnimation(parameter, 0, intensity, duration, "ease-in");
    
    case "fade-out":
      return createAnimation(parameter, intensity, 0, duration, "ease-out");
    
    case "pulse":
      return {
        parameter,
        keyframes: [
          { time: 0, value: intensity, easing: "ease-in-out" },
          { time: duration / 2, value: intensity * 1.5, easing: "ease-in-out" },
          { time: duration, value: intensity },
        ],
        interpolation: "smooth",
      };
    
    case "bounce":
      return {
        parameter,
        keyframes: [
          { time: 0, value: 0, easing: "ease-out" },
          { time: duration * 0.4, value: intensity * 1.2, easing: "ease-in" },
          { time: duration * 0.6, value: intensity * 0.9, easing: "ease-out" },
          { time: duration * 0.8, value: intensity * 1.05, easing: "ease-in" },
          { time: duration, value: intensity },
        ],
        interpolation: "linear",
      };
    
    default:
      return createAnimation(parameter, 0, intensity, duration);
  }
}