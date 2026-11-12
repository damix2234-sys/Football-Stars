// Football Stars – klient (SPA, routing po hashu).
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n).toLocaleString('pl-PL');
const time = (t) => new Date(t).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

let CFG = null;
let ME = null;
let serverOffset = 0;
let timers = [];

// W wersji podglądowej (bez serwera) window.FS_API podstawia lokalny silnik gry.
async function api(path, body) {
  if (window.FS_API) return window.FS_API(path, body);
  const res = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Błąd połączenia.');
  return data;
}

// Potwierdzenie drugim kliknięciem (bez okienka confirm()).
function confirmClick(fn) {
  return (ev) => {
    const b = ev.currentTarget;
    if (b.dataset.armed) return fn();
    b.dataset.armed = "1";
    const old = b.textContent;
    b.textContent = "Na pewno? Kliknij ponownie";
    setTimeout(() => { delete b.dataset.armed; b.textContent = old; }, 3000);
  };
}

function toast(msg, err = false) {
  const d = document.createElement('div');
  d.textContent = msg;
  if (err) d.className = 'err';
  $('#toast').append(d);
  const all = $('#toast').children;
  while (all.length > 2) all[0].remove();
  setTimeout(() => d.remove(), 2500);
}

// Wywołanie akcji z obsługą błędów i odświeżeniem stanu.
async function act(path, body, { reload = true } = {}) {
  try {
    const r = await api(path, body ?? {});
    if (r.message) toast(r.message);
    if (r.levelUp) toast(`🎉 Awans na poziom ${r.levelUp}!`);
    await refreshMe();
    if (reload) render();
    return r;
  } catch (e) {
    toast(e.message, true);
    return null;
  }
}

async function refreshMe() {
  const d = await api('/me');
  ME = d;
  if (d.serverTime) serverOffset = d.serverTime - Date.now();
  renderHud();
}
const now = () => Date.now() + serverOffset;

function liveEnergy(p) {
  if (p.energy >= CFG.energyMax) return { energy: p.energy, next: 0 };
  const ticks = Math.floor((now() - p.energyUpdated) / CFG.energyRegenMs);
  const energy = Math.min(CFG.energyMax, p.energy + Math.max(0, ticks));
  const next = energy >= CFG.energyMax ? 0 : p.energyUpdated + (Math.max(0, ticks) + 1) * CFG.energyRegenMs - now();
  return { energy, next };
}
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}h ${m}m` : `${m}:${ss}`;
};

function renderHud() {
  const p = ME?.player;
  const logged = !!p;
  $('#app').classList.toggle('guest', !logged);
  $('#topbar').hidden = !logged;
  $('#nav').hidden = !logged;
  if (!logged) return;
  const e = liveEnergy(p);
  $('#hud').innerHTML = `
    <span class="pill">⭐ Poz. ${p.level}</span>
    <span class="pill">⚡ ${e.energy}/${CFG.energyMax}${e.next ? ` <span class="muted">(${mmss(e.next)})</span>` : ''}</span>
    <span class="pill">💰 ${fmt(p.money)}</span>
    <button class="ghost small" id="logout">Wyloguj</button>`;
  $('#logout').onclick = async () => {
    await api('/logout', {});
    ME = null;
    location.hash = '#';
    boot();
  };
  const badge = $('#badge');
  badge.hidden = !p.unread;
  badge.textContent = p.unread;
}
setInterval(() => ME?.player && renderHud(), 1000);

// ---------- widoki ----------
const routes = {
  '': viewHome,
  trening: viewTraining,
  sparingi: viewDuels,
  sklep: viewShop,
  klub: viewClub,
  kluby: viewClubs,
  ranking: viewRanking,
  czat: viewChat,
  wiadomosci: viewNotifications,
  mecz: viewMatch,
  gracz: viewPlayer,
};

async function render() {
  timers.forEach(clearInterval);
  timers = [];
  if (!ME?.user) return viewAuth();
  if (!ME.player) return viewCreate();
  const [name, arg] = location.hash.replace(/^#/, '').split('-');
  document.querySelectorAll('.nav a').forEach((a) => {
    const r = a.dataset.r;
    a.classList.toggle('active', r === name || (r === 'klub' && name === 'kluby'));
  });
  const fn = routes[name] || viewHome;
  try {
    await fn(arg);
  } catch (e) {
    view.innerHTML = `<div class="card">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', render);

