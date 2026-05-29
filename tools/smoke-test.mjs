import { BattleGame, BOARD, OBSTACLE_PRESETS, POINT_ROWS } from "../src/core/battle.js";
import { planAI } from "../src/core/ai.js";
import { HANGAR_LOADOUT, getUnitType } from "../src/data/units.js";

const randomValues = [
  0.1, 0.7, 0.3, 0.9, 0.2, 0.5, 0.8, 0.04, 0.6, 0.12,
  0.95, 0.33, 0.73, 0.18, 0.42, 0.66, 0.22, 0.88
];
let index = 0;
const random = () => randomValues[index++ % randomValues.length];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const game = new BattleGame({ random });
assert(BOARD.width === 13 && BOARD.height === 13, "board should be 13x13");
assert(HANGAR_LOADOUT.ginn === 4 && HANGAR_LOADOUT.dagger === 4, "hangar should contain 8 grunt units total");
assert(HANGAR_LOADOUT.strike === 2 && HANGAR_LOADOUT.freedom === 1 && HANGAR_LOADOUT.justice === 1, "hangar should contain premium unit counts");
assert(getUnitType("dagger").name === "短剑L", "Dagger L should be renamed to 短剑L");
assert(getUnitType("strike").cost === 4, "Strike should cost 4");
assert(getUnitType("strike").attack === 1, "Strike should have 1 attack");
assert(getUnitType("strike").hp === 3, "Strike should have 3 HP");
assert(getUnitType("strike").energy === 3, "Strike should have 3 max energy");
assert(getUnitType("strike").skill.name === "光束军刀", "Strike skill should be renamed to 光束军刀");
assert(getUnitType("justice").hp === 4, "Justice should have 4 HP");
assert(getUnitType("freedom").regen === 1, "Freedom should regenerate 1 energy per turn");
assert(getUnitType("freedom").skill.cost === 3, "Freedom salvo should cost 3 energy");
assert(getUnitType("justice").energy === 4, "Justice should have 4 max energy");
assert(getUnitType("justice").regen === 1, "Justice should regenerate 1 energy per turn");
assert(getUnitType("justice").skill.passive, "Justice skill should be passive");
assert(game.state.phase === "player", "initial phase should be player turn");
assert(game.state.factions.player.hangar.length === 5, "player hangar should stack by unit type");
assert(game.state.factions.player.hand === game.state.factions.player.hangar, "legacy hand alias should point to hangar");
assert(!("deck" in game.state.factions.player), "deck should be removed");
assert(!("graveyard" in game.state.factions.player), "graveyard should be removed");
assert(game.state.strategicPoints.length === 3, "should generate 3 strategic points");
assert(game.state.energyZones.length === 3, "should generate 3 energy zones");
assert(game.state.strategicPoints.every((point) => POINT_ROWS.includes(point.y)), "strategic points should be in the middle three rows");
assert(game.state.energyZones.every((zone) => zone.width >= 3 && zone.width <= 4 && zone.height >= 3 && zone.height <= 4), "energy zones should be 3-4 cells wide and high");
assert(game.state.energyZones.every((zone) =>
  zone.point.x >= zone.x &&
  zone.point.x < zone.x + zone.width &&
  zone.point.y >= zone.y &&
  zone.point.y < zone.y + zone.height
), "energy zones should include their strategic point");
assert(game.state.obstacles.length === BOARD.obstacleCount, "should generate configured obstacles");
assert(hasAdjacentObstacle(game.state.obstacles), "obstacles should usually form clustered pairs");
assert(game.state.cores.player.attack === 1, "player core should have basic attack");
assert(game.state.cores.player.energy === 2, "core should start with 2 energy");

const normalGame = new BattleGame({ random: () => 0.25, difficulty: "normal", obstacleCount: OBSTACLE_PRESETS.light.count });
assert(normalGame.state.cores.enemy.energy === 4, "normal difficulty should start enemy core at 4 energy");
assert(normalGame.state.factions.enemy.score === 3, "normal difficulty should grant enemy 3 starting score");
assert(normalGame.state.strategicPoints.every((point) => [4, 5, 6].includes(point.y)), "normal difficulty should move points one row toward the enemy");
assert(normalGame.state.obstacles.length === OBSTACLE_PRESETS.light.count, "custom light obstacle preset should control obstacle count");

const hardGame = new BattleGame({ random: () => 0.25, difficulty: "hard", obstacleCount: OBSTACLE_PRESETS.heavy.count });
assert(hardGame.state.cores.enemy.energy === 5, "hard difficulty should start enemy core at 5 energy");
assert(hardGame.state.factions.enemy.score === 6, "hard difficulty should grant enemy 6 starting score");
assert(hardGame.state.strategicPoints.every((point) => [3, 4, 5].includes(point.y)), "hard difficulty should move points two rows toward the enemy");
assert(hardGame.state.obstacles.length === OBSTACLE_PRESETS.heavy.count, "custom heavy obstacle preset should control obstacle count");
assert(game.getSkills(game.state.cores.player).find((skill) => skill.id === "positron").range === 4, "core positron cannon should have range 4");
assert(game.getSkills(game.state.cores.player).some((skill) => skill.id === "overload"), "core should expose overload");

