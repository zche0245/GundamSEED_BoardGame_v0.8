import { CENTER_COLUMN, manhattan } from "./battle.js";
import { getUnitType } from "../data/units.js";

const wait = (delay) => {
  if (!delay || !globalThis.window) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, delay));
};

export async function planAI(game, { delay = 420, onFocus = null } = {}) {
  if (game.state.winner || game.state.activeSide !== "enemy") return false;

  while (deployAIUnit(game)) await wait(Math.max(160, delay * 0.5));

  const actors = [game.state.cores.enemy, ...game.unitsFor("enemy")]
    .filter((actor) => game.canControlActor(actor, "enemy"));

  for (const actor of actors) {
    let guard = 0;
    while (!game.state.winner && game.getActor(actor.id) && game.hasActorActions(actor) && guard < 3) {
      guard += 1;
      onFocus?.(actor.id);
      await wait(Math.max(260, delay * 0.75));
      await actWithActor(game, actor, { delay, onFocus });
      await wait(delay);
    }
  }

  if (!game.state.winner) game.endTurn("enemy");
  return true;
}

function deployAIUnit(game) {
  const faction = game.state.factions.enemy;
  const cells = game.getDeploymentCells("enemy").filter((cell) => game.canDeployAt("enemy", cell.x, cell.y));
  if (cells.length === 0) return false;

  const card = faction.hangar
    .map((item, index) => ({ item, index, type: getUnitType(item.type) }))
    .filter((item) => item.item.count > 0)
    .filter((item) => game.canAffordDeployment("enemy", item.type.id))
    .sort((a, b) => unitDeployScore(game, b.type) - unitDeployScore(game, a.type))[0];
  if (!card) return false;

  const target = chooseStrategicTarget(game, game.state.cores.enemy);
  const cell = cells
    .map((item) => ({
      cell: item,
      distance: manhattan(item, target),
      center: Math.abs(item.x - CENTER_COLUMN)
    }))
    .sort((a, b) => a.distance - b.distance || a.center - b.center)[0].cell;

  return game.deployCard("enemy", card.index, cell.x, cell.y);
}

function unitDeployScore(game, type) {
  const pressure = nearestEnemyNearCore(game, "enemy") ? 8 : 0;
  const premium = type.id === "freedom" || type.id === "justice" ? 12 : 0;
  const blocker = type.id === "ginn" && pressure ? 8 : 0;
  return type.cost * 5 + type.attack * 4 + type.hp + premium + blocker;
}

async function actWithActor(game, actor, { delay, onFocus }) {
  if (!actor || !game.canControlActor(actor, "enemy")) return false;

  if (tryBestSkill(game, actor) || tryBasicAttack(game, actor)) return true;

  const target = chooseStrategicTarget(game, actor);
  const move = chooseMoveToward(game, actor, target);
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

function chooseStrategicTarget(game, actor) {
  const threat = nearestEnemyNearCore(game, "enemy");
  if (threat && actor.type === "core") return safestRearCell(game);
  if (threat && manhattan(actor, threat) <= 3) return threat;
  if (actor.type === "justice" || actor.type === "strike") return game.state.cores.player;
  const openPoint = game.state.strategicPoints
    .filter((point) => game.getPointController(point) !== "enemy")
    .map((point) => ({ point, distance: manhattan(actor, point) }))
    .sort((a, b) => a.distance - b.distance)[0]?.point;
  return openPoint ?? game.state.cores.player;
}

function chooseMoveToward(game, actor, target) {
  if (actor.moved) return null;
  const options = game.getReachableCells(actor);
  if (options.length === 0) return null;
  const danger = nearestEnemyNearCore(game, "enemy");
  return options
    .map((cell) => ({
      cell,
      score: moveScore(game, actor, cell, target),
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
      if (actor.type === "justice") {
        return b.score - a.score || a.nearPlayerCore - b.nearPlayerCore || a.distance - b.distance;
      }
      return b.score - a.score || a.distance - b.distance || b.forward - a.forward || a.center - b.center;
    })[0].cell;
}

function moveScore(game, actor, cell, target) {
  const pointScore = game.state.strategicPoints.reduce((best, point) => {
    const distance = manhattan(cell, point);
    const controller = game.getPointController(point);
    const value = controller === "enemy" ? 2 : controller === "player" ? 13 : 10;
    return Math.max(best, Math.max(0, value - distance * 2.2));
  }, 0);
  const coreDistance = manhattan(cell, game.state.cores.player);
  const corePressure = Math.max(0, 10 - coreDistance * 1.7) + (actor.type === "justice" || actor.type === "strike" ? 3 : 0);
  const targetPull = Math.max(0, 8 - manhattan(cell, target));
  const forward = cell.y * 0.18;
  return pointScore + corePressure + targetPull + forward;
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
