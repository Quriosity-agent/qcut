const STATES = {
  IDLE: "idle",
  RUNNING: "running",
  ENDED: "ended",
};

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

const scoreValue = document.getElementById("score-value");
const bestValue = document.getElementById("best-value");
const livesValue = document.getElementById("lives-value");
const statusLine = document.getElementById("status-line");

const startScreen = document.getElementById("start-screen");
const gameOverScreen = document.getElementById("game-over-screen");
const finalScore = document.getElementById("final-score");
const startButton = document.getElementById("start-button");
const restartButton = document.getElementById("restart-button");
const restartOverlayButton = document.getElementById("restart-overlay-button");

const PLAYER_WIDTH = 120;
const PLAYER_HEIGHT = 18;
const PLAYER_Y = canvas.height - 36;
const STAR_RADIUS = 11;
const STAR_FALL_MIN = 2.4;
const STAR_FALL_MAX = 4.4;

const state = {
  mode: STATES.IDLE,
  score: 0,
  best: 0,
  lives: 3,
  playerX: canvas.width / 2 - PLAYER_WIDTH / 2,
  stars: [],
  animationId: null,
  spawnTimer: 0,
};

function syncHud() {
  scoreValue.textContent = String(state.score);
  bestValue.textContent = String(state.best);
  livesValue.textContent = String(state.lives);
}

function setStatus(message, isDanger = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle("is-danger", isDanger);
}

function showOverlay({ start = false, over = false } = {}) {
  startScreen.classList.toggle("is-hidden", !start);
  gameOverScreen.classList.toggle("is-hidden", !over);
}

function resetRound() {
  state.score = 0;
  state.lives = 3;
  state.playerX = canvas.width / 2 - PLAYER_WIDTH / 2;
  state.stars = [];
  state.spawnTimer = 0;
  syncHud();
}

function startRun() {
  resetRound();
  state.mode = STATES.RUNNING;
  restartButton.disabled = false;
  showOverlay({ start: false, over: false });
  setStatus("Run active. Catch stars and keep lives above zero.");
  if (!state.animationId) {
    state.animationId = requestAnimationFrame(loop);
  }
}

function endRun() {
  state.mode = STATES.ENDED;
  if (state.score > state.best) {
    state.best = state.score;
  }
  syncHud();
  finalScore.textContent = String(state.score);
  showOverlay({ start: false, over: true });
  setStatus("Run complete. Restart to try again.", true);
}

function createStar() {
  return {
    x: STAR_RADIUS + Math.random() * (canvas.width - STAR_RADIUS * 2),
    y: -STAR_RADIUS,
    speed: STAR_FALL_MIN + Math.random() * (STAR_FALL_MAX - STAR_FALL_MIN),
  };
}

function updateStars() {
  state.spawnTimer += 1;
  if (state.spawnTimer >= 28) {
    state.stars.push(createStar());
    state.spawnTimer = 0;
  }

  const keptStars = [];
  for (const star of state.stars) {
    star.y += star.speed;

    const withinX = star.x >= state.playerX && star.x <= state.playerX + PLAYER_WIDTH;
    const caught = withinX && star.y + STAR_RADIUS >= PLAYER_Y;
    if (caught) {
      state.score += 1;
      continue;
    }

    const dropped = star.y - STAR_RADIUS > canvas.height;
    if (dropped) {
      state.lives -= 1;
      continue;
    }

    keptStars.push(star);
  }

  state.stars = keptStars;
  syncHud();

  if (state.lives <= 0) {
    endRun();
  }
}

function drawBackground() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  for (let i = 0; i < 10; i += 1) {
    ctx.beginPath();
    ctx.arc(90 + i * 95, 60 + (i % 2) * 28, 30, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer() {
  ctx.fillStyle = "#175733";
  ctx.fillRect(state.playerX, PLAYER_Y, PLAYER_WIDTH, PLAYER_HEIGHT);
}

function drawStar(star) {
  ctx.fillStyle = "#f3b441";
  ctx.beginPath();
  ctx.arc(star.x, star.y, STAR_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

function render() {
  drawBackground();
  drawPlayer();
  for (const star of state.stars) {
    drawStar(star);
  }
}

function loop() {
  if (state.mode === STATES.RUNNING) {
    updateStars();
  }

  render();
  state.animationId = requestAnimationFrame(loop);
}

function clampPlayer(x) {
  const min = 0;
  const max = canvas.width - PLAYER_WIDTH;
  state.playerX = Math.max(min, Math.min(max, x));
}

function nudgePlayer(delta) {
  clampPlayer(state.playerX + delta);
}

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    nudgePlayer(-28);
  }

  if (event.key === "ArrowRight") {
    nudgePlayer(28);
  }

  if (event.key === "Enter" && state.mode !== STATES.RUNNING) {
    startRun();
  }
});

canvas.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = ((event.clientX - rect.left) / rect.width) * canvas.width;
  clampPlayer(mouseX - PLAYER_WIDTH / 2);
});

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const pointerX = ((event.clientX - rect.left) / rect.width) * canvas.width;
  clampPlayer(pointerX - PLAYER_WIDTH / 2);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.buttons === 0) {
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const pointerX = ((event.clientX - rect.left) / rect.width) * canvas.width;
  clampPlayer(pointerX - PLAYER_WIDTH / 2);
});

startButton.addEventListener("click", startRun);
restartButton.addEventListener("click", startRun);
restartOverlayButton.addEventListener("click", startRun);

syncHud();
setStatus("Press Start to begin your run.");
showOverlay({ start: true, over: false });
render();
