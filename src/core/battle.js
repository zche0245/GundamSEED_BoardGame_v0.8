import { HANGAR_LOADOUT, getUnitType } from "../data/units.js";

export const BOARD = {
  width: 13,
  height: 13,
  maxRound: 10,
  coreHp: 10,
  moveRange: 2,
  coreMoveRange: 1,
  obstacleCount: 10,
};

export const POINT_ROWS = [5, 6, 7];
export const CENTER_COLUMN = 6;

export const DIFFICULTY_PRESETS = {
  easy: {
    id: "easy",
    name: "简单",
    pointRowOffset: 0,
    enemyCoreEnergy: 2,
    enemyScore: 0
  },
  normal: {
    id: "normal",
    name: "普通",
    pointRowOffset: -1,
    enemyCoreEnergy: 4,
    enemyScore: 3
  },
  hard: {
    id: "hard",
    name: "困难",
    pointRowOffset: -2,
    enemyCoreEnergy: 5,
    enemyScore: 6
  }
};

export const OBSTACLE_PRESETS = {
  light: { id: "light", name: "少量", count: 6 },
  standard: { id: "standard", name: "标准", count: 10 },
  dense: { id: "dense", name: "密集", count: 14 },
  heavy: { id: "heavy", name: "极密", count: 18 }
};

export const SIDE_NAME = {
  player: "玩家",
  enemy: "AI"
};

export const DIRECTIONS = {
  up: { id: "up", name: "上", dx: 0, dy: -1 },
  right: { id: "right", name: "右", dx: 1, dy: 0 },
  down: { id: "down", name: "下", dx: 0, dy: 1 },
  left: { id: "left", name: "左", dx: -1, dy: 0 }
};

export const RAY_DIRECTIONS = [
  { id: "up", name: "上", dx: 0, dy: -1 },
  { id: "up-right", name: "右上", dx: 1, dy: -1 },
  { id: "right", name: "右", dx: 1, dy: 0 },
  { id: "down-right", name: "右下", dx: 1, dy: 1 },
  { id: "down", name: "下", dx: 0, dy: 1 },
  { id: "down-left", name: "左下", dx: -1, dy: 1 },
  { id: "left", name: "左", dx: -1, dy: 0 },
  { id: "up-left", name: "左上", dx: -1, dy: -1 }
];

const ENERGY_ZONE_MIN = 3;
const ENERGY_ZONE_MAX = 4;

export function otherSide(side) {
  return side === "player" ? "enemy" : "player";
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

export function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

export function displayCoord(cell) {
  return `${cell.x + 1}-${cell.y + 1}`;
}

export function coreStart(side) {
  return side === "player"
    ? { x: CENTER_COLUMN, y: BOARD.height - 1 }
    : { x: CENTER_COLUMN, y: 0 };
}

export function deploymentCellsForCore(core) {
  const cells = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const cell = { x: core.x + dx, y: core.y + dy };
      if (cell.x >= 0 && cell.x < BOARD.width && cell.y >= 0 && cell.y < BOARD.height) cells.push(cell);
    }
  }
  return cells;
}

export class BattleGame {
  constructor({ random = Math.random, difficulty = "easy", obstacleCount = BOARD.obstacleCount } = {}) {
    this.random = random;
    this.difficulty = DIFFICULTY_PRESETS[difficulty] ?? DIFFICULTY_PRESETS.easy;
    this.obstacleCount = Math.max(0, Math.min(36, Number(obstacleCount) || BOARD.obstacleCount));
    this.listeners = new Set();
    this.cardCounter = 1;
    this.unitCounter = 1;
    this.reset();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event = { type: "state" }) {
    for (const listener of this.listeners) listener(this.state, event);
  }

  reset() {
    this.cardCounter = 1;
    this.unitCounter = 1;
    const cores = {
      player: this.createCore("player"),
      enemy: this.createCore("enemy")
    };
    this.applyDifficultyToCores(cores);
    const strategicPoints = this.generateStrategicPoints(cores);
    const energyZones = this.generateEnergyZones(strategicPoints);
    this.state = {
      round: 1,
      phase: "player",
      activeSide: "player",
      winner: null,
      units: [],
      cores,
      strategicPoints,
      energyZones,
      obstacles: this.generateObstacles(cores, strategicPoints),
      factions: {
        player: this.createFactionState("player"),
        enemy: this.createFactionState("enemy")
      },
      log: []
    };
    this.applyDifficultyToFactions();
    this.beginTurn("player", { opening: true });
    this.addLog("第1回合：玩家行动。选择机体后主动移动、普攻或释放技能。");
    this.notify({ type: "reset" });
  }

