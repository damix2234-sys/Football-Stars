import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../server/game.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

test('energia regeneruje się w czasie i nie przekracza maksimum', () => {
  const t0 = 1_000_000;
  assert.equal(G.currentEnergy(50, t0, t0 + G.ENERGY_REGEN_MS * 3).energy, 53);
  assert.equal(G.currentEnergy(95, t0, t0 + G.ENERGY_REGEN_MS * 100).energy, G.ENERGY_MAX);
  assert.equal(G.currentEnergy(50, t0, t0 + G.ENERGY_REGEN_MS - 1).energy, 50);
});

test('awans poziomu przenosi nadmiar XP', () => {
  assert.deepEqual(G.addXp(1, 90, 30), { level: 2, xp: 20, levelsUp: 1 });
  assert.deepEqual(G.addXp(1, 0, 350), { level: 3, xp: 50, levelsUp: 2 });
});

test('symulacja jest deterministyczna i lepszy zawodnik zwykle wygrywa', () => {
  const weak = G.playerSide('Słaby', G.startingStats('NAP'));
  const strongStats = Object.fromEntries(G.STAT_KEYS.map((k) => [k, 30]));
  const strong = G.playerSide('Mocny', strongStats);
  assert.deepEqual(G.simulate(weak, strong, 42), G.simulate(weak, strong, 42));
  let strongWins = 0;
  for (let s = 0; s < 300; s++) {
    const { score } = G.simulate(weak, strong, s);
    if (score[1] > score[0]) strongWins++;
  }
  assert.ok(strongWins > 200, `mocny wygrał tylko ${strongWins}/300`);
});

test('przedmioty dodają bonusy do statystyk', () => {
  const s = G.effectiveStats(G.startingStats('POM'), ['buty1', 'rek1']);
  assert.equal(s.szybkosc, G.startingStats('POM').szybkosc + 1);
  assert.equal(s.bramkarstwo, G.startingStats('POM').bramkarstwo + 1);
});

// --- test integracyjny API ---
async function withServer(fn) {
  const db = openDb(':memory:');
  const server = createApp(db).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

function client(base) {
  let cookie = '';
  return async (path, body) => {
    const res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

test('pełny przebieg: rejestracja, trening, sparing, klub', async () => {
  await withServer(async (base) => {
    const a = client(base);
    const b = client(base);
    const c = client(base);
    for (const [cl, n, pos] of [[a, 'Adam', 'NAP'], [b, 'Bartek', 'BR'], [c, 'Celina', 'POM']]) {
      assert.equal((await cl('/register', { login: n.toLowerCase(), password: 'tajne123' })).status, 200);
      assert.equal((await cl('/player', { name: n + ' Testowy', position: pos })).status, 200);
    }
    const me = (await a('/me')).data.player;
    assert.equal(me.energy, 100);

    const tr = await a('/train', { stat: 'strzaly' });
    assert.equal(tr.status, 200, JSON.stringify(tr.data));
    assert.equal((await a('/me')).data.player.energy, 90);

    const bId = (await b('/me')).data.player.id;
    const duel = await a('/duel', { opponentId: bId });
    assert.equal(duel.status, 200, JSON.stringify(duel.data));
    const match = await a('/matches/' + duel.data.matchId);
    assert.ok(match.data.match.events.length > 0);

    // klub: Adam potrzebuje 500 monet – dostaje je z premii i sparingów
    await a('/daily-bonus', {});
    let money = (await a('/me')).data.player.money;
    while (money < 500) {
      const r = await a('/duel', { opponentId: bId });
      if (r.status !== 200) break;
      money = (await a('/me')).data.player.money;
    }
    const club = await a('/clubs', { name: 'Orły Testowe', tag: 'ORL' });
    assert.equal(club.status, 200, JSON.stringify(club.data));
    const clubId = club.data.clubId;

    await b(`/clubs/${clubId}/apply`, {});
    await c(`/clubs/${clubId}/apply`, {});
    const cId = (await c('/me')).data.player.id;
    assert.equal((await a(`/clubs/applications/${bId}`, { accept: true })).status, 200);
    assert.equal((await a(`/clubs/applications/${cId}`, { accept: true })).status, 200);
    const info = await a('/clubs/' + clubId);
    assert.equal(info.data.members.length, 3);

    // nie-prezes nie może wyrzucać
    assert.equal((await b(`/clubs/kick/${cId}`, {})).status, 403);

    // czat klubowy
    assert.equal((await b('/chat/club', { body: 'Cześć drużyno!' })).status, 200);
    const chat = await a('/chat/club');
    assert.equal(chat.data.messages[0].body, 'Cześć drużyno!');
  });
});