const firstDeploy = game.getDeploymentCells("player").find((cell) => game.canDeployAt("player", cell.x, cell.y));
assert(firstDeploy, "player should have a deployment cell");
const coreEnergyBeforeDeploy = game.state.cores.player.energy;
const firstSlot = game.state.factions.player.hangar[0];
const firstDeployType = getUnitType(firstSlot.type);
const beforeCount = firstSlot.count;
assert(game.deployCard("player", 0, firstDeploy.x, firstDeploy.y), "player should deploy by spending core energy");
const deployed = game.unitsFor("player")[0];
assert(firstSlot.count === beforeCount - 1, "deployment should decrement stacked hangar count");
assert(!game.isActorReady(deployed), "newly deployed units should wait until their side starts a later turn");
assert(!game.hasActorActions(deployed), "newly deployed units should have no actions this turn");
game.beginTurn("player");
assert(game.isActorReady(deployed), "wait units should become ready at owner turn start");
assert(deployed.energy === game.effectiveMaxEnergy(deployed), "newly deployed units should start with full energy");
assert(game.state.cores.player.energy === Math.min(game.effectiveMaxEnergy(game.state.cores.player), coreEnergyBeforeDeploy - firstDeployType.cost + game.coreRegenAmount(game.state.cores.player)), "deployment should spend core energy before turn regen");

const energyGateGame = new BattleGame({ random: () => 0.2 });
energyGateGame.state.cores.player.energy = 0;
const blockedCell = energyGateGame.getDeploymentCells("player").find((cell) => energyGateGame.canDeployAt("player", cell.x, cell.y));
assert(blockedCell, "energy gate test should have a deployment cell");
assert(!energyGateGame.deployCard("player", 0, blockedCell.x, blockedCell.y), "deployment should fail when core energy is insufficient");

const duel = new BattleGame({ random: () => 0.2 });
duel.state.obstacles = [];
duel.state.units = [
  makeUnit("p-strike", "strike", "player", 5, 5),
  makeUnit("e-dagger", "dagger", "enemy", 5, 4)
];
duel.state.cores.player.x = 1;
duel.state.cores.player.y = 12;
duel.state.cores.enemy.x = 11;
duel.state.cores.enemy.y = 0;
const strike = duel.getUnit("p-strike");
strike.hp = 1;
strike.energy = strike.baseEnergy;
assert(duel.effectiveMaxEnergy(strike) === strike.baseEnergy, "damaged units should keep their full energy cap");
assert(duel.getReachableCells(strike).some((cell) => cell.x === 7 && cell.y === 5), "normal units should move up to 2 cells");
assert(duel.basicAttack("p-strike", duel.targetRef(duel.getUnit("e-dagger")), "player"), "manual basic attack should work");
assert(!duel.getUnit("e-dagger"), "basic attack should remove defeated units");
assert(duel.state.factions.player.score === getUnitType("dagger").energy, "destroying a unit should grant score equal to its max energy");

const coreSkillGame = new BattleGame({ random: () => 0.4 });
coreSkillGame.state.obstacles = [];
coreSkillGame.state.units = [
  makeUnit("e-dagger", "dagger", "enemy", 6, 10),
  makeUnit("e-strike", "strike", "enemy", 6, 8)
];
coreSkillGame.state.cores.player.x = 6;
coreSkillGame.state.cores.player.y = 12;
coreSkillGame.state.cores.player.energy = 4;
assert(coreSkillGame.useSkill("core-player", { x: 6, y: 8 }, "player", "positron"), "core positron cannon should fire by selected direction at range 4");
assert(!coreSkillGame.getUnit("e-dagger"), "positron cannon should deal 3 damage");
assert(coreSkillGame.getUnit("e-strike").hp === 1, "positron overflow should continue to the next target");

const overloadGame = new BattleGame({ random: () => 0.4 });
overloadGame.state.cores.player.energy = 3;
overloadGame.state.cores.player.hp = 10;
assert(overloadGame.useSkill("core-player", null, "player", "overload"), "core overload should restore missing energy");
assert(overloadGame.state.cores.player.hp === 6, "overload should spend 2 HP per restored energy");
assert(!overloadGame.state.cores.player.acted, "overload should not consume the core action");
overloadGame.state.units = [makeUnit("e-dagger", "dagger", "enemy", overloadGame.state.cores.player.x, overloadGame.state.cores.player.y - 4)];
assert(overloadGame.useSkill("core-player", { x: overloadGame.state.cores.player.x, y: overloadGame.state.cores.player.y - 4 }, "player", "positron"), "core should still fire positron after overload");