  applyDifficultyToCores(cores) {
    cores.enemy.energy = Math.min(cores.enemy.baseEnergy, this.difficulty.enemyCoreEnergy);
  }

  applyDifficultyToFactions() {
    this.state.factions.enemy.score = this.difficulty.enemyScore;
  }

  createCore(side) {
    const start = this.randomCoreStart(side);
    return {
      id: `core-${side}`,
      side,
      name: `${SIDE_NAME[side]}母舰`,
      type: "core",
      x: start.x,
      y: start.y,
      attack: 1,
      hp: BOARD.coreHp,
      maxHp: BOARD.coreHp,
      baseEnergy: 5,
      energy: 2,
      regen: 1,
      moveRange: BOARD.coreMoveRange,
      moved: false,
      acted: false
    };
  }

  randomCoreStart(side) {
    const base = coreStart(side);
    const min = 3;
    const max = BOARD.width - 4;
    return { ...base, x: min + Math.floor(this.random() * (max - min + 1)) };
  }

  createFactionState(side) {
    const hangar = this.createHangar(side);
    return {
      hangar,
      hand: hangar,
      score: 0
    };
  }

  createHangar(side) {
    return Object.entries(HANGAR_LOADOUT).map(([type, count]) => ({
      id: `${side}-hangar-${type}`,
      type,
      count
    }));
  }

  generateStrategicPoints(cores) {
    const candidates = [];
    const rows = this.pointRows();
    for (const y of rows) {
      for (let x = 2; x < BOARD.width - 2; x += 1) {
        const cell = { x, y };
        if (!sameCell(cell, cores.player) && !sameCell(cell, cores.enemy)) candidates.push(cell);
      }
    }
    return this.pickCells(candidates, 3);
  }

  pointRows() {
    return POINT_ROWS
      .map((row) => Math.max(1, Math.min(BOARD.height - 2, row + this.difficulty.pointRowOffset)))
      .filter((row, index, rows) => rows.indexOf(row) === index);
  }

  generateEnergyZones(points) {
    return points.map((point, index) => {
      const width = ENERGY_ZONE_MIN + Math.floor(this.random() * (ENERGY_ZONE_MAX - ENERGY_ZONE_MIN + 1));
      const height = ENERGY_ZONE_MIN + Math.floor(this.random() * (ENERGY_ZONE_MAX - ENERGY_ZONE_MIN + 1));
      const minX = Math.max(0, point.x - width + 1);
      const maxX = Math.min(point.x, BOARD.width - width);
      const minY = Math.max(0, point.y - height + 1);
      const maxY = Math.min(point.y, BOARD.height - height);
      return {
        id: `zone-${index + 1}`,
        x: minX + Math.floor(this.random() * (maxX - minX + 1)),
        y: minY + Math.floor(this.random() * (maxY - minY + 1)),
        width,
        height,
        point: { ...point }
      };
    });
  }

  generateObstacles(cores, points) {
    const protectedCells = [
      cores.player,
      cores.enemy,
      ...deploymentCellsForCore(cores.player),
      ...deploymentCellsForCore(cores.enemy),
      ...points
    ];
    const picked = [];
    const canPlace = (cell) =>
      this.isInside(cell.x, cell.y) &&
      !protectedCells.some((item) => sameCell(item, cell)) &&
      !picked.some((item) => sameCell(item, cell));

    const seedCandidates = [];
    for (let y = 1; y < BOARD.height - 1; y += 1) {
      for (let x = 1; x < BOARD.width - 1; x += 1) {
        const cell = { x, y };
        if (canPlace(cell)) seedCandidates.push(cell);
      }
    }

    let guard = 0;
    while (picked.length < this.obstacleCount && guard < 300) {
      guard += 1;
      const seed = this.pickCentralObstacleSeed(seedCandidates, picked, protectedCells);
      if (!seed) break;
      const cluster = [seed];
      picked.push(seed);
      const clusterSize = 1 + Math.floor(this.random() * 3);
      while (cluster.length < clusterSize && picked.length < this.obstacleCount) {
        const base = cluster[Math.floor(this.random() * cluster.length)];
        const directions = Object.values(DIRECTIONS).slice().sort(() => this.random() - 0.5);
        const next = directions
          .map((direction) => ({ x: base.x + direction.dx, y: base.y + direction.dy }))
          .find(canPlace);
        if (!next) break;
        cluster.push(next);
        picked.push(next);
      }
    }
    return picked.slice(0, this.obstacleCount);
  }