function viewAuth() {
  let mode = 'login';
  const draw = () => {
    view.innerHTML = `
      <div class="card">
        <h1>⚽ Football <span style="color:var(--accent)">Stars</span></h1>
        <p class="muted">Stwórz piłkarza, trenuj, wygrywaj sparingi i poprowadź swój klub na szczyt.</p>
        <div class="tabs">
          <button data-m="login" class="${mode === 'login' ? 'on' : ''}">Logowanie</button>
          <button data-m="register" class="${mode === 'register' ? 'on' : ''}">Rejestracja</button>
        </div>
        <form id="f">
          <label>Login<input name="login" autocomplete="username" required></label>
          <label>Hasło<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required></label>
          <button style="width:100%">${mode === 'login' ? 'Zaloguj' : 'Załóż konto'}</button>
        </form>
      </div>`;
    view.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => ((mode = b.dataset.m), draw())));
    $('#f').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target));
      try {
        await api('/' + mode, fd);
        await refreshMe();
        render();
      } catch (e) {
        toast(e.message, true);
      }
    };
  };
  draw();
}

function viewCreate() {
  view.innerHTML = `
    <div class="card">
      <h1>Nowy piłkarz</h1>
      <p class="muted">Wybierz nazwę i pozycję. Pozycja daje bonus startowy do statystyk.</p>
      <form id="f">
        <label>Imię i nazwisko piłkarza<input name="name" required maxlength="24"></label>
        <div class="pos-pick">
          ${Object.entries(CFG.positions)
            .map(([k, v], i) => `<label><input type="radio" name="position" value="${k}" ${i === 3 ? 'checked' : ''}>${v}</label>`)
            .join('')}
        </div>
        <button style="width:100%">Rozpocznij karierę</button>
      </form>
    </div>`;
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await api('/player', Object.fromEntries(new FormData(ev.target)));
      await refreshMe();
      location.hash = '#';
      render();
    } catch (e) {
      toast(e.message, true);
    }
  };
}

function statsTable(p, withBonus = true) {
  return Object.entries(CFG.stats)
    .map(([k, label]) => {
      const total = p.stats[k];
      const bonus = withBonus && p.baseStats ? total - p.baseStats[k] : 0;
      return `<div class="spread" style="padding:6px 0;border-bottom:1px solid var(--line)">
        <span>${label}</span><b>${total}${bonus ? ` <span class="bonus">(+${bonus})</span>` : ''}</b></div>`;
    })
    .join('');
}

async function viewHome() {
  const p = ME.player;
  const e = liveEnergy(p);
  const dailyReady = now() >= p.dailyReadyAt;
  view.innerHTML = `
    <h1>${esc(p.name)} <span class="tag">${CFG.positions[p.position]}</span></h1>
    <div class="grid">
      <div class="card">
        <h3>Profil</h3>
        <p>Poziom <b>${p.level}</b> · Ocena ogólna <b>${p.overall}</b></p>
        <p class="muted" style="margin:4px 0">Doświadczenie ${p.xp}/${p.xpNext}</p>
        <div class="bar xp"><div style="width:${(p.xp / p.xpNext) * 100}%"></div></div>
        <p class="muted" style="margin:12px 0 4px">Energia ${e.energy}/${CFG.energyMax}</p>
        <div class="bar energy"><div style="width:${(e.energy / CFG.energyMax) * 100}%"></div></div>
        <p style="margin-top:12px">Klub: ${p.club ? `<a href="#klub">[${esc(p.club.tag)}] ${esc(p.club.name)}</a>` : '<a href="#kluby">brak – znajdź klub</a>'}</p>
        <p>Bilans: <b>${p.wins}</b>W · <b>${p.draws}</b>R · <b>${p.losses}</b>P · ⚽ ${p.goals}</p>
      </div>
      <div class="card">
        <h3>Statystyki</h3>
        ${statsTable(p)}
      </div>
      <div class="card">
        <h3>Premia dzienna</h3>
        <p>Odbieraj codziennie <b>${fmt(p.dailyAmount)}</b> monet.</p>
        <button id="daily" ${dailyReady ? '' : 'disabled'}>${dailyReady ? 'Odbierz premię' : `Dostępna za <span id="dcd">${mmss(p.dailyReadyAt - now())}</span>`}</button>
        <h3 style="margin-top:20px">Co dalej?</h3>
        <div class="row">
          <a class="btn" href="#trening">Trenuj</a>
          <a class="btn" href="#sparingi">Zagraj sparing</a>
        </div>
      </div>
      ${window.FS_API ? `<div class="card">
        <h3>Tryb testowy</h3>
        <p class="muted">To wersja podglądowa: gra działa na tym urządzeniu, a pozostali gracze to boty.</p>
        <div class="row">
          <button class="small ghost" id="pvEnergy">⚡ Pełna energia</button>
          <button class="small ghost" id="pvMoney">💰 +1000 monet</button>
          <button class="small danger" id="pvReset">Zacznij od nowa</button>
        </div>
      </div>` : ""}
    </div>`;
  $('#daily').onclick = () => act('/daily-bonus');
  if (window.FS_API) {
    $('#pvEnergy').onclick = () => act('/preview/refill');
    $('#pvMoney').onclick = () => act('/preview/money');
    $('#pvReset').onclick = confirmClick(async () => {
      await api('/preview/reset', {});
      ME = null;
      location.hash = '#';
      boot();
    });
  }
  if (!dailyReady)
    timers.push(
      setInterval(() => {
        const el = $('#dcd');
        if (el) el.textContent = mmss(p.dailyReadyAt - now());
        if (now() >= p.dailyReadyAt) render();
      }, 1000),
    );
}

