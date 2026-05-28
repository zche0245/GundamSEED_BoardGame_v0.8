import { BOARD, displayCoord } from "../core/battle.js";
import { getUnitType } from "../data/units.js";
import { coreSvg, unitSvg } from "./svgUnits.js";

const SPEEDS = {
  fast: { label: "快速", delay: 300, ttl: 1150, focusZoom: 1.28, zoomMs: 420 },
  normal: { label: "标准", delay: 620, ttl: 1750, focusZoom: 1.45, zoomMs: 720 },
  slow: { label: "慢速", delay: 980, ttl: 2550, focusZoom: 1.62, zoomMs: 1050 }
};

export class TacticalView {
  constructor(game, root, { onEndTurn } = {}) {
    this.game = game;
    this.root = root;
    this.onEndTurn = onEndTurn;
    this.pendingDeploy = null;
    this.selectedActorId = null;
    this.selectedAction = "move";
    this.selectedSkillId = null;
    this.confirmEndTurn = false;
    this.settingsOpen = false;
    this.showCoords = this.loadBool("seed-tactics-show-coords", false);
    this.logCollapsed = this.loadBool("seed-tactics-log-collapsed", false);
    this.handCollapsed = this.loadBool("seed-tactics-hand-collapsed", false);
    this.speed = this.loadChoice("seed-tactics-speed", "normal", Object.keys(SPEEDS));
    this.busy = false;
    this.viewportScale = 1;
    this.panX = 0;
    this.panY = 0;
    this.panDrag = null;
    this.suppressNextCellClick = false;
    this.zoomPulse = false;
    this.turnNotice = null;
    this.turnNoticeNode = null;
    this.turnNoticeTimer = null;
    this.zoomTimer = null;
    this.moveAnimations = new Map();
    this.attackAnimations = new Map();
    this.hitAnimations = new Map();
    this.damageEvents = [];
    this.effectEvents = [];
    this.eventCounter = 1;
    this.theme = this.loadTheme();
    this.applyTheme();
    this.applySpeed();
    this.caption = "选择单位后执行移动、普攻或技能。部署会消耗母舰能量。";
    this.game.subscribe((state, event) => this.handleGameEvent(state, event));
  }

  speedProfile() {
    return SPEEDS[this.speed] ?? SPEEDS.normal;
  }

  getAIActionDelay() {
    return this.speedProfile().delay;
  }

  setBusy(value) {
    this.busy = value;
    this.render();
  }

  focusActor(actorId) {
    const actor = this.game.getActor(actorId);
    if (actor) this.focusCell(actor);
  }

  focusCell(cell) {
    const viewport = this.root.querySelector("[data-board-viewport]");
    const target = this.root.querySelector(`[data-cell="${cell.x},${cell.y}"]`);
    if (viewport && target) {
      const viewportRect = viewport.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      this.panX += viewportRect.left + viewportRect.width / 2 - (targetRect.left + targetRect.width / 2);
      this.panY += viewportRect.top + viewportRect.height / 2 - (targetRect.top + targetRect.height / 2);
    }
    this.viewportScale = Math.max(this.viewportScale, this.speedProfile().focusZoom);
    this.triggerZoomEase();
    this.updateStageTransform();
  }

  async endPlayerTurn() {
    if (this.busy || this.game.state.activeSide !== "player" || this.game.state.winner) return;
    if (this.hasRemainingActions()) {
      this.confirmEndTurn = true;
      this.render();
      return;
    }
    await this.forceEndPlayerTurn();
  }

  async forceEndPlayerTurn() {
    if (this.busy || this.game.state.activeSide !== "player" || this.game.state.winner) return;
    this.confirmEndTurn = false;
    this.clearSelection();
    await this.onEndTurn?.();
  }

  handleGameEvent(state, event = { type: "state" }) {
    const ttl = this.speedProfile().ttl;
    if (event.type === "move") {
      this.moveAnimations.set(event.actorId, this.animationRecord(event));
      this.expireAnimation(this.moveAnimations, event.actorId, ttl);
    }

    if (event.type === "attack" || event.type === "skill") {
      if (event.attackerId) {
        this.attackAnimations.set(event.attackerId, this.animationRecord(event));
        this.expireAnimation(this.attackAnimations, event.attackerId, ttl);
      }
      if (event.beamTarget) {
        this.addEffect(event.beamTarget.x, event.beamTarget.y, event.effect ?? "hit", event.from);
      }
      for (const target of event.targets ?? [event.target].filter(Boolean)) {
        this.addEffect(target.x, target.y, event.effect === "positron" ? "impact" : event.effect ?? "hit", event.from);
      }
      for (const cell of event.areaCells ?? []) this.addEffect(cell.x, cell.y, "area");
    }

    if (event.type === "damage" || event.type === "heal") {
      const id = `${event.type}-${this.eventCounter++}`;
      this.damageEvents.push(this.animationRecord({
        id,
        x: event.x,
        y: event.y,
        amount: event.amount,
        kind: event.type
      }));
      if (event.target) {
        this.hitAnimations.set(event.target, this.animationRecord(event));
        this.expireAnimation(this.hitAnimations, event.target, ttl);
      }
      window.setTimeout(() => {
        this.damageEvents = this.damageEvents.filter((item) => item.id !== id);
        this.render();
      }, ttl);
    }

    if (["turn-start", "winner", "reset"].includes(event.type)) {
      this.clearSelection();
      this.confirmEndTurn = false;
      this.busy = false;
    }

    if (event.type === "turn-start") {
      this.showTurnNotice(event.side);
    }

    this.render();
  }

