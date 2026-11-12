// Czysta logika gry (bez bazy danych) – łatwa do testowania i balansowania.

export const POSITIONS = {
  BR: 'Bramkarz',
  OBR: 'Obrońca',
  POM: 'Pomocnik',
  NAP: 'Napastnik',
};

// Prosta lista statystyk.
export const STATS = {
  strzaly: 'Strzały',
  podania: 'Podania',
  drybling: 'Drybling',
  obrona: 'Obrona',
  szybkosc: 'Szybkość',
  kondycja: 'Kondycja',
  bramkarstwo: 'Bramkarstwo',
};
export const STAT_KEYS = Object.keys(STATS);

// Bonus startowy zależny od pozycji.
const POSITION_START_BONUS = {
  BR: { bramkarstwo: 6, obrona: 2 },
  OBR: { obrona: 5, kondycja: 3 },
  POM: { podania: 5, drybling: 3 },
  NAP: { strzaly: 5, szybkosc: 3 },
};

export const START_STAT = 5;
export const ENERGY_MAX = 100;
export const ENERGY_REGEN_MS = 3 * 60 * 1000; // 1 pkt energii co 3 minuty
export const TRAINING_ENERGY = 10;
export const DUEL_ENERGY = 15;
export const CLUB_CREATE_COST = 500;
export const CLUB_MAX_MEMBERS = 16;
export const CLUB_MATCH_COOLDOWN_MS = 60 * 60 * 1000;
export const DAILY_BONUS_MS = 24 * 60 * 60 * 1000;
export const DUEL_LEVEL_RANGE = 5;

export function startingStats(position) {
  const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, START_STAT]));
  for (const [k, v] of Object.entries(POSITION_START_BONUS[position] || {})) stats[k] += v;
  return stats;
}

// Ile treningów potrzeba, by podnieść statystykę o 1 punkt.
export function trainingsNeeded(statValue) {
  return 1 + Math.floor(statValue / 10);
}

// Koszt treningu w monetach – rośnie wraz z poziomem statystyki.
export function trainingCost(statValue) {
  return Math.floor(statValue * 1.5);
}

export function xpForNextLevel(level) {
  return 100 * level;
}

// Dodaje XP i zwraca nowy poziom/XP oraz liczbę zdobytych poziomów.
export function addXp(level, xp, gained) {
  let lvl = level;
  let cur = xp + gained;
  let levelsUp = 0;
  while (cur >= xpForNextLevel(lvl)) {
    cur -= xpForNextLevel(lvl);
    lvl += 1;
    levelsUp += 1;
  }
  return { level: lvl, xp: cur, levelsUp };
}

// Energia liczona leniwie na podstawie znacznika czasu.
export function currentEnergy(stored, updatedAt, now = Date.now()) {
  if (stored >= ENERGY_MAX) return { energy: stored, updatedAt: now };
  const ticks = Math.floor((now - updatedAt) / ENERGY_REGEN_MS);
  if (ticks <= 0) return { energy: stored, updatedAt };
  const energy = Math.min(ENERGY_MAX, stored + ticks);
  const newUpdated = energy >= ENERGY_MAX ? now : updatedAt + ticks * ENERGY_REGEN_MS;
  return { energy, updatedAt: newUpdated };
}

export function dailyBonusAmount(level) {
  return 50 + level * 10;
}

export function overall(stats) {
  return STAT_KEYS.reduce((s, k) => s + (stats[k] || 0), 0);
}

// Siła ataku i obrony pojedynczego zawodnika.
export function attackPower(s) {
  return s.strzaly * 0.45 + s.drybling * 0.3 + s.szybkosc * 0.25;
}
export function buildupPower(s) {
  return s.podania * 0.6 + s.drybling * 0.2 + s.szybkosc * 0.2;
}
export function defensePower(s) {
  return s.obrona * 0.6 + s.szybkosc * 0.2 + s.kondycja * 0.2;
}
export function keeperPower(s) {
  return s.bramkarstwo * 0.8 + s.szybkosc * 0.2;
}

