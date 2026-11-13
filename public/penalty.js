// Pojedynek rzutów karnych: scena 3D (rzut perspektywiczny) na canvasie, z animowanymi postaciami.
// Wynik każdego strzału liczy serwer. Scena rysuje dokładnie to, co wyszło:
//   gol      = piłka w świetle bramki, bramkarz jej nie dosięga,
//   obrona   = rękawice bramkarza spotykają piłkę,
//   pudło    = piłka mija bramkę, słupek = trafia w obramowanie.
// Układ bramki: x od -1 (lewy słupek) do 1 (prawy), y od 0 (murawa) do 1 (poprzeczka).
(() => {
  const W = 800;
  const H = 560;
  const PI = Math.PI;
  const GW = 3.66; // pół szerokości bramki [m]
  const GH = 2.44; // wysokość bramki [m]
  const SPOT = 11; // punkt karny [m]
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const smooth = (t) => t * t * (3 - 2 * t);

  function seeded(n) {
    let a = n >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => clamp(Math.round(v + (k < 0 ? v * k : (255 - v) * k)), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  // ---------- kamera perspektywiczna ----------
  function camera(pos, target, f, cx, cy) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (a) => {
      const l = Math.hypot(a[0], a[1], a[2]);
      return [a[0] / l, a[1] / l, a[2] / l];
    };
    const fw = norm(sub(target, pos));
    const right = norm([-fw[2], 0, fw[0]]);
    const up = [right[1] * fw[2] - right[2] * fw[1], right[2] * fw[0] - right[0] * fw[2], right[0] * fw[1] - right[1] * fw[0]];
    return {
      f,
      forward: fw,
      // punkt świata [x, y, z] -> ekran; s = piksele na metr na tej głębokości
      p(x, y, z) {
        const d = sub([x, y, z], pos);
        const zc = Math.max(0.05, dot(d, fw));
        return { x: cx + (f * dot(d, right)) / zc, y: cy - (f * dot(d, up)) / zc, s: f / zc, z: zc };
      },
      // ekran -> punkt świata na płaszczyźnie z = zp
      toPlane(sx, sy, zp) {
        const a = (sx - cx) / f;
        const b = -(sy - cy) / f;
        const d = [fw[0] + right[0] * a + up[0] * b, fw[1] + right[1] * a + up[1] * b, fw[2] + right[2] * a + up[2] * b];
        const t = (zp - pos[2]) / d[2];
        return [pos[0] + d[0] * t, pos[1] + d[1] * t, zp];
      },
      // ekran -> punkt na płaszczyźnie bramki (z = 0)
      toGoal(sx, sy) {
        const a = (sx - cx) / f;
        const b = -(sy - cy) / f;
        const d = [fw[0] + right[0] * a + up[0] * b, fw[1] + right[1] * a + up[1] * b, fw[2] + right[2] * a + up[2] * b];
        const t = -pos[2] / d[2];
        return { x: (pos[0] + d[0] * t) / GW, y: (pos[1] + d[1] * t) / GH };
      },
    };
  }
  // widok strzału: kamera za piłką; widok obrony: kamera z bramki w stronę strzelca
  const CAM = {
    // wysoko i daleko za strzelcem: widać całe pole karne
    shoot: camera([0, 24, 60], [0, 0, 10], 2642, 400, 340),
    // widok bramkarza: cała bramka 7,32 x 2,44 m, linia bramkowa przy dolnej krawędzi (tam stoisz)
    save: camera([0, 3, -14], [0, 0.5, 11], 1438, 400, 387),
  };

  // ---------- stroje ----------
  const STYLE = {
    keeper: { shirt: '#ff7a1a', trim: '#1b1b1d', sleeve: '#ff7a1a', long: true, shorts: '#1b1b1d', socks: '#ff7a1a', boots: '#121212', sole: '#b6f23a',
      skin: '#e8b48c', hair: '#2b1a10', hairStyle: 'short', gloves: true, num: '1', numColor: '#1b1b1d' },
    shooterOp: { shirt: '#6f35d9', trim: '#ffffff', sleeve: '#6f35d9', shorts: '#24113f', socks: '#6f35d9', boots: '#f7f7f7', sole: '#6f35d9',
      skin: '#b97a55', hair: '#111111', hairStyle: 'buzz', num: '9', numColor: '#ffffff' },
    shooterMe: { shirt: '#b6f23a', trim: '#0f160f', sleeve: '#b6f23a', shorts: '#101410', socks: '#101410', boots: '#ff4d5e', sole: '#ffffff',
      skin: '#f0c4a2', hair: '#3a2416', hairStyle: 'spiky', num: '10', numColor: '#101410' },
  };

  // ---------- statyczne tło: trybuny, boisko w perspektywie, linie ----------
  function makeBackdrop(view) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const cam = CAM[view];
    const r = seeded(view === 'shoot' ? 7 : 11);
    const P = (x, y, z) => cam.p(x, y, z);
    // niebo
    const sky = g.createLinearGradient(0, 0, 0, H * 0.6);
    sky.addColorStop(0, '#02050a');
    sky.addColorStop(1, '#0a1a16');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const poly = (pts, fill) => {
      g.fillStyle = fill;
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fill();
    };
    if (view === 'shoot') drawStand(g, r, P(0, 0.8, -4).y);
    // trybuny (za polem karnym w widoku obrony)
    if (view === 'save') {
    const far = view === 'shoot' ? -1 : 1;
    const z0 = view === 'shoot' ? -6.5 : 62;
    for (let tier = 0; tier < 16; tier++) {
      const za = z0 + far * tier * 1.5;
      const zb = za + far * 1.5;
      const ya = 1.1 + tier * 1.05;
      const yb = ya + 1.05;
      const a = P(-60, ya, za), b = P(60, ya, za), d = P(-60, yb, zb), e = P(60, yb, zb);
      poly([a, b, e, d], tier % 2 ? '#0b1612' : '#0e1c16');
      // kibice: punkty w świecie na stopniu, rzutowane
      for (let k = 0; k < 700; k++) {
        const x = -60 + r() * 120;
        const q = P(x, ya + 0.5 + r() * 0.4, za + far * (0.5 + r() * 0.6));
        if (q.x < -5 || q.x > W + 5) continue;
        const hue = r();
        g.fillStyle = hue < 0.2 ? '#b6f23a' : hue < 0.33 ? '#6f35d9' : hue < 0.48 ? '#e7ecef' : hue < 0.56 ? '#ff7a1a' : hue < 0.7 ? '#c9a27e' : '#22362b';
        g.globalAlpha = 0.35 + r() * 0.5;
        const sz = Math.max(1, q.s * 0.09);
        g.beginPath();
        g.arc(q.x, q.y - sz, sz * 0.55, 0, PI * 2);
        g.fill();
        g.fillRect(q.x - sz * 0.5, q.y - sz * 0.5, sz, sz * 1.1);
      }
      g.globalAlpha = 1;
    }
    }
    // jupitery
    if (view === 'save') for (const fx of [70, W - 70]) {
      const glow = g.createRadialGradient(fx, 26, 0, fx, 26, 200);
      glow.addColorStop(0, 'rgba(225,255,235,.45)');
      glow.addColorStop(1, 'rgba(225,255,235,0)');
      g.fillStyle = glow;
      g.fillRect(fx - 200, 0, 400, 240);
      g.fillStyle = '#28322e';
      g.fillRect(fx - 32, 8, 64, 34);
      g.fillStyle = '#f6fff8';
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) g.fillRect(fx - 29 + i * 12, 11 + j * 10, 10, 8);
    }
    // murawa: pasy koszenia równoległe do linii bramkowej (co 5,5 m) i lekka szachownica
    const zMin = view === 'shoot' ? -4 : 1.2;
    // murawa pod spodem (dla obszaru blisko kamery)
    const near = P(0, 0, zMin);
    g.fillStyle = view === 'shoot' ? '#4eab27' : '#1f7832';
    g.fillRect(0, Math.min(H, near.y), W, H);
    const zMax = view === 'shoot' ? 32 : 62;
    const step = view === 'shoot' ? 3 : 2.75;
    const xs = view === 'shoot' ? 3.66 : 14;
    const bright = view === 'shoot';
    const GRASS = bright ? ['#5fbf32', '#56b42c', '#4eab27', '#47a123'] : ['#25883a', '#238437', '#1f7832', '#1d7430'];
    for (let z = Math.floor(zMin / step) * step; z < zMax; z += step) {
      const z1 = Math.max(z, zMin);
      const z2 = Math.min(z + step, zMax);
      for (let x = -44; x < 44; x += xs) {
        const a = P(x, 0, z1), b = P(x + xs, 0, z1), d = P(x + xs, 0, z2), e = P(x, 0, z2);
        if (a.z < 1 || d.z < 1) continue;
        const stripe = Math.round(z / step) % 2 === 0;
        const check = Math.round(x / xs) % 2 === 0;
        poly([a, b, d, e], GRASS[(stripe ? 0 : 2) + (check ? 0 : 1)]);
      }
    }
    // faktura trawy
    for (let k = 0; k < 3500; k++) {
      const q = P(-30 + r() * 60, 0, zMin + r() * (zMax - zMin));
      if (q.y < 0 || q.y > H) continue;
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.06)';
      g.fillRect(q.x, q.y, Math.max(1, q.s * 0.05), 1);
    }
    // linie boiska (biała kreda, szerokość 12 cm)
    // linia dzielona na odcinki po 0,5 m; odcinki za kamerą są pomijane
    const line = (pts) => {
      g.strokeStyle = 'rgba(255,255,255,.88)';
      g.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1, z1] = pts[i - 1];
        const [x2, y2, z2] = pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.5));
        for (let k = 0; k < n; k++) {
          const a = P(lerp(x1, x2, k / n), lerp(y1, y2, k / n), lerp(z1, z2, k / n));
          const b = P(lerp(x1, x2, (k + 1) / n), lerp(y1, y2, (k + 1) / n), lerp(z1, z2, (k + 1) / n));
          if (a.z < 1 || b.z < 1) continue;
          g.lineWidth = Math.max(1, ((a.s + b.s) / 2) * 0.12);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
      }
    };
    line([[-34, 0, 0], [34, 0, 0]]); // linia bramkowa
    line([[-9.16, 0, 0], [-9.16, 0, 5.5], [9.16, 0, 5.5], [9.16, 0, 0]]); // pole bramkowe
    line([[-20.16, 0, 0], [-20.16, 0, 16.5], [20.16, 0, 16.5], [20.16, 0, 0]]); // pole karne
    const arc = [];
    for (let a = -0.93; a <= 0.93; a += 0.05) arc.push([Math.sin(a) * 9.15, 0, SPOT + Math.cos(a) * 9.15]);
    line(arc.filter((p) => p[2] >= 16.5)); // łuk pola karnego
    const spot = P(0, 0, SPOT);
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(spot.x, spot.y, spot.s * 0.12, spot.s * 0.05, 0, 0, PI * 2);
    g.fill();
    // bandy reklamowe za bramką / za polem karnym
    const bz = view === 'shoot' ? -4 : 60;
    const ba = P(-40, 0, bz), bb = P(40, 0, bz), bc = P(40, 0.8, bz), bd = P(-40, 0.8, bz);
    const adg = g.createLinearGradient(0, bd.y, 0, ba.y);
    adg.addColorStop(0, '#17532a');
    adg.addColorStop(1, '#0b2614');
    poly([ba, bb, bc, bd], adg);
    g.font = `700 ${Math.round(ba.s * 0.32)}px "Chakra Petch", sans-serif`;
    g.fillStyle = 'rgba(182,242,58,.8)';
    g.textBaseline = 'middle';
    for (let x = -38; x < 40; x += 7) {
      const q = P(x, 0.4, bz);
      g.fillText('FOOTBALL STARS', q.x, q.y);
    }
    // winieta i delikatna mgiełka światła
    const vig = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,.5)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
    return c;
  }

  // Trybuna z kibicami (widok strzału): rzędy postaci, część z rękami w górze, szaliki.
  function drawStand(g, r, bottom) {
    const bg = g.createLinearGradient(0, 0, 0, bottom);
    bg.addColorStop(0, '#0a1622');
    bg.addColorStop(1, '#16304a');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, bottom);
    const COLORS = ['#b6f23a', '#2f6fd6', '#e9eef2', '#6f35d9', '#ff7a1a', '#1d3d63', '#2a5582'];
    const SKIN = ['#f0c4a2', '#c98d66', '#8d5a3c', '#e8b48c'];
    const rows = Math.ceil(bottom / 11) + 1;
    for (let row = 0; row < rows; row++) {
      const y = 6 + row * 11;
      const sz = 4 + row * 0.25;
      for (let x = (row % 2) * 6; x < W + 10; x += 11 + r() * 3) {
        const c = COLORS[Math.floor(r() * COLORS.length)];
        g.globalAlpha = 0.55 + (row / rows) * 0.45;
        g.fillStyle = c;
        g.beginPath();
        g.roundRect(x - sz * 0.7, y, sz * 1.4, sz * 1.6, sz * 0.4);
        g.fill();
        if (r() < 0.3) {
          g.strokeStyle = c;
          g.lineWidth = sz * 0.35;
          g.beginPath();
          g.moveTo(x - sz * 0.5, y + sz * 0.2);
          g.lineTo(x - sz * 0.9, y - sz * 1.2);
          g.moveTo(x + sz * 0.5, y + sz * 0.2);
          g.lineTo(x + sz * 0.9, y - sz * 1.2);
          g.stroke();
        }
        g.fillStyle = SKIN[Math.floor(r() * SKIN.length)];
        g.beginPath();
        g.arc(x, y - sz * 0.35, sz * 0.55, 0, PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    // szaliki i flaga
    for (let i = 0; i < 6; i++) {
      const x = 40 + r() * (W - 80);
      const y = 10 + r() * (bottom - 30);
      g.fillStyle = r() < 0.5 ? '#b6f23a' : '#2f6fd6';
      g.save();
      g.translate(x, y);
      g.rotate((r() - 0.5) * 0.4);
      g.fillRect(-22, -3, 44, 6);
      g.fillStyle = '#ffffff';
      for (let k = -18; k < 22; k += 8) g.fillRect(k, -3, 3, 6);
      g.restore();
    }
    const sh = g.createLinearGradient(0, bottom - 18, 0, bottom);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = sh;
    g.fillRect(0, bottom - 18, W, 18);
  }

  // ---------- postać szkieletowa ----------
  const PR = { torso: 0.3, shoulder: 0.215, hip: 0.13, uArm: 0.17, fArm: 0.155, thigh: 0.25, shin: 0.235, head: 0.068 };
  const dir = (a) => [Math.sin(a), Math.cos(a)];

  function capsule(g, x1, y1, x2, y2, w1, w2, fill, stroke) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const nx = Math.cos(a + PI / 2);
    const ny = Math.sin(a + PI / 2);
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x1 + nx * w1, y1 + ny * w1);
    g.lineTo(x2 + nx * w2, y2 + ny * w2);
    g.arc(x2, y2, w2, a + PI / 2, a - PI / 2, true);
    g.lineTo(x1 - nx * w1, y1 - ny * w1);
    g.arc(x1, y1, w1, a - PI / 2, a + PI / 2, true);
    g.fill();
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = Math.max(0.6, w2 * 0.18);
      g.stroke();
    }
  }

  // Postać rysowana jak sprite z gry: najpierw cała sylwetka w ciemnym kolorze (jeden wspólny obrys),
  // potem kolory, cieniowanie i detale. Dzięki temu nie widać łączeń części ciała.
  // pose: { x, y (miednica), h (wzrost w px), rot, lean, head, aL1..aR2, lL1..lR2, foreL, foreR, back, smile }
  const OUT = '#121812';
  function drawRig(g, pose, st) {
    const h = pose.h;
    const w = h * 0.044;
    const ow = Math.max(1, h * 0.012); // grubość obrysu
    g.save();
    g.translate(pose.x, pose.y);
    g.rotate(pose.rot || 0);
    const lean = pose.lean || 0;
    const sc = [Math.sin(lean) * PR.torso * h, -Math.cos(lean) * PR.torso * h];
    const px = Math.cos(lean);
    const py = Math.sin(lean);
    const shL = [sc[0] - (px * PR.shoulder * h) / 2, sc[1] - (py * PR.shoulder * h) / 2 + w * 0.5];
    const shR = [sc[0] + (px * PR.shoulder * h) / 2, sc[1] + (py * PR.shoulder * h) / 2 + w * 0.5];
    const hipL = [-(PR.hip * h) / 2, 0];
    const hipR = [(PR.hip * h) / 2, 0];
    const limb = (start, a1, a2, l1, l2, fore = 0) => {
      const [d1x, d1y] = dir(a1);
      const k = [start[0] + d1x * l1 * h * (1 - fore * 0.55), start[1] + d1y * l1 * h * (1 - fore * 0.55)];
      const [d2x, d2y] = dir(a1 + a2);
      return [k, [k[0] + d2x * l2 * h * (1 - fore * 0.3), k[1] + d2y * l2 * h * (1 - fore * 0.3)]];
    };
    const [kneeL, footL] = limb(hipL, pose.lL1, pose.lL2, PR.thigh, PR.shin, pose.foreL || 0);
    const [kneeR, footR] = limb(hipR, pose.lR1, pose.lR2, PR.thigh, PR.shin, pose.foreR || 0);
    const [elbL, handL] = limb(shL, pose.aL1, pose.aL2, PR.uArm, PR.fArm);
    const [elbR, handR] = limb(shR, pose.aR1, pose.aR2, PR.uArm, PR.fArm);
    const hr = PR.head * h;
    const ha = lean + (pose.head || 0);
    const neck = [sc[0] + Math.sin(ha) * hr * 0.55, sc[1] - Math.cos(ha) * hr * 0.55];
    const hc = [sc[0] + Math.sin(ha) * hr * 1.45, sc[1] - Math.cos(ha) * hr * 1.45];
    drawBody(g, { sc, shL, shR, hipL, hipR, kneeL, footL, kneeR, footR, elbL, handL, elbR, handR, neck, hc }, st, { h, lean, ha, back: pose.back, smile: pose.smile });
    g.restore();
  }

  // Rysuje ciało z gotowych punktów stawów (współrzędne względem miednicy w bieżącej transformacji).
  function drawBody(g, J, st, o) {
    const { sc, shL, shR, hipL, hipR, kneeL, footL, kneeR, footR, elbL, handL, elbR, handR, neck, hc } = J;
    const h = o.h;
    const w = h * 0.044;
    const ow = Math.max(1, h * 0.012);
    const lean = o.lean || 0;
    const ha = o.ha || 0;
    const hr = PR.head * h;
    const pose = { back: o.back, smile: o.smile };

    // Kończyna jako gładki kształt: pogrubienie przy mięśniu (udo, łydka, biceps).
    const taper = (a, b, w1, wm, w2, bulge = 0.4) => {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const nx = Math.cos(ang + PI / 2);
      const ny = Math.sin(ang + PI / 2);
      const m = [lerp(a[0], b[0], bulge), lerp(a[1], b[1], bulge)];
      g.beginPath();
      g.moveTo(a[0] + nx * w1, a[1] + ny * w1);
      g.quadraticCurveTo(m[0] + nx * wm * 1.15, m[1] + ny * wm * 1.15, b[0] + nx * w2, b[1] + ny * w2);
      g.arc(b[0], b[1], w2, ang + PI / 2, ang - PI / 2, true);
      g.quadraticCurveTo(m[0] - nx * wm * 1.15, m[1] - ny * wm * 1.15, a[0] - nx * w1, a[1] - ny * w1);
      g.arc(a[0], a[1], w1, ang - PI / 2, ang + PI / 2, true);
      g.closePath();
    };
    let outline = true;
    // Wypełnia bieżącą ścieżkę: w przebiegu obrysu na ciemno z grubą krawędzią, w przebiegu koloru gradientem.
    const paint = (fill) => {
      if (outline) {
        g.fillStyle = OUT;
        g.strokeStyle = OUT;
        g.lineWidth = ow * 2;
        g.lineJoin = 'round';
        g.fill();
        g.stroke();
      } else {
        g.fillStyle = fill;
        g.fill();
      }
    };
    // światło z lewej góry: gradient w poprzek kończyny
    const lit = (a, b, base, wd) => {
      if (outline) return base;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + PI / 2;
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const gr = g.createLinearGradient(m[0] - Math.cos(ang) * wd, m[1] - Math.sin(ang) * wd, m[0] + Math.cos(ang) * wd, m[1] + Math.sin(ang) * wd);
      gr.addColorStop(0, shade(base, -0.22));
      gr.addColorStop(0.45, shade(base, 0.12));
      gr.addColorStop(1, shade(base, -0.3));
      return gr;
    };
    const sockTopL = [lerp(kneeL[0], footL[0], 0.18), lerp(kneeL[1], footL[1], 0.18)];
    const sockTopR = [lerp(kneeR[0], footR[0], 0.18), lerp(kneeR[1], footR[1], 0.18)];

    const legs = (hip, knee, sockTop, foot, side) => {
      taper(hip, knee, w * 1.35, w * 1.45, w * 0.95, 0.35); // udo
      paint(lit(hip, knee, st.skin, w * 1.4));
      taper(knee, foot, w * 0.95, w * 1.15, w * 0.62, 0.3); // łydka
      paint(lit(knee, foot, st.skin, w * 1.1));
      if (!outline) {
        taper(sockTop, foot, w * 1.02, w * 1.18, w * 0.66, 0.25); // getra z ochraniaczem
        g.fillStyle = lit(sockTop, foot, st.socks, w * 1.1);
        g.fill();
        g.strokeStyle = shade(st.socks, 0.4);
        g.lineWidth = w * 0.32;
        g.beginPath();
        g.moveTo(sockTop[0] - w, sockTop[1]);
        g.lineTo(sockTop[0] + w, sockTop[1]);
        g.stroke();
      }
      // but z noskiem i podeszwą
      const toe = side * (pose.back ? -0.25 : 0.25);
      g.save();
      g.translate(foot[0], foot[1] + w * 0.2);
      g.rotate(toe);
      g.beginPath();
      g.moveTo(-w * 1.0, -w * 0.55);
      g.quadraticCurveTo(side * w * 1.9, -w * 0.75, side * w * 1.85, w * 0.15);
      g.quadraticCurveTo(side * w * 1.7, w * 0.62, 0, w * 0.62);
      g.quadraticCurveTo(-w * 1.2, w * 0.6, -w * 1.0, -w * 0.55);
      paint(st.boots);
      if (!outline) {
        g.fillStyle = st.sole;
        g.fillRect(side > 0 ? -w * 1.0 : -w * 1.8, w * 0.38, w * 2.8, w * 0.22);
        g.strokeStyle = 'rgba(255,255,255,.35)';
        g.lineWidth = w * 0.15;
        g.beginPath();
        g.moveTo(-w * 0.6, -w * 0.35);
        g.quadraticCurveTo(side * w * 0.6, -w * 0.5, side * w * 1.4, -w * 0.2);
        g.stroke();
      }
      g.restore();
    };

    const arms = (sh, elb, hand) => {
      taper(sh, elb, w * 1.15, w * 1.2, w * 0.9, 0.4);
      paint(lit(sh, elb, st.long ? st.sleeve : st.skin, w * 1.2));
      taper(elb, hand, w * 0.9, w * 0.95, w * 0.62, 0.35);
      paint(lit(elb, hand, st.long ? st.sleeve : st.skin, w));
      if (!outline && !st.long) {
        // krótki rękaw
        const cuff = [lerp(sh[0], elb[0], 0.6), lerp(sh[1], elb[1], 0.6)];
        taper(sh, cuff, w * 1.32, w * 1.35, w * 1.22, 0.5);
        g.fillStyle = lit(sh, cuff, st.sleeve, w * 1.3);
        g.fill();
        g.strokeStyle = st.trim;
        g.lineWidth = w * 0.28;
        const a = Math.atan2(elb[1] - sh[1], elb[0] - sh[0]) + PI / 2;
        g.beginPath();
        g.moveTo(cuff[0] - Math.cos(a) * w * 1.2, cuff[1] - Math.sin(a) * w * 1.2);
        g.lineTo(cuff[0] + Math.cos(a) * w * 1.2, cuff[1] + Math.sin(a) * w * 1.2);
        g.stroke();
      }
      // dłoń albo rękawica bramkarska
      const a = Math.atan2(hand[1] - elb[1], hand[0] - elb[0]);
      g.save();
      g.translate(hand[0], hand[1]);
      g.rotate(a - PI / 2);
      g.beginPath();
      if (st.gloves) g.roundRect(-w * 1.15, -w * 0.4, w * 2.3, w * 2.5, w * 0.95);
      else g.ellipse(0, w * 0.4, w * 0.72, w * 0.9, 0, 0, PI * 2);
      paint(st.gloves ? '#f5f7f3' : st.skin);
      if (!outline && st.gloves) {
        g.fillStyle = '#b6f23a';
        g.fillRect(-w * 1.1, -w * 0.25, w * 2.2, w * 0.4);
        g.fillStyle = 'rgba(0,0,0,.12)';
        for (let i = -1; i <= 1; i++) g.fillRect(i * w * 0.55 - w * 0.06, w * 0.9, w * 0.12, w * 1.2);
      }
      g.restore();
    };

    const torso = () => {
      // tułów prawie prostokątny: barki, klatka, lekko węższa talia, biodra.
      // Punkty sortowane po stronie ekranu (postać przodem ma prawe ramię po lewej stronie ekranu).
      const [sa, sb] = shL[0] <= shR[0] ? [shL, shR] : [shR, shL];
      const halfSh = (sb[0] - sa[0]) / 2;
      const midX = (sa[0] + sb[0]) / 2 - sc[0];
      const hipHalf = Math.max(Math.abs(hipR[0] - hipL[0]) / 2 + w * 1.6, halfSh * 0.9);
      const waistHalf = Math.max(hipHalf * 0.94, halfSh * 0.84);
      const wy = lerp(sa[1], 0, 0.62);
      const hx = midX * 0.3;
      g.beginPath();
      g.moveTo(sa[0] - w * 0.85, sa[1] - w * 0.05);
      g.quadraticCurveTo(sc[0], sc[1] - w * 1.5, sb[0] + w * 0.85, sb[1] - w * 0.05);
      g.quadraticCurveTo(sb[0] + w * 0.95, lerp(sb[1], wy, 0.5), hx + waistHalf, wy);
      g.quadraticCurveTo(hx + hipHalf, lerp(wy, 0, 0.6), hx + hipHalf, w * 0.25);
      g.lineTo(hx - hipHalf, w * 0.25);
      g.quadraticCurveTo(hx - hipHalf, lerp(wy, 0, 0.6), hx - waistHalf, wy);
      g.quadraticCurveTo(sa[0] - w * 0.95, lerp(sa[1], wy, 0.5), sa[0] - w * 0.85, sa[1] - w * 0.05);
      g.closePath();
      if (outline) return paint();
      const tg = g.createLinearGradient(shL[0] - w * 2, sc[1], shR[0] + w * 2, 0);
      tg.addColorStop(0, shade(st.shirt, 0.2));
      tg.addColorStop(0.5, st.shirt);
      tg.addColorStop(1, shade(st.shirt, -0.35));
      paint(tg);
      // fałdy materiału
      g.strokeStyle = 'rgba(0,0,0,.12)';
      g.lineWidth = w * 0.18;
      g.beginPath();
      g.moveTo(lerp(shL[0], 0, 0.4), lerp(shL[1], 0, 0.55));
      g.quadraticCurveTo(0, lerp(sc[1], 0, 0.7), lerp(shR[0], 0, 0.3), lerp(shR[1], 0, 0.85));
      g.stroke();
    };

    // spodenki: pas w talii i dwie nogawki wzdłuż ud (podążają za nogami, bez rozciągania w kroku)
    const shorts = () => {
      const legEnd = (hip, knee) => [lerp(hip[0], knee[0], 0.4), lerp(hip[1], knee[1], 0.4)];
      const eL = legEnd(hipL, kneeL);
      const eR = legEnd(hipR, kneeR);
      const [ha0, hb0] = hipL[0] <= hipR[0] ? [hipL, hipR] : [hipR, hipL];
      const waist = () => {
        g.beginPath();
        g.moveTo(ha0[0] - w * 1.7, -w * 1.3);
        g.lineTo(hb0[0] + w * 1.7, -w * 1.3);
        g.quadraticCurveTo(hb0[0] + w * 1.85, w * 0.4, hb0[0] + w * 0.9, w * 1.0);
        g.lineTo(ha0[0] - w * 0.9, w * 1.0);
        g.quadraticCurveTo(ha0[0] - w * 1.85, w * 0.4, ha0[0] - w * 1.7, -w * 1.3);
        g.closePath();
      };
      if (outline) {
        waist();
        paint();
        taper(hipL, eL, w * 1.6, w * 1.62, w * 1.45, 0.5);
        paint();
        taper(hipR, eR, w * 1.6, w * 1.62, w * 1.45, 0.5);
        paint();
        return;
      }
      const sg = g.createLinearGradient(-w * 3, 0, w * 3, 0);
      sg.addColorStop(0, shade(st.shorts, 0.12));
      sg.addColorStop(1, shade(st.shorts, -0.3));
      taper(hipL, eL, w * 1.6, w * 1.62, w * 1.45, 0.5);
      paint(lit(hipL, eL, st.shorts, w * 1.6));
      taper(hipR, eR, w * 1.6, w * 1.62, w * 1.45, 0.5);
      paint(lit(hipR, eR, st.shorts, w * 1.6));
      waist();
      paint(sg);
      // lampasy po bokach nogawek
      g.strokeStyle = st.trim;
      g.lineWidth = w * 0.3;
      g.lineCap = "round";
      for (const [hp, e, sd] of [[hipL, eL, -1], [hipR, eR, 1]]) {
        const ang = Math.atan2(e[1] - hp[1], e[0] - hp[0]) + PI / 2;
        const ox = Math.cos(ang) * w * 1.35 * sd;
        const oy = Math.sin(ang) * w * 1.35 * sd;
        g.beginPath();
        g.moveTo(hp[0] + ox, hp[1] + oy - w * 0.8);
        g.lineTo(e[0] + ox, e[1] + oy);
        g.stroke();
      }
    };

    const head = () => {
      // szyja
      taper(sc, neck, w * 0.85, w * 0.85, w * 0.8, 0.5);
      paint(shade(st.skin, -0.08));
      g.save();
      g.translate(hc[0], hc[1]);
      g.rotate(ha);
      // czaszka, żuchwa, uszy
      g.beginPath();
      g.moveTo(-hr * 0.9, -hr * 0.1);
      g.quadraticCurveTo(-hr * 0.95, -hr * 1.05, 0, -hr * 1.05);
      g.quadraticCurveTo(hr * 0.95, -hr * 1.05, hr * 0.9, -hr * 0.1);
      g.quadraticCurveTo(hr * 0.85, hr * 0.75, 0, hr * 1.02);
      g.quadraticCurveTo(-hr * 0.85, hr * 0.75, -hr * 0.9, -hr * 0.1);
      g.closePath();
      if (outline) paint();
      else {
        const hg = g.createRadialGradient(-hr * 0.35, -hr * 0.4, hr * 0.1, 0, 0, hr * 1.15);
        hg.addColorStop(0, shade(st.skin, 0.14));
        hg.addColorStop(1, shade(st.skin, -0.22));
        paint(hg);
      }
      g.beginPath();
      g.ellipse(-hr * 0.9, hr * 0.08, hr * 0.17, hr * 0.27, 0, 0, PI * 2);
      g.ellipse(hr * 0.9, hr * 0.08, hr * 0.17, hr * 0.27, 0, 0, PI * 2);
      paint(shade(st.skin, -0.12));
      // włosy z objętością
      g.beginPath();
      if (pose.back) {
        g.moveTo(-hr * 0.95, hr * 0.35);
        g.quadraticCurveTo(-hr * 1.05, -hr * 1.2, 0, -hr * 1.18);
        g.quadraticCurveTo(hr * 1.05, -hr * 1.2, hr * 0.95, hr * 0.35);
        g.quadraticCurveTo(0, hr * 0.62, -hr * 0.95, hr * 0.35);
      } else if (st.hairStyle === 'buzz') {
        g.moveTo(-hr * 0.92, -hr * 0.15);
        g.quadraticCurveTo(-hr * 0.95, -hr * 1.12, 0, -hr * 1.12);
        g.quadraticCurveTo(hr * 0.95, -hr * 1.12, hr * 0.92, -hr * 0.15);
        g.quadraticCurveTo(hr * 0.5, -hr * 0.62, 0, -hr * 0.6);
        g.quadraticCurveTo(-hr * 0.5, -hr * 0.62, -hr * 0.92, -hr * 0.15);
      } else {
        const spiky = st.hairStyle === 'spiky';
        g.moveTo(-hr * 0.98, hr * 0.0);
        for (let i = 0; i <= 10; i++) {
          const a = PI * 1.02 + (i / 10) * PI * 0.96;
          const rr = hr * (spiky && i % 2 ? 1.32 : 1.08);
          g.lineTo(Math.cos(a) * rr, -hr * 0.12 + Math.sin(a) * rr);
        }
        g.lineTo(hr * 0.98, hr * 0.0);
        g.quadraticCurveTo(hr * 0.55, -hr * 0.5, 0, -hr * 0.42);
        g.quadraticCurveTo(-hr * 0.55, -hr * 0.5, -hr * 0.98, hr * 0.0);
      }
      g.closePath();
      paint(st.hair);
      if (!outline) {
        g.strokeStyle = 'rgba(255,255,255,.22)';
        g.lineWidth = hr * 0.1;
        g.beginPath();
        g.arc(-hr * 0.2, -hr * 0.55, hr * 0.45, PI * 1.15, PI * 1.6);
        g.stroke();
        if (!pose.back) {
          // twarz
          for (const ex of [-hr * 0.36, hr * 0.36]) {
            g.fillStyle = '#ffffff';
            g.beginPath();
            g.ellipse(ex, hr * 0.12, hr * 0.17, hr * 0.12, 0, 0, PI * 2);
            g.fill();
            g.fillStyle = '#2b1f17';
            g.beginPath();
            g.arc(ex + hr * 0.03, hr * 0.13, hr * 0.085, 0, PI * 2);
            g.fill();
            g.strokeStyle = shade(st.hair, 0.05);
            g.lineWidth = hr * 0.1;
            g.lineCap = 'round';
            g.beginPath();
            g.moveTo(ex - hr * 0.2, -hr * 0.12);
            g.lineTo(ex + hr * 0.18, -hr * 0.17);
            g.stroke();
          }
          g.strokeStyle = shade(st.skin, -0.3);
          g.lineWidth = hr * 0.07;
          g.beginPath();
          g.moveTo(0, hr * 0.18);
          g.lineTo(-hr * 0.07, hr * 0.44);
          g.lineTo(hr * 0.05, hr * 0.46);
          g.stroke();
          g.strokeStyle = shade(st.skin, -0.5);
          g.lineWidth = hr * 0.08;
          g.beginPath();
          g.moveTo(-hr * 0.24, hr * 0.66);
          g.quadraticCurveTo(0, pose.smile ? hr * 0.86 : hr * 0.7, hr * 0.24, hr * 0.66);
          g.stroke();
        }
      }
      g.restore();
    };

    // kolejność: dalsza ręka i noga za tułowiem
    // kolejność według głębi: ręka za ciałem przed tułowiem, noga wysunięta do kamery po spodenkach
    const ord = o.order || {};
    const drawAll = () => {
      if (!ord.legFrontL) legs(hipL, kneeL, sockTopL, footL, -1);
      if (!ord.legFrontR) legs(hipR, kneeR, sockTopR, footR, 1);
      if (ord.armBackL) arms(shL, elbL, handL);
      if (ord.armBackR) arms(shR, elbR, handR);
      shorts();
      if (ord.legFrontL) legs(hipL, kneeL, sockTopL, footL, -1);
      if (ord.legFrontR) legs(hipR, kneeR, sockTopR, footR, 1);
      torso();
      if (!ord.armBackL) arms(shL, elbL, handL);
      if (!ord.armBackR) arms(shR, elbR, handR);
      head();
    };
    outline = true;
    drawAll();
    outline = false;
    drawAll();

    // detale koszulki: kołnierz i numer
    if (pose.back) {
      g.save();
      g.translate(lerp(sc[0], 0, 0.45), lerp(sc[1], 0, 0.45));
      g.rotate(lean);
      g.font = `800 ${Math.round(h * 0.12)}px "Chakra Petch", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = Math.max(1, h * 0.012);
      g.strokeStyle = shade(st.shirt, -0.45);
      g.strokeText(st.num, 0, 0);
      g.fillStyle = st.numColor;
      g.fillText(st.num, 0, 0);
      g.restore();
      g.fillStyle = st.trim;
      g.beginPath();
      g.ellipse(sc[0], sc[1] - w * 0.5, w * 1.25, w * 0.45, lean, 0, PI * 2);
      g.fill();
    } else {
      g.fillStyle = st.trim;
      g.beginPath();
      g.moveTo(sc[0] - w * 0.8, sc[1] - w * 0.75);
      g.lineTo(sc[0], sc[1] + w * 0.45);
      g.lineTo(sc[0] + w * 0.8, sc[1] - w * 0.75);
      g.lineTo(sc[0] + w * 0.5, sc[1] - w * 0.75);
      g.lineTo(sc[0], sc[1] - w * 0.05);
      g.lineTo(sc[0] - w * 0.5, sc[1] - w * 0.75);
      g.closePath();
      g.fill();
      g.save();
      g.translate(lerp(sc[0], 0, 0.42) + w * 1.25, lerp(sc[1], 0, 0.42) - w * 0.7);
      g.rotate(lean);
      g.fillStyle = st.numColor;
      g.font = `800 ${Math.round(h * 0.065)}px "Chakra Petch", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(st.num, 0, 0);
      g.restore();
    }
  }

  function groundShadow(g, x, y, rx, a = 0.32) {
    const sg = g.createRadialGradient(x, y, 0, x, y, rx);
    sg.addColorStop(0, `rgba(0,0,0,${a})`);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg;
    g.beginPath();
    g.ellipse(x, y, rx, rx * 0.25, 0, 0, PI * 2);
    g.fill();
  }

  // ---------- pozy bramkarza ----------
  function keeperIdle(t, x, groundY, h, hop = 0) {
    const bob = Math.abs(Math.sin(t * 5)) * h * 0.012;
    const sway = Math.sin(t * 1.3) * h * 0.05;
    const crouch = h * 0.03 + hop * h * 0.05;
    return {
      x: x + sway, y: groundY - h * 0.47 + crouch + bob - Math.sin(hop * PI) * h * 0.06, h, rot: 0, lean: Math.sin(t * 1.3) * 0.03,
      lL1: -0.34 - hop * 0.08, lL2: 0.3 + hop * 0.15, lR1: 0.34 + hop * 0.08, lR2: -0.3 - hop * 0.15,
      aL1: -0.95 - Math.sin(t * 5) * 0.05, aL2: -0.55, aR1: 0.95 + Math.sin(t * 5) * 0.05, aR2: 0.55,
    };
  }
  // Rzut do punktu ekranu: przysiad, wybicie z bliższej nogi, lot całym ciałem, lądowanie na boku.
  function keeperDive(t, x0, groundY, h, target) {
    const base = keeperIdle(0, x0, groundY, h);
    const dx = target.x - x0;
    const heightAbove = groundY - target.y;
    const side = Math.sign(dx) || 1;
    const centre = Math.abs(dx) < h * 0.32;
    const load = smooth(seg(t, 0, 0.14));
    const fly = easeOut(seg(t, 0.12, 0.55));
    const fall = easeIn(seg(t, 0.55, 0.85));
    const settle = smooth(seg(t, 0.85, 1));
    if (centre) {
      const low = heightAbove < h * 0.6;
      if (low) {
        // przysiad i chwyt nisko przed sobą
        return {
          ...base, x: lerp(x0, target.x, fly), y: base.y + h * 0.16 * fly,
          lL1: lerp(-0.34, -0.9, fly), lL2: lerp(0.3, 1.9, fly), lR1: lerp(0.34, 0.9, fly), lR2: lerp(-0.3, -1.9, fly),
          aL1: lerp(-0.95, -0.25, fly), aL2: lerp(-0.55, 0.15, fly), aR1: lerp(0.95, 0.25, fly), aR2: lerp(0.55, -0.15, fly), lean: 0.1 * fly,
        };
      }
      const up = Math.sin(seg(t, 0.12, 0.85) * PI);
      const reach = (heightAbove - h * 0.95) * up;
      return {
        ...base, x: lerp(x0, target.x, fly), y: base.y + load * h * 0.06 - Math.max(0, reach),
        lL1: lerp(-0.34, -0.1, fly), lL2: lerp(0.3, 0.25, fly), lR1: lerp(0.34, 0.1, fly), lR2: lerp(-0.3, -0.25, fly),
        aL1: lerp(-0.95, -2.95, fly), aL2: lerp(-0.55, 0.05, fly), aR1: lerp(0.95, 2.95, fly), aR2: lerp(0.55, -0.05, fly),
      };
    }
    const high = clamp(heightAbove / (h * 1.15), 0, 1);
    const rot = side * lerp(1.42, 0.8, high) * fly + side * fall * (1.48 - lerp(1.42, 0.8, high)) * (1 - high * 0.5);
    const reach = (PR.torso + PR.uArm + PR.fArm) * h * 0.95;
    const ex = target.x - Math.sin(rot) * reach;
    const ey = target.y + Math.cos(rot) * reach;
    const landY = groundY - h * 0.1;
    let x = lerp(x0, ex, fly) + side * settle * h * 0.04;
    let y = lerp(base.y + load * h * 0.07, ey, fly) - Math.sin(fly * PI) * h * 0.08;
    y = lerp(y, Math.max(y, landY), fall) - Math.sin(settle * PI) * h * 0.03;
    const near = side > 0 ? 'R' : 'L';
    const pose = {
      x, y, h, rot, lean: -side * 0.08 * fly,
      aL1: lerp(-0.95, -PI + 0.22, fly), aL2: lerp(-0.55, 0.06, fly),
      aR1: lerp(0.95, PI - 0.22, fly), aR2: lerp(0.55, -0.06, fly),
      lL1: -0.34, lL2: 0.3, lR1: 0.34, lR2: -0.3,
    };
    // noga wybijająca prostuje się, druga podkurcza i ciągnie za ciałem
    const push = Math.sin(seg(t, 0.08, 0.4) * PI);
    if (near === 'R') {
      pose.lR1 = lerp(0.34, 0.12, fly) + push * 0.2;
      pose.lR2 = lerp(-0.3, -0.08, fly);
      pose.lL1 = lerp(-0.34, -0.55, fly);
      pose.lL2 = lerp(0.3, 0.9, fly);
    } else {
      pose.lL1 = lerp(-0.34, -0.12, fly) - push * 0.2;
      pose.lL2 = lerp(0.3, 0.08, fly);
      pose.lR1 = lerp(0.34, 0.55, fly);
      pose.lR2 = lerp(-0.3, -0.9, fly);
    }
    return pose;
  }

  // ---------- pozy strzelca ----------
  // ---------- strzelec w 3D: szkielet z kątami stawów, rzutowany przez kamerę ----------
  // Wymiary ciała w metrach (wzrost ok. 1,80 m).
  const B = { pelvis: 0.95, thigh: 0.45, shin: 0.44, torso: 0.52, shoulder: 0.2, hip: 0.11, uArm: 0.3, fArm: 0.28, neck: 0.1, head: 0.12 };
  const CONTACT = 0.6; // moment kontaktu z piłką w czasie animacji strzelca (0..1)
  const START = [-2.3, 14.3]; // start rozbiegu (x, z) – z lewej, za piłką
  const PELVIS_KICK = [-0.24, 11.32]; // miednica w chwili strzału (noga postawna obok piłki)

  // Poza strzelca w czasie t (0..1). Zwraca pozycję miednicy, kierunek i kąty stawów.
  function shooterPose(t) {
    const runEnd = CONTACT - 0.1;
    const run = seg(t, 0, runEnd);
    // rozbieg: przyspieszenie, równe tempo, wyhamowanie przed ostatnim krokiem
    const dist = run < 0.15 ? (run * run) / 0.3 : run > 0.85 ? 1 - ((1 - run) * (1 - run)) / 0.3 : 0.075 + (run - 0.15) * (0.85 / 0.7);
    const e = clamp(dist, 0, 1);
    let px = lerp(START[0], PELVIS_KICK[0], e);
    let pz = lerp(START[1], PELVIS_KICK[1], e);
    // kierunek biegu: po skosie do piłki, przy strzale obrót w stronę bramki
    const dx = PELVIS_KICK[0] - START[0];
    const dz = PELVIS_KICK[1] - START[1];
    const runYaw = Math.atan2(dx, -dz);
    const yaw = lerp(runYaw, 0.12, smooth(seg(t, runEnd - 0.12, CONTACT)));
    // cykl kroków (3 pełne cykle w rozbiegu)
    const p = run * PI * 2 * 3;
    const fade = 1 - smooth(seg(t, runEnd - 0.06, runEnd));
    const legPhase = (ph) => ({ hip: 0.42 * Math.sin(ph), knee: 0.2 + 1.0 * Math.pow(Math.max(0, Math.cos(ph)), 1.6) });
    const R = legPhase(p);
    const L = legPhase(p + PI);
    const pose = {
      px, pz, yaw,
      py: B.pelvis - 0.035 - 0.03 * Math.abs(Math.cos(p)) * fade,
      lean: 0.1 * fade + 0.04,
      hipR: R.hip * fade, kneeR: R.knee * fade + 0.2 * (1 - fade), abdR: 0.03,
      hipL: L.hip * fade, kneeL: L.knee * fade + 0.2 * (1 - fade), abdL: 0.03,
      shR: -0.45 * Math.sin(p) * fade, elbR: 1.25, abR: 0.2,
      shL: 0.45 * Math.sin(p) * fade, elbL: 1.25, abL: 0.2,
      head: 0,
    };
    // strzał: zamach (noga do tyłu, kolano ugięte), uderzenie (wyprost), dokończenie, krok
    if (t > runEnd - 0.06) {
      const back = smooth(seg(t, runEnd - 0.06, CONTACT - 0.05));
      const strike = smooth(seg(t, CONTACT - 0.05, CONTACT));
      const follow = smooth(seg(t, CONTACT, CONTACT + 0.12));
      const recover = smooth(seg(t, CONTACT + 0.12, CONTACT + 0.32));
      pose.hipR = lerp(lerp(lerp(pose.hipR, -0.6, back), 0.35, strike), 1.05, follow);
      pose.hipR = lerp(pose.hipR, 0.15, recover);
      pose.kneeR = lerp(lerp(lerp(pose.kneeR, 1.7, back), 0.12, strike), 0.08, follow);
      pose.kneeR = lerp(pose.kneeR, 0.25, recover);
      // noga postawna: lekko z przodu, ugięta w kolanie
      pose.hipL = lerp(pose.hipL, 0.12, back) * (1 - recover) + 0.05 * recover;
      pose.kneeL = lerp(pose.kneeL, 0.38, back);
      pose.abdL = lerp(0.03, 0.08, back);
      // ręce: lewa w bok dla równowagi, prawa za siebie
      pose.shL = lerp(pose.shL, 0.35, back);
      pose.abL = lerp(0.2, 1.0, back) * (1 - recover * 0.6) + 0.2 * recover;
      pose.elbL = lerp(1.25, 0.5, back);
      pose.shR = lerp(pose.shR, -0.45, back) + 0.5 * follow;
      pose.abR = lerp(0.2, 0.45, back) * (1 - recover * 0.6) + 0.2 * recover;
      pose.elbR = lerp(1.25, 0.7, back);
      pose.lean = lerp(pose.lean, 0.03, back) - 0.06 * strike + 0.05 * follow;
      pose.lean = lerp(pose.lean, 0.06, recover);
      pose.py = lerp(pose.py, B.pelvis - 0.07, back) + 0.03 * follow;
      // po strzale krok do przodu
      pose.pz -= 0.35 * recover;
      pose.px += 0.12 * recover;
    }
    return pose;
  }

  // Reakcja po strzale (radość albo ręce na głowie), k = 0..1
  function shooterReact(pose, react, t) {
    if (!react) return pose;
    const k = smooth(react.k);
    const q = { ...pose };
    const legs = (v) => lerp(v, 0.06, k);
    q.hipR = legs(q.hipR);
    q.hipL = legs(q.hipL);
    q.kneeR = lerp(q.kneeR, 0.15, k);
    q.kneeL = lerp(q.kneeL, 0.15, k);
    q.lean = lerp(q.lean, react.joy ? -0.05 : 0.12, k);
    if (react.joy) {
      q.shR = lerp(q.shR, 2.9, k);
      q.shL = lerp(q.shL, 2.9, k);
      q.abR = lerp(q.abR, 0.45, k);
      q.abL = lerp(q.abL, 0.45, k);
      q.elbR = lerp(q.elbR, 0.2, k);
      q.elbL = lerp(q.elbL, 0.2, k);
      q.py += Math.abs(Math.sin(t * 9)) * 0.12 * k;
      q.smile = true;
    } else {
      q.shR = lerp(q.shR, 2.5, k);
      q.shL = lerp(q.shL, 2.5, k);
      q.abR = lerp(q.abR, 0.75, k);
      q.abL = lerp(q.abL, 0.75, k);
      q.elbR = lerp(q.elbR, 2.3, k);
      q.elbL = lerp(q.elbL, 2.3, k);
      q.head = 0.25 * k;
    }
    return q;
  }

  // Stawy w świecie [x, y, z] z kątów (zgięcie w przód = dodatnie, odwiedzenie w bok = dodatnie).
  function skeleton(q) {
    const f = [Math.sin(q.yaw), 0, -Math.cos(q.yaw)]; // kierunek patrzenia
    const r = [-f[2], 0, f[0]]; // prawa strona zawodnika
    const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
    // kierunek kończyny: w dół, obrócony w przód o kąt a i w bok o kąt b
    const dirv = (a, b, side) => {
      const down = Math.cos(a) * Math.cos(b);
      return [f[0] * Math.sin(a) + r[0] * Math.sin(b) * side, -down, f[2] * Math.sin(a) + r[2] * Math.sin(b) * side];
    };
    const pel = [q.px, q.py, q.pz];
    const up = [f[0] * Math.sin(q.lean), Math.cos(q.lean), f[2] * Math.sin(q.lean)];
    const neckBase = add(pel, up, B.torso);
    const J = {};
    J.pel = pel;
    J.hipL = add(pel, r, -B.hip);
    J.hipR = add(pel, r, B.hip);
    J.kneeL = add(J.hipL, dirv(q.hipL, q.abdL, -1), B.thigh);
    J.kneeR = add(J.hipR, dirv(q.hipR, q.abdR, 1), B.thigh);
    J.footL = add(J.kneeL, dirv(q.hipL - q.kneeL, q.abdL, -1), B.shin);
    J.footR = add(J.kneeR, dirv(q.hipR - q.kneeR, q.abdR, 1), B.shin);
    J.sc = neckBase;
    J.shL = add(add(neckBase, r, -B.shoulder), up, -0.04);
    J.shR = add(add(neckBase, r, B.shoulder), up, -0.04);
    J.elbL = add(J.shL, dirv(q.shL, q.abL, -1), B.uArm);
    J.elbR = add(J.shR, dirv(q.shR, q.abR, 1), B.uArm);
    J.handL = add(J.elbL, dirv(q.shL + q.elbL, q.abL * 0.6, -1), B.fArm);
    J.handR = add(J.elbR, dirv(q.shR + q.elbR, q.abR * 0.6, 1), B.fArm);
    const headUp = [up[0] + f[0] * Math.sin(q.head || 0), up[1], up[2] + f[2] * Math.sin(q.head || 0)];
    J.neck = add(neckBase, headUp, B.neck * 0.6);
    J.hc = add(neckBase, headUp, B.neck + B.head);
    J.f = f;
    return J;
  }

  // Rzutuje szkielet kamerą i rysuje postać (tym samym rysunkiem co pozostali zawodnicy).
  function drawShooter3D(g, cam, q, st) {
    const J = skeleton(q);
    const P = (v) => cam.p(v[0], v[1], v[2]);
    const pel = P(J.pel);
    const keys = ['sc', 'shL', 'shR', 'hipL', 'hipR', 'kneeL', 'footL', 'kneeR', 'footR', 'elbL', 'handL', 'elbR', 'handR', 'neck', 'hc'];
    const S = {};
    const Z = {};
    for (const k of keys) {
      const p = P(J[k]);
      S[k] = [p.x - pel.x, p.y - pel.y];
      Z[k] = p.z;
    }
    const order = {
      armBackL: Z.handL > Z.shL + 0.06 && Z.elbL > Z.sc,
      armBackR: Z.handR > Z.shR + 0.06 && Z.elbR > Z.sc,
      legFrontL: Z.footL < Z.hipL - 0.22,
      legFrontR: Z.footR < Z.hipR - 0.22,
    };
    // tyłem do kamery, gdy patrzy w tę samą stronę co kamera
    const camDir = cam.forward;
    const back = J.f[0] * camDir[0] + J.f[2] * camDir[2] > 0;
    // zamiana stron, gdy postać jest przodem (prawa ręka po lewej stronie ekranu)
    const h = pel.s * 1.8;
    const ha = Math.atan2(S.hc[0] - S.neck[0], -(S.hc[1] - S.neck[1]));
    const lean = Math.atan2(S.sc[0], -S.sc[1]);
    const shadow = P([J.pel[0], 0, J.pel[2]]);
    groundShadow(g, shadow.x, shadow.y, h * 0.22);
    g.save();
    g.translate(pel.x, pel.y);
    drawBody(g, S, st, { h, lean, ha, back, smile: q.smile, order });
    g.restore();
  }

  // ---------- piłka ----------
  function drawBall(g, x, y, r, spin) {
    if (r < 0.5) return;
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.arc(0, 0, r, 0, PI * 2);
    g.save();
    g.clip();
    g.fillStyle = '#f7faf8';
    g.fillRect(-r, -r, 2 * r, 2 * r);
    g.rotate(spin);
    const pent = (cx, cy, rr, rot) => {
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = rot + (i / 5) * PI * 2 - PI / 2;
        g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.closePath();
    };
    g.fillStyle = '#16191a';
    g.strokeStyle = 'rgba(40,45,44,.55)';
    g.lineWidth = Math.max(0.5, r * 0.05);
    pent(0, 0, r * 0.32, 0);
    g.fill();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * PI * 2 - PI / 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * r * 0.32, Math.sin(a) * r * 0.32);
      g.lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72);
      g.stroke();
      pent(Math.cos(a + PI / 5) * r * 0.98, Math.sin(a + PI / 5) * r * 0.98, r * 0.3, a);
      g.fill();
    }
    g.restore();
    const sh = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,.4)');
    sh.addColorStop(0.55, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(0,20,10,.45)');
    g.fillStyle = sh;
    g.beginPath();
    g.arc(0, 0, r, 0, PI * 2);
    g.fill();
    g.restore();
  }

  // Tor piłki w 3D [x, y, z] od punktu karnego do celu (i dalej zależnie od wyniku). u = 0..1 lotu, v = 0..1 po kontakcie.
  function ballWorld(kick, u, v, keeperZ) {
    const tx = kick.ball.x * GW;
    const ty = kick.ball.y * GH;
    const start = [0, 0.11, SPOT];
    const endZ = kick.result === 'save' ? keeperZ : 0;
    if (v <= 0) {
      const e = u;
      const arcH = 0.25 + Math.abs(ty) * 0.08;
      return [lerp(start[0], tx, e) + Math.sin(e * PI) * 0.15 * Math.sign(tx || 1), lerp(start[1], Math.max(0.11, ty), e) + Math.sin(e * PI) * arcH, lerp(start[2], endZ, e)];
    }
    const side = Math.sign(tx) || 1;
    const k = v;
    if (kick.result === 'goal') {
      // wpada do siatki i opada
      const z = lerp(0, -1.6, easeOut(k));
      const y = Math.max(0.11, lerp(ty, ty * 0.7, k) - easeIn(seg(k, 0.4, 1)) * ty);
      return [tx * lerp(1, 0.96, k), y, z];
    }
    if (kick.result === 'save') {
      return [tx + side * 3.2 * k, Math.max(0.11, ty + Math.sin(k * PI) * 0.9 - k * ty), keeperZ + 3.5 * k];
    }
    if (kick.result === 'post') {
      const bar = kick.ball.y > 1;
      return [tx + (bar ? side * 0.8 : -side * 1.4) * k, Math.max(0.11, ty + (bar ? 1.1 : 0.3) * Math.sin(k * PI) - ty * k * 0.8), 4.5 * k];
    }
    return [tx * (1 + 0.45 * k), ty + 0.6 * k, -7 * k];
  }

  // ---------- realistyczna rękawica (widok od strony grzbietu) ----------
  function drawGlove(g, x, y, s, angle, mirror) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.scale(mirror ? -s : s, s);
    const ol = 'rgba(20,30,20,.45)';
    // palce (mały, serdeczny, środkowy, wskazujący) lekko rozłożone
    const fingers = [
      { x: 0.31, len: 0.48, w: 0.145, a: 0.18 },
      { x: 0.105, len: 0.6, w: 0.16, a: 0.06 },
      { x: -0.105, len: 0.64, w: 0.165, a: -0.02 },
      { x: -0.31, len: 0.56, w: 0.16, a: -0.12 },
    ];
    for (const f of fingers) {
      g.save();
      g.translate(f.x, -0.04);
      g.rotate(f.a);
      const fg = g.createLinearGradient(-f.w, 0, f.w, 0);
      fg.addColorStop(0, '#d5dbd4');
      fg.addColorStop(0.5, '#ffffff');
      fg.addColorStop(1, '#c2c9c1');
      g.fillStyle = fg;
      g.beginPath();
      g.roundRect(-f.w, -f.len, f.w * 2, f.len + 0.1, f.w);
      g.fill();
      g.strokeStyle = ol;
      g.lineWidth = 0.02;
      g.stroke();
      // lateksowa końcówka i zgięcia
      g.fillStyle = 'rgba(182,242,58,.85)';
      g.beginPath();
      g.roundRect(-f.w, -f.len, f.w * 2, f.w * 1.1, f.w);
      g.fill();
      g.strokeStyle = 'rgba(40,50,40,.25)';
      g.lineWidth = 0.016;
      for (const k of [0.42, 0.68]) {
        g.beginPath();
        g.moveTo(-f.w * 0.75, -f.len * k);
        g.quadraticCurveTo(0, -f.len * k + 0.02, f.w * 0.75, -f.len * k);
        g.stroke();
      }
      g.restore();
    }
    // grzbiet dłoni z wyprofilowaniem
    const back = g.createLinearGradient(-0.45, -0.15, 0.45, 0.55);
    back.addColorStop(0, '#ffffff');
    back.addColorStop(1, '#cbd3cb');
    g.fillStyle = back;
    g.beginPath();
    g.moveTo(-0.47, -0.08);
    g.quadraticCurveTo(0, -0.22, 0.45, -0.08);
    g.quadraticCurveTo(0.52, 0.25, 0.42, 0.52);
    g.lineTo(-0.42, 0.52);
    g.quadraticCurveTo(-0.54, 0.25, -0.47, -0.08);
    g.fill();
    g.strokeStyle = ol;
    g.lineWidth = 0.022;
    g.stroke();
    // panel ochronny i logo
    g.fillStyle = '#111813';
    g.beginPath();
    g.moveTo(-0.33, 0.0);
    g.quadraticCurveTo(0, -0.08, 0.33, 0.0);
    g.lineTo(0.27, 0.36);
    g.lineTo(-0.27, 0.36);
    g.closePath();
    g.fill();
    g.strokeStyle = '#b6f23a';
    g.lineWidth = 0.06;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-0.19, 0.27);
    g.quadraticCurveTo(0.0, 0.0, 0.21, 0.08);
    g.stroke();
    // kciuk po wewnętrznej stronie
    g.save();
    g.translate(-0.49, 0.22);
    g.rotate(-0.85);
    const tg = g.createLinearGradient(-0.12, 0, 0.12, 0);
    tg.addColorStop(0, '#dfe4de');
    tg.addColorStop(1, '#ffffff');
    g.fillStyle = tg;
    g.beginPath();
    g.roundRect(-0.12, -0.44, 0.24, 0.5, 0.12);
    g.fill();
    g.strokeStyle = ol;
    g.lineWidth = 0.02;
    g.stroke();
    g.fillStyle = 'rgba(182,242,58,.85)';
    g.beginPath();
    g.roundRect(-0.12, -0.44, 0.24, 0.14, 0.12);
    g.fill();
    g.restore();
    // mankiet z rzepem
    g.fillStyle = '#0f1511';
    g.beginPath();
    g.roundRect(-0.44, 0.48, 0.88, 0.34, 0.08);
    g.fill();
    g.fillStyle = '#b6f23a';
    g.fillRect(-0.44, 0.6, 0.88, 0.07);
    g.fillStyle = '#26302a';
    g.beginPath();
    g.roundRect(-0.39, 0.51, 0.52, 0.27, 0.06);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.lineWidth = 0.012;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(-0.36 + i * 0.08, 0.53);
      g.lineTo(-0.36 + i * 0.08, 0.76);
      g.stroke();
    }
    // połysk
    g.fillStyle = 'rgba(255,255,255,.4)';
    g.beginPath();
    g.ellipse(0.16, -0.36, 0.045, 0.15, 0.1, 0, PI * 2);
    g.fill();
    g.restore();
  }

  // ---------- scena ----------
  function PenaltyScene(canvas) {
    const g = canvas.getContext('2d');
    const state = { view: 'shoot', aim: null, busy: false, anim: null, particles: [], text: null, shake: 0, marker: null, sweep: null, t0: performance.now() };
    const backdrop = { shoot: makeBackdrop('shoot'), save: makeBackdrop('save') };
    const KZ = 0.3; // bramkarz stoi 30 cm przed linią
    let onPick = null;
    let raf = 0;
    // widok obrony: płaszczyzna bramki to rama obrazu
    // widok obrony: punkt bramki <-> ekran przez kamerę 3D zza linii bramkowej
    // widok obrony: punkt bramki <-> ekran
    const saveMap = (p) => CAM.save.p(p.x * GW, p.y * GH, 0);
    const saveUnmap = (sx, sy) => CAM.save.toGoal(sx, sy);

    // Obszar bramki na ekranie w widoku strzału (rama, siatka i wnętrze) jako wielokąt wypukły.
    const goalHull = (() => {
      const pts = [];
      for (const x of [-GW, GW]) for (const [y, z] of [[0, 0], [GH, 0], [2.2, -1.1], [0, -2.0]]) {
        const q = CAM.shoot.p(x, y, z);
        pts.push([q.x, q.y]);
      }
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [];
      const hi = [];
      for (const p of pts) {
        while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
        lo.push(p);
      }
      for (const p of pts.slice().reverse()) {
        while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop();
        hi.push(p);
      }
      return lo.slice(0, -1).concat(hi.slice(0, -1));
    })();
    // punkt w środku, gdy leży po tej samej stronie wszystkich krawędzi (niezależnie od kierunku obiegu)
    const inHull = (x, y) => {
      let pos = 0;
      let neg = 0;
      for (let i = 0; i < goalHull.length; i++) {
        const a = goalHull[i];
        const b = goalHull[(i + 1) % goalHull.length];
        const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
        if (c > 0) pos++;
        else if (c < 0) neg++;
      }
      if (pos === 0 || neg === 0) return true;
      // margines 10 px wokół bramki (siatka z góry jest bardzo cienka)
      for (let i = 0; i < goalHull.length; i++) {
        const a = goalHull[i];
        const b = goalHull[(i + 1) % goalHull.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const t = clamp(((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (L * L), 0, 1);
        if (Math.hypot(x - (a[0] + (b[0] - a[0]) * t), y - (a[1] + (b[1] - a[1]) * t)) < 10) return true;
      }
      return false;
    };
    // Kliknięcie w strzale: w obszarze bramki = strzał celny (punkt w świetle bramki),
    // poza nim = strzał obok lub nad bramką.
    function shotTarget(sx, sy) {
      const g0 = CAM.shoot.toGoal(sx, sy);
      if (!inHull(sx, sy)) return g0;
      return { x: clamp(g0.x, -0.95, 0.95), y: clamp(g0.y, 0.05, 0.95) };
    }

    // Krążący celownik napastnika: punkt w chwili `now`. Tor Lissajous obejmuje bramkę i pas wokół niej
    // (obok słupków i nad poprzeczką), ten sam wzór co aimPoint w server/game.js.
    function sweepPoint(now) {
      const sw = state.sweep;
      if (sw.frozen) return sw.frozen;
      const t = ((now - sw.t0) / 1000) * sw.speed;
      return { x: 1.35 * Math.sin(2 * PI * t + sw.ph), y: 0.66 + 0.62 * Math.sin(2 * PI * t * 1.53 + sw.ph * 2.1) };
    }

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth || 800;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * (H / W) * dpr);
      g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const toScene = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    canvas.addEventListener('pointermove', (e) => !state.busy && (state.aim = toScene(e)));
    canvas.addEventListener('pointerleave', () => (state.aim = null));
    canvas.addEventListener('pointerdown', (e) => {
      if (state.busy || !onPick) return;
      const p = toScene(e);
      state.aim = p;
      let goal;
      if (state.view === 'shoot' && state.sweep) {
        // zatrzymanie celownika: strzał leci tam, gdzie celownik był w chwili stuknięcia
        goal = sweepPoint(performance.now());
        state.sweep.frozen = goal;
      } else goal = state.view === 'shoot' ? shotTarget(p.x, p.y) : saveUnmap(p.x, p.y);
      state.marker = { x: p.x, y: p.y };
      const cb = onPick;
      onPick = null;
      cb({ x: +goal.x.toFixed(3), y: +goal.y.toFixed(3) });
    });

    // ---------- bramka 3D (widok strzału) ----------
    function drawGoal3D(bulge) {
      const cam = CAM.shoot;
      // kształt siatki: dach od poprzeczki do tyłu, tył skośny do ziemi
      const netPt = (x, s, t) => {
        // s: 0 dach -> 1 tył dół; t niewykorzystane
        let y, z;
        if (s < 0.3) {
          const k = s / 0.3;
          y = lerp(GH, 2.2, k);
          z = lerp(0, -1.1, k);
        } else {
          const k = (s - 0.3) / 0.7;
          y = lerp(2.2, 0, k);
          z = lerp(-1.1, -2.0, k);
        }
        let px = x;
        if (bulge) {
          const d = Math.hypot(px - bulge.x, y - bulge.y);
          const f = Math.max(0, 1 - d / 1.5) * bulge.k;
          z -= f;
        }
        return cam.p(px, y, z);
      };
      g.strokeStyle = 'rgba(235,245,240,.42)';
      g.lineWidth = 1;
      const NX = 30;
      const NS = 16;
      for (let i = 0; i <= NX; i++) {
        const x = lerp(-GW, GW, i / NX);
        g.beginPath();
        for (let j = 0; j <= NS; j++) {
          const p = netPt(x, j / NS);
          j ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
        }
        g.stroke();
      }
      for (let j = 0; j <= NS; j++) {
        g.beginPath();
        for (let i = 0; i <= NX; i++) {
          const p = netPt(lerp(-GW, GW, i / NX), j / NS);
          i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
        }
        g.stroke();
      }
      // boczne siatki
      for (const sx of [-GW, GW]) {
        for (let j = 0; j <= NS; j += 2) {
          const back = netPt(sx, j / NS);
          const s = j / NS;
          const frontY = s < 0.3 ? GH : lerp(GH, 0, (s - 0.3) / 0.7);
          const front = cam.p(sx, frontY, 0);
          g.beginPath();
          g.moveTo(front.x, front.y);
          g.lineTo(back.x, back.y);
          g.stroke();
        }
        for (let k = 0; k <= 8; k++) {
          const y = (k / 8) * GH;
          const a = cam.p(sx, y, 0);
          const s = y > 2.2 ? 0.3 * (1 - (y - 2.2) / (GH - 2.2)) : 0.3 + 0.7 * (1 - y / 2.2);
          const b = netPt(sx, s);
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
      }
      // słupki i poprzeczka (12 cm), z cieniem
      const L0 = cam.p(-GW, 0, 0), L1 = cam.p(-GW, GH, 0), R1 = cam.p(GW, GH, 0), R0 = cam.p(GW, 0, 0);
      g.save();
      g.shadowColor = 'rgba(0,0,0,.55)';
      g.shadowBlur = 6;
      g.strokeStyle = '#f5f8f6';
      g.lineWidth = L1.s * 0.12;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(L0.x, L0.y);
      g.lineTo(L1.x, L1.y);
      g.lineTo(R1.x, R1.y);
      g.lineTo(R0.x, R0.y);
      g.stroke();
      g.restore();
      g.strokeStyle = 'rgba(120,130,125,.6)';
      g.lineWidth = L1.s * 0.035;
      g.beginPath();
      g.moveTo(L0.x + L1.s * 0.045, L0.y);
      g.lineTo(L1.x + L1.s * 0.045, L1.y + L1.s * 0.05);
      g.lineTo(R1.x - L1.s * 0.045, R1.y + L1.s * 0.05);
      g.lineTo(R0.x - L1.s * 0.045, R0.y);
      g.stroke();
    }

    const phase = (a, k) => (a.t < a.contactT ? (a.t / a.contactT) * k : k + seg(a.t, a.contactT, 1) * (1 - k));

    // ---------- widok: strzał ----------
    function drawShoot(now) {
      const cam = CAM.shoot;
      g.drawImage(backdrop.shoot, 0, 0);
      const a = state.anim && state.anim.kick.side === 'my' ? state.anim : null;
      const t = (now - state.t0) / 1000;
      let bulge = null;
      if (a && a.result === 'goal' && a.t > a.hitT) {
        bulge = { x: a.kick.ball.x * GW, y: a.kick.ball.y * GH, k: Math.sin(seg(a.t, a.hitT, a.hitT + 0.25) * PI) * 0.7 + 0.25 * seg(a.t, a.hitT, 1) };
      }
      drawGoal3D(bulge);
      // bramkarz rywala
      const kp = cam.p(0, 0, KZ);
      const kh = kp.s * 1.88;
      let pose;
      if (a) {
        const diveStart = a.contactT - 0.03;
        const diveT = seg(a.t, diveStart, diveStart + 0.5);
        // obrona: rękawice idą dokładnie do piłki; gol/pudło: rzut w wybrane przez AI miejsce
        const aim = a.result === 'save' ? a.kick.ball : a.kick.dive;
        const tp = cam.p(aim.x * GW, aim.y * GH, KZ);
        const hop = Math.sin(seg(a.t, a.contactT - 0.12, a.contactT - 0.03) * PI);
        pose = diveT > 0 ? keeperDive(diveT, kp.x + Math.sin(t * 1.3) * kh * 0.05, kp.y, kh, tp) : keeperIdle(t, kp.x, kp.y, kh, hop);
      } else pose = keeperIdle(t, kp.x, kp.y, kh);
      groundShadow(g, pose.x, kp.y + 2, kh * 0.32);
      drawRig(g, pose, STYLE.keeper);
      // piłka
      const ballDraw = () => {
        let w;
        if (!a || a.t < a.contactT) w = [0, 0.11, SPOT];
        else if (a.t <= a.hitT) w = ballWorld(a.kick, ease(seg(a.t, a.contactT, a.hitT)), 0, KZ);
        else w = ballWorld(a.kick, 1, seg(a.t, a.hitT, 1), KZ);
        const bp = cam.p(w[0], w[1], w[2]);
        const sp = cam.p(w[0], 0, w[2]);
        groundShadow(g, sp.x, sp.y, Math.max(2, bp.s * 0.16), 0.45);
        drawBall(g, bp.x, bp.y, bp.s * 0.11, a ? a.t * 26 : 0);
        return bp;
      };
      // strzelec (bliżej kamery, więc rysowany po piłce, gdy stoi z przodu)
      const react = a && a.t > a.hitT + 0.08 ? { k: seg(a.t, a.hitT + 0.08, a.hitT + 0.35), joy: a.result === 'goal' } : null;
      const q = shooterReact(shooterPose(a ? phase(a, CONTACT) : 0), react, now / 1000);
      ballDraw();
      drawShooter3D(g, cam, q, STYLE.shooterMe);
      // miejsce trafienia (krótki ślad)
      if (a && a.t > a.hitT && a.result !== 'miss') {
        const hp = cam.p(a.kick.ball.x * GW, a.kick.ball.y * GH, a.result === 'save' ? KZ : 0);
        const fade = 1 - seg(a.t, a.hitT, a.hitT + 0.3);
        if (fade > 0) {
          g.strokeStyle = `rgba(255,255,255,${fade * 0.8})`;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(hp.x, hp.y, 10 + (1 - fade) * 30, 0, PI * 2);
          g.stroke();
        }
      }
      // celownik
      if (state.sweep && (onPick || state.sweep.frozen) && (!a || a.t < a.contactT)) {
        const now2 = performance.now();
        const sp = sweepPoint(now2);
        // ślad celownika
        if (!state.sweep.frozen) {
          for (let i = 6; i >= 1; i--) {
            const q = sweepPoint(now2 - i * 22);
            const qp = CAM.shoot.p(q.x * GW, q.y * GH, 0);
            g.fillStyle = `rgba(255,210,63,${0.05 * (7 - i)})`;
            g.beginPath();
            g.arc(qp.x, qp.y, 6, 0, PI * 2);
            g.fill();
          }
        }
        const c = CAM.shoot.p(sp.x * GW, sp.y * GH, 0);
        const col = '#ffd23f'; // ten sam kolor co znacznik bramkarza
        g.save();
        g.strokeStyle = col;
        g.lineWidth = 3;
        g.shadowColor = col;
        g.shadowBlur = 14;
        g.beginPath();
        g.arc(c.x, c.y, 12, 0, PI * 2);
        g.moveTo(c.x - 22, c.y);
        g.lineTo(c.x - 6, c.y);
        g.moveTo(c.x + 6, c.y);
        g.lineTo(c.x + 22, c.y);
        g.moveTo(c.x, c.y - 22);
        g.lineTo(c.x, c.y - 6);
        g.moveTo(c.x, c.y + 6);
        g.lineTo(c.x, c.y + 22);
        g.stroke();
        g.fillStyle = col;
        g.beginPath();
        g.arc(c.x, c.y, 2.5, 0, PI * 2);
        g.fill();
        g.restore();
      }
      if (!state.sweep && !state.busy && state.aim && onPick) {
        const { x, y } = state.aim;
        const inGoal = inHull(x, y);
        const col = inGoal ? '#b6f23a' : '#ff9b3d';
        g.save();
        g.strokeStyle = col;
        g.lineWidth = 2.5;
        g.shadowColor = col;
        g.shadowBlur = 12;
        g.beginPath();
        g.arc(x, y, 13, 0, PI * 2);
        g.moveTo(x - 22, y);
        g.lineTo(x - 6, y);
        g.moveTo(x + 6, y);
        g.lineTo(x + 22, y);
        g.moveTo(x, y - 22);
        g.lineTo(x, y - 6);
        g.moveTo(x, y + 6);
        g.lineTo(x, y + 22);
        g.stroke();
        g.restore();
      }
    }

    // Rama bramki (słupki i poprzeczka 12 cm) z cieniowaniem walca.
    function drawFrame(cam) {
      const L0 = cam.p(-GW, 0, 0), L1 = cam.p(-GW, GH, 0), R1 = cam.p(GW, GH, 0), R0 = cam.p(GW, 0, 0);
      const pw = L1.s * 0.12;
      const bar = (x1, y1, x2, y2, vertical) => {
        const gr = vertical ? g.createLinearGradient(x1 - pw / 2, 0, x1 + pw / 2, 0) : g.createLinearGradient(0, y1 - pw / 2, 0, y1 + pw / 2);
        gr.addColorStop(0, '#a9b3ae');
        gr.addColorStop(0.45, '#ffffff');
        gr.addColorStop(1, '#949e99');
        g.strokeStyle = gr;
        g.lineWidth = pw;
        g.lineCap = 'butt';
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.stroke();
      };
      g.save();
      g.shadowColor = 'rgba(0,0,0,.45)';
      g.shadowBlur = 10;
      bar(L0.x, L0.y + pw, L1.x, L1.y - pw / 2, true);
      bar(R0.x, R0.y + pw, R1.x, R1.y - pw / 2, true);
      bar(L1.x - pw / 2, L1.y, R1.x + pw / 2, R1.y, false);
      g.restore();
    }

    function drawSave(now) {
      const cam = CAM.save;
      const a = state.anim && state.anim.kick.side === 'op' ? state.anim : null;
      const t = (now - state.t0) / 1000;
      // lekki przechył i przesunięcie obrazu podczas rzutu
      let tilt = 0;
      let shiftX = 0;
      if (a && state.marker) {
        const k = easeOut(seg(a.t, a.contactT - 0.02, a.contactT + 0.3)) * (1 - smooth(seg(a.t, 0.88, 1)) * 0.6);
        const side = Math.sign(state.marker.x - 400);
        tilt = side * 0.06 * k;
        shiftX = -side * 18 * k;
      }
      g.save();
      g.translate(400 + shiftX, 300);
      g.rotate(tilt);
      g.translate(-400, -300);
      g.drawImage(backdrop.save, -24, -24, W + 48, H + 48);
      const react = a && a.t > a.hitT + 0.08 ? { k: seg(a.t, a.hitT + 0.08, a.hitT + 0.35), joy: a.result === 'goal' } : null;
      const q = shooterReact(shooterPose(a ? phase(a, CONTACT) : 0), react, now / 1000);
      if (!a) q.lean += Math.sin(t) * 0.02;
      drawShooter3D(g, cam, q, STYLE.shooterOp);
      const spot = cam.p(0, 0.11, SPOT);
      if (!a || a.t < a.contactT) {
        const sh = cam.p(0, 0, SPOT);
        groundShadow(g, sh.x, sh.y, spot.s * 0.16, 0.45);
        drawBall(g, spot.x, spot.y, spot.s * 0.11, 0);
      }
      // piłka w locie (ten sam tor 3D co w widoku strzału)
      let ballFront = null;
      if (a && a.t >= a.contactT) {
        const wpt = a.t <= a.hitT ? ballWorld(a.kick, ease(seg(a.t, a.contactT, a.hitT)), 0, KZ) : ballWorld(a.kick, 1, seg(a.t, a.hitT, 1), KZ);
        const bp = cam.p(wpt[0], wpt[1], wpt[2]);
        const bs = cam.p(wpt[0], 0, wpt[2]);
        const drawIt = () => {
          groundShadow(g, bs.x, bs.y, Math.max(2, bp.s * 0.16), 0.4);
          drawBall(g, bp.x, bp.y, bp.s * 0.11, a.t * 18);
        };
        if (wpt[2] < 0) ballFront = drawIt; // w siatce: przed ramą
        else drawIt();
      }
      drawFrame(cam);
      if (ballFront) ballFront();
      g.restore();
      // znacznik miejsca rzutu
      if (state.marker) {
        const m = state.marker;
        const pulse = 0.5 + Math.sin(now / 160) * 0.5;
        const fade = a ? 1 - seg(a.t, a.contactT + 0.2, a.contactT + 0.4) : 1;
        if (fade > 0) {
          g.save();
          g.globalAlpha = fade;
          g.strokeStyle = '#ffd23f';
          g.lineWidth = 3.5;
          g.shadowColor = '#ffd23f';
          g.shadowBlur = 14;
          g.beginPath();
          g.arc(m.x, m.y, 24 + pulse * 4, 0, PI * 2);
          g.stroke();
          g.lineWidth = 2;
          g.beginPath();
          g.arc(m.x, m.y, 6, 0, PI * 2);
          g.stroke();
          g.restore();
        }
      } else if (!state.busy && state.aim && onPick) {
        g.strokeStyle = 'rgba(255,214,63,.6)';
        g.lineWidth = 3;
        g.setLineDash([7, 7]);
        g.beginPath();
        g.arc(state.aim.x, state.aim.y, 24, 0, PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      // rękawice: gotowość nisko przed sobą, potem rzut (przy obronie dokładnie do piłki)
      const ready = { l: { x: 362, y: 505 }, r: { x: 438, y: 505 } };
      const breath = Math.sin(now / 380) * 3;
      let L = { x: ready.l.x, y: ready.l.y + breath };
      let R = { x: ready.r.x, y: ready.r.y + breath };
      let ang = 0;
      let size = 46;
      if (a && state.marker) {
        const k = easeOut(seg(a.t, a.contactT - 0.02, a.contactT + 0.3));
        const goal = a.result === 'save' ? saveMap(a.kick.ball) : state.marker;
        const side = Math.sign(goal.x - 400) || 1;
        ang = side * 0.45 * k;
        size = lerp(46, 40, k);
        const gap = 22;
        L = { x: lerp(ready.l.x, goal.x - gap * Math.cos(ang), k), y: lerp(ready.l.y, goal.y - gap * Math.sin(ang), k) };
        R = { x: lerp(ready.r.x, goal.x + gap * Math.cos(ang), k), y: lerp(ready.r.y, goal.y + gap * Math.sin(ang), k) };
        if (k > 0.05 && k < 0.95) {
          g.globalAlpha = 0.16;
          drawGlove(g, lerp(ready.l.x, L.x, 0.55), lerp(ready.l.y, L.y, 0.55), size, ang - 0.22, true);
          drawGlove(g, lerp(ready.r.x, R.x, 0.55), lerp(ready.r.y, R.y, 0.55), size, ang + 0.22, false);
          g.globalAlpha = 1;
        }
      }
      drawGlove(g, L.x, L.y, size, ang - 0.22, true);
      drawGlove(g, R.x, R.y, size, ang + 0.22, false);
    }

    // ---------- efekty ----------
    function burst(x, y, color) {
      for (let i = 0; i < 90; i++) {
        const an = Math.random() * PI * 2;
        const v = 2 + Math.random() * 7;
        state.particles.push({ x, y, vx: Math.cos(an) * v, vy: Math.sin(an) * v - 3, life: 1, c: Math.random() < 0.5 ? color : '#ffffff', s: 2 + Math.random() * 4, r: Math.random() * PI });
      }
    }
    function drawFx(now) {
      for (const p of state.particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.17;
        p.vx *= 0.99;
        p.life -= 0.014;
        p.r += 0.2;
        g.save();
        g.globalAlpha = Math.max(0, p.life);
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.fillStyle = p.c;
        g.fillRect(-p.s / 2, -p.s * 0.3, p.s, p.s * 0.6);
        g.restore();
      }
      state.particles = state.particles.filter((p) => p.life > 0);
      if (!state.text) return;
      const t = (now - state.text.at) / 1500;
      if (t > 1) {
        state.text = null;
        return;
      }
      const sc = t < 0.14 ? lerp(0.4, 1.15, t / 0.14) : t < 0.24 ? lerp(1.15, 1, (t - 0.14) / 0.1) : 1;
      g.save();
      g.globalAlpha = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      g.fillStyle = 'rgba(8,30,14,.62)';
      g.fillRect(0, 230, W, 92);
      g.translate(W / 2, 276);
      g.scale(sc, sc);
      g.font = '800 78px "Chakra Petch", sans-serif';
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
    function onHit(a) {
      const mine = a.kick.side === 'my';
      const p = state.view === 'shoot' ? CAM.shoot.p(a.kick.ball.x * GW, a.kick.ball.y * GH, 0) : saveMap(a.kick.ball);
      const show = (label, color) => (state.text = { label, color, at: performance.now() });
      if (a.result === 'goal') {
        show('GOL!', mine ? '#b6f23a' : '#ff4d5e');
        burst(p.x, p.y, mine ? '#b6f23a' : '#ff4d5e');
      } else if (a.result === 'save') {
        show('OBRONA!', mine ? '#ff4d5e' : '#b6f23a');
        state.shake = 14;
        if (!mine) burst(p.x, p.y, '#ffd23f');
      } else if (a.result === 'post') {
        show(a.kick.ball.y > 1 ? 'POPRZECZKA!' : 'SŁUPEK!', mine ? '#ff9b3d' : '#b6f23a');
        state.shake = 10;
      } else show('PUDŁO', mine ? '#ff9b3d' : '#b6f23a');
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

    return {
      // opts.sweep: prędkość krążącego celownika (obiegi na sekundę) w widoku strzału
      wait(view, cb, opts = {}) {
        state.view = view;
        state.marker = null;
        state.busy = false;
        state.sweep = view === 'shoot' && opts.sweep ? { t0: performance.now(), speed: opts.sweep, ph: Math.random() * PI * 2, frozen: null } : null;
        onPick = cb;
      },
      get view() {
        return state.view;
      },
      // punkt bramki dla kliknięcia w widoku strzału (używane w testach)
      targetAt: (sx, sy) => shotTarget(sx, sy),
      // aktualny punkt krążącego celownika (używane w testach)
      sweepAt: () => (state.sweep ? sweepPoint(performance.now()) : null),
      // przerwanie oczekiwania na kliknięcie (koniec czasu)
      cancel() {
        onPick = null;
        state.busy = true;
        state.sweep = null;
      },
      show(view) {
        state.view = view;
        state.marker = null;
        if (!(state.sweep && state.sweep.frozen && view === 'shoot')) state.sweep = null;
        state.busy = true;
        onPick = null;
      },
      play(kick) {
        state.busy = true;
        return new Promise((resolve) => {
          const mine = kick.side === 'my';
          const fly = lerp(0.19, 0.1, clamp((kick.power || 0) * 1.4, 0, 1)); // mocniejszy strzał = krótszy lot
          state.anim = mine
            ? { kick, result: kick.result, start: performance.now(), dur: 3000, contactT: 0.38, hitT: 0.38 + fly, t: 0, done: () => { state.sweep = null; resolve(); } }
            : { kick, result: kick.result, start: performance.now(), dur: 3200, contactT: 0.5, hitT: 0.5 + fly, t: 0, done: resolve };
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
