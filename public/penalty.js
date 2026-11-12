// Pojedynek rzutów karnych: scena rysowana na canvasie (strzał i obrona).
// Logika i wyniki liczy serwer; ta scena tylko pokazuje animacje i zbiera kliknięcia.
// Układ bramki: x od -1 (lewy słupek) do 1 (prawy), y od 0 (murawa) do 1 (poprzeczka).
(() => {
  const W = 800;
  const H = 560;
  const KIT = {
    me: { shirt: '#b6f23a', trim: '#0b1a10', skin: '#f2c9a8', hair: '#151515', gloves: '#ffd23f' },
    op: { shirt: '#8f3fd6', trim: '#120a1e', skin: '#e9bf9b', hair: '#1c1010', gloves: '#ffd23f' },
    keeper: { shirt: '#8a8f96', trim: '#2b2f35', skin: '#f0c6a6', hair: '#141414', gloves: '#ffd23f' },
  };
  // Postacie anime (wycięte z grafiki gry): bramkarka i strzelec. Kadr kończy się na kolanach,
  // więc łydki, getry i buty dorysowujemy.
  const loadImg = (src) => {
    const im = new Image();
    im.src = src;
    return im;
  };
  const SPRITES = { keeper: loadImg("img/pk-keeper.webp"), shooter: loadImg("img/pk-shooter.webp") };
  const ready = (im) => im.complete && im.naturalWidth > 0;

  function drawLegs(g, x, kneeY, feetY, w, sock, stripe, kick = 0) {
    for (const side of [-1, 1]) {
      const kx = x + side * w * 0.22;
      const fx = side === 1 ? kx + kick * w * 0.9 : kx + side * w * 0.04;
      const fy = side === 1 ? lerp(feetY, kneeY + (feetY - kneeY) * 0.35, kick) : feetY;
      g.lineCap = "round";
      g.strokeStyle = "#f0c6a6";
      g.lineWidth = w * 0.2;
      g.beginPath();
      g.moveTo(kx, kneeY);
      g.lineTo(lerp(kx, fx, 0.3), lerp(kneeY, fy, 0.3));
      g.stroke();
      g.strokeStyle = sock;
      g.lineWidth = w * 0.21;
      g.beginPath();
      g.moveTo(lerp(kx, fx, 0.28), lerp(kneeY, fy, 0.28));
      g.lineTo(fx, fy - w * 0.06);
      g.stroke();
      g.strokeStyle = stripe;
      g.lineWidth = w * 0.05;
      g.beginPath();
      g.moveTo(lerp(kx, fx, 0.38) - w * 0.1, lerp(kneeY, fy, 0.38));
      g.lineTo(lerp(kx, fx, 0.38) + w * 0.1, lerp(kneeY, fy, 0.38));
      g.stroke();
      g.fillStyle = "#0d0f0e";
      g.beginPath();
      g.ellipse(fx + side * w * 0.05, fy - w * 0.03, w * 0.17, w * 0.08, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // Postać ze sprite'a: h = wysokość całej postaci (z dorysowanymi nogami), stopy w feetY.
  function drawSprite(g, im, x, feetY, h, o = {}) {
    const legH = h * 0.24;
    const sh = h - legH + h * 0.03;
    const sw = sh * (im.naturalWidth / im.naturalHeight);
    g.save();
    g.translate(x, feetY - h / 2);
    if (o.rot) g.rotate(o.rot);
    if (o.alpha != null) g.globalAlpha = o.alpha;
    const top = -h / 2;
    const kneeY = top + sh - h * 0.04;
    if (!o.noShadow) {
      g.fillStyle = "rgba(0,0,0,.35)";
      g.beginPath();
      g.ellipse(0, h / 2, sw * 0.42, h * 0.035, 0, 0, Math.PI * 2);
      g.fill();
    }
    drawLegs(g, 0, kneeY, h / 2, sw * 0.62, o.sock || "#7d838a", o.stripe || "#222", o.kick || 0);
    g.drawImage(im, -sw / 2, top, sw, sh);
    g.restore();
  }

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function seeded(n) {
    let a = n >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- tło (stadion nocą), rysowane raz ----------
  function makeBackdrop(horizon, view) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const r = seeded(view === 'shoot' ? 7 : 11);
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#02060a');
    sky.addColorStop(1, '#0a1f17');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, horizon);
    // trybuny z kibicami
    for (let row = 0; row < 7; row++) {
      const y = horizon - 18 - row * 15;
      g.fillStyle = row % 2 ? '#0b1712' : '#0e1d16';
      g.fillRect(0, y, W, 15);
      for (let x = 0; x < W; x += 6) {
        if (r() < 0.75) {
          const hue = r();
          g.fillStyle = hue < 0.25 ? '#b6f23a' : hue < 0.4 ? '#8f3fd6' : hue < 0.55 ? '#e8eef0' : '#1f3a2b';
          g.globalAlpha = 0.25 + r() * 0.45;
          g.fillRect(x + r() * 3, y + 3 + r() * 6, 3, 4);
        }
      }
      g.globalAlpha = 1;
    }
    // reklamy przy linii
    const ad = g.createLinearGradient(0, 0, W, 0);
    ad.addColorStop(0, '#0d2a17');
    ad.addColorStop(0.5, '#164a26');
    ad.addColorStop(1, '#0d2a17');
    g.fillStyle = ad;
    g.fillRect(0, horizon - 16, W, 16);
    g.font = '700 11px "Chakra Petch", sans-serif';
    g.fillStyle = '#b6f23a';
    g.globalAlpha = 0.85;
    for (let x = 20; x < W; x += 170) g.fillText('FOOTBALL STARS', x, horizon - 4);
    g.globalAlpha = 1;
    // jupitery
    for (const fx of [70, W - 70]) {
      const glow = g.createRadialGradient(fx, 30, 0, fx, 30, 170);
      glow.addColorStop(0, 'rgba(220,255,230,.55)');
      glow.addColorStop(1, 'rgba(220,255,230,0)');
      g.fillStyle = glow;
      g.fillRect(fx - 170, 0, 340, 220);
      g.fillStyle = '#f4fff6';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.fillRect(fx - 22 + i * 12, 14 + j * 9, 8, 6);
    }
    // murawa w pasy (perspektywa)
    let y = horizon;
    let band = 6;
    let i = 0;
    while (y < H) {
      g.fillStyle = i % 2 ? '#1f7a33' : '#238a3a';
      g.fillRect(0, y, W, band + 1);
      y += band;
      band *= 1.18;
      i++;
    }
    const shade = g.createLinearGradient(0, horizon, 0, H);
    shade.addColorStop(0, 'rgba(0,0,0,.35)');
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shade;
    g.fillRect(0, horizon, W, H - horizon);
    const vig = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,.5)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
    return c;
  }

  // ---------- postać (widok z przodu) ----------
  function drawFigure(g, x, feetY, h, kit, o = {}) {
    const s = h / 120;
    g.save();
    g.translate(x, feetY);
    if (o.rot) g.rotate(o.rot);
    g.scale(s * (o.flip ? -1 : 1), s);
    // cień
    if (!o.noShadow) {
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.beginPath();
      g.ellipse(0, 0, 26, 6, 0, 0, Math.PI * 2);
      g.fill();
    }
    const kick = o.kick || 0; // 0..1 zamach nogą
    // nogi
    g.lineCap = 'round';
    g.strokeStyle = kit.skin;
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(-8, -46);
    g.lineTo(-10 - (o.spread || 0) * 10, -4);
    g.moveTo(8, -46);
    g.lineTo(lerp(10, 26, kick) + (o.spread || 0) * 10, lerp(-4, -26, kick));
    g.stroke();
    // getry i buty
    g.strokeStyle = kit.trim;
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(-9 - (o.spread || 0) * 7, -20);
    g.lineTo(-10 - (o.spread || 0) * 10, -5);
    g.moveTo(lerp(9, 20, kick) + (o.spread || 0) * 7, lerp(-20, -18, kick));
    g.lineTo(lerp(10, 26, kick) + (o.spread || 0) * 10, lerp(-5, -26, kick));
    g.stroke();
    // spodenki
    g.fillStyle = kit.trim;
    g.beginPath();
    g.roundRect(-16, -62, 32, 20, 4);
    g.fill();
    // koszulka
    const shirt = g.createLinearGradient(-20, -100, 20, -55);
    shirt.addColorStop(0, kit.shirt);
    shirt.addColorStop(1, shade(kit.shirt, -0.35));
    g.fillStyle = shirt;
    g.beginPath();
    g.moveTo(-19, -98);
    g.quadraticCurveTo(0, -104, 19, -98);
    g.lineTo(17, -58);
    g.lineTo(-17, -58);
    g.closePath();
    g.fill();
    g.fillStyle = kit.trim;
    g.fillRect(-3, -96, 6, 36);
    // ręce
    const arm = o.arms ?? 0.25; // 0 = w dół, 1 = w górę
    g.strokeStyle = kit.shirt;
    g.lineWidth = 8;
    for (const side of [-1, 1]) {
      const ang = lerp(0.35, -1.25, arm) * side;
      const ex = side * 18 + Math.sin(ang) * 30 * side * side;
      const hx = side * 20 + Math.sin(ang + side * 0.2) * 34;
      const hy = -94 + Math.cos(ang) * 34 * (arm > 0.6 ? -1 : 1);
      g.beginPath();
      g.moveTo(side * 18, -94);
      g.lineTo(lerp(side * 22, hx, 0.55), lerp(-80, hy, 0.55));
      g.stroke();
      g.strokeStyle = kit.skin;
      g.beginPath();
      g.moveTo(lerp(side * 22, hx, 0.55), lerp(-80, hy, 0.55));
      g.lineTo(hx, hy);
      g.stroke();
      g.strokeStyle = kit.shirt;
      if (o.gloves) {
        g.fillStyle = kit.gloves;
        g.beginPath();
        g.arc(hx, hy, 6.5, 0, Math.PI * 2);
        g.fill();
      }
      void ex;
    }
    // głowa i włosy
    g.fillStyle = kit.skin;
    g.beginPath();
    g.arc(0, -112, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = kit.hair;
    g.beginPath();
    g.moveTo(-12, -112);
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      const rr = i % 2 ? 17 : 12;
      g.lineTo(Math.cos(a) * rr, -114 + Math.sin(a) * rr);
    }
    g.lineTo(12, -112);
    g.closePath();
    g.fill();
    g.restore();
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v + (k < 0 ? v * k : (255 - v) * k)), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  // Piłka: biała z czarnymi łatami (pięciokąt w środku i fragmenty łat przy krawędzi), z cieniowaniem.
  function drawBall(g, x, y, r, spin) {
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.save();
    g.clip();
    g.fillStyle = "#f7faf8";
    g.fillRect(-r, -r, 2 * r, 2 * r);
    g.rotate(spin);
    const pent = (cx, cy, rr, rot) => {
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2;
        g[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath();
    };
    g.fillStyle = "#16191a";
    g.strokeStyle = "rgba(40,45,44,.55)";
    g.lineWidth = Math.max(0.6, r * 0.05);
    pent(0, 0, r * 0.32, 0);
    g.fill();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      // szwy od środkowej łaty do łat brzegowych
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32);
      g.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
      g.stroke();
      pent(Math.cos(a + Math.PI / 5) * r * 0.98, Math.sin(a + Math.PI / 5) * r * 0.98, r * 0.3, a);
      g.fill();
    }
    g.restore();
    // cieniowanie kuli i odblask
    const shade = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r * 1.05);
    shade.addColorStop(0, "rgba(255,255,255,.35)");
    shade.addColorStop(0.55, "rgba(255,255,255,0)");
    shade.addColorStop(1, "rgba(0,20,10,.45)");
    g.fillStyle = shade;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawGlove(g, x, y, size, mirror, alpha = 1) {
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.scale(mirror ? -size : size, size);
    g.fillStyle = '#ffd23f';
    g.strokeStyle = '#3a2d00';
    g.lineWidth = 0.06;
    g.beginPath();
    g.roundRect(-0.42, -0.2, 0.84, 0.75, 0.2);
    g.fill();
    g.stroke();
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.roundRect(-0.42 + i * 0.215, -0.72, 0.19, 0.6, 0.09);
      g.fill();
      g.stroke();
    }
    g.beginPath();
    g.roundRect(-0.72, -0.05, 0.36, 0.22, 0.1);
    g.fill();
    g.stroke();
    g.fillStyle = '#0b1a10';
    g.fillRect(-0.42, 0.36, 0.84, 0.12);
    g.restore();
  }

  // ---------- scena ----------
  function PenaltyScene(canvas) {
    const g = canvas.getContext('2d');
    const state = {
      view: 'shoot',
      aim: null, // pozycja celownika (ekran)
      busy: false,
      t0: performance.now(),
      anim: null, // bieżąca animacja
      particles: [],
      text: null,
      shake: 0,
      gloves: null,
      names: { me: 'Ty', op: 'Rywal' },
    };
    const back = { shoot: makeBackdrop(250, 'shoot'), save: makeBackdrop(250, 'save') };
    let onPick = null;
    let raf = 0;

    // mapowanie bramki na ekran
    const map = {
      shoot: (p) => ({ x: 400 + p.x * 205, y: 352 - p.y * 150 }),
      save: (p) => ({ x: 400 + p.x * 350, y: 520 - p.y * 455 }),
    };
    const unmap = {
      shoot: (sx, sy) => ({ x: (sx - 400) / 205, y: (352 - sy) / 150 }),
      save: (sx, sy) => ({ x: (sx - 400) / 350, y: (520 - sy) / 455 }),
    };

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * (H / W) * dpr);
      g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function toScene(e) {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    }
    canvas.addEventListener('pointermove', (e) => {
      if (!state.busy) state.aim = toScene(e);
    });
    canvas.addEventListener('pointerleave', () => (state.aim = null));
    canvas.addEventListener('pointerdown', (e) => {
      if (state.busy || !onPick) return;
      const p = toScene(e);
      state.aim = p;
      const goal = unmap[state.view](p.x, p.y);
      if (state.view === 'save') state.gloves = { x: p.x, y: p.y, placed: performance.now() };
      const cb = onPick;
      onPick = null;
      cb({ x: +goal.x.toFixed(3), y: +goal.y.toFixed(3) });
    });

    // ---------- rysowanie widoku "strzał" ----------
    function drawShoot(now) {
      g.drawImage(back.shoot, 0, 0);
      // pole karne
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 352);
      g.lineTo(W, 352);
      g.moveTo(90, 352);
      g.lineTo(-40, 470);
      g.moveTo(710, 352);
      g.lineTo(840, 470);
      g.moveTo(255, 352);
      g.lineTo(225, 392);
      g.lineTo(575, 392);
      g.lineTo(545, 352);
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(400, 512, 9, 3.5, 0, 0, Math.PI * 2);
      g.fill();
      drawGoalFront(now);
      // bramkarz rywala
      const a = state.anim;
      let kx = 400;
      let ky = 352;
      let rot = 0;
      let arms = 0.3 + Math.sin(now / 260) * 0.08;
      let spread = 0.4;
      const sway = Math.sin(now / 420) * 12;
      if (a && a.kick.side === 'my') {
        const t = clamp((a.t - 0.12) / 0.55, 0, 1);
        const dv = map.shoot(a.kick.dive);
        kx = lerp(400, dv.x, easeOut(t));
        ky = lerp(352, Math.min(352, dv.y + 70), easeOut(t));
        rot = lerp(0, clamp((dv.x - 400) / 230, -1.25, 1.25), easeOut(t));
        arms = lerp(arms, 1, easeOut(t));
        spread = lerp(0.4, 0.8, t);
      } else {
        kx += sway;
      }
      if (ready(SPRITES.keeper)) {
        // smuga ruchu przy rzucie
        if (a && a.kick.side === "my" && rot !== 0) {
          for (const k of [0.55, 0.78]) {
            drawSprite(g, SPRITES.keeper, lerp(400, kx, k), lerp(352, ky, k), 168, { rot: rot * k, alpha: 0.18, noShadow: true });
          }
        }
        drawSprite(g, SPRITES.keeper, kx, ky + Math.abs(Math.sin(now / 300)) * (rot ? 0 : 1.5), 168, { rot, noShadow: rot !== 0 });
      } else {
        drawFigure(g, kx, ky, 128, KIT.keeper, { rot, arms, gloves: true, spread, noShadow: rot !== 0 });
      }
      // piłka
      if (a && a.kick.side === 'my') drawShotBall(a);
      else drawBall(g, 400, 498, 15, 0);
      // celownik
      if (!state.busy && state.aim && onPick) {
        const { x, y } = state.aim;
        g.strokeStyle = '#b6f23a';
        g.lineWidth = 2.5;
        g.shadowColor = '#b6f23a';
        g.shadowBlur = 10;
        g.beginPath();
        g.arc(x, y, 16, 0, Math.PI * 2);
        g.moveTo(x - 24, y);
        g.lineTo(x - 8, y);
        g.moveTo(x + 8, y);
        g.lineTo(x + 24, y);
        g.moveTo(x, y - 24);
        g.lineTo(x, y - 8);
        g.moveTo(x, y + 8);
        g.lineTo(x, y + 24);
        g.stroke();
        g.shadowBlur = 0;
      }
    }

    function drawGoalFront(now) {
      const L = 195;
      const R = 605;
      const T = 202;
      const B = 352;
      const bl = 228;
      const br = 572;
      const bt = 214;
      const bb = 330;
      const a = state.anim;
      // siatka: tył i boki z wybrzuszeniem po golu
      let bulge = null;
      if (a && a.result === 'goal' && a.t > a.hitT) {
        const p = map.shoot(a.kick.ball);
        bulge = { x: p.x, y: p.y, k: Math.sin(clamp((a.t - a.hitT) / 0.35, 0, 1) * Math.PI) * 14 };
      }
      g.strokeStyle = 'rgba(235,245,240,.38)';
      g.lineWidth = 1;
      const net = (x, y) => {
        if (!bulge) return [x, y];
        const d = Math.hypot(x - bulge.x, y - bulge.y);
        const f = Math.max(0, 1 - d / 90) * bulge.k;
        return [x + ((x - bulge.x) / (d || 1)) * f * 0.3, y - f * 0.4 + ((y - bulge.y) / (d || 1)) * f * 0.2];
      };
      for (let i = 0; i <= 24; i++) {
        const x = lerp(bl, br, i / 24);
        g.beginPath();
        for (let j = 0; j <= 10; j++) {
          const [px, py] = net(x, lerp(bt, bb, j / 10));
          j ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
      }
      for (let j = 0; j <= 10; j++) {
        const y = lerp(bt, bb, j / 10);
        g.beginPath();
        for (let i = 0; i <= 24; i++) {
          const [px, py] = net(lerp(bl, br, i / 24), y);
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
      }
      // boki i dach siatki
      for (let j = 0; j <= 8; j++) {
        g.beginPath();
        g.moveTo(L, lerp(T, B, j / 8));
        g.lineTo(bl, lerp(bt, bb, j / 8));
        g.moveTo(R, lerp(T, B, j / 8));
        g.lineTo(br, lerp(bt, bb, j / 8));
        g.stroke();
      }
      for (let i = 0; i <= 16; i++) {
        g.beginPath();
        g.moveTo(lerp(L, R, i / 16), T);
        g.lineTo(lerp(bl, br, i / 16), bt);
        g.stroke();
      }
      // słupki i poprzeczka
      g.shadowColor = 'rgba(0,0,0,.6)';
      g.shadowBlur = 8;
      const post = g.createLinearGradient(0, T, 0, B);
      post.addColorStop(0, '#ffffff');
      post.addColorStop(1, '#d8e0dc');
      g.strokeStyle = post;
      g.lineWidth = 9;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(L, B + 2);
      g.lineTo(L, T);
      g.lineTo(R, T);
      g.lineTo(R, B + 2);
      g.stroke();
      g.shadowBlur = 0;
      void now;
    }

    function drawShotBall(a) {
      const start = { x: 400, y: 498 };
      const end = map.shoot(a.kick.ball);
      let t = clamp(a.t / a.hitT, 0, 1);
      let x;
      let y;
      let r;
      if (a.t <= a.hitT) {
        const e = ease(t);
        const cx = (start.x + end.x) / 2;
        const cy = Math.min(start.y, end.y) - 60;
        x = (1 - e) * (1 - e) * start.x + 2 * (1 - e) * e * cx + e * e * end.x;
        y = (1 - e) * (1 - e) * start.y + 2 * (1 - e) * e * cy + e * e * end.y;
        r = lerp(15, 6.5, e);
      } else {
        t = clamp((a.t - a.hitT) / (1 - a.hitT), 0, 1);
        if (a.result === 'save') {
          const dir = end.x < 400 ? -1 : 1;
          x = end.x + dir * 160 * t;
          y = end.y - 90 * Math.sin(t * Math.PI) + 120 * t;
          r = lerp(6.5, 8, t);
        } else if (a.result === 'miss') {
          x = end.x + (end.x - 400) * 0.25 * t;
          y = end.y - 40 * t;
          r = lerp(6.5, 4.5, t);
        } else {
          x = end.x;
          y = end.y - 6 * t;
          r = 6.5 - t;
        }
      }
      // cień na murawie
      g.fillStyle = 'rgba(0,0,0,.3)';
      g.beginPath();
      g.ellipse(x, lerp(505, 356, ease(Math.min(1, a.t / a.hitT))), r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      drawBall(g, x, y, r, a.t * 18);
    }

    // ---------- rysowanie widoku "obrona" ----------
    function drawSave(now) {
      g.drawImage(back.save, 0, 0);
      g.strokeStyle = 'rgba(255,255,255,.7)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(140, 250);
      g.lineTo(660, 250);
      g.moveTo(140, 250);
      g.lineTo(-60, 560);
      g.moveTo(660, 250);
      g.lineTo(860, 560);
      g.moveTo(300, 250);
      g.lineTo(250, 330);
      g.lineTo(550, 330);
      g.lineTo(500, 250);
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(400, 300, 6, 2.2, 0, 0, Math.PI * 2);
      g.fill();
      const a = state.anim;
      // strzelec: rozbieg i strzał
      let sx = 352;
      let sy = 292;
      let kick = 0;
      if (a && a.kick.side === 'op') {
        const run = clamp(a.t / 0.42, 0, 1);
        sx = lerp(352, 388, run);
        sy = lerp(292, 298, run);
        kick = clamp((a.t - 0.36) / 0.1, 0, 1) * (1 - clamp((a.t - 0.55) / 0.2, 0, 1));
      } else {
        sx += Math.sin(now / 500) * 2;
      }
      if (ready(SPRITES.shooter)) {
        const bob = a && a.kick.side === "op" && a.t < 0.42 ? Math.abs(Math.sin(a.t * 40)) * 4 : 0;
        drawSprite(g, SPRITES.shooter, sx, sy - bob, 132, { kick, sock: "#141414", stripe: "#8f3fd6" });
      } else {
        drawFigure(g, sx, sy, 92, KIT.op, { kick, arms: 0.15 + kick * 0.3 });
      }
      // piłka
      if (a && a.kick.side === 'op') drawIncomingBall(a);
      else drawBall(g, 400, 296, 5, 0);
      // rama bramki z bliska
      const post = g.createLinearGradient(0, 0, 60, 0);
      post.addColorStop(0, '#9aa5a0');
      post.addColorStop(0.5, '#ffffff');
      post.addColorStop(1, '#b8c2bd');
      g.fillStyle = post;
      g.fillRect(14, 30, 36, 530);
      g.fillRect(W - 50, 30, 36, 530);
      const bar = g.createLinearGradient(0, 30, 0, 66);
      bar.addColorStop(0, '#ffffff');
      bar.addColorStop(1, '#b8c2bd');
      g.fillStyle = bar;
      g.fillRect(14, 30, W - 28, 34);
      g.strokeStyle = 'rgba(255,255,255,.12)';
      g.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        g.beginPath();
        g.moveTo(14 + i * 4, 64);
        g.lineTo(0, 64 + i * 60);
        g.moveTo(W - 14 - i * 4, 64);
        g.lineTo(W, 64 + i * 60);
        g.stroke();
      }
      // rękawice: miejsce rzutu
      if (state.gloves) {
        const gl = state.gloves;
        let gx = gl.x;
        let gy = gl.y;
        let alpha = 0.9;
        if (a && a.kick.side === 'op') {
          const t = clamp((a.t - 0.5) / 0.3, 0, 1);
          const from = { x: 400, y: 470 };
          gx = lerp(from.x, gl.x, easeOut(t));
          gy = lerp(from.y, gl.y, easeOut(t));
          alpha = 1;
        } else {
          const p = 0.5 + Math.sin(now / 180) * 0.5;
          g.strokeStyle = `rgba(255,210,63,${0.35 + p * 0.4})`;
          g.lineWidth = 3;
          g.beginPath();
          g.arc(gl.x, gl.y, 54 + p * 8, 0, Math.PI * 2);
          g.stroke();
        }
        drawGlove(g, gx - 26, gy, 48, false, alpha);
        drawGlove(g, gx + 26, gy, 48, true, alpha);
      } else if (!state.busy && state.aim && onPick) {
        drawGlove(g, state.aim.x - 26, state.aim.y, 44, false, 0.45);
        drawGlove(g, state.aim.x + 26, state.aim.y, 44, true, 0.45);
      }
    }

    function drawIncomingBall(a) {
      const start = { x: 400, y: 292 };
      const end = map.save(a.kick.ball);
      const kickT = 0.46;
      if (a.t < kickT) return drawBall(g, 400, 296, 5, 0);
      const flight = clamp((a.t - kickT) / (a.hitT - kickT), 0, 1);
      let x;
      let y;
      let r;
      if (a.t <= a.hitT) {
        const e = flight * flight;
        x = lerp(start.x, end.x, e);
        y = lerp(start.y, end.y, e) - Math.sin(flight * Math.PI) * 40;
        r = lerp(5, 34, e);
      } else {
        const t = clamp((a.t - a.hitT) / (1 - a.hitT), 0, 1);
        if (a.result === 'save') {
          const dir = end.x < 400 ? -1 : 1;
          x = end.x + dir * 120 * t;
          y = end.y - 140 * t;
          r = lerp(34, 26, t);
        } else {
          x = end.x + (end.x - 400) * 0.6 * t;
          y = end.y + (end.y - 300) * 0.3 * t;
          r = lerp(34, 60, t);
        }
      }
      drawBall(g, x, y, r, a.t * 14);
    }

    // ---------- efekty ----------
    function burst(x, y, color) {
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 2 + Math.random() * 6;
        state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, life: 1, c: Math.random() < 0.5 ? color : '#ffffff', s: 2 + Math.random() * 4 });
      }
    }
    function drawFx(now) {
      for (const p of state.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18;
        p.life -= 0.016;
        g.globalAlpha = Math.max(0, p.life);
        g.fillStyle = p.c;
        g.fillRect(p.x, p.y, p.s, p.s * 0.6);
      }
      g.globalAlpha = 1;
      state.particles = state.particles.filter((p) => p.life > 0);
      if (state.text) {
        const t = (now - state.text.at) / 1400;
        if (t > 1) state.text = null;
        else {
          const sc = t < 0.15 ? lerp(0.4, 1.15, t / 0.15) : t < 0.25 ? lerp(1.15, 1, (t - 0.15) / 0.1) : 1;
          g.save();
          g.globalAlpha = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
          g.translate(W / 2, 150);
          g.scale(sc, sc);
          g.font = '700 84px "Chakra Petch", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.shadowColor = state.text.color;
          g.shadowBlur = 30;
          g.lineWidth = 8;
          g.strokeStyle = 'rgba(0,0,0,.75)';
          g.strokeText(state.text.label, 0, 0);
          g.fillStyle = state.text.color;
          g.fillText(state.text.label, 0, 0);
          g.restore();
        }
      }
    }

    function frame(now) {
      if (!canvas.isConnected) {
        ro.disconnect();
        return;
      }
      const a = state.anim;
      if (a) {
        a.t = clamp((now - a.start) / a.dur, 0, 1);
        if (!a.hitDone && a.t >= a.hitT) {
          a.hitDone = true;
          onHit(a);
        }
        if (a.t >= 1) {
          state.anim = null;
          a.done();
        }
      }
      g.save();
      if (state.shake > 0) {
        g.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
        state.shake *= 0.9;
        if (state.shake < 0.3) state.shake = 0;
      }
      if (state.view === 'shoot') drawShoot(now);
      else drawSave(now);
      drawFx(now);
      g.restore();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function onHit(a) {
      const mine = a.kick.side === 'my';
      const p = state.view === 'shoot' ? map.shoot(a.kick.ball) : map.save(a.kick.ball);
      const show = (label, color) => (state.text = { label, color, at: performance.now() });
      if (a.result === 'goal') {
        show('GOL!', mine ? '#b6f23a' : '#ff4d5e');
        burst(p.x, p.y, mine ? '#b6f23a' : '#ff4d5e');
      } else if (a.result === 'save') {
        show('OBRONA!', mine ? '#ff4d5e' : '#b6f23a');
        state.shake = 14;
        if (!mine) burst(p.x, p.y, '#ffd23f');
      } else {
        show('PUDŁO', mine ? '#ff9b3d' : '#b6f23a');
      }
    }

    return {
      // ustawia widok: 'shoot' (strzelasz) albo 'save' (bronisz) i czeka na kliknięcie
      wait(view, cb) {
        state.view = view;
        state.gloves = null;
        state.busy = false;
        onPick = cb;
      },
      // animacja wyniku strzału zwróconego przez serwer
      play(kick) {
        state.busy = true;
        return new Promise((resolve) => {
          const isShot = kick.side === 'my';
          state.anim = {
            kick,
            result: kick.result,
            start: performance.now(),
            dur: isShot ? 1500 : 2300,
            hitT: isShot ? 0.36 : 0.72,
            t: 0,
            done: resolve,
          };
        });
      },
      destroy() {
        cancelAnimationFrame(raf);
        ro.disconnect();
      },
    };
  }

  window.PenaltyScene = PenaltyScene;
})();
