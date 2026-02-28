(() => {
  "use strict";

  const HIGH_SCORE_STORAGE_KEY = "qcut.game.highScore";

  const GAME_CONFIG = {
    canvasWidth: 800,
    canvasHeight: 500,
    playerWidth: 72,
    playerHeight: 20,
    playerSpeed: 460,
    startLives: 3,
    baseStarInterval: 0.9,
    baseBombInterval: 2.0,
    maxDeltaSeconds: 0.05,
    starRadiusMin: 8,
    starRadiusMax: 14,
    bombRadiusMin: 10,
    bombRadiusMax: 16,
  };

  const KEY_ALIASES = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
  };

  const DOM_SELECTORS = {
    canvas: ["#game-canvas", "#gameCanvas", "canvas[data-game-canvas]", "canvas"],
    score: ["#score-value", "#score", "[data-score]"],
    highScore: ["#high-score-value", "#high-score", "[data-high-score]"],
    lives: ["#lives-value", "#lives", "[data-lives]"],
    streak: ["#streak-value", "#streak", "[data-streak]"],
    status: ["#status-text", "#game-status", "#status", "[data-status]"],
    startButton: ["#start-button", "#startButton", "[data-action='start']"],
    restartButton: ["#restart-button", "#restartButton", "[data-action='restart']"],
    pauseButton: ["#pause-button", "#pauseButton", "[data-action='pause']"],
  };

  const runtime = {
    canvas: null,
    ctx: null,
    scoreEl: null,
    highScoreEl: null,
    livesEl: null,
    streakEl: null,
    statusEl: null,
    startButton: null,
    restartButton: null,
    pauseButton: null,
    rafId: 0,
    loopReady: false,
    keys: new Set(),
    pointerActive: false,
    pointerX: 0,
    listeners: [],
  };

  const state = {
    mode: "idle",
    score: 0,
    highScore: 0,
    lives: GAME_CONFIG.startLives,
    streak: 0,
    misses: 0,
    elapsed: 0,
    difficulty: 1,
    starTimer: 0,
    bombTimer: 0,
    frameTime: 0,
    stars: [],
    bombs: [],
    player: {
      x: 0,
      y: 0,
      width: GAME_CONFIG.playerWidth,
      height: GAME_CONFIG.playerHeight,
      speed: GAME_CONFIG.playerSpeed,
    },
  };

  function clamp({ value, min, max }) {
    return Math.max(min, Math.min(max, value));
  }

  function randomBetween({ min, max }) {
    return min + Math.random() * (max - min);
  }

  function setText({ element, value }) {
    if (!element) {
      return;
    }

    element.textContent = String(value);
  }

  function resolveElement({ selectors }) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }

    return null;
  }

  function readHighScore() {
    try {
      const raw = window.localStorage.getItem(HIGH_SCORE_STORAGE_KEY);
      if (!raw) {
        return 0;
      }

      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
      }

      return parsed;
    } catch (error) {
      console.warn("[game] Failed to read high score:", error);
      return 0;
    }
  }

  function writeHighScore({ value }) {
    try {
      window.localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(value));
    } catch (error) {
      console.warn("[game] Failed to write high score:", error);
    }
  }

  function getCanvasSize() {
    const width = runtime.canvas?.clientWidth || GAME_CONFIG.canvasWidth;
    const height = runtime.canvas?.clientHeight || GAME_CONFIG.canvasHeight;

    return {
      width: clamp({ value: Math.round(width), min: 320, max: 1400 }),
      height: clamp({ value: Math.round(height), min: 240, max: 900 }),
    };
  }

  function resizeCanvas() {
    if (!runtime.canvas || !runtime.ctx) {
      return;
    }

    const pixelRatio = window.devicePixelRatio || 1;
    const { width, height } = getCanvasSize();
    runtime.canvas.width = Math.floor(width * pixelRatio);
    runtime.canvas.height = Math.floor(height * pixelRatio);
    runtime.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const previousBottom = state.player.y + state.player.height;
    state.player.y = height - 32;
    if (previousBottom === 0) {
      state.player.y = height - 32;
    }

    const maxX = width - state.player.width;
    state.player.x = clamp({ value: state.player.x, min: 0, max: maxX });
  }

  function getWorldBounds() {
    const { width, height } = getCanvasSize();
    return { width, height };
  }

  function updateStatus({ text }) {
    setText({ element: runtime.statusEl, value: text });
  }

  function updateHud() {
    setText({ element: runtime.scoreEl, value: state.score });
    setText({ element: runtime.highScoreEl, value: state.highScore });
    setText({ element: runtime.livesEl, value: state.lives });
    setText({ element: runtime.streakEl, value: state.streak });

    if (runtime.startButton) {
      runtime.startButton.disabled = state.mode === "running";
    }

    if (runtime.restartButton) {
      runtime.restartButton.disabled = state.mode === "idle";
    }

    if (runtime.pauseButton) {
      runtime.pauseButton.disabled = state.mode === "idle" || state.mode === "game-over";
      runtime.pauseButton.textContent = state.mode === "paused" ? "Resume" : "Pause";
    }
  }

  function buildPublicSnapshot() {
    return {
      mode: state.mode,
      score: state.score,
      highScore: state.highScore,
      lives: state.lives,
      streak: state.streak,
      starsOnScreen: state.stars.length,
      bombsOnScreen: state.bombs.length,
    };
  }

  function emitStateChanged() {
    const event = new CustomEvent("qcut-game-state", {
      detail: buildPublicSnapshot(),
    });
    document.dispatchEvent(event);
  }

  function resetRoundState() {
    const { width, height } = getWorldBounds();
    state.mode = "idle";
    state.score = 0;
    state.lives = GAME_CONFIG.startLives;
    state.streak = 0;
    state.misses = 0;
    state.elapsed = 0;
    state.difficulty = 1;
    state.starTimer = 0;
    state.bombTimer = 0;
    state.stars.length = 0;
    state.bombs.length = 0;
    state.player.x = width / 2 - state.player.width / 2;
    state.player.y = height - 32;
    state.frameTime = performance.now();
  }

  function loseLife({ reason }) {
    state.lives = Math.max(0, state.lives - 1);
    state.streak = 0;
    updateStatus({ text: reason });

    if (state.lives > 0) {
      return;
    }

    state.mode = "game-over";
    updateStatus({ text: "Game over. Press R or Restart to play again." });
    if (state.score > state.highScore) {
      state.highScore = state.score;
      writeHighScore({ value: state.highScore });
    }
  }

  function spawnStar() {
    const { width } = getWorldBounds();
    const radius = randomBetween({
      min: GAME_CONFIG.starRadiusMin,
      max: GAME_CONFIG.starRadiusMax,
    });
    const x = randomBetween({ min: radius, max: width - radius });
    const speed = 120 + Math.random() * 90 + state.difficulty * 55;

    state.stars.push({
      x,
      y: -radius - 8,
      radius,
      speed,
      value: 10 + Math.round(state.difficulty * 2),
    });
  }

  function spawnBomb() {
    const { width } = getWorldBounds();
    const radius = randomBetween({
      min: GAME_CONFIG.bombRadiusMin,
      max: GAME_CONFIG.bombRadiusMax,
    });
    const x = randomBetween({ min: radius, max: width - radius });
    const speed = 140 + Math.random() * 80 + state.difficulty * 60;

    state.bombs.push({
      x,
      y: -radius - 12,
      radius,
      speed,
    });
  }

  function updateDifficulty() {
    state.difficulty = 1 + Math.min(2.2, state.score / 260);
  }

  function getIntervals() {
    const starInterval = clamp({
      value: GAME_CONFIG.baseStarInterval - state.difficulty * 0.17,
      min: 0.24,
      max: GAME_CONFIG.baseStarInterval,
    });
    const bombInterval = clamp({
      value: GAME_CONFIG.baseBombInterval - state.difficulty * 0.22,
      min: 0.55,
      max: GAME_CONFIG.baseBombInterval,
    });

    return { starInterval, bombInterval };
  }

  function updatePlayer({ deltaSeconds }) {
    const { width } = getWorldBounds();
    let direction = 0;

    if (runtime.keys.has("left")) {
      direction -= 1;
    }

    if (runtime.keys.has("right")) {
      direction += 1;
    }

    if (direction !== 0) {
      state.player.x += direction * state.player.speed * deltaSeconds;
    }

    if (runtime.pointerActive) {
      const targetX = runtime.pointerX - state.player.width / 2;
      const delta = targetX - state.player.x;
      state.player.x += delta * Math.min(1, 14 * deltaSeconds);
    }

    state.player.x = clamp({
      value: state.player.x,
      min: 0,
      max: width - state.player.width,
    });
  }

  function updateFallingEntities({ deltaSeconds }) {
    const { height } = getWorldBounds();

    for (let index = state.stars.length - 1; index >= 0; index -= 1) {
      const star = state.stars[index];
      star.y += star.speed * deltaSeconds;
      if (star.y - star.radius <= height) {
        continue;
      }

      state.stars.splice(index, 1);
      state.streak = 0;
      state.misses += 1;
      if (state.score > 0) {
        state.score = Math.max(0, state.score - 3);
      }

      if (state.misses >= 3) {
        state.misses = 0;
        loseLife({ reason: "Too many misses. Life lost." });
      }
    }

    for (let index = state.bombs.length - 1; index >= 0; index -= 1) {
      const bomb = state.bombs[index];
      bomb.y += bomb.speed * deltaSeconds;
      if (bomb.y - bomb.radius <= height) {
        continue;
      }

      state.bombs.splice(index, 1);
    }
  }

  function circleHitsPlayer({ x, y, radius }) {
    const nearestX = clamp({
      value: x,
      min: state.player.x,
      max: state.player.x + state.player.width,
    });
    const nearestY = clamp({
      value: y,
      min: state.player.y,
      max: state.player.y + state.player.height,
    });
    const dx = x - nearestX;
    const dy = y - nearestY;
    return dx * dx + dy * dy <= radius * radius;
  }

  function handleCollisions() {
    for (let index = state.stars.length - 1; index >= 0; index -= 1) {
      const star = state.stars[index];
      if (!circleHitsPlayer(star)) {
        continue;
      }

      state.stars.splice(index, 1);
      state.streak += 1;
      state.misses = 0;

      const streakBonus = Math.floor(state.streak / 4) * 2;
      state.score += star.value + streakBonus;
      if (state.score > state.highScore) {
        state.highScore = state.score;
      }
    }

    for (let index = state.bombs.length - 1; index >= 0; index -= 1) {
      const bomb = state.bombs[index];
      if (!circleHitsPlayer(bomb)) {
        continue;
      }

      state.bombs.splice(index, 1);
      loseLife({ reason: "You hit a bomb. Life lost." });
      if (state.mode === "game-over") {
        break;
      }
    }
  }

  function updateSimulation({ deltaSeconds }) {
    if (state.mode !== "running") {
      return;
    }

    updateDifficulty();
    const { starInterval, bombInterval } = getIntervals();
    state.starTimer -= deltaSeconds;
    state.bombTimer -= deltaSeconds;

    if (state.starTimer <= 0) {
      spawnStar();
      state.starTimer = starInterval;
    }

    if (state.elapsed > 1.8 && state.bombTimer <= 0) {
      spawnBomb();
      state.bombTimer = bombInterval;
    }

    updatePlayer({ deltaSeconds });
    updateFallingEntities({ deltaSeconds });
    handleCollisions();
    state.elapsed += deltaSeconds;
  }

  function drawBackground() {
    const { width, height } = getWorldBounds();
    const gradient = runtime.ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#0f172a");
    gradient.addColorStop(1, "#1e293b");
    runtime.ctx.fillStyle = gradient;
    runtime.ctx.fillRect(0, 0, width, height);

    runtime.ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    runtime.ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 36) {
      runtime.ctx.beginPath();
      runtime.ctx.moveTo(x, 0);
      runtime.ctx.lineTo(x, height);
      runtime.ctx.stroke();
    }
  }

  function drawPlayer() {
    runtime.ctx.fillStyle = "#22d3ee";
    runtime.ctx.fillRect(
      state.player.x,
      state.player.y,
      state.player.width,
      state.player.height
    );

    runtime.ctx.fillStyle = "#ecfeff";
    runtime.ctx.fillRect(
      state.player.x + 14,
      state.player.y + 6,
      state.player.width - 28,
      Math.max(3, state.player.height - 12)
    );
  }

  function drawStars() {
    runtime.ctx.fillStyle = "#facc15";
    for (const star of state.stars) {
      runtime.ctx.beginPath();
      runtime.ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      runtime.ctx.fill();
    }
  }

  function drawBombs() {
    for (const bomb of state.bombs) {
      runtime.ctx.fillStyle = "#ef4444";
      runtime.ctx.beginPath();
      runtime.ctx.arc(bomb.x, bomb.y, bomb.radius, 0, Math.PI * 2);
      runtime.ctx.fill();

      runtime.ctx.strokeStyle = "#111827";
      runtime.ctx.lineWidth = 2;
      runtime.ctx.beginPath();
      runtime.ctx.moveTo(bomb.x - bomb.radius * 0.55, bomb.y - bomb.radius * 0.55);
      runtime.ctx.lineTo(bomb.x + bomb.radius * 0.55, bomb.y + bomb.radius * 0.55);
      runtime.ctx.moveTo(bomb.x + bomb.radius * 0.55, bomb.y - bomb.radius * 0.55);
      runtime.ctx.lineTo(bomb.x - bomb.radius * 0.55, bomb.y + bomb.radius * 0.55);
      runtime.ctx.stroke();
    }
  }

  function drawOverlayText() {
    const { width, height } = getWorldBounds();
    let message = "";

    if (state.mode === "idle") {
      message = "Press Space or Start";
    } else if (state.mode === "paused") {
      message = "Paused";
    } else if (state.mode === "game-over") {
      message = "Game Over";
    }

    if (!message) {
      return;
    }

    runtime.ctx.fillStyle = "rgba(15, 23, 42, 0.62)";
    runtime.ctx.fillRect(0, 0, width, height);
    runtime.ctx.fillStyle = "#f8fafc";
    runtime.ctx.textAlign = "center";
    runtime.ctx.font = "700 32px sans-serif";
    runtime.ctx.fillText(message, width / 2, height / 2);
  }

  function renderFrame() {
    if (!runtime.ctx) {
      return;
    }

    drawBackground();
    drawStars();
    drawBombs();
    drawPlayer();
    drawOverlayText();
  }

  function runFrame({ now }) {
    try {
      const rawDelta = (now - state.frameTime) / 1000;
      state.frameTime = now;
      const deltaSeconds = clamp({
        value: Number.isFinite(rawDelta) ? rawDelta : 0,
        min: 0,
        max: GAME_CONFIG.maxDeltaSeconds,
      });

      updateSimulation({ deltaSeconds });
      updateHud();
      renderFrame();
      emitStateChanged();
    } catch (error) {
      console.error("[game] Fatal frame error:", error);
      state.mode = "game-over";
      updateStatus({ text: "Game paused due to an unexpected error." });
      updateHud();
      renderFrame();
    }
  }

  function animationLoop(now) {
    runFrame({ now });
    runtime.rafId = window.requestAnimationFrame(animationLoop);
  }

  function ensureLoopRunning() {
    if (runtime.loopReady) {
      return;
    }

    runtime.loopReady = true;
    runtime.rafId = window.requestAnimationFrame(animationLoop);
  }

  function setModeRunning() {
    state.mode = "running";
    state.frameTime = performance.now();
    updateStatus({
      text: "Catch stars, avoid bombs. Arrow keys/A-D to move, Space to pause.",
    });
  }

  function startGame() {
    if (state.mode === "running") {
      return;
    }

    resetRoundState();
    setModeRunning();
  }

  function restartGame() {
    resetRoundState();
    setModeRunning();
  }

  function togglePause() {
    if (state.mode === "idle" || state.mode === "game-over") {
      return;
    }

    if (state.mode === "running") {
      state.mode = "paused";
      updateStatus({ text: "Paused. Press Space or P to resume." });
      return;
    }

    state.mode = "running";
    state.frameTime = performance.now();
    updateStatus({ text: "Running." });
  }

  function mapKey({ code }) {
    return KEY_ALIASES[code] || null;
  }

  function handleKeyDown(event) {
    const axisKey = mapKey({ code: event.code });
    if (axisKey) {
      runtime.keys.add(axisKey);
      event.preventDefault();
    }

    if (event.code === "Space") {
      event.preventDefault();
      if (state.mode === "idle") {
        startGame();
        return;
      }

      if (state.mode === "game-over") {
        restartGame();
        return;
      }

      togglePause();
      return;
    }

    if (event.code === "KeyR") {
      event.preventDefault();
      restartGame();
      return;
    }

    if (event.code === "KeyP") {
      event.preventDefault();
      togglePause();
    }
  }

  function handleKeyUp(event) {
    const axisKey = mapKey({ code: event.code });
    if (axisKey) {
      runtime.keys.delete(axisKey);
    }
  }

  function updatePointer({ clientX }) {
    if (!runtime.canvas) {
      return;
    }

    const rect = runtime.canvas.getBoundingClientRect();
    runtime.pointerX = clientX - rect.left;
    runtime.pointerActive = true;
  }

  function addListener({ target, eventName, handler, options }) {
    target.addEventListener(eventName, handler, options);
    runtime.listeners.push({ target, eventName, handler, options });
  }

  function wireInput() {
    addListener({
      target: window,
      eventName: "keydown",
      handler: handleKeyDown,
      options: { passive: false },
    });
    addListener({
      target: window,
      eventName: "keyup",
      handler: handleKeyUp,
      options: false,
    });
    addListener({
      target: window,
      eventName: "resize",
      handler: resizeCanvas,
      options: false,
    });
    addListener({
      target: document,
      eventName: "visibilitychange",
      handler: () => {
        if (document.hidden && state.mode === "running") {
          state.mode = "paused";
          updateStatus({ text: "Paused while tab is hidden." });
        }
      },
      options: false,
    });

    if (runtime.canvas) {
      addListener({
        target: runtime.canvas,
        eventName: "mousemove",
        handler: (event) => {
          updatePointer({ clientX: event.clientX });
        },
        options: false,
      });
      addListener({
        target: runtime.canvas,
        eventName: "mouseleave",
        handler: () => {
          runtime.pointerActive = false;
        },
        options: false,
      });
      addListener({
        target: runtime.canvas,
        eventName: "touchstart",
        handler: (event) => {
          if (!event.touches[0]) {
            return;
          }

          updatePointer({ clientX: event.touches[0].clientX });
          if (state.mode === "idle") {
            startGame();
          }
        },
        options: { passive: true },
      });
      addListener({
        target: runtime.canvas,
        eventName: "touchmove",
        handler: (event) => {
          if (!event.touches[0]) {
            return;
          }

          updatePointer({ clientX: event.touches[0].clientX });
        },
        options: { passive: true },
      });
      addListener({
        target: runtime.canvas,
        eventName: "touchend",
        handler: () => {
          runtime.pointerActive = false;
        },
        options: { passive: true },
      });
      addListener({
        target: runtime.canvas,
        eventName: "click",
        handler: () => {
          if (state.mode === "idle") {
            startGame();
          }
        },
        options: false,
      });
    }
  }

  function wireControls() {
    if (runtime.startButton) {
      addListener({
        target: runtime.startButton,
        eventName: "click",
        handler: startGame,
        options: false,
      });
    }

    if (runtime.restartButton) {
      addListener({
        target: runtime.restartButton,
        eventName: "click",
        handler: restartGame,
        options: false,
      });
    }

    if (runtime.pauseButton) {
      addListener({
        target: runtime.pauseButton,
        eventName: "click",
        handler: togglePause,
        options: false,
      });
    }
  }

  function resolveDom() {
    runtime.canvas = resolveElement({ selectors: DOM_SELECTORS.canvas });
    if (!runtime.canvas) {
      runtime.canvas = document.createElement("canvas");
      runtime.canvas.id = "game-canvas";
      runtime.canvas.style.width = `${GAME_CONFIG.canvasWidth}px`;
      runtime.canvas.style.height = `${GAME_CONFIG.canvasHeight}px`;
      document.body.append(runtime.canvas);
    }

    runtime.ctx = runtime.canvas.getContext("2d");
    runtime.scoreEl = resolveElement({ selectors: DOM_SELECTORS.score });
    runtime.highScoreEl = resolveElement({ selectors: DOM_SELECTORS.highScore });
    runtime.livesEl = resolveElement({ selectors: DOM_SELECTORS.lives });
    runtime.streakEl = resolveElement({ selectors: DOM_SELECTORS.streak });
    runtime.statusEl = resolveElement({ selectors: DOM_SELECTORS.status });
    runtime.startButton = resolveElement({ selectors: DOM_SELECTORS.startButton });
    runtime.restartButton = resolveElement({ selectors: DOM_SELECTORS.restartButton });
    runtime.pauseButton = resolveElement({ selectors: DOM_SELECTORS.pauseButton });
  }

  function destroy() {
    if (runtime.rafId) {
      window.cancelAnimationFrame(runtime.rafId);
    }

    for (const listener of runtime.listeners) {
      listener.target.removeEventListener(
        listener.eventName,
        listener.handler,
        listener.options
      );
    }

    runtime.listeners.length = 0;
    runtime.rafId = 0;
    runtime.loopReady = false;
  }

  function setup() {
    try {
      resolveDom();
      if (!runtime.ctx) {
        throw new Error("Unable to acquire 2D canvas context");
      }

      state.highScore = readHighScore();
      resetRoundState();
      resizeCanvas();
      wireInput();
      wireControls();
      updateStatus({
        text: "Press Space/Start. Move with Arrow Keys/A-D or touch/mouse.",
      });
      updateHud();
      renderFrame();
      ensureLoopRunning();

      window.qcutGame = {
        start: startGame,
        restart: restartGame,
        pause: togglePause,
        getState: buildPublicSnapshot,
        destroy,
      };
    } catch (error) {
      console.error("[game] Failed to initialize game:", error);
      updateStatus({ text: "Unable to start game." });
    }
  }

  if (window.qcutGame && typeof window.qcutGame.destroy === "function") {
    try {
      window.qcutGame.destroy();
    } catch (error) {
      console.warn("[game] Previous game cleanup failed:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup, { once: true });
  } else {
    setup();
  }
})();
