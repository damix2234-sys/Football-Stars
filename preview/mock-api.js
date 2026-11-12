// Wersja podglądowa: ten sam interfejs co serwer (/api/...), ale cała gra działa
// w przeglądarce, a pozostali gracze to boty. Wymaga obiektu G (server/game.js).
(() => {
  const KEY = 'football-stars-preview-v3';
  const now = () => Date.now();
  let S = null; // stan gry, wczytywany na końcu pliku, gdy wszystkie funkcje są gotowe

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return seed();
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
    } catch {}
  }

  class GameError extends Error {}
  const fail = (m) => {
    throw new GameError(m);
  };
  const nextId = (k) => (S.seq[k] = (S.seq[k] || 0) + 1);

  // ---------- dane startowe: boty, kluby, czat ----------
  function seed() {
    S = { seq: {}, users: [], session: null, players: [], inventory: [], clubs: [], apps: [], matches: [], messages: [], notifications: [], autos: [], penalties: [], botTick: now() };
    const bots = [
      ['Marek Mur', 'OBR', 4], ['Tomek Rakieta', 'NAP', 6], ['Piotr Pajęczyna', 'BR', 5], ['Ola Rozgrywająca', 'POM', 3],
      ['Bartek Skała', 'OBR', 2], ['Zosia Zwinna', 'POM', 4], ['Kuba Kometa', 'NAP', 1], ['Igor Wieża', 'BR', 2],
      ['Natalia Strzała', 'NAP', 3], ['Leon Motorek', 'POM', 1], ['Ewa Tarcza', 'OBR', 1], ['Szymon Piorun', 'NAP', 7],
    ];
    for (const [name, pos, lvl] of bots) {
      const p = makePlayer(null, name, pos);
      p.bot = true;
      // umiejętności rosną z "doświadczeniem" bota, z lekką losowością
      for (const k of G.SPEC_KEYS) p.skills[k] += Math.floor((lvl - 1) * (2 + Math.random() * 3));
      p.ovr = G.ovr(p.skills);
      p.money = 400 + lvl * 100;
      p.last_seen = now() - Math.floor(Math.random() * 20) * 60000;
    }
    const byName = (n) => S.players.find((p) => p.name === n);
    const c1 = makeClub('Orły Północy', 'ORP', byName('Marek Mur'));
    const c2 = makeClub('Błękitni Rakiety', 'BLR', byName('Tomek Rakieta'));
    for (const n of ['Piotr Pajęczyna', 'Ola Rozgrywająca', 'Bartek Skała']) byName(n).club_id = c1.id;
    for (const n of ['Zosia Zwinna', 'Kuba Kometa', 'Igor Wieża', 'Szymon Piorun']) byName(n).club_id = c2.id;
    c1.description = 'Gramy twardo w obronie. Szukamy napastnika!';
    c2.description = 'Szybka piłka i dużo goli. Aktywni codziennie.';
    clubMatch(c2, c1, now() - 3 * 3600e3);
    for (let i = 0; i < 6; i++) {
      const bs = S.players.filter((p) => p.bot);
      const a = bs[Math.floor(Math.random() * bs.length)];
      const b = bs.filter((x) => x !== a)[Math.floor(Math.random() * (bs.length - 1))];
      autoPenalty(a, b, now() - (6 - i) * 1800e3);
    }
    say(byName('Tomek Rakieta'), 'Siema wszystkim! Kto na mecz?', now() - 40 * 60000);
    say(byName('Ola Rozgrywająca'), 'Ja chętnie, tylko poczekam na energię ⚡', now() - 38 * 60000);
    say(byName('Marek Mur'), 'Orły szukają napastnika, zgłaszajcie się 🦅', now() - 12 * 60000);
    return S;
  }

  function makePlayer(userId, name, position) {
    const skills = G.startingSkills(position);
    const p = {
      id: nextId('player'), user_id: userId, name, position, skills, ovr: G.ovr(skills), money: G.START_MONEY,
      energy: G.START_ENERGY, energy_updated: now(), training_progress: {}, last_train: 0, wins: 0, draws: 0, losses: 0, goals: 0,
      club_id: null, last_daily: 0, last_seen: now(), created_at: now(),
    };
    S.players.push(p);
    return p;
  }
  function makeClub(name, tag, owner) {
    const c = { id: nextId('club'), name, tag, owner_id: owner.id, treasury: 0, points: 0, wins: 0, draws: 0, losses: 0, last_match: 0, description: '', created_at: now() };
    S.clubs.push(c);
    owner.club_id = c.id;
    return c;
  }
  const say = (p, body, t = now()) => S.messages.push({ id: nextId('msg'), channel: 'global', player_id: p.id, body, created_at: t });
  const notify = (pid, body) => S.notifications.push({ id: nextId('notif'), player_id: pid, body, read: 0, created_at: now() });

  // ---------- pomocnicze ----------
  const player = (id) => {
    const p = S.players.find((x) => x.id === id);
    if (!p) return null;
    const e = G.currentEnergy(p.energy, p.energy_updated, now());
    p.energy = e.energy;
    p.energy_updated = e.updatedAt;
    settleAutos(p);
    return p;
  };
  // Rozlicza ukończone treningi automatyczne (jeden trening co 5 s).
  function settleAutos(p) {
    for (const j of S.autos.filter((a) => a.player_id === p.id)) {
      const completed = Math.min(j.count, Math.floor((now() - j.started_at) / G.TRAIN_COOLDOWN_MS));
      if (completed > j.done) {
        const r = G.applyTrainings(p.skills[j.spec], p.training_progress[j.spec] || 0, completed - j.done);
        p.skills[j.spec] = r.level;
        p.training_progress[j.spec] = r.progress;
        j.done = completed;
        p.ovr = G.ovr(p.skills);
      }
      if (completed >= j.count) {
        S.autos = S.autos.filter((a) => a !== j);
        notify(p.id, `Trening automatyczny „${G.SPECS[j.spec].name}” zakończony (${j.count} treningów).`);
      }
    }
  }
  const club = (id) => S.clubs.find((c) => c.id === id) || null;
  const baseStats = (p) => p.skills;
  const equippedIds = (pid) => S.inventory.filter((i) => i.player_id === pid && i.equipped).map((i) => i.item_id);
  const effStats = (p) => G.effectiveStats(baseStats(p), equippedIds(p.id));
  const members = (cid) => S.players.filter((p) => p.club_id === cid).sort((a, b) => b.ovr - a.ovr);
  const outcome = (a, b) => (a > b ? 'win' : a < b ? 'loss' : 'draw');
  const COL = { win: 'wins', draw: 'draws', loss: 'losses' };

  function spendEnergy(p, n) {
    if (p.energy < n) fail(`Za mało energii (potrzeba ${n}).`);
    p.energy -= n;
  }
  function publicPlayer(p) {
    const c = p.club_id ? club(p.club_id) : null;
    const stats = effStats(p);
    return {
      id: p.id, name: p.name, position: p.position, ovr: p.ovr, stats, overall: G.ovr(stats),
      wins: p.wins, draws: p.draws, losses: p.losses, goals: p.goals,
      club: c ? { id: c.id, name: c.name, tag: c.tag } : null,
      online: now() - p.last_seen < 5 * 60 * 1000,
    };
  }
  function saveMatch(kind, home, away, result, t = now()) {
    const m = { id: nextId('match'), kind, home_id: home.id, away_id: away.id, home_name: home.name, away_name: away.name, home_score: result.score[0], away_score: result.score[1], events: result.events, created_at: t };
    S.matches.push(m);
    return m;
  }
  const listMatch = ({ events, ...m }) => m;

  // ---------- pojedynki karnych ----------
  const KICK_TEXT = {
    goal: (who) => `${who} strzela i jest GOL!`,
    save: (who) => `${who} strzela, ale bramkarz broni.`,
    miss: (who) => `${who} strzela obok bramki.`,
    post: (who) => `${who} trafia w słupek!`,
  };
  // Jeden strzał w serii: gdy "my" strzelamy, cel podaje gracz; gdy bronimy, podaje miejsce rzutu.
  function penaltyKick(st, me, opp, input) {
    const status = G.penaltyStatus(st);
    const rand = G.rng(st.seed + st.kicks.length * 7919);
    let kick;
    if (status.turn === 'shoot') {
      const target = input || G.aiAim(rand);
      // strzał gracza leci dokładnie w wybrany punkt; w serii AI (input = null) cel ma rozrzut
      const ball = input ? { ...target } : G.ballLanding(target, G.shooterSkill(effStats(me)), rand);
      const dive = G.aiDive(rand);
      kick = { side: 'my', target, ball, dive, result: G.resolveKick(ball, dive, G.keeperSkill(effStats(opp)), G.shooterSkill(effStats(me))) };
      st.my.push(kick.result);
    } else {
      const aim = G.aiAim(rand);
      const ball = G.ballLanding(aim, G.shooterSkill(effStats(opp)), rand);
      const dive = input || G.aiDive(rand);
      kick = { side: 'op', target: aim, ball, dive, result: G.resolveKick(ball, dive, G.keeperSkill(effStats(me)), G.shooterSkill(effStats(opp))) };
      st.op.push(kick.result);
    }
    st.kicks.push(kick);
    return kick;
  }
  function finishPenalty(st, me, opp, t = now()) {
    const s = G.penaltyStatus(st);
    const events = st.kicks.map((k, i) => ({
      minute: i + 1, side: k.side === 'my' ? 0 : 1,
      type: k.result === 'goal' ? 'goal' : k.result === 'save' ? 'save' : 'miss',
      text: KICK_TEXT[k.result](k.side === 'my' ? me.name : opp.name),
    }));
    const m = { id: nextId('match'), kind: 'duel', penalty: true, home_id: me.id, away_id: opp.id, home_name: me.name, away_name: opp.name, home_score: s.me, away_score: s.op, events, created_at: t };
    S.matches.push(m);
    const oppRes = s.result === 'win' ? 'loss' : s.result === 'loss' ? 'win' : 'draw';
    const myRew = G.duelRewards(s.result, me.ovr);
    const oppRew = G.duelRewards(oppRes, opp.ovr);
    me.money += myRew.money; me[COL[s.result]]++; me.goals += s.me;
    opp.money += Math.floor(oppRew.money / 2); opp[COL[oppRes]]++; opp.goals += s.op;
    notify(opp.id, `${me.name} wyzwał Cię na pojedynek karnych. Wynik: ${s.me}:${s.op}.`);
    return { money: myRew.money, matchId: m.id };
  }
  // Pojedynek rozgrywany w całości przez AI (boty między sobą lub bot wyzywa gracza).
  function autoPenalty(me, opp, t = now()) {
    const st = { seed: Math.floor(Math.random() * 2 ** 31), my: [], op: [], kicks: [], first: Math.random() < 0.5 ? 'my' : 'op' };
    while (!G.penaltyStatus(st).finished) penaltyKick(st, me, opp, null);
    return finishPenalty(st, me, opp, t);
  }

  function clubMatch(home, away, t = now()) {
    const team = (c) => {
      const ms = members(c.id).slice(0, 11).map((m) => ({ name: m.name, position: m.position, stats: effStats(m), p: m }));
      return { ms, side: G.teamSide(c.name, ms) };
    };
    const h = team(home);
    const a = team(away);
    if (h.ms.length < 3) fail('Potrzebujesz min. 3 zawodników w klubie.');
    if (a.ms.length < 3) fail('Rywal ma za mało zawodników.');
    const result = G.simulate(h.side, a.side, Math.floor(Math.random() * 2 ** 31), 20);
    const m = saveMatch('club', home, away, result, t);
    const [hs, as] = result.score;
    const settle = (c, tm, res) => {
      const rew = G.clubMatchRewards(res);
      c.points += rew.points;
      c.treasury += rew.treasury;
      c[COL[res]]++;
      for (const x of tm.ms) {
        x.p.money += rew.money;
        notify(x.p.id, `Mecz klubowy ${home.name} vs ${away.name}: ${hs}:${as}.`);
      }
    };
    settle(home, h, outcome(hs, as));
    settle(away, a, outcome(as, hs));
    home.last_match = t;
    return m;
  }

  // ---------- życie botów (wywoływane przy każdym zapytaniu) ----------
  const BOT_LINES = [
    'Ktoś ma pomysł, co trenować na początku?', 'Właśnie przebiłem 300 OVR 🎉', 'Dobry mecz wczoraj!',
    'Szukam klubu, gram na pomocy.', 'Szybkość to podstawa 😎', 'Kto zagra mecz?', 'Rękawice „Pewny chwyt” robią robotę.',
    'Gramy dziś mecz klubowy, trzymajcie kciuki!',
  ];
  function botLife() {
    const me = S.session ? S.players.find((p) => p.user_id === S.session) : null;
    const bots = S.players.filter((p) => p.bot);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // co ok. 2 minuty coś się dzieje (maks. ostatnia godzina)
    if (now() - S.botTick > 3600e3) S.botTick = now() - 3600e3;
    while (now() - S.botTick > 120000) {
      S.botTick += 120000;
      const b = pick(bots);
      b.last_seen = S.botTick;
      const r = Math.random();
      if (r < 0.3) say(b, pick(BOT_LINES), S.botTick);
      else if (r < 0.55 && me && G.inDuelRange(b.ovr, me.ovr)) autoPenalty(b, me, S.botTick);
      else if (r < 0.8) {
        for (const k of G.SPEC_KEYS) if (Math.random() < 0.2) b.skills[k]++;
        b.ovr = G.ovr(b.skills);
      } else if (me?.club_id) {
        const c = club(me.club_id);
        if (c.owner_id === me.id) {
          const free = bots.filter((x) => !x.club_id && !S.apps.some((a) => a.player_id === x.id));
          if (free.length) {
            const x = pick(free);
            S.apps.push({ club_id: c.id, player_id: x.id, created_at: S.botTick });
            notify(me.id, `${x.name} chce dołączyć do klubu ${c.name}.`);
          }
        }
      }
    }
    // boty zawsze trochę widoczne online
    for (const b of bots.slice(0, 4)) if (Math.random() < 0.2) b.last_seen = now();
  }

  // ---------- trasy ----------
  const R = {};
  const get = (p, fn) => (R['GET ' + p] = fn);
  const post = (p, fn) => (R['POST ' + p] = fn);
  const me = () => {
    const p = S.session && S.players.find((x) => x.user_id === S.session);
    if (!S.session) fail('Zaloguj się.');
    if (!p) fail('Najpierw stwórz piłkarza.');
    p.last_seen = now();
    return player(p.id);
  };

  post('/register', (b) => {
    const login = String(b.login || '').trim();
    if (!/^[\p{L}\d_]{3,20}$/u.test(login)) fail('Login musi mieć od 3 do 20 znaków (litery, cyfry, _).');
    if (String(b.password || '').length < 6) fail('Hasło musi mieć min. 6 znaków.');
    if (S.users.some((u) => u.login.toLowerCase() === login.toLowerCase())) fail('Login jest zajęty.');
    const u = { id: nextId('user'), login, password: String(b.password) };
    S.users.push(u);
    S.session = u.id;
  });
  post('/login', (b) => {
    const u = S.users.find((x) => x.login.toLowerCase() === String(b.login || '').trim().toLowerCase());
    if (!u || u.password !== String(b.password || '')) fail('Zły login lub hasło.');
    S.session = u.id;
  });
  post('/logout', () => {
    S.session = null;
  });
  get('/public/stats', () => ({
    players: S.players.length,
    clubs: S.clubs.length,
    matches: S.matches.length,
    online: S.players.filter((p) => now() - p.last_seen < 5 * 60 * 1000).length,
  }));
  get('/public/recent', () => ({
    matches: S.matches.slice(-12).reverse().map(({ home_name, away_name, home_score, away_score }) => ({ home_name, away_name, home_score, away_score })),
  }));
  get('/public/top', () => ({
    players: [...S.players].sort((a, b) => b.ovr - a.ovr).slice(0, 5).map((p) => publicPlayer(p)),
    clubs: [...S.clubs].sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, 5).map(clubRow),
  }));
  get('/config', () => ({
    positions: G.POSITIONS, stats: G.STATS, slots: G.SLOTS, items: G.ITEMS, 
    energyRegenMs: G.ENERGY_REGEN_MS, categories: G.CATEGORIES, trainCooldownMs: G.TRAIN_COOLDOWN_MS,
    autoMaxHours: G.AUTO_MAX_HOURS, autoMaxActive: G.AUTO_MAX_ACTIVE, duelEnergy: G.PENALTY_ENERGY, penaltyKicks: G.PENALTY_KICKS,
    clubCreateCost: G.CLUB_CREATE_COST, clubMaxMembers: G.CLUB_MAX_MEMBERS, duelOvrRatio: G.DUEL_OVR_RATIO,
  }));
  post('/player', (b) => {
    if (!S.session) fail('Zaloguj się.');
    if (S.players.some((p) => p.user_id === S.session)) fail('Masz już piłkarza.');
    const name = String(b.name || '').trim();
    if (!/^[\p{L}][\p{L}\d .'-]{2,23}$/u.test(name)) fail('Nazwa piłkarza musi mieć od 3 do 24 znaków i zaczynać się literą.');
    if (!G.POSITIONS[b.position]) fail('Wybierz pozycję.');
    if (S.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail('Ta nazwa jest zajęta.');
    const p = makePlayer(S.session, name, b.position);
    notify(p.id, 'Witaj w Football Stars! Zacznij od treningu, a potem zagraj pierwszy mecz.');
  });
  get('/me', () => {
    if (!S.session) return { user: null };
    const u = S.users.find((x) => x.id === S.session);
    const user = { id: u.id, login: u.login };
    const raw = S.players.find((p) => p.user_id === S.session);
    if (!raw) return { user, player: null };
    const p = me();
    const base = baseStats(p);
    const c = p.club_id ? club(p.club_id) : null;
    return {
      user,
      player: {
        ...publicPlayer(p), baseStats: base,
        training: trainingState(p),
        money: p.money, energy: p.energy, energyUpdated: p.energy_updated, form: 100,
        dailyReadyAt: p.last_daily + G.DAILY_BONUS_MS, dailyAmount: G.dailyBonusAmount(p.ovr),
        clubRole: c ? (c.owner_id === p.id ? 'owner' : 'member') : null,
        unread: S.notifications.filter((n) => n.player_id === p.id && !n.read).length,
      },
      serverTime: now(),
    };
  });
  get('/players/:id', (b, id) => {
    me();
    const p = player(id);
    if (!p) fail('Nie ma takiego piłkarza.');
    const matches = S.matches.filter((m) => m.kind === 'duel' && (m.home_id === p.id || m.away_id === p.id)).slice(-10).reverse().map(listMatch);
    return { player: publicPlayer(p), matches };
  });
  function trainingState(p) {
    return {
      specs: Object.fromEntries(G.SPEC_KEYS.map((k) => [k, {
        level: p.skills[k], progress: p.training_progress[k] || 0, needed: G.trainingsNeeded(p.skills[k]), cost: G.trainCost(p.skills[k]),
      }])),
      categories: Object.fromEntries(G.CATEGORIES.map((c) => [c.id, G.categoryOvr(p.skills, c.id)])),
      readyAt: p.last_train + G.TRAIN_COOLDOWN_MS,
      autos: S.autos.filter((j) => j.player_id === p.id).map((j) => ({
        spec: j.spec, count: j.count, done: j.done, endsAt: j.started_at + j.count * G.TRAIN_COOLDOWN_MS,
      })),
    };
  }
  const specOf = (b) => {
    if (!G.SPECS[b.spec]) fail('Nieznana specjalizacja.');
    return b.spec;
  };
  const hoursOf = (b) => {
    const h = Number(b.hours);
    if (!(h > 0) || h > G.AUTO_MAX_HOURS) fail(`Wybierz od 5 minut do ${G.AUTO_MAX_HOURS} godzin.`);
    return h;
  };
  post('/train', (b) => {
    const p = me();
    const spec = specOf(b);
    if (now() < p.last_train + G.TRAIN_COOLDOWN_MS) fail('Odpocznij chwilę. Trenować można co 5 sekund.');
    if (S.autos.some((j) => j.player_id === p.id && j.spec === spec)) fail('Ta specjalizacja trenuje teraz automatycznie.');
    const cost = G.trainCost(p.skills[spec]);
    if (p.money < cost.money) fail(`Trening kosztuje ${cost.money} monet.`);
    spendEnergy(p, cost.energy);
    p.money -= cost.money;
    const r = G.applyTrainings(p.skills[spec], p.training_progress[spec] || 0, 1);
    p.skills[spec] = r.level;
    p.training_progress[spec] = r.progress;
    p.ovr = G.ovr(p.skills);
    p.last_train = now();
    return {
      message: r.gained
        ? `${G.SPECS[spec].name} wzrasta do ${r.level}! OVR: ${p.ovr}`
        : `Trening zaliczony (${r.progress}/${G.trainingsNeeded(r.level)}).`,
    };
  });
  post('/auto/plan', (b) => {
    const p = me();
    const spec = specOf(b);
    return {
      money: p.money,
      energy: p.energy,
      options: G.AUTO_OPTIONS.map((h) => G.planAuto(p.skills[spec], p.training_progress[spec] || 0, p.energy, p.money, h)),
    };
  });
  post('/auto/start', (b) => {
    const p = me();
    const spec = specOf(b);
    const hours = hoursOf(b);
    if (S.autos.some((j) => j.player_id === p.id && j.spec === spec)) fail('Ta specjalizacja już trenuje automatycznie.');
    if (S.autos.filter((j) => j.player_id === p.id).length >= G.AUTO_MAX_ACTIVE)
      fail(`Możesz mieć najwyżej ${G.AUTO_MAX_ACTIVE} treningi automatyczne naraz.`);
    const plan = G.planAuto(p.skills[spec], p.training_progress[spec] || 0, p.energy, p.money, hours);
    if (plan.missingMoney > 0 && plan.missingEnergy > 0)
      fail(`Za mało monet i energii. Brakuje ${plan.missingMoney} monet i ${plan.missingEnergy} energii.`);
    if (plan.missingMoney > 0) fail(`Za mało monet. Potrzebujesz ${plan.money}, masz ${p.money}.`);
    if (plan.missingEnergy > 0) fail(`Za mało energii. Potrzebujesz ${plan.energy}, masz ${p.energy}.`);
    spendEnergy(p, plan.energy);
    p.money -= plan.money;
    S.autos.push({ player_id: p.id, spec, started_at: now(), count: plan.count, done: 0, energy_total: plan.energy, money_total: plan.money });
    return { message: `Trening automatyczny ruszył: ${plan.count} treningów „${G.SPECS[spec].name}”.` };
  });
  post('/auto/cancel', (b) => {
    const p = me();
    const spec = specOf(b);
    const j = S.autos.find((x) => x.player_id === p.id && x.spec === spec);
    if (!j) fail('Brak aktywnego treningu automatycznego.');
    const left = j.count - j.done;
    const energyBack = Math.floor((j.energy_total * left) / j.count);
    const moneyBack = Math.floor((j.money_total * left) / j.count);
    S.autos = S.autos.filter((x) => x !== j);
    p.money += moneyBack;
    p.energy += energyBack;
    return { message: `Anulowano. Zwrot: ${moneyBack} monet i ${energyBack} energii.` };
  });
  post('/daily-bonus', () => {
    const p = me();
    if (now() < p.last_daily + G.DAILY_BONUS_MS) fail('Premię dzienną już odebrałeś.');
    const amount = G.dailyBonusAmount(p.ovr);
    p.money += amount;
    p.last_daily = now();
    return { message: `Odebrano premię: ${amount} monet.` };
  });
  get('/inventory', () => {
    const p = me();
    return { items: S.inventory.filter((i) => i.player_id === p.id) };
  });
  const equip = (pid, itemId) => {
    const slot = G.ITEMS_BY_ID[itemId].slot;
    for (const i of S.inventory) if (i.player_id === pid && G.ITEMS_BY_ID[i.item_id].slot === slot) i.equipped = i.item_id === itemId ? 1 : 0;
  };
  post('/shop/buy', (b) => {
    const p = me();
    const item = G.ITEMS_BY_ID[b.itemId];
    if (!item) fail('Nie ma takiego przedmiotu.');
    if (p.ovr < item.ovr) fail(`Wymagany OVR ${item.ovr}.`);
    if (p.money < item.price) fail('Za mało monet.');
    if (S.inventory.some((i) => i.player_id === p.id && i.item_id === item.id)) fail('Masz już ten przedmiot.');
    p.money -= item.price;
    S.inventory.push({ player_id: p.id, item_id: item.id, equipped: 0 });
    equip(p.id, item.id);
    return { message: `Kupiono: ${item.name}.` };
  });
  post('/inventory/equip', (b) => {
    const p = me();
    if (!S.inventory.some((i) => i.player_id === p.id && i.item_id === b.itemId)) fail('Nie masz tego przedmiotu.');
    equip(p.id, b.itemId);
  });
  get('/opponents', () => {
    const p = me();
    const opponents = S.players
      .filter((o) => o.id !== p.id && G.inDuelRange(o.ovr, p.ovr))
      .sort((a, b) => b.last_seen - a.last_seen)
      .slice(0, 30)
      .map((o) => publicPlayer(player(o.id)));
    return { opponents };
  });
  const penaltyView = (d) => {
    const o = player(d.opponent_id);
    return { id: d.id, opponent: { id: o.id, name: o.name, position: o.position, ovr: o.ovr }, my: d.my, op: d.op, kicks: d.kicks, first: d.first, status: G.penaltyStatus(d) };
  };
  get('/penalty/current', () => {
    const p = me();
    const d = S.penalties.find((x) => x.player_id === p.id && !x.finished);
    return { duel: d ? penaltyView(d) : null };
  });
  post('/penalty/start', (b) => {
    const p = me();
    const open = S.penalties.find((x) => x.player_id === p.id && !x.finished);
    if (open) return { duel: penaltyView(open) };
    const opp = player(Number(b.opponentId));
    if (!opp || opp.id === p.id) fail('Nieprawidłowy rywal.');
    if (!G.inDuelRange(p.ovr, opp.ovr)) fail('Rywal jest za mocny albo za słaby (OVR różni się więcej niż 1,5 raza).');
    spendEnergy(p, G.PENALTY_ENERGY);
    const d = { id: nextId('penalty'), player_id: p.id, opponent_id: opp.id, seed: Math.floor(Math.random() * 2 ** 31), my: [], op: [], kicks: [], first: Math.random() < 0.5 ? 'my' : 'op', finished: false };
    S.penalties.push(d);
    return { duel: penaltyView(d) };
  });
  post('/penalty/:id/kick', (b, id) => {
    const p = me();
    const d = S.penalties.find((x) => x.id === id && x.player_id === p.id && !x.finished);
    if (!d) fail('Ten pojedynek już się zakończył.');
    const opp = player(d.opponent_id);
    const input = { x: Math.max(-1.4, Math.min(1.4, Number(b.x) || 0)), y: Math.max(-0.3, Math.min(1.4, Number(b.y) || 0)) };
    const kick = penaltyKick(d, p, opp, input);
    const status = G.penaltyStatus(d);
    let reward = null;
    if (status.finished) {
      d.finished = true;
      reward = finishPenalty(d, p, opp);
      S.penalties = S.penalties.filter((x) => x !== d);
    }
    return { kick, status, my: d.my, op: d.op, reward };
  });
  get('/matches/:id', (b, id) => {
    me();
    const m = S.matches.find((x) => x.id === id);
    if (!m) fail('Nie ma takiego meczu.');
    return { match: { ...m, penalty: !!m.penalty } };
  });
  get('/my-matches', () => {
    const p = me();
    return { matches: S.matches.filter((m) => m.kind === 'duel' && (m.home_id === p.id || m.away_id === p.id)).slice(-20).reverse().map(listMatch) };
  });
  get('/ranking/players', () => {
    me();
    return { players: [...S.players].sort((a, b) => b.ovr - a.ovr).map((p) => publicPlayer(p)) };
  });
  const clubRow = (c) => ({ id: c.id, name: c.name, tag: c.tag, points: c.points, wins: c.wins, draws: c.draws, losses: c.losses, members: members(c.id).length });
  get('/ranking/clubs', () => {
    me();
    return { clubs: [...S.clubs].sort((a, b) => b.points - a.points || b.wins - a.wins).map(clubRow) };
  });
  get('/clubs', () => {
    me();
    return { clubs: [...S.clubs].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).map(clubRow) };
  });
  post('/clubs', (b) => {
    const p = me();
    if (p.club_id) fail('Jesteś już w klubie.');
    const name = String(b.name || '').trim();
    const tag = String(b.tag || '').trim().toUpperCase();
    if (!/^[\p{L}\d][\p{L}\d .'-]{2,29}$/u.test(name)) fail('Nazwa klubu musi mieć od 3 do 30 znaków.');
    if (!/^[A-Z0-9]{2,4}$/.test(tag)) fail('Skrót klubu to od 2 do 4 liter lub cyfr.');
    if (p.money < G.CLUB_CREATE_COST) fail(`Założenie klubu kosztuje ${G.CLUB_CREATE_COST} monet.`);
    if (S.clubs.some((c) => c.name.toLowerCase() === name.toLowerCase() || c.tag === tag)) fail('Nazwa lub skrót są zajęte.');
    p.money -= G.CLUB_CREATE_COST;
    const c = makeClub(name, tag, p);
    S.apps = S.apps.filter((a) => a.player_id !== p.id);
    return { clubId: c.id };
  });
  get('/clubs/:id', (b, id) => {
    const p = me();
    const c = club(id);
    if (!c) fail('Nie ma takiego klubu.');
    const isMember = p.club_id === c.id;
    const isOwner = c.owner_id === p.id;
    const ms = members(c.id).map((m) => publicPlayer(m));
    return {
      club: {
        id: c.id, name: c.name, tag: c.tag, ownerId: c.owner_id, points: c.points, wins: c.wins, draws: c.draws, losses: c.losses,
        description: c.description, treasury: isMember ? c.treasury : null, nextMatchAt: c.last_match + G.CLUB_MATCH_COOLDOWN_MS,
        strength: ms.length ? Math.round(ms.reduce((s, m) => s + m.overall, 0) / ms.length) : 0,
      },
      members: ms, isMember, isOwner,
      applied: S.apps.some((a) => a.club_id === c.id && a.player_id === p.id),
      applications: isOwner
        ? S.apps.filter((a) => a.club_id === c.id).map((a) => {
            const x = player(a.player_id);
            return { id: x.id, name: x.name, ovr: x.ovr, position: x.position };
          })
        : [],
      matches: S.matches.filter((m) => m.kind === 'club' && (m.home_id === c.id || m.away_id === c.id)).slice(-10).reverse().map(listMatch),
    };
  });
  post('/clubs/:id/apply', (b, id) => {
    const p = me();
    const c = club(id);
    if (!c) fail('Nie ma takiego klubu.');
    if (p.club_id) fail('Jesteś już w klubie.');
    const owner = player(c.owner_id);
    if (owner.bot) {
      // prezes-bot od razu odpowiada
      if (members(c.id).length >= G.CLUB_MAX_MEMBERS) fail('Klub jest pełny.');
      p.club_id = c.id;
      S.apps = S.apps.filter((a) => a.player_id !== p.id);
      notify(p.id, `Zostałeś przyjęty do klubu ${c.name}!`);
      return { message: `Prezes ${owner.name} przyjął Cię do klubu!` };
    }
    if (!S.apps.some((a) => a.club_id === c.id && a.player_id === p.id)) S.apps.push({ club_id: c.id, player_id: p.id, created_at: now() });
    return { message: 'Wysłano zgłoszenie.' };
  });
  const requireOwner = () => {
    const p = me();
    const c = p.club_id ? club(p.club_id) : null;
    if (!c || c.owner_id !== p.id) fail('Tylko prezes klubu może to zrobić.');
    return { p, c };
  };
  post('/clubs/applications/:id', (b, pid) => {
    const { c } = requireOwner();
    if (!S.apps.some((a) => a.club_id === c.id && a.player_id === pid)) fail('Brak takiego zgłoszenia.');
    S.apps = S.apps.filter((a) => !(a.club_id === c.id && a.player_id === pid));
    if (b.accept) {
      const t = player(pid);
      if (t.club_id) fail('Ten gracz jest już w innym klubie.');
      if (members(c.id).length >= G.CLUB_MAX_MEMBERS) fail('Klub jest pełny.');
      t.club_id = c.id;
      S.apps = S.apps.filter((a) => a.player_id !== pid);
      notify(pid, `Zostałeś przyjęty do klubu ${c.name}!`);
    }
  });
  post('/clubs/kick/:id', (b, pid) => {
    const { p, c } = requireOwner();
    if (pid === p.id) fail('Nie możesz wyrzucić siebie.');
    const t = player(pid);
    if (!t || t.club_id !== c.id) fail('Ten gracz nie jest w Twoim klubie.');
    t.club_id = null;
    notify(pid, `Zostałeś usunięty z klubu ${c.name}.`);
  });
  post('/clubs/leave', () => {
    const p = me();
    if (!p.club_id) fail('Nie jesteś w klubie.');
    const c = club(p.club_id);
    p.club_id = null;
    if (c.owner_id === p.id) {
      const next = members(c.id)[0];
      if (next) c.owner_id = next.id;
      else {
        S.clubs = S.clubs.filter((x) => x.id !== c.id);
        S.messages = S.messages.filter((m) => m.channel !== `club:${c.id}`);
      }
    }
  });
  post('/clubs/donate', (b) => {
    const p = me();
    const amount = Math.floor(Number(b.amount));
    if (!p.club_id) fail('Nie jesteś w klubie.');
    if (!(amount > 0)) fail('Podaj kwotę.');
    if (p.money < amount) fail('Za mało monet.');
    p.money -= amount;
    club(p.club_id).treasury += amount;
    return { message: `Wpłacono ${amount} monet do kasy klubu.` };
  });
  post('/clubs/description', (b) => {
    const { c } = requireOwner();
    c.description = String(b.description || '').slice(0, 500);
  });
  post('/clubs/challenge/:id', (b, id) => {
    const { c } = requireOwner();
    const opp = club(id);
    if (!opp || opp.id === c.id) fail('Nieprawidłowy rywal.');
    if (now() < c.last_match + G.CLUB_MATCH_COOLDOWN_MS) fail('Twój klub musi odpocząć przed kolejnym meczem.');
    const m = clubMatch(c, opp);
    return { matchId: m.id, score: [m.home_score, m.away_score] };
  });
  const channel = (name) => {
    if (name === 'global') return 'global';
    const p = me();
    if (name === 'club' && p.club_id) return `club:${p.club_id}`;
    fail('Nie jesteś w klubie.');
  };
  get('/chat/:ch', (b, ch, query) => {
    me();
    const c = channel(ch);
    const after = Number(query.after) || 0;
    const rows = S.messages.filter((m) => m.channel === c && m.id > after).slice(-50);
    return { messages: rows.map((m) => ({ ...m, name: S.players.find((p) => p.id === m.player_id)?.name || '?' })) };
  });
  post('/chat/:ch', (b, ch) => {
    const p = me();
    const c = channel(ch);
    const body = String(b.body || '').trim().slice(0, 300);
    if (!body) fail('Pusta wiadomość.');
    S.messages.push({ id: nextId('msg'), channel: c, player_id: p.id, body, created_at: now() });
    // czasem ktoś odpowiada
    if (c === 'global' && Math.random() < 0.5) {
      const bot = S.players.filter((x) => x.bot)[Math.floor(Math.random() * 12)];
      setTimeout(() => {
        say(bot, ['Hej! 👋', 'Dawaj na sparing!', 'Zgadzam się 😄', 'Powodzenia w treningu!', 'Haha, dobre'][Math.floor(Math.random() * 5)]);
        save();
      }, 2500);
    }
  });
  get('/notifications', () => {
    const p = me();
    const rows = S.notifications.filter((n) => n.player_id === p.id).slice(-50).reverse().map((n) => ({ ...n }));
    for (const n of S.notifications) if (n.player_id === p.id) n.read = 1;
    return { notifications: rows };
  });
  // Tylko w podglądzie – ułatwienia do testów.
  post('/preview/refill', () => {
    const p = me();
    p.energy += 500;
    return { message: 'Dodano 500 energii (tryb testowy).' };
  });
  post('/preview/money', () => {
    const p = me();
    p.money += 5000;
    return { message: 'Dodano 5000 monet (tryb testowy).' };
  });
  post('/preview/reset', () => {
    S = seed();
  });

  S = load();

  // Dopasowanie ścieżki do trasy.
  window.FS_API = async (fullPath, body) => {
    const method = body === undefined ? 'GET' : 'POST';
    const [path, qs] = fullPath.split('?');
    const query = Object.fromEntries(new URLSearchParams(qs || ''));
    const parts = path.split('/').filter(Boolean);
    for (const [key, fn] of Object.entries(R)) {
      const [m, pattern] = key.split(' ');
      if (m !== method) continue;
      const pp = pattern.split('/').filter(Boolean);
      if (pp.length !== parts.length) continue;
      const params = [];
      if (!pp.every((seg, i) => (seg.startsWith(':') ? (params.push(/^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]), true) : seg === parts[i]))) continue;
      try {
        if (S.session) botLife();
        const r = fn(body || {}, ...params, query);
        save();
        return r ?? { ok: true };
      } catch (e) {
        save();
        if (e instanceof GameError) throw e;
        console.error(e);
        throw new Error('Błąd gry.');
      }
    }
    throw new Error('Nie znaleziono.');
  };
})();
