import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../server/game.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

test('energia regeneruje się w czasie bez limitu', () => {
  const t0 = 1_000_000;
  assert.equal(G.currentEnergy(50, t0, t0 + G.ENERGY_REGEN_MS * 3).energy, 53);
  assert.equal(G.currentEnergy(500, t0, t0 + G.ENERGY_REGEN_MS * 100).energy, 600); // bez limitu
  assert.equal(G.currentEnergy(50, t0, t0 + G.ENERGY_REGEN_MS - 1).energy, 50);
});

test('trening podnosi poziom specjalizacji, a plan automatu pilnuje budżetu', () => {
  const need = G.trainingsNeeded(10);
  assert.deepEqual(G.applyTrainings(10, 0, need), { level: 11, progress: 0, gained: 1 });
  assert.equal(G.applyTrainings(10, 0, need - 1).level, 10);
  // czas zawsze daje pełną liczbę treningów; brak środków = plan oznaczony jako niedostępny
  const p = G.planAuto(10, 0, 500, 0, 1);
  assert.equal(p.count, 720);
  assert.equal(p.affordable, false);
  assert.equal(p.missingMoney, p.money);
  assert.ok(G.planAuto(10, 0, 1e9, 1e9, 1).affordable);
  // OVR = suma specjalizacji, kategoria = suma jej dwóch specjalizacji
  const s = G.startingSkills('NAP');
  assert.equal(G.ovr(s), G.SPEC_KEYS.reduce((a, k) => a + s[k], 0));
  assert.equal(G.categoryOvr(s, 'atak'), s.wykonczenie + s.drybling);
});

