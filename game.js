const canvas = document.getElementById("race");
const ctx = canvas.getContext("2d");

const hudLap = document.getElementById("lap-count");
const hudLapTime = document.getElementById("lap-time");
const hudBest = document.getElementById("best-lap");
const hudPosition = document.getElementById("position");
const overlay = document.getElementById("overlay");
const overlayHeading = document.getElementById("overlay-heading");
const overlayBody = document.getElementById("overlay-body");
const startButton = document.getElementById("start-button");

const keys = { w: false, a: false, s: false, d: false };

const totalLaps = 3;

const SEGMENT_LENGTH = 90;
const DRAW_DISTANCE = 160;
const FIELD_OF_VIEW = Math.PI / 3;
const CAMERA_HEIGHT = 1400;
const CAMERA_DEPTH = 1 / Math.tan(FIELD_OF_VIEW / 2);
const PLAYER_Z = CAMERA_DEPTH * CAMERA_HEIGHT;
const ROAD_WIDTH = 1000;
const RUMBLE_LENGTH = 3;
const CURVE_SCALE = 0.0011;
const MAX_SPEED = SEGMENT_LENGTH * 55;
const ACCELERATION = MAX_SPEED / 2.2;
const BRAKE_DECEL = MAX_SPEED;
const DRAG = MAX_SPEED / 6.5;
const OFF_ROAD_DECEL = MAX_SPEED * 1.3;
const OFF_ROAD_LIMIT = MAX_SPEED * 0.6;
const CENTRIFUGAL = 1.25;

let segments = [];
let trackLength = 0;

const player = {
  position: 0,
  speed: 0,
  offset: 0,
  completedLaps: 0,
};

let opponents = [];
let raceRunning = false;
let raceFinished = false;
let lastFrame = 0;

const raceState = {
  lapTimer: 0,
  bestLap: null,
  message: "",
};

const defaultOverlay = {
  heading: "Welcome to the Circus Grand Prix!",
  body:
    "In this homage to Mot's Grand Prix, the Roman factions hurtle around the course. Use WASD to whip your team through the bends, keep the chariot centered, and claim the laurel wreath before the rivals do.",
};

function buildTrack() {
  const blueprint = [
    { count: 60, curve: 0 },
    { count: 40, curve: 0.6 },
    { count: 20, curve: 1.05 },
    { count: 55, curve: 0.35 },
    { count: 60, curve: -0.65 },
    { count: 20, curve: -1.1 },
    { count: 50, curve: 0 },
    { count: 40, curve: -0.4 },
    { count: 40, curve: 0.45 },
    { count: 55, curve: 0 },
    { count: 40, curve: 0.55 },
    { count: 40, curve: -0.55 },
    { count: 60, curve: 0 },
    { count: 30, curve: -0.1 },
    { count: 30, curve: 0 },
  ];

  segments = [];
  blueprint.forEach((section) => {
    for (let i = 0; i < section.count; i += 1) {
      segments.push({ index: segments.length, curve: section.curve });
    }
  });
  trackLength = segments.length * SEGMENT_LENGTH;
}

function createOpponents() {
  const templates = [
    { lane: -0.45, speed: 0.9, color: "#d4553d", name: "Aurelius" },
    { lane: 0.2, speed: 0.92, color: "#4a8cc5", name: "Cassia" },
    { lane: 0.55, speed: 0.95, color: "#c4b05a", name: "Decimus" },
  ];

  const spacing = trackLength / templates.length;
  return templates.map((template, index) => ({
    position: (index + 1) * spacing * 0.6,
    speed: MAX_SPEED * 0.5,
    maxSpeed: MAX_SPEED * template.speed,
    offset: template.lane,
    baseLane: template.lane,
    color: template.color,
    name: template.name,
    completedLaps: 0,
    oscillation: Math.random() * Math.PI * 2,
    oscillationSpeed: 0.8 + Math.random() * 0.4,
  }));
}

function resetRace() {
  buildTrack();

  player.position = SEGMENT_LENGTH * 2;
  player.speed = 0;
  player.offset = 0;
  player.completedLaps = 0;

  opponents = createOpponents();

  raceState.lapTimer = 0;
  raceState.bestLap = null;
  raceState.message = "";

  raceFinished = false;
  raceRunning = false;

  overlayHeading.textContent = defaultOverlay.heading;
  overlayBody.textContent = defaultOverlay.body;
  startButton.textContent = "Enter the Grand Prix";

  updateHud();
  render();
}

