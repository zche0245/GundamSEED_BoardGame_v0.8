import { BattleGame, DIFFICULTY_PRESETS, OBSTACLE_PRESETS } from "./core/battle.js";
import { planAI } from "./core/ai.js";
import { HANGAR_LOADOUT, UNIT_TYPES } from "./data/units.js";
import { TacticalView } from "./ui/view.js";
import { coreSvg, unitSvg } from "./ui/svgUnits.js";

const root = document.querySelector("#app");

let game = null;
let view = null;
let aiRunning = false;

renderHome();

function renderHome() {
  cleanupBattle();
  root.innerHTML = `
    <main class="start-shell">
      <section class="start-panel">
        <div class="start-kicker">GUNDAM SEED TACTICAL PROTOTYPE</div>
        <h1>超载战术</h1>
        <p>能量管理，战斗部署，资源争夺。</p>
        <div class="start-actions">
          <button data-screen="setup">人机对战</button>
          <button data-screen="tutorial">教程</button>
          <button data-screen="codex">图鉴</button>
        </div>
      </section>
    </main>
  `;
  bindScreenButtons();
}

function renderBattleSetup() {
  cleanupBattle();
  root.innerHTML = `
    <main class="setup-shell">
      <section class="setup-panel">
        <div class="start-kicker">CUSTOM MATCH</div>
        <h1>对局设置</h1>
        <p>选择 AI 难度与障碍物密度。难度越高，AI拥有更多资源和分数优势。</p>
        <div class="setup-section">
          <h2>难度</h2>
          <div class="setup-options" data-setting="difficulty">
            ${renderDifficultyOption("easy", true, "公平开局。")}
            ${renderDifficultyOption("normal", false, "战略点离敌方较近，AI 初始 EN 4，战略分领先 3。")}
            ${renderDifficultyOption("hard", false, "战略点离敌方非常近，AI 初始 EN 5，战略分领先 6。")}
          </div>
        </div>
        <div class="setup-section">
          <h2>障碍物</h2>
          <div class="setup-options obstacle-options" data-setting="obstacles">
            ${renderObstacleOption("light", false)}
            ${renderObstacleOption("standard", true)}
            ${renderObstacleOption("dense", false)}
            ${renderObstacleOption("heavy", false)}
          </div>
        </div>
        <div class="setup-summary">
          <span data-setup-summary>简单 / 标准障碍</span>
        </div>
        <div class="setup-actions">
          <button data-screen="home">返回</button>
          <button data-action="start-custom">开始对战</button>
        </div>
      </section>
    </main>
  `;
  bindSetupControls();
  bindScreenButtons();
}

function renderDifficultyOption(id, selected, text) {
  const preset = DIFFICULTY_PRESETS[id];
  return `
    <button class="setup-option ${selected ? "selected" : ""}" data-difficulty="${id}" aria-pressed="${selected ? "true" : "false"}">
      <b>${preset.name}</b>
      <span>${text}</span>
    </button>
  `;
}

function renderObstacleOption(id, selected) {
  const preset = OBSTACLE_PRESETS[id];
  return `
    <button class="setup-option ${selected ? "selected" : ""}" data-obstacles="${id}" aria-pressed="${selected ? "true" : "false"}">
      <b>${preset.name}</b>
      <span>${preset.count} 个障碍</span>
    </button>
  `;
}

