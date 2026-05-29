import { CENTER_COLUMN, deploymentCellsForCore, manhattan } from "./battle.js";
import { getUnitType } from "../data/units.js";

const wait = (delay) => {
  if (!delay || !globalThis.window) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, delay));
};

export async function planAI(game, { delay = 420, onFocus = null } = {}) {
  if (game.state.winner || game.state.activeSide !== "enemy") return false;

  const context = aiContext(game);

  if (shouldMoveCoreBeforeDeploy(game, context)) {
    await moveCoreBeforeDeploy(game, context, { delay, onFocus });
  }

  while (deployAIUnit(game, context)) await wait(Math.max(160, delay * 0.5));

  const actors = [game.state.cores.enemy, ...game.unitsFor("enemy")]
    .filter((actor) => game.canControlActor(actor, "enemy"));

  for (const actor of actors) {
    let guard = 0;
    while (!game.state.winner && game.getActor(actor.id) && game.hasActorActions(actor) && guard < 6) {
      guard += 1;
      onFocus?.(actor.id);
      await wait(Math.max(260, delay * 0.75));
      const acted = await actWithActor(game, actor, { delay, onFocus, context });
      if (!acted && game.getActor(actor.id) && game.hasActorActions(actor)) {
        game.waitActor(actor.id, "enemy");
        break;
      }
      await wait(delay);
    }
  }

  if (!game.state.winner) game.endTurn("enemy");
  return true;
}

function aiContext(game) {
  const player = game.state.factions.player;
  const enemy = game.state.factions.enemy;
  const scoreDelta = player.score - enemy.score;
  const behind = scoreDelta > 0;
  const difficultyBoost = game.difficulty?.id === "hard" ? 0.38 : game.difficulty?.id === "normal" ? 0.18 : 0;
  return {
    behind,
    scoreDelta,
    aggression: (behind ? Math.min(2.4, 1 + scoreDelta * 0.42) : 0.72) + difficultyBoost,
    coreDanger: coreDangerAt(game, game.state.cores.enemy)
  };
}

async function moveCoreBeforeDeploy(game, context, { delay, onFocus }) {
  const core = game.state.cores.enemy;
  const move = chooseCorePreDeployMove(game, context);
  if (!move) return false;
  onFocus?.(core.id);
  await wait(Math.max(240, delay * 0.65));
  return game.moveActor(core.id, move.x, move.y, "enemy");
}

function shouldMoveCoreBeforeDeploy(game, context) {
  const core = game.state.cores.enemy;
  if (!game.canControlActor(core, "enemy") || core.moved) return false;
  const move = chooseCorePreDeployMove(game, context);
  if (!move) return false;
  const canDeployNow = hasDeployOption(game);
  const currentValue = deploymentValue(game, core, context);
  const movedValue = deploymentValue(game, { ...core, x: move.x, y: move.y }, context);
  const gain = movedValue - currentValue;
  if (!canDeployNow) return true;
  if (context.behind && gain >= -1.5) return true;
  if (gain >= 2.5) return true;
  return game.random() < 0.22 && coreDangerAt(game, move) <= context.coreDanger + 2;
}

function hasDeployOption(game) {
  const faction = game.state.factions.enemy;
  return faction.hangar.some((item) => item.count > 0 && game.canAffordDeployment("enemy", item.type)) &&
    game.getDeploymentCells("enemy").some((cell) => game.canDeployAt("enemy", cell.x, cell.y));
}

function deployAIUnit(game, context = aiContext(game)) {
  const faction = game.state.factions.enemy;
  const cells = game.getDeploymentCells("enemy").filter((cell) => game.canDeployAt("enemy", cell.x, cell.y));
  if (cells.length === 0) return false;

  const card = faction.hangar
    .map((item, index) => ({ item, index, type: getUnitType(item.type) }))
    .filter((item) => item.item.count > 0)
    .filter((item) => game.canAffordDeployment("enemy", item.type.id))
    .sort((a, b) => unitDeployScore(game, b.type, context) - unitDeployScore(game, a.type, context))[0];
  if (!card) return false;

  const target = chooseDeploymentTarget(game, context);
  const cell = cells
    .map((item) => ({
      cell: item,
      score: deploymentCellScore(game, item, card.type, target, context),
      distance: manhattan(item, target),
      center: Math.abs(item.x - CENTER_COLUMN),
      forward: item.y
    }))
    .sort((a, b) => b.score - a.score || a.distance - b.distance || b.forward - a.forward || a.center - b.center)[0].cell;

  return game.deployCard("enemy", card.index, cell.x, cell.y);
}