  showTurnNotice(side) {
    this.turnNotice = { side, id: this.eventCounter++ };
    window.clearTimeout(this.turnNoticeTimer);
    this.turnNoticeNode?.remove();
    const node = document.createElement("div");
    node.className = `turn-notice ${side}`;
    node.textContent = side === "player" ? "玩家回合" : "AI回合";
    document.body.appendChild(node);
    this.turnNoticeNode = node;
    this.turnNoticeTimer = window.setTimeout(() => {
      this.turnNotice = null;
      node.remove();
      if (this.turnNoticeNode === node) this.turnNoticeNode = null;
      this.render();
    }, Math.max(900, this.speedProfile().delay * 1.35));
  }

  animationRecord(event) {
    return { ...event, startedAt: performance.now(), duration: this.speedProfile().ttl };
  }

  animationDelay(event) {
    if (!event?.startedAt) return "0ms";
    const elapsed = Math.min(event.duration - 16, Math.max(0, performance.now() - event.startedAt));
    return `${-Math.round(elapsed)}ms`;
  }

  expireAnimation(map, key, delay) {
    window.setTimeout(() => {
      map.delete(key);
      this.render();
    }, delay);
  }

  addEffect(x, y, kind, from = null) {
    const id = `effect-${this.eventCounter++}`;
    const angle = from ? Math.atan2(y - from.y, x - from.x) * 180 / Math.PI : 0;
    const distance = from ? Math.max(0.6, Math.hypot(x - from.x, y - from.y)) : 0.6;
    const directional = Boolean(from && (from.x !== x || from.y !== y));
    this.effectEvents.push(this.animationRecord({ id, x, y, kind, angle, distance, directional }));
    window.setTimeout(() => {
      this.effectEvents = this.effectEvents.filter((item) => item.id !== id);
      this.render();
    }, this.speedProfile().ttl);
  }

  render() {
    const state = this.game.state;
    this.root.innerHTML = `
      <main class="app-shell ${this.logCollapsed ? "log-collapsed" : ""} ${this.handCollapsed ? "dock-collapsed" : ""}">
        <section class="main-layout">
          ${this.renderSideStats()}
          <section class="battlefield">
            ${this.renderBattleHud()}
            <div class="board-wrap">
              ${this.renderBoard()}
              <div class="board-caption">${this.captionForState()}</div>
            </div>
          </section>
          ${this.renderLog()}
        </section>
        ${this.renderHandDock()}
        ${this.settingsOpen ? this.renderSettingsModal() : ""}
        ${this.confirmEndTurn ? this.renderEndTurnConfirm() : ""}
        ${state.winner ? this.renderResult() : ""}
      </main>
    `;
    this.bindEvents();
  }

  renderBattleHud() {
    const player = this.game.state.factions.player;
    const enemy = this.game.state.factions.enemy;
    const playerCore = this.game.state.cores.player;
    const enemyCore = this.game.state.cores.enemy;
    return `
      <div class="battle-hud">
        <div class="hud-block"><span>回合</span><b>${this.game.state.round}/${BOARD.maxRound}</b></div>
        <div class="hud-block"><span>行动方</span><b>${this.activeSideLabel()}</b></div>
        <div class="hud-block"><span>战略点</span><b>${this.renderPointDots()}</b></div>
        <div class="hud-block"><span>战略分</span><b>${player.score} / ${enemy.score}</b></div>
        <div class="hud-block"><span>母舰</span><b>${playerCore.hp}/${playerCore.maxHp} / ${enemyCore.hp}/${enemyCore.maxHp}</b></div>
        <button class="theme-toggle" data-action="open-settings">设置</button>
      </div>
    `;
  }

  renderSideStats() {
    const player = this.game.state.factions.player;
    const enemy = this.game.state.factions.enemy;
    return `
      <aside class="side-stats">
        <div class="side-stat-title">资源</div>
        <div class="side-stat-row"><span>机库</span><b>${this.hangarTotal("player")}</b></div>
        <div class="side-stat-row"><span>类型</span><b>${player.hangar.filter((item) => item.count > 0).length}</b></div>
        <div class="side-stat-row"><span>母舰EN</span><b>${this.game.state.cores.player.energy}</b></div>
        <div class="side-stat-title muted">AI</div>
        <div class="side-stat-row enemy"><span>机库</span><b>${this.hangarTotal("enemy")}</b></div>
        <div class="side-stat-row enemy"><span>类型</span><b>${enemy.hangar.filter((item) => item.count > 0).length}</b></div>
        <div class="side-stat-row enemy"><span>母舰EN</span><b>${this.game.state.cores.enemy.energy}</b></div>
      </aside>
    `;
  }