function findSegmentIndex(position) {
  return Math.floor(position / SEGMENT_LENGTH) % segments.length;
}

function formatTime(time) {
  if (!Number.isFinite(time)) return "--";
  const minutes = Math.floor(time / 60);
  const seconds = time % 60;
  if (minutes > 0) {
    return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
  }
  return `${seconds.toFixed(2)}s`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function project(worldX, worldY, worldZ, cameraX, cameraY, cameraZ) {
  const relX = worldX - cameraX;
  const relY = worldY - cameraY;
  const relZ = worldZ - cameraZ;

  if (relZ <= 0.1) return null;

  const scale = CAMERA_DEPTH / relZ;
  return {
    x: canvas.width / 2 + scale * relX * (canvas.width / 2),
    y: canvas.height / 2 - scale * relY * (canvas.height / 2),
    scale,
  };
}

function drawRoundedRectPath(context, x, y, width, height, radius) {
  const corner = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
  context.beginPath();
  context.moveTo(x + corner, y);
  context.lineTo(x + width - corner, y);
  context.quadraticCurveTo(x + width, y, x + width, y + corner);
  context.lineTo(x + width, y + height - corner);
  context.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
  context.lineTo(x + corner, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - corner);
  context.lineTo(x, y + corner);
  context.quadraticCurveTo(x, y, x + corner, y);
  context.closePath();
}

function update(dt) {
  if (raceFinished) {
    player.speed = Math.max(0, player.speed - DRAG * dt);
    return;
  }

  raceState.lapTimer += dt;

  if (keys.w) {
    player.speed = Math.min(MAX_SPEED, player.speed + ACCELERATION * dt);
  } else {
    player.speed = Math.max(0, player.speed - DRAG * dt);
  }

  if (keys.s) {
    player.speed = Math.max(0, player.speed - BRAKE_DECEL * dt);
  }

  const steerInput = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
  const speedRatio = player.speed / MAX_SPEED;
  player.offset += steerInput * dt * 1.4 * (0.2 + speedRatio);

  const playerSegment = segments[findSegmentIndex(player.position)];
  player.offset -= playerSegment.curve * CENTRIFUGAL * speedRatio * dt;

  const offRoad = Math.abs(player.offset) > 1;
  if (offRoad) {
    player.speed = Math.max(
      0,
      player.speed - OFF_ROAD_DECEL * dt - (player.speed - OFF_ROAD_LIMIT) * 0.02
    );
    player.speed = Math.min(player.speed, OFF_ROAD_LIMIT);
  }

  player.offset = clamp(player.offset, -1.35, 1.35);

  player.position += player.speed * dt;
  if (player.position >= trackLength) {
    player.position -= trackLength;
    player.completedLaps += 1;
    completeLap(true);
  }

  opponents.forEach((opponent, index) => {
    const targetSpeed = opponent.maxSpeed;
    if (opponent.speed < targetSpeed) {
      opponent.speed = Math.min(targetSpeed, opponent.speed + ACCELERATION * 0.6 * dt);
    } else {
      opponent.speed = Math.max(targetSpeed * 0.92, opponent.speed - DRAG * 0.5 * dt);
    }

    opponent.position += opponent.speed * dt;
    if (opponent.position >= trackLength) {
      opponent.position -= trackLength;
      opponent.completedLaps += 1;
    }

    const segment = segments[findSegmentIndex(opponent.position)];
    const laneDrift = Math.sin(raceState.lapTimer * opponent.oscillationSpeed + opponent.oscillation);
    const desire = opponent.baseLane + laneDrift * 0.05;
    opponent.offset += (desire - opponent.offset) * dt * 1.5;
    opponent.offset -= segment.curve * (CENTRIFUGAL * 0.6) * (opponent.speed / MAX_SPEED) * dt;
    opponent.offset = clamp(opponent.offset, -0.95, 0.95);

    const relative = (opponent.position - player.position + trackLength) % trackLength;
    if (relative < SEGMENT_LENGTH * 4 && Math.abs(opponent.offset - player.offset) < 0.12) {
      const push = (player.offset > opponent.offset ? 1 : -1) * dt * 0.6;
      opponent.offset -= push * 0.6;
      player.offset += push;
    }

    for (let j = index + 1; j < opponents.length; j += 1) {
      const other = opponents[j];
      const gap = (other.position - opponent.position + trackLength) % trackLength;
      if (gap < SEGMENT_LENGTH * 2 && Math.abs(other.offset - opponent.offset) < 0.1) {
        const adjust = (opponent.offset > other.offset ? 1 : -1) * dt * 0.5;
        opponent.offset += adjust;
        other.offset -= adjust;
      }
    }
  });

  const playerProgress = player.completedLaps * trackLength + player.position;
  const standings = [player, ...opponents].slice().sort((a, b) => {
    const progA = a.completedLaps * trackLength + a.position;
    const progB = b.completedLaps * trackLength + b.position;
    return progB - progA;
  });
  const playerRank = standings.findIndex((entity) => entity === player) + 1;
  hudPosition.textContent = `${playerRank} / ${1 + opponents.length}`;

  const rivalWinner = opponents.find((rival) => rival.completedLaps >= totalLaps);
  if (rivalWinner && player.completedLaps < totalLaps) {
    finishRace(false, rivalWinner.name);
  }

  if (player.completedLaps >= totalLaps) {
    finishRace(true);
  }
}

function completeLap(isPlayer) {
  if (isPlayer) {
    if (raceState.lapTimer > 0) {
      const lapTime = raceState.lapTimer;
      if (raceState.bestLap === null || lapTime < raceState.bestLap) {
        raceState.bestLap = lapTime;
      }
    }
    raceState.lapTimer = 0;
  }
}

function finishRace(victory, opponentName = "") {
  raceFinished = true;
  raceRunning = false;

  if (victory) {
    raceState.message = "You won the laurels!";
    overlayHeading.textContent = "Victory in the Circus!";
    overlayBody.textContent =
      "The crowd roars as your horses thunder past the marble podium. Take a breath, then dive back into the Mot-inspired Grand Prix when you are ready.";
  } else {
    raceState.message = "Defeat!";
    overlayHeading.textContent = "Another Faction Prevails";
    overlayBody.textContent = `${opponentName} seized the laurel wreath this time. Adjust your lines and challenge the arena once more.`;
  }

  startButton.textContent = "Race Again";
  overlay.classList.remove("hidden");
}

function drawBackground() {
  const horizonY = canvas.height * 0.45;
  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, "#2a2755");
  sky.addColorStop(1, "#f2d6a0");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, horizonY);

  ctx.fillStyle = "#b58b52";
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.quadraticCurveTo(canvas.width / 2, horizonY - 60, canvas.width, horizonY);
  ctx.lineTo(canvas.width, horizonY + 90);
  ctx.lineTo(0, horizonY + 90);
  ctx.fill();

  ctx.fillStyle = "#3a271b";
  ctx.fillRect(0, horizonY + 40, canvas.width, 90);

  const pillarCount = 11;
  for (let i = 0; i < pillarCount; i += 1) {
    const x = (canvas.width / (pillarCount - 1)) * i;
    const width = 18;
    ctx.fillStyle = "#d6c6aa";
    ctx.fillRect(x - width / 2, horizonY + 20, width, 80);
  }

  ctx.fillStyle = "#62442d";
  ctx.fillRect(0, horizonY + 110, canvas.width, canvas.height - (horizonY + 110));
}

