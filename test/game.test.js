import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../server/game.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

test('energia regeneruje się w czasie i nie przekracza maksimum', () => {
  const t0 = 1_000_000;
  assert.equal(G.currentEnergy(50, t0, t0 + G.ENERGY_REGEN_MS * 3).energy, 53);
  assert.equal(G.currentEnergy(G.ENERGY_MAX - 5, t0, t0 + G.ENERGY_REGEN_MS * 100).energy, G.ENERGY_MAX);
  assert.equal(G.currentEnergy(50, t0, t0 + G.ENERGY_REGEN_MS - 1).energy, 50);
});

test('trening podnosi poziom specjalizacji, a plan automatu pilnuje budżetu', () => {
  const need = G.trainingsNeeded(10);
  assert.deepEqual(G.applyTrainings(10, 0, need), { level: 11, progress: 0, gained: 1 });
  assert.equal(G.applyTrainings(10, 0, need - 1).level, 10);
  // brak pieniędzy = zero treningów
  assert.equal(G.planAuto(10, 0, 500, 0, 1).count, 0);
  // budżet nigdy nie jest przekroczony, a czas ogranicza liczbę treningów
  const p = G.planAuto(10, 0, 300, 5000, 1);
  assert.ok(p.energy <= 300 && p.money <= 5000);
  assert.ok(G.planAuto(1, 0, 1e9, 1e9, 0.25).count <= (0.25 * 3600) / 5);
  // OVR = suma specjalizacji, kategoria = suma jej dwóch specjalizacji
  const s = G.startingSkills('NAP');
  assert.equal(G.ovr(s), G.SPEC_KEYS.reduce((a, k) => a + s[k], 0));
  assert.equal(G.categoryOvr(s, 'atak'), s.wykonczenie + s.drybling);
});

test('symulacja jest deterministyczna i lepszy zawodnik zwykle wygrywa', () => {
  const weak = G.playerSide('Słaby', G.startingSkills('NAP'));
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
  const s = G.effectiveStats(G.startingSkills('POM'), ['buty1', 'rek1']);
  assert.equal(s.szybkosc, G.startingSkills('POM').szybkosc + 2);
  assert.equal(s.chwytanie, G.startingSkills('POM').chwytanie + 2);
});

// --- test integracyjny API ---
async function withServer(fn) {
  // TEST_DATABASE_URL pozwala puścić ten sam test na prawdziwym PostgreSQL (pustej bazie).
  const db = await openDb({ url: process.env.TEST_DATABASE_URL || '', dir: 'memory' });
  const clock = { t: Date.now() };
  const server = createApp(db, { now: () => clock.t }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    await fn(base, clock);
  } finally {
    server.close();
    await db.close();
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

test('pełny przebieg: rejestracja, trening, mecz, klub', async () => {
  await withServer(async (base, clock) => {
    const a = client(base);
    const b = client(base);
    const c = client(base);
    for (const [cl, n, pos] of [[a, 'Adam', 'NAP'], [b, 'Bartek', 'BR'], [c, 'Celina', 'POM']]) {
      assert.equal((await cl('/register', { login: n.toLowerCase(), password: 'tajne123' })).status, 200);
      assert.equal((await cl('/player', { name: n + ' Testowy', position: pos })).status, 200);
    }
    const me = (await a('/me')).data.player;
    assert.equal(me.energy, G.ENERGY_MAX);
    assert.equal(me.ovr, G.ovr(G.startingSkills('NAP')));

    // trening ręczny + przerwa 5 s
    const tr = await a('/train', { spec: 'wykonczenie' });
    assert.equal(tr.status, 200, JSON.stringify(tr.data));
    const cost = G.trainCost(me.training.specs.wykonczenie.level);
    assert.equal((await a('/me')).data.player.energy, G.ENERGY_MAX - cost.energy);
    assert.equal((await a('/train', { spec: 'wykonczenie' })).status, 400); // za szybko
    clock.t += G.TRAIN_COOLDOWN_MS;
    assert.equal((await a('/train', { spec: 'wykonczenie' })).status, 200);

    // trening automatyczny: plan, start, postęp w czasie, anulowanie ze zwrotem
    const plan = (await a('/auto/plan', { spec: 'drybling', hours: 0.25 })).data;
    assert.ok(plan.count > 0, JSON.stringify(plan));
    const before = (await a('/me')).data.player;
    assert.equal((await a('/auto/start', { spec: 'drybling', hours: 0.25 })).status, 200);
    const started = (await a('/me')).data.player;
    assert.equal(started.money, before.money - plan.money);
    assert.equal((await a('/train', { spec: 'drybling' })).status, 400); // trenuje automatycznie
    clock.t += Math.floor(plan.count / 2) * G.TRAIN_COOLDOWN_MS;
    const mid = (await a('/me')).data.player;
    assert.ok(mid.training.specs.drybling.level >= before.training.specs.drybling.level);
    assert.equal(mid.training.autos[0].done, Math.floor(plan.count / 2));
    assert.equal((await a('/auto/cancel', { spec: 'drybling' })).status, 200);
    const afterCancel = (await a('/me')).data.player;
    assert.ok(afterCancel.money > mid.money, 'zwrot za niewykonane treningi');
    assert.equal(afterCancel.training.autos.length, 0);

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
      if (r.status !== 200) clock.t += 3600e3;
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

    // drugi klub i mecz klubowy
    const others = [];
    for (const [n, pos] of [['Dawid', 'BR'], ['Ewa', 'OBR'], ['Filip', 'NAP']]) {
      const cl = client(base);
      await cl('/register', { login: n.toLowerCase(), password: 'tajne123' });
      await cl('/player', { name: n + ' Testowy', position: pos });
      cl.id = (await cl('/me')).data.player.id;
      others.push(cl);
    }
    const [d, e, f] = others;
    await d('/daily-bonus', {});
    let dm = (await d('/me')).data.player.money;
    while (dm < 500) {
      if ((await d('/duel', { opponentId: e.id })).status !== 200) clock.t += 3600e3;
      dm = (await d('/me')).data.player.money;
    }
    const club2 = await d('/clubs', { name: 'Rywale FC', tag: 'RYW' });
    assert.equal(club2.status, 200, JSON.stringify(club2.data));
    for (const cl of [e, f]) {
      await cl(`/clubs/${club2.data.clubId}/apply`, {});
      await d(`/clubs/applications/${cl.id}`, { accept: true });
    }
    const cm = await a(`/clubs/challenge/${club2.data.clubId}`, {});
    assert.equal(cm.status, 200, JSON.stringify(cm.data));
    assert.equal((await a(`/clubs/challenge/${club2.data.clubId}`, {})).status, 400); // przerwa między meczami
    const table = (await a('/ranking/clubs')).data.clubs;
    assert.equal(table.reduce((s, c) => s + c.wins + c.draws + c.losses, 0), 2);

    // prezes odchodzi – funkcję przejmuje inny zawodnik
    assert.equal((await a('/clubs/leave', {})).status, 200);
    const after = (await b('/clubs/' + clubId)).data;
    assert.equal(after.members.length, 2);
    assert.notEqual(after.club.ownerId, (await a('/me')).data.player.id);
  });
});