  hangarTotal(side) {
    return this.game.state.factions[side].hangar.reduce((sum, item) => sum + item.count, 0);
  }

  activeSideLabel() {
    if (this.game.state.winner) return "结束";
    if (this.busy || this.game.state.activeSide === "enemy") return "AI行动";
    return "玩家行动";
  }

  renderPointDots() {
    return this.game.state.strategicPoints.map((point) => {
      const controller = this.game.getPointController(point) ?? "neutral";
      return `<i class="point-dot ${controller}" title="${displayCoord(point)}"></i>`;
    }).join("");
  }

  renderBoard() {
    const targets = this.getActionCells();
    const cells = [];

    for (let y = 0; y < BOARD.height; y += 1) {
      for (let x = 0; x < BOARD.width; x += 1) {
        const unit = this.game.unitAt(x, y);
        const core = this.game.coreAt(x, y);
        const actor = unit ?? core;
        const point = this.game.state.strategicPoints.find((item) => item.x === x && item.y === y);
        const controller = point ? this.game.getPointController(point) : null;
        const target = targets.find((item) => item.x === x && item.y === y);
        const canDeploy = this.pendingDeploy && this.game.canDeployTypeAt("player", this.pendingDeploy.type, x, y);
        const commandable = actor?.side === "player" && this.game.canControlActor(actor, "player") && !this.busy;
        const selected = this.selectedActorId === actor?.id;
        const isAnimating = actor && this.moveAnimations.has(actor.id);
        const classes = [
          "cell",
          this.game.isObstacle(x, y) ? "obstacle" : "",
          point ? "point" : "",
          controller ? `control-${controller}` : "",
          this.game.isInEnergyZone({ x, y }) ? "energy-zone" : "",
          this.game.isDeployment("player", x, y) ? "deploy-player" : "",
          this.game.isDeployment("enemy", x, y) ? "deploy-enemy" : "",
          canDeploy ? "deploy-target" : "",
          target ? `${target.kind}-target action-target` : "",
          commandable ? "commandable" : "",
          selected ? "selected" : "",
          isAnimating ? "animating-cell" : ""
        ].filter(Boolean).join(" ");

        cells.push(`
          <button class="${classes}" data-cell="${x},${y}" aria-label="${displayCoord({ x, y })}">
            ${this.showCoords ? `<span class="coord">${displayCoord({ x, y })}</span>` : ""}
            ${point ? `<span class="point-mark">◆</span>` : ""}
            ${this.game.isObstacle(x, y) ? `<span class="obstacle-mark"></span>` : ""}
            ${core ? this.renderCore(core) : ""}
            ${unit ? this.renderUnit(unit) : ""}
          </button>
        `);
      }
    }

    return `
      <div class="board-viewport" data-board-viewport>
        <div class="board-stage ${this.zoomPulse ? "zooming" : ""}" style="--view-scale:${this.viewportScale};--pan-x:${this.panX}px;--pan-y:${this.panY}px;">
          <div class="board" data-board style="--board-width:${BOARD.width};--board-height:${BOARD.height};">
            ${cells.join("")}
            ${this.renderEffects()}
            ${this.renderFloatingNumbers()}
          </div>
        </div>
      </div>
    `;
  }

  renderUnit(unit) {
    const type = getUnitType(unit.type);
    const motion = this.moveAnimations.get(unit.id);
    const attack = this.attackAnimations.get(unit.id);
    const hit = this.hitAnimations.get(unit.id);
    const style = this.actorAnimationStyle(motion, attack, hit);
    return `
      <div class="unit-token ${unit.side}-unit ${!this.game.isActorReady(unit) ? "waiting" : ""} ${motion ? "moving" : ""} ${attack ? "attacking" : ""} ${hit ? "hit" : ""}" style="${style}" data-actor="${unit.id}">
        <div class="unit-shape">${unitSvg(unit.type)}</div>
        <span class="unit-stat attack">${unit.attack}</span>
        ${this.renderStateBadge(unit)}
        <div class="bars-stack">
          ${this.renderHpPips(unit)}
          ${this.renderEnergyPips(unit)}
        </div>
        <div class="unit-tooltip">
          <span class="tooltip-title">${type.name}</span>
          <span class="tooltip-sub">攻 ${unit.attack} / HP ${Math.max(0, unit.hp)}/${unit.maxHp} / 能量 ${unit.energy}/${this.game.effectiveMaxEnergy(unit)}</span>
          <span class="tooltip-sub">${type.skill ? `${type.skill.name}：${type.skill.text}` : "无技能"}</span>
        </div>
      </div>
    `;
  }

  renderCore(core) {
    const motion = this.moveAnimations.get(core.id);
    const attack = this.attackAnimations.get(core.id);
    const hit = this.hitAnimations.get(core.id);
    const style = this.actorAnimationStyle(motion, attack, hit);
    return `
      <div class="core-token ${core.side}-core ${!this.game.isActorReady(core) ? "waiting" : ""} ${motion ? "moving" : ""} ${attack ? "attacking" : ""} ${hit ? "hit" : ""}" style="${style}" data-actor="${core.id}">
        ${coreSvg(core.side)}
        <span class="unit-stat attack">${core.attack}</span>
        ${this.renderStateBadge(core)}
        <div class="bars-stack core-bars">
          ${this.renderHpPips(core, "core")}
          ${this.renderEnergyPips(core)}
        </div>
      </div>
    `;
  }