async function viewTraining() {
  const p = ME.player;
  view.innerHTML = `
    <h1>Trening</h1>
    <p class="muted">Każdy trening kosztuje ${CFG.trainingEnergy} energii i trochę monet. Gdy zapełnisz pasek, statystyka rośnie o 1. Wyższe statystyki wymagają więcej treningów.</p>
    <div class="card">
      ${Object.entries(CFG.stats)
        .map(([k, label]) => {
          const t = p.training[k];
          return `<div class="stat-row">
            <span>${label}</span>
            <span class="stat-val">${p.baseStats[k]}</span>
            <div><div class="bar"><div style="width:${(t.progress / t.needed) * 100}%"></div></div>
              <small class="muted">${t.progress}/${t.needed} · koszt ${t.cost} 💰</small></div>
            <button data-s="${k}">Trenuj</button>
          </div>`;
        })
        .join('')}
    </div>`;
  view.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => act('/train', { stat: b.dataset.s })));
}

function matchRow(m, perspectiveId) {
  const home = m.home_id === perspectiveId;
  const my = home ? m.home_score : m.away_score;
  const their = home ? m.away_score : m.home_score;
  const res = my > their ? 'W' : my < their ? 'P' : 'R';
  const color = res === 'W' ? 'var(--accent)' : res === 'P' ? 'var(--danger)' : 'var(--muted)';
  return `<tr><td><b style="color:${color}">${res}</b></td>
    <td>${esc(m.home_name)} – ${esc(m.away_name)}</td><td><b>${m.home_score}:${m.away_score}</b></td>
    <td class="muted">${time(m.created_at)}</td><td><a href="#mecz-${m.id}">Relacja</a></td></tr>`;
}

async function viewDuels() {
  const [{ opponents }, { matches }] = await Promise.all([api('/opponents'), api('/my-matches')]);
  const p = ME.player;
  view.innerHTML = `
    <h1>Sparingi</h1>
    <p class="muted">Wyzwij innego gracza (±${CFG.duelLevelRange} poziomów) na mecz jeden na jednego. Koszt: ${CFG.duelEnergy} energii.</p>
    <div class="grid">
      <div class="card">
        <h3>Rywale</h3>
        <div class="table-wrap"><table>
          <tr><th>Piłkarz</th><th>Poz.</th><th>Ocena</th><th></th></tr>
          ${opponents
            .map(
              (o) => `<tr><td><span class="dot ${o.online ? 'on' : ''}"></span><a href="#gracz-${o.id}">${esc(o.name)}</a>
                <span class="tag">${o.position}</span></td><td>${o.level}</td><td>${o.overall}</td>
                <td><button class="small" data-o="${o.id}">Wyzwij</button></td></tr>`,
            )
            .join('') || '<tr><td colspan="4" class="muted">Brak rywali w Twoim zasięgu. Zaproś znajomych!</td></tr>'}
        </table></div>
      </div>
      <div class="card">
        <h3>Ostatnie mecze</h3>
        <div class="table-wrap"><table>${matches.map((m) => matchRow(m, p.id)).join('') || '<tr><td class="muted">Jeszcze nie grałeś.</td></tr>'}</table></div>
      </div>
    </div>`;
  view.querySelectorAll('[data-o]').forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        const r = await act('/duel', { opponentId: Number(b.dataset.o) }, { reload: false });
        if (r) location.hash = `#mecz-${r.matchId}`;
        else b.disabled = false;
      }),
  );
}