const regenGame = new BattleGame({ random: () => 0.2 });
const firstZone = regenGame.state.energyZones[0];
const zoneCell = { x: firstZone.x, y: firstZone.y };
regenGame.state.cores.player.x = zoneCell.x;
regenGame.state.cores.player.y = zoneCell.y;
regenGame.state.cores.player.energy = 0;
regenGame.restoreEnergy(regenGame.state.cores.player);
assert(regenGame.state.cores.player.energy >= 2, "core should regenerate at least 2 energy inside an energy zone");
regenGame.state.cores.player.x = regenGame.state.strategicPoints[0].x;
regenGame.state.cores.player.y = regenGame.state.strategicPoints[0].y;
regenGame.state.cores.player.energy = 0;
regenGame.restoreEnergy(regenGame.state.cores.player);
assert(regenGame.state.cores.player.energy === 3, "core should regenerate 3 energy on a strategic point");

const freedomGame = new BattleGame({ random: () => 0.4 });
freedomGame.state.obstacles = [];
freedomGame.state.units = [
  makeUnit("p-freedom", "freedom", "player", 6, 6, { energy: 5 }),
  makeUnit("e-strike", "strike", "enemy", 6, 4),
  makeUnit("e-ginn", "ginn", "enemy", 7, 3),
  makeUnit("p-strike", "strike", "player", 5, 5)
];
assert(freedomGame.useSkill("p-freedom", { x: 6, y: 4 }, "player", "salvo"), "Freedom should fire directional 3x3 skill by selecting a tile");
assert(freedomGame.getUnit("e-strike").hp === 1, "Freedom should damage units in the directional area");
assert(!freedomGame.getUnit("e-ginn"), "Freedom should destroy low HP units in the area");
assert(freedomGame.getUnit("p-strike").hp === 1, "Freedom area fire should still allow friendly fire");
assert(freedomGame.state.factions.player.score === getUnitType("ginn").energy, "Freedom kills should grant unit energy as score");

const emptySalvoGame = new BattleGame({ random: () => 0.4 });
emptySalvoGame.state.obstacles = [];
emptySalvoGame.state.units = [makeUnit("p-freedom", "freedom", "player", 6, 6, { energy: 5 })];
assert(emptySalvoGame.useSkill("p-freedom", { x: 9, y: 6 }, "player", "salvo"), "Freedom should be able to fire into empty cells");

const justiceGame = new BattleGame({ random: () => 0.4 });
justiceGame.state.obstacles = [];
justiceGame.state.units = [
  makeUnit("p-justice", "justice", "player", 5, 5),
  makeUnit("e-dagger", "dagger", "enemy", 5, 4)
];
const justice = justiceGame.getUnit("p-justice");
assert(justice.attack === 2, "Justice should use 2 attack");
assert(justiceGame.getReachableCells(justice).some((cell) => cell.x === 8 && cell.y === 5), "Justice should move up to 3 cells");
assert(justiceGame.basicAttack("p-justice", justiceGame.targetRef(justiceGame.getUnit("e-dagger")), "player"), "Justice should kill with basic attack");
assert(!justiceGame.getUnit("e-dagger"), "Justice should kill a 1 HP target");
assert(justiceGame.state.factions.player.score === getUnitType("dagger").energy, "Justice kill should grant Dagger energy as score");
assert(!justice.moved && !justice.acted && justice.energy === 3, "Justice should spend 1 energy to gain another move and attack after a kill");

justiceGame.state.units.push(makeUnit("e-ginn", "ginn", "enemy", 6, 5, { hp: 1 }));
assert(justiceGame.basicAttack("p-justice", justiceGame.targetRef(justiceGame.getUnit("e-ginn")), "player"), "Justice chain should be repeatable while energy remains");
assert(!justiceGame.getUnit("e-ginn"), "Justice should kill the second target");
assert(justiceGame.state.factions.player.score === getUnitType("dagger").energy + getUnitType("ginn").energy, "repeat Justice kills should keep adding score");
assert(!justice.moved && !justice.acted && justice.energy === 2, "Justice should spend energy for each repeated chain trigger");

const aiGame = new BattleGame({ random: () => 0.25 });
assert(aiGame.endTurn("player"), "player should end turn");
assert(aiGame.state.activeSide === "enemy", "enemy turn should start after player turn");
await planAI(aiGame, { delay: 0 });
assert(aiGame.state.activeSide === "player" || aiGame.state.winner, "AI should finish its turn and return control");
if (!aiGame.state.winner) {
  assert(aiGame.state.round === 2, "round should advance after AI turn");
  assert(aiGame.state.factions.player.hangar.length === 5, "hangar should remain stacked after turns");
}

function makeUnit(id, typeId, side, x, y, overrides = {}) {
  const type = getUnitType(typeId);
  return {
    id,
    cardId: id,
    type: typeId,
    name: type.name,
    side,
    x,
    y,
    attack: type.attack,
    hp: overrides.hp ?? type.hp,
    maxHp: type.hp,
    baseEnergy: type.energy,
    energy: overrides.energy ?? type.energy,
    regen: type.regen,
    moveRange: type.moveRange,
    moved: false,
    acted: false,
    waiting: false
  };
}

function hasAdjacentObstacle(obstacles) {
  return obstacles.some((cell) =>
    obstacles.some((other) => cell !== other && Math.abs(cell.x - other.x) + Math.abs(cell.y - other.y) === 1)
  );
}

console.log("smoke-test passed");