function renderTutorial() {
  cleanupBattle();
  root.innerHTML = `
    <main class="tutorial-shell">
      <header class="tutorial-head">
        <button data-screen="home">返回</button>
        <button data-screen="codex">图鉴</button>
        <button data-screen="setup">开始人机对战</button>
      </header>
      <article class="tutorial-page">
        <div class="start-kicker">TACTICAL BRIEFING</div>
        <h1>舰长操作手册</h1>
        <section>
          <h2>目标</h2>
          <p>摧毁敌方母舰，或在 10 回合内取得更高战略分。战略分相同则比较母舰 HP。</p>
        </section>
        <section>
          <h2>图例</h2>
          <div class="legend-grid">
            <div><span class="legend-swatch unit player"></span><b>蓝色 HP</b><p>玩家单位。</p></div>
            <div><span class="legend-swatch unit enemy"></span><b>红色 HP</b><p>AI 单位。</p></div>
            <div><span class="legend-swatch energy"></span><b>黄色 EN</b><p>单位能量。</p></div>
            <div><span class="legend-swatch status ready"></span><b>READY</b><p>状态指示：可行动。</p></div>
            <div><span class="legend-swatch status done"></span><b>DONE</b><p>状态指示：本回合已完成行动。</p></div>
            <div><span class="legend-swatch status wait"></span><b>WAIT</b><p>状态指示：新部署单位，下回合可行动。</p></div>
            <div><span class="legend-cell point"></span><b>战略点</b><p>机体站上即可控制，回合结束获得 1 战略分。</p></div>
            <div><span class="legend-cell energy-zone"></span><b>能量区</b><p>母舰在区域内每回合可以恢复更多 EN。</p></div>
            <div><span class="legend-cell obstacle"></span><b>障碍物</b><p>无法进入，也不能部署。</p></div>
            <div><span class="legend-cell deploy-player"></span><b>部署区</b><p>母舰周围 8 格，可部署机体。</p></div>
          </div>
        </section>
        <section>
          <h2>回合结构</h2>
          <p>你的回合内可以部署机体、移动单位、普攻或使用技能。每个单位通常每回合可以移动一次、攻击或使用一次技能。</p>
        </section>
        <section>
          <h2>母舰与部署</h2>
          <p>机库单位部署在母舰周围 8 格。部署消耗母舰 EN，不限制次数，只要母舰 EN 足够且部署格合法即可。</p>
          <p>新部署的单位处于 wait 状态，只有所属方下一次回合开始才会变为 ready。</p>
        </section>
        <section>
          <h2>能量</h2>
          <p>母舰初始 EN 为 2。母舰每回合开始恢复 EN：普通区域 +1，能量区 +2，战略点上 +3。单位也会在所属方回合开始恢复自己的 EN。</p>
          <p>超载模式：让母舰立刻回满 EN，但每回复 1 EN 会消耗 2 HP。</p>
        </section>
        <section>
          <h2>战斗</h2>
          <p>普攻：攻击相邻敌人。技能消耗单位自己的 EN。阳电子炮选择一个 8 方向射线，命中的第一个敌方目标承受 3 点伤害，溢出伤害继续传递给同方向下一个敌方目标。</p>
        </section>
        <section>
          <h2>战略点</h2>
          <p>机体站在战略点上即可控制。每回合结束时，控制点会提供战略分。母舰不控制战略点。</p>
          <p>击破敌方机体也会获得战略分，分值等同于被击破机体的 EN 上限。</p>
        </section>
        <section>
          <h2>机库</h2>
          <p>机库固定提供吉恩、短剑L、强袭高达、自由高达和正义高达。相同机体堆叠显示，数量耗尽后无法继续部署。</p>
        </section>
      </article>
    </main>
  `;
  bindScreenButtons();
}

function renderCodex() {
  cleanupBattle();
  const unitCards = Object.values(UNIT_TYPES).map((type) => renderCodexUnit(type)).join("");
  root.innerHTML = `
    <main class="codex-shell">
      <header class="tutorial-head">
        <button data-screen="home">返回</button>
        <button data-screen="tutorial">教程</button>
        <button data-screen="setup">开始人机对战</button>
      </header>
      <section class="codex-page">
        <div class="start-kicker">TACTICAL INDEX</div>
        <h1>机体图鉴</h1>
        <div class="codex-grid">
          ${renderCodexCore()}
          ${unitCards}
        </div>
      </section>
    </main>
  `;
  bindScreenButtons();
}