async function viewMatch(id) {
  const { match: m } = await api('/matches/' + id);
  view.innerHTML = `
    <h1>${m.kind === 'club' ? 'Mecz klubowy' : 'Sparing'}</h1>
    <div class="card">
      <div class="spread"><h2>${esc(m.home_name)}</h2><div class="score" id="sc">0:0</div><h2 style="text-align:right">${esc(m.away_name)}</h2></div>
      <p class="muted" style="text-align:center" id="min">Gwizdek!</p>
      <ul class="events" id="ev"></ul>
      <div class="row" style="justify-content:center;margin-top:12px"><button class="ghost" id="skip">Pokaż wynik</button></div>
    </div>`;
  const score = [0, 0];
  let i = 0;
  const step = () => {
    if (i >= m.events.length) {
      $('#min').textContent = 'Koniec meczu';
      $('#sc').textContent = `${m.home_score}:${m.away_score}`;
      $('#skip').hidden = true;
      timers.forEach(clearInterval);
      return;
    }
    const e = m.events[i++];
    if (e.type === 'goal') score[e.side]++;
    $('#sc').textContent = `${score[0]}:${score[1]}`;
    $('#min').textContent = `${e.minute}'`;
    $('#ev').insertAdjacentHTML(
      'beforeend',
      `<li class="${e.type} ${e.side === 1 ? 'right' : ''}"><span class="min">${e.minute}'</span>${esc(e.text)}</li>`,
    );
  };
  timers.push(setInterval(step, 700));
  $('#skip').onclick = () => {
    while (i < m.events.length) step();
    step();
  };
}

async function viewPlayer(id) {
  const { player: p, matches } = await api('/players/' + id);
  view.innerHTML = `
    <h1><span class="dot ${p.online ? 'on' : ''}"></span>${esc(p.name)} <span class="tag">${CFG.positions[p.position]}</span></h1>
    <div class="grid">
      <div class="card">
        <h3>Profil</h3>
        <p>Poziom <b>${p.level}</b> · Ocena <b>${p.overall}</b></p>
        <p>Klub: ${p.club ? `<a href="#klub-${p.club.id}">[${esc(p.club.tag)}] ${esc(p.club.name)}</a>` : 'brak'}</p>
        <p>Bilans: <b>${p.wins}</b>W · <b>${p.draws}</b>R · <b>${p.losses}</b>P · ⚽ ${p.goals}</p>
        ${p.id !== ME.player.id ? `<button id="duel">Wyzwij na sparing</button>` : ''}
      </div>
      <div class="card"><h3>Statystyki</h3>${statsTable(p, false)}</div>
      <div class="card"><h3>Ostatnie sparingi</h3><div class="table-wrap"><table>${matches.map((m) => matchRow(m, p.id)).join('') || '<tr><td class="muted">Brak meczów.</td></tr>'}</table></div></div>
    </div>`;
  const b = $('#duel');
  if (b)
    b.onclick = async () => {
      const r = await act('/duel', { opponentId: p.id }, { reload: false });
      if (r) location.hash = `#mecz-${r.matchId}`;
    };
}

