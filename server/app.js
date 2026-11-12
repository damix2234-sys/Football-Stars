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

  // ---------- pojedynki: seria rzutów karnych ----------
  const KICK_TEXT = {
    goal: (who) => `${who} strzela i jest GOL!`,
    save: (who) => `${who} strzela, ale bramkarz broni.`,
    miss: (who) => `${who} strzela obok bramki.`,
    post: (who) => `${who} trafia w słupek!`,
  };
  const clampKick = (b) => ({
    x: Math.max(-1.4, Math.min(1.4, Number(b.x) || 0)),
    y: Math.max(-0.3, Math.min(1.4, Number(b.y) || 0)),
  });

  async function penaltyView(row) {
    const st = JSON.parse(row.state);
    const opp = await db.get('SELECT id, name, position, ovr FROM players WHERE id = ?', row.opponent_id);
    return { id: row.id, opponent: opp, my: st.my, op: st.op, kicks: st.kicks, first: st.first || 'my', status: G.penaltyStatus(st) };
  }

  app.get(
    '/api/penalty/current',
    needPlayer,
    route(async (req) => {
      const row = await db.get('SELECT * FROM penalty_duels WHERE player_id = ? AND finished = 0', req.playerId);
      return { duel: row ? await penaltyView(row) : null };
    }),
  );

  app.post(
    '/api/penalty/start',
    needPlayer,
    action(async (req) => {
      const open = await db.get('SELECT * FROM penalty_duels WHERE player_id = ? AND finished = 0', req.playerId);
      if (open) return { duel: await penaltyView(open) }; // dokończ rozpoczęty pojedynek
      const oppId = Number(req.body.opponentId) || 0;
      if (oppId === req.playerId) fail('Nieprawidłowy rywal.');
      const me = await loadPlayer(req.playerId);
      const opp = await db.get('SELECT * FROM players WHERE id = ?', oppId);
      if (!opp) fail('Nieprawidłowy rywal.');
      if (!G.inDuelRange(me.ovr, opp.ovr)) fail('Rywal jest za mocny albo za słaby (OVR różni się więcej niż 1,5 raza).');
      await spendEnergy(me, G.PENALTY_ENERGY);
      const r = await db.run(
        'INSERT INTO penalty_duels (player_id, opponent_id, seed, state, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
        me.id,
        opp.id,
        crypto.randomInt(2 ** 31),
        JSON.stringify({ my: [], op: [], kicks: [], first: crypto.randomInt(2) ? 'my' : 'op' }),
        now(),
      );
      return { duel: await penaltyView(r.rows[0]) };
    }),
  );

  // Jeden ruch: strzał (gdy strzelamy) albo wybór miejsca rzutu bramkarza (gdy bronimy).
  app.post(
    '/api/penalty/:id/kick',
    needPlayer,
    action(async (req) => {
      const row = await db.get(
        'SELECT * FROM penalty_duels WHERE id = ? AND player_id = ? AND finished = 0 FOR UPDATE',
        Number(req.params.id) || 0,
        req.playerId,
      );
      if (!row) fail('Ten pojedynek już się zakończył.');
      const st = JSON.parse(row.state);
      const status = G.penaltyStatus(st);
      const me = await loadPlayer(req.playerId);
      const opp = await db.get('SELECT * FROM players WHERE id = ?', row.opponent_id);
      const myStats = await effStats(me);
      const oppStats = await effStats(opp);
      const rand = G.rng(Number(row.seed) + st.kicks.length * 7919);
      const target = clampKick(req.body);
      let kick;
      if (status.turn === 'shoot') {
        const ball = { ...target }; // strzał gracza leci dokładnie tam, gdzie wskazał
        const dive = G.aiDive(rand);
        kick = { side: 'my', target, ball, dive, result: G.resolveKick(ball, dive, G.keeperSkill(oppStats), G.shooterSkill(myStats)) };
        st.my.push(kick.result);
      } else {
        const aim = G.aiAim(rand);
        const ball = G.ballLanding(aim, G.shooterSkill(oppStats), rand);
        kick = { side: 'op', target: aim, ball, dive: target, result: G.resolveKick(ball, target, G.keeperSkill(myStats), G.shooterSkill(oppStats)) };
        st.op.push(kick.result);
      }
      st.kicks.push(kick);
      const after = G.penaltyStatus(st);
      let reward = null;
      if (after.finished) {
        const events = st.kicks.map((k, i) => ({
          minute: i + 1,
          side: k.side === 'my' ? 0 : 1,
          type: k.result === 'goal' ? 'goal' : k.result === 'save' ? 'save' : 'miss',
          text: KICK_TEXT[k.result](k.side === 'my' ? me.name : opp.name),
        }));
        const r = await db.run(
          `INSERT INTO matches (kind, home_id, away_id, home_name, away_name, home_score, away_score, events, created_at)
           VALUES ('duel', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          me.id,
          opp.id,
          me.name,
          opp.name,
          after.me,
          after.op,
          JSON.stringify({ penalty: true, events }),
          now(),
        );
        const oppRes = after.result === 'win' ? 'loss' : after.result === 'loss' ? 'win' : 'draw';
        const myRew = G.duelRewards(after.result, me.ovr);
        const oppRew = G.duelRewards(oppRes, opp.ovr);
        const settle = (id, money, res, goals) =>
          db.run(
            `UPDATE players SET money = money + ?, ${RESULT_COL[res]} = ${RESULT_COL[res]} + 1, goals = goals + ? WHERE id = ?`,
            money,
            goals,
            id,
          );
        await settle(me.id, myRew.money, after.result, after.me);
        await settle(opp.id, Math.floor(oppRew.money / 2), oppRes, after.op);
        await notify(opp.id, `${me.name} wyzwał Cię na pojedynek karnych. Wynik: ${after.me}:${after.op}.`);
        reward = { money: myRew.money, matchId: r.rows[0].id };
      }
      await db.run(
        'UPDATE penalty_duels SET state = ?, finished = ? WHERE id = ?',
        JSON.stringify(st),
        after.finished ? 1 : 0,
        row.id,
      );
      return { kick, status: after, my: st.my, op: st.op, reward };
    }),
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
