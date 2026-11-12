import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx } from './db.js';
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
  app.use(express.json({ limit: '16kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const q = (sql) => db.prepare(sql);

  // ---------- pomocnicze ----------
  function loadPlayer(id) {
    const p = q('SELECT * FROM players WHERE id = ?').get(id);
    if (!p) return null;
    const e = G.currentEnergy(p.energy, p.energy_updated, now());
    if (e.energy !== p.energy || e.updatedAt !== p.energy_updated) {
      q('UPDATE players SET energy = ?, energy_updated = ? WHERE id = ?').run(e.energy, e.updatedAt, id);
      p.energy = e.energy;
      p.energy_updated = e.updatedAt;
    }
    return p;
  }
  const baseStats = (p) => Object.fromEntries(G.STAT_KEYS.map((k) => [k, p[k]]));
  const equippedIds = (pid) =>
    q('SELECT item_id FROM inventory WHERE player_id = ? AND equipped = 1')
      .all(pid)
      .map((r) => r.item_id);
  const effStats = (p) => G.effectiveStats(baseStats(p), equippedIds(p.id));

  function spendEnergy(p, amount) {
    if (p.energy < amount) fail(`Za mało energii (potrzeba ${amount}).`);
    const updated = p.energy >= G.ENERGY_MAX ? now() : p.energy_updated;
    q('UPDATE players SET energy = energy - ?, energy_updated = ? WHERE id = ?').run(amount, updated, p.id);
  }

  function grantXp(pid, gained) {
    const p = q('SELECT level, xp FROM players WHERE id = ?').get(pid);
    const r = G.addXp(p.level, p.xp, gained);
    q('UPDATE players SET level = ?, xp = ? WHERE id = ?').run(r.level, r.xp, pid);
    if (r.levelsUp > 0) {
      const bonus = 100 * r.levelsUp;
      q('UPDATE players SET money = money + ?, energy = ?, energy_updated = ? WHERE id = ?').run(
        bonus,
        G.ENERGY_MAX,
        now(),
        pid,
      );
      notify(pid, `Awans na poziom ${r.level}! Otrzymujesz ${bonus} monet i pełną energię.`);
    }
    return r;
  }

  function notify(pid, body) {
    q('INSERT INTO notifications (player_id, body, created_at) VALUES (?, ?, ?)').run(pid, body, now());
  }

  function publicPlayer(p) {
    const club = p.club_id ? q('SELECT id, name, tag FROM clubs WHERE id = ?').get(p.club_id) : null;
    const stats = effStats(p);
    return {
      id: p.id,
      name: p.name,
      position: p.position,
      level: p.level,
      stats,
      overall: G.overall(stats),
      wins: p.wins,
      draws: p.draws,
      losses: p.losses,
      goals: p.goals,
      club,
      online: now() - p.last_seen < 5 * 60 * 1000,
    };
  }

  // ---------- auth ----------
  app.use((req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) {
      const s = q('SELECT user_id FROM sessions WHERE token = ?').get(token);
      if (s) {
        req.userId = s.user_id;
        req.token = token;
        const p = q('SELECT id FROM players WHERE user_id = ?').get(s.user_id);
        if (p) {
          req.playerId = p.id;
          q('UPDATE players SET last_seen = ? WHERE id = ?').run(now(), p.id);
        }
      }
    }
    next();
  });
  const needUser = (req, res, next) => (req.userId ? next() : res.status(401).json({ error: 'Zaloguj się.' }));
  const needPlayer = (req, res, next) =>
    req.playerId ? next() : res.status(403).json({ error: 'Najpierw stwórz piłkarza.' });

  function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    q('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now());
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  }

  const route = (fn) => (req, res) => {
    try {
      res.json(fn(req, res) ?? { ok: true });
    } catch (e) {
      if (e instanceof GameError) return res.status(e.status).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Błąd serwera.' });
    }
  };

  app.post(
    '/api/register',
    route((req, res) => {
      const login = String(req.body.login || '').trim();
      const password = String(req.body.password || '');
      if (!/^[\p{L}\d_]{3,20}$/u.test(login)) fail('Login: 3–20 znaków (litery, cyfry, _).');
      if (password.length < 6) fail('Hasło musi mieć min. 6 znaków.');
      if (q('SELECT 1 FROM users WHERE login = ?').get(login)) fail('Login jest zajęty.');
      const r = q('INSERT INTO users (login, pass_hash, created_at) VALUES (?, ?, ?)').run(
        login,
        hashPassword(password),
        now(),
      );
      startSession(res, Number(r.lastInsertRowid));
    }),
  );

  app.post(
    '/api/login',
    route((req, res) => {
      const u = q('SELECT * FROM users WHERE login = ?').get(String(req.body.login || '').trim());
      if (!u || !verifyPassword(String(req.body.password || ''), u.pass_hash)) fail('Zły login lub hasło.', 401);
      startSession(res, u.id);
    }),
  );

  app.post(
    '/api/logout',
    route((req, res) => {
      if (req.token) q('DELETE FROM sessions WHERE token = ?').run(req.token);
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
    }),
  );

  // Konfiguracja gry dla klienta.
  app.get(
    '/api/config',
    route(() => ({
      positions: G.POSITIONS,
      stats: G.STATS,
      slots: G.SLOTS,
      items: G.ITEMS,
      energyMax: G.ENERGY_MAX,
      energyRegenMs: G.ENERGY_REGEN_MS,
      trainingEnergy: G.TRAINING_ENERGY,
      duelEnergy: G.DUEL_ENERGY,
      clubCreateCost: G.CLUB_CREATE_COST,
      clubMaxMembers: G.CLUB_MAX_MEMBERS,
      duelLevelRange: G.DUEL_LEVEL_RANGE,
    })),
  );

  // ---------- piłkarz ----------
  app.post(
    '/api/player',
    needUser,
    route((req) => {
      if (req.playerId) fail('Masz już piłkarza.');
      const name = String(req.body.name || '').trim();
      const position = String(req.body.position || '');
      if (!/^[\p{L}][\p{L}\d .'-]{2,23}$/u.test(name)) fail('Nazwa piłkarza: 3–24 znaki, zaczyna się literą.');
      if (!G.POSITIONS[position]) fail('Wybierz pozycję.');
      if (q('SELECT 1 FROM players WHERE name = ?').get(name)) fail('Ta nazwa jest zajęta.');
      const s = G.startingStats(position);
      q(`INSERT INTO players (user_id, name, position, energy_updated, created_at, last_seen,
          strzaly, podania, drybling, obrona, szybkosc, kondycja, bramkarstwo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        req.userId,
        name,
        position,
        now(),
        now(),
        now(),
        ...G.STAT_KEYS.map((k) => s[k]),
      );
    }),
  );

  app.get(
    '/api/me',
    route((req) => {
      if (!req.userId) return { user: null };
      const user = q('SELECT id, login FROM users WHERE id = ?').get(req.userId);
      if (!req.playerId) return { user, player: null };
      const p = loadPlayer(req.playerId);
      const base = baseStats(p);
      const progress = JSON.parse(p.training_progress);
      const club = p.club_id ? q('SELECT id, name, tag, owner_id FROM clubs WHERE id = ?').get(p.club_id) : null;
      const unread = q('SELECT COUNT(*) AS n FROM notifications WHERE player_id = ? AND read = 0').get(p.id).n;
      return {
        user,
        player: {
          ...publicPlayer(p),
          baseStats: base,
          training: Object.fromEntries(
            G.STAT_KEYS.map((k) => [
              k,
              { progress: progress[k] || 0, needed: G.trainingsNeeded(base[k]), cost: G.trainingCost(base[k]) },
            ]),
          ),
          xp: p.xp,
          xpNext: G.xpForNextLevel(p.level),
          money: p.money,
          energy: p.energy,
          energyUpdated: p.energy_updated,
          dailyReadyAt: p.last_daily + G.DAILY_BONUS_MS,
          dailyAmount: G.dailyBonusAmount(p.level),
          clubRole: club ? (club.owner_id === p.id ? 'owner' : 'member') : null,
          unread,
        },
        serverTime: now(),
      };
    }),
  );

  app.get(
    '/api/players/:id',
    needPlayer,
    route((req) => {
      const p = loadPlayer(Number(req.params.id));
      if (!p) fail('Nie ma takiego piłkarza.', 404);
      const matches = q(
        `SELECT id, home_name, away_name, home_score, away_score, home_id, created_at FROM matches
         WHERE kind = 'duel' AND (home_id = ? OR away_id = ?) ORDER BY id DESC LIMIT 10`,
      ).all(p.id, p.id);
      return { player: publicPlayer(p), matches };
    }),
  );

  // ---------- trening ----------
  app.post(
    '/api/train',
    needPlayer,
    route((req) => {
      const stat = String(req.body.stat || '');
      if (!G.STATS[stat]) fail('Nieznana statystyka.');
      return tx(db, () => {
        const p = loadPlayer(req.playerId);
        const cost = G.trainingCost(p[stat]);
        if (p.money < cost) fail(`Trening kosztuje ${cost} monet.`);
        spendEnergy(p, G.TRAINING_ENERGY);
        const progress = JSON.parse(p.training_progress);
        progress[stat] = (progress[stat] || 0) + 1;
        let improved = false;
        if (progress[stat] >= G.trainingsNeeded(p[stat])) {
          progress[stat] = 0;
          improved = true;
        }
        q(`UPDATE players SET money = money - ?, training_progress = ?, ${stat} = ${stat} + ? WHERE id = ?`).run(
          cost,
          JSON.stringify(progress),
          improved ? 1 : 0,
          p.id,
        );
        const lvl = grantXp(p.id, 5);
        return {
          message: improved
            ? `${G.STATS[stat]} wzrasta do ${p[stat] + 1}!`
            : `Trening zaliczony (${progress[stat]}/${G.trainingsNeeded(p[stat])}).`,
          levelUp: lvl.levelsUp > 0 ? lvl.level : null,
        };
      });
    }),
  );

  app.post(
    '/api/daily-bonus',
    needPlayer,
    route((req) =>
      tx(db, () => {
        const p = loadPlayer(req.playerId);
        if (now() < p.last_daily + G.DAILY_BONUS_MS) fail('Premię dzienną już odebrałeś.');
        const amount = G.dailyBonusAmount(p.level);
        q('UPDATE players SET money = money + ?, last_daily = ? WHERE id = ?').run(amount, now(), p.id);
        return { message: `Odebrano premię: ${amount} monet.` };
      }),
    ),
  );

  // ---------- sklep / ekwipunek ----------
  app.get(
    '/api/inventory',
    needPlayer,
    route((req) => ({
      items: q('SELECT item_id, equipped FROM inventory WHERE player_id = ?').all(req.playerId),
    })),
  );

  app.post(
    '/api/shop/buy',
    needPlayer,
    route((req) =>
      tx(db, () => {
        const item = G.ITEMS_BY_ID[req.body.itemId];
        if (!item) fail('Nie ma takiego przedmiotu.');
        const p = loadPlayer(req.playerId);
        if (p.level < item.level) fail(`Wymagany poziom ${item.level}.`);
        if (p.money < item.price) fail('Za mało monet.');
        if (q('SELECT 1 FROM inventory WHERE player_id = ? AND item_id = ?').get(p.id, item.id))
          fail('Masz już ten przedmiot.');
        q('UPDATE players SET money = money - ? WHERE id = ?').run(item.price, p.id);
        q('INSERT INTO inventory (player_id, item_id) VALUES (?, ?)').run(p.id, item.id);
        equip(p.id, item.id);
        return { message: `Kupiono: ${item.name}.` };
      }),
    ),
  );

  function equip(pid, itemId) {
    const item = G.ITEMS_BY_ID[itemId];
    const sameSlot = G.ITEMS.filter((i) => i.slot === item.slot).map((i) => i.id);
    for (const id of sameSlot) q('UPDATE inventory SET equipped = 0 WHERE player_id = ? AND item_id = ?').run(pid, id);
    q('UPDATE inventory SET equipped = 1 WHERE player_id = ? AND item_id = ?').run(pid, itemId);
  }

  app.post(
    '/api/inventory/equip',
    needPlayer,
    route((req) =>
      tx(db, () => {
        const itemId = String(req.body.itemId || '');
        if (!q('SELECT 1 FROM inventory WHERE player_id = ? AND item_id = ?').get(req.playerId, itemId))
          fail('Nie masz tego przedmiotu.');
        equip(req.playerId, itemId);
      }),
    ),
  );

  // ---------- sparingi (PvP) ----------
  app.get(
    '/api/opponents',
    needPlayer,
    route((req) => {
      const me = loadPlayer(req.playerId);
      const rows = q(
        `SELECT * FROM players WHERE id != ? AND level BETWEEN ? AND ?
         ORDER BY last_seen DESC LIMIT 30`,
      ).all(me.id, me.level - G.DUEL_LEVEL_RANGE, me.level + G.DUEL_LEVEL_RANGE);
      return { opponents: rows.map(publicPlayer) };
    }),
  );

  function saveMatch(kind, home, away, result, seed) {
    const r = q(
      `INSERT INTO matches (kind, home_id, away_id, home_name, away_name, home_score, away_score, events, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
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
    return Number(r.lastInsertRowid);
  }

  const outcome = (a, b) => (a > b ? 'win' : a < b ? 'loss' : 'draw');
  const RESULT_COL = { win: 'wins', draw: 'draws', loss: 'losses' };

  app.post(
    '/api/duel',
    needPlayer,
    route((req) =>
      tx(db, () => {
        const me = loadPlayer(req.playerId);
        const opp = loadPlayer(Number(req.body.opponentId));
        if (!opp || opp.id === me.id) fail('Nieprawidłowy rywal.');
        if (Math.abs(opp.level - me.level) > G.DUEL_LEVEL_RANGE)
          fail(`Rywal musi być w zasięgu ±${G.DUEL_LEVEL_RANGE} poziomów.`);
        spendEnergy(me, G.DUEL_ENERGY);
        const seed = crypto.randomInt(2 ** 31);
        const result = G.simulate(G.playerSide(me.name, effStats(me)), G.playerSide(opp.name, effStats(opp)), seed);
        const matchId = saveMatch('duel', me, opp, result, seed);
        const [gs, ga] = result.score;
        const myRes = outcome(gs, ga);
        const oppRes = outcome(ga, gs);
        const myRew = G.duelRewards(myRes, me.level);
        // Obrońca dostaje połowę nagrody (bez XP) – gra trwa, nawet gdy jest offline.
        const oppRew = G.duelRewards(oppRes, opp.level);
        q(`UPDATE players SET money = money + ?, ${RESULT_COL[myRes]} = ${RESULT_COL[myRes]} + 1, goals = goals + ? WHERE id = ?`).run(
          myRew.money,
          gs,
          me.id,
        );
        q(`UPDATE players SET money = money + ?, ${RESULT_COL[oppRes]} = ${RESULT_COL[oppRes]} + 1, goals = goals + ? WHERE id = ?`).run(
          Math.floor(oppRew.money / 2),
          ga,
          opp.id,
        );
        const lvl = grantXp(me.id, myRew.xp);
        notify(opp.id, `${me.name} wyzwał Cię na sparing. Wynik: ${gs}:${ga}.`);
        return { matchId, score: result.score, reward: myRew, levelUp: lvl.levelsUp > 0 ? lvl.level : null };
      }),
    ),
  );

  app.get(
    '/api/matches/:id',
    needPlayer,
    route((req) => {
      const m = q('SELECT * FROM matches WHERE id = ?').get(Number(req.params.id));
      if (!m) fail('Nie ma takiego meczu.', 404);
      return { match: { ...m, events: JSON.parse(m.events).events } };
    }),
  );

  app.get(
    '/api/my-matches',
    needPlayer,
    route((req) => ({
      matches: q(
        `SELECT id, home_id, away_id, home_name, away_name, home_score, away_score, created_at FROM matches
         WHERE kind = 'duel' AND (home_id = ? OR away_id = ?) ORDER BY id DESC LIMIT 20`,
      ).all(req.playerId, req.playerId),
    })),
  );

  // ---------- rankingi ----------
  app.get(
    '/api/ranking/players',
    needPlayer,
    route(() => {
      const rows = q(
        `SELECT * FROM players ORDER BY level DESC, xp DESC LIMIT 200`,
      ).all();
      return { players: rows.map(publicPlayer) };
    }),
  );

  app.get(
    '/api/ranking/clubs',
    needPlayer,
    route(() => ({
      clubs: q(
        `SELECT c.id, c.name, c.tag, c.points, c.wins, c.draws, c.losses,
           (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id) AS members
         FROM clubs c ORDER BY c.points DESC, c.wins DESC LIMIT 100`,
      ).all(),
    })),
  );

  // ---------- kluby ----------
  function clubMembers(clubId) {
    return q('SELECT * FROM players WHERE club_id = ? ORDER BY level DESC').all(clubId);
  }
  function requireOwner(req) {
    const p = loadPlayer(req.playerId);
    const club = p.club_id ? q('SELECT * FROM clubs WHERE id = ?').get(p.club_id) : null;
    if (!club || club.owner_id !== p.id) fail('Tylko prezes klubu może to zrobić.', 403);
    return { p, club };
  }

  app.post(
    '/api/clubs',
    needPlayer,
    route((req) =>
      tx(db, () => {
        const p = loadPlayer(req.playerId);
        if (p.club_id) fail('Jesteś już w klubie.');
        const name = String(req.body.name || '').trim();
        const tag = String(req.body.tag || '').trim().toUpperCase();
        if (!/^[\p{L}\d][\p{L}\d .'-]{2,29}$/u.test(name)) fail('Nazwa klubu: 3–30 znaków.');
        if (!/^[A-Z0-9]{2,4}$/.test(tag)) fail('Skrót klubu: 2–4 litery/cyfry.');
        if (p.money < G.CLUB_CREATE_COST) fail(`Założenie klubu kosztuje ${G.CLUB_CREATE_COST} monet.`);
        if (q('SELECT 1 FROM clubs WHERE name = ? OR tag = ?').get(name, tag)) fail('Nazwa lub skrót są zajęte.');
        const r = q('INSERT INTO clubs (name, tag, owner_id, created_at) VALUES (?, ?, ?, ?)').run(name, tag, p.id, now());
        const clubId = Number(r.lastInsertRowid);
        q('UPDATE players SET money = money - ?, club_id = ? WHERE id = ?').run(G.CLUB_CREATE_COST, clubId, p.id);
        q('DELETE FROM club_applications WHERE player_id = ?').run(p.id);
        return { clubId };
      }),
    ),
  );

  app.get(
    '/api/clubs',
    needPlayer,
    route(() => ({
      clubs: q(
        `SELECT c.id, c.name, c.tag, c.points, (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id) AS members
         FROM clubs c ORDER BY c.points DESC, c.name LIMIT 200`,
      ).all(),
    })),
  );

  app.get(
    '/api/clubs/:id',
    needPlayer,
    route((req) => {
      const club = q('SELECT * FROM clubs WHERE id = ?').get(Number(req.params.id));
      if (!club) fail('Nie ma takiego klubu.', 404);
      const me = loadPlayer(req.playerId);
      const isMember = me.club_id === club.id;
      const isOwner = club.owner_id === me.id;
      const members = clubMembers(club.id).map(publicPlayer);
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
        applied: !!q('SELECT 1 FROM club_applications WHERE club_id = ? AND player_id = ?').get(club.id, me.id),
        applications: isOwner
          ? q(
              `SELECT p.id, p.name, p.level, p.position FROM club_applications a JOIN players p ON p.id = a.player_id
               WHERE a.club_id = ? ORDER BY a.created_at`,
            ).all(club.id)
          : [],
        matches: q(
          `SELECT id, home_id, away_id, home_name, away_name, home_score, away_score, created_at FROM matches
           WHERE kind = 'club' AND (home_id = ? OR away_id = ?) ORDER BY id DESC LIMIT 10`,
        ).all(club.id, club.id),
      };
    }),
  );

  app.post(
    '/api/clubs/:id/apply',
    needPlayer,
    route((req) => {
      const p = loadPlayer(req.playerId);
      const club = q('SELECT * FROM clubs WHERE id = ?').get(Number(req.params.id));
      if (!club) fail('Nie ma takiego klubu.', 404);
      if (p.club_id) fail('Jesteś już w klubie.');
      q('INSERT OR IGNORE INTO club_applications (club_id, player_id, created_at) VALUES (?, ?, ?)').run(
        club.id,
        p.id,
        now(),
      );
      notify(club.owner_id, `${p.name} chce dołączyć do klubu ${club.name}.`);
      return { message: 'Wysłano zgłoszenie.' };
    }),
  );

  app.post(
    '/api/clubs/applications/:playerId',
    needPlayer,
    route((req) =>
      tx(db, () => {
        const { club } = requireOwner(req);
        const pid = Number(req.params.playerId);
        const appRow = q('SELECT 1 FROM club_applications WHERE club_id = ? AND player_id = ?').get(club.id, pid);
        if (!appRow) fail('Brak takiego zgłoszenia.');
        q('DELETE FROM club_applications WHERE club_id = ? AND player_id = ?').run(club.id, pid);
        if (req.body.accept) {
          const target = loadPlayer(pid);
          if (target.club_id) fail('Ten gracz jest już w innym klubie.');
          if (clubMembers(club.id).length >= G.CLUB_MAX_MEMBERS) fail('Klub jest pełny.');
          q('UPDATE players SET club_id = ? WHERE id = ?').run(club.id, pid);
          q('DELETE FROM club_applications WHERE player_id = ?').run(pid);
          notify(pid, `Zostałeś przyjęty do klubu ${club.name}!`);
        } else {
          notify(pid, `Klub ${club.name} odrzucił Twoje zgłoszenie.`);
        }
      }),
    ),
  );

  app.post(
    '/api/clubs/kick/:playerId',
    needPlayer,
    route((req) => {
      const { p, club } = requireOwner(req);
      const pid = Number(req.params.playerId);
      if (pid === p.id) fail('Nie możesz wyrzucić siebie.');
      const r = q('UPDATE players SET club_id = NULL WHERE id = ? AND club_id = ?').run(pid, club.id);
      if (!r.changes) fail('Ten gracz nie jest w Twoim klubie.');
      notify(pid, `Zostałeś usunięty z klubu ${club.name}.`);
    }),
  );

  app.post(
    '/api/clubs/leave',
    needPlayer,
    route((req) =>
      tx(db, () => {
        const p = loadPlayer(req.playerId);
        if (!p.club_id) fail('Nie jesteś w klubie.');
        const club = q('SELECT * FROM clubs WHERE id = ?').get(p.club_id);
        q('UPDATE players SET club_id = NULL WHERE id = ?').run(p.id);
        if (club.owner_id === p.id) {
          const next = q('SELECT id FROM players WHERE club_id = ? ORDER BY level DESC LIMIT 1').get(club.id);
          if (next) {
            q('UPDATE clubs SET owner_id = ? WHERE id = ?').run(next.id, club.id);
            notify(next.id, `Zostałeś nowym prezesem klubu ${club.name}.`);
          } else {
            q("DELETE FROM messages WHERE channel = ?").run(`club:${club.id}`);
            q('DELETE FROM clubs WHERE id = ?').run(club.id);
          }
        }
      }),
    ),
  );

  app.post(
    '/api/clubs/donate',
    needPlayer,
    route((req) =>
      tx(db, () => {
        const p = loadPlayer(req.playerId);
        const amount = Math.floor(Number(req.body.amount));
        if (!p.club_id) fail('Nie jesteś w klubie.');
        if (!(amount > 0)) fail('Podaj kwotę.');
        if (p.money < amount) fail('Za mało monet.');
        q('UPDATE players SET money = money - ? WHERE id = ?').run(amount, p.id);
        q('UPDATE clubs SET treasury = treasury + ? WHERE id = ?').run(amount, p.club_id);
        return { message: `Wpłacono ${amount} monet do kasy klubu.` };
      }),
    ),
  );

  app.post(
    '/api/clubs/description',
    needPlayer,
    route((req) => {
      const { club } = requireOwner(req);
      q('UPDATE clubs SET description = ? WHERE id = ?').run(String(req.body.description || '').slice(0, 500), club.id);
    }),
  );

  // Mecz klubowy – prezes wyzywa inny klub.
  app.post(
    '/api/clubs/challenge/:clubId',
    needPlayer,
    route((req) =>
      tx(db, () => {
        const { club } = requireOwner(req);
        const opp = q('SELECT * FROM clubs WHERE id = ?').get(Number(req.params.clubId));
        if (!opp || opp.id === club.id) fail('Nieprawidłowy rywal.');
        if (now() < club.last_match + G.CLUB_MATCH_COOLDOWN_MS) fail('Twój klub musi odpocząć przed kolejnym meczem.');
        const toTeam = (c) => {
          const members = clubMembers(c.id)
            .slice(0, 11)
            .map((m) => ({ name: m.name, position: m.position, stats: effStats(m), id: m.id }));
          return { members, side: G.teamSide(c.name, members) };
        };
        const home = toTeam(club);
        const away = toTeam(opp);
        if (home.members.length < 3) fail('Potrzebujesz min. 3 zawodników w klubie.');
        if (away.members.length < 3) fail('Rywal ma za mało zawodników.');
        const seed = crypto.randomInt(2 ** 31);
        const result = G.simulate(home.side, away.side, seed, 20);
        const matchId = saveMatch('club', club, opp, result, seed);
        const [hs, as] = result.score;
        const settle = (c, team, res, gf) => {
          const rew = G.clubMatchRewards(res);
          q(`UPDATE clubs SET points = points + ?, treasury = treasury + ?, ${RESULT_COL[res]} = ${RESULT_COL[res]} + 1 WHERE id = ?`).run(
            rew.points,
            rew.treasury,
            c.id,
          );
          for (const m of team.members) {
            grantXp(m.id, rew.xp);
            notify(m.id, `Mecz klubowy ${club.name} – ${opp.name}: ${hs}:${as}.`);
          }
          return rew;
        };
        settle(club, home, outcome(hs, as), hs);
        settle(opp, away, outcome(as, hs), as);
        q('UPDATE clubs SET last_match = ? WHERE id = ?').run(now(), club.id);
        return { matchId, score: result.score };
      }),
    ),
  );

  // ---------- czat ----------
  function channelFor(req, channel) {
    if (channel === 'global') return 'global';
    if (channel === 'club') {
      const p = loadPlayer(req.playerId);
      if (!p.club_id) fail('Nie jesteś w klubie.');
      return `club:${p.club_id}`;
    }
    fail('Nieznany kanał.');
  }

  app.get(
    '/api/chat/:channel',
    needPlayer,
    route((req) => {
      const ch = channelFor(req, req.params.channel);
      const after = Number(req.query.after) || 0;
      const rows = q(
        `SELECT m.id, m.body, m.created_at, p.id AS player_id, p.name FROM messages m
         JOIN players p ON p.id = m.player_id WHERE m.channel = ? AND m.id > ? ORDER BY m.id DESC LIMIT 50`,
      ).all(ch, after);
      return { messages: rows.reverse() };
    }),
  );

  app.post(
    '/api/chat/:channel',
    needPlayer,
    route((req) => {
      const ch = channelFor(req, req.params.channel);
      const body = String(req.body.body || '').trim().slice(0, 300);
      if (!body) fail('Pusta wiadomość.');
      const last = q('SELECT created_at FROM messages WHERE player_id = ? ORDER BY id DESC LIMIT 1').get(req.playerId);
      if (last && now() - last.created_at < 1500) fail('Zwolnij trochę.');
      q('INSERT INTO messages (channel, player_id, body, created_at) VALUES (?, ?, ?, ?)').run(ch, req.playerId, body, now());
    }),
  );

  // ---------- powiadomienia ----------
  app.get(
    '/api/notifications',
    needPlayer,
    route((req) => {
      const rows = q('SELECT * FROM notifications WHERE player_id = ? ORDER BY id DESC LIMIT 50').all(req.playerId);
      q('UPDATE notifications SET read = 1 WHERE player_id = ?').run(req.playerId);
      return { notifications: rows };
    }),
  );

  app.use('/api', (req, res) => res.status(404).json({ error: 'Nie znaleziono.' }));

  return app;
}
