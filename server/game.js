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
        about: 'Celność i siła strzału. Najważniejsza umiejętność napastnika, bo decyduje, czy sytuacja zamieni się w gola.' },
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
    about: 'Szybkość i siła przydają się wszędzie: w ataku, w obronie i w walce o piłkę.',
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
    about: 'Obrona strzałów. Kluczowe dla bramkarza. W meczu klubowym drużyna bez dobrego bramkarza traci dużo goli.',
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
export const START_MONEY = 5000;
// Energia nie ma limitu: odnawia się cały czas. START_ENERGY to energia nowego piłkarza.
export const START_ENERGY = 500;
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
  return { energy: 5 + Math.floor(level / 25), money: 30 + level };
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
 * Plan treningu automatycznego: wybrany czas zawsze oznacza pełną liczbę treningów
 * (jeden co 5 s). Liczymy dokładny koszt i efekt; jeśli gracza nie stać, nie może zacząć.
 */
export const AUTO_OPTIONS = [1 / 12, 0.25, 0.5, 1, 2, 4, 8];
export function planAuto(level, progress, energy, money, hours) {
  const count = Math.floor((Math.min(AUTO_MAX_HOURS, Math.max(0, hours)) * 3600 * 1000) / TRAIN_COOLDOWN_MS);
  let lvl = level, prog = progress, e = 0, m = 0;
  for (let i = 0; i < count; i++) {
    const c = trainCost(lvl);
    e += c.energy;
    m += c.money;
    const r = applyTrainings(lvl, prog, 1);
    lvl = r.level;
    prog = r.progress;
  }
  return {
    hours, count, energy: e, money: m, levels: lvl - level, durationMs: count * TRAIN_COOLDOWN_MS,
    missingMoney: Math.max(0, m - money), missingEnergy: Math.max(0, e - energy),
    affordable: m <= money && e <= energy,
  };
}

// Energia liczona leniwie na podstawie znacznika czasu (bez górnego limitu).
export function currentEnergy(stored, updatedAt, now = Date.now()) {
  const ticks = Math.floor((now - updatedAt) / ENERGY_REGEN_MS);
  if (ticks <= 0) return { energy: stored, updatedAt };
  return { energy: stored + ticks, updatedAt: updatedAt + ticks * ENERGY_REGEN_MS };
}

export function dailyBonusAmount(o) {
  return 500 + o * 2;
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
  const base = 150 + Math.floor(o / 2);
  if (result === 'win') return { money: base * 2 };
  if (result === 'draw') return { money: base };
  return { money: Math.floor(base / 2) };
}

