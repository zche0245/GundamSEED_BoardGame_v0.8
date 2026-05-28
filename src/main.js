import { BattleGame } from "./core/battle.js";
import { planAI } from "./core/ai.js";
import { TacticalView } from "./ui/view.js";

const game = new BattleGame();
const root = document.querySelector("#app");

let aiRunning = false;

const view = new TacticalView(game, root, {
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
