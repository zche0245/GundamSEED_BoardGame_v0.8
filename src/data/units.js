export const UNIT_TYPES = {
  ginn: {
    id: "ginn",
    name: "吉恩",
    cost: 1,
    attack: 1,
    hp: 2,
    energy: 2,
    startEnergy: 2,
    regen: 1,
    moveRange: 2,
    role: "占点 / 卡位",
    visual: "grunt",
    color: "#3f774d",
    skill: null,
    text: "基础杂兵机。费用低，适合抢点、卡路和补线。"
  },
  dagger: {
    id: "dagger",
    name: "短剑L",
    cost: 1,
    attack: 1,
    hp: 1,
    energy: 3,
    startEnergy: 3,
    regen: 1,
    moveRange: 2,
    role: "远程干扰",
    visual: "ranged",
    color: "#dfe7e1",
    accent: "#2d6fc6",
    dark: "#2f3942",
    skill: {
      id: "suppress",
      name: "远程压制",
      cost: 2,
      range: 3,
      damage: 1,
      text: "距离3，造成1点伤害。适合补刀和打断推进。"
    },
    text: "便宜的远程压制单位。血量很低，但可以用能量换取安全输出。"
  },
  strike: {
    id: "strike",
    name: "强袭高达",
    cost: 4,
    attack: 1,
    hp: 3,
    energy: 3,
    startEnergy: 3,
    regen: 1,
    moveRange: 2,
    role: "中费突破",
    visual: "strike",
    color: "#fbfcfa",
    accent: "#245fc5",
    secondAccent: "#d9322f",
    dark: "#30363a",
    skill: {
      id: "saber",
      name: "光束军刀",
      cost: 2,
      range: 1,
      damage: 3,
      text: "相邻目标，造成3点伤害。攻击母舰也可以使用。"
    },
    text: "稳定的中费万能机，用来打开局部缺口。"
  },
  freedom: {
    id: "freedom",
    name: "自由高达",
    cost: 5,
    attack: 3,
    hp: 5,
    energy: 5,
    startEnergy: 5,
    regen: 1,
    moveRange: 2,
    role: "范围压制",
    visual: "aoe",
    color: "#fbfcfa",
    accent: "#2b70c9",
    secondAccent: "#e0b21f",
    dark: "#2d343a",
    skill: {
      id: "salvo",
      name: "全炮门齐射",
      cost: 3,
      range: 3,
      damage: 2,
      text: "选择一个方向，对该方向3x3格内所有机体造成2点伤害。可以空放。"
    },
    text: "高费范围压制核心。能清理密集阵线，但存在误伤风险。"
  },
  justice: {
    id: "justice",
    name: "正义高达",
    cost: 5,
    attack: 2,
    hp: 4,
    energy: 4,
    startEnergy: 4,
    regen: 1,
    moveRange: 3,
    role: "高机动近战",
    visual: "melee",
    color: "#fbfcfa",
    accent: "#d84766",
    secondAccent: "#e0b21f",
    dark: "#2f3438",
    skill: {
      id: "justice_chain",
      name: "破阵追击",
      cost: 1,
      passive: true,
      text: "普攻击破单位后，若有EN，消耗1EN并重置移动与普攻。本回合可重复触发。"
    },
    text: "高机动近战核心。移动距离为3，依靠EN连续破阵。"
  }
};

export const HANGAR_LOADOUT = {
  ginn: 4,
  dagger: 4,
  strike: 2,
  freedom: 1,
  justice: 1
};

export const DEFAULT_DECK = Object.entries(HANGAR_LOADOUT).flatMap(([type, count]) =>
  Array.from({ length: count }, () => type)
);

export const UNIT_POOL = Object.keys(UNIT_TYPES);

export function getUnitType(type) {
  return UNIT_TYPES[type];
}
