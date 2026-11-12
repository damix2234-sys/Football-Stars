// Czysta logika gry (bez bazy danych) – łatwa do testowania i balansowania.

export const POSITIONS = {
  BR: 'Bramkarz',
  OBR: 'Obrońca',
  POM: 'Pomocnik',
  NAP: 'Napastnik',
};

/*
 * Trening: 6 kategorii, każda w swoim kolorze, po 2 specjalizacje.
 * Poziom specjalizacji rośnie przez trening. OVR kategorii = suma jej specjalizacji,
 * OVR piłkarza = suma wszystkich specjalizacji.
 * Ikony to nazwy z zestawu Material Symbols (Google Fonts).
 */
export const CATEGORIES = [
  {
    id: 'atak', name: 'Atak', color: '#ff4d5e', icon: 'sports_soccer',
    about: 'Zamienia akcje w gole. Im wyższy atak, tym częściej Twoje strzały kończą się bramką.',
    positions: ['NAP', 'POM'],
    specs: [
      { id: 'wykonczenie', name: 'Wykończenie', icon: 'target',
        about: 'Celność i siła strzału. Najważniejsza umiejętność napastnika – decyduje, czy sytuacja zamieni się w gola.' },
      { id: 'drybling', name: 'Drybling', icon: 'directions_run',
        about: 'Mijanie rywali z piłką. Pomaga wejść w pole karne i pomaga przy rozgrywaniu akcji.' },
    ],
  },
  {
    id: 'rozegranie', name: 'Rozegranie', color: '#ffc93c', icon: 'conversion_path',
    about: 'Budowanie akcji. Dzięki niemu drużyna częściej dochodzi do sytuacji strzeleckich.',
    positions: ['POM', 'NAP'],
    specs: [
      { id: 'podania', name: 'Podania', icon: 'swap_horiz',
        about: 'Dokładne zagrania do partnerów. Mniej strat piłki, więcej akcji pod bramką rywala.' },
      { id: 'wizja', name: 'Wizja gry', icon: 'visibility',
        about: 'Widzenie wolnego miejsca i kolegów. Otwiera drogę do bramki, gdy rywal broni szczelnie.' },
    ],
  },
  {
    id: 'obrona', name: 'Obrona', color: '#3fa9ff', icon: 'shield',
    about: 'Zatrzymuje ataki rywala, zanim dojdzie do strzału.',
    positions: ['OBR', 'POM'],
    specs: [
      { id: 'odbior', name: 'Odbiór', icon: 'block',
        about: 'Odbieranie piłki i wślizgi. Przerywa akcje przeciwnika w środku pola.' },
      { id: 'ustawianie', name: 'Ustawianie się', icon: 'my_location',
        about: 'Bycie we właściwym miejscu. Zamyka rywalom drogę do bramki i utrudnia strzały.' },
    ],
  },
  {
    id: 'fizycznosc', name: 'Fizyczność', color: '#ff8a3d', icon: 'bolt',
    about: 'Szybkość i siła przydają się wszędzie – w ataku, w obronie i w walce o piłkę.',
    positions: ['NAP', 'OBR', 'POM'],
    specs: [
      { id: 'szybkosc', name: 'Szybkość', icon: 'speed',
        about: 'Sprint i przyspieszenie. Łatwiej uciec obrońcy albo dogonić napastnika.' },
      { id: 'sila', name: 'Siła', icon: 'fitness_center',
        about: 'Wygrywanie przepychanek i pojedynków. Wzmacnia obronę i utrzymanie się przy piłce.' },
    ],
  },
  {
    id: 'kondycja', name: 'Kondycja', color: '#3ee07a', icon: 'ecg_heart',
    about: 'Utrzymuje formę do końca meczu. Bez kondycji w drugiej połowie wszystko działa słabiej.',
    positions: ['BR', 'OBR', 'POM', 'NAP'],
    specs: [
      { id: 'wytrzymalosc', name: 'Wytrzymałość', icon: 'timer',
        about: 'Bieganie przez 90 minut. Mniejszy spadek formy w drugiej połowie.' },
      { id: 'regeneracja', name: 'Regeneracja', icon: 'autorenew',
        about: 'Szybki powrót do sił po wysiłku. Działa razem z wytrzymałością przeciw zmęczeniu.' },
    ],
  },
  {
    id: 'bramkarstwo', name: 'Bramkarstwo', color: '#b26bff', icon: 'sports_handball',
    about: 'Obrona strzałów. Kluczowe dla bramkarza – w meczu klubowym drużyna bez dobrego bramkarza traci dużo goli.',
    positions: ['BR'],
    specs: [
      { id: 'refleks', name: 'Refleks', icon: 'flash_on',
        about: 'Reakcja na strzał z bliska. Ratuje drużynę w sytuacjach sam na sam.' },
      { id: 'chwytanie', name: 'Chwytanie', icon: 'back_hand',
        about: 'Pewne łapanie piłki. Mniej dobitek i prezentów dla rywala.' },
    ],
  },
];

