(function () {
  "use strict";

  const canvas = document.getElementById("streetGame");
  const ctx = canvas.getContext("2d");
  const stage = document.getElementById("gameStage");
  const startScreen = document.getElementById("startScreen");
  const playButton = document.getElementById("playButton");
  const replayButton = document.getElementById("replayButton");
  const matchEnd = document.getElementById("matchEnd");
  const endKicker = document.getElementById("endKicker");
  const endTitle = document.getElementById("endTitle");
  const endScore = document.getElementById("endScore");
  const gameStatus = document.getElementById("gameStatus");
  const joystickZone = document.getElementById("joystickZone");
  const joystickStick = document.getElementById("joystickStick");

  if (!canvas || !ctx || !stage) return;

  const WIDTH = 1280;
  const HEIGHT = 720;
  const PLAYER_RADIUS = 23;
  const BALL_RADIUS = 11;
  const WIN_SCORE = 5;
  const MATCH_SECONDS = 90;
  const pitch = {
    left: 82,
    right: 1198,
    top: 72,
    bottom: 648,
    goalTop: 274,
    goalBottom: 446,
  };

  const palette = {
    cyan: "#5cf2ff",
    cyanDark: "#0c8da4",
    pink: "#ff4278",
    pinkDark: "#a81245",
    lime: "#c8ff38",
    violet: "#9d5cff",
    ink: "#080a10",
    white: "#f7f8fb",
  };

  const keys = new Set();
  const touchMove = { x: 0, y: 0, strength: 0 };
  const particles = [];
  const floatingLabels = [];
  const ballTrail = [];
  let players = [];
  let ball = null;
  let controlledId = 0;
  let lastFrame = performance.now();
  let audioContext = null;
  let joystickPointer = null;

  const game = {
    phase: "idle",
    score: [0, 0],
    time: MATCH_SECONDS,
    countdown: 0,
    goalTimer: 0,
    goalTeam: 0,
    shake: 0,
    flash: 0,
    style: 0,
    combo: 1,
    comboTimer: 0,
    shootStartedAt: null,
    pendingWinner: false,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function normalize(x, y) {
    const magnitude = Math.hypot(x, y);
    if (magnitude < 0.0001) return { x: 0, y: 0, magnitude: 0 };
    return { x: x / magnitude, y: y / magnitude, magnitude };
  }

  function makePlayer(team, slot, x, y) {
    const numbers = team === 0 ? [10, 7, 4] : [9, 11, 6];
    return {
      id: team * 3 + slot,
      team,
      slot,
      number: numbers[slot],
      x,
      y,
      vx: 0,
      vy: 0,
      facingX: team === 0 ? 1 : -1,
      facingY: 0,
      radius: PLAYER_RADIUS,
      cooldown: 0,
      tackleTimer: 0,
      trickTimer: 0,
      invulnerable: 0,
      sprinting: false,
    };
  }

  function buildTeams() {
    players = [
      makePlayer(0, 0, 500, 360),
      makePlayer(0, 1, 305, 225),
      makePlayer(0, 2, 305, 495),
      makePlayer(1, 0, 780, 360),
      makePlayer(1, 1, 975, 225),
      makePlayer(1, 2, 975, 495),
    ];
    controlledId = 0;
    ball = {
      x: WIDTH / 2,
      y: HEIGHT / 2,
      vx: 0,
      vy: 0,
      radius: BALL_RADIUS,
      owner: null,
      lastTouchTeam: null,
      pickupLock: 0,
      wallHits: 0,
    };
  }

  function resetPositions() {
    const positions = [
      [500, 360],
      [305, 225],
      [305, 495],
      [780, 360],
      [975, 225],
      [975, 495],
    ];
    players.forEach((player, index) => {
      player.x = positions[index][0];
      player.y = positions[index][1];
      player.vx = 0;
      player.vy = 0;
      player.facingX = player.team === 0 ? 1 : -1;
      player.facingY = 0;
      player.cooldown = 0;
      player.tackleTimer = 0;
      player.trickTimer = 0;
      player.invulnerable = 0;
    });
    controlledId = 0;
    ball.x = WIDTH / 2;
    ball.y = HEIGHT / 2;
    ball.vx = 0;
    ball.vy = 0;
    ball.owner = null;
    ball.pickupLock = 0.25;
    ball.wallHits = 0;
    ballTrail.length = 0;
    game.shootStartedAt = null;
  }

  function resetMatch() {
    if (!ball) buildTeams();
    resetPositions();
    game.phase = "countdown";
    game.score = [0, 0];
    game.time = MATCH_SECONDS;
    game.countdown = 3.2;
    game.goalTimer = 0;
    game.shake = 0;
    game.flash = 0;
    game.style = 0;
    game.combo = 1;
    game.comboTimer = 0;
    game.pendingWinner = false;
    particles.length = 0;
    floatingLabels.length = 0;
  }

  function beginMatch() {
    ensureAudio();
    resetMatch();
    startScreen.classList.add("is-hidden");
    matchEnd.hidden = true;
    canvas.focus({ preventScroll: true });
    playSound("start");
    gameStatus.textContent = "بدأت مباراة كرة الشوارع";
  }

  function getControlledPlayer() {
    return players.find((player) => player.id === controlledId) || players[0];
  }

  function setControlledPlayer(player) {
    if (!player || player.team !== 0) return;
    controlledId = player.id;
  }

  function nearestPlayer(team, target, exclude) {
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const player of players) {
      if (player.team !== team || player === exclude) continue;
      const currentDistance = distance(player, target);
      if (currentDistance < bestDistance) {
        best = player;
        bestDistance = currentDistance;
      }
    }
    return best;
  }

  function switchPlayer() {
    if (game.phase !== "playing") return;
    if (ball.owner?.team === 0) {
      setControlledPlayer(ball.owner);
      return;
    }
    const current = getControlledPlayer();
    const teammates = players
      .filter((player) => player.team === 0 && player !== current)
      .sort((a, b) => distance(a, ball) - distance(b, ball));
    if (teammates.length) {
      setControlledPlayer(teammates[0]);
      playSound("switch");
    }
  }

  function addStyle(points, label, player) {
    const multiplied = Math.round(points * game.combo);
    game.style += multiplied;
    game.combo = clamp(game.combo + 0.25, 1, 4);
    game.comboTimer = 4;
    floatingLabels.push({
      x: player?.x ?? WIDTH / 2,
      y: (player?.y ?? HEIGHT / 2) - 45,
      text: `${label} +${multiplied}`,
      color: palette.lime,
      life: 1.15,
      maxLife: 1.15,
    });
  }

  function emitBurst(x, y, color, count, speed = 220) {
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.35 + Math.random() * 0.85);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        size: 2 + Math.random() * 5,
        color,
        life: 0.35 + Math.random() * 0.55,
        maxLife: 0.9,
      });
    }
  }

  function takePossession(player) {
    ball.owner = player;
    ball.vx = player.vx;
    ball.vy = player.vy;
    ball.lastTouchTeam = player.team;
    ball.wallHits = 0;
    if (player.team === 0) setControlledPlayer(player);
  }

  function releaseBall(player, targetX, targetY, speed, lift = 0) {
    const direction = normalize(targetX - ball.x, targetY - ball.y);
    ball.owner = null;
    ball.x = player.x + direction.x * (player.radius + ball.radius + 2);
    ball.y = player.y + direction.y * (player.radius + ball.radius + 2);
    ball.vx = direction.x * speed + player.vx * 0.22;
    ball.vy = direction.y * speed + player.vy * 0.22 - lift;
    ball.lastTouchTeam = player.team;
    ball.pickupLock = 0.1;
    ball.wallHits = 0;
  }

  function bestPassTarget(player) {
    const attackDirection = player.team === 0 ? 1 : -1;
    const teammates = players.filter((candidate) => candidate.team === player.team && candidate !== player);
    let best = teammates[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of teammates) {
      const gap = distance(player, candidate);
      const forward = (candidate.x - player.x) * attackDirection;
      const nearbyOpponent = nearestPlayer(1 - player.team, candidate);
      const pressure = nearbyOpponent ? Math.max(0, 130 - distance(nearbyOpponent, candidate)) : 0;
      const score = forward * 0.8 - Math.abs(gap - 260) * 0.25 - pressure * 1.4;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function passOrTackle() {
    if (game.phase !== "playing") return;
    const player = getControlledPlayer();
    if (ball.owner === player) {
      const target = bestPassTarget(player);
      if (target) {
        releaseBall(player, target.x + target.vx * 0.18, target.y + target.vy * 0.18, 630);
        emitBurst(player.x, player.y, palette.cyan, 6, 110);
        playSound("pass");
      }
      return;
    }

    player.tackleTimer = 0.3;
    player.cooldown = Math.max(player.cooldown, 0.42);
    player.vx += player.facingX * 170;
    player.vy += player.facingY * 170;
    const owner = ball.owner;
    if (owner && owner.team !== player.team && owner.invulnerable <= 0 && distance(player, owner) < 92) {
      const away = normalize(owner.x - player.x, owner.y - player.y);
      ball.owner = null;
      ball.x = owner.x + away.x * 28;
      ball.y = owner.y + away.y * 28;
      ball.vx = away.x * 340 + player.vx * 0.4;
      ball.vy = away.y * 340 + player.vy * 0.4;
      ball.pickupLock = 0.15;
      addStyle(120, "STEAL", player);
      emitBurst(ball.x, ball.y, palette.cyan, 12, 190);
      playSound("tackle");
    }
  }

  function startShotCharge() {
    if (game.phase !== "playing" || game.shootStartedAt !== null) return;
    game.shootStartedAt = performance.now();
  }

  function releaseShot() {
    if (game.shootStartedAt === null) return;
    const heldFor = (performance.now() - game.shootStartedAt) / 1000;
    game.shootStartedAt = null;
    if (game.phase !== "playing") return;
    const player = getControlledPlayer();
    if (ball.owner !== player && distance(player, ball) > 54) return;
    if (ball.owner !== player) takePossession(player);

    const charge = clamp(heldFor / 1.05, 0.18, 1);
    const goalX = player.team === 0 ? pitch.right + 64 : pitch.left - 64;
    const naturalAimY = clamp(player.y + player.facingY * 165, pitch.goalTop + 18, pitch.goalBottom - 18);
    const centerBias = lerp((pitch.goalTop + pitch.goalBottom) / 2, naturalAimY, 0.72);
    releaseBall(player, goalX, centerBias, 680 + charge * 390);
    game.shake = 5 + charge * 7;
    emitBurst(ball.x, ball.y, palette.lime, 8 + Math.round(charge * 8), 170);
    playSound(charge > 0.62 ? "powerShot" : "shot");
  }

  function doSkill() {
    if (game.phase !== "playing") return;
    const player = getControlledPlayer();
    if (player.cooldown > 0) return;

    player.cooldown = 0.78;
    player.trickTimer = 0.52;
    player.invulnerable = 0.42;
    const movement = getHumanMovement();
    const forward = movement.magnitude > 0.1 ? movement : { x: player.facingX, y: player.facingY };
    const side = Math.random() > 0.5 ? 1 : -1;
    player.vx += forward.x * 230 - forward.y * 145 * side;
    player.vy += forward.y * 230 + forward.x * 145 * side;

    if (ball.owner === player) {
      const defender = nearestPlayer(1, player);
      const closeDefender = defender && distance(player, defender) < 125;
      addStyle(closeDefender ? 260 : 90, closeDefender ? "SKINNED" : "FLAIR", player);
      emitBurst(player.x, player.y, palette.pink, closeDefender ? 18 : 9, 175);
    }
    playSound("skill");
  }

  function getHumanMovement() {
    let x = touchMove.x;
    let y = touchMove.y;
    if (keys.has("ArrowLeft") || keys.has("KeyA")) x -= 1;
    if (keys.has("ArrowRight") || keys.has("KeyD")) x += 1;
    if (keys.has("ArrowUp") || keys.has("KeyW")) y -= 1;
    if (keys.has("ArrowDown") || keys.has("KeyS")) y += 1;
    return normalize(x, y);
  }

  function steerTo(player, targetX, targetY, speed, dt) {
    const direction = normalize(targetX - player.x, targetY - player.y);
    const blend = clamp(dt * 6.8, 0, 1);
    player.vx = lerp(player.vx, direction.x * speed, blend);
    player.vy = lerp(player.vy, direction.y * speed, blend);
    if (direction.magnitude > 2) {
      player.facingX = direction.x;
      player.facingY = direction.y;
    }
  }

  function formationTarget(player) {
    const teamLeft = player.team === 0;
    const direction = teamLeft ? 1 : -1;
    const baseX = teamLeft ? 330 : 950;
    const ballInfluence = clamp((ball.x - WIDTH / 2) * 0.33, -150, 150);
    const laneY = [360, 220, 500][player.slot];
    const ownerForward = ball.owner?.team === player.team ? direction * (player.slot === 0 ? 115 : 195) : 0;
    return {
      x: baseX + ballInfluence + ownerForward,
      y: lerp(laneY, ball.y, player.slot === 0 ? 0.16 : 0.26),
    };
  }

  function aiShoot(player) {
    const targetX = player.team === 0 ? pitch.right + 70 : pitch.left - 70;
    const targetY = clamp(360 + (Math.random() - 0.5) * 118, pitch.goalTop + 15, pitch.goalBottom - 15);
    releaseBall(player, targetX, targetY, 790 + Math.random() * 105);
    player.cooldown = 0.75;
    game.shake = 5;
    playSound("shot");
  }

  function updateAI(player, dt) {
    const attackDirection = player.team === 0 ? 1 : -1;
    const opponentGoalX = player.team === 0 ? pitch.right : pitch.left;
    const hasBall = ball.owner === player;

    if (hasBall) {
      const goalDistance = Math.abs(opponentGoalX - player.x);
      if (goalDistance < 330 && player.cooldown <= 0 && Math.abs(player.y - 360) < 190) {
        aiShoot(player);
        return;
      }
      const dodgeY = Math.sin(performance.now() / 430 + player.id) * 75;
      steerTo(player, player.x + attackDirection * 210, clamp(360 + dodgeY, 145, 575), 250, dt);
      return;
    }

    if (!ball.owner) {
      const nearest = nearestPlayer(player.team, ball);
      if (nearest === player) {
        steerTo(player, ball.x, ball.y, 255, dt);
      } else {
        const target = formationTarget(player);
        steerTo(player, target.x, target.y, 190, dt);
      }
      return;
    }

    if (ball.owner.team === player.team) {
      const target = formationTarget(player);
      target.x += attackDirection * 80;
      steerTo(player, target.x, target.y, 205, dt);
      return;
    }

    const nearestDefender = nearestPlayer(player.team, ball.owner);
    if (nearestDefender === player) {
      steerTo(player, ball.owner.x - ball.owner.facingX * 20, ball.owner.y - ball.owner.facingY * 20, 258, dt);
      if (distance(player, ball.owner) < 52 && player.cooldown <= 0 && ball.owner.invulnerable <= 0) {
        player.cooldown = 0.65;
        const stealDirection = normalize(ball.owner.x - player.x, ball.owner.y - player.y);
        ball.owner = null;
        ball.vx = stealDirection.x * 250;
        ball.vy = stealDirection.y * 250;
        ball.pickupLock = 0.12;
        emitBurst(ball.x, ball.y, player.team === 0 ? palette.cyan : palette.pink, 8, 140);
        playSound("tackle");
      }
    } else {
      const target = formationTarget(player);
      target.x -= attackDirection * 115;
      steerTo(player, target.x, target.y, 195, dt);
    }
  }

  function updatePlayers(dt) {
    const controlled = getControlledPlayer();
    const movement = getHumanMovement();
    const wantsSprint = keys.has("ShiftLeft") || keys.has("ShiftRight") || touchMove.strength > 0.86;

    for (const player of players) {
      player.cooldown = Math.max(0, player.cooldown - dt);
      player.tackleTimer = Math.max(0, player.tackleTimer - dt);
      player.trickTimer = Math.max(0, player.trickTimer - dt);
      player.invulnerable = Math.max(0, player.invulnerable - dt);
      player.sprinting = false;

      if (player === controlled) {
        const speed = wantsSprint ? 310 : 246;
        const blend = clamp(dt * 10, 0, 1);
        player.vx = lerp(player.vx, movement.x * speed, blend);
        player.vy = lerp(player.vy, movement.y * speed, blend);
        player.sprinting = wantsSprint && movement.magnitude > 0.1;
        if (movement.magnitude > 0.1) {
          player.facingX = movement.x;
          player.facingY = movement.y;
        }
      } else {
        updateAI(player, dt);
      }

      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.x = clamp(player.x, pitch.left + player.radius + 3, pitch.right - player.radius - 3);
      player.y = clamp(player.y, pitch.top + player.radius + 3, pitch.bottom - player.radius - 3);
    }

    separatePlayers();
  }

  function separatePlayers() {
    for (let first = 0; first < players.length; first += 1) {
      for (let second = first + 1; second < players.length; second += 1) {
        const a = players[first];
        const b = players[second];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const gap = Math.hypot(dx, dy) || 0.001;
        const minimum = a.radius + b.radius - 2;
        if (gap >= minimum) continue;
        const overlap = (minimum - gap) / 2;
        const nx = dx / gap;
        const ny = dy / gap;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
      }
    }
  }

  function updateOwnedBall() {
    const owner = ball.owner;
    if (!owner) return;
    const dribbleOffset = owner.trickTimer > 0 ? 37 : 30;
    const bob = Math.sin(performance.now() / 72) * (owner.sprinting ? 4 : 2);
    ball.x = owner.x + owner.facingX * dribbleOffset - owner.facingY * bob;
    ball.y = owner.y + owner.facingY * dribbleOffset + owner.facingX * bob;
    ball.vx = owner.vx;
    ball.vy = owner.vy;
  }

  function registerGoal(team) {
    if (game.phase !== "playing") return;
    game.score[team] += 1;
    game.goalTeam = team;
    game.phase = "goal";
    game.goalTimer = 1.75;
    game.pendingWinner = game.score[team] >= WIN_SCORE;
    game.flash = 1;
    game.shake = 18;
    ball.owner = null;
    ball.vx *= 0.3;
    ball.vy *= 0.3;
    emitBurst(ball.x, ball.y, team === 0 ? palette.cyan : palette.pink, 46, 390);
    if (team === 0) addStyle(700, "GOAL", getControlledPlayer());
    playSound("goal");
    gameStatus.textContent = team === 0 ? "هدف لك" : "هدف للفريق المنافس";
  }

  function resolveWallsAndGoals() {
    const inGoalOpening = ball.y > pitch.goalTop && ball.y < pitch.goalBottom;
    if (ball.x > pitch.right + 42 && inGoalOpening) {
      registerGoal(0);
      return;
    }
    if (ball.x < pitch.left - 42 && inGoalOpening) {
      registerGoal(1);
      return;
    }

    let hitWall = false;
    if (ball.y - ball.radius < pitch.top) {
      ball.y = pitch.top + ball.radius;
      ball.vy = Math.abs(ball.vy) * 0.78;
      hitWall = true;
    } else if (ball.y + ball.radius > pitch.bottom) {
      ball.y = pitch.bottom - ball.radius;
      ball.vy = -Math.abs(ball.vy) * 0.78;
      hitWall = true;
    }

    if (!inGoalOpening && ball.x - ball.radius < pitch.left) {
      ball.x = pitch.left + ball.radius;
      ball.vx = Math.abs(ball.vx) * 0.78;
      hitWall = true;
    } else if (!inGoalOpening && ball.x + ball.radius > pitch.right) {
      ball.x = pitch.right - ball.radius;
      ball.vx = -Math.abs(ball.vx) * 0.78;
      hitWall = true;
    }

    if (hitWall && Math.hypot(ball.vx, ball.vy) > 280) {
      ball.wallHits += 1;
      emitBurst(ball.x, ball.y, "rgba(255,255,255,.75)", 5, 100);
      playSound("wall");
      if (ball.lastTouchTeam === 0 && ball.wallHits === 1) addStyle(75, "WALL PLAY", getControlledPlayer());
    }
  }

  function tryBallPickup() {
    if (ball.owner || ball.pickupLock > 0) return;
    const speed = Math.hypot(ball.vx, ball.vy);
    const candidates = [...players].sort((a, b) => distance(a, ball) - distance(b, ball));
    for (const player of candidates) {
      if (distance(player, ball) > player.radius + ball.radius + 7) continue;
      if (speed > 720 && ball.lastTouchTeam !== player.team) {
        const bounce = normalize(ball.x - player.x, ball.y - player.y);
        ball.vx = bounce.x * speed * 0.58;
        ball.vy = bounce.y * speed * 0.58;
        emitBurst(ball.x, ball.y, palette.white, 5, 95);
        return;
      }
      takePossession(player);
      if (player.team === 0) playSound("receive");
      return;
    }
  }

  function updateBall(dt) {
    ball.pickupLock = Math.max(0, ball.pickupLock - dt);
    if (ball.owner) {
      updateOwnedBall();
      return;
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const drag = Math.pow(0.986, dt * 60);
    ball.vx *= drag;
    ball.vy *= drag;
    resolveWallsAndGoals();
    if (game.phase === "playing") tryBallPickup();

    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed > 360) {
      ballTrail.unshift({ x: ball.x, y: ball.y, life: 0.2 });
      if (ballTrail.length > 10) ballTrail.pop();
    }
  }

  function updateEffects(dt) {
    game.shake = Math.max(0, game.shake - dt * 28);
    game.flash = Math.max(0, game.flash - dt * 2.8);
    game.comboTimer = Math.max(0, game.comboTimer - dt);
    if (game.comboTimer <= 0) game.combo = 1;

    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.life -= dt;
      if (particle.life <= 0) {
        particles.splice(index, 1);
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.95, dt * 60);
      particle.vy *= Math.pow(0.95, dt * 60);
    }

    for (let index = floatingLabels.length - 1; index >= 0; index -= 1) {
      const label = floatingLabels[index];
      label.life -= dt;
      label.y -= dt * 32;
      if (label.life <= 0) floatingLabels.splice(index, 1);
    }

    for (let index = ballTrail.length - 1; index >= 0; index -= 1) {
      ballTrail[index].life -= dt;
      if (ballTrail[index].life <= 0) ballTrail.splice(index, 1);
    }
  }

  function update(dt) {
    updateEffects(dt);

    if (game.phase === "countdown") {
      game.countdown -= dt;
      if (game.countdown <= 0) {
        game.phase = "playing";
        playSound("whistle");
      }
      return;
    }

    if (game.phase === "goal") {
      updateBall(dt);
      game.goalTimer -= dt;
      if (game.goalTimer <= 0) {
        if (game.pendingWinner) {
          finishMatch();
        } else {
          resetPositions();
          game.phase = "countdown";
          game.countdown = 1.25;
        }
      }
      return;
    }

    if (game.phase !== "playing") return;

    game.time = Math.max(0, game.time - dt);
    updatePlayers(dt);
    updateBall(dt);

    if (game.time <= 0) finishMatch();
  }

  function finishMatch() {
    game.phase = "ended";
    game.shootStartedAt = null;
    const userWon = game.score[0] > game.score[1];
    const draw = game.score[0] === game.score[1];
    endKicker.textContent = `نقاط الأسلوب ${game.style.toLocaleString("en-US")}`;
    endTitle.textContent = draw ? "تعادل" : userWon ? "الفوز لك" : "جولة أخرى؟";
    endScore.textContent = `${game.score[0]} — ${game.score[1]}`;
    matchEnd.hidden = false;
    playSound(userWon ? "win" : "end");
    gameStatus.textContent = `انتهت المباراة بنتيجة ${game.score[0]} مقابل ${game.score[1]}`;
  }

  function roundedRect(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.roundRect(x, y, width, height, safeRadius);
  }

  function drawBackground() {
    const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    background.addColorStop(0, "#181429");
    background.addColorStop(0.52, "#0f1420");
    background.addColorStop(1, "#1d1020");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    ctx.globalAlpha = 0.25;
    for (let index = 0; index < 160; index += 1) {
      const x = (index * 83) % WIDTH;
      const y = (index * 47) % HEIGHT;
      ctx.fillStyle = index % 3 === 0 ? "#8f72ba" : "#8290a4";
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.restore();

    ctx.fillStyle = "rgba(4, 7, 11, .7)";
    for (let x = 0; x < WIDTH; x += 55) {
      const buildingHeight = 35 + ((x * 17) % 62);
      ctx.fillRect(x, pitch.top - buildingHeight, 48, buildingHeight);
    }

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "#8790a4";
    ctx.lineWidth = 1;
    for (let x = 0; x < WIDTH + 80; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x - 75, pitch.top);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 75, pitch.top);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCourt() {
    ctx.save();
    roundedRect(ctx, pitch.left, pitch.top, pitch.right - pitch.left, pitch.bottom - pitch.top, 13);
    const court = ctx.createLinearGradient(pitch.left, pitch.top, pitch.right, pitch.bottom);
    court.addColorStop(0, "#26313b");
    court.addColorStop(0.48, "#202932");
    court.addColorStop(1, "#2b2631");
    ctx.fillStyle = court;
    ctx.fill();
    ctx.clip();

    ctx.globalAlpha = 0.12;
    for (let y = pitch.top; y < pitch.bottom; y += 23) {
      ctx.fillStyle = y % 46 === 0 ? "#b2bac4" : "#080a0e";
      ctx.fillRect(pitch.left, y, pitch.right - pitch.left, 1.4);
    }
    for (let index = 0; index < 90; index += 1) {
      const x = pitch.left + ((index * 103) % (pitch.right - pitch.left));
      const y = pitch.top + ((index * 71) % (pitch.bottom - pitch.top));
      ctx.fillStyle = index % 2 ? "rgba(255,255,255,.045)" : "rgba(0,0,0,.08)";
      ctx.fillRect(x, y, 28 + (index % 5) * 11, 2);
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(234, 239, 245, .48)";
    ctx.lineWidth = 3;
    roundedRect(ctx, pitch.left + 8, pitch.top + 8, pitch.right - pitch.left - 16, pitch.bottom - pitch.top - 16, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2, pitch.top + 8);
    ctx.lineTo(WIDTH / 2, pitch.bottom - 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(WIDTH / 2, HEIGHT / 2, 83, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(234, 239, 245, .55)";
    ctx.beginPath();
    ctx.arc(WIDTH / 2, HEIGHT / 2, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeRect(pitch.left + 8, 225, 152, 270);
    ctx.strokeRect(pitch.right - 160, 225, 152, 270);
    ctx.restore();

    drawGraffiti();
    drawWalls();
    drawGoals();
  }

  function drawGraffiti() {
    ctx.save();
    ctx.translate(230, 132);
    ctx.rotate(-0.09);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = palette.violet;
    ctx.font = "italic 700 42px Space Grotesk, sans-serif";
    ctx.fillText("NO RULES", 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(885, 590);
    ctx.rotate(0.06);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = palette.cyan;
    ctx.font = "italic 700 37px Space Grotesk, sans-serif";
    ctx.fillText("OWN THE NIGHT", 0, 0);
    ctx.restore();
  }

  function drawWalls() {
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#05070b";
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(pitch.left, pitch.top);
    ctx.lineTo(pitch.right, pitch.top);
    ctx.moveTo(pitch.left, pitch.bottom);
    ctx.lineTo(pitch.right, pitch.bottom);
    ctx.moveTo(pitch.left, pitch.top);
    ctx.lineTo(pitch.left, pitch.goalTop);
    ctx.moveTo(pitch.left, pitch.goalBottom);
    ctx.lineTo(pitch.left, pitch.bottom);
    ctx.moveTo(pitch.right, pitch.top);
    ctx.lineTo(pitch.right, pitch.goalTop);
    ctx.moveTo(pitch.right, pitch.goalBottom);
    ctx.lineTo(pitch.right, pitch.bottom);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,.2)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function drawGoals() {
    for (const side of [-1, 1]) {
      const lineX = side === -1 ? pitch.left : pitch.right;
      const backX = lineX + side * 56;
      ctx.save();
      ctx.strokeStyle = "rgba(226, 234, 242, .7)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(lineX, pitch.goalTop);
      ctx.lineTo(backX, pitch.goalTop + 13);
      ctx.lineTo(backX, pitch.goalBottom - 13);
      ctx.lineTo(lineX, pitch.goalBottom);
      ctx.stroke();

      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      for (let y = pitch.goalTop + 18; y < pitch.goalBottom; y += 20) {
        ctx.beginPath();
        ctx.moveTo(lineX, y);
        ctx.lineTo(backX, y);
        ctx.stroke();
      }
      for (let step = 1; step <= 3; step += 1) {
        const x = lerp(lineX, backX, step / 4);
        ctx.beginPath();
        ctx.moveTo(x, pitch.goalTop + 8);
        ctx.lineTo(x, pitch.goalBottom - 8);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawPlayer(player) {
    const controlled = player.id === controlledId;
    const teamColor = player.team === 0 ? palette.cyan : palette.pink;
    const darkColor = player.team === 0 ? palette.cyanDark : palette.pinkDark;

    ctx.save();
    ctx.translate(player.x, player.y);

    ctx.fillStyle = "rgba(0,0,0,.34)";
    ctx.beginPath();
    ctx.ellipse(4, 15, 25, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    if (player.sprinting) {
      ctx.strokeStyle = `${teamColor}77`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-player.facingX * 24 - player.facingY * 9, -player.facingY * 24 + player.facingX * 9);
      ctx.lineTo(-player.facingX * 55 - player.facingY * 9, -player.facingY * 55 + player.facingX * 9);
      ctx.moveTo(-player.facingX * 24 + player.facingY * 9, -player.facingY * 24 - player.facingX * 9);
      ctx.lineTo(-player.facingX * 45 + player.facingY * 9, -player.facingY * 45 - player.facingX * 9);
      ctx.stroke();
    }

    if (player.trickTimer > 0) {
      ctx.strokeStyle = palette.lime;
      ctx.lineWidth = 3;
      ctx.globalAlpha = clamp(player.trickTimer * 2, 0, 1);
      ctx.beginPath();
      ctx.arc(0, 0, 34 + (0.52 - player.trickTimer) * 25, -0.7, Math.PI * 1.55);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (controlled) {
      ctx.strokeStyle = palette.lime;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 2, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = palette.lime;
      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.lineTo(-7, -53);
      ctx.lineTo(7, -53);
      ctx.closePath();
      ctx.fill();
    }

    const jersey = ctx.createRadialGradient(-7, -9, 2, 0, 0, 27);
    jersey.addColorStop(0, "#ffffff");
    jersey.addColorStop(0.1, teamColor);
    jersey.addColorStop(1, darkColor);
    ctx.fillStyle = jersey;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.6)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.rotate(Math.atan2(player.facingY, player.facingX) + Math.PI / 2);
    ctx.fillStyle = "rgba(8,10,16,.76)";
    ctx.fillRect(-4, -player.radius + 1, 8, 15);
    ctx.restore();

    ctx.fillStyle = "#071017";
    ctx.font = "700 13px Space Grotesk, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(player.number), 0, 1);

    if (player.tackleTimer > 0) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.globalAlpha = player.tackleTimer * 2.7;
      ctx.beginPath();
      ctx.moveTo(player.facingX * 19, player.facingY * 19);
      ctx.lineTo(player.facingX * 42, player.facingY * 42);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBall() {
    for (const [index, trail] of ballTrail.entries()) {
      ctx.fillStyle = `rgba(200,255,56,${trail.life * (0.32 - index * 0.018)})`;
      ctx.beginPath();
      ctx.arc(trail.x, trail.y, BALL_RADIUS * (1 - index * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.fillStyle = "rgba(0,0,0,.38)";
    ctx.beginPath();
    ctx.ellipse(4, 8, 13, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7f8fb";
    ctx.beginPath();
    ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#11151c";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#171b24";
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(5, -1);
    ctx.lineTo(3, 5);
    ctx.lineTo(-3, 5);
    ctx.lineTo(-5, -1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    for (const particle of particles) {
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.font = "italic 700 18px Space Grotesk, sans-serif";
    for (const label of floatingLabels) {
      ctx.globalAlpha = clamp(label.life / label.maxLife, 0, 1);
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, label.x, label.y);
    }
    ctx.globalAlpha = 1;
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(safe / 60);
    const remainder = String(safe % 60).padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

  function drawHud() {
    ctx.save();
    ctx.textBaseline = "middle";

    roundedRect(ctx, WIDTH / 2 - 177, 18, 354, 62, 12);
    ctx.fillStyle = "rgba(5,7,12,.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.15)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "700 12px Space Grotesk, sans-serif";
    ctx.fillStyle = palette.cyan;
    ctx.textAlign = "right";
    ctx.fillText("KZ CREW", WIDTH / 2 - 70, 49);
    ctx.fillStyle = palette.pink;
    ctx.textAlign = "left";
    ctx.fillText("NIGHT CREW", WIDTH / 2 + 70, 49);

    ctx.fillStyle = palette.white;
    ctx.font = "700 29px Space Grotesk, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${game.score[0]}  :  ${game.score[1]}`, WIDTH / 2, 46);

    roundedRect(ctx, WIDTH / 2 - 38, 78, 76, 26, 7);
    ctx.fillStyle = "rgba(5,7,12,.82)";
    ctx.fill();
    ctx.font = "700 13px Space Grotesk, sans-serif";
    ctx.fillStyle = "#d8dce6";
    ctx.fillText(formatTime(game.time), WIDTH / 2, 91);

    roundedRect(ctx, 24, 22, 188, 49, 10);
    ctx.fillStyle = "rgba(5,7,12,.72)";
    ctx.fill();
    ctx.textAlign = "left";
    ctx.font = "700 10px Space Grotesk, sans-serif";
    ctx.fillStyle = "#8e96a9";
    ctx.fillText("STYLE", 42, 39);
    ctx.font = "700 19px Space Grotesk, sans-serif";
    ctx.fillStyle = palette.lime;
    ctx.fillText(game.style.toLocaleString("en-US"), 42, 57);
    if (game.combo > 1) {
      ctx.textAlign = "right";
      ctx.fillStyle = palette.pink;
      ctx.fillText(`x${game.combo.toFixed(2)}`, 194, 54);
    }

    ctx.restore();
  }

  function drawShotMeter() {
    if (game.shootStartedAt === null || game.phase !== "playing") return;
    const player = getControlledPlayer();
    const charge = clamp((performance.now() - game.shootStartedAt) / 1050, 0, 1);
    const width = 78;
    const x = player.x - width / 2;
    const y = player.y - 72;
    ctx.fillStyle = "rgba(5,7,12,.86)";
    roundedRect(ctx, x - 3, y - 3, width + 6, 12, 6);
    ctx.fill();
    const meter = ctx.createLinearGradient(x, 0, x + width, 0);
    meter.addColorStop(0, palette.cyan);
    meter.addColorStop(0.65, palette.lime);
    meter.addColorStop(1, palette.pink);
    ctx.fillStyle = meter;
    roundedRect(ctx, x, y, width * charge, 6, 4);
    ctx.fill();
  }

  function drawPhaseOverlay() {
    if (game.phase === "countdown") {
      const number = Math.ceil(game.countdown);
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "italic 700 132px Space Grotesk, sans-serif";
      ctx.fillStyle = number > 0 ? palette.lime : palette.white;
      ctx.shadowColor = "rgba(0,0,0,.55)";
      ctx.shadowBlur = 20;
      ctx.fillText(number > 0 ? String(number) : "GO", WIDTH / 2, HEIGHT / 2);
      ctx.restore();
    }

    if (game.phase === "goal") {
      ctx.save();
      ctx.translate(WIDTH / 2, HEIGHT / 2);
      ctx.rotate(-0.035);
      ctx.fillStyle = game.goalTeam === 0 ? palette.lime : palette.pink;
      ctx.fillRect(-360, -72, 720, 144);
      ctx.fillStyle = palette.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "italic 700 92px Space Grotesk, sans-serif";
      ctx.fillText(game.goalTeam === 0 ? "GOOOAL!" : "THEY SCORED", 0, 0);
      ctx.restore();
    }
  }

  function draw() {
    const scaleX = canvas.width / WIDTH;
    const scaleY = canvas.height / HEIGHT;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const shakeX = game.shake > 0 ? (Math.random() - 0.5) * game.shake : 0;
    const shakeY = game.shake > 0 ? (Math.random() - 0.5) * game.shake : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawBackground();
    drawCourt();
    for (const player of players) drawPlayer(player);
    drawBall();
    drawParticles();
    drawShotMeter();
    ctx.restore();

    drawHud();
    drawPhaseOverlay();

    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${game.flash * 0.22})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const nextWidth = Math.max(1, Math.round(rect.width * pixelRatio));
    const nextHeight = Math.max(1, Math.round(rect.height * pixelRatio));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
  }

  function frame(now) {
    const dt = clamp((now - lastFrame) / 1000, 0, 0.034);
    lastFrame = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function ensureAudio() {
    if (audioContext) {
      if (audioContext.state === "suspended") audioContext.resume();
      return;
    }
    const AudioConstructor = window.AudioContext || window.webkitAudioContext;
    if (AudioConstructor) audioContext = new AudioConstructor();
  }

  function tone(frequency, duration, type = "sine", gain = 0.035, delay = 0) {
    if (!audioContext) return;
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    const start = audioContext.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    volume.gain.setValueAtTime(gain, start);
    volume.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  function playSound(name) {
    if (!audioContext) return;
    if (name === "pass" || name === "receive") tone(name === "pass" ? 170 : 230, 0.07, "triangle", 0.025);
    if (name === "shot") tone(95, 0.12, "square", 0.04);
    if (name === "powerShot") {
      tone(78, 0.18, "sawtooth", 0.05);
      tone(148, 0.1, "square", 0.03, 0.04);
    }
    if (name === "tackle") tone(72, 0.09, "square", 0.032);
    if (name === "wall") tone(260, 0.045, "triangle", 0.018);
    if (name === "skill") {
      tone(390, 0.06, "sine", 0.025);
      tone(620, 0.09, "sine", 0.02, 0.05);
    }
    if (name === "switch") tone(330, 0.045, "sine", 0.018);
    if (name === "whistle") {
      tone(1280, 0.17, "sine", 0.025);
      tone(1540, 0.13, "sine", 0.02, 0.06);
    }
    if (name === "start") {
      tone(220, 0.08, "square", 0.022);
      tone(330, 0.08, "square", 0.022, 0.09);
      tone(440, 0.12, "square", 0.022, 0.18);
    }
    if (name === "goal") {
      tone(110, 0.3, "sawtooth", 0.045);
      tone(220, 0.25, "square", 0.025, 0.08);
      tone(440, 0.32, "triangle", 0.028, 0.18);
    }
    if (name === "win") {
      tone(330, 0.14, "triangle", 0.03);
      tone(440, 0.14, "triangle", 0.03, 0.14);
      tone(660, 0.3, "triangle", 0.035, 0.28);
    }
    if (name === "end") tone(170, 0.38, "triangle", 0.025);
  }

  function handleActionDown(action) {
    if (action === "pass") passOrTackle();
    if (action === "skill") doSkill();
    if (action === "switch") switchPlayer();
    if (action === "shoot") startShotCharge();
  }

  function handleActionUp(action) {
    if (action === "shoot") releaseShot();
  }

  function handleKeyDown(event) {
    const gameKeys = [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "KeyJ",
      "KeyK",
      "KeyL",
      "KeyQ",
      "Space",
      "ShiftLeft",
      "ShiftRight",
      "Enter",
    ];
    if (gameKeys.includes(event.code)) event.preventDefault();
    keys.add(event.code);

    if ((game.phase === "idle" || game.phase === "ended") && (event.code === "Enter" || event.code === "Space")) {
      beginMatch();
      return;
    }
    if (event.repeat) return;
    if (event.code === "KeyJ") passOrTackle();
    if (event.code === "KeyL") doSkill();
    if (event.code === "KeyQ") switchPlayer();
    if (event.code === "KeyK" || event.code === "Space") startShotCharge();
  }

  function handleKeyUp(event) {
    keys.delete(event.code);
    if (event.code === "KeyK" || event.code === "Space") releaseShot();
  }

  function setJoystick(event) {
    const rect = joystickZone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxDistance = rect.width * 0.31;
    const rawX = event.clientX - centerX;
    const rawY = event.clientY - centerY;
    const vector = normalize(rawX, rawY);
    const distanceFromCenter = Math.min(maxDistance, vector.magnitude);
    const x = vector.x * distanceFromCenter;
    const y = vector.y * distanceFromCenter;
    touchMove.x = x / maxDistance;
    touchMove.y = y / maxDistance;
    touchMove.strength = distanceFromCenter / maxDistance;
    joystickStick.style.transform = `translate(${x}px, ${y}px)`;
  }

  function releaseJoystick() {
    joystickPointer = null;
    touchMove.x = 0;
    touchMove.y = 0;
    touchMove.strength = 0;
    joystickStick.style.transform = "translate(0, 0)";
  }

  joystickZone?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    joystickPointer = event.pointerId;
    joystickZone.setPointerCapture(event.pointerId);
    setJoystick(event);
  });
  joystickZone?.addEventListener("pointermove", (event) => {
    if (event.pointerId === joystickPointer) setJoystick(event);
  });
  joystickZone?.addEventListener("pointerup", releaseJoystick);
  joystickZone?.addEventListener("pointercancel", releaseJoystick);

  document.querySelectorAll("[data-action]").forEach((button) => {
    const action = button.dataset.action;
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add("is-pressed");
      handleActionDown(action);
    });
    const finish = (event) => {
      event.preventDefault();
      button.classList.remove("is-pressed");
      handleActionUp(action);
    };
    button.addEventListener("pointerup", finish);
    button.addEventListener("pointercancel", finish);
  });

  playButton.addEventListener("click", beginMatch);
  replayButton.addEventListener("click", beginMatch);
  window.addEventListener("keydown", handleKeyDown, { passive: false });
  window.addEventListener("keyup", handleKeyUp, { passive: false });
  window.addEventListener("blur", () => {
    keys.clear();
    releaseJoystick();
    if (game.shootStartedAt !== null) releaseShot();
  });
  window.addEventListener("resize", resizeCanvas);
  new ResizeObserver(resizeCanvas).observe(stage);

  buildTeams();
  resizeCanvas();
  requestAnimationFrame(frame);
})();