  pickCentralObstacleSeed(candidates, picked, protectedCells) {
    const available = candidates.filter((cell) =>
      !picked.some((item) => sameCell(item, cell)) &&
      !protectedCells.some((item) => sameCell(item, cell))
    );
    if (available.length === 0) return null;
    const center = { x: (BOARD.width - 1) / 2, y: (BOARD.height - 1) / 2 };
    const ranked = available
      .map((cell) => ({ cell, distance: manhattan(cell, center) + this.random() * 5.5 }))
      .sort((a, b) => a.distance - b.distance);
    const slice = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.68)));
    return { ...slice[Math.floor(this.random() * slice.length)].cell };
  }

  pickCells(candidates, count) {
    const pool = candidates.slice();
    const picked = [];
    while (pool.length > 0 && picked.length < count) {
      picked.push(pool.splice(Math.floor(this.random() * pool.length), 1)[0]);
    }
    return picked;
  }

  isInEnergyZone(cell) {
    return this.state.energyZones.some((zone) =>
      zone.cells
        ? zone.cells.some((zoneCell) => sameCell(zoneCell, cell))
        : cell.x >= zone.x &&
      cell.x < zone.x + zone.width &&
      cell.y >= zone.y &&
      cell.y < zone.y + zone.height
    );
  }

  isStrategicPoint(cell) {
    return this.state.strategicPoints.some((point) => sameCell(point, cell));
  }

  addLog(message) {
    this.state.log.unshift(message);
    this.state.log = this.state.log.slice(0, 140);
  }

  beginTurn(side, { opening = false } = {}) {
    this.state.activeSide = side;
    this.state.phase = side;
    for (const actor of this.actorsFor(side)) {
      actor.waiting = false;
      actor.moved = false;
      actor.acted = false;
      if (!opening) this.restoreEnergy(actor);
    }
    if (!opening) this.addLog(`${SIDE_NAME[side]}回合开始。`);
    this.notify({ type: "turn-start", side });
  }

  endTurn(side) {
    if (this.state.winner || this.state.activeSide !== side) return false;
    this.resolveStrategicPoints(side);
    this.resolveVictory();
    if (this.state.winner) {
      this.state.phase = "gameover";
      this.notify({ type: "winner", winner: this.state.winner });
      return true;
    }
    if (side === "enemy") {
      this.state.round += 1;
      if (this.state.round > BOARD.maxRound) {
        this.resolveVictory(true);
        this.state.phase = "gameover";
        this.notify({ type: "winner", winner: this.state.winner });
        return true;
      }
    }
    this.beginTurn(otherSide(side));
    return true;
  }

  drawCards(side, count, { opening = false, reveal = false } = {}) {
    return [];
  }

  restoreEnergy(actor) {
    const max = this.effectiveMaxEnergy(actor);
    const regen = actor.type === "core" ? this.coreRegenAmount(actor) : (actor.regen ?? 1);
    const before = actor.energy ?? 0;
    actor.energy = Math.min(max, before + regen);
    const gained = actor.energy - before;
    if (gained > 0) {
      this.notify({ type: "energy", x: actor.x, y: actor.y, amount: gained, target: actor.id });
    }
  }

  coreRegenAmount(core) {
    if (this.isStrategicPoint(core)) return 3;
    if (this.isInEnergyZone(core)) return 2;
    return 1;
  }

  effectiveMaxEnergy(actor) {
    return actor.baseEnergy ?? getUnitType(actor.type)?.energy ?? 2;
  }

  trimEnergy(actor) {
    actor.energy = Math.min(actor.energy ?? 0, this.effectiveMaxEnergy(actor));
  }

  actorsFor(side) {
    return [this.state.cores[side], ...this.unitsFor(side)];
  }

  getActor(actorId) {
    if (actorId === "core-player") return this.state.cores.player;
    if (actorId === "core-enemy") return this.state.cores.enemy;
    return this.getUnit(actorId);
  }

  getUnit(id) {
    return this.state.units.find((unit) => unit.id === id) ?? null;
  }

  unitsFor(side) {
    return this.state.units.filter((unit) => unit.side === side);
  }

  unitAt(x, y) {
    return this.state.units.find((unit) => unit.x === x && unit.y === y) ?? null;
  }

  coreAt(x, y) {
    return Object.values(this.state.cores).find((core) => core.x === x && core.y === y) ?? null;
  }

  actorAt(x, y) {
    return this.unitAt(x, y) ?? this.coreAt(x, y) ?? null;
  }

  isInside(x, y) {
    return x >= 0 && x < BOARD.width && y >= 0 && y < BOARD.height;
  }

  isObstacle(x, y) {
    return this.state.obstacles.some((cell) => cell.x === x && cell.y === y);
  }

  isOccupied(x, y) {
    return Boolean(this.actorAt(x, y));
  }

  isDeployment(side, x, y) {
    return this.getDeploymentCells(side).some((cell) => cell.x === x && cell.y === y);
  }

  getDeploymentCells(side) {
    return deploymentCellsForCore(this.state.cores[side]);
  }

  canDeployAt(side, x, y) {
    return this.state.activeSide === side &&
      this.isInside(x, y) &&
      this.isDeployment(side, x, y) &&
      !this.isObstacle(x, y) &&
      !this.isOccupied(x, y);
  }

  canAffordDeployment(side, typeId) {
    const type = getUnitType(typeId);
    return Boolean(type && (this.state.cores[side].energy ?? 0) >= type.cost);
  }

  canDeployTypeAt(side, typeId, x, y) {
    return this.canAffordDeployment(side, typeId) && this.canDeployAt(side, x, y);
  }

  canDeployCard(side, handIndex, x, y) {
    const card = this.state.factions[side].hangar[handIndex];
    return Boolean(this.state.phase === side &&
      card &&
      card.count > 0 &&
      this.canDeployTypeAt(side, card.type, x, y));
  }

  deployCard(side, handIndex, x, y) {
    if (!this.canDeployCard(side, handIndex, x, y)) return false;
    const faction = this.state.factions[side];
    const card = faction.hangar[handIndex];
    const type = getUnitType(card.type);
    card.count -= 1;
    this.state.cores[side].energy -= type.cost;
    const unit = {
      id: `${side}-${type.id}-${this.unitCounter++}`,
      cardId: `${card.id}-${this.unitCounter}`,
      type: type.id,
      name: type.name,
      side,
      x,
      y,
      attack: type.attack,
      hp: type.hp,
      maxHp: type.hp,
      baseEnergy: type.energy,
      energy: type.energy,
      regen: type.regen,
      moveRange: type.moveRange ?? BOARD.moveRange,
      moved: true,
      acted: true,
      waiting: true
    };
    this.state.units.push(unit);
    this.addLog(`${SIDE_NAME[side]}部署${type.name}到 ${displayCoord(unit)}。`);
    this.notify({ type: "deploy", side, unitId: unit.id, x, y });
    return true;
  }

  isActorReady(actor) {
    return actor.type === "core" || !actor.waiting;
  }

  canControlActor(actor, side) {
    return Boolean(actor &&
      actor.side === side &&
      this.state.phase === side &&
      this.state.activeSide === side &&
      !this.state.winner &&
      this.isActorReady(actor));
  }

  hasActorActions(actor) {
    if (!this.canControlActor(actor, actor?.side)) return false;
    if (!actor.moved && this.getReachableCells(actor).length > 0) return true;
    if (!actor.acted && this.getBasicAttackTargets(actor).length > 0) return true;
    return !actor.acted && this.getUsableSkills(actor).some((skill) => {
      if (skill.targetless) return this.canUseSkill(actor, skill.id);
      return this.getSkillTargets(actor, skill.id).length > 0;
    });
  }

  getMoveRange(actor) {
    return actor.moveRange ?? (actor.type === "core" ? BOARD.coreMoveRange : BOARD.moveRange);
  }

  getReachableCells(actor, range = this.getMoveRange(actor)) {
    const visited = new Map([[cellKey(actor), { cell: { x: actor.x, y: actor.y }, distance: 0, prev: null }]]);
    const queue = [{ x: actor.x, y: actor.y, distance: 0 }];
    const result = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.distance >= range) continue;
      for (const dir of Object.values(DIRECTIONS)) {
        const next = { x: current.x + dir.dx, y: current.y + dir.dy };
        const key = cellKey(next);
        if (!this.isInside(next.x, next.y) || visited.has(key) || this.isObstacle(next.x, next.y) || this.isOccupied(next.x, next.y)) continue;
        visited.set(key, { cell: next, distance: current.distance + 1, prev: cellKey(current) });
        queue.push({ ...next, distance: current.distance + 1 });
        result.push(next);
      }
    }
    return result;
  }

  findPath(actor, target, range = this.getMoveRange(actor)) {
    if (!this.isInside(target.x, target.y) || this.isObstacle(target.x, target.y)) return null;
    if (this.isOccupied(target.x, target.y) && !sameCell(actor, target)) return null;
    const startKey = cellKey(actor);
    const targetKey = cellKey(target);
    const visited = new Map([[startKey, { cell: { x: actor.x, y: actor.y }, distance: 0, prev: null }]]);
    const queue = [{ x: actor.x, y: actor.y, distance: 0 }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (cellKey(current) === targetKey) break;
      if (current.distance >= range) continue;
      for (const dir of Object.values(DIRECTIONS)) {
        const next = { x: current.x + dir.dx, y: current.y + dir.dy };
        const key = cellKey(next);
        if (!this.isInside(next.x, next.y) || visited.has(key) || this.isObstacle(next.x, next.y)) continue;
        if (this.isOccupied(next.x, next.y) && key !== startKey) continue;
        visited.set(key, { cell: next, distance: current.distance + 1, prev: cellKey(current) });
        queue.push({ ...next, distance: current.distance + 1 });
      }
    }
    if (!visited.has(targetKey)) return null;
    const path = [];
    let cursor = targetKey;
    while (cursor !== startKey) {
      const item = visited.get(cursor);
      path.unshift(item.cell);
      cursor = item.prev;
    }
    return path.length > 0 ? path : null;
  }

  moveActor(actorId, x, y, side = "player") {
    const actor = this.getActor(actorId);
    if (!this.canControlActor(actor, side) || actor.moved) return false;
    const path = this.findPath(actor, { x, y }, this.getMoveRange(actor));
    if (!path) return false;
    const from = { x: actor.x, y: actor.y };
    const to = path.at(-1);
    actor.x = to.x;
    actor.y = to.y;
    actor.moved = true;
    this.addLog(`${SIDE_NAME[side]} ${actor.name} 移动到 ${displayCoord(to)}。`);
    this.notify({ type: "move", actorId: actor.id, from, to, path, side });
    return true;
  }

  waitActor(actorId, side = "player") {
    const actor = this.getActor(actorId);
    if (!this.canControlActor(actor, side)) return false;
    actor.moved = true;
    actor.acted = true;
    this.addLog(`${SIDE_NAME[side]} ${actor.name} 完成行动。`);
    this.notify({ type: "wait", actorId: actor.id, side });
    return true;
  }

  getBasicAttackTargets(actor) {
    return this.targetsInRange(actor, 1, { enemyOnly: true });
  }

  basicAttack(actorId, target, side = "player") {
    const actor = this.getActor(actorId);
    if (!this.canControlActor(actor, side) || actor.acted) return false;
    const actualTarget = this.resolveTarget(target);
    if (!actualTarget || actualTarget.side === side || manhattan(actor, actualTarget) > 1) return false;
    const willKillUnit = actualTarget.type !== "core" && actualTarget.hp <= actor.attack;
    actor.acted = true;
    this.addLog(`${SIDE_NAME[side]} ${actor.name} 普攻 ${actualTarget.name}。`);
    this.notifyAttack(actor, actualTarget, "hit");
    this.applyDamage(actualTarget, actor.attack, actor);
    this.afterAction();
    if (willKillUnit) this.tryGrantJusticeChain(actor);
    return true;
  }

  tryGrantJusticeChain(actor) {
    if (!actor || actor.type !== "justice" || !this.getUnit(actor.id) || (actor.energy ?? 0) < 1) return false;
    actor.energy -= 1;
    actor.moved = false;
    actor.acted = false;
    this.addLog(`${actor.name} 触发破阵追击：消耗1EN，获得额外移动和普攻机会。`);
    this.notify({ type: "extra-action", actorId: actor.id, side: actor.side });
    return true;
  }

  getSkill(actor) {
    return this.getSkills(actor).find((skill) => !skill.passive) ?? this.getSkills(actor)[0] ?? null;
  }

  getSkills(actor) {
    if (!actor) return [];
    if (actor.type === "core") {
      return [
        { id: "positron", name: "阳电子炮", cost: 4, range: 4, damage: 3, text: "选择8方向射线，命中的敌方目标承受3点伤害；溢出伤害继续传递给同方向下一个目标。" },
        { id: "overload", name: "超载模式", cost: 0, targetless: true, endsAction: false, text: "立即回复满全部能量。每回复1点能量，母舰消耗2点HP，不结束本回合行动。" }
      ];
    }
    const skill = getUnitType(actor.type)?.skill ?? null;
    return skill ? [skill] : [];
  }

  getUsableSkills(actor) {
    return this.getSkills(actor).filter((skill) => !skill.passive && this.canUseSkill(actor, skill.id));
  }

  canUseSkill(actor, skillId = null) {
    if (!actor) return false;
    const skill = skillId ? this.getSkills(actor).find((item) => item.id === skillId) : this.getSkill(actor);
    const consumesAction = skill?.endsAction !== false;
    if (!skill || skill.passive || (consumesAction && actor.acted) || (actor.energy ?? 0) < (skill.cost ?? 0)) return false;
    if (skill.id === "overload") {
      const missing = this.effectiveMaxEnergy(actor) - (actor.energy ?? 0);
      return missing > 0 && actor.hp > missing * 2;
    }
    return true;
  }

  getSkillTargets(actor, skillId = null) {
    const skill = skillId ? this.getSkills(actor).find((item) => item.id === skillId) : this.getSkill(actor);
    if (!skill || !this.canUseSkill(actor, skill?.id) || skill.targetless) return [];
    if (skill.id === "salvo") {
      return Object.values(DIRECTIONS)
        .flatMap((direction) => this.directionalArea(actor, direction))
        .filter((cell, index, cells) => cells.findIndex((item) => sameCell(item, cell)) === index);
    }
    if (skill.id === "positron") {
      return RAY_DIRECTIONS
        .flatMap((direction) => this.rayCells(actor, direction, skill.range))
        .filter((cell, index, cells) => cells.findIndex((item) => sameCell(item, cell)) === index);
    }
    return this.targetsInRange(actor, skill.range, { enemyOnly: true });
  }

  useSkill(actorId, target, side = "player", skillId = null) {
    const actor = this.getActor(actorId);
    const skill = skillId ? this.getSkills(actor).find((item) => item.id === skillId) : this.getSkill(actor);
    if (!this.canControlActor(actor, side) || !skill || !this.canUseSkill(actor, skill.id)) return false;
    if (skill.id === "overload") return this.useCoreOverload(actor, skill);
    if (skill.id === "positron") return this.useCorePositron(actor, target, skill);
    if (skill.id === "salvo") return this.useFreedomSalvo(actor, target, skill);

    const actualTarget = this.resolveTarget(target);
    if (!actualTarget || actualTarget.side === side || manhattan(actor, actualTarget) > skill.range) return false;
    actor.energy -= skill.cost;
    actor.acted = true;
    this.addLog(`${SIDE_NAME[side]} ${actor.name} 使用${skill.name}。`);
    this.notifyAttack(actor, actualTarget, skill.id);
    this.applyDamage(actualTarget, skill.damage, actor);
    this.afterAction();
    return true;
  }

  useCoreOverload(actor, skill) {
    const max = this.effectiveMaxEnergy(actor);
    const missing = max - (actor.energy ?? 0);
    const hpCost = missing * 2;
    if (missing <= 0 || actor.hp <= hpCost) return false;
    actor.energy = max;
    actor.hp -= hpCost;
    this.trimEnergy(actor);
    this.addLog(`${SIDE_NAME[actor.side]} ${actor.name} 使用${skill.name}：回复 ${missing} 能量，消耗 ${hpCost} HP。`);
    this.notify({ type: "skill", attackerId: actor.id, from: { x: actor.x, y: actor.y }, targets: [this.targetRef(actor)], effect: "overload", skillName: skill.name });
    this.notify({ type: "damage", x: actor.x, y: actor.y, amount: hpCost, target: actor.id });
    this.afterAction();
    return true;
  }

  useCorePositron(actor, target, skill) {
    const direction = this.directionTowardRay(actor, target, skill.range);
    if (!direction) return false;
    const cells = this.rayCells(actor, direction, skill.range);
    const enemies = [this.state.cores[otherSide(actor.side)], ...this.unitsFor(otherSide(actor.side))]
      .filter((item) => cells.some((cell) => sameCell(cell, item)))
      .map((item) => ({ item, step: Math.max(Math.abs(item.x - actor.x), Math.abs(item.y - actor.y)) }))
      .sort((a, b) => a.step - b.step);

    actor.energy -= skill.cost;
    actor.acted = true;
    let remaining = skill.damage;
    const damaged = [];
    for (const { item } of enemies) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, Math.max(0, item.hp));
      if (amount <= 0) continue;
      damaged.push({ target: item, amount });
      remaining -= amount;
    }

    const beamTarget = cells.at(-1) ?? target;
    this.addLog(`${SIDE_NAME[actor.side]} ${actor.name} 使用${skill.name}，向${direction.name}射击。`);
    this.notify({
      type: "skill",
      attackerId: actor.id,
      from: { x: actor.x, y: actor.y },
      target: damaged[0] ? this.targetRef(damaged[0].target) : { kind: "cell", x: beamTarget.x, y: beamTarget.y },
      targets: damaged.map(({ target: item }) => this.targetRef(item)),
      beamTarget,
      effect: "positron",
      skillName: skill.name
    });
    for (const { target: item, amount } of damaged) this.applyDamage(item, amount, actor);
    this.afterAction();
    return true;
  }

  useFreedomSalvo(actor, target, skill) {
    const direction = this.directionToward(actor, target);
    if (!direction) return false;
    const cells = this.directionalArea(actor, direction);
    const targets = this.state.units.filter((unit) => unit.id !== actor.id && cells.some((cell) => sameCell(cell, unit)));
    actor.energy -= skill.cost;
    actor.acted = true;
    this.addLog(`${SIDE_NAME[actor.side]} ${actor.name} 使用${skill.name}，覆盖${direction.name}侧3x3区域。`);
    this.notify({
      type: "skill",
      attackerId: actor.id,
      from: { x: actor.x, y: actor.y },
      targets: targets.map((unit) => ({ kind: "unit", id: unit.id, x: unit.x, y: unit.y })),
      areaCells: cells,
      effect: "salvo",
      skillName: skill.name
    });
    for (const unit of targets) this.applyDamage(unit, skill.damage, actor);
    this.afterAction();
    return true;
  }

  directionToward(actor, target) {
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? DIRECTIONS.right : dx < 0 ? DIRECTIONS.left : null;
    return dy > 0 ? DIRECTIONS.down : DIRECTIONS.up;
  }

  directionTowardRay(actor, target, range = 4) {
    if (!target) return null;
    const dx = target.x - actor.x;
    const dy = target.y - actor.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    if (distance < 1 || distance > range) return null;
    const aligned = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    if (!aligned) return null;
    const step = { dx: Math.sign(dx), dy: Math.sign(dy) };
    return RAY_DIRECTIONS.find((direction) => direction.dx === step.dx && direction.dy === step.dy) ?? null;
  }

  rayCells(origin, direction, range = 4) {
    const cells = [];
    for (let step = 1; step <= range; step += 1) {
      const cell = { x: origin.x + direction.dx * step, y: origin.y + direction.dy * step };
      if (!this.isInside(cell.x, cell.y)) break;
      cells.push(cell);
    }
    return cells;
  }

  directionalArea(origin, direction) {
    const cells = [];
    const seen = new Set();
    for (let step = 1; step <= 3; step += 1) {
      for (let offset = -1; offset <= 1; offset += 1) {
        const cell = direction.dx !== 0
          ? { x: origin.x + direction.dx * step, y: origin.y + offset }
          : { x: origin.x + offset, y: origin.y + direction.dy * step };
        const key = cellKey(cell);
        if (!this.isInside(cell.x, cell.y) || seen.has(key)) continue;
        seen.add(key);
        cells.push(cell);
      }
    }
    return cells;
  }

  targetsInRange(actor, range, { enemyOnly = false } = {}) {
    return [...this.state.units, this.state.cores.player, this.state.cores.enemy]
      .filter((target) => target.id !== actor.id)
      .filter((target) => !enemyOnly || target.side !== actor.side)
      .filter((target) => manhattan(actor, target) <= range)
      .map((target) => this.targetRef(target));
  }

  targetRef(target) {
    return target.type === "core"
      ? { kind: "core", side: target.side, x: target.x, y: target.y }
      : { kind: "unit", id: target.id, x: target.x, y: target.y };
  }

  resolveTarget(target) {
    if (!target) return null;
    if (target.kind === "core") return this.state.cores[target.side];
    if (target.kind === "unit") return this.getUnit(target.id);
    return this.actorAt(target.x, target.y);
  }

  notifyAttack(actor, target, effect = "hit") {
    this.notify({
      type: effect === "hit" ? "attack" : "skill",
      attackerId: actor.id,
      from: { x: actor.x, y: actor.y },
      target: this.targetRef(target),
      targets: [this.targetRef(target)],
      effect
    });
  }

  applyDamage(target, amount, source) {
    const sourceName = typeof source === "string" ? source : source?.name ?? "攻击";
    const sourceSide = typeof source === "string" ? null : source?.side ?? null;
    target.hp -= amount;
    if (target.type !== "core" && amount > 0) {
      target.lastDamagedBy = sourceSide;
      target.lastDamagedByName = sourceName;
    }
    this.trimEnergy(target);
    this.addLog(`${sourceName} 对 ${target.name} 造成 ${amount} 伤害。`);
    this.notify({ type: "damage", x: target.x, y: target.y, amount, target: target.id });
  }

  afterAction() {
    this.removeDestroyedUnits();
    this.resolveVictory();
    this.notify();
  }

  removeDestroyedUnits() {
    const defeated = this.state.units.filter((unit) => unit.hp <= 0);
    if (defeated.length === 0) return;
    for (const unit of defeated) {
      this.awardKillScore(unit);
      this.addLog(`${SIDE_NAME[unit.side]} ${unit.name} 被击破。`);
      this.notify({ type: "death", unitId: unit.id, side: unit.side, name: unit.name, x: unit.x, y: unit.y });
    }
    this.state.units = this.state.units.filter((unit) => unit.hp > 0);
  }

  awardKillScore(unit) {
    const scorer = unit.lastDamagedBy;
    if (!scorer || scorer === unit.side || !this.state.factions[scorer]) return;
    const value = unit.baseEnergy ?? getUnitType(unit.type)?.energy ?? 0;
    if (value <= 0) return;
    this.state.factions[scorer].score += value;
    this.addLog(`${SIDE_NAME[scorer]}击破 ${unit.name}：+${value} 战略分。`);
  }

  resolveStrategicPoints(side) {
    let controlled = 0;
    for (const point of this.state.strategicPoints) {
      const unit = this.unitAt(point.x, point.y);
      if (unit?.side === side) controlled += 1;
    }
    if (controlled > 0) {
      this.state.factions[side].score += controlled;
      this.addLog(`${SIDE_NAME[side]}控制 ${controlled} 个战略点：+${controlled} 战略分。`);
    }
  }

  getPointController(point) {
    return this.unitAt(point.x, point.y)?.side ?? null;
  }

  resolveVictory(forceRoundLimit = false) {
    const playerCore = this.state.cores.player;
    const enemyCore = this.state.cores.enemy;
    if (playerCore.hp <= 0 && enemyCore.hp <= 0) {
      const scoreDelta = this.state.factions.player.score - this.state.factions.enemy.score;
      this.state.winner = scoreDelta > 0
        ? { side: "player", reason: "双方母舰同时被摧毁，玩家战略分更高。" }
        : scoreDelta < 0
          ? { side: "enemy", reason: "双方母舰同时被摧毁，AI战略分更高。" }
          : { side: "draw", reason: "双方母舰同时被摧毁，战略分相同。" };
      return;
    }
    if (enemyCore.hp <= 0) {
      this.state.winner = { side: "player", reason: "敌方母舰被摧毁。" };
      return;
    }
    if (playerCore.hp <= 0) {
      this.state.winner = { side: "enemy", reason: "玩家母舰被摧毁。" };
      return;
    }
    if (!forceRoundLimit) return;
    const player = this.state.factions.player;
    const enemy = this.state.factions.enemy;
    if (player.score !== enemy.score) {
      this.state.winner = player.score > enemy.score
        ? { side: "player", reason: "第10回合结束，玩家战略分更高。" }
        : { side: "enemy", reason: "第10回合结束，AI战略分更高。" };
    } else if (playerCore.hp !== enemyCore.hp) {
      this.state.winner = playerCore.hp > enemyCore.hp
        ? { side: "player", reason: "战略分相同，玩家母舰HP更高。" }
        : { side: "enemy", reason: "战略分相同，AI母舰HP更高。" };
    } else {
      this.state.winner = { side: "draw", reason: "战略分与母舰HP均相同。" };
    }
  }
}