function unitDeployScore(game, type, context = aiContext(game)) {
  const pressure = nearestEnemyNearCore(game, "enemy") ? 8 : 0;
  const premium = type.id === "freedom" || type.id === "justice" ? 12 + context.aggression * 2 : 0;
  const blocker = type.id === "ginn" && pressure ? 8 : 0;
  const cheapLine = (type.id === "ginn" || type.id === "dagger") && context.behind ? 2 : 0;
  return type.cost * (context.behind ? 5.8 : 5) + type.attack * 4 + type.hp + premium + blocker + cheapLine;
}

async function actWithActor(game, actor, { delay, onFocus, context = aiContext(game) }) {
  if (!actor || !game.canControlActor(actor, "enemy")) return false;

  if (tryBestSkill(game, actor) || tryBasicAttack(game, actor)) return true;

  const target = chooseStrategicTarget(game, actor, context);
  const move = chooseMoveToward(game, actor, target, context);
  if (move) {
    game.moveActor(actor.id, move.x, move.y, "enemy");
    onFocus?.(actor.id);
    await wait(Math.max(260, delay * 0.9));
  }

  if (tryBestSkill(game, actor) || tryBasicAttack(game, actor)) return true;
  return Boolean(move);
}

function tryBasicAttack(game, actor) {
  const target = bestTarget(game, actor, game.getBasicAttackTargets(actor));
  if (!target) return false;
  return game.basicAttack(actor.id, target, "enemy");
}

function tryBestSkill(game, actor) {
  const skills = game.getUsableSkills(actor);
  if (actor.type === "core") {
    const positron = skills.find((skill) => skill.id === "positron");
    const target = positron ? bestPositronCell(game, actor) : null;
    if (target && game.useSkill(actor.id, target, "enemy", "positron")) return true;
    const overload = skills.find((skill) => skill.id === "overload");
    if (overload && actor.energy < 4 && actor.hp >= 7 && game.useSkill(actor.id, null, "enemy", "overload")) {
      const chargedTarget = bestPositronCell(game, actor);
      if (chargedTarget && game.useSkill(actor.id, chargedTarget, "enemy", "positron")) return true;
      return true;
    }
    return false;
  }

  const salvo = skills.find((skill) => skill.id === "salvo");
  if (salvo) {
    const bestCell = game.getSkillTargets(actor, "salvo")
      .map((cell) => ({ cell, score: scoreFreedomArea(game, actor, cell) }))
      .filter((item) => item.score >= 6)
      .sort((a, b) => b.score - a.score)[0]?.cell;
    if (bestCell) return game.useSkill(actor.id, bestCell, "enemy", "salvo");
  }

  const skill = skills.find((item) => item.id !== "salvo");
  if (!skill) return false;
  const target = bestTarget(game, actor, game.getSkillTargets(actor, skill.id));
  return target ? game.useSkill(actor.id, target, "enemy", skill.id) : false;
}

