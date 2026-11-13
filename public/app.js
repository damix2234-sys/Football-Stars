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

// Energia nie ma limitu: odnawia się cały czas.
function liveEnergy(p) {
  const ticks = Math.max(0, Math.floor((now() - p.energyUpdated) / CFG.energyRegenMs));
  const next = p.energyUpdated + (ticks + 1) * CFG.energyRegenMs - now();
  return { energy: p.energy + ticks, next };
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
  $('#me-chip').innerHTML = `
    <span class="me-ava">${avatar(p)}</span>
    <span class="me-info"><b class="me-nick">${esc(p.name)}</b>
      <span class="me-form" title="Forma: sprawność piłkarza (zmęczenie, kontuzje)"><i style="width:${p.form}%"></i></span>
      <small>Forma ${p.form}%</small></span>
    <span class="ovr-shield" title="OVR: suma wytrenowanych umiejętności"><small>OVR</small><b>${p.ovr}</b></span>`;
  $('#hud').innerHTML = `
    <span class="pill" title="Energia (+1 co ${CFG.energyRegenMs / 1000} s)">⚡ ${fmt(e.energy)} <span class="muted">+1 za ${Math.ceil(e.next / 1000)} s</span></span>
    <span class="pill">💰 ${fmt(p.money)}</span>
    <button class="ghost small" id="logout" title="Wyloguj">Wyloguj</button>`;
  $('#logout').onclick = logout;
  const badge = $('#badge');
  badge.hidden = !p.unread;
  badge.textContent = p.unread;
}
async function logout() {
  await api('/logout', {});
  ME = null;
  location.hash = '#';
  boot();
}
setInterval(() => ME?.player && renderHud(), 1000);

// ---------- widoki ----------
const routes = {
  '': viewHome,
  trening: viewTraining,
  pojedynki: viewDuels,
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

// Strona startowa dla niezalogowanych: baner z postaciami, panel logowania/rejestracji,
// liczby z gry, liderzy rankingu i opis rozgrywki.
const IMG = (name) => `img/${name}.jpg`;
// Portret piłkarza: bramkarka dla bramkarzy, napastnik dla pozostałych pozycji.
const avatar = (p, size = '') =>
  `<img class="avatar ${size}" src="${IMG(p.position === 'BR' ? 'avatar-gk' : 'avatar-st')}" alt="">`;

async function viewAuth(startMode = 'register') {
  let mode = startMode;
  let stats = null;
  let top = null;
  let recent = [];
  try {
    [stats, top, { matches: recent }] = await Promise.all([api('/public/stats'), api('/public/top'), api('/public/recent')]);
  } catch {}
  const n = (v) => (v == null ? '0' : fmt(v));

  view.innerHTML = `
  <div class="landing">
    <header class="l-top">
      <a class="logo" href="#">⚽ Football <b>Stars</b></a>
    </header>

    <section class="l-hero">
      <canvas class="l-fx" aria-hidden="true"></canvas>
      <div class="l-hero-inner">
        <div class="l-pitch">
          <p class="l-kicker">Darmowa gra piłkarska w przeglądarce</p>
          <h1 class="l-title">Zostań <span>gwiazdą</span> boiska</h1>
          <p class="l-lead">Stwórz własnego piłkarza, trenuj jego statystyki, wygrywaj mecze z innymi graczami
            i razem ze znajomymi zbuduj klub, o którym usłyszy cała liga.</p>
          <div class="l-auth" id="auth">
          <div class="tabs l-tabs">
            <button data-m="register">Załóż konto</button>
            <button data-m="login">Logowanie</button>
          </div>
          <form id="f">
            <label>Login<input id="f-login" name="login" autocomplete="username" required></label>
            <label>Hasło<input id="f-pass" name="password" type="password" required></label>
            <button class="l-cta" id="f-submit"></button>
            <p class="muted l-note" id="f-note"></p>
          </form>
          </div>
        </div>
      </div>
    </section>

    <section class="l-stats">
      <div><b data-count="${stats?.players ?? ''}">${n(stats?.players)}</b><span>piłkarzy</span></div>
      <div><b data-count="${stats?.clubs ?? ''}">${n(stats?.clubs)}</b><span>klubów</span></div>
      <div><b data-count="${stats?.matches ?? ''}">${n(stats?.matches)}</b><span>rozegranych meczów</span></div>
      <div><b data-count="${stats?.online ?? ''}">${n(stats?.online)}</b><span>graczy online</span></div>
    </section>

    ${
      recent?.length
        ? `<div class="l-ticker" aria-label="Ostatnie wyniki"><span class="l-live">Na żywo</span><div class="l-track"><div class="l-run">${[...recent, ...recent]
            .map((m) => `<span>${esc(m.home_name)} <b>${m.home_score}:${m.away_score}</b> ${esc(m.away_name)}</span>`)
            .join('')}</div></div></div>`
        : ''
    }

    <ul class="l-ticks">
      <li>Gra wieloosobowa z prawdziwymi rywalami i drużynami</li>
      <li>Działa na telefonie i komputerze, bez instalacji</li>
      <li>Proste zasady, dużo emocji w każdym meczu</li>
    </ul>

    ${
      top?.players?.length
        ? `<section class="l-section">
        <h2 class="l-h2">Liderzy ligi</h2>
        <div class="l-leaders">
          <ol class="l-board">
            ${top.players
              .map(
                (p, i) => `<li><span class="l-rank">${i + 1}</span><span class="l-name">${esc(p.name)}
                  <small>${CFG.positions[p.position]}${p.club ? ` · [${esc(p.club.tag)}]` : ''}</small></span>
                  <span class="l-score">OVR ${p.ovr}</span></li>`,
              )
              .join('')}
          </ol>
          ${
            top.clubs?.length
              ? `<ol class="l-board">
            ${top.clubs
              .map(
                (c, i) => `<li><span class="l-rank">${i + 1}</span><span class="l-name">${esc(c.name)}
                  <small>[${esc(c.tag)}] · ${c.members} zawodników</small></span><span class="l-score">${c.points} pkt</span></li>`,
              )
              .join('')}
          </ol>`
              : ''
          }
        </div>
      </section>`
        : ''
    }

    <section class="l-section">
      <h2 class="l-h2">Jak wygląda gra?</h2>
      <div class="l-features">
        <article class="l-feature">
          <img src="${IMG('training')}" alt="Piłkarz trenujący drybling na boisku" loading="lazy">
          <div><h3>Trenuj codziennie</h3>
          <p>Siedem statystyk: strzały, podania, drybling, obrona, szybkość, kondycja i bramkarstwo.
            Każdy trening zużywa energię, która odnawia się z czasem.</p></div>
        </article>
        <article class="l-feature">
          <img src="${IMG('match')}" alt="Napastnik oddający mocny strzał" loading="lazy">
          <div><h3>Wygrywaj mecze</h3>
          <p>Wyzwij innego gracza na pojedynek rzutów karnych. Strzelasz i bronisz na zmianę.
            O wyniku decydują statystyki, forma i odrobina szczęścia.</p></div>
        </article>
        <article class="l-feature">
          <img src="${IMG('club')}" alt="Drużyna świętująca z pucharem" loading="lazy">
          <div><h3>Zbuduj klub</h3>
          <p>Załóż drużynę albo dołącz do istniejącej. Gromadźcie kasę klubu,
            wyzywajcie inne kluby i walczcie o pierwsze miejsce w rankingu.</p></div>
        </article>
      </div>
    </section>

    <section class="l-section">
      <h2 class="l-h2">Start w trzech krokach</h2>
      <ol class="l-steps">
        <li><b>Załóż konto</b><span>Wystarczy login i hasło.</span></li>
        <li><b>Stwórz piłkarza</b><span>Wybierz nazwę i pozycję na boisku.</span></li>
        <li><b>Graj</b><span>Trenuj, wygrywaj pojedynki i szukaj klubu.</span></li>
      </ol>
      <div class="l-final"><button class="l-cta" data-goto="register">Zagraj za darmo</button></div>
    </section>

    <footer class="l-foot">Football Stars · gra przeglądarkowa · wszystkie postacie są fikcyjne</footer>
  </div>`;

  landingFx();

  const setMode = (m) => {
    mode = m;
    view.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('#f-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('#f-submit').textContent = m === 'login' ? 'Zaloguj się' : 'Załóż darmowe konto';
    $('#f-note').textContent =
      m === 'login' ? 'Nie masz konta? Wybierz „Załóż konto”.' : 'Login: od 3 do 20 znaków. Hasło: co najmniej 6 znaków.';
  };
  setMode(mode);
  view.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => setMode(b.dataset.m)));
  view.querySelectorAll('[data-goto]').forEach(
    (b) =>
      (b.onclick = () => {
        setMode(b.dataset.goto);
        $('#auth').scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => $('#f-login').focus({ preventScroll: true }), 400);
      }),
  );
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
}