function render() {
  drawBackground();

  const baseIndex = findSegmentIndex(player.position);
  const cameraZ = player.position - PLAYER_Z;
  const cameraX = player.offset * ROAD_WIDTH;
  const cameraY = CAMERA_HEIGHT;

  const projectedSegments = new Array(DRAW_DISTANCE);
  let x = 0;
  let dx = 0;

  for (let n = 0; n < DRAW_DISTANCE; n += 1) {
    const segmentIndex = (baseIndex + n) % segments.length;
    const looped = segmentIndex < baseIndex ? 1 : 0;
    const segment = segments[segmentIndex];

    const worldZ1 = segmentIndex * SEGMENT_LENGTH + looped * trackLength;
    const worldZ2 = worldZ1 + SEGMENT_LENGTH;

    const p1 = project(x, 0, worldZ1, cameraX, cameraY, cameraZ);
    dx += segment.curve * CURVE_SCALE;
    const nextX = x + dx;
    const p2 = project(nextX, 0, worldZ2, cameraX, cameraY, cameraZ);

    let roadWidth1 = 0;
    let roadWidth2 = 0;
    if (p1 && p2) {
      const halfCanvas = canvas.width / 2;
      roadWidth1 = p1.scale * ROAD_WIDTH * halfCanvas;
      roadWidth2 = p2.scale * ROAD_WIDTH * halfCanvas;
    }

    projectedSegments[n] = {
      valid: Boolean(p1 && p2),
      index: segmentIndex,
      p1,
      p2,
      roadWidth1,
      roadWidth2,
      looped,
      sprites: [],
    };

    x = nextX;
  }

  projectedSegments.forEach((segment) => {
    if (segment) segment.sprites = [];
  });

  const maxVisibleDistance = DRAW_DISTANCE * SEGMENT_LENGTH;
  opponents.forEach((opponent) => {
    let relative = opponent.position - player.position;
    if (relative < 0) relative += trackLength;
    if (relative <= 0 || relative >= maxVisibleDistance) return;

    const slot = Math.floor(relative / SEGMENT_LENGTH);
    const seg = projectedSegments[slot];
    if (!seg || !seg.valid) return;

    const percent = (opponent.position % SEGMENT_LENGTH) / SEGMENT_LENGTH;
    seg.sprites.push({ entity: opponent, percent });
  });

  for (let n = DRAW_DISTANCE - 1; n >= 0; n -= 1) {
    const projected = projectedSegments[n];
    if (!projected || !projected.valid) {
      continue;
    }

    const { p1, p2, roadWidth1, roadWidth2, index } = projected;

    const rumbleWidth1 = roadWidth1 * 1.2;
    const rumbleWidth2 = roadWidth2 * 1.2;
    const laneMarkerWidth1 = roadWidth1 * 0.1;
    const laneMarkerWidth2 = roadWidth2 * 0.1;

    const alternating = Math.floor(index / RUMBLE_LENGTH) % 2 === 0;
    const roadColor = alternating ? "#b67c3a" : "#8f5a2a";
    const rumbleColor = alternating ? "#f7ecd3" : "#5b3620";
    const laneColor = "rgba(255, 244, 200, 0.85)";

    ctx.fillStyle = rumbleColor;
    ctx.beginPath();
    ctx.moveTo(p1.x - rumbleWidth1, p1.y);
    ctx.lineTo(p1.x + rumbleWidth1, p1.y);
    ctx.lineTo(p2.x + rumbleWidth2, p2.y);
    ctx.lineTo(p2.x - rumbleWidth2, p2.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = roadColor;
    ctx.beginPath();
    ctx.moveTo(p1.x - roadWidth1, p1.y);
    ctx.lineTo(p1.x + roadWidth1, p1.y);
    ctx.lineTo(p2.x + roadWidth2, p2.y);
    ctx.lineTo(p2.x - roadWidth2, p2.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = laneColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x - laneMarkerWidth1, p1.y);
    ctx.lineTo(p2.x - laneMarkerWidth2, p2.y);
    ctx.moveTo(p1.x + laneMarkerWidth1, p1.y);
    ctx.lineTo(p2.x + laneMarkerWidth2, p2.y);
    ctx.stroke();

    projected.sprites.sort((a, b) => a.percent - b.percent);
    projected.sprites.forEach((sprite) => {
      const percent = sprite.percent;
      const centerX = p1.x + (p2.x - p1.x) * percent;
      const baseY = p1.y + (p2.y - p1.y) * percent;
      const roadHalf = roadWidth1 + (roadWidth2 - roadWidth1) * percent;
      const entity = sprite.entity;
      const spriteX = centerX + roadHalf * entity.offset;
      const spriteWidth = roadHalf * 0.7;
      const spriteHeight = spriteWidth * 0.6;

      ctx.fillStyle = entity.color;
      drawRoundedRectPath(
        ctx,
        spriteX - spriteWidth / 2,
        baseY - spriteHeight,
        spriteWidth,
        spriteHeight,
        spriteWidth * 0.1
      );
      ctx.fill();

      ctx.fillStyle = "#2c1a12";
      const wheelRadius = spriteWidth * 0.18;
      ctx.beginPath();
      ctx.ellipse(
        spriteX - spriteWidth * 0.28,
        baseY,
        wheelRadius,
        wheelRadius * 0.75,
        0,
        0,
        Math.PI * 2
      );
      ctx.ellipse(
        spriteX + spriteWidth * 0.28,
        baseY,
        wheelRadius,
        wheelRadius * 0.75,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    });
  }

  drawPlayerChariot(projectedSegments[0]);
}

function drawPlayerChariot(nearSegment) {
  const baseX = nearSegment && nearSegment.valid ? nearSegment.p1.x : canvas.width / 2;
  const roadHalf = nearSegment && nearSegment.valid ? nearSegment.roadWidth1 : canvas.width * 0.25;
  const spriteX = baseX + roadHalf * player.offset;
  const spriteWidth = roadHalf * 0.8;
  const spriteHeight = spriteWidth * 0.62;
  const bottomY = canvas.height - 40;

  ctx.fillStyle = "#f0c96d";
  drawRoundedRectPath(
    ctx,
    spriteX - spriteWidth / 2,
    bottomY - spriteHeight,
    spriteWidth,
    spriteHeight,
    18
  );
  ctx.fill();

  ctx.fillStyle = "#784421";
  ctx.fillRect(spriteX - spriteWidth * 0.45, bottomY - spriteHeight * 0.2, spriteWidth * 0.9, spriteHeight * 0.2);

  ctx.fillStyle = "#c4432a";
  ctx.beginPath();
  ctx.moveTo(spriteX - spriteWidth * 0.35, bottomY - spriteHeight * 0.4);
  ctx.lineTo(spriteX + spriteWidth * 0.35, bottomY - spriteHeight * 0.4);
  ctx.lineTo(spriteX + spriteWidth * 0.2, bottomY - spriteHeight * 0.85);
  ctx.lineTo(spriteX - spriteWidth * 0.2, bottomY - spriteHeight * 0.85);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#2b1a10";
  const wheelRadius = spriteWidth * 0.16;
  [ -0.4, 0.4 ].forEach((offset) => {
    ctx.beginPath();
    ctx.ellipse(
      spriteX + spriteWidth * offset,
      bottomY,
      wheelRadius,
      wheelRadius * 0.8,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  });

  ctx.strokeStyle = "#fdf2c3";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(spriteX - spriteWidth * 0.18, bottomY - spriteHeight * 0.8);
  ctx.lineTo(spriteX - spriteWidth * 0.5, bottomY - spriteHeight * 1.2);
  ctx.moveTo(spriteX + spriteWidth * 0.18, bottomY - spriteHeight * 0.8);
  ctx.lineTo(spriteX + spriteWidth * 0.5, bottomY - spriteHeight * 1.2);
  ctx.stroke();
}

function updateHud() {
  const displayLap = Math.min(player.completedLaps + 1, totalLaps);
  hudLap.textContent = `${displayLap} / ${totalLaps}`;
  hudLapTime.textContent = formatTime(raceState.lapTimer);
  hudBest.textContent = raceState.bestLap === null ? "--" : formatTime(raceState.bestLap);
}

function frame(timestamp) {
  if (!raceRunning) return;

  const dt = Math.min((timestamp - lastFrame) / 1000, 0.1);
  lastFrame = timestamp;

  update(dt);
  updateHud();
  render();

  requestAnimationFrame(frame);
}

function beginRace() {
  overlay.classList.add("hidden");
  resetRace();
  raceRunning = true;
  raceFinished = false;
  raceState.lapTimer = 0;
  lastFrame = performance.now();
  requestAnimationFrame(frame);
}

startButton.addEventListener("click", beginRace);

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key in keys) {
    keys[key] = true;
    event.preventDefault();
  }
});

document.addEventListener("keyup", (event) => {
  const key = event.key.toLowerCase();
  if (key in keys) {
    keys[key] = false;
    event.preventDefault();
  }
});

resetRace();