  actorAnimationStyle(motion, attack, hit) {
    return [
      motion ? `--dx:${motion.from.x - motion.to.x}` : "",
      motion ? `--dy:${motion.from.y - motion.to.y}` : "",
      motion ? `--move-delay:${this.animationDelay(motion)}` : "",
      attack?.target ? `--attack-x:${Math.sign(attack.target.x - attack.from.x)}` : "--attack-x:0",
      attack?.target ? `--attack-y:${Math.sign(attack.target.y - attack.from.y)}` : "--attack-y:0",
      attack ? `--attack-delay:${this.animationDelay(attack)}` : "",
      hit ? `--hit-delay:${this.animationDelay(hit)}` : ""
    ].filter(Boolean).join(";");
  }

  renderHpPips(actor, kind = actor.type === "core" ? "core" : "unit") {
    const hp = Math.max(0, actor.hp);
    return `
      <div class="hp-pips ${kind}" style="--hp-max:${actor.maxHp}" aria-label="HP ${hp}/${actor.maxHp}">
        ${Array.from({ length: actor.maxHp }, (_, index) => `<span class="${index < hp ? "filled" : "empty"}"></span>`).join("")}
      </div>
    `;
  }

  renderEnergyPips(actor) {
    const max = this.game.effectiveMaxEnergy(actor);
    const base = actor.baseEnergy ?? max;
    return `
      <div class="energy-pips ${max < base ? "damaged-cap" : ""}" style="--energy-max:${base}" aria-label="能量 ${actor.energy}/${max}">
        ${Array.from({ length: base }, (_, index) => {
          const available = index < max;
          const filled = index < actor.energy;
          return `<span class="${available ? "available" : "locked"} ${filled ? "filled" : ""}"></span>`;
        }).join("")}
      </div>
    `;
  }

  renderCardHpPips(type) {
    return `
      <div class="hp-pips unit" style="--hp-max:${type.hp}" aria-label="HP ${type.hp}/${type.hp}">
        ${Array.from({ length: type.hp }, () => `<span class="filled"></span>`).join("")}
      </div>
    `;
  }

  renderCardEnergyPips(type) {
    return `
      <div class="energy-pips" style="--energy-max:${type.energy}" aria-label="能量 ${type.energy}/${type.energy}">
        ${Array.from({ length: type.energy }, () => `<span class="available filled"></span>`).join("")}
      </div>
    `;
  }

  renderStateBadge(actor) {
    const active = this.game.state.activeSide;
    let state = "wait";
    if (!this.game.isActorReady(actor)) state = "wait";
    else if (!this.game.hasActorActions(actor)) state = "done";
    else if (actor.side === active && this.game.canControlActor(actor, actor.side)) state = "ready";
    return `<span class="status-dot ${state}" aria-label="${state}"></span>`;
  }

  renderEffects() {
    return this.effectEvents.map((event) => `
      <div class="attack-effect ${event.kind} ${event.directional ? "directional" : ""}" style="${this.effectStyle(event)}">
        <span></span><span></span><span></span><span></span>
      </div>
    `).join("");
  }

  renderFloatingNumbers() {
    return this.damageEvents.map((event) => `
      <div class="floating-number ${event.kind}" style="${this.animationStyle(event)}">
        ${event.kind === "heal" ? "+" : "-"}${event.amount}
      </div>
    `).join("");
  }

  animationStyle(event) {
    return `${this.cellCenterStyle(event)}--event-delay:${this.animationDelay(event)};`;
  }

  effectStyle(event) {
    return `${this.animationStyle(event)}--fx-angle:${event.angle ?? 0}deg;--fx-distance:${event.distance ?? 0.6};`;
  }

  cellCenterStyle(cell) {
    return `left: calc(${cell.x} * (var(--cell) + 1px) + var(--cell) * 0.5); top: calc(${cell.y} * (var(--cell) + 1px) + var(--cell) * 0.5);`;
  }

  renderHandDock() {
    const player = this.game.state.factions.player;
    if (this.handCollapsed) {
      return `
        <section class="hand-dock collapsed-dock">
          <button class="dock-toggle" data-action="toggle-hand">展开</button>
          <div class="compact-hand">
            ${player.hangar.map((card, index) => this.renderCompactHandCard(card, index)).join("") || `<div class="empty-note">机库为空</div>`}
          </div>
          <button class="start-button ${this.hasRemainingActions() ? "" : "ready"}" data-action="end-turn" ${this.busy || this.game.state.activeSide !== "player" ? "disabled" : ""}>结束回合</button>
        </section>
      `;
    }
    return `
      <section class="hand-dock">
        <button class="dock-toggle" data-action="toggle-hand">收起</button>
        <div class="hand-rail">
          ${player.hangar.map((card, index) => this.renderHandCard(card, index)).join("") || `<div class="empty-note">机库为空</div>`}
        </div>
        ${this.renderActionPanel()}
      </section>
    `;
  }

