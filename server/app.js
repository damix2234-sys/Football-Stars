import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class GameError extends Error {
  constructor(msg, status = 400) {
    super(msg);
    this.status = status;
  }
}
const fail = (msg, status) => {
  throw new GameError(msg, status);
};

function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pass, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pass, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pass, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

export function createApp(db, { now = () => Date.now() } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '16kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/healthz', (req, res) => res.send('ok'));

  const clubListSql = `SELECT c.id, c.name, c.tag, c.points, c.wins, c.draws, c.losses,
      (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id) AS members FROM clubs c`;

  // ---------- pomocnicze ----------
  const skillsOf = (p) => JSON.parse(p.skills);
  const progressOf = (p) => JSON.parse(p.training_progress);

  // Wczytuje gracza: odnawia energię i rozlicza ukończone treningi automatyczne.
  // Zawsze w transakcji z blokadą wiersza, żeby równoległe zapytania nie zdublowały rozliczenia.
  function loadPlayer(id) {
    return db.tx(async () => {
      const p = await db.get('SELECT * FROM players WHERE id = ? FOR UPDATE', id);
      if (!p) return null;
      const e = G.currentEnergy(p.energy, p.energy_updated, now());
      if (e.energy !== p.energy || e.updatedAt !== p.energy_updated) {
        await db.run('UPDATE players SET energy = ?, energy_updated = ? WHERE id = ?', e.energy, e.updatedAt, id);
        p.energy = e.energy;
        p.energy_updated = e.updatedAt;
      }
      const jobs = await db.all('SELECT * FROM auto_trainings WHERE player_id = ?', id);
      if (jobs.length) {
        const skills = skillsOf(p);
        const progress = progressOf(p);
        let changed = false;
        for (const j of jobs) {
          const completed = Math.min(j.count, Math.floor((now() - j.started_at) / G.TRAIN_COOLDOWN_MS));
          if (completed > j.done) {
            const r = G.applyTrainings(skills[j.spec], progress[j.spec] || 0, completed - j.done);
            skills[j.spec] = r.level;
            progress[j.spec] = r.progress;
            changed = true;
          }
          if (completed >= j.count) {
            await db.run('DELETE FROM auto_trainings WHERE player_id = ? AND spec = ?', id, j.spec);
            await notify(id, `Trening automatyczny „${G.SPECS[j.spec].name}” zakończony (${j.count} treningów).`);
          } else if (completed > j.done) {
            await db.run('UPDATE auto_trainings SET done = ? WHERE player_id = ? AND spec = ?', completed, id, j.spec);
          }
        }
        if (changed) {
          p.skills = JSON.stringify(skills);
          p.training_progress = JSON.stringify(progress);
          p.ovr = G.ovr(skills);
          await db.run(
            'UPDATE players SET skills = ?, training_progress = ?, ovr = ? WHERE id = ?',
            p.skills,
            p.training_progress,
            p.ovr,
            id,
          );
        }
      }
      return p;
    });
  }
  const equippedIds = async (pid) =>
    (await db.all('SELECT item_id FROM inventory WHERE player_id = ? AND equipped = 1', pid)).map((r) => r.item_id);
  const effStats = async (p) => G.effectiveStats(skillsOf(p), await equippedIds(p.id));

  async function spendEnergy(p, amount) {
    if (p.energy < amount) fail(`Za mało energii (potrzeba ${amount}).`);
    await db.run('UPDATE players SET energy = energy - ? WHERE id = ?', amount, p.id);
    p.energy -= amount;
  }

  const notify = (pid, body) =>
    db.run('INSERT INTO notifications (player_id, body, created_at) VALUES (?, ?, ?)', pid, body, now());

  // Publiczne dane wielu graczy naraz (2 zapytania zamiast 2 na gracza).
  async function publicPlayers(rows) {
    if (!rows.length) return [];
    const ids = rows.map((p) => p.id);
    const clubIds = [...new Set(rows.map((p) => p.club_id).filter(Boolean))];
    const [inv, clubs] = await Promise.all([
      db.all('SELECT player_id, item_id FROM inventory WHERE equipped = 1 AND player_id = ANY(?)', ids),
      clubIds.length ? db.all('SELECT id, name, tag FROM clubs WHERE id = ANY(?)', clubIds) : [],
    ]);
    const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]));
    return rows.map((p) => {
      const stats = G.effectiveStats(
        skillsOf(p),
        inv.filter((i) => i.player_id === p.id).map((i) => i.item_id),
      );
      return {
        id: p.id,
        name: p.name,
        position: p.position,
        ovr: p.ovr,
        stats,
        overall: G.ovr(stats),
        wins: p.wins,
        draws: p.draws,
        losses: p.losses,
        goals: p.goals,
        club: clubById[p.club_id] || null,
        online: now() - p.last_seen < 5 * 60 * 1000,
      };
    });
  }
  const publicPlayer = async (p) => (await publicPlayers([p]))[0];

  // ---------- auth ----------
  app.use(async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie).sid;
      if (token) {
        const s = await db.get('SELECT user_id FROM sessions WHERE token = ?', token);
        if (s) {
          req.userId = s.user_id;
          req.token = token;
          const p = await db.get('SELECT id, last_seen FROM players WHERE user_id = ?', s.user_id);
          if (p) {
            req.playerId = p.id;
            // "online" aktualizujemy co najwyżej raz na minutę
            if (now() - p.last_seen > 60000) await db.run('UPDATE players SET last_seen = ? WHERE id = ?', now(), p.id);
          }
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  });
  const needUser = (req, res, next) => (req.userId ? next() : res.status(401).json({ error: 'Zaloguj się.' }));
  const needPlayer = (req, res, next) =>
    req.playerId ? next() : res.status(403).json({ error: 'Najpierw stwórz piłkarza.' });

  async function startSession(req, res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', token, userId, now());
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`);
  }

  const route = (fn) => async (req, res) => {
    try {
      res.json((await fn(req, res)) ?? { ok: true });
    } catch (e) {
      if (e instanceof GameError) return res.status(e.status).json({ error: e.message });
      if (e?.code === '23505') return res.status(400).json({ error: 'Ta nazwa jest już zajęta.' });
      console.error(e);
      res.status(500).json({ error: 'Błąd serwera.' });
    }
  };
  // Akcja w transakcji.
  const action = (fn) => route((req, res) => db.tx(() => fn(req, res)));

  app.post(
    '/api/register',
    route(async (req, res) => {
      const login = String(req.body.login || '').trim();
      const password = String(req.body.password || '');
      if (!/^[\p{L}\d_]{3,20}$/u.test(login)) fail('Login musi mieć od 3 do 20 znaków (litery, cyfry, _).');
      if (password.length < 6) fail('Hasło musi mieć min. 6 znaków.');
      if (await db.get('SELECT 1 FROM users WHERE lower(login) = lower(?)', login)) fail('Login jest zajęty.');
      const r = await db.run(
        'INSERT INTO users (login, pass_hash, created_at) VALUES (?, ?, ?) RETURNING id',
        login,
        hashPassword(password),
        now(),
      );
      await startSession(req, res, r.rows[0].id);
    }),
  );

  app.post(
    '/api/login',
    route(async (req, res) => {
      const u = await db.get('SELECT * FROM users WHERE lower(login) = lower(?)', String(req.body.login || '').trim());
      if (!u || !verifyPassword(String(req.body.password || ''), u.pass_hash)) fail('Zły login lub hasło.', 401);
      await startSession(req, res, u.id);
    }),
  );

  app.post(
    '/api/logout',
    route(async (req, res) => {
      if (req.token) await db.run('DELETE FROM sessions WHERE token = ?', req.token);
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
    }),
  );

  app.get(
    '/api/config',
    route(() => ({
      positions: G.POSITIONS,
      stats: G.STATS,
      slots: G.SLOTS,
      items: G.ITEMS,
      energyRegenMs: G.ENERGY_REGEN_MS,
      categories: G.CATEGORIES,
      trainCooldownMs: G.TRAIN_COOLDOWN_MS,
      autoMaxHours: G.AUTO_MAX_HOURS,
      autoMaxActive: G.AUTO_MAX_ACTIVE,
      duelEnergy: G.PENALTY_ENERGY,
      penaltyKicks: G.PENALTY_KICKS,
      clubCreateCost: G.CLUB_CREATE_COST,
      clubMaxMembers: G.CLUB_MAX_MEMBERS,
      duelOvrRatio: G.DUEL_OVR_RATIO,
    })),
  );

  // ---------- dane publiczne (strona startowa) ----------
  app.get(
    '/api/public/stats',
    route(async () =>
      db.get(
        `SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT COUNT(*) FROM clubs) AS clubs,
           (SELECT COUNT(*) FROM matches) AS matches,
           (SELECT COUNT(*) FROM players WHERE last_seen > ?) AS online`,
        now() - 5 * 60 * 1000,
      ),
    ),
  );

  app.get(
    '/api/public/recent',
    route(async () => ({
      matches: await db.all(
        'SELECT home_name, away_name, home_score, away_score FROM matches ORDER BY id DESC LIMIT 12',
      ),
    })),
  );

  app.get(
    '/api/public/top',
    route(async () => ({
      players: await publicPlayers(await db.all('SELECT * FROM players ORDER BY ovr DESC LIMIT 5')),
      clubs: await db.all(`${clubListSql} ORDER BY c.points DESC, c.wins DESC LIMIT 5`),
    })),
  );

  // ---------- piłkarz ----------
  app.post(
    '/api/player',
    needUser,
    route(async (req) => {
      if (req.playerId) fail('Masz już piłkarza.');
      const name = String(req.body.name || '').trim();
      const position = String(req.body.position || '');
      if (!/^[\p{L}][\p{L}\d .'-]{2,23}$/u.test(name)) fail('Nazwa piłkarza musi mieć od 3 do 24 znaków i zaczynać się literą.');
      if (!G.POSITIONS[position]) fail('Wybierz pozycję.');
      if (await db.get('SELECT 1 FROM players WHERE lower(name) = lower(?)', name)) fail('Ta nazwa jest zajęta.');
      const skills = G.startingSkills(position);
      const r = await db.run(
        `INSERT INTO players (user_id, name, position, energy_updated, created_at, last_seen, skills, ovr, money, energy)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        req.userId,
        name,
        position,
        now(),
        now(),
        now(),
        JSON.stringify(skills),
        G.ovr(skills),
        G.START_MONEY,
        G.START_ENERGY,
      );
      await notify(r.rows[0].id, 'Witaj w Football Stars! Zacznij od treningu, a potem zagraj pierwszy mecz.');
    }),
  );

  // Stan treningu: poziom, postęp i koszt każdej specjalizacji + aktywne treningi automatyczne.
  async function trainingState(p) {
    const skills = skillsOf(p);
    const progress = progressOf(p);
    const jobs = await db.all('SELECT * FROM auto_trainings WHERE player_id = ?', p.id);
    return {
      specs: Object.fromEntries(
        G.SPEC_KEYS.map((k) => [
          k,
          { level: skills[k], progress: progress[k] || 0, needed: G.trainingsNeeded(skills[k]), cost: G.trainCost(skills[k]) },
        ]),
      ),
      categories: Object.fromEntries(G.CATEGORIES.map((c) => [c.id, G.categoryOvr(skills, c.id)])),
      readyAt: p.last_train + G.TRAIN_COOLDOWN_MS,
      autos: jobs.map((j) => ({
        spec: j.spec,
        count: j.count,
        done: Math.min(j.count, Math.floor((now() - j.started_at) / G.TRAIN_COOLDOWN_MS)),
        endsAt: j.started_at + j.count * G.TRAIN_COOLDOWN_MS,
      })),
    };
  }

  app.get(
    '/api/me',
    route(async (req) => {
      if (!req.userId) return { user: null };
      const user = await db.get('SELECT id, login FROM users WHERE id = ?', req.userId);
      if (!req.playerId) return { user, player: null };
      const p = await loadPlayer(req.playerId);
      const club = p.club_id ? await db.get('SELECT owner_id FROM clubs WHERE id = ?', p.club_id) : null;
      const unread = (await db.get('SELECT COUNT(*) AS n FROM notifications WHERE player_id = ? AND read = 0', p.id)).n;
      return {
        user,
        player: {
          ...(await publicPlayer(p)),
          baseStats: skillsOf(p),
          training: await trainingState(p),
          money: p.money,
          energy: p.energy,
          energyUpdated: p.energy_updated,
          form: 100, // forma i sprawność: szczegóły dojdą razem z silnikiem meczu
          dailyReadyAt: p.last_daily + G.DAILY_BONUS_MS,
          dailyAmount: G.dailyBonusAmount(p.ovr),
          clubRole: club ? (club.owner_id === p.id ? 'owner' : 'member') : null,
          unread,
        },
        serverTime: now(),
      };
    }),
  );

  const matchCols = 'id, home_id, away_id, home_name, away_name, home_score, away_score, created_at';

  app.get(
    '/api/players/:id',
    needPlayer,
    route(async (req) => {
      const p = await loadPlayer(Number(req.params.id) || 0);
      if (!p) fail('Nie ma takiego piłkarza.', 404);
      const matches = await db.all(
        `SELECT ${matchCols} FROM matches WHERE kind = 'duel' AND (home_id = ? OR away_id = ?) ORDER BY id DESC LIMIT 10`,
        p.id,
        p.id,
      );
      return { player: await publicPlayer(p), matches };
    }),
  );

  // ---------- trening ----------
  const specOf = (req) => {
    const spec = String(req.body.spec || '');
    if (!G.SPECS[spec]) fail('Nieznana specjalizacja.');
    return spec;
  };
  const autoFor = (pid, spec) => db.get('SELECT * FROM auto_trainings WHERE player_id = ? AND spec = ?', pid, spec);

  // Trening ręczny: jeden trening co 5 sekund.
  app.post(
    '/api/train',
    needPlayer,
    action(async (req) => {
      const spec = specOf(req);
      const p = await loadPlayer(req.playerId);
      if (now() < p.last_train + G.TRAIN_COOLDOWN_MS) fail('Odpocznij chwilę. Trenować można co 5 sekund.');
      if (await autoFor(p.id, spec)) fail('Ta specjalizacja trenuje teraz automatycznie.');
      const skills = skillsOf(p);
      const progress = progressOf(p);
      const cost = G.trainCost(skills[spec]);
      if (p.money < cost.money) fail(`Trening kosztuje ${cost.money} monet.`);
      await spendEnergy(p, cost.energy);
      const r = G.applyTrainings(skills[spec], progress[spec] || 0, 1);
      skills[spec] = r.level;
      progress[spec] = r.progress;
      await db.run(
        'UPDATE players SET money = money - ?, skills = ?, training_progress = ?, ovr = ?, last_train = ? WHERE id = ?',
        cost.money,
        JSON.stringify(skills),
        JSON.stringify(progress),
        G.ovr(skills),
        now(),
        p.id,
      );
      return {
        message: r.gained
          ? `${G.SPECS[spec].name} wzrasta do ${r.level}! OVR: ${G.ovr(skills)}`
          : `Trening zaliczony (${r.progress}/${G.trainingsNeeded(r.level)}).`,
      };
    }),
  );

  const hoursOf = (req) => {
    const h = Number(req.body.hours);
    if (!(h > 0) || h > G.AUTO_MAX_HOURS) fail(`Wybierz od 5 minut do ${G.AUTO_MAX_HOURS} godzin.`);
    return h;
  };

  // Podgląd treningu automatycznego dla wszystkich czasów (nic nie zmienia).
  app.post(
    '/api/auto/plan',
    needPlayer,
    route(async (req) => {
      const spec = specOf(req);
      const p = await loadPlayer(req.playerId);
      const level = skillsOf(p)[spec];
      const prog = progressOf(p)[spec] || 0;
      return {
        money: p.money,
        energy: p.energy,
        options: G.AUTO_OPTIONS.map((h) => G.planAuto(level, prog, p.energy, p.money, h)),
      };
    }),
  );

  // Start treningu automatycznego – koszt pobierany z góry, treningi wykonują się co 5 s.
  app.post(
    '/api/auto/start',
    needPlayer,
    action(async (req) => {
      const spec = specOf(req);
      const hours = hoursOf(req);
      const p = await loadPlayer(req.playerId);
      if (await autoFor(p.id, spec)) fail('Ta specjalizacja już trenuje automatycznie.');
      const active = (await db.get('SELECT COUNT(*) AS n FROM auto_trainings WHERE player_id = ?', p.id)).n;
      if (active >= G.AUTO_MAX_ACTIVE) fail(`Możesz mieć najwyżej ${G.AUTO_MAX_ACTIVE} treningi automatyczne naraz.`);
      const skills = skillsOf(p);
      const plan = G.planAuto(skills[spec], progressOf(p)[spec] || 0, p.energy, p.money, hours);
      if (plan.missingMoney > 0 && plan.missingEnergy > 0)
        fail(`Za mało monet i energii. Brakuje ${plan.missingMoney} monet i ${plan.missingEnergy} energii.`);
      if (plan.missingMoney > 0) fail(`Za mało monet. Potrzebujesz ${plan.money}, masz ${p.money}.`);
      if (plan.missingEnergy > 0) fail(`Za mało energii. Potrzebujesz ${plan.energy}, masz ${p.energy}.`);
      await spendEnergy(p, plan.energy);
      await db.run('UPDATE players SET money = money - ? WHERE id = ?', plan.money, p.id);
      await db.run(
        `INSERT INTO auto_trainings (player_id, spec, started_at, count, energy_total, money_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        p.id,
        spec,
        now(),
        plan.count,
        plan.energy,
        plan.money,
      );
      return { message: `Trening automatyczny ruszył: ${plan.count} treningów „${G.SPECS[spec].name}”.` };
    }),
  );

  // Anulowanie – zwrot kosztu za niewykonane treningi (proporcjonalnie).
  app.post(
    '/api/auto/cancel',
    needPlayer,
    action(async (req) => {
      const spec = specOf(req);
      const p = await loadPlayer(req.playerId); // rozlicza ukończone treningi
      const j = await autoFor(p.id, spec);
      if (!j) fail('Brak aktywnego treningu automatycznego.');
      const left = j.count - j.done;
      const energyBack = Math.floor((j.energy_total * left) / j.count);
      const moneyBack = Math.floor((j.money_total * left) / j.count);
      await db.run('DELETE FROM auto_trainings WHERE player_id = ? AND spec = ?', p.id, spec);
      await db.run(
        'UPDATE players SET money = money + ?, energy = energy + ? WHERE id = ?',
        moneyBack,
        energyBack,
        p.id,
      );
      return { message: `Anulowano. Zwrot: ${moneyBack} monet i ${energyBack} energii.` };
    }),
  );

  app.post(
    '/api/daily-bonus',
    needPlayer,
    action(async (req) => {
      const p = await loadPlayer(req.playerId);
      if (now() < p.last_daily + G.DAILY_BONUS_MS) fail('Premię dzienną już odebrałeś.');
      const amount = G.dailyBonusAmount(p.ovr);
      await db.run('UPDATE players SET money = money + ?, last_daily = ? WHERE id = ?', amount, now(), p.id);
      return { message: `Odebrano premię: ${amount} monet.` };
    }),
  );

  // ---------- sklep / ekwipunek ----------
  app.get(
    '/api/inventory',
    needPlayer,
    route(async (req) => ({
      items: await db.all('SELECT item_id, equipped FROM inventory WHERE player_id = ?', req.playerId),
    })),
  );

  async function equip(pid, itemId) {
    const item = G.ITEMS_BY_ID[itemId];
    const sameSlot = G.ITEMS.filter((i) => i.slot === item.slot).map((i) => i.id);
    await db.run('UPDATE inventory SET equipped = 0 WHERE player_id = ? AND item_id = ANY(?)', pid, sameSlot);
    await db.run('UPDATE inventory SET equipped = 1 WHERE player_id = ? AND item_id = ?', pid, itemId);
  }

  app.post(
    '/api/shop/buy',
    needPlayer,
    action(async (req) => {
      const item = G.ITEMS_BY_ID[req.body.itemId];
      if (!item) fail('Nie ma takiego przedmiotu.');
      const p = await loadPlayer(req.playerId);
      if (p.ovr < item.ovr) fail(`Wymagany OVR ${item.ovr}.`);
      if (p.money < item.price) fail('Za mało monet.');
      if (await db.get('SELECT 1 FROM inventory WHERE player_id = ? AND item_id = ?', p.id, item.id))
        fail('Masz już ten przedmiot.');
      await db.run('UPDATE players SET money = money - ? WHERE id = ?', item.price, p.id);
      await db.run('INSERT INTO inventory (player_id, item_id) VALUES (?, ?)', p.id, item.id);
      await equip(p.id, item.id);
      return { message: `Kupiono: ${item.name}.` };
    }),
  );

  app.post(
    '/api/inventory/equip',
    needPlayer,
    action(async (req) => {
      const itemId = String(req.body.itemId || '');
      if (!(await db.get('SELECT 1 FROM inventory WHERE player_id = ? AND item_id = ?', req.playerId, itemId)))
        fail('Nie masz tego przedmiotu.');
      await equip(req.playerId, itemId);
    }),
  );

  // ---------- sparingi (PvP) ----------
  app.get(
    '/api/opponents',
    needPlayer,
    route(async (req) => {
      const me = await loadPlayer(req.playerId);
      const rows = await db.all(
        'SELECT * FROM players WHERE id != ? AND ovr BETWEEN ? AND ? ORDER BY last_seen DESC LIMIT 30',
        me.id,
        Math.ceil(me.ovr / G.DUEL_OVR_RATIO),
        Math.floor(me.ovr * G.DUEL_OVR_RATIO),
      );
      return { opponents: await publicPlayers(rows) };
    }),
  );

  async function saveMatch(kind, home, away, result, seed) {
    const r = await db.run(
      `INSERT INTO matches (kind, home_id, away_id, home_name, away_name, home_score, away_score, events, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      kind,
      home.id,
      away.id,
      home.name,
      away.name,
      result.score[0],
      result.score[1],
      JSON.stringify({ seed, events: result.events }),
      now(),
    );
    return r.rows[0].id;
  }

  const outcome = (a, b) => (a > b ? 'win' : a < b ? 'loss' : 'draw');
  const RESULT_COL = { win: 'wins', draw: 'draws', loss: 'losses' };

  // ---------- pojedynki karne: wyszukiwanie przeciwnika i rozgrywka na żywo ----------
  // Pojedynek to wiersz penalty_duels: player_id = gospodarz ("home"), opponent_id = gość ("away")
  // albo null, gdy przeciwnikiem jest bot. Stan (JSON):
  //   { mode: 'pvp'|'bot', first: 'home'|'away', kicks: [{ shooter, target, ball, dive, result }],
  //     pending: { shoot, dive }, turnAt, bot, seed }
  // Każdy ruch to strzał jednej strony i rzut bramkarza drugiej; serwer rozstrzyga, gdy oba są znane
  // (bot wybiera od razu), a po czasie na decyzję brakujący ruch przepada.
  const KICK_TEXT = {
    goal: (who) => `${who} strzela i jest GOL!`,
    save: (who) => `${who} strzela, ale bramkarz broni.`,
    miss: (who) => `${who} strzela obok bramki.`,
    post: (who) => `${who} trafia w obramowanie bramki!`,
  };
  const clampKick = (b) => ({
    x: Math.max(-1.4, Math.min(1.4, Number(b.x) || 0)),
    y: Math.max(-0.3, Math.min(1.4, Number(b.y) || 0)),
  });
  // stan w ujęciu gospodarza, w formacie penaltyStatus
  const homeView = (st) => ({
    my: st.kicks.filter((k) => k.shooter === 'home').map((k) => k.result),
    op: st.kicks.filter((k) => k.shooter === 'away').map((k) => k.result),
    first: st.first === 'home' ? 'my' : 'op',
  });
  const activeDuel = (pid, lock = false) =>
    db.get(
      `SELECT * FROM penalty_duels WHERE (player_id = ? OR opponent_id = ?) AND finished = 0 ORDER BY id DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      pid,
      pid,
    );
  const sideOf = (row, pid) => (row.player_id === pid ? 'home' : 'away');
  const deadlineOf = (st) => st.turnAt + G.PENALTY_DECIDE_MS + G.PENALTY_GRACE_MS;

  async function participant(row, side) {
    const st = JSON.parse(row.state);
    if (side === 'away' && st.mode === 'bot') return { ...st.bot, id: 0 };
    const p = await db.get('SELECT * FROM players WHERE id = ?', side === 'home' ? row.player_id : row.opponent_id);
    return { id: p.id, name: p.name, position: p.position, ovr: p.ovr, stats: await effStats(p), bot: false };
  }

  // Widok pojedynku z perspektywy gracza pid.
  async function duelView(row, pid) {
    const st = JSON.parse(row.state);
    const me = sideOf(row, pid);
    const them = me === 'home' ? 'away' : 'home';
    const hs = G.penaltyStatus(homeView(st));
    const flip = me === 'away';
    const turnHome = hs.turn; // 'shoot' = strzela gospodarz
    const myTurn = !turnHome ? null : (turnHome === 'shoot') !== flip ? 'shoot' : 'save';
    const myRole = myTurn === 'shoot' ? 'shoot' : 'dive';
    const opp = await participant(row, them);
    return {
      id: row.id,
      mode: st.mode,
      opponent: { id: opp.id, name: opp.name, position: opp.position, ovr: opp.ovr, bot: !!opp.bot },
      first: st.first === me ? 'my' : 'op',
      my: st.kicks.filter((k) => k.shooter === me).map((k) => k.result),
      op: st.kicks.filter((k) => k.shooter === them).map((k) => k.result),
      kicks: st.kicks.map((k) => ({ side: k.shooter === me ? 'my' : 'op', target: k.target, ball: k.ball, dive: k.dive, result: k.result, power: k.power || 0 })),
      status: {
        me: flip ? hs.op : hs.me,
        op: flip ? hs.me : hs.op,
        finished: hs.finished,
        turn: myTurn,
        suddenDeath: hs.suddenDeath,
        result: hs.result ? (flip ? { win: 'loss', loss: 'win', draw: 'draw' }[hs.result] : hs.result) : null,
      },
      waiting: !!(myTurn && st.pending[myRole]),
      startsIn: Math.max(0, st.turnAt - now()),
      deadlineIn: Math.max(0, deadlineOf(st) - now()),
      decideMs: G.PENALTY_DECIDE_MS,
      finished: !!row.finished,
      reward: st.rewards ? st.rewards[me] : null,
      matchId: st.matchId || null,
    };
  }

  // Ruch bota (strzał z rozrzutem albo rzut bramkarza).
  const botMove = (st, role) => {
    const rand = G.rng(Number(st.seed) + st.kicks.length * 7919 + (role === 'shoot' ? 1 : 2));
    return role === 'shoot' ? G.aiAim(rand) : G.aiDive(rand);
  };

  // Rozstrzyga ruch, jeśli oba wybory są znane albo minął czas. Zwraca true, gdy coś się zmieniło.
  async function resolveTurn(row, st) {
    const hs = G.penaltyStatus(homeView(st));
    if (hs.finished) return false;
    const shooter = hs.turn === 'shoot' ? 'home' : 'away';
    const keeper = shooter === 'home' ? 'away' : 'home';
    if (st.mode === 'bot') {
      if (shooter === 'away' && !st.pending.shoot) st.pending.shoot = { ...botMove(st, 'shoot'), bot: true };
      if (keeper === 'away' && !st.pending.dive) st.pending.dive = botMove(st, 'dive');
    }
    const late = now() > deadlineOf(st);
    if (!late && (!st.pending.shoot || !st.pending.dive)) return false;
    const shot = st.pending.shoot || { ...G.timeoutMove('shoot'), timeout: true };
    const dive = st.pending.dive || G.timeoutMove('save');
    const shooterP = await participant(row, shooter);
    const keeperP = await participant(row, keeper);
    const skillS = G.shooterSkill(shooterP.stats || shooterP.skills);
    const skillK = G.keeperSkill(keeperP.stats || keeperP.skills);
    const rand = G.rng(Number(st.seed) + st.kicks.length * 104729);
    // strzał gracza leci dokładnie w wybrany punkt; strzał bota ma rozrzut
    const ball = shot.bot ? G.ballLanding(shot, skillS, rand) : { x: shot.x, y: shot.y };
    const target = { x: shot.x, y: shot.y };
    st.kicks.push({ shooter, target, ball, dive: { x: dive.x, y: dive.y }, result: G.resolveKick(ball, dive, skillK, skillS), power: G.shotPower(skillS) });
    st.pending = {};
    st.turnAt = now() + G.PENALTY_ANIM_MS;
    const after = G.penaltyStatus(homeView(st));
    if (after.finished) await finishDuel(row, st, after);
    return true;
  }

  async function finishDuel(row, st, hs) {
    const home = await participant(row, 'home');
    const away = await participant(row, 'away');
    const events = st.kicks.map((k, i) => ({
      minute: i + 1,
      side: k.shooter === 'home' ? 0 : 1,
      type: k.result === 'goal' ? 'goal' : k.result === 'save' ? 'save' : 'miss',
      text: KICK_TEXT[k.result](k.shooter === 'home' ? home.name : away.name),
    }));
    const r = await db.run(
      `INSERT INTO matches (kind, home_id, away_id, home_name, away_name, home_score, away_score, events, created_at)
       VALUES ('penalty', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      home.id,
      away.id || 0,
      home.name,
      away.bot ? `${away.name} (bot)` : away.name,
      hs.me,
      hs.op,
      JSON.stringify({ penalty: true, events }),
      now(),
    );
    st.matchId = r.rows[0].id;
    st.rewards = {};
    const settle = async (side, player, res, goals, conceded) => {
      if (player.bot) return;
      const win = res === 'win';
      const rew = win ? G.PENALTY_WIN_REWARD : { money: 0, energy: 0 };
      st.rewards[side] = rew;
      await db.run(
        `UPDATE players SET money = money + ?, energy = energy + ?, pk_played = pk_played + 1,
           pk_wins = pk_wins + ?, pk_losses = pk_losses + ?, pk_goals = pk_goals + ?, pk_conceded = pk_conceded + ? WHERE id = ?`,
        rew.money,
        rew.energy,
        win ? 1 : 0,
        win ? 0 : 1,
        goals,
        conceded,
        player.id,
      );
    };
    await settle('home', home, hs.result, hs.me, hs.op);
    await settle('away', away, hs.result === 'win' ? 'loss' : 'win', hs.op, hs.me);
    await db.run('UPDATE penalty_duels SET finished = 1, state = ? WHERE id = ?', JSON.stringify(st), row.id);
    row.finished = 1;
  }

  const saveState = (row, st) => {
    row.state = JSON.stringify(st); // widok budujemy z aktualnego stanu
    return db.run('UPDATE penalty_duels SET state = ? WHERE id = ?', row.state, row.id);
  };

  async function createDuel(homeId, awayId, bot) {
    const seed = crypto.randomInt(2 ** 31);
    const st = { mode: bot ? 'bot' : 'pvp', first: crypto.randomInt(2) ? 'home' : 'away', kicks: [], pending: {}, turnAt: now() + G.PENALTY_TOSS_MS, bot, seed };
    for (const id of [homeId, awayId].filter(Boolean)) {
      const p = await loadPlayer(id);
      await spendEnergy(p, G.PENALTY_ENERGY);
    }
    await db.run('DELETE FROM penalty_queue WHERE player_id = ANY(?)', [homeId, awayId || 0]);
    const r = await db.run(
      'INSERT INTO penalty_duels (player_id, opponent_id, seed, state, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
      homeId,
      awayId,
      seed,
      JSON.stringify(st),
      now(),
    );
    return r.rows[0];
  }

  // Szuka pary w kolejce: najpierw podobny OVR, po 20 s czekania dowolny gracz.
  async function tryMatch(pid) {
    const me = await db.get('SELECT * FROM penalty_queue WHERE player_id = ? FOR UPDATE', pid);
    if (!me) return null;
    const others = await db.all('SELECT * FROM penalty_queue WHERE player_id != ? ORDER BY joined_at FOR UPDATE', pid);
    const waited = now() - me.joined_at;
    const mate = others.find((o) => G.inDuelRange(o.ovr, me.ovr) || waited > 20000 || now() - o.joined_at > 20000);
    if (mate) {
      const [home, away] = mate.joined_at <= me.joined_at ? [mate.player_id, pid] : [pid, mate.player_id];
      return createDuel(home, away, null);
    }
    if (waited >= G.MATCH_BOT_AFTER_MS) {
      const p = await db.get('SELECT ovr FROM players WHERE id = ?', pid);
      return createDuel(pid, null, G.makeBot(p.ovr, G.rng(crypto.randomInt(2 ** 31))));
    }
    return null;
  }

  app.post(
    '/api/pvp/search',
    needPlayer,
    action(async (req) => {
      const open = await activeDuel(req.playerId);
      if (open) return { state: 'found', duel: await duelView(open, req.playerId) };
      const p = await loadPlayer(req.playerId);
      if (p.energy < G.PENALTY_ENERGY) fail(`Za mało energii. Pojedynek kosztuje ${G.PENALTY_ENERGY}.`);
      await db.run(
        'INSERT INTO penalty_queue (player_id, ovr, joined_at) VALUES (?, ?, ?) ON CONFLICT (player_id) DO NOTHING',
        p.id,
        p.ovr,
        now(),
      );
      const row = await tryMatch(p.id);
      if (row) return { state: 'found', duel: await duelView(row, p.id) };
      const q = await db.get('SELECT joined_at FROM penalty_queue WHERE player_id = ?', p.id);
      return { state: 'searching', waited: now() - q.joined_at };
    }),
  );

  app.get(
    '/api/pvp/status',
    needPlayer,
    action(async (req) => {
      const open = await activeDuel(req.playerId);
      if (open) return { state: 'found', duel: await duelView(open, req.playerId) };
      const q = await db.get('SELECT joined_at FROM penalty_queue WHERE player_id = ?', req.playerId);
      if (!q) return { state: 'idle' };
      const row = await tryMatch(req.playerId);
      if (row) return { state: 'found', duel: await duelView(row, req.playerId) };
      const searching = (await db.get('SELECT COUNT(*) AS n FROM penalty_queue')).n;
      return { state: 'searching', waited: now() - q.joined_at, searching, botAfter: G.MATCH_BOT_AFTER_MS };
    }),
  );

  app.post(
    '/api/pvp/cancel',
    needPlayer,
    route(async (req) => {
      await db.run('DELETE FROM penalty_queue WHERE player_id = ?', req.playerId);
    }),
  );

  // Aktualny pojedynek (odpytywany co chwilę przez grę).
  app.get(
    '/api/penalty/current',
    needPlayer,
    action(async (req) => {
      const row = await activeDuel(req.playerId, true);
      if (!row) return { duel: null };
      const st = JSON.parse(row.state);
      // z botem nie ma kto czekać: po powrocie do gry czas na ruch liczy się od nowa
      if (st.mode === 'bot' && !st.pending.shoot && !st.pending.dive && now() > deadlineOf(st)) {
        st.turnAt = now();
      }
      await resolveTurn(row, st);
      await saveState(row, st);
      return { duel: await duelView(row, req.playerId) };
    }),
  );

  // Ostatni zakończony pojedynek (podsumowanie po końcu serii).
  app.get(
    '/api/penalty/:id',
    needPlayer,
    route(async (req) => {
      const row = await db.get(
        'SELECT * FROM penalty_duels WHERE id = ? AND (player_id = ? OR opponent_id = ?)',
        Number(req.params.id) || 0,
        req.playerId,
        req.playerId,
      );
      if (!row) fail('Nie ma takiego pojedynku.', 404);
      return { duel: await duelView(row, req.playerId) };
    }),
  );

  // Ruch gracza: strzał (gdy strzela) albo miejsce rzutu (gdy broni).
  app.post(
    '/api/penalty/:id/kick',
    needPlayer,
    action(async (req) => {
      const row = await db.get(
        'SELECT * FROM penalty_duels WHERE id = ? AND (player_id = ? OR opponent_id = ?) AND finished = 0 FOR UPDATE',
        Number(req.params.id) || 0,
        req.playerId,
        req.playerId,
      );
      if (!row) fail('Ten pojedynek już się zakończył.');
      const st = JSON.parse(row.state);
      const view = await duelView(row, req.playerId);
      const role = view.status.turn === 'shoot' ? 'shoot' : 'dive';
      if (!view.status.turn) fail('Pojedynek się zakończył.');
      if (!st.pending[role]) {
        const late = now() > deadlineOf(st);
        st.pending[role] = late || req.body.timeout ? G.timeoutMove(role === 'shoot' ? 'shoot' : 'save') : clampKick(req.body);
        if ((late || req.body.timeout) && role === 'shoot') st.pending[role].timeout = true;
      }
      await resolveTurn(row, st);
      await saveState(row, st);
      return { duel: await duelView(row, req.playerId) };
    }),
  );

  // Moje wyniki w pojedynkach (osobno od rankingu OVR) i ostatnie mecze.
  app.get(
    '/api/pvp/stats',
    needPlayer,
    route(async (req) => {
      const p = await db.get('SELECT pk_played, pk_wins, pk_losses, pk_goals, pk_conceded FROM players WHERE id = ?', req.playerId);
      const recent = await db.all(
        `SELECT ${matchCols} FROM matches WHERE kind = 'penalty' AND (home_id = ? OR away_id = ?) ORDER BY id DESC LIMIT 8`,
        req.playerId,
        req.playerId,
      );
      const rank = (await db.get('SELECT COUNT(*) AS n FROM players WHERE pk_wins > (SELECT pk_wins FROM players WHERE id = ?)', req.playerId)).n + 1;
      return { stats: { played: p.pk_played, wins: p.pk_wins, losses: p.pk_losses, goals: p.pk_goals, conceded: p.pk_conceded, rank }, recent };
    }),
  );

  app.get(
    '/api/ranking/penalty',
    needPlayer,
    route(async () => ({
      players: (await db.all('SELECT * FROM players WHERE pk_played > 0 ORDER BY pk_wins DESC, pk_losses ASC LIMIT 200')).map((p) => ({
        id: p.id, name: p.name, position: p.position, ovr: p.ovr, played: p.pk_played, wins: p.pk_wins, losses: p.pk_losses, goals: p.pk_goals,
      })),
    })),
  );

  app.get(
    '/api/matches/:id',
    needPlayer,
    route(async (req) => {
      const m = await db.get('SELECT * FROM matches WHERE id = ?', Number(req.params.id) || 0);
      if (!m) fail('Nie ma takiego meczu.', 404);
      const parsed = JSON.parse(m.events);
      return { match: { ...m, events: parsed.events, penalty: !!parsed.penalty } };
    }),
  );

  app.get(
    '/api/my-matches',
    needPlayer,
    route(async (req) => ({
      matches: await db.all(
        `SELECT ${matchCols} FROM matches WHERE kind = 'duel' AND (home_id = ? OR away_id = ?) ORDER BY id DESC LIMIT 20`,
        req.playerId,
        req.playerId,
      ),
    })),
  );

  // ---------- rankingi ----------
  app.get(
    '/api/ranking/players',
    needPlayer,
    route(async () => ({
      players: await publicPlayers(await db.all('SELECT * FROM players ORDER BY ovr DESC LIMIT 200')),
    })),
  );

  app.get(
    '/api/ranking/clubs',
    needPlayer,
    route(async () => ({ clubs: await db.all(`${clubListSql} ORDER BY c.points DESC, c.wins DESC LIMIT 100`) })),
  );

  // ---------- kluby ----------
  const clubMembers = (clubId) => db.all('SELECT * FROM players WHERE club_id = ? ORDER BY ovr DESC', clubId);
  async function requireOwner(req) {
    const p = await loadPlayer(req.playerId);
    const club = p.club_id ? await db.get('SELECT * FROM clubs WHERE id = ?', p.club_id) : null;
    if (!club || club.owner_id !== p.id) fail('Tylko prezes klubu może to zrobić.', 403);
    return { p, club };
  }

  app.post(
    '/api/clubs',
    needPlayer,
    action(async (req) => {
      const p = await loadPlayer(req.playerId);
      if (p.club_id) fail('Jesteś już w klubie.');
      const name = String(req.body.name || '').trim();
      const tag = String(req.body.tag || '').trim().toUpperCase();
      if (!/^[\p{L}\d][\p{L}\d .'-]{2,29}$/u.test(name)) fail('Nazwa klubu musi mieć od 3 do 30 znaków.');
      if (!/^[A-Z0-9]{2,4}$/.test(tag)) fail('Skrót klubu to od 2 do 4 liter lub cyfr.');
      if (p.money < G.CLUB_CREATE_COST) fail(`Założenie klubu kosztuje ${G.CLUB_CREATE_COST} monet.`);
      if (await db.get('SELECT 1 FROM clubs WHERE lower(name) = lower(?) OR tag = ?', name, tag))
        fail('Nazwa lub skrót są zajęte.');
      const r = await db.run(
        'INSERT INTO clubs (name, tag, owner_id, created_at) VALUES (?, ?, ?, ?) RETURNING id',
        name,
        tag,
        p.id,
        now(),
      );
      const clubId = r.rows[0].id;
      await db.run('UPDATE players SET money = money - ?, club_id = ? WHERE id = ?', G.CLUB_CREATE_COST, clubId, p.id);
      await db.run('DELETE FROM club_applications WHERE player_id = ?', p.id);
      return { clubId };
    }),
  );

  app.get(
    '/api/clubs',
    needPlayer,
    route(async () => ({ clubs: await db.all(`${clubListSql} ORDER BY c.points DESC, c.name LIMIT 200`) })),
  );

  app.get(
    '/api/clubs/:id',
    needPlayer,
    route(async (req) => {
      const club = await db.get('SELECT * FROM clubs WHERE id = ?', Number(req.params.id) || 0);
      if (!club) fail('Nie ma takiego klubu.', 404);
      const me = await loadPlayer(req.playerId);
      const isMember = me.club_id === club.id;
      const isOwner = club.owner_id === me.id;
      const members = await publicPlayers(await clubMembers(club.id));
      const strength = members.length ? Math.round(members.reduce((s, m) => s + m.overall, 0) / members.length) : 0;
      return {
        club: {
          id: club.id,
          name: club.name,
          tag: club.tag,
          ownerId: club.owner_id,
          points: club.points,
          wins: club.wins,
          draws: club.draws,
          losses: club.losses,
          description: club.description,
          treasury: isMember ? club.treasury : null,
          nextMatchAt: club.last_match + G.CLUB_MATCH_COOLDOWN_MS,
          strength,
        },
        members,
        isMember,
        isOwner,
        applied: !!(await db.get(
          'SELECT 1 FROM club_applications WHERE club_id = ? AND player_id = ?',
          club.id,
          me.id,
        )),
        applications: isOwner
          ? await db.all(
              `SELECT p.id, p.name, p.ovr, p.position FROM club_applications a JOIN players p ON p.id = a.player_id
               WHERE a.club_id = ? ORDER BY a.created_at`,
              club.id,
            )
          : [],
        matches: await db.all(
          `SELECT ${matchCols} FROM matches WHERE kind = 'club' AND (home_id = ? OR away_id = ?) ORDER BY id DESC LIMIT 10`,
          club.id,
          club.id,
        ),
      };
    }),
  );

  app.post(
    '/api/clubs/:id/apply',
    needPlayer,
    route(async (req) => {
      const p = await loadPlayer(req.playerId);
      const club = await db.get('SELECT * FROM clubs WHERE id = ?', Number(req.params.id) || 0);
      if (!club) fail('Nie ma takiego klubu.', 404);
      if (p.club_id) fail('Jesteś już w klubie.');
      const r = await db.run(
        'INSERT INTO club_applications (club_id, player_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
        club.id,
        p.id,
        now(),
      );
      if (r.changes) await notify(club.owner_id, `${p.name} chce dołączyć do klubu ${club.name}.`);
      return { message: 'Wysłano zgłoszenie.' };
    }),
  );

  app.post(
    '/api/clubs/applications/:playerId',
    needPlayer,
    action(async (req) => {
      const { club } = await requireOwner(req);
      const pid = Number(req.params.playerId) || 0;
      const del = await db.run('DELETE FROM club_applications WHERE club_id = ? AND player_id = ?', club.id, pid);
      if (!del.changes) fail('Brak takiego zgłoszenia.');
      if (req.body.accept) {
        const target = await loadPlayer(pid);
        if (target.club_id) fail('Ten gracz jest już w innym klubie.');
        if ((await clubMembers(club.id)).length >= G.CLUB_MAX_MEMBERS) fail('Klub jest pełny.');
        await db.run('UPDATE players SET club_id = ? WHERE id = ?', club.id, pid);
        await db.run('DELETE FROM club_applications WHERE player_id = ?', pid);
        await notify(pid, `Zostałeś przyjęty do klubu ${club.name}!`);
      } else {
        await notify(pid, `Klub ${club.name} odrzucił Twoje zgłoszenie.`);
      }
    }),
  );

  app.post(
    '/api/clubs/kick/:playerId',
    needPlayer,
    action(async (req) => {
      const { p, club } = await requireOwner(req);
      const pid = Number(req.params.playerId) || 0;
      if (pid === p.id) fail('Nie możesz wyrzucić siebie.');
      const r = await db.run('UPDATE players SET club_id = NULL WHERE id = ? AND club_id = ?', pid, club.id);
      if (!r.changes) fail('Ten gracz nie jest w Twoim klubie.');
      await notify(pid, `Zostałeś usunięty z klubu ${club.name}.`);
    }),
  );

  app.post(
    '/api/clubs/leave',
    needPlayer,
    action(async (req) => {
      const p = await loadPlayer(req.playerId);
      if (!p.club_id) fail('Nie jesteś w klubie.');
      const club = await db.get('SELECT * FROM clubs WHERE id = ?', p.club_id);
      await db.run('UPDATE players SET club_id = NULL WHERE id = ?', p.id);
      if (club.owner_id === p.id) {
        const next = await db.get('SELECT id FROM players WHERE club_id = ? ORDER BY ovr DESC LIMIT 1', club.id);
        if (next) {
          await db.run('UPDATE clubs SET owner_id = ? WHERE id = ?', next.id, club.id);
          await notify(next.id, `Zostałeś nowym prezesem klubu ${club.name}.`);
        } else {
          await db.run('DELETE FROM messages WHERE channel = ?', `club:${club.id}`);
          await db.run('DELETE FROM clubs WHERE id = ?', club.id);
        }
      }
    }),
  );

  app.post(
    '/api/clubs/donate',
    needPlayer,
    action(async (req) => {
      const p = await loadPlayer(req.playerId);
      const amount = Math.floor(Number(req.body.amount));
      if (!p.club_id) fail('Nie jesteś w klubie.');
      if (!(amount > 0)) fail('Podaj kwotę.');
      if (p.money < amount) fail('Za mało monet.');
      await db.run('UPDATE players SET money = money - ? WHERE id = ?', amount, p.id);
      await db.run('UPDATE clubs SET treasury = treasury + ? WHERE id = ?', amount, p.club_id);
      return { message: `Wpłacono ${amount} monet do kasy klubu.` };
    }),
  );

  app.post(
    '/api/clubs/description',
    needPlayer,
    route(async (req) => {
      const { club } = await requireOwner(req);
      await db.run(
        'UPDATE clubs SET description = ? WHERE id = ?',
        String(req.body.description || '').slice(0, 500),
        club.id,
      );
    }),
  );

  // Mecz klubowy – prezes wyzywa inny klub.
  app.post(
    '/api/clubs/challenge/:clubId',
    needPlayer,
    action(async (req) => {
      const { club } = await requireOwner(req);
      const opp = await db.get('SELECT * FROM clubs WHERE id = ?', Number(req.params.clubId) || 0);
      if (!opp || opp.id === club.id) fail('Nieprawidłowy rywal.');
      if (now() < club.last_match + G.CLUB_MATCH_COOLDOWN_MS) fail('Twój klub musi odpocząć przed kolejnym meczem.');
      const toTeam = async (c) => {
        const rows = (await clubMembers(c.id)).slice(0, 11);
        const pub = await publicPlayers(rows);
        const members = pub.map((m) => ({ id: m.id, name: m.name, position: m.position, stats: m.stats }));
        return { members, side: G.teamSide(c.name, members) };
      };
      const home = await toTeam(club);
      const away = await toTeam(opp);
      if (home.members.length < 3) fail('Potrzebujesz min. 3 zawodników w klubie.');
      if (away.members.length < 3) fail('Rywal ma za mało zawodników.');
      const seed = crypto.randomInt(2 ** 31);
      const result = G.simulate(home.side, away.side, seed, 20);
      const matchId = await saveMatch('club', club, opp, result, seed);
      const [hs, as] = result.score;
      const settle = async (c, team, res) => {
        const rew = G.clubMatchRewards(res);
        await db.run(
          `UPDATE clubs SET points = points + ?, treasury = treasury + ?, ${RESULT_COL[res]} = ${RESULT_COL[res]} + 1 WHERE id = ?`,
          rew.points,
          rew.treasury,
          c.id,
        );
        for (const m of team.members) {
          await db.run('UPDATE players SET money = money + ? WHERE id = ?', rew.money, m.id);
          await notify(m.id, `Mecz klubowy ${club.name} vs ${opp.name}: ${hs}:${as}.`);
        }
      };
      await settle(club, home, outcome(hs, as));
      await settle(opp, away, outcome(as, hs));
      await db.run('UPDATE clubs SET last_match = ? WHERE id = ?', now(), club.id);
      return { matchId, score: result.score };
    }),
  );

  // ---------- czat ----------
  async function channelFor(req, channel) {
    if (channel === 'global') return 'global';
    if (channel === 'club') {
      const p = await db.get('SELECT club_id FROM players WHERE id = ?', req.playerId);
      if (!p.club_id) fail('Nie jesteś w klubie.');
      return `club:${p.club_id}`;
    }
    fail('Nieznany kanał.');
  }

  app.get(
    '/api/chat/:channel',
    needPlayer,
    route(async (req) => {
      const ch = await channelFor(req, req.params.channel);
      const after = Number(req.query.after) || 0;
      const rows = await db.all(
        `SELECT m.id, m.body, m.created_at, p.id AS player_id, p.name FROM messages m
         JOIN players p ON p.id = m.player_id WHERE m.channel = ? AND m.id > ? ORDER BY m.id DESC LIMIT 50`,
        ch,
        after,
      );
      return { messages: rows.reverse() };
    }),
  );

  app.post(
    '/api/chat/:channel',
    needPlayer,
    route(async (req) => {
      const ch = await channelFor(req, req.params.channel);
      const body = String(req.body.body || '').trim().slice(0, 300);
      if (!body) fail('Pusta wiadomość.');
      const last = await db.get(
        'SELECT created_at FROM messages WHERE player_id = ? ORDER BY id DESC LIMIT 1',
        req.playerId,
      );
      if (last && now() - last.created_at < 1500) fail('Zwolnij trochę.');
      await db.run(
        'INSERT INTO messages (channel, player_id, body, created_at) VALUES (?, ?, ?, ?)',
        ch,
        req.playerId,
        body,
        now(),
      );
    }),
  );

  // ---------- powiadomienia ----------
  app.get(
    '/api/notifications',
    needPlayer,
    route(async (req) => {
      const rows = await db.all(
        'SELECT * FROM notifications WHERE player_id = ? ORDER BY id DESC LIMIT 50',
        req.playerId,
      );
      await db.run('UPDATE notifications SET read = 1 WHERE player_id = ? AND read = 0', req.playerId);
      return { notifications: rows };
    }),
  );

  app.use('/api', (req, res) => res.status(404).json({ error: 'Nie znaleziono.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Błąd serwera.' });
  });

  return app;
}