async function viewShop() {
  const { items: inv } = await api('/inventory');
  const owned = Object.fromEntries(inv.map((i) => [i.item_id, i.equipped]));
  const p = ME.player;
  view.innerHTML = `
    <h1>Sklep sportowy</h1>
    <p class="muted">Sprzęt zwiększa statystyki. W każdym miejscu możesz mieć założony jeden przedmiot.</p>
    <div class="grid">
      ${Object.entries(CFG.slots)
        .map(
          ([slot, label]) => `<div class="card"><h3>${label}</h3>
          ${CFG.items
            .filter((i) => i.slot === slot)
            .map((i) => {
              const bonus = Object.entries(i.bonus).map(([k, v]) => `+${v} ${CFG.stats[k]}`).join(', ');
              let btn;
              if (i.id in owned)
                btn = owned[i.id] ? '<span class="tag on">Założone</span>' : `<button class="small ghost" data-eq="${i.id}">Załóż</button>`;
              else
                btn = `<button class="small" data-buy="${i.id}" ${p.level < i.level || p.money < i.price ? 'disabled' : ''}>${fmt(i.price)} 💰</button>`;
              return `<div class="item"><div><b>${esc(i.name)}</b><br><small class="bonus">${bonus}</small>
                ${p.level < i.level ? `<br><small class="muted">Wymaga poz. ${i.level}</small>` : ''}</div>${btn}</div>`;
            })
            .join('')}</div>`,
        )
        .join('')}
    </div>`;
  view.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => act('/shop/buy', { itemId: b.dataset.buy })));
  view.querySelectorAll('[data-eq]').forEach((b) => (b.onclick = () => act('/inventory/equip', { itemId: b.dataset.eq })));
}

async function viewClubs() {
  const { clubs } = await api('/clubs');
  const p = ME.player;
  view.innerHTML = `
    <h1>Kluby</h1>
    <div class="grid">
      <div class="card">
        <h3>Lista klubów</h3>
        <div class="table-wrap"><table>
          <tr><th>Klub</th><th>Członkowie</th><th>Pkt</th></tr>
          ${clubs.map((c) => `<tr><td><a href="#klub-${c.id}">[${esc(c.tag)}] ${esc(c.name)}</a></td><td>${c.members}/${CFG.clubMaxMembers}</td><td>${c.points}</td></tr>`).join('') || '<tr><td class="muted" colspan="3">Nie ma jeszcze klubów. Załóż pierwszy!</td></tr>'}
        </table></div>
      </div>
      ${
        p.club
          ? ''
          : `<div class="card">
        <h3>Załóż klub</h3>
        <p class="muted">Koszt: ${fmt(CFG.clubCreateCost)} monet. Zostaniesz prezesem.</p>
        <form id="f">
          <label>Nazwa klubu<input name="name" required maxlength="30"></label>
          <label>Skrót (2–4 znaki)<input name="tag" required maxlength="4"></label>
          <button>Załóż klub</button>
        </form>
      </div>`
      }
    </div>`;
  const f = $('#f');
  if (f)
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      const r = await act('/clubs', Object.fromEntries(new FormData(ev.target)), { reload: false });
      if (r) location.hash = '#klub';
    };
}