export const SPECS = Object.fromEntries(
  CATEGORIES.flatMap((c) => c.specs.map((s) => [s.id, { ...s, category: c.id, color: c.color }])),
);
export const SPEC_KEYS = Object.keys(SPECS);
// Zgodność: nazwy umiejętności (np. w sklepie).
export const STATS = Object.fromEntries(SPEC_KEYS.map((k) => [k, SPECS[k].name]));
export const STAT_KEYS = SPEC_KEYS;

// Bonus startowy zależny od pozycji.
const POSITION_START_BONUS = {
  BR: { refleks: 10, chwytanie: 10 },
  OBR: { odbior: 10, ustawianie: 8, sila: 2 },
  POM: { podania: 10, wizja: 8, drybling: 2 },
  NAP: { wykonczenie: 10, drybling: 5, szybkosc: 5 },
};

export const START_SKILL = 10;
export const START_MONEY = 1000;
export const ENERGY_MAX = 500;
export const ENERGY_REGEN_MS = 10 * 1000; // 1 pkt energii co 10 s (360 na godzinę)
export const TRAIN_COOLDOWN_MS = 5000; // jeden trening co 5 s
export const AUTO_MAX_HOURS = 8;
export const AUTO_MAX_ACTIVE = 3;
export const DUEL_ENERGY = 25;
export const CLUB_CREATE_COST = 500;
export const CLUB_MAX_MEMBERS = 16;
export const CLUB_MATCH_COOLDOWN_MS = 60 * 60 * 1000;
export const DAILY_BONUS_MS = 24 * 60 * 60 * 1000;
export const DUEL_OVR_RATIO = 1.5; // rywal może mieć najwyżej 1,5× wyższy/niższy OVR

export function startingSkills(position) {
  const s = Object.fromEntries(SPEC_KEYS.map((k) => [k, START_SKILL]));
  for (const [k, v] of Object.entries(POSITION_START_BONUS[position] || {})) s[k] += v;
  return s;
}

export const ovr = (skills) => SPEC_KEYS.reduce((sum, k) => sum + (skills[k] || 0), 0);
export const overall = ovr;
export const categoryOvr = (skills, catId) =>
  CATEGORIES.find((c) => c.id === catId).specs.reduce((sum, s) => sum + (skills[s.id] || 0), 0);

// Koszt jednego treningu specjalizacji na danym poziomie.
export function trainCost(level) {
  return { energy: 5 + Math.floor(level / 25), money: 30 + level * 2 };
}
// Ile treningów potrzeba, by podnieść specjalizację o 1 poziom.
export function trainingsNeeded(level) {
  return 2 + Math.floor(level / 8);
}

// Wykonuje n treningów (bez sprawdzania kosztów) – zwraca nowy poziom i postęp.
export function applyTrainings(level, progress, n) {
  let lvl = level;
  let prog = progress;
  for (let i = 0; i < n; i++) {
    prog += 1;
    if (prog >= trainingsNeeded(lvl)) {
      prog = 0;
      lvl += 1;
    }
  }
  return { level: lvl, progress: prog, gained: lvl - level };
}

/**
 * Plan treningu automatycznego: ile treningów zmieści się w podanym czasie
 * i na ile wystarczy obecnej energii oraz monet (koszt rośnie z poziomem).
 */