  renderHandCard(card, index) {
    const type = getUnitType(card.type);
    const selected = this.pendingDeploy?.cardId === card.id;
    const disabled = card.count <= 0 || this.game.state.activeSide !== "player" || this.busy || !this.game.canAffordDeployment("player", card.type);
    return `
      <button class="hand-card ${selected ? "selected" : ""}" data-hand="${index}" draggable="true" data-card-id="${card.id}" ${disabled ? "disabled" : ""}>
        <span class="card-stat attack">${type.attack}</span>
        <b class="card-cost">${type.cost}E</b>
        <b class="card-count">x${card.count}</b>
        <span class="card-figure">${unitSvg(type.id)}</span>
        <span class="card-name">${type.name}</span>
        <span class="card-bars">
          ${this.renderCardHpPips(type)}
          ${this.renderCardEnergyPips(type)}
        </span>
        <span class="card-skill">${type.skill ? `${type.skill.name}${type.skill.passive ? " / 被动" : ` · ${type.skill.cost}E`}` : "无技能"}</span>
      </button>
    `;
  }

  renderCompactHandCard(card, index) {
    const type = getUnitType(card.type);
    const selected = this.pendingDeploy?.cardId === card.id;
    const disabled = card.count <= 0 || this.game.state.activeSide !== "player" || this.busy || !this.game.canAffordDeployment("player", card.type);
    return `
      <button class="compact-card ${selected ? "selected" : ""}" data-hand="${index}" draggable="true" data-card-id="${card.id}" ${disabled ? "disabled" : ""}>
        <span>${type.name}</span><b>${type.cost}E</b><i>x${card.count}</i>
      </button>
    `;
  }

  renderActionPanel() {
    const actor = this.getSelectedActor();
    if (!actor) {
      return `
        <div class="action-panel">
          <div class="panel-title">操作 <small>${this.busy ? "AI行动中" : "等待选择"}</small></div>
          <div class="action-empty">选择玩家单位或母舰。部署会消耗母舰能量，不限制次数。</div>
          <button class="start-button ${this.hasRemainingActions() ? "" : "ready"}" data-action="end-turn" ${this.busy || this.game.state.activeSide !== "player" ? "disabled" : ""}>结束回合</button>
        </div>
      `;
    }

    const skills = this.game.getSkills(actor).filter((skill) => !skill.passive);
    const passiveSkill = this.game.getSkills(actor).find((skill) => skill.passive);
    const moveCount = actor.moved ? 0 : this.game.getReachableCells(actor).length;
    const attackCount = actor.acted ? 0 : this.game.getBasicAttackTargets(actor).length;
    const skillButtons = skills.map((skill) => {
      const targetCount = skill.targetless ? 1 : this.game.getSkillTargets(actor, skill.id).length;
      const disabled = !this.game.canUseSkill(actor, skill.id) || (!skill.targetless && targetCount === 0);
      const active = this.selectedAction === "skill" && this.selectedSkillId === skill.id;
      const action = skill.targetless ? "use-skill" : "select-skill";
      return `<button class="${active ? "active" : ""}" data-action="${action}" data-skill="${skill.id}" ${disabled ? "disabled" : ""}>${skill.name} ${skill.cost ? `${skill.cost}E` : ""}</button>`;
    }).join("");

    return `
      <div class="action-panel">
        <div class="panel-title">${actor.name} <small>${actor.type === "core" ? "母舰" : getUnitType(actor.type).role}</small></div>
        <div class="actor-summary">
          <span>攻 ${actor.attack}</span>
          <span>HP ${Math.max(0, actor.hp)}/${actor.maxHp}</span>
          <span>能量 ${actor.energy}/${this.game.effectiveMaxEnergy(actor)}</span>
        </div>
        <div class="selected-energy">${this.renderEnergyPips(actor)}</div>
        <div class="action-buttons">
          <button class="${this.selectedAction === "move" ? "active" : ""}" data-action="select-move" ${moveCount ? "" : "disabled"}>移动 ${moveCount}</button>
          <button class="${this.selectedAction === "attack" ? "active" : ""}" data-action="select-attack" ${attackCount ? "" : "disabled"}>普攻 ${attackCount}</button>
          ${skillButtons || `<button disabled>无技能</button>`}
        </div>
        <div class="action-desc">${this.actionDescription(actor, this.selectedSkill(actor) ?? passiveSkill)}</div>
        <button class="start-button ${this.hasRemainingActions() ? "" : "ready"}" data-action="end-turn" ${this.busy || this.game.state.activeSide !== "player" ? "disabled" : ""}>结束回合</button>
      </div>
    `;
  }