async function viewClub(id) {
  const p = ME.player;
  const clubId = id || p.club?.id;
  if (!clubId) return viewClubs();
  const d = await api('/clubs/' + clubId);
  const c = d.club;
  const canMatch = now() >= c.nextMatchAt;
  view.innerHTML = `
    <div class="spread"><h1>[${esc(c.tag)}] ${esc(c.name)}</h1><a href="#kluby">Wszystkie kluby →</a></div>
    <div class="grid">
      <div class="card">
        <h3>Informacje</h3>
        <p>Punkty <b>${c.points}</b> · Bilans <b>${c.wins}</b>W <b>${c.draws}</b>R <b>${c.losses}</b>P</p>
        <p>Średnia ocena zawodników: <b>${c.strength}</b></p>
        ${c.treasury !== null ? `<p>Kasa klubu: <b>${fmt(c.treasury)}</b> 💰</p>` : ''}
        <p class="muted">${esc(c.description) || 'Brak opisu.'}</p>
        ${
          d.isMember
            ? `<div class="row"><input id="don" type="number" min="1" placeholder="Kwota" style="max-width:120px"><button id="donate" class="small">Wpłać</button>
               <button id="leave" class="small danger">Opuść klub</button></div>`
            : !p.club
              ? d.applied
                ? '<span class="tag">Zgłoszenie wysłane</span>'
                : `<button id="apply">Zgłoś się do klubu</button>`
              : ''
        }
        ${d.isOwner ? `<label style="margin-top:12px">Opis klubu<textarea id="desc" rows="3">${esc(c.description)}</textarea></label><button class="small ghost" id="saveDesc">Zapisz opis</button>` : ''}
      </div>
      <div class="card">
        <h3>Kadra (${d.members.length}/${CFG.clubMaxMembers})</h3>
        <div class="table-wrap"><table>
          <tr><th>Piłkarz</th><th>Poz.</th><th>Ocena</th>${d.isOwner ? '<th></th>' : ''}</tr>
          ${d.members
            .map(
              (m) => `<tr><td><span class="dot ${m.online ? 'on' : ''}"></span><a href="#gracz-${m.id}">${esc(m.name)}</a>
                ${m.id === c.ownerId ? '<span class="tag on">Prezes</span>' : ''} <span class="tag">${m.position}</span></td>
                <td>${m.level}</td><td>${m.overall}</td>
                ${d.isOwner ? `<td>${m.id !== p.id ? `<button class="small ghost" data-kick="${m.id}">Usuń</button>` : ''}</td>` : ''}</tr>`,
            )
            .join('')}
        </table></div>
        <p class="muted"><small>W meczu klubowym gra 11 najwyżej notowanych zawodników. Postaraj się o bramkarza!</small></p>
      </div>
      ${
        d.isOwner && d.applications.length
          ? `<div class="card"><h3>Zgłoszenia</h3>${d.applications
              .map(
                (a) => `<div class="item"><span>${esc(a.name)} <span class="tag">${a.position}</span> poz. ${a.level}</span>
                  <span class="row"><button class="small" data-acc="${a.id}">Przyjmij</button><button class="small ghost" data-rej="${a.id}">Odrzuć</button></span></div>`,
              )
              .join('')}</div>`
          : ''
      }
      ${
        d.isOwner
          ? `<div class="card"><h3>Wyzwij klub</h3>
              ${canMatch ? '<p class="muted">Wybierz rywala do meczu klubowego.</p>' : `<p class="muted">Kolejny mecz za <span id="cmcd">${mmss(c.nextMatchAt - now())}</span>.</p>`}
              <div id="rivals" class="muted">Ładowanie…</div></div>`
          : ''
      }
      <div class="card"><h3>Mecze klubowe</h3><div class="table-wrap"><table>${d.matches.map((m) => matchRow(m, c.id)).join('') || '<tr><td class="muted">Brak meczów.</td></tr>'}</table></div></div>
    </div>`;

  const on = (sel, fn) => {
    const el = $(sel);
    if (el) el.onclick = fn;
  };
  on('#apply', () => act(`/clubs/${c.id}/apply`));
  on('#leave', confirmClick(() => act('/clubs/leave')));
  on('#donate', () => act('/clubs/donate', { amount: Number($('#don').value) }));
  on('#saveDesc', () => act('/clubs/description', { description: $('#desc').value }));
  view.querySelectorAll('[data-kick]').forEach((b) => (b.onclick = confirmClick(() => act(`/clubs/kick/${b.dataset.kick}`))));
  view.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => act(`/clubs/applications/${b.dataset.acc}`, { accept: true })));
  view.querySelectorAll('[data-rej]').forEach((b) => (b.onclick = () => act(`/clubs/applications/${b.dataset.rej}`, { accept: false })));

  if (d.isOwner) {
    const { clubs } = await api('/clubs');
    const rivals = clubs.filter((x) => x.id !== c.id);
    const box = $('#rivals');
    if (!box) return;
    box.classList.remove('muted');
    box.innerHTML =
      rivals
        .map(
          (r) => `<div class="item"><a href="#klub-${r.id}">[${esc(r.tag)}] ${esc(r.name)}</a>
            <button class="small" data-ch="${r.id}" ${canMatch ? '' : 'disabled'}>Wyzwij</button></div>`,
        )
        .join('') || '<span class="muted">Brak innych klubów.</span>';
    box.querySelectorAll('[data-ch]').forEach(
      (b) =>
        (b.onclick = async () => {
          const r = await act(`/clubs/challenge/${b.dataset.ch}`, {}, { reload: false });
          if (r) location.hash = `#mecz-${r.matchId}`;
        }),
    );
    if (!canMatch)
      timers.push(
        setInterval(() => {
          const el = $('#cmcd');
          if (el) el.textContent = mmss(c.nextMatchAt - now());
          if (now() >= c.nextMatchAt) render();
        }, 1000),
      );
  }
}