export function clubMatchRewards(result) {
  if (result === 'win') return { points: 3, treasury: 1000, money: 600 };
  if (result === 'draw') return { points: 1, treasury: 500, money: 300 };
  return { points: 0, treasury: 200, money: 120 };
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

/*
 * Pojedynki: seria rzutów karnych 1 na 1.
 * Bramka w układzie znormalizowanym: x od -1 (lewy słupek) do 1 (prawy słupek),
 * y od 0 (murawa) do 1 (poprzeczka). Wynik każdego strzału liczy serwer.
 */
export const PENALTY_ENERGY = 25;
export const PENALTY_KICKS = 5; // po 5 strzałów, potem seria do pierwszej różnicy w parze (bez remisów)
export const PENALTY_SAFETY = 40;
// Czas na decyzję w każdym ruchu; serwer dolicza zapas na animację i opóźnienie sieci.
export const PENALTY_DECIDE_MS = 10000;
export const PENALTY_GRACE_MS = 3000;
export const PENALTY_TOSS_MS = 3500; // losowanie przed pierwszym ruchem
export const PENALTY_ANIM_MS = 3600; // animacja strzału przed kolejnym ruchem
export const MATCH_BOT_AFTER_MS = 60000; // po minucie bez gracza dobieramy bota
export const PENALTY_WIN_REWARD = { money: 500, energy: 2000 };

// Bot do pojedynku: siła zbliżona do OVR gracza.
const BOT_NAMES = ['Adrian Grom', 'Kamil Wicher', 'Oskar Zryw', 'Filip Rakieta', 'Dawid Skała', 'Bruno Iskra',
  'Igor Mur', 'Wiktor Strzała', 'Maks Błysk', 'Leo Tornado', 'Szymon Kret', 'Nikodem Pazur'];
export function makeBot(ovrTarget, rand) {
  const posList = ['NAP', 'POM', 'OBR', 'BR'];
  const position = posList[Math.floor(rand() * posList.length)];
  const skills = startingSkills(position);
  const base = ovr(skills);
  const goal = Math.max(base, Math.round(ovrTarget * (0.85 + rand() * 0.3)));
  for (const k of SPEC_KEYS) skills[k] = Math.round((skills[k] * goal) / base);
  return { name: BOT_NAMES[Math.floor(rand() * BOT_NAMES.length)], position, ovr: ovr(skills), skills, bot: true };
}
// Ruch po czasie: strzał obok bramki albo bramkarz zostaje w środku.
export const timeoutMove = (turn) => (turn === 'shoot' ? { x: 1.6, y: 0.4 } : { x: 0, y: 0.45 }); // zabezpieczenie przed nieskończoną serią

// Celownik napastnika: obiegi toru na sekundę. Na początku szybki, wolniejszy z wyższym Wykończeniem.
export const aimSpeed = (shooter) => 1.6 / (1 + shooter / 45);
// Tor celownika obejmuje bramkę i pas wokół niej (obok słupków i nad poprzeczką),
// więc źle wybrany moment = pudło. Ten sam wzór jest w public/penalty.js (sweepPoint).
export const AIM_X = 1.35;
export const AIM_Y_MID = 0.66;
export const AIM_Y_AMP = 0.62;
export function aimPoint(sec, speed, ph) {
  const t = sec * speed;
  return { x: AIM_X * Math.sin(2 * Math.PI * t + ph), y: AIM_Y_MID + AIM_Y_AMP * Math.sin(2 * Math.PI * t * 1.53 + ph * 2.1) };
}
export const shooterSkill = (s) => s.wykonczenie * 0.7 + s.wizja * 0.15 + s.szybkosc * 0.15;
export const keeperSkill = (s) => s.refleks * 0.55 + s.chwytanie * 0.45;

function gauss(rand) {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Strzał AI: gdzie faktycznie poleci piłka (im lepsze wykończenie, tym mniejszy rozrzut).
// Strzał gracza leci dokładnie w wybrany punkt.
export function ballLanding(target, shooter, rand) {
  const acc = shooter / (shooter + 30);
  const spread = 0.05 + 0.3 * (1 - acc);
  return { x: target.x + gauss(rand) * spread, y: target.y + gauss(rand) * spread * 0.8 };
}

// Zasięg bramkarza: lepszy bramkarz sięga dalej, mocniejszy strzał (lepszy strzelec) skraca
// jego zasięg, a strzały w okienko są najtrudniejsze do obrony.
export function shotPower(shooter) {
  return shooter / (shooter + 60);
}
// Zasięg rąk bramkarza w karnych jest taki sam dla wszystkich (statystyki bramkarskie nie mają tu
// wpływu): ok. 1,5 m od wybranego punktu. Skraca go siła strzału (umiejętności strzelca) i okienko.
export const KEEPER_REACH = 0.42;
export function keeperReach(keeper, ball, shooter = 0) {
  const base = KEEPER_REACH;
  const power = 1.12 - 0.4 * shotPower(shooter);
  const corner = Math.abs(ball.x) > 0.75 && ball.y > 0.65 ? 0.75 : 1;
  return base * power * corner;
}

// Rozstrzyga jeden strzał: "post" = słupek lub poprzeczka, "miss" = obok lub nad bramką.
export function resolveKick(ball, dive, keeper, shooter = 0) {
  const out = Math.abs(ball.x) > 1 || ball.y > 1 || ball.y < 0;
  if (out) {
    const nearPost = Math.abs(Math.abs(ball.x) - 1) < 0.06 && ball.y >= -0.02 && ball.y <= 1.04;
    const nearBar = Math.abs(ball.y - 1) < 0.06 && Math.abs(ball.x) <= 1.04;
    return nearPost || nearBar ? 'post' : 'miss';
  }
  const d = Math.hypot(ball.x - dive.x, (ball.y - dive.y) * 0.8);
  return d <= keeperReach(keeper, ball, shooter) ? 'save' : 'goal';
}

// Bramkarz AI wybiera, gdzie się rzucić (nie zna celu strzelca).
export function aiDive(rand) {
  const r = rand();
  const x = r < 0.4 ? -0.55 - rand() * 0.35 : r < 0.8 ? 0.55 + rand() * 0.35 : (rand() - 0.5) * 0.3;
  return { x, y: 0.15 + rand() * 0.65 };
}

// Strzelec AI wybiera cel (najczęściej blisko słupków).
export function aiAim(rand) {
  const side = rand() < 0.5 ? -1 : 1;
  const x = rand() < 0.8 ? side * (0.45 + rand() * 0.45) : (rand() - 0.5) * 0.6;
  return { x, y: 0.1 + rand() * 0.75 };
}

// Stan serii według prawdziwych zasad: strzały na przemian (zaczyna ten, kto wygrał losowanie),
// po 5 strzałów; seria kończy się wcześniej, gdy jedna strona nie może już dogonić drugiej;
// przy remisie po 5 grają dalej parami, aż w tej samej parze jeden trafi, a drugi nie.
export function penaltyStatus(st) {
  const first = st.first || 'my';
  const me = st.my.filter((k) => k === 'goal').length;
  const op = st.op.filter((k) => k === 'goal').length;
  let finished = false;
  if (st.my.length <= PENALTY_KICKS && st.op.length <= PENALTY_KICKS) {
    const myLeft = PENALTY_KICKS - st.my.length;
    const opLeft = PENALTY_KICKS - st.op.length;
    if (me + myLeft < op || op + opLeft < me) finished = true;
  } else if (st.my.length === st.op.length && me !== op) finished = true;
  if (st.my.length === PENALTY_KICKS && st.op.length === PENALTY_KICKS && me !== op) finished = true;
  if (st.my.length >= PENALTY_SAFETY && st.my.length === st.op.length) finished = true;
  let turn = null;
  if (!finished) {
    const even = st.my.length === st.op.length;
    turn = first === 'my' ? (even ? 'shoot' : 'save') : even ? 'save' : 'shoot';
  }
  return {
    me, op, finished, turn, first,
    suddenDeath: Math.min(st.my.length, st.op.length) >= PENALTY_KICKS,
    result: finished ? (me > op ? 'win' : me < op ? 'loss' : 'draw') : null,
  };
}