  actionDescription(actor, skill) {
    if (this.selectedAction === "move") return actor.moved ? "本回合已经移动。" : `可移动 ${this.game.getMoveRange(actor)} 格，不能穿过障碍或单位。`;
    if (this.selectedAction === "attack") return actor.acted ? "本回合已经攻击。" : "普攻只能攻击相邻目标。";
    if (!skill) return "该单位没有特殊技能。";
    if ((actor.energy ?? 0) < skill.cost) return `${skill.name} 需要 ${skill.cost} 能量。`;
    return skill.text;
  }

  renderLog() {
    if (this.logCollapsed) {
      return `<div class="log-panel collapsed"><button data-action="toggle-log">日志</button></div>`;
    }
    return `
      <div class="log-panel">
        <div class="panel-title">行动日志 <button class="mini-button" data-action="toggle-log">收起</button></div>
        <div class="log-list">
          ${this.game.state.log.slice(0, 18).map((item) => `<div class="log-item">${this.escape(item)}</div>`).join("")}
        </div>
      </div>
    `;
  }

  renderSettingsModal() {
    return `
      <div class="settings-overlay">
        <div class="settings-box">
          <div class="settings-head">
            <h2>设置</h2>
            <button data-action="close-settings">关闭</button>
          </div>
          <div class="settings-row">
            <span>棋盘坐标</span>
            <button data-action="toggle-coords">${this.showCoords ? "显示中" : "已隐藏"}</button>
          </div>
          <div class="settings-row">
            <span>界面主题</span>
            <button data-action="toggle-theme">${this.theme === "dark" ? "深色" : "浅色"}</button>
          </div>
          <div class="settings-row vertical">
            <span>游戏速度</span>
            <div class="speed-grid">
              ${Object.entries(SPEEDS).map(([id, config]) => `
                <button class="${this.speed === id ? "active" : ""}" data-speed="${id}">${config.label}</button>
              `).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderEndTurnConfirm() {
    return `
      <div class="confirm-overlay">
        <div class="confirm-box">
          <h2>结束回合？</h2>
          <p>仍有单位可以行动。结束后 AI 会立即行动，本回合未使用的移动和攻击会被放弃。</p>
          <div class="confirm-actions">
            <button data-action="cancel-end-turn">继续操作</button>
            <button data-action="confirm-end-turn">结束回合</button>
          </div>
        </div>
      </div>
    `;
  }

  renderTurnNotice() {
    const side = this.turnNotice.side;
    return `<div class="turn-notice ${side}">${side === "player" ? "玩家回合" : "AI回合"}</div>`;
  }

  renderResult() {
    const winner = this.game.state.winner;
    const title = winner.side === "draw" ? "平局" : winner.side === "player" ? "作战胜利" : "作战失败";
    return `
      <div class="result-overlay">
        <div class="result-box">
          <h2>${title}</h2>
          <p>${winner.reason}</p>
          <button data-action="restart">重新开始</button>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.root.querySelectorAll("[data-cell]").forEach((button) => {
      button.addEventListener("click", () => this.handleCellClick(button.dataset.cell));
      button.addEventListener("dragover", (event) => event.preventDefault());
      button.addEventListener("drop", (event) => {
        event.preventDefault();
        this.dropCardOnCell(event.dataTransfer.getData("text/plain"), button.dataset.cell);
      });
    });

    this.root.querySelectorAll("[data-hand]").forEach((button) => {
      button.addEventListener("click", () => this.handleHandClick(Number(button.dataset.hand)));
      button.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", `card:${button.dataset.cardId}`);
        event.dataTransfer.effectAllowed = "copy";
      });
    });

    this.root.querySelectorAll("[data-speed]").forEach((button) => {
      button.addEventListener("click", () => this.setSpeed(button.dataset.speed));
    });

    const viewport = this.root.querySelector("[data-board-viewport]");
    viewport?.addEventListener("wheel", (event) => this.handleViewportWheel(event), { passive: false });
    viewport?.addEventListener("pointerdown", (event) => this.handleViewportPointerDown(event));

    this.root.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => this.handleAction(button.dataset.action, button.dataset));
    });
  }

  handleCellClick(key) {
    if (this.suppressNextCellClick) {
      this.suppressNextCellClick = false;
      return;
    }
    if (this.busy || this.game.state.activeSide !== "player" || this.confirmEndTurn) return;
    const [x, y] = key.split(",").map(Number);

    if (this.pendingDeploy) {
      const index = this.game.state.factions.player.hangar.findIndex((card) => card.id === this.pendingDeploy.cardId);
      if (index >= 0 && this.game.deployCard("player", index, x, y)) {
        this.pendingDeploy = null;
        this.caption = "部署完成，新部署机体本回合不能行动。";
      }
      this.render();
      return;
    }

    const target = this.getActionCells().find((item) => item.x === x && item.y === y);
    if (target && this.selectedActorId) {
      this.executeSelectedAction(target);
      return;
    }

    const actor = this.game.actorAt(x, y);
    if (actor?.side === "player") {
      this.selectActor(actor.id);
      return;
    }

    this.clearSelection();
    this.render();
  }

  executeSelectedAction(target) {
    const actor = this.getSelectedActor();
    if (!actor) return;
    const action = this.selectedAction;
    let ok = false;
    if (action === "move") ok = this.game.moveActor(actor.id, target.x, target.y, "player");
    if (action === "attack") ok = this.game.basicAttack(actor.id, target.ref, "player");
    if (action === "skill") ok = this.game.useSkill(actor.id, target.ref ?? { x: target.x, y: target.y }, "player", this.selectedSkillId);
    if (ok) {
      this.caption = `${actor.name} 已执行${this.actionLabel(action)}。`;
      this.pickNextAction(actor.id);
    }
    this.render();
  }

  actionLabel(action) {
    return action === "move" ? "移动" : action === "attack" ? "普攻" : "技能";
  }

  selectActor(actorId) {
    const actor = this.game.getActor(actorId);
    if (!actor || actor.side !== "player") return;
    this.selectedActorId = actor.id;
    this.pendingDeploy = null;
    this.pickNextAction(actor.id);
    this.caption = this.game.canControlActor(actor, "player")
      ? `${actor.name} 等待指令。`
      : `${actor.name} 本回合不能行动。`;
    this.render();
  }

  pickNextAction(actorId) {
    const actor = this.game.getActor(actorId);
    if (!actor) return;
    this.selectedSkillId = null;
    if (!actor.moved && this.game.getReachableCells(actor).length > 0) this.selectedAction = "move";
    else if (!actor.acted && this.game.getBasicAttackTargets(actor).length > 0) this.selectedAction = "attack";
    else this.selectedAction = "move";
  }

  handleHandClick(index) {
    const card = this.game.state.factions.player.hangar[index];
    if (!card || card.count <= 0 || this.busy || this.game.state.activeSide !== "player" || !this.game.canAffordDeployment("player", card.type)) return;
    if (this.pendingDeploy?.cardId === card.id) {
      this.pendingDeploy = null;
      this.caption = "已取消部署选择。";
    } else {
      this.pendingDeploy = { cardId: card.id, type: card.type };
      this.selectedActorId = null;
      this.caption = `${getUnitType(card.type).name} 待部署：放到母舰周围8格的空位。`;
    }
    this.render();
  }

  dropCardOnCell(payload, key) {
    const [, cardId] = payload.split(":");
    if (!cardId || this.busy || this.game.state.activeSide !== "player") return;
    const [x, y] = key.split(",").map(Number);
    const index = this.game.state.factions.player.hangar.findIndex((card) => card.id === cardId);
    if (index >= 0 && this.game.deployCard("player", index, x, y)) {
      this.pendingDeploy = null;
      this.caption = "机库单位已拖拽部署。";
      this.render();
    }
  }

  handleAction(action, dataset = {}) {
    if (action === "open-settings") {
      this.settingsOpen = true;
      this.render();
      return;
    }
    if (action === "close-settings") {
      this.settingsOpen = false;
      this.render();
      return;
    }
    if (action === "toggle-theme") {
      this.theme = this.theme === "dark" ? "light" : "dark";
      this.applyTheme();
      this.render();
      return;
    }
    if (action === "toggle-coords") {
      this.showCoords = !this.showCoords;
      this.saveBool("seed-tactics-show-coords", this.showCoords);
      this.render();
      return;
    }
    if (action === "toggle-log") {
      this.logCollapsed = !this.logCollapsed;
      this.saveBool("seed-tactics-log-collapsed", this.logCollapsed);
      this.render();
      return;
    }
    if (action === "toggle-hand") {
      this.handCollapsed = !this.handCollapsed;
      this.saveBool("seed-tactics-hand-collapsed", this.handCollapsed);
      this.render();
      return;
    }
    if (action === "restart") {
      this.clearSelection();
      this.confirmEndTurn = false;
      this.game.reset();
      return;
    }
    if (action === "end-turn") {
      this.endPlayerTurn();
      return;
    }
    if (action === "confirm-end-turn") {
      this.forceEndPlayerTurn();
      return;
    }
    if (action === "cancel-end-turn") {
      this.confirmEndTurn = false;
      this.render();
      return;
    }
    if (action === "use-skill") {
      const actor = this.getSelectedActor();
      if (actor && this.game.useSkill(actor.id, null, "player", dataset.skill)) {
        this.caption = `${actor.name} 使用技能。`;
        this.pickNextAction(actor.id);
      }
      this.render();
      return;
    }
    const actionMap = {
      "select-move": "move",
      "select-attack": "attack",
      "select-skill": "skill"
    };
    if (actionMap[action]) {
      this.selectedAction = actionMap[action];
      this.selectedSkillId = action === "select-skill" ? dataset.skill ?? null : null;
      this.render();
    }
  }

  setSpeed(speed) {
    if (!SPEEDS[speed]) return;
    this.speed = speed;
    this.saveChoice("seed-tactics-speed", speed);
    this.applySpeed();
    this.render();
  }

  getActionCells() {
    const actor = this.getSelectedActor();
    if (!actor || !this.game.canControlActor(actor, "player")) return [];
    if (this.selectedAction === "move" && !actor.moved) {
      return this.game.getReachableCells(actor).map((cell) => ({ ...cell, kind: "move" }));
    }
    if (this.selectedAction === "attack" && !actor.acted) {
      return this.game.getBasicAttackTargets(actor).map((ref) => ({ ...ref, ref, kind: "attack" }));
    }
    if (this.selectedAction === "skill" && this.selectedSkillId && this.game.canUseSkill(actor, this.selectedSkillId)) {
      const skill = this.selectedSkill(actor);
      return this.game.getSkillTargets(actor, this.selectedSkillId).map((ref) => ({
        ...ref,
        ref,
        kind: skill.id === "salvo" ? "area" : skill.id === "positron" ? "ray" : "skill"
      }));
    }
    return [];
  }

  getSelectedActor() {
    return this.selectedActorId ? this.game.getActor(this.selectedActorId) : null;
  }

  selectedSkill(actor = this.getSelectedActor()) {
    if (!actor || !this.selectedSkillId) return null;
    return this.game.getSkills(actor).find((skill) => skill.id === this.selectedSkillId) ?? null;
  }

  canSelectedAct() {
    const actor = this.getSelectedActor();
    return Boolean(actor && this.game.canControlActor(actor, "player") && (!actor.moved || !actor.acted));
  }

  hasRemainingActions() {
    if (this.game.state.activeSide !== "player" || this.game.state.winner) return false;
    return [this.game.state.cores.player, ...this.game.unitsFor("player")]
      .some((actor) => this.game.hasActorActions(actor));
  }

  handleViewportWheel(event) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.12;
    this.viewportScale = Math.min(2.8, Math.max(0.62, this.viewportScale * factor));
    this.triggerZoomEase();
    this.updateStageTransform();
  }

  triggerZoomEase() {
    this.zoomPulse = true;
    this.root.querySelector(".board-stage")?.classList.add("zooming");
    window.clearTimeout(this.zoomTimer);
    this.zoomTimer = window.setTimeout(() => {
      this.zoomPulse = false;
      this.root.querySelector(".board-stage")?.classList.remove("zooming");
    }, this.speedProfile().zoomMs);
  }

  handleViewportPointerDown(event) {
    if (event.button !== 0 || event.target.closest(".hand-card, .action-panel, .battle-hud, .log-panel, .confirm-overlay, .settings-overlay, .result-overlay")) return;
    this.panDrag = {
      x: event.clientX,
      y: event.clientY,
      panX: this.panX,
      panY: this.panY,
      moved: false
    };
    const move = (moveEvent) => {
      if (!this.panDrag) return;
      const dx = moveEvent.clientX - this.panDrag.x;
      const dy = moveEvent.clientY - this.panDrag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.panDrag.moved = true;
      this.panX = this.panDrag.panX + dx;
      this.panY = this.panDrag.panY + dy;
      this.updateStageTransform();
    };
    const up = () => {
      if (this.panDrag?.moved) this.suppressNextCellClick = true;
      this.panDrag = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  updateStageTransform() {
    const stage = this.root.querySelector(".board-stage");
    if (stage) {
      stage.style.setProperty("--pan-x", `${this.panX}px`);
      stage.style.setProperty("--pan-y", `${this.panY}px`);
      stage.style.setProperty("--view-scale", this.viewportScale);
    }
  }

  captionForState() {
    if (this.game.state.winner) return "战斗结束。";
    if (this.busy || this.game.state.activeSide === "enemy") return "AI正在行动。镜头会跟随当前行动单位。";
    if (this.pendingDeploy) return this.caption;
    const actor = this.getSelectedActor();
    if (actor) return `${actor.name}：当前模式 ${this.actionLabel(this.selectedAction)}。`;
    return this.caption;
  }

  clearSelection() {
    this.pendingDeploy = null;
    this.selectedActorId = null;
    this.selectedSkillId = null;
  }

  loadTheme() {
    return this.loadChoice("seed-tactics-theme", window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light", ["dark", "light"]);
  }

  applyTheme() {
    document.documentElement.dataset.theme = this.theme;
    this.saveChoice("seed-tactics-theme", this.theme);
  }

  applySpeed() {
    const profile = this.speedProfile();
    document.documentElement.style.setProperty("--anim-unit", `${profile.ttl}ms`);
    document.documentElement.style.setProperty("--anim-effect", `${Math.max(700, profile.ttl - 150)}ms`);
    document.documentElement.style.setProperty("--zoom-duration", `${profile.zoomMs}ms`);
  }

  loadBool(key, fallback) {
    try {
      const stored = window.localStorage?.getItem(key);
      if (stored === "1") return true;
      if (stored === "0") return false;
    } catch {
      // Ignore storage failures.
    }
    return fallback;
  }

  saveBool(key, value) {
    try {
      window.localStorage?.setItem(key, value ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  }

  loadChoice(key, fallback, allowed) {
    try {
      const stored = window.localStorage?.getItem(key);
      if (allowed.includes(stored)) return stored;
    } catch {
      // Ignore storage failures.
    }
    return fallback;
  }

  saveChoice(key, value) {
    try {
      window.localStorage?.setItem(key, value);
    } catch {
      // Ignore storage failures.
    }
  }

  escape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
}
