import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file = process.env.DB_FILE || path.join(process.cwd(), 'data', 'game.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      position TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      money INTEGER NOT NULL DEFAULT 300,
      energy INTEGER NOT NULL DEFAULT 100,
      energy_updated INTEGER NOT NULL,
      strzaly INTEGER NOT NULL,
      podania INTEGER NOT NULL,
      drybling INTEGER NOT NULL,
      obrona INTEGER NOT NULL,
      szybkosc INTEGER NOT NULL,
      kondycja INTEGER NOT NULL,
      bramkarstwo INTEGER NOT NULL,
      training_progress TEXT NOT NULL DEFAULT '{}',
      wins INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      goals INTEGER NOT NULL DEFAULT 0,
      club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL,
      last_daily INTEGER NOT NULL DEFAULT 0,
      last_seen INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      equipped INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS clubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
      owner_id INTEGER NOT NULL REFERENCES players(id),
      treasury INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      last_match INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS club_applications (
      club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (club_id, player_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,             -- 'duel' | 'club'
      home_id INTEGER NOT NULL,
      away_id INTEGER NOT NULL,
      home_name TEXT NOT NULL,
      away_name TEXT NOT NULL,
      home_score INTEGER NOT NULL,
      away_score INTEGER NOT NULL,
      events TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS matches_home ON matches(kind, home_id);
    CREATE INDEX IF NOT EXISTS matches_away ON matches(kind, away_id);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,          -- 'global' | 'club:<id>'
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel, id);

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_player ON notifications(player_id, id);
  `);
  return db;
}

// Prosta transakcja dla synchronicznego node:sqlite.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