test('karne: lepszy strzelec trafia częściej, seria kończy się poprawnie', () => {
  const r = G.rng(1);
  const rate = (shooter) => {
    let g = 0;
    for (let i = 0; i < 2000; i++) {
      const ball = G.ballLanding({ x: 0.7, y: 0.5 }, shooter, r);
      if (G.resolveKick(ball, { x: -0.7, y: 0.5 }, 20) === 'goal') g++;
    }
    return g;
  };
  assert.ok(rate(200) > rate(10), 'celność rośnie z wykończeniem');
  assert.equal(G.resolveKick({ x: 1.2, y: 0.5 }, { x: 0, y: 0.5 }, 20), 'miss');
  assert.equal(G.resolveKick({ x: 0, y: 0.5 }, { x: 0, y: 0.5 }, 20), 'save');
  assert.deepEqual(G.penaltyStatus({ my: ['goal', 'goal', 'goal'], op: ['save', 'save', 'save'] }).result, 'win');
  assert.equal(G.penaltyStatus({ my: Array(5).fill('goal'), op: Array(5).fill('goal') }).finished, false); // seria trwa dalej
  assert.equal(G.penaltyStatus({ my: [...Array(5).fill('goal'), 'save'], op: [...Array(5).fill('goal'), 'goal'] }).result, 'loss');
  assert.equal(G.penaltyStatus({ first: 'op', my: [], op: [] }).turn, 'save'); // rywal zaczyna
  assert.equal(G.resolveKick({ x: 1.03, y: 0.5 }, { x: 0, y: 0.5 }, 20), 'post');
  // mocniejszy strzał trudniej obronić: ten sam punkt, ten sam bramkarz
  const edge = { x: 0.42, y: 0.5 };
  assert.equal(G.resolveKick(edge, { x: 0, y: 0.5 }, 20, 0), 'save');
  assert.equal(G.resolveKick(edge, { x: 0, y: 0.5 }, 20, 300), 'goal');
  assert.equal(G.penaltyStatus({ my: Array(5).fill('goal'), op: Array(4).fill('goal') }).turn, 'save');
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

test('pełny przebieg: rejestracja, trening, wyszukiwanie i pojedynek karnych, klub', async () => {
  await withServer(async (base, clock) => {
    const a = client(base);
    const b = client(base);
    const c = client(base);
    for (const [cl, n, pos] of [[a, 'Adam', 'NAP'], [b, 'Bartek', 'BR'], [c, 'Celina', 'POM']]) {
      assert.equal((await cl('/register', { login: n.toLowerCase(), password: 'tajne123' })).status, 200);
      assert.equal((await cl('/player', { name: n + ' Testowy', position: pos })).status, 200);
    }
    const me = (await a('/me')).data.player;
    assert.equal(me.energy, G.START_ENERGY);
    assert.equal(me.ovr, G.ovr(G.startingSkills('NAP')));

    // trening ręczny + przerwa 5 s
    const tr = await a('/train', { spec: 'wykonczenie' });
    assert.equal(tr.status, 200, JSON.stringify(tr.data));
    const cost = G.trainCost(me.training.specs.wykonczenie.level);
    assert.equal((await a('/me')).data.player.energy, G.START_ENERGY - cost.energy);
    assert.equal((await a('/train', { spec: 'wykonczenie' })).status, 400); // za szybko
    clock.t += G.TRAIN_COOLDOWN_MS;
    assert.equal((await a('/train', { spec: 'wykonczenie' })).status, 200);

    // trening automatyczny: plan, start, postęp w czasie, anulowanie ze zwrotem
    const plans = (await a('/auto/plan', { spec: 'drybling' })).data;
    assert.equal(plans.options.length, G.AUTO_OPTIONS.length);
    const plan = plans.options[0]; // 5 minut
    assert.equal(plan.count, 60);
    assert.ok(plan.affordable, JSON.stringify(plan));
    const big = plans.options.at(-1); // 8 godzin: za drogo dla nowego gracza
    assert.equal(big.affordable, false);
    const refused = await a('/auto/start', { spec: 'drybling', hours: big.hours });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /Za mało/);
    const before = (await a('/me')).data.player;
    assert.equal((await a('/auto/start', { spec: 'drybling', hours: plan.hours })).status, 200);
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
    // --- pojedynki: wyszukiwanie przeciwnika i gra na żywo (gracz na gracza) ---
    const meA0 = (await a('/me')).data.player;
    const meB0 = (await b('/me')).data.player;
    assert.equal((await a('/pvp/search', {})).data.state, 'searching');
    assert.equal((await a('/pvp/status')).data.state, 'searching');
    const found = await b('/pvp/search', {});
    assert.equal(found.data.state, 'found', JSON.stringify(found.data));
    assert.equal(found.data.duel.mode, 'pvp');
    const duelId = found.data.duel.id;
    assert.equal((await a('/pvp/status')).data.duel.id, duelId);
    clock.t += G.PENALTY_TOSS_MS;
    // rozegranie: kto ma ruch, ten klika (strzały zawsze w światło bramki)
    let view;
    for (let i = 0; i < 80; i++) {
      const va = (await a('/penalty/current')).data.duel;
      if (!va) break;
      view = va;
      const vb = (await b('/penalty/current')).data.duel;
      for (const [cl, v] of [[a, va], [b, vb]]) {
        if (v && v.status.turn && !v.waiting) {
          const r = await cl(`/penalty/${duelId}/kick`, v.status.turn === 'shoot' ? { x: (i % 3) * 0.5 - 0.5, y: 0.5 } : { x: 0.6, y: 0.4 });
          assert.equal(r.status, 200, JSON.stringify(r.data));
        }
      }
      clock.t += G.PENALTY_ANIM_MS;
    }
    const endA = (await a(`/penalty/${duelId}`)).data.duel;
    const endB = (await b(`/penalty/${duelId}`)).data.duel;
    assert.ok(endA.status.finished, 'seria musi się zakończyć');
    // obie strony widzą ten sam wynik z własnej perspektywy
    assert.equal(endA.status.me, endB.status.op);
    assert.equal(endA.status.op, endB.status.me);
    // strzały gracza w światło bramki nigdy nie są pudłem
    assert.ok(endA.kicks.every((k) => k.result !== 'miss' && k.result !== 'post'), JSON.stringify(endA.kicks));
    // nagroda dla zwycięzcy: 2000 energii i 500 monet; wyniki osobno od rankingu OVR
    const [winC, winEnd, win0] = endA.status.result === 'win' ? [a, endA, meA0] : [b, endB, meB0];
    assert.deepEqual(winEnd.reward, G.PENALTY_WIN_REWARD);
    const winNow = (await winC('/me')).data.player;
    assert.equal(winNow.money, win0.money + 500);
    assert.ok(winNow.energy >= win0.energy - G.PENALTY_ENERGY + 2000);
    const st = (await winC('/pvp/stats')).data.stats;
    assert.equal(st.wins, 1);
    assert.equal(winNow.wins, win0.wins); // ranking OVR bez zmian
    assert.equal((await a('/ranking/penalty')).data.players.length, 2);
    const match = await a('/matches/' + endA.matchId);
    assert.ok(match.data.match.penalty && match.data.match.events.length >= 6);

    // --- nikt inny nie szuka: po minucie przeciwnikiem zostaje bot ---
    assert.equal((await a('/pvp/search', {})).data.state, 'searching');
    clock.t += G.MATCH_BOT_AFTER_MS - 1000;
    assert.equal((await a('/pvp/status')).data.state, 'searching');
    clock.t += 2000;
    const botDuel = (await a('/pvp/status')).data;
    assert.equal(botDuel.state, 'found');
    assert.equal(botDuel.duel.mode, 'bot');
    assert.ok(botDuel.duel.opponent.bot);
    clock.t += G.PENALTY_TOSS_MS;
    // spóźniony strzał leci obok bramki; z botem ruch rozstrzyga się od razu
    let bv = (await a('/penalty/current')).data.duel;
    if (bv.status.turn === 'save') {
      bv = (await a(`/penalty/${bv.id}/kick`, { x: 0, y: 0.5 })).data.duel;
      clock.t += G.PENALTY_ANIM_MS;
    }
    const lateId = bv.id;
    const kicksBefore = bv.kicks.length;
    const late = (await a(`/penalty/${lateId}/kick`, { x: 0, y: 0.5, timeout: true })).data.duel;
    assert.equal(late.kicks.length, kicksBefore + 1);
    assert.equal(late.kicks.at(-1).side, 'my');
    assert.equal(late.kicks.at(-1).result, 'miss');
    // powrót po dłuższej przerwie nie psuje strzału z botem (czas liczy się od nowa)
    clock.t += 120000;
    let cur = (await a('/penalty/current')).data.duel;
    for (let i = 0; i < 60 && cur && !cur.status.finished; i++) {
      if (cur.status.turn === 'shoot') {
        const r = (await a(`/penalty/${lateId}/kick`, { x: 0.3, y: 0.6 })).data.duel;
        assert.notEqual(r.kicks.at(-1).result, 'miss');
        cur = r;
      } else cur = (await a(`/penalty/${lateId}/kick`, { x: -0.5, y: 0.4 })).data.duel;
      clock.t += G.PENALTY_ANIM_MS;
    }
    assert.ok(cur.status.finished);
    assert.equal((await a('/penalty/current')).data.duel, null);
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