function renderCodexCore() {
  return `
    <article class="codex-card core-entry">
      <div class="codex-figure">${coreSvg("player")}</div>
      <h2>母舰核心</h2>
      <p>部署中心，也是胜负核心。前压可以扩大部署位置，但更容易被突破。</p>
      <div class="codex-stats">
        <span>费用 -</span><span>攻击 1</span><span>HP 10</span><span>EN 5</span>
      </div>
      <div class="codex-skill"><b>阳电子炮</b><span>4EN。朝一个方向发射，第一个命中的单位受到 3 点伤害，溢出伤害由下一个敌方目标承受。</span></div>
      <div class="codex-skill"><b>超载模式</b><span>立刻回满 EN，每回复 1EN 消耗 2HP，HP不足时无法使用。</span></div>
    </article>
  `;
}

function renderCodexUnit(type) {
  const skill = type.skill
    ? `<div class="codex-skill"><b>${type.skill.name}${type.skill.passive ? ` / 被动${type.skill.cost ? ` / ${type.skill.cost}EN` : ""}` : ` / ${type.skill.cost}EN`}</b><span>${type.skill.text}</span></div>`
    : `<div class="codex-skill"><b>无技能</b><span>依靠站位和普攻完成战术任务。</span></div>`;
  return `
    <article class="codex-card">
      <div class="codex-figure">${unitSvg(type.id)}</div>
      <h2>${type.name}</h2>
      <p>${type.role}</p>
      <div class="codex-stats">
        <span>库存 ${HANGAR_LOADOUT[type.id] ?? 0}</span>
        <span>费用 ${type.cost}</span>
        <span>攻击 ${type.attack}</span>
        <span>HP ${type.hp}</span>
        <span>EN ${type.energy}</span>
        <span>移动 ${type.moveRange}</span>
      </div>
      ${skill}
    </article>
  `;
}

function startBattle(options = {}) {
  cleanupBattle();
  game = new BattleGame(options);
  view = new TacticalView(game, root, {
    onHome: renderHome,
    onEndTurn: async () => {
      if (aiRunning || game.state.activeSide !== "player" || game.state.winner) return;
      game.endTurn("player");
      if (game.state.winner) return;
      aiRunning = true;
      view.setBusy(true);
      try {
        await planAI(game, {
          delay: view.getAIActionDelay(),
          onFocus: (actorId) => view.focusActor(actorId)
        });
      } finally {
        view.resetCamera();
        aiRunning = false;
        view.setBusy(false);
      }
    }
  });
  window.seedTacticsDebug = {
    game,
    view,
    aiTurn: () => planAI(game, { delay: 0 }),
    endPlayerTurn: () => view.endPlayerTurn()
  };
  view.render();
}

function cleanupBattle() {
  aiRunning = false;
  game = null;
  view = null;
  window.seedTacticsDebug = null;
}

function bindScreenButtons() {
  root.querySelectorAll("[data-screen]").forEach((button) => {
    button.addEventListener("click", () => {
      const screen = button.dataset.screen;
      if (screen === "battle") startBattle();
      if (screen === "setup") renderBattleSetup();
      if (screen === "tutorial") renderTutorial();
      if (screen === "codex") renderCodex();
      if (screen === "home") renderHome();
    });
  });
}

function bindSetupControls() {
  const state = {
    difficulty: "easy",
    obstacles: "standard"
  };
  const update = () => {
    root.querySelectorAll("[data-difficulty]").forEach((button) => {
      const selected = button.dataset.difficulty === state.difficulty;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    root.querySelectorAll("[data-obstacles]").forEach((button) => {
      const selected = button.dataset.obstacles === state.obstacles;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    const summary = root.querySelector("[data-setup-summary]");
    if (summary) {
      summary.textContent = `${DIFFICULTY_PRESETS[state.difficulty].name} / ${OBSTACLE_PRESETS[state.obstacles].name}障碍`;
    }
  };

  root.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      state.difficulty = button.dataset.difficulty;
      update();
    });
  });
  root.querySelectorAll("[data-obstacles]").forEach((button) => {
    button.addEventListener("click", () => {
      state.obstacles = button.dataset.obstacles;
      update();
    });
  });
  root.querySelector("[data-action='start-custom']")?.addEventListener("click", () => {
    startBattle({
      difficulty: state.difficulty,
      obstacleCount: OBSTACLE_PRESETS[state.obstacles].count
    });
  });
  update();
}