// Efekty strony startowej: iskry w banerze i odliczanie liczników.
function landingFx() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  view.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    if (!target || reduce) return;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1400);
      el.textContent = fmt(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const cv = view.querySelector('.l-fx');
  if (!cv || reduce) return;
  const ctx = cv.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  const size = () => {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  addEventListener('resize', size);
  const spawn = (y) => ({
    // iskry gęstsze po prawej, przy postaciach
    x: w * (0.35 + 0.65 * Math.sqrt(Math.random())), y: y ?? h + 10,
    r: 0.6 + Math.random() * 2.2, vy: 0.3 + Math.random() * 0.9, vx: (Math.random() - 0.5) * 0.3,
    a: 0.35 + Math.random() * 0.6, ph: Math.random() * 6.28,
  });
  const parts = Array.from({ length: w < 700 ? 45 : 90 }, () => spawn(Math.random() * h));
  const loop = () => {
    if (!document.body.contains(cv)) return removeEventListener('resize', size);
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.y -= p.vy; p.ph += 0.03; p.x += p.vx + Math.sin(p.ph) * 0.25;
      if (p.y < -10) Object.assign(p, spawn());
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      g.addColorStop(0, `rgba(200,255,120,${p.a})`);
      g.addColorStop(1, 'rgba(80,230,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, 6.283); ctx.fill();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
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

// Umiejętności pogrupowane w kategorie treningu (każda w swoim kolorze).
function statsTable(p, withBonus = true) {
  return CFG.categories
    .map((c) => {
      const sum = c.specs.reduce((t, sp) => t + (p.stats[sp.id] || 0), 0);
      return `<div class="stat-cat" style="--c:${c.color}">
        <div class="spread"><span class="row" style="gap:8px">${icon(c.icon, 'sm')}<b>${c.name}</b></span><b class="cat-ovr">${sum}</b></div>
        ${c.specs
          .map((sp) => {
            const total = p.stats[sp.id];
            const bonus = withBonus && p.baseStats ? total - p.baseStats[sp.id] : 0;
            return `<div class="spread stat-line"><span>${sp.name}</span><span>${total}${bonus ? ` <span class="bonus">(+${bonus})</span>` : ''}</span></div>`;
          })
          .join('')}
      </div>`;
    })
    .join('');
}

async function viewHome() {
  const p = ME.player;
  const e = liveEnergy(p);
  const dailyReady = now() >= p.dailyReadyAt;
  view.innerHTML = `
    <div class="hero-head">${avatar(p, 'lg')}<div><h1>${esc(p.name)}</h1><span class="tag">${CFG.positions[p.position]}</span> <span class="tag ovr-tag">OVR ${p.ovr}</span></div></div>
    <div class="grid">
      <div class="card">
        <h3>Profil</h3>
        <p>Umiejętności z ekwipunkiem: <b>${p.overall}</b></p>
        <p style="margin-top:12px">Klub: ${p.club ? `<a href="#klub">[${esc(p.club.tag)}] ${esc(p.club.name)}</a>` : '<a href="#kluby">brak, znajdź klub</a>'}</p>
        <p>Bilans: <b>${p.wins}</b>W · <b>${p.draws}</b>R · <b>${p.losses}</b>P · ⚽ ${p.goals}</p>
        <button class="ghost small" id="logout2">Wyloguj</button>
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
          <a class="btn" href="#pojedynki">Pojedynek karnych</a>
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
  $('#logout2').onclick = logout;
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

// ---------- trening ----------
const icon = (name, size = '') => `<span class="mi ${size}" aria-hidden="true">${name}</span>`;
const CAT_BG = { atak: 'match', rozegranie: 'club', obrona: 'match', fizycznosc: 'training', kondycja: 'training', bramkarstwo: 'match' };
const posChips = (list) => list.map((p) => `<span class="pos-chip">${CFG.positions[p]}</span>`).join('');
const hoursLabel = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${h} h`);
const clock = (t) => new Date(t).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

async function viewTraining(catId) {
  const p = ME.player;
  const t = p.training;
  const cat = CFG.categories.find((c) => c.id === catId);
  const activeAutos = t.autos.length;
  const head = `
    <div class="t-top">
      <div><h1>${cat ? `<a class="t-back" href="#trening">${icon('arrow_back')}</a> ${cat.name}` : 'Trening'}</h1>
        <p class="muted">${cat ? 'Trenuj specjalizacje. Razem dają OVR kategorii.' : 'Wybierz kategorię i trenuj jej specjalizacje. Suma wszystkich to Twój OVR.'}</p></div>
      <div class="t-sum">
        <span class="t-chip">${icon('schedule', 'sm')} Automaty ${activeAutos}/${CFG.autoMaxActive}</span>
      </div>
    </div>`;

  if (!cat) {
    view.innerHTML = `${head}
      <div class="t-grid">
        ${CFG.categories
          .map((c) => {
            const specs = c.specs.map((s) => t.specs[s.id]);
            const pct = Math.round((specs.reduce((a, s) => a + s.progress / s.needed, 0) / specs.length) * 100);
            const auto = t.autos.some((a) => c.specs.some((s) => s.id === a.spec));
            return `<article class="tcat" style="--c:${c.color};--bg:url('${IMG(CAT_BG[c.id])}')">
              <a class="tcat-main" href="#trening-${c.id}">
                <div class="tcat-head"><h3>${c.name}</h3>
                  <div class="tcat-specs">${c.specs.map((s) => `<span class="orb xs" title="${s.name}">${icon(s.icon)}</span>`).join('')}</div></div>
                <div class="tcat-body">
                  <span class="orb lg">${icon(c.icon)}</span>
                  <div class="tcat-prog"><span>${pct}%</span><div class="tbar"><div style="width:${pct}%"></div></div></div>
                  <span class="ovr-badge" title="OVR kategorii">${t.categories[c.id]}</span>
                </div>
                <span class="tcat-go">${auto ? `${icon('autorenew', 'sm')} trenuje automatycznie · ` : ''}Trenuj specjalizacje ${icon('chevron_right', 'sm')}</span>
              </a>
              <div class="tinfo">
                <p>${c.about}</p>
                <div class="tinfo-pos">Najbardziej przydaje się: ${posChips(c.positions)}</div>
              </div>
            </article>`;
          })
          .join('')}
      </div>`;
    return;
  }

  view.innerHTML = `${head}
    <div class="tcat-banner" style="--c:${cat.color}">
      <span class="orb lg">${icon(cat.icon)}</span>
      <div><b>Specjalizacja: ${cat.name}</b><p>${cat.about}</p><div class="tinfo-pos">${posChips(cat.positions)}</div></div>
      <span class="ovr-badge">${t.categories[cat.id]}</span>
    </div>
    <div class="t-grid">
      ${cat.specs
        .map((s) => {
          const st = t.specs[s.id];
          const pct = Math.round((st.progress / st.needed) * 100);
          const auto = t.autos.find((a) => a.spec === s.id);
          return `<article class="tspec tcat" style="--c:${cat.color};--bg:url('${IMG(CAT_BG[cat.id])}')">
            <div class="tcat-main">
              <div class="tcat-head"><h3>${s.name}</h3>${auto ? `<span class="auto-tag">${icon('autorenew', 'sm')} automat</span>` : ''}</div>
              <div class="tcat-body">
                <span class="orb lg">${icon(s.icon)}</span>
                <div class="tcat-prog"><span>${pct}% do poziomu ${st.level + 1}</span><div class="tbar"><div style="width:${pct}%"></div></div></div>
                <span class="ovr-badge" title="Poziom specjalizacji">${st.level}</span>
              </div>
              <div class="tcost">
                <span>${icon('payments', 'sm')} ${fmt(st.cost.money)}</span>
                <span>${icon('bolt', 'sm')} ${st.cost.energy}</span>
                <span>${icon('timer', 'sm')} 5 s</span>
              </div>
              ${
                auto
                  ? `<div class="auto-box" data-auto="${s.id}" data-ends="${auto.endsAt}" data-count="${auto.count}">
                      <div class="spread"><span>Automat: <b class="auto-done">${auto.done}</b>/${auto.count}</span><span class="muted">koniec ${clock(auto.endsAt)}</span></div>
                      <div class="tbar"><div class="auto-bar" style="width:${(auto.done / auto.count) * 100}%"></div></div>
                      <button class="small ghost" data-cancel="${s.id}">Anuluj (zwrot za resztę)</button>
                    </div>`
                  : `<button class="train-btn" data-train="${s.id}"><span class="train-label">Trenuj</span><span class="train-cd"></span></button>
                     <p class="hold-hint">${icon('touch_app', 'sm')} Przytrzymaj, aby ustawić trening automatyczny</p>`
              }
            </div>
            <div class="tinfo"><p>${s.about}</p></div>
          </article>`;
        })
        .join('')}
    </div>`;

  // Odliczanie 5 s po treningu i postęp automatów na żywo.
  const tick = () => {
    const left = t.readyAt - now();
    view.querySelectorAll('[data-train]').forEach((b) => {
      b.classList.toggle('cooling', left > 0);
      b.style.setProperty('--cd', Math.max(0, left / CFG.trainCooldownMs));
      b.querySelector('.train-cd').textContent = left > 0 ? `${Math.ceil(left / 1000)} s` : '';
    });
    view.querySelectorAll('[data-auto]').forEach((box) => {
      const count = Number(box.dataset.count);
      const start = Number(box.dataset.ends) - count * CFG.trainCooldownMs;
      const done = Math.min(count, Math.floor((now() - start) / CFG.trainCooldownMs));
      box.querySelector('.auto-done').textContent = done;
      box.querySelector('.auto-bar').style.width = `${(done / count) * 100}%`;
      if (done >= count) render();
    });
  };
  tick();
  timers.push(setInterval(tick, 250));

  view.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = confirmClick(() => act('/auto/cancel', { spec: b.dataset.cancel }))));
  view.querySelectorAll('[data-train]').forEach((b) => {
    let holdTimer = null;
    let held = false;
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('pointerdown', () => {
      held = false;
      b.classList.add('pressing');
      holdTimer = setTimeout(() => {
        held = true;
        b.classList.remove('pressing');
        autoPanel(b.dataset.train);
      }, 550);
    });
    const end = () => {
      clearTimeout(holdTimer);
      b.classList.remove('pressing');
    };
    b.addEventListener('pointerleave', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('pointerup', async () => {
      end();
      if (held || b.classList.contains('cooling')) return;
      b.classList.add('flash');
      await act('/train', { spec: b.dataset.train });
    });
  });
}

// Panel treningu automatycznego: dokładnie, co daje każdy czas (pełna liczba treningów).
function autoPanel(spec) {
  const s = CFG.categories.flatMap((c) => c.specs.map((x) => ({ ...x, color: c.color }))).find((x) => x.id === spec);
  const st = ME.player.training.specs[spec];
  let sel = 0;
  let data = null;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="--c:${s.color}">
      <div class="row" style="gap:12px"><span class="orb">${icon(s.icon)}</span>
        <div><h2 style="margin:0">Trening automatyczny</h2><span class="muted">${s.name} · poziom ${st.level}</span></div></div>
      <p class="muted">Jeden trening co 5 sekund, także gdy nie ma Cię w grze. Wybrany czas to zawsze pełna liczba treningów. Koszt pobieramy przy starcie, a anulowanie zwraca koszt treningów, które się nie odbyły.</p>
      <div class="auto-have" id="auto-have"></div>
      <div class="auto-table" id="auto-table">Liczę…</div>
      <div class="auto-detail" id="auto-detail"></div>
      <div class="row" style="justify-content:flex-end">
        <button class="ghost" id="auto-close">Zamknij</button>
        <button id="auto-go" disabled>Rozpocznij</button>
      </div>
    </div>`;
  document.body.append(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => e.target === wrap && close());
  wrap.querySelector('#auto-close').onclick = close;
  const paint = () => {
    const o = data.options[sel];
    wrap.querySelector('#auto-table').innerHTML = `
      <div class="at-row at-head"><span>Czas</span><span>Treningi</span><span>Punkty</span><span>Monety</span><span>Energia</span></div>
      ${data.options
        .map(
          (x, i) => `<button class="at-row ${i === sel ? 'on' : ''} ${x.affordable ? '' : 'no'}" data-i="${i}">
            <span><b>${hoursLabel(x.hours)}</b></span><span>${fmt(x.count)}</span><span>+${x.levels}</span>
            <span class="${x.missingMoney ? 'lack' : ''}">${fmt(x.money)}</span><span class="${x.missingEnergy ? 'lack' : ''}">${fmt(x.energy)}</span>
          </button>`,
        )
        .join('')}`;
    wrap.querySelectorAll('.at-row[data-i]').forEach((b) => (b.onclick = () => ((sel = Number(b.dataset.i)), paint())));
    const lacks = [];
    if (o.missingMoney) lacks.push(`${fmt(o.missingMoney)} monet`);
    if (o.missingEnergy) lacks.push(`${fmt(o.missingEnergy)} energii`);
    wrap.querySelector('#auto-detail').innerHTML = `
      <p class="plan-line">${hoursLabel(o.hours)}: <b>${fmt(o.count)}</b> treningów, ${s.name} poziom <b>${st.level}</b> → <b>${st.level + o.levels}</b>, koniec ok. ${clock(now() + o.durationMs)}.</p>
      ${o.affordable ? '<p class="ok-text">Stać Cię na ten trening.</p>' : `<p class="warn-text">Brakuje Ci ${lacks.join(' i ')}.</p>`}`;
    wrap.querySelector('#auto-go').disabled = false;
  };
  api('/auto/plan', { spec })
    .then((d) => {
      data = d;
      wrap.querySelector('#auto-have').innerHTML = `Masz: <b>💰 ${fmt(d.money)}</b> · <b>⚡ ${fmt(d.energy)}</b>`;
      paint();
    })
    .catch((e) => (wrap.querySelector('#auto-table').textContent = e.message));
  wrap.querySelector('#auto-go').onclick = async () => {
    try {
      const r = await api('/auto/start', { spec, hours: data.options[sel].hours });
      toast(r.message);
      close();
      await refreshMe();
      render();
    } catch (e) {
      wrap.querySelector('#auto-detail').insertAdjacentHTML('beforeend', `<p class="err-text">${esc(e.message)}</p>`);
      toast(e.message, true);
    }
  };
}

function matchRow(m, perspectiveId) {
  const home = m.home_id === perspectiveId;
  const my = home ? m.home_score : m.away_score;
  const their = home ? m.away_score : m.home_score;
  const res = my > their ? 'W' : my < their ? 'P' : 'R';
  const color = res === 'W' ? 'var(--accent)' : res === 'P' ? 'var(--danger)' : 'var(--muted)';
  return `<tr><td><b style="color:${color}">${res}</b></td>
    <td>${esc(m.home_name)} vs ${esc(m.away_name)}</td><td><b>${m.home_score}:${m.away_score}</b></td>
    <td class="muted">${time(m.created_at)}</td><td><a href="#mecz-${m.id}">Relacja</a></td></tr>`;
}

// ---------- pojedynki: lobby, wyszukiwanie przeciwnika (jak w grach MOBA) i rozgrywka na żywo ----------
const mmss2 = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

async function viewDuels(arg) {
  if (arg === 'gra') return penaltyGame();
  const [{ stats, recent }, { duel }, queue] = await Promise.all([api('/pvp/stats'), api('/penalty/current'), api('/pvp/status')]);
  const p = ME.player;
  const pct = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  view.innerHTML = `
    <section class="pv">
      <div class="pv-hero">
        <aside class="pv-info">
          <h3>${icon('info', 'sm')} Czym są Pojedynki?</h3>
          <p>Rzuty karne jeden na jednego z prawdziwym graczem. Raz strzelasz, raz bronisz. Po 5 strzałów wygrywa ten, kto trafił więcej razy, a przy remisie gracie dalej do pierwszej różnicy.</p>
          <ul>
            <li>Na każdy ruch masz 10 sekund.</li>
            <li>Strzelasz, zatrzymując krążący celownik. Im lepsze Wykończenie, tym wolniej krąży i tym mocniejszy strzał.</li>
            <li>Statystyki bramkarskie nie mają tu znaczenia: bronisz, czytając strzał.</li>
            <li>Gdy przez minutę nikt nie szuka gry, zagrasz z botem.</li>
          </ul>
        </aside>
        <div class="pv-center">
          <p class="pv-kicker">Tryb rywalizacji</p>
          <h1 class="pv-title">Pojedynki <span>karne</span></h1>
          ${
            duel
              ? `<a class="pv-play" href="#pojedynki-gra"><span>Wróć do gry</span><small>z ${esc(duel.opponent.name)}</small></a>`
              : `<button class="pv-play" id="pv-play"><span>Graj</span><small>⚡ ${CFG.duelEnergy} energii</small></button>`
          }
          <p class="pv-reward">Za wygraną: <b>+2000 ⚡</b> i <b>+500 💰</b></p>
        </div>
      </div>
      <div class="pv-board">
        <h3>Twoje wyniki w pojedynkach</h3>
        <div class="pv-stats">
          <div><b>${stats.played}</b><span>rozegrane</span></div>
          <div class="w"><b>${stats.wins}</b><span>wygrane</span></div>
          <div class="l"><b>${stats.losses}</b><span>przegrane</span></div>
          <div><b>${pct}%</b><span>skuteczność</span></div>
          <div><b>${stats.goals}:${stats.conceded}</b><span>bramki</span></div>
          <div><b>#${stats.rank}</b><span>w rankingu</span></div>
        </div>
        <div class="table-wrap"><table>
          ${recent.map((m) => matchRow(m, p.id)).join('') || '<tr><td class="muted">Nie masz jeszcze rozegranych pojedynków. Kliknij Graj!</td></tr>'}
        </table></div>
        <p class="muted pv-note">Wyniki pojedynków mają osobny ranking (Ranking, zakładka Pojedynki) i nie wpływają na ranking OVR.</p>
      </div>
    </section>`;
  const play = $('#pv-play');
  if (play)
    play.onclick = async () => {
      play.disabled = true;
      try {
        const r = await api('/pvp/search', {});
        await refreshMe();
        r.state === 'found' ? matchFound(r.duel) : searchScreen(r.waited || 0);
      } catch (e) {
        toast(e.message, true);
        play.disabled = false;
      }
    };
  if (!duel && queue.state === 'searching') searchScreen(queue.waited);
}

// Ekran wyszukiwania: radar, licznik czasu, liczba szukających, anulowanie.
function searchScreen(waited) {
  document.querySelector('.mm')?.remove();
  const p = ME.player;
  const started = Date.now() - waited;
  const el = document.createElement('div');
  el.className = 'mm';
  el.innerHTML = `
    <div class="mm-box">
      <div class="mm-radar">
        <i></i><i></i><i></i><span class="mm-sweep"></span>
        <div class="mm-me">${avatar(p, 'lg')}</div>
      </div>
      <h2 class="mm-title">Szukanie przeciwnika</h2>
      <div class="mm-time" id="mm-time">0:00</div>
      <p class="mm-est">Szacowany czas: <b>0:30</b></p>
      <p class="mm-info" id="mm-info">Łączymy Cię z graczem o podobnym OVR…</p>
      <div class="mm-bar"><i id="mm-bar"></i></div>
      <button class="ghost" id="mm-cancel">Anuluj</button>
    </div>`;
  document.body.append(el);
  let alive = true;
  const stop = () => {
    alive = false;
    clearInterval(clock);
    el.remove();
    window.removeEventListener('hashchange', onLeave);
  };
  const onLeave = () => {
    if (!alive) return;
    stop();
    api('/pvp/cancel', {}).catch(() => {});
  };
  window.addEventListener('hashchange', onLeave);
  const clock = setInterval(() => {
    const t = Date.now() - started;
    $('#mm-time').textContent = mmss2(t);
    $('#mm-bar').style.width = `${Math.min(100, (t / 60000) * 100)}%`;
    if (t > 45000) $('#mm-info').textContent = 'Mało graczy w kolejce. Za chwilę dobierzemy przeciwnika…';
  }, 250);
  el.querySelector('#mm-cancel').onclick = async () => {
    stop();
    await api('/pvp/cancel', {}).catch(() => {});
    toast('Anulowano szukanie.');
  };
  const poll = async () => {
    if (!alive) return;
    try {
      const r = await api('/pvp/status');
      if (!alive) return;
      if (r.state === 'found') {
        stop();
        return matchFound(r.duel);
      }
      if (r.state === 'idle') return stop();
      if (r.searching > 1) $('#mm-info').textContent = `W kolejce: ${r.searching} graczy. Dobieramy parę…`;
    } catch {}
    setTimeout(poll, 1000);
  };
  setTimeout(poll, 700);
}

// Przeciwnik znaleziony: ekran VS z odliczaniem.
function matchFound(duel) {
  document.querySelector('.mm')?.remove();
  const p = ME.player;
  const o = duel.opponent;
  const el = document.createElement('div');
  el.className = 'mm found';
  el.innerHTML = `
    <div class="mm-box">
      <p class="mm-kicker">${o.bot ? 'Nie znaleźliśmy gracza, gracie z botem' : 'Znaleziono przeciwnika!'}</p>
      <div class="vs">
        <div class="vs-card me">${avatar(p, 'lg')}<b>${esc(p.name)}</b><span>${CFG.positions[p.position]} · OVR ${p.ovr}</span></div>
        <div class="vs-mark">VS</div>
        <div class="vs-card op">${avatar(o, 'lg')}<b>${esc(o.name)}</b><span>${CFG.positions[o.position]} · OVR ${o.ovr}${o.bot ? ' · <em>Bot</em>' : ''}</span></div>
      </div>
      <div class="mm-count" id="mm-count">3</div>
    </div>`;
  document.body.append(el);
  let n = 3;
  const t = setInterval(() => {
    n -= 1;
    if (n > 0) el.querySelector('#mm-count').textContent = n;
    else {
      clearInterval(t);
      el.remove();
      location.hash = '#pojedynki-gra';
      if (location.hash === '#pojedynki-gra') render();
    }
  }, 900);
}

// Prędkość krążącego celownika: im lepsze Wykończenie (i trochę Wizja gry oraz Szybkość), tym wolniej.
// Te same wzory co na serwerze (server/game.js: shooterSkill, aimSpeed).
function aimSpeed() {
  const s = ME.player.stats;
  const skill = s.wykonczenie * 0.7 + s.wizja * 0.15 + s.szybkosc * 0.15;
  return 1.5 / (1 + skill / 45);
}

async function penaltyGame() {
  let duel = (await api('/penalty/current')).duel;
  if (!duel) {
    location.hash = '#pojedynki';
    return;
  }
  const p = ME.player;
  const opp = duel.opponent;
  view.innerHTML = `
    <div class="pk">
      <div class="pk-board">
        <div class="pk-side me">${avatar(p, 'sm')}<b>${esc(p.name)}</b><div class="pk-dots" id="dots-my"></div></div>
        <div class="pk-score"><span id="sc-my">0</span><i>:</i><span id="sc-op">0</span><small id="pk-sd" hidden>Seria dodatkowa</small></div>
        <div class="pk-side op"><b>${esc(opp.name)}${opp.bot ? ' <em class="bot-tag">Bot</em>' : ''}</b>${avatar(opp, 'sm')}<div class="pk-dots" id="dots-op"></div></div>
      </div>
      <div class="pk-stage">
        <canvas id="pk-canvas" aria-label="Rzuty karne"></canvas>
        <div class="pk-hint" id="pk-hint"></div>
        <div class="pk-timer" id="pk-timer" hidden><b>10</b></div>
        <div class="pk-toss" id="pk-toss" hidden></div>
      </div>
      <div class="pk-end" id="pk-end" hidden></div>
    </div>`;
  const canvas = $('#pk-canvas');
  const scene = PenaltyScene(canvas);
  const alive = () => document.body.contains(canvas);
  let shown = duel.kicks.length; // nie odtwarzamy ruchów sprzed wejścia na ekran
  let my = duel.my.slice(0, 0);
  let op = [];
  for (const k of duel.kicks) (k.side === 'my' ? my : op).push(k.result);
  const dots = (list, total) =>
    Array.from({ length: Math.max(total, list.length) }, (_, i) => `<span class="pk-dot ${list[i] ? (list[i] === 'goal' ? 'g' : 'x') : ''}"></span>`).join('');
  const paint = (suddenDeath) => {
    const total = Math.max(CFG.penaltyKicks, my.length, op.length);
    $('#dots-my').innerHTML = dots(my, total);
    $('#dots-op').innerHTML = dots(op, total);
    $('#sc-my').textContent = my.filter((r) => r === 'goal').length;
    $('#sc-op').textContent = op.filter((r) => r === 'goal').length;
    $('#pk-sd').hidden = !suddenDeath;
  };
  const hint = (html) => ($('#pk-hint').innerHTML = html);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  paint(duel.status.suddenDeath);

  // odliczanie czasu na ruch
  let decideTimer = null;
  const stopTimer = () => {
    clearInterval(decideTimer);
    decideTimer = null;
    if (alive()) $('#pk-timer').hidden = true;
  };
  const startTimer = (ms, onEnd) => {
    stopTimer();
    const end = Date.now() + ms;
    const el = $('#pk-timer');
    el.hidden = false;
    const tick = () => {
      if (!alive()) return stopTimer();
      const left = Math.max(0, end - Date.now());
      el.style.setProperty('--p', left / CFG_DECIDE);
      el.querySelector('b').textContent = Math.ceil(left / 1000);
      el.classList.toggle('urgent', left < 3500);
      if (left <= 0) {
        stopTimer();
        onEnd();
      }
    };
    tick();
    decideTimer = setInterval(tick, 100);
  };
  const CFG_DECIDE = duel.decideMs || 10000;

  // losowanie, kto zaczyna (tylko przed pierwszym ruchem)
  if (!duel.kicks.length) {
    scene.show(duel.first === 'my' ? 'shoot' : 'save');
    const toss = $('#pk-toss');
    toss.hidden = false;
    toss.innerHTML = `<div class="coin"><span>FS</span><span>⚽</span></div><p>Losowanie…</p>`;
    await sleep(1300);
    toss.querySelector('p').innerHTML = duel.first === 'my' ? '<b>Zaczynasz Ty!</b> Pierwszy strzał należy do Ciebie.' : `<b>Zaczyna ${esc(opp.name)}.</b> Najpierw bronisz.`;
    await sleep(Math.max(1200, (duel.startsIn || 0) - 1300));
    toss.hidden = true;
  }

  let sending = false;
  async function send(target) {
    if (sending) return;
    sending = true;
    stopTimer();
    hint('');
    try {
      const r = await api(`/penalty/${duel.id}/kick`, target);
      sending = false;
      step(r.duel);
    } catch (e) {
      sending = false;
      toast(e.message, true);
      step();
    }
  }

  async function finish(d) {
    paint(d.status.suddenDeath);
    await refreshMe();
    const res = d.status.result;
    const rew = d.reward;
    $('#pk-end').hidden = false;
    $('#pk-end').innerHTML = `
      <h2 class="pk-res ${res}">${res === 'win' ? 'Wygrana!' : 'Porażka'} ${d.status.me}:${d.status.op}</h2>
      <p>${rew && rew.money ? `Nagroda: <b>+${fmt(rew.energy)} ⚡</b> i <b>+${fmt(rew.money)} 💰</b>` : 'Tym razem bez nagrody. Spróbuj jeszcze raz!'}</p>
      <div class="row" style="justify-content:center">
        ${d.matchId ? `<a class="btn" href="#mecz-${d.matchId}">Zobacz przebieg</a>` : ''}
        <a class="btn" href="#pojedynki">Zagraj ponownie</a>
      </div>`;
    hint('');
  }

  // Główna pętla: odtwarza nowe ruchy, potem czeka na mój wybór albo na ruch przeciwnika.
  let stepping = false;
  async function step(given) {
    if (!alive() || stepping) return;
    stepping = true;
    try {
      let d = given;
      if (!d) {
        d = (await api('/penalty/current')).duel;
        if (!d) d = (await api(`/penalty/${duel.id}`)).duel; // seria właśnie się skończyła
      }
      while (shown < d.kicks.length && alive()) {
        const k = d.kicks[shown];
        stopTimer();
        hint('');
        if (k.side === 'my') scene.show('shoot');
        else if (scene.view !== 'save') scene.show('save');
        await scene.play(k);
        shown += 1;
        (k.side === 'my' ? my : op).push(k.result);
        paint(d.status.suddenDeath);
      }
      if (!alive()) return;
      if (d.status.finished) return finish(d);
      if (d.status.turn && !d.waiting) {
        if (d.status.turn === 'shoot') {
          hint('<b>Twój strzał.</b> Celownik krąży po bramce. Stuknij, aby go zatrzymać i strzelić.');
          scene.wait('shoot', send, { sweep: aimSpeed() });
        } else {
          hint('<b>Bronisz.</b> Stuknij w bramkę tam, gdzie rzuci się Twój bramkarz.');
          scene.wait('save', send);
        }
        const ms = Math.max(1000, Math.min(CFG_DECIDE, (d.deadlineIn || CFG_DECIDE) - 2000));
        const turn = d.status.turn;
        startTimer(ms, () => {
          scene.cancel();
          toast(turn === 'shoot' ? 'Koniec czasu! Strzał poszedł obok bramki.' : 'Koniec czasu! Bramkarz został w środku.', true);
          send(turn === 'shoot' ? { x: 1.6, y: 0.4, timeout: true } : { x: 0, y: 0.45, timeout: true });
        });
        return;
      }
      // czekamy na ruch przeciwnika
      hint(`<span class="dots-anim">Czekam na ruch: ${esc(opp.name)}</span>`);
      setTimeout(() => step(), 600);
    } catch (e) {
      setTimeout(() => step(), 1500);
    } finally {
      stepping = false;
    }
  }
  step(duel);
}

async function viewMatch(id) {
  const { match: m } = await api('/matches/' + id);
  view.innerHTML = `
    <h1>${m.kind === 'club' ? 'Mecz klubowy' : m.penalty ? 'Pojedynek karnych' : 'Mecz'}</h1>
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
      $('#min').textContent = m.penalty ? 'Koniec serii' : 'Koniec meczu';
      $('#sc').textContent = `${m.home_score}:${m.away_score}`;
      $('#skip').hidden = true;
      timers.forEach(clearInterval);
      return;
    }
    const e = m.events[i++];
    if (e.type === 'goal') score[e.side]++;
    $('#sc').textContent = `${score[0]}:${score[1]}`;
    $('#min').textContent = m.penalty ? `Strzał ${e.minute}` : `${e.minute}'`;
    $('#ev').insertAdjacentHTML(
      'beforeend',
      `<li class="${e.type} ${e.side === 1 ? 'right' : ''}"><span class="min">${m.penalty ? '#' + e.minute : e.minute + "'"}</span>${esc(e.text)}</li>`,
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
    <div class="hero-head">${avatar(p, 'lg')}<div><h1><span class="dot ${p.online ? 'on' : ''}"></span>${esc(p.name)}</h1><span class="tag">${CFG.positions[p.position]}</span> <span class="tag ovr-tag">OVR ${p.ovr}</span></div></div>
    <div class="grid">
      <div class="card">
        <h3>Profil</h3>
        <p>OVR <b>${p.ovr}</b> · z ekwipunkiem <b>${p.overall}</b></p>
        <p>Klub: ${p.club ? `<a href="#klub-${p.club.id}">[${esc(p.club.tag)}] ${esc(p.club.name)}</a>` : 'brak'}</p>
        <p>Bilans: <b>${p.wins}</b>W · <b>${p.draws}</b>R · <b>${p.losses}</b>P · ⚽ ${p.goals}</p>
      </div>
      <div class="card"><h3>Statystyki</h3>${statsTable(p, false)}</div>
      <div class="card"><h3>Ostatnie pojedynki</h3><div class="table-wrap"><table>${matches.map((m) => matchRow(m, p.id)).join('') || '<tr><td class="muted">Brak meczów.</td></tr>'}</table></div></div>
    </div>`;
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
                btn = `<button class="small" data-buy="${i.id}" ${p.ovr < i.ovr || p.money < i.price ? 'disabled' : ''}>${fmt(i.price)} 💰</button>`;
              return `<div class="item"><div><b>${esc(i.name)}</b><br><small class="bonus">${bonus}</small>
                ${p.ovr < i.ovr ? `<br><small class="muted">Wymaga OVR ${i.ovr}</small>` : ''}</div>${btn}</div>`;
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
          <label>Skrót (od 2 do 4 znaków)<input name="tag" required maxlength="4"></label>
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
          <tr><th>Piłkarz</th><th>OVR</th>${d.isOwner ? '<th></th>' : ''}</tr>
          ${d.members
            .map(
              (m) => `<tr><td class="who">${avatar(m, 'sm')}<span class="dot ${m.online ? 'on' : ''}"></span><a href="#gracz-${m.id}">${esc(m.name)}</a>
                ${m.id === c.ownerId ? '<span class="tag on">Prezes</span>' : ''} <span class="tag">${m.position}</span></td>
                <td><b>${m.ovr}</b></td>
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
                (a) => `<div class="item"><span>${esc(a.name)} <span class="tag">${a.position}</span> OVR ${a.ovr}</span>
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
  const kind = tab === 'kluby' ? 'kluby' : tab === 'pojedynki' ? 'pojedynki' : 'gracze';
  const data = await api(kind === 'kluby' ? '/ranking/clubs' : kind === 'pojedynki' ? '/ranking/penalty' : '/ranking/players');
  const tabBtn = (k, label) => `<button class="${kind === k ? 'on' : ''}" onclick="location.hash='#ranking-${k}'">${label}</button>`;
  let rows;
  if (kind === 'gracze')
    rows = `<tr><th>#</th><th>Piłkarz</th><th>Klub</th><th>OVR</th></tr>
      ${data.players
        .map((p, i) => `<tr><td>${i + 1}</td><td class="who">${avatar(p, 'sm')}<a href="#gracz-${p.id}">${esc(p.name)}</a> <span class="tag">${p.position}</span></td>
          <td>${p.club ? `[${esc(p.club.tag)}]` : 'brak'}</td><td><b>${p.ovr}</b></td></tr>`)
        .join('')}`;
  else if (kind === 'pojedynki')
    rows = `<tr><th>#</th><th>Piłkarz</th><th>Wygrane</th><th>Przegrane</th><th>Skuteczność</th><th>Gole</th></tr>
      ${data.players
        .map((p, i) => `<tr><td>${i + 1}</td><td class="who">${avatar(p, 'sm')}<a href="#gracz-${p.id}">${esc(p.name)}</a></td>
          <td><b>${p.wins}</b></td><td>${p.losses}</td><td>${Math.round((p.wins / Math.max(1, p.played)) * 100)}%</td><td>${p.goals}</td></tr>`)
        .join('') || '<tr><td colspan="6" class="muted">Nikt jeszcze nie rozegrał pojedynku.</td></tr>'}`;
  else
    rows = `<tr><th>#</th><th>Klub</th><th>Członkowie</th><th>Pkt</th><th>W/R/P</th></tr>
      ${data.clubs
        .map((c, i) => `<tr><td>${i + 1}</td><td><a href="#klub-${c.id}">[${esc(c.tag)}] ${esc(c.name)}</a></td>
          <td>${c.members}</td><td><b>${c.points}</b></td><td>${c.wins}/${c.draws}/${c.losses}</td></tr>`)
        .join('') || '<tr><td colspan="5" class="muted">Brak klubów.</td></tr>'}`;
  view.innerHTML = `
    <h1>Ranking</h1>
    <div class="tabs">${tabBtn('gracze', 'Piłkarze (OVR)')}${tabBtn('pojedynki', 'Pojedynki')}${tabBtn('kluby', 'Kluby')}</div>
    <div class="card table-wrap"><table>${rows}</table></div>`;
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