async function viewRanking(tab = 'gracze') {
  const players = tab !== 'kluby';
  const data = players ? await api('/ranking/players') : await api('/ranking/clubs');
  view.innerHTML = `
    <h1>Ranking</h1>
    <div class="tabs"><button class="${players ? 'on' : ''}" onclick="location.hash='#ranking-gracze'">Piłkarze</button>
      <button class="${players ? '' : 'on'}" onclick="location.hash='#ranking-kluby'">Kluby</button></div>
    <div class="card table-wrap"><table>
      ${
        players
          ? `<tr><th>#</th><th>Piłkarz</th><th>Klub</th><th>Poz.</th><th>Ocena</th><th>W/R/P</th></tr>
             ${data.players
               .map(
                 (p, i) => `<tr><td>${i + 1}</td><td><a href="#gracz-${p.id}">${esc(p.name)}</a> <span class="tag">${p.position}</span></td>
                 <td>${p.club ? `[${esc(p.club.tag)}]` : '–'}</td><td>${p.level}</td><td>${p.overall}</td><td>${p.wins}/${p.draws}/${p.losses}</td></tr>`,
               )
               .join('')}`
          : `<tr><th>#</th><th>Klub</th><th>Członkowie</th><th>Pkt</th><th>W/R/P</th></tr>
             ${data.clubs
               .map(
                 (c, i) => `<tr><td>${i + 1}</td><td><a href="#klub-${c.id}">[${esc(c.tag)}] ${esc(c.name)}</a></td>
                 <td>${c.members}</td><td><b>${c.points}</b></td><td>${c.wins}/${c.draws}/${c.losses}</td></tr>`,
               )
               .join('') || '<tr><td colspan="5" class="muted">Brak klubów.</td></tr>'}`
      }
    </table></div>`;
}

async function viewChat(channel = 'global') {
  const p = ME.player;
  if (channel === 'club' && !p.club) channel = 'global';
  view.innerHTML = `
    <h1>Czat</h1>
    <div class="tabs"><button class="${channel === 'global' ? 'on' : ''}" onclick="location.hash='#czat-global'">Ogólny</button>
      ${p.club ? `<button class="${channel === 'club' ? 'on' : ''}" onclick="location.hash='#czat-club'">Klubowy</button>` : ''}</div>
    <div class="card">
      <div class="chat" id="chat"></div>
      <form id="f" class="row" style="margin-top:12px;flex-wrap:nowrap"><input name="body" maxlength="300" placeholder="Napisz wiadomość…" autocomplete="off"><button>Wyślij</button></form>
    </div>`;
  let last = 0;
  let first = true;
  const box = $('#chat');
  const load = async () => {
    try {
      const { messages } = await api(`/chat/${channel}?after=${last}`);
      if (!messages.length) return;
      const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
      box.insertAdjacentHTML(
        'beforeend',
        messages
          .map((m) => `<div class="msg"><a href="#gracz-${m.player_id}"><b>${esc(m.name)}</b></a><time>${time(m.created_at)}</time><br>${esc(m.body)}</div>`)
          .join(''),
      );
      last = messages[messages.length - 1].id;
      if (stick || first) box.scrollTop = box.scrollHeight;
      first = false;
    } catch {}
  };
  await load();
  timers.push(setInterval(load, 3000));
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    const input = ev.target.body;
    if (!input.value.trim()) return;
    try {
      await api(`/chat/${channel}`, { body: input.value });
      input.value = '';
      load();
    } catch (e) {
      toast(e.message, true);
    }
  };
}

async function viewNotifications() {
  const { notifications } = await api('/notifications');
  await refreshMe();
  view.innerHTML = `
    <h1>Wiadomości</h1>
    <div class="card">
      ${notifications.map((n) => `<div class="item"><span>${n.read ? '' : '🆕 '}${esc(n.body)}</span><small class="muted">${time(n.created_at)}</small></div>`).join('') || '<p class="muted">Brak wiadomości.</p>'}
    </div>`;
}

// Okresowo odświeżamy stan (powiadomienia, energia z serwera).
setInterval(() => ME?.player && refreshMe().catch(() => {}), 30000);

async function boot() {
  CFG = await api('/config');
  await refreshMe();
  render();
}
boot();
