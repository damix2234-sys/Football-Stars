// Warstwa bazy danych – PostgreSQL.
// Produkcja: DATABASE_URL (np. darmowy Neon). Lokalnie/testy: PGlite (Postgres w Node, bez instalacji).
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    login TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_login ON users (lower(login));

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position TEXT NOT NULL,
    ovr INTEGER NOT NULL DEFAULT 0,
    money INTEGER NOT NULL DEFAULT 1000,
    energy INTEGER NOT NULL DEFAULT 500,
    energy_updated BIGINT NOT NULL,
    skills TEXT NOT NULL,
    training_progress TEXT NOT NULL DEFAULT '{}',
    last_train BIGINT NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    goals INTEGER NOT NULL DEFAULT 0,
    club_id INTEGER,
    last_daily BIGINT NOT NULL DEFAULT 0,
    last_seen BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS players_name ON players (lower(name));
  CREATE INDEX IF NOT EXISTS players_club ON players (club_id);
  CREATE INDEX IF NOT EXISTS players_ovr ON players (ovr DESC);

  CREATE TABLE IF NOT EXISTS auto_trainings (
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    spec TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    count INTEGER NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    energy_total INTEGER NOT NULL,
    money_total INTEGER NOT NULL,
    PRIMARY KEY (player_id, spec)
  );

  CREATE TABLE IF NOT EXISTS inventory (
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    equipped INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS clubs (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    tag TEXT NOT NULL UNIQUE,
    owner_id INTEGER NOT NULL,
    treasury INTEGER NOT NULL DEFAULT 0,
    points INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    last_match BIGINT NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS clubs_name ON clubs (lower(name));

  CREATE TABLE IF NOT EXISTS penalty_duels (
    id SERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    opponent_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    seed BIGINT NOT NULL,
    state TEXT NOT NULL,
    finished INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS penalty_active ON penalty_duels (player_id, finished);
  ALTER TABLE penalty_duels ALTER COLUMN opponent_id DROP NOT NULL;
  CREATE INDEX IF NOT EXISTS penalty_active_away ON penalty_duels (opponent_id, finished);

  -- kolejka wyszukiwania przeciwnika w pojedynkach
  CREATE TABLE IF NOT EXISTS penalty_queue (
    player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    ovr INTEGER NOT NULL,
    joined_at BIGINT NOT NULL
  );

  -- wyniki pojedynków karnych (osobno od rankingu OVR)
  ALTER TABLE players ADD COLUMN IF NOT EXISTS pk_played INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS pk_wins INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS pk_losses INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS pk_goals INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN IF NOT EXISTS pk_conceded INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE IF NOT EXISTS club_applications (
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (club_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS matches (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    home_id INTEGER NOT NULL,
    away_id INTEGER NOT NULL,
    home_name TEXT NOT NULL,
    away_name TEXT NOT NULL,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    events TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS matches_home ON matches (kind, home_id);
  CREATE INDEX IF NOT EXISTS matches_away ON matches (kind, away_id);

  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    channel TEXT NOT NULL,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_channel ON messages (channel, id);

  CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notifications_player ON notifications (player_id, id);
`;

// Zamienia znaki zapytania na $1, $2, ... (w naszym SQL nie ma "?" w tekstach).
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Zwraca obiekt z metodami:
 *   get(sql, ...params)  -> pierwszy wiersz lub undefined
 *   all(sql, ...params)  -> tablica wierszy
 *   run(sql, ...params)  -> { changes, rows }
 *   tx(async () => ...)  -> transakcja; zapytania wewnątrz trafiają do niej automatycznie
 *   inTx()               -> czy jesteśmy w transakcji
 *   close()
 */
export async function openDb({ url = process.env.DATABASE_URL, dir = process.env.PGLITE_DIR } = {}) {
  const als = new AsyncLocalStorage();
  let base; // { query(sql, params) -> {rows, rowCount} }
  let transaction;
  let close;

  if (url) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(20, Number); // BIGINT i COUNT(*) jako liczby
    const pool = new pg.Pool({
      connectionString: url,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
      max: 5,
    });
    base = { query: (sql, params) => pool.query(sql, params) };
    transaction = async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await als.run(client, fn);
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    };
    close = () => pool.end();
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    if (dir && dir !== 'memory') fs.mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
    const lite = dir && dir !== 'memory' ? new PGlite(dir) : new PGlite();
    base = {
      query: async (sql, params) => {
        const r = await lite.query(sql, params);
        return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
      },
    };
    transaction = (fn) =>
      lite.transaction((t) =>
        als.run(
          {
            query: async (sql, params) => {
              const r = await t.query(sql, params);
              return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
            },
          },
          fn,
        ),
      );
    close = () => lite.close();
  }

  const exec = (sql, params) => (als.getStore() || base).query(toPg(sql), params);
  const db = {
    get: async (sql, ...p) => (await exec(sql, p)).rows[0],
    all: async (sql, ...p) => (await exec(sql, p)).rows,
    run: async (sql, ...p) => {
      const r = await exec(sql, p);
      return { changes: r.rowCount, rows: r.rows };
    },
    tx: (fn) => (als.getStore() ? fn() : transaction(fn)),
    inTx: () => !!als.getStore(),
    close,
  };

  // Schemat zakładamy instrukcja po instrukcji (pg nie lubi wielu w jednym zapytaniu z parametrami).
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) await base.query(stmt);
  return db;
}
