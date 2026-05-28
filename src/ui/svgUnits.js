import { getUnitType } from "../data/units.js";

export function unitSvg(typeId) {
  const type = getUnitType(typeId);
  const fill = type.color;
  const accent = type.accent ?? "#111416";
  const second = type.secondAccent ?? accent;
  const dark = type.dark ?? "#111416";

  const parts = {
    grunt: `
      <circle cx="50" cy="16" r="12" fill="${fill}" />
      <polygon points="50,88 18,36 82,36" fill="${fill}" />
      <polygon points="14,58 26,42 30,62" fill="${dark}" />
      <polygon points="86,58 74,42 70,62" fill="${dark}" />
      <polygon points="50,98 41,84 59,84" fill="${dark}" />
    `,
    ranged: `
      <polygon points="50,91 22,35 78,35" fill="${fill}" />
      <rect x="32" y="33" width="36" height="8" fill="${accent}" />
      <polygon points="50,78 39,48 61,48" fill="${dark}" />
      <polygon points="50,99 41,84 59,84" fill="${dark}" />
    `,
    defense: `
      <polygon points="50,91 23,35 77,35" fill="${fill}" />
      <polygon points="50,82 39,46 61,46" fill="${dark}" />
      <rect x="48" y="25" width="4" height="50" fill="${accent}" />
      <polygon points="50,99 41,84 59,84" fill="${accent}" />
    `,
    strike: `
      <polygon points="50,90 20,34 80,34" fill="${fill}" />
      <polygon points="50,82 36,43 64,43" fill="${dark}" />
      <polygon points="50,12 40,31 60,31" fill="${second}" />
      <polygon points="50,36 32,66 50,76 68,66" fill="${accent}" />
      <polygon points="18,76 8,44 34,54" fill="${accent}" />
      <polygon points="82,76 92,44 66,54" fill="${accent}" />
    `,
    aoe: `
      <polygon points="50,90 24,40 76,40" fill="${fill}" />
      <polygon points="50,80 39,48 61,48" fill="${dark}" />
      <polygon points="24,46 3,22 41,44" fill="${accent}" />
      <polygon points="76,46 97,22 59,44" fill="${accent}" />
      <polygon points="26,72 6,96 42,72" fill="${accent}" />
      <polygon points="74,72 94,96 58,72" fill="${accent}" />
      <polygon points="50,18 28,42 50,34 72,42" fill="${second}" />
      <rect x="46" y="10" width="8" height="24" fill="${accent}" />
      <polygon points="50,99 40,84 60,84" fill="${accent}" />
    `,
    melee: `
      <polygon points="50,90 24,38 76,38" fill="${fill}" />
      <polygon points="50,80 38,48 62,48" fill="${dark}" />
      <polygon points="25,80 8,26 36,52" fill="${accent}" />
      <polygon points="75,80 92,26 64,52" fill="${accent}" />
      <polygon points="50,22 34,42 50,34 66,42" fill="${second}" />
      <rect x="47" y="9" width="6" height="25" fill="${second}" />
      <polygon points="50,99 40,84 60,84" fill="${accent}" />
    `
  };

  return `
    <svg viewBox="0 0 100 100" role="img" aria-label="${type.name}">
      ${parts[type.visual]}
    </svg>
  `;
}

export function coreSvg(side) {
  const color = side === "player" ? "#1a67d2" : "#c93b34";
  const tip = side === "player" ? "12,76 50,18 88,76" : "12,24 50,82 88,24";
  const inner = side === "player" ? "34,68 50,38 66,68" : "34,32 50,62 66,32";
  return `
    <svg viewBox="0 0 100 100" role="img" aria-label="${side === "player" ? "玩家母舰" : "AI母舰"}">
      <polygon points="${tip}" fill="#161a1c" />
      <polygon points="${inner}" fill="${color}" />
      <rect x="42" y="42" width="16" height="16" fill="#ffffff" />
    </svg>
  `;
}