export function planAuto(level, progress, energy, money, hours) {
  const slots = Math.floor((Math.min(AUTO_MAX_HOURS, Math.max(0, hours)) * 3600 * 1000) / TRAIN_COOLDOWN_MS);
  let lvl = level, prog = progress, count = 0, e = 0, m = 0, limit = 'time';
  while (count < slots) {
    const c = trainCost(lvl);
    if (e + c.energy > energy) { limit = 'energy'; break; }
    if (m + c.money > money) { limit = 'money'; break; }
    e += c.energy; m += c.money; count++;
    const r = applyTrainings(lvl, prog, 1);
    lvl = r.level; prog = r.progress;
  }
  return { count, energy: e, money: m, levels: lvl - level, durationMs: count * TRAIN_COOLDOWN_MS, slots, limit };
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

export function dailyBonusAmount(o) {
  return 50 + Math.floor(o / 5);
}

export function inDuelRange(a, b) {
  return Math.max(a, b) <= Math.min(a, b) * DUEL_OVR_RATIO;
}

// Siła ataku i obrony pojedynczego zawodnika (na podstawie umiejętności).
export function attackPower(s) {
  return s.wykonczenie * 0.5 + s.drybling * 0.3 + s.szybkosc * 0.2;
}
export function buildupPower(s) {
  return s.podania * 0.5 + s.wizja * 0.3 + s.drybling * 0.2;
}
export function defensePower(s) {
  return s.odbior * 0.45 + s.ustawianie * 0.35 + s.sila * 0.2;
}
export function keeperPower(s) {
  return s.refleks * 0.55 + s.chwytanie * 0.45;
}

// Zmęczenie: w drugiej połowie niska kondycja obniża formę.
export function fatigueFactor(s, half) {
  if (half === 1) return 1;
  const stamina = (s.wytrzymalosc + s.regeneracja) / 2;
  const others = (ovr(s) - s.wytrzymalosc - s.regeneracja) / (SPEC_KEYS.length - 2) || 1;
  return 0.85 + 0.15 * Math.min(1, stamina / others);
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

// Nagrody za mecz (rosną z OVR).
export function duelRewards(result, o) {
  const base = 20 + Math.floor(o / 10);
  if (result === 'win') return { money: base * 2 };
  if (result === 'draw') return { money: base };
  return { money: Math.floor(base / 2) };
}

export function clubMatchRewards(result) {
  if (result === 'win') return { points: 3, treasury: 300, money: 120 };
  if (result === 'draw') return { points: 1, treasury: 150, money: 60 };
  return { points: 0, treasury: 50, money: 25 };
}

// Sklep – sprzęt dający bonusy do umiejętności. "ovr" = wymagany OVR piłkarza.
export const SLOTS = { buty: 'Buty', koszulka: 'Koszulka', spodenki: 'Spodenki', getry: 'Getry', rekawice: 'Rękawice' };
export const ITEMS = [
  { id: 'buty1', slot: 'buty', name: 'Trampki z bazaru', price: 100, ovr: 0, bonus: { szybkosc: 2 } },
  { id: 'buty2', slot: 'buty', name: 'Korki „Błyskawica”', price: 600, ovr: 220, bonus: { szybkosc: 5, wykonczenie: 2 } },
  { id: 'buty3', slot: 'buty', name: 'Korki „Kometa Pro”', price: 2500, ovr: 400, bonus: { szybkosc: 9, wykonczenie: 5 } },
  { id: 'kosz1', slot: 'koszulka', name: 'Koszulka treningowa', price: 120, ovr: 0, bonus: { wytrzymalosc: 2 } },
  { id: 'kosz2', slot: 'koszulka', name: 'Koszulka oddychająca', price: 700, ovr: 240, bonus: { wytrzymalosc: 5, podania: 2 } },
  { id: 'kosz3', slot: 'koszulka', name: 'Koszulka „Gwiazda”', price: 3000, ovr: 420, bonus: { wytrzymalosc: 7, podania: 5 } },
  { id: 'spod1', slot: 'spodenki', name: 'Spodenki bawełniane', price: 100, ovr: 0, bonus: { drybling: 2 } },
  { id: 'spod2', slot: 'spodenki', name: 'Spodenki „Zwinne”', price: 650, ovr: 220, bonus: { drybling: 5, wizja: 1 } },
  { id: 'spod3', slot: 'spodenki', name: 'Spodenki „Tornado”', price: 2700, ovr: 410, bonus: { drybling: 9, szybkosc: 2 } },
  { id: 'getr1', slot: 'getry', name: 'Getry podwórkowe', price: 90, ovr: 0, bonus: { odbior: 2 } },
  { id: 'getr2', slot: 'getry', name: 'Getry z ochraniaczami', price: 600, ovr: 220, bonus: { odbior: 5, sila: 2 } },
  { id: 'getr3', slot: 'getry', name: 'Getry „Mur”', price: 2600, ovr: 400, bonus: { odbior: 8, ustawianie: 4 } },
  { id: 'rek1', slot: 'rekawice', name: 'Rękawice zimowe', price: 110, ovr: 0, bonus: { chwytanie: 2 } },
  { id: 'rek2', slot: 'rekawice', name: 'Rękawice „Pewny chwyt”', price: 700, ovr: 220, bonus: { chwytanie: 5, refleks: 2 } },
  { id: 'rek3', slot: 'rekawice', name: 'Rękawice „Pajęczyna”', price: 2800, ovr: 410, bonus: { chwytanie: 8, refleks: 6 } },
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