function chooseCorePreDeployMove(game, context) {
  const core = game.state.cores.enemy;
  if (core.moved) return null;
  const options = game.getReachableCells(core);
  if (options.length === 0) return null;
  const currentDanger = coreDangerAt(game, core);
  const currentValue = deploymentValue(game, core, context);
  return options
    .map((cell) => {
      const danger = coreDangerAt(game, cell);
      const value = deploymentValue(game, { ...core, x: cell.x, y: cell.y }, context);
      const energy = game.isInEnergyZone(cell) ? 1.5 : 0;
      const point = game.isStrategicPoint(cell) ? 2 : 0;
      const forward = cell.y * (context.behind ? 0.55 : 0.22);
      const unsafe = danger > Math.max(currentDanger + 5, core.hp + 2);
      return {
        cell,
        score: unsafe ? -999 : value - currentValue + energy + point + forward - Math.max(0, danger - currentDanger) * 1.8,
        danger
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.danger - b.danger)[0]?.cell ?? null;
}

function chooseDeploymentTarget(game, context) {
  if (context.behind) {
    const playerPoint = game.state.strategicPoints
      .filter((point) => game.getPointController(point) === "player")
      .sort((a, b) => manhattan(a, game.state.cores.enemy) - manhattan(b, game.state.cores.enemy))[0];
    if (playerPoint) return playerPoint;
  }
  const openPoint = game.state.strategicPoints
    .filter((point) => game.getPointController(point) !== "enemy")
    .sort((a, b) => manhattan(a, game.state.cores.enemy) - manhattan(b, game.state.cores.enemy))[0];
  return openPoint ?? game.state.cores.player;
}

function deploymentValue(game, coreLike, context) {
  const target = chooseDeploymentTarget(game, context);
  const cells = deploymentCellsForCore(coreLike)
    .filter((cell) => game.isInside(cell.x, cell.y) && !game.isObstacle(cell.x, cell.y))
    .filter((cell) => {
      const occupant = game.actorAt(cell.x, cell.y);
      return !occupant || occupant.id === coreLike.id;
    });
  if (cells.length === 0) return -20;
  return cells.reduce((sum, cell) => sum + Math.max(0, 12 - manhattan(cell, target) * 1.8) + cell.y * 0.12, cells.length * 1.5);
}

function deploymentCellScore(game, cell, type, target, context) {
  const pointScore = game.state.strategicPoints.reduce((best, point) => {
    const controller = game.getPointController(point);
    const value = controller === "player" ? 13 : controller === "enemy" ? 3 : 9;
    return Math.max(best, Math.max(0, value - manhattan(cell, point) * 2));
  }, 0);
  const pressure = Math.max(0, 9 - manhattan(cell, game.state.cores.player) * 1.4) * context.aggression;
  const typeBias = type.id === "justice" || type.id === "strike" ? pressure * 0.5 : 0;
  const defense = nearestEnemyNearCore(game, "enemy") ? Math.max(0, 8 - manhattan(cell, game.state.cores.enemy) * 2) : 0;
  return pointScore + pressure + typeBias + defense - manhattan(cell, target) * 1.1 + cell.y * 0.18;
}

function bestPositronCell(game, actor) {
  return game.getSkillTargets(actor, "positron")
    .map((cell) => ({ cell, score: scorePositronRay(game, actor, cell) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.cell ?? null;
}

function scorePositronRay(game, actor, cell) {
  const direction = game.directionTowardRay(actor, cell, 4);
  if (!direction) return 0;
  const cells = game.rayCells(actor, direction, 4);
  let damage = 3;
  let score = 0;
  const targets = [game.state.cores.player, ...game.unitsFor("player")]
    .filter((target) => cells.some((item) => item.x === target.x && item.y === target.y))
    .map((target) => ({ target, step: Math.max(Math.abs(target.x - actor.x), Math.abs(target.y - actor.y)) }))
    .sort((a, b) => a.step - b.step);
  for (const { target } of targets) {
    if (damage <= 0) break;
    const amount = Math.min(damage, target.hp);
    const cost = getUnitType(target.type)?.cost ?? 8;
    score += target.type === "core" ? amount * 7 : amount * 3 + (target.hp <= amount ? cost + 3 : 0);
    damage -= amount;
  }
  return score;
}

function bestTarget(game, actor, targets) {
  return targets
    .map((ref) => {
      const target = game.resolveTarget(ref);
      return target ? { ref, target } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aKill = a.target.hp <= actor.attack ? 1 : 0;
      const bKill = b.target.hp <= actor.attack ? 1 : 0;
      const aCore = a.target.type === "core" ? 1 : 0;
      const bCore = b.target.type === "core" ? 1 : 0;
      const aCost = getUnitType(a.target.type)?.cost ?? 9;
      const bCost = getUnitType(b.target.type)?.cost ?? 9;
      return bCore - aCore || bKill - aKill || a.target.hp - b.target.hp || bCost - aCost;
    })[0]?.ref ?? null;
}

function scoreFreedomArea(game, actor, cell) {
  const direction = game.directionToward(actor, cell);
  if (!direction) return 0;
  const cells = game.directionalArea(actor, direction);
  return game.state.units
    .filter((unit) => cells.some((item) => item.x === unit.x && item.y === unit.y))
    .reduce((score, unit) => score + (unit.side === "player" ? 5 : -5) + (unit.hp <= 2 ? 2 : 0), 0);
}

function chooseStrategicTarget(game, actor, context = aiContext(game)) {
  const threat = nearestEnemyNearCore(game, "enemy");
  if (threat && actor.type === "core" && context.coreDanger >= 5) return safestRearCell(game);
  if (threat && manhattan(actor, threat) <= 3) return threat;
  if (actor.type === "justice" || actor.type === "strike") return game.state.cores.player;
  if (context.behind && actor.type !== "core") {
    const playerPoint = game.state.strategicPoints
      .filter((point) => game.getPointController(point) === "player")
      .sort((a, b) => manhattan(actor, a) - manhattan(actor, b))[0];
    if (playerPoint) return playerPoint;
    if (actor.type === "freedom") return game.state.cores.player;
  }
  const openPoint = game.state.strategicPoints
    .filter((point) => game.getPointController(point) !== "enemy")
    .map((point) => ({ point, distance: manhattan(actor, point) }))
    .sort((a, b) => a.distance - b.distance)[0]?.point;
  if (openPoint) return openPoint;
  return actor.type === "core" && !context.behind ? safestRearCell(game) : game.state.cores.player;
}

function chooseMoveToward(game, actor, target, context = aiContext(game)) {
  if (actor.moved) return null;
  const options = game.getReachableCells(actor);
  if (options.length === 0) return null;
  const danger = nearestEnemyNearCore(game, "enemy");
  return options
    .map((cell) => ({
      cell,
      score: moveScore(game, actor, cell, target, context),
      distance: manhattan(cell, target),
      forward: cell.y,
      center: Math.abs(cell.x - CENTER_COLUMN),
      awayFromDanger: nearestPlayerThreatDistance(game, cell),
      nearPlayerCore: manhattan(cell, game.state.cores.player)
    }))
    .sort((a, b) => {
      if (actor.type === "core" && danger) {
        return b.awayFromDanger - a.awayFromDanger || a.distance - b.distance;
      }
      if (actor.type === "core") {
        return b.score - a.score || a.distance - b.distance || a.awayFromDanger - b.awayFromDanger;
      }
      if (actor.type === "justice") {
        return b.score - a.score || a.nearPlayerCore - b.nearPlayerCore || a.distance - b.distance;
      }
      return b.score - a.score || a.distance - b.distance || b.forward - a.forward || a.center - b.center;
    })[0].cell;
}

function moveScore(game, actor, cell, target, context = aiContext(game)) {
  const pointScore = game.state.strategicPoints.reduce((best, point) => {
    const distance = manhattan(cell, point);
    const controller = game.getPointController(point);
    const value = controller === "enemy" ? 2 : controller === "player" ? 13 + context.aggression * 2 : 10;
    return Math.max(best, Math.max(0, value - distance * 2.2));
  }, 0);
  const coreDistance = manhattan(cell, game.state.cores.player);
  const corePressure = Math.max(0, 10 - coreDistance * 1.7) * context.aggression + (actor.type === "justice" || actor.type === "strike" ? 3 : 0);
  const targetPull = Math.max(0, 8 - manhattan(cell, target));
  const forward = cell.y * (context.behind ? 0.34 : 0.18);
  const dangerPenalty = actor.type === "core" ? coreDangerAt(game, cell) * 2.8 : 0;
  return pointScore + corePressure + targetPull + forward - dangerPenalty;
}

function nearestEnemyNearCore(game, side) {
  const core = game.state.cores[side];
  return game.unitsFor("player")
    .map((unit) => ({ unit, distance: manhattan(unit, core) }))
    .filter((item) => item.distance <= 4)
    .sort((a, b) => a.distance - b.distance)[0]?.unit ?? null;
}

function nearestPlayerThreatDistance(game, cell) {
  const distances = game.unitsFor("player").map((unit) => manhattan(cell, unit));
  return distances.length ? Math.min(...distances) : 9;
}

function safestRearCell(game) {
  return { x: game.state.cores.enemy.x, y: 0 };
}

function coreDangerAt(game, cell) {
  const playerCore = game.state.cores.player;
  const unitDanger = game.unitsFor("player").reduce((sum, unit) => {
    const distance = manhattan(cell, unit);
    const type = getUnitType(unit.type);
    const attackThreat = distance <= 1 ? unit.attack + 2 : 0;
    const approachThreat = distance <= (type?.moveRange ?? 2) + 1 ? Math.max(0, 4 - distance) : 0;
    const skillThreat = type?.skill && !type.skill.passive && unit.energy >= type.skill.cost && distance <= type.skill.range
      ? Math.min(type.skill.damage ?? 1, 3)
      : 0;
    return sum + attackThreat + approachThreat + skillThreat;
  }, 0);
  const dx = cell.x - playerCore.x;
  const dy = cell.y - playerCore.y;
  const rayDistance = Math.max(Math.abs(dx), Math.abs(dy));
  const rayAligned = rayDistance > 0 && rayDistance <= 4 && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy));
  const coreRayDanger = playerCore.energy >= 4 && rayAligned ? 3 : 0;
  return unitDanger + coreRayDanger;
}