// Zmęczenie: w drugiej połowie niska kondycja obniża formę.
export function fatigueFactor(s, half) {
  if (half === 1) return 1;
  const others = (overall(s) - s.kondycja) / (STAT_KEYS.length - 1) || 1;
  return 0.85 + 0.15 * Math.min(1, s.kondycja / others);
}

// Deterministyczny generator losowy (mulberry32) – mecze są powtarzalne dla danego seeda.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chance(a, b) {
  return a / (a + b || 1);
}

/**
 * Wspólny silnik meczu. Każda strona to obiekt:
 * { name, attack, buildup, defense, keeper, fatigue: [f1, f2], scorers: [nazwy] }
 * Mecz to seria akcji – w każdej najpierw rozegranie (budowanie vs obrona),
 * potem strzał (atak vs bramkarz/obrona).
 */
export function simulate(home, away, seed = Date.now(), actions = 16) {
  const rand = rng(seed);
  const events = [];
  const score = [0, 0];
  const sides = [home, away];
  for (let i = 0; i < actions; i++) {
    const minute = Math.min(90, Math.floor(((i + rand()) / actions) * 90) + 1);
    const half = minute <= 45 ? 1 : 2;
    const att = i % 2 === 0 ? 0 : 1;
    const def = 1 - att;
    const A = sides[att];
    const D = sides[def];
    const fa = A.fatigue[half - 1];
    const fd = D.fatigue[half - 1];

    const buildup = chance(A.buildup * fa, D.defense * fd * 0.9);
    if (rand() > buildup) {
      events.push({ minute, side: def, type: 'lost', text: `${D.name} przerywa akcję rywala.` });
      continue;
    }
    const shot = 0.55 * chance(A.attack * fa, (D.keeper * 0.7 + D.defense * 0.3) * fd) * 2;
    const scorer = A.scorers[Math.floor(rand() * A.scorers.length)];
    if (rand() < Math.min(0.75, shot * 0.6)) {
      score[att] += 1;
      events.push({ minute, side: att, type: 'goal', text: `GOL! ${scorer} trafia do siatki.` });
    } else if (rand() < 0.5) {
      events.push({ minute, side: att, type: 'save', text: `${scorer} strzela, ale bramkarz broni.` });
    } else {
      events.push({ minute, side: att, type: 'miss', text: `${scorer} uderza obok bramki.` });
    }
  }
  events.sort((a, b) => a.minute - b.minute);
  return { score, events };
}

// Pojedynek 1 na 1 (sparing) między dwoma graczami.
export function playerSide(name, s) {
  return {
    name,
    attack: attackPower(s),
    buildup: buildupPower(s),
    defense: defensePower(s),
    keeper: Math.max(keeperPower(s), defensePower(s) * 0.6),
    fatigue: [fatigueFactor(s, 1), fatigueFactor(s, 2)],
    scorers: [name],
  };
}

// Drużyna klubowa: zawodnicy liczą się według pozycji.
export function teamSide(name, members) {
  const byPos = (p) => members.filter((m) => m.position === p);
  const avg = (arr, fn) => (arr.length ? arr.reduce((s, m) => s + fn(m.stats), 0) / arr.length : 0);
  const all = members;
  const keepers = byPos('BR');
  const keeper = keepers.length
    ? Math.max(...keepers.map((m) => keeperPower(m.stats)))
    : avg(all, keeperPower) * 0.5; // brak bramkarza = duża kara
  const lineup = members.length;
  const sizeFactor = Math.min(1, 0.5 + lineup / 22); // pełny skład (11) = 1.0
  const attackers = [...byPos('NAP'), ...byPos('POM')];
  const defenders = [...byPos('OBR'), ...byPos('POM')];
  const builders = byPos('POM').length ? byPos('POM') : all;
  const fat = (h) => avg(all, (s) => fatigueFactor(s, h)) || 1;
  const scorersPool = attackers.length ? attackers : all;
  return {
    name,
    attack: (avg(attackers.length ? attackers : all, attackPower) || 1) * sizeFactor,
    buildup: (avg(builders, buildupPower) || 1) * sizeFactor,
    defense: (avg(defenders.length ? defenders : all, defensePower) || 1) * sizeFactor,
    keeper: keeper || 1,
    fatigue: [fat(1), fat(2)],
    scorers: scorersPool.map((m) => m.name),
  };
}

