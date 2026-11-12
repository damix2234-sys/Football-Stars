// Wersja podglądowa: ten sam interfejs co serwer (/api/...), ale cała gra działa
// w przeglądarce, a pozostali gracze to boty. Wymaga obiektu G (server/game.js).
(() => {
  const KEY = 'football-stars-preview-v1';
  const now = () => Date.now();
  let S = null; // stan gry – wczytywany na końcu pliku, gdy wszystkie funkcje są gotowe

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
    S = { seq: {}, users: [], session: null, players: [], inventory: [], clubs: [], apps: [], matches: [], messages: [], notifications: [], botTick: now() };
    const bots = [
      ['Marek Mur', 'OBR', 4], ['Tomek Rakieta', 'NAP', 6], ['Piotr Pajęczyna', 'BR', 5], ['Ola Rozgrywająca', 'POM', 3],
      ['Bartek Skała', 'OBR', 2], ['Zosia Zwinna', 'POM', 4], ['Kuba Kometa', 'NAP', 1], ['Igor Wieża', 'BR', 2],
      ['Natalia Strzała', 'NAP', 3], ['Leon Motorek', 'POM', 1], ['Ewa Tarcza', 'OBR', 1], ['Szymon Piorun', 'NAP', 7],
    ];
    for (const [name, pos, lvl] of bots) {
      const p = makePlayer(null, name, pos);
      p.bot = true;
      p.level = lvl;
      // statystyki rosną z poziomem, z lekką losowością
      for (const k of G.STAT_KEYS) p[k] += Math.floor((lvl - 1) * (1.2 + Math.random()));
      p.money = 200 + lvl * 50;
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
      duel(a, b, now() - (6 - i) * 1800e3);
    }
    say(byName('Tomek Rakieta'), 'Siema wszystkim! Kto na sparing?', now() - 40 * 60000);
    say(byName('Ola Rozgrywająca'), 'Ja chętnie, tylko poczekam na energię ⚡', now() - 38 * 60000);
    say(byName('Marek Mur'), 'Orły szukają napastnika, zgłaszajcie się 🦅', now() - 12 * 60000);
    return S;
  }

  function makePlayer(userId, name, position) {
    const s = G.startingStats(position);
    const p = {
      id: nextId('player'), user_id: userId, name, position, level: 1, xp: 0, money: 300,
      energy: G.ENERGY_MAX, energy_updated: now(), training_progress: {}, wins: 0, draws: 0, losses: 0, goals: 0,
      club_id: null, last_daily: 0, last_seen: now(), created_at: now(), ...s,
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
    return p;
  };
  const club = (id) => S.clubs.find((c) => c.id === id) || null;
  const baseStats = (p) => Object.fromEntries(G.STAT_KEYS.map((k) => [k, p[k]]));
  const equippedIds = (pid) => S.inventory.filter((i) => i.player_id === pid && i.equipped).map((i) => i.item_id);
  const effStats = (p) => G.effectiveStats(baseStats(p), equippedIds(p.id));
  const members = (cid) => S.players.filter((p) => p.club_id === cid).sort((a, b) => b.level - a.level);
  const outcome = (a, b) => (a > b ? 'win' : a < b ? 'loss' : 'draw');
  const COL = { win: 'wins', draw: 'draws', loss: 'losses' };

  function spendEnergy(p, n) {
    if (p.energy < n) fail(`Za mało energii (potrzeba ${n}).`);
    if (p.energy >= G.ENERGY_MAX) p.energy_updated = now();
    p.energy -= n;
  }
  function grantXp(p, gained) {
    const r = G.addXp(p.level, p.xp, gained);
    p.level = r.level;
    p.xp = r.xp;
    if (r.levelsUp > 0) {
      const bonus = 100 * r.levelsUp;
      p.money += bonus;
      p.energy = G.ENERGY_MAX;
      p.energy_updated = now();
      notify(p.id, `Awans na poziom ${r.level}! Otrzymujesz ${bonus} monet i pełną energię.`);
    }
    return r;
  }
  function publicPlayer(p) {
    const c = p.club_id ? club(p.club_id) : null;
    const stats = effStats(p);
    return {
      id: p.id, name: p.name, position: p.position, level: p.level, stats, overall: G.overall(stats),
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

  function duel(me, opp, t = now()) {
    const result = G.simulate(G.playerSide(me.name, effStats(me)), G.playerSide(opp.name, effStats(opp)), Math.floor(Math.random() * 2 ** 31));
    const m = saveMatch('duel', me, opp, result, t);
    const [gs, ga] = result.score;
    const myRes = outcome(gs, ga);
    const oppRes = outcome(ga, gs);
    const myRew = G.duelRewards(myRes, me.level);
    const oppRew = G.duelRewards(oppRes, opp.level);
    me.money += myRew.money;
    me[COL[myRes]]++;
    me.goals += gs;
    opp.money += Math.floor(oppRew.money / 2);
    opp[COL[oppRes]]++;
    opp.goals += ga;
    const lvl = grantXp(me, myRew.xp);
    notify(opp.id, `${me.name} wyzwał Cię na sparing. Wynik: ${gs}:${ga}.`);
    return { m, myRew, lvl };
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
        grantXp(x.p, rew.xp);
        notify(x.p.id, `Mecz klubowy ${home.name} – ${away.name}: ${hs}:${as}.`);
      }
    };
    settle(home, h, outcome(hs, as));
    settle(away, a, outcome(as, hs));
    home.last_match = t;
    return m;
  }

  // ---------- życie botów (wywoływane przy każdym zapytaniu) ----------
  const BOT_LINES = [
    'Ktoś ma pomysł, co trenować na początku?', 'Właśnie wbiłem nowy poziom 🎉', 'Dobry mecz wczoraj!',
    'Szukam klubu, gram na pomocy.', 'Szybkość to podstawa 😎', 'Kto zagra sparing?', 'Rękawice „Pewny chwyt” robią robotę.',
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
      else if (r < 0.55 && me && Math.abs(b.level - me.level) <= G.DUEL_LEVEL_RANGE) duel(b, me, S.botTick);
      else if (r < 0.8) {
        for (const k of G.STAT_KEYS) if (Math.random() < 0.15) b[k]++;
        grantXp(b, 20);
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
    if (!/^[\p{L}\d_]{3,20}$/u.test(login)) fail('Login: 3–20 znaków (litery, cyfry, _).');
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
  get('/public/top', () => ({
    players: [...S.players].sort((a, b) => b.level - a.level || b.xp - a.xp).slice(0, 5).map((p) => publicPlayer(p)),
    clubs: [...S.clubs].sort((a, b) => b.points - a.points || b.wins - a.wins).slice(0, 5).map(clubRow),
  }));
  get('/config', () => ({
    positions: G.POSITIONS, stats: G.STATS, slots: G.SLOTS, items: G.ITEMS, energyMax: G.ENERGY_MAX,
    energyRegenMs: G.ENERGY_REGEN_MS, trainingEnergy: G.TRAINING_ENERGY, duelEnergy: G.DUEL_ENERGY,
    clubCreateCost: G.CLUB_CREATE_COST, clubMaxMembers: G.CLUB_MAX_MEMBERS, duelLevelRange: G.DUEL_LEVEL_RANGE,
  }));
  post('/player', (b) => {
    if (!S.session) fail('Zaloguj się.');
    if (S.players.some((p) => p.user_id === S.session)) fail('Masz już piłkarza.');
    const name = String(b.name || '').trim();
    if (!/^[\p{L}][\p{L}\d .'-]{2,23}$/u.test(name)) fail('Nazwa piłkarza: 3–24 znaki, zaczyna się literą.');
    if (!G.POSITIONS[b.position]) fail('Wybierz pozycję.');
    if (S.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail('Ta nazwa jest zajęta.');
    const p = makePlayer(S.session, name, b.position);
    notify(p.id, 'Witaj w Football Stars! Zacznij od treningu, a potem zagraj pierwszy sparing.');
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
        training: Object.fromEntries(G.STAT_KEYS.map((k) => [k, { progress: p.training_progress[k] || 0, needed: G.trainingsNeeded(base[k]), cost: G.trainingCost(base[k]) }])),
        xp: p.xp, xpNext: G.xpForNextLevel(p.level), money: p.money, energy: p.energy, energyUpdated: p.energy_updated,
        dailyReadyAt: p.last_daily + G.DAILY_BONUS_MS, dailyAmount: G.dailyBonusAmount(p.level),
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
  post('/train', (b) => {
    const p = me();
    const stat = String(b.stat || '');
    if (!G.STATS[stat]) fail('Nieznana statystyka.');
    const cost = G.trainingCost(p[stat]);
    if (p.money < cost) fail(`Trening kosztuje ${cost} monet.`);
    spendEnergy(p, G.TRAINING_ENERGY);
    p.money -= cost;
    const needed = G.trainingsNeeded(p[stat]);
    p.training_progress[stat] = (p.training_progress[stat] || 0) + 1;
    let msg = `Trening zaliczony (${p.training_progress[stat]}/${needed}).`;
    if (p.training_progress[stat] >= needed) {
      p.training_progress[stat] = 0;
      p[stat]++;
      msg = `${G.STATS[stat]} wzrasta do ${p[stat]}!`;
    }
    const lvl = grantXp(p, 5);
    return { message: msg, levelUp: lvl.levelsUp > 0 ? lvl.level : null };
  });
  post('/daily-bonus', () => {
    const p = me();
    if (now() < p.last_daily + G.DAILY_BONUS_MS) fail('Premię dzienną już odebrałeś.');
    const amount = G.dailyBonusAmount(p.level);
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
    if (p.level < item.level) fail(`Wymagany poziom ${item.level}.`);
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
      .filter((o) => o.id !== p.id && Math.abs(o.level - p.level) <= G.DUEL_LEVEL_RANGE)
      .sort((a, b) => b.last_seen - a.last_seen)
      .slice(0, 30)
      .map((o) => publicPlayer(player(o.id)));
    return { opponents };
  });
  post('/duel', (b) => {
    const p = me();
    const opp = player(Number(b.opponentId));
    if (!opp || opp.id === p.id) fail('Nieprawidłowy rywal.');
    if (Math.abs(opp.level - p.level) > G.DUEL_LEVEL_RANGE) fail(`Rywal musi być w zasięgu ±${G.DUEL_LEVEL_RANGE} poziomów.`);
    spendEnergy(p, G.DUEL_ENERGY);
    const { m, myRew, lvl } = duel(p, opp);
    return { matchId: m.id, score: [m.home_score, m.away_score], reward: myRew, levelUp: lvl.levelsUp > 0 ? lvl.level : null };
  });
  get('/matches/:id', (b, id) => {
    me();
    const m = S.matches.find((x) => x.id === id);
    if (!m) fail('Nie ma takiego meczu.');
    return { match: m };
  });
  get('/my-matches', () => {
    const p = me();
    return { matches: S.matches.filter((m) => m.kind === 'duel' && (m.home_id === p.id || m.away_id === p.id)).slice(-20).reverse().map(listMatch) };
  });
  get('/ranking/players', () => {
    me();
    return { players: [...S.players].sort((a, b) => b.level - a.level || b.xp - a.xp).map((p) => publicPlayer(p)) };
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
    if (!/^[\p{L}\d][\p{L}\d .'-]{2,29}$/u.test(name)) fail('Nazwa klubu: 3–30 znaków.');
    if (!/^[A-Z0-9]{2,4}$/.test(tag)) fail('Skrót klubu: 2–4 litery/cyfry.');
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
            return { id: x.id, name: x.name, level: x.level, position: x.position };
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
    p.energy = G.ENERGY_MAX;
    p.energy_updated = now();
    return { message: 'Energia uzupełniona (tryb testowy).' };
  });
  post('/preview/money', () => {
    const p = me();
    p.money += 1000;
    return { message: 'Dodano 1000 monet (tryb testowy).' };
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