// Nagrody za mecz.
export function duelRewards(result, level) {
  const base = 20 + level * 4;
  if (result === 'win') return { money: base * 2, xp: 30 };
  if (result === 'draw') return { money: base, xp: 18 };
  return { money: Math.floor(base / 2), xp: 10 };
}

export function clubMatchRewards(result) {
  if (result === 'win') return { points: 3, treasury: 300, xp: 40 };
  if (result === 'draw') return { points: 1, treasury: 150, xp: 25 };
  return { points: 0, treasury: 50, xp: 15 };
}

// Sklep – sprzęt dający bonusy do statystyk.
export const SLOTS = { buty: 'Buty', koszulka: 'Koszulka', spodenki: 'Spodenki', getry: 'Getry', rekawice: 'Rękawice' };
export const ITEMS = [
  { id: 'buty1', slot: 'buty', name: 'Trampki z bazaru', price: 100, level: 1, bonus: { szybkosc: 1 } },
  { id: 'buty2', slot: 'buty', name: 'Korki „Błyskawica”', price: 600, level: 5, bonus: { szybkosc: 3, strzaly: 1 } },
  { id: 'buty3', slot: 'buty', name: 'Korki „Kometa Pro”', price: 2500, level: 12, bonus: { szybkosc: 5, strzaly: 3 } },
  { id: 'kosz1', slot: 'koszulka', name: 'Koszulka treningowa', price: 120, level: 1, bonus: { kondycja: 1 } },
  { id: 'kosz2', slot: 'koszulka', name: 'Koszulka oddychająca', price: 700, level: 6, bonus: { kondycja: 3, podania: 1 } },
  { id: 'kosz3', slot: 'koszulka', name: 'Koszulka „Gwiazda”', price: 3000, level: 14, bonus: { kondycja: 4, podania: 3 } },
  { id: 'spod1', slot: 'spodenki', name: 'Spodenki bawełniane', price: 100, level: 1, bonus: { drybling: 1 } },
  { id: 'spod2', slot: 'spodenki', name: 'Spodenki „Zwinne”', price: 650, level: 5, bonus: { drybling: 3 } },
  { id: 'spod3', slot: 'spodenki', name: 'Spodenki „Tornado”', price: 2700, level: 13, bonus: { drybling: 5, szybkosc: 1 } },
  { id: 'getr1', slot: 'getry', name: 'Getry podwórkowe', price: 90, level: 1, bonus: { obrona: 1 } },
  { id: 'getr2', slot: 'getry', name: 'Getry z ochraniaczami', price: 600, level: 5, bonus: { obrona: 3 } },
  { id: 'getr3', slot: 'getry', name: 'Getry „Mur”', price: 2600, level: 12, bonus: { obrona: 5, kondycja: 1 } },
  { id: 'rek1', slot: 'rekawice', name: 'Rękawice zimowe', price: 110, level: 1, bonus: { bramkarstwo: 1 } },
  { id: 'rek2', slot: 'rekawice', name: 'Rękawice „Pewny chwyt”', price: 700, level: 5, bonus: { bramkarstwo: 3 } },
  { id: 'rek3', slot: 'rekawice', name: 'Rękawice „Pajęczyna”', price: 2800, level: 13, bonus: { bramkarstwo: 6 } },
];
export const ITEMS_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export function effectiveStats(base, equippedItemIds) {
  const s = { ...base };
  for (const id of equippedItemIds) {
    const it = ITEMS_BY_ID[id];
    if (!it) continue;
    for (const [k, v] of Object.entries(it.bonus)) s[k] = (s[k] || 0) + v;
  }
  return s;
}
