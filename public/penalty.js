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
      // punkt świata [x, y, z] -> ekran; s = piksele na metr na tej głębokości
      p(x, y, z) {
        const d = sub([x, y, z], pos);
        const zc = Math.max(0.05, dot(d, fw));
        return { x: cx + (f * dot(d, right)) / zc, y: cy - (f * dot(d, up)) / zc, s: f / zc, z: zc };
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
    shoot: camera([0, 2.2, 19.5], [0, 0.9, 0], 1150, 400, 250),
    save: camera([0, 1.65, -0.8], [0, 0.55, 11], 640, 400, 322),
  };

  // ---------- stroje ----------
  const STYLE = {
    keeper: { shirt: '#ff7a1a', trim: '#1b1b1d', sleeve: '#ff7a1a', long: true, shorts: '#1b1b1d', socks: '#ff7a1a', boots: '#121212', sole: '#b6f23a',
      skin: '#e8b48c', hair: '#2b1a10', hairStyle: 'short', gloves: true, num: '1', numColor: '#1b1b1d' },
    shooterOp: { shirt: '#6f35d9', trim: '#ffffff', sleeve: '#6f35d9', shorts: '#f4f4f4', socks: '#6f35d9', boots: '#f7f7f7', sole: '#6f35d9',
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
    // trybuny (za bramką w widoku strzału, za polem karnym w widoku obrony)
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
    // jupitery
    for (const fx of [70, W - 70]) {
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
    const zMin = view === 'shoot' ? -6 : 0.2;
    const zMax = view === 'shoot' ? 18.5 : 62;
    const step = 2.75;
    for (let z = Math.floor(zMin / step) * step; z < zMax; z += step) {
      const z1 = Math.max(z, zMin);
      const z2 = Math.min(z + step, zMax);
      for (let x = -42; x < 42; x += 14) {
        const a = P(x, 0, z1), b = P(x + 14, 0, z1), d = P(x + 14, 0, z2), e = P(x, 0, z2);
        if (a.z < 1 || d.z < 1) continue;
        const stripe = Math.round(z / step) % 2 === 0;
        const check = Math.round(x / 14) % 2 === 0;
        poly([a, b, d, e], stripe ? (check ? '#25883a' : '#238437') : check ? '#1f7832' : '#1d7430');
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
    const bz = view === 'shoot' ? -5 : 60;
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

  // pose: { x, y (miednica), h (wzrost w px), rot, lean, head, aL1..aR2, lL1..lR2, foreL, foreR, back }
  function drawRig(g, pose, st) {
    const h = pose.h;
    const w = h * 0.045;
    const ol = 'rgba(0,0,0,.28)';
    g.save();
    g.translate(pose.x, pose.y);
    g.rotate(pose.rot || 0);
    const lean = pose.lean || 0;
    const sc = [Math.sin(lean) * PR.torso * h, -Math.cos(lean) * PR.torso * h];
    const px = Math.cos(lean);
    const py = Math.sin(lean);
    const shL = [sc[0] - (px * PR.shoulder * h) / 2, sc[1] - (py * PR.shoulder * h) / 2 + w * 0.4];
    const shR = [sc[0] + (px * PR.shoulder * h) / 2, sc[1] + (py * PR.shoulder * h) / 2 + w * 0.4];
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

    // noga: udo, kolano, getra z ochraniaczem, but z podeszwą
    const leg = (hip, knee, foot, side) => {
      capsule(g, hip[0], hip[1], knee[0], knee[1], w * 1.25, w * 0.95, st.skin, ol);
      const sockTop = [lerp(knee[0], foot[0], 0.12), lerp(knee[1], foot[1], 0.12)];
      capsule(g, knee[0], knee[1], sockTop[0], sockTop[1], w * 0.95, w * 0.92, st.skin);
      capsule(g, sockTop[0], sockTop[1], foot[0], foot[1], w * 0.98, w * 0.7, st.socks, ol);
      g.strokeStyle = shade(st.socks, 0.35);
      g.lineWidth = w * 0.35;
      g.beginPath();
      g.moveTo(sockTop[0] - w * 0.9, sockTop[1]);
      g.lineTo(sockTop[0] + w * 0.9, sockTop[1]);
      g.stroke();
      // ochraniacz (wypukłość na goleni)
      g.fillStyle = 'rgba(255,255,255,.14)';
      g.beginPath();
      g.ellipse(lerp(sockTop[0], foot[0], 0.4), lerp(sockTop[1], foot[1], 0.4), w * 0.5, w * 2, Math.atan2(foot[0] - sockTop[0], sockTop[1] - foot[1]), 0, PI * 2);
      g.fill();
      // but
      const toe = side * (pose.back ? -0.2 : 0.2);
      g.save();
      g.translate(foot[0], foot[1] + w * 0.25);
      g.rotate(toe);
      g.fillStyle = st.boots;
      g.beginPath();
      g.ellipse(side * w * 0.25, 0, w * 1.45, w * 0.72, 0, 0, PI * 2);
      g.fill();
      g.strokeStyle = ol;
      g.lineWidth = w * 0.15;
      g.stroke();
      g.fillStyle = st.sole;
      g.fillRect(-w * 1.1 + side * w * 0.25, w * 0.42, w * 2.2, w * 0.28);
      g.strokeStyle = st.sole;
      g.lineWidth = w * 0.2;
      g.beginPath();
      g.moveTo(-w * 0.6 + side * w * 0.25, -w * 0.2);
      g.quadraticCurveTo(side * w * 0.25, w * 0.15, w * 0.7 + side * w * 0.25, -w * 0.25);
      g.stroke();
      g.restore();
    };
    leg(hipL, kneeL, footL, -1);
    leg(hipR, kneeR, footR, 1);

    // spodenki z bocznym lampasem
    const shortsPts = [
      [hipL[0] - w * 1.7, -w * 1.5],
      [hipR[0] + w * 1.7, -w * 1.5],
      [lerp(hipR[0], kneeR[0], 0.42) + w * 1.45, lerp(hipR[1], kneeR[1], 0.42)],
      [lerp(hipR[0], kneeR[0], 0.42) - w * 1.1, lerp(hipR[1], kneeR[1], 0.42) + w * 0.3],
      [0, w * 1.2],
      [lerp(hipL[0], kneeL[0], 0.42) + w * 1.1, lerp(hipL[1], kneeL[1], 0.42) + w * 0.3],
      [lerp(hipL[0], kneeL[0], 0.42) - w * 1.45, lerp(hipL[1], kneeL[1], 0.42)],
    ];
    const sg = g.createLinearGradient(-w * 3, 0, w * 3, 0);
    sg.addColorStop(0, shade(st.shorts, 0.08));
    sg.addColorStop(1, shade(st.shorts, -0.28));
    g.fillStyle = sg;
    g.beginPath();
    shortsPts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    g.fill();
    g.strokeStyle = ol;
    g.lineWidth = w * 0.15;
    g.stroke();
    g.strokeStyle = st.trim;
    g.lineWidth = w * 0.3;
    g.beginPath();
    g.moveTo(shortsPts[1][0], shortsPts[1][1]);
    g.lineTo(shortsPts[2][0], shortsPts[2][1]);
    g.moveTo(shortsPts[0][0], shortsPts[0][1]);
    g.lineTo(shortsPts[6][0], shortsPts[6][1]);
    g.stroke();

    // ręka (rysowana przed tułowiem lub za nim)
    const arm = (sh, elb, hand) => {
      capsule(g, sh[0], sh[1], elb[0], elb[1], w * 1.15, w * 0.92, st.sleeve, ol);
      if (!st.long) {
        g.strokeStyle = st.trim;
        g.lineWidth = w * 0.3;
        const cx = lerp(sh[0], elb[0], 0.62);
        const cy = lerp(sh[1], elb[1], 0.62);
        g.beginPath();
        g.arc(cx, cy, w * 1.0, 0, PI * 2);
        g.stroke();
      }
      capsule(g, st.long ? elb[0] : lerp(sh[0], elb[0], 0.68), st.long ? elb[1] : lerp(sh[1], elb[1], 0.68), hand[0], hand[1], w * 0.88, w * 0.68, st.long ? st.sleeve : st.skin, ol);
      if (st.gloves) {
        const a = Math.atan2(hand[1] - elb[1], hand[0] - elb[0]);
        g.save();
        g.translate(hand[0], hand[1]);
        g.rotate(a - PI / 2);
        g.fillStyle = '#121a14';
        g.beginPath();
        g.roundRect(-w * 1.05, -w * 0.8, w * 2.1, w * 0.9, w * 0.3);
        g.fill();
        g.fillStyle = '#f5f7f3';
        g.beginPath();
        g.roundRect(-w * 1.15, 0, w * 2.3, w * 2.2, w * 0.9);
        g.fill();
        g.strokeStyle = ol;
        g.lineWidth = w * 0.15;
        g.stroke();
        g.fillStyle = '#b6f23a';
        g.fillRect(-w * 1.05, -w * 0.4, w * 2.1, w * 0.3);
        g.restore();
      } else {
        g.fillStyle = st.skin;
        g.beginPath();
        g.arc(hand[0], hand[1], w * 0.82, 0, PI * 2);
        g.fill();
      }
    };

    // koszulka: trapez z barkami, kołnierz w serek, panele boczne, numer
    const tg = g.createLinearGradient(shL[0] - w * 2, sc[1], shR[0] + w * 2, 0);
    tg.addColorStop(0, shade(st.shirt, 0.18));
    tg.addColorStop(0.55, st.shirt);
    tg.addColorStop(1, shade(st.shirt, -0.32));
    g.fillStyle = tg;
    g.beginPath();
    g.moveTo(shL[0] - w * 0.8, shL[1] - w * 0.2);
    g.quadraticCurveTo(sc[0], sc[1] - w * 1.6, shR[0] + w * 0.8, shR[1] - w * 0.2);
    g.quadraticCurveTo(shR[0] + w * 0.9, lerp(shR[1], 0, 0.55), hipR[0] + w * 1.75, -w * 1.1);
    g.lineTo(hipL[0] - w * 1.75, -w * 1.1);
    g.quadraticCurveTo(shL[0] - w * 0.9, lerp(shL[1], 0, 0.55), shL[0] - w * 0.8, shL[1] - w * 0.2);
    g.fill();
    g.strokeStyle = ol;
    g.lineWidth = w * 0.15;
    g.stroke();
    // panele boczne
    g.fillStyle = 'rgba(0,0,0,.14)';
    g.beginPath();
    g.moveTo(shR[0] + w * 0.4, shR[1] + w * 1.2);
    g.quadraticCurveTo(shR[0] + w * 0.6, lerp(shR[1], 0, 0.5), hipR[0] + w * 1.6, -w * 1.2);
    g.lineTo(hipR[0] + w * 0.7, -w * 1.2);
    g.quadraticCurveTo(shR[0] - w * 0.3, lerp(shR[1], 0, 0.5), shR[0] + w * 0.4, shR[1] + w * 1.2);
    g.fill();
    if (pose.back) {
      g.save();
      g.translate(lerp(sc[0], 0, 0.42), lerp(sc[1], 0, 0.42));
      g.rotate(lean);
      g.fillStyle = st.numColor;
      g.font = `800 ${Math.round(h * 0.12)}px "Chakra Petch", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(st.num, 0, 0);
      g.restore();
      g.fillStyle = st.trim;
      g.beginPath();
      g.ellipse(sc[0], sc[1] - w * 0.6, w * 1.3, w * 0.45, lean, 0, PI * 2);
      g.fill();
    } else {
      g.fillStyle = st.trim;
      g.beginPath();
      g.moveTo(sc[0] - w * 1.2, sc[1] - w * 0.9);
      g.lineTo(sc[0], sc[1] + w * 0.9);
      g.lineTo(sc[0] + w * 1.2, sc[1] - w * 0.9);
      g.lineTo(sc[0] + w * 0.7, sc[1] - w * 0.9);
      g.lineTo(sc[0], sc[1] + w * 0.1);
      g.lineTo(sc[0] - w * 0.7, sc[1] - w * 0.9);
      g.closePath();
      g.fill();
      g.save();
      g.translate(lerp(sc[0], 0, 0.42) + w * 1.2, lerp(sc[1], 0, 0.42) - w * 0.8);
      g.rotate(lean);
      g.fillStyle = st.numColor;
      g.font = `800 ${Math.round(h * 0.07)}px "Chakra Petch", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(st.num, 0, 0);
      g.restore();
    }
    arm(shL, elbL, handL);
    arm(shR, elbR, handR);

    // szyja i głowa z twarzą
    const hr = PR.head * h;
    const ha = lean + (pose.head || 0);
    const hc = [sc[0] + Math.sin(ha) * hr * 1.4, sc[1] - Math.cos(ha) * hr * 1.4];
    capsule(g, sc[0], sc[1] - w * 0.5, hc[0], hc[1], w * 0.78, w * 0.72, shade(st.skin, -0.08));
    g.save();
    g.translate(hc[0], hc[1]);
    g.rotate(ha);
    const hg = g.createRadialGradient(-hr * 0.35, -hr * 0.35, hr * 0.1, 0, 0, hr * 1.1);
    hg.addColorStop(0, shade(st.skin, 0.12));
    hg.addColorStop(1, shade(st.skin, -0.2));
    g.fillStyle = hg;
    g.beginPath();
    g.ellipse(0, 0, hr * 0.92, hr * 1.04, 0, 0, PI * 2);
    g.fill();
    g.strokeStyle = ol;
    g.lineWidth = w * 0.14;
    g.stroke();
    // uszy
    g.fillStyle = shade(st.skin, -0.1);
    g.beginPath();
    g.ellipse(-hr * 0.92, hr * 0.05, hr * 0.17, hr * 0.26, 0, 0, PI * 2);
    g.ellipse(hr * 0.92, hr * 0.05, hr * 0.17, hr * 0.26, 0, 0, PI * 2);
    g.fill();
    // włosy
    g.fillStyle = st.hair;
    g.beginPath();
    if (pose.back) {
      g.ellipse(0, -hr * 0.08, hr * 0.96, hr * 0.98, 0, PI * 0.92, PI * 2.08);
      g.lineTo(hr * 0.86, hr * 0.42);
      g.quadraticCurveTo(0, hr * 0.6, -hr * 0.86, hr * 0.42);
    } else if (st.hairStyle === 'buzz') {
      g.ellipse(0, -hr * 0.18, hr * 0.94, hr * 0.86, 0, PI * 1.02, PI * 1.98);
      g.quadraticCurveTo(hr * 0.8, -hr * 0.3, hr * 0.9, -hr * 0.05);
    } else {
      g.moveTo(-hr * 0.95, -hr * 0.05);
      for (let i = 0; i <= 8; i++) {
        const a = PI + (i / 8) * PI;
        const rr = st.hairStyle === 'spiky' && i % 2 ? hr * 1.25 : hr * 1.02;
        g.lineTo(Math.cos(a) * rr, -hr * 0.15 + Math.sin(a) * rr);
      }
      g.lineTo(hr * 0.95, -hr * 0.05);
      g.quadraticCurveTo(hr * 0.3, -hr * 0.5, -hr * 0.95, -hr * 0.05);
    }
    g.fill();
    if (!pose.back) {
      // oczy, brwi, nos, usta
      const eye = (x) => {
        g.fillStyle = '#fff';
        g.beginPath();
        g.ellipse(x, hr * 0.12, hr * 0.17, hr * 0.12, 0, 0, PI * 2);
        g.fill();
        g.fillStyle = '#2a2018';
        g.beginPath();
        g.arc(x + hr * 0.03, hr * 0.13, hr * 0.085, 0, PI * 2);
        g.fill();
        g.strokeStyle = shade(st.hair, 0.1);
        g.lineWidth = hr * 0.09;
        g.beginPath();
        g.moveTo(x - hr * 0.2, -hr * 0.12);
        g.lineTo(x + hr * 0.18, -hr * 0.16);
        g.stroke();
      };
      eye(-hr * 0.36);
      eye(hr * 0.36);
      g.strokeStyle = shade(st.skin, -0.3);
      g.lineWidth = hr * 0.07;
      g.beginPath();
      g.moveTo(0, hr * 0.18);
      g.lineTo(-hr * 0.06, hr * 0.42);
      g.lineTo(hr * 0.05, hr * 0.44);
      g.stroke();
      g.strokeStyle = shade(st.skin, -0.45);
      g.beginPath();
      g.moveTo(-hr * 0.22, hr * 0.64);
      g.quadraticCurveTo(0, pose.smile ? hr * 0.8 : hr * 0.68, hr * 0.22, hr * 0.64);
      g.stroke();
    }
    g.restore();
    g.restore();
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
  // Tyłem (mój strzelec): łukowy rozbieg, noga zakroczna, strzał, dobieg, reakcja. Kontakt w t = 0.55.
  function shooterBack(t, cam, react) {
    const run = seg(t, 0, 0.5);
    const e = ease(run);
    // tor rozbiegu po łuku: z lewej, z tyłu, do piłki
    const wx = lerp(-2.3, -0.5, e) + Math.sin(e * PI) * 0.3;
    const wz = lerp(12.9, SPOT + 0.42, e);
    const p = cam.p(wx, 0, wz);
    const h = p.s * 1.82;
    const ph = run * PI * 6.5;
    const slow = seg(t, 0.38, 0.5);
    const stride = Math.sin(ph) * (1 - slow);
    const back = seg(t, 0.42, 0.52);
    const swing = seg(t, 0.5, 0.62);
    const follow = seg(t, 0.62, 0.8);
    const pose = {
      x: p.x, y: p.y - h * 0.47 - Math.abs(Math.sin(ph)) * h * 0.025 * (1 - back), h, rot: 0, back: true, lean: -0.05 * back + 0.14 * swing - 0.06 * follow,
      lL1: -0.1 + stride * 0.22 - back * 0.08, lL2: 0.12 + Math.max(0, stride) * 0.55,
      lR1: 0.1 - stride * 0.22 + swing * 0.5 - follow * 0.15, lR2: -0.1 + Math.max(0, -stride) * 0.55 + back * 0.95 - swing * 0.9,
      foreR: clamp(swing * 1.1 - follow * 0.5, 0, 1) * 0.8,
      aL1: -0.28 + stride * 0.55 - (back + swing) * 0.65, aL2: -0.35, aR1: 0.28 + stride * 0.55 + swing * 0.55, aR2: 0.35,
    };
    return applyReaction(pose, react);
  }
  // Przodem (strzelec rywala z perspektywy bramki). Kontakt w t = 0.62.
  function shooterFront(t, cam, react) {
    const run = seg(t, 0, 0.56);
    const e = ease(run);
    const wx = lerp(1.9, 0.38, e) - Math.sin(e * PI) * 0.3;
    const wz = lerp(SPOT + 3.2, SPOT + 0.35, e);
    const p = cam.p(wx, 0, wz);
    const h = p.s * 1.82;
    const ph = run * PI * 7;
    const slow = seg(t, 0.46, 0.56);
    const stride = Math.sin(ph) * (1 - slow);
    const back = seg(t, 0.5, 0.6);
    const swing = seg(t, 0.58, 0.7);
    const follow = seg(t, 0.7, 0.86);
    const pose = {
      x: p.x, y: p.y - h * 0.47 - Math.abs(Math.sin(ph)) * h * 0.03 * (1 - back), h, rot: 0, lean: 0.06 * stride - 0.1 * swing,
      lL1: -0.12 + stride * 0.16, lL2: 0.12 + Math.max(0, -stride) * 0.6,
      lR1: 0.12 - stride * 0.16 - back * 0.25 + swing * 0.45 - follow * 0.15, lR2: -0.1 + Math.max(0, stride) * 0.6 + back * 0.9 - swing * 1.05,
      foreR: clamp(swing * 1.25 - follow * 0.55, 0, 1),
      aL1: -0.32 - stride * 0.5 - swing * 1.05, aL2: -0.4, aR1: 0.32 - stride * 0.5 + swing * 0.85, aR2: 0.4,
    };
    return applyReaction(pose, react);
  }
  // Reakcja po strzale: radość (gol) albo ręce na głowie (pudło, obrona).
  function applyReaction(pose, react) {
    if (!react) return pose;
    const k = smooth(react.k);
    if (react.joy) {
      const jump = Math.abs(Math.sin(react.k * PI * 2.5)) * pose.h * 0.06 * k;
      return {
        ...pose, y: pose.y - jump, smile: true, lean: lerp(pose.lean, 0, k),
        aL1: lerp(pose.aL1, -2.7, k), aL2: lerp(pose.aL2, -0.2, k), aR1: lerp(pose.aR1, 2.7, k), aR2: lerp(pose.aR2, 0.2, k),
        lL1: lerp(pose.lL1, -0.12, k), lL2: lerp(pose.lL2, 0.1, k), lR1: lerp(pose.lR1, 0.12, k), lR2: lerp(pose.lR2, -0.1, k), foreR: lerp(pose.foreR || 0, 0, k),
      };
    }
    return {
      ...pose, lean: lerp(pose.lean, 0.06, k), head: 0.15 * k,
      aL1: lerp(pose.aL1, -2.55, k), aL2: lerp(pose.aL2, 2.35, k), aR1: lerp(pose.aR1, 2.55, k), aR2: lerp(pose.aR2, -2.35, k),
      lL1: lerp(pose.lL1, -0.1, k), lL2: lerp(pose.lL2, 0.08, k), lR1: lerp(pose.lR1, 0.1, k), lR2: lerp(pose.lR2, -0.08, k), foreR: lerp(pose.foreR || 0, 0, k),
    };
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
    const state = { view: 'shoot', aim: null, busy: false, anim: null, particles: [], text: null, shake: 0, marker: null, t0: performance.now() };
    const backdrop = { shoot: makeBackdrop('shoot'), save: makeBackdrop('save') };
    const KZ = 0.3; // bramkarz stoi 30 cm przed linią
    let onPick = null;
    let raf = 0;
    // widok obrony: płaszczyzna bramki to rama obrazu
    const FRAME = { cx: 400, gy: 520, hw: 350, hh: 455 };
    const saveMap = (p) => ({ x: FRAME.cx + p.x * FRAME.hw, y: FRAME.gy - p.y * FRAME.hh });
    const saveUnmap = (sx, sy) => ({ x: (sx - FRAME.cx) / FRAME.hw, y: (FRAME.gy - sy) / FRAME.hh });

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
      const goal = state.view === 'shoot' ? CAM.shoot.toGoal(p.x, p.y) : saveUnmap(p.x, p.y);
      if (state.view === 'save') state.marker = { x: p.x, y: p.y };
      else state.marker = { x: p.x, y: p.y };
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
      const sp = shooterBack(a ? phase(a, 0.55) : 0, cam, react);
      ballDraw();
      groundShadow(g, sp.x, sp.y + sp.h * 0.47, sp.h * 0.22);
      drawRig(g, sp, STYLE.shooterMe);
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
      if (!state.busy && state.aim && onPick) {
        const { x, y } = state.aim;
        const inGoal = (() => {
          const gp = CAM.shoot.toGoal(x, y);
          return Math.abs(gp.x) <= 1 && gp.y >= 0 && gp.y <= 1;
        })();
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

    // ---------- widok: obrona (z bramki, same rękawice) ----------
    function drawSave(now) {
      const cam = CAM.save;
      const a = state.anim && state.anim.kick.side === 'op' ? state.anim : null;
      const t = (now - state.t0) / 1000;
      // przechył kamery podczas rzutu (jakbyś leciał razem z bramkarzem)
      let tilt = 0;
      let shiftX = 0;
      if (a && state.marker) {
        const k = easeOut(seg(a.t, a.contactT - 0.02, a.contactT + 0.3)) * (1 - smooth(seg(a.t, 0.88, 1)) * 0.6);
        const side = Math.sign(state.marker.x - 400);
        tilt = side * 0.12 * k;
        shiftX = -side * 26 * k;
      }
      g.save();
      g.translate(400 + shiftX, 300);
      g.rotate(tilt);
      g.translate(-400, -300);
      g.drawImage(backdrop.save, -20, -20, W + 40, H + 40);
      const react = a && a.t > a.hitT + 0.08 ? { k: seg(a.t, a.hitT + 0.08, a.hitT + 0.35), joy: a.result === 'goal' } : null;
      const sp = shooterFront(a ? phase(a, 0.62) : 0, cam, react);
      if (!a) sp.lean = Math.sin(t) * 0.03;
      groundShadow(g, sp.x, sp.y + sp.h * 0.47, sp.h * 0.22);
      // piłka za strzelcem do momentu strzału
      const spot = cam.p(0, 0.11, SPOT);
      const ballR = spot.s * 0.11;
      if (!a || a.t < a.contactT) {
        groundShadow(g, spot.x, cam.p(0, 0, SPOT).y, ballR * 1.4, 0.45);
        drawBall(g, spot.x, spot.y, ballR, 0);
      }
      drawRig(g, sp, STYLE.shooterOp);
      g.restore();
      // rama bramki z bliska (słupki, poprzeczka, boczne siatki)
      const post = g.createLinearGradient(0, 0, 60, 0);
      post.addColorStop(0, '#8f9a95');
      post.addColorStop(0.55, '#ffffff');
      post.addColorStop(1, '#b3bdb8');
      g.fillStyle = post;
      g.fillRect(12, 28, 38, 532);
      g.save();
      g.translate(W, 0);
      g.scale(-1, 1);
      g.fillStyle = post;
      g.fillRect(12, 28, 38, 532);
      g.restore();
      const bar = g.createLinearGradient(0, 28, 0, 66);
      bar.addColorStop(0, '#ffffff');
      bar.addColorStop(1, '#aab4af');
      g.fillStyle = bar;
      g.fillRect(12, 28, W - 24, 36);
      g.strokeStyle = 'rgba(255,255,255,.16)';
      g.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        g.beginPath();
        g.moveTo(12 + i * 3, 64);
        g.lineTo(0, 64 + i * 46);
        g.moveTo(W - 12 - i * 3, 64);
        g.lineTo(W, 64 + i * 46);
        g.stroke();
      }
      // piłka w locie (przed ramą, rośnie w stronę kamery)
      if (a && a.t >= a.contactT) {
        const end = saveMap(a.kick.ball);
        let x, y, r;
        if (a.t <= a.hitT) {
          const f = seg(a.t, a.contactT, a.hitT);
          const e = f * f;
          x = lerp(spot.x, end.x, e);
          y = lerp(spot.y, end.y, e) - Math.sin(f * PI) * 40;
          r = lerp(ballR, 34, e);
        } else {
          const k = seg(a.t, a.hitT, 1);
          const side = end.x < 400 ? -1 : 1;
          if (a.result === 'save') {
            x = end.x + side * 170 * k;
            y = end.y - 160 * Math.sin(k * PI * 0.6);
            r = lerp(34, 24, k);
          } else if (a.result === 'post') {
            x = end.x - side * 140 * k;
            y = end.y + 90 * k;
            r = lerp(34, 28, k);
          } else {
            x = end.x + (end.x - 400) * 0.7 * k;
            y = end.y + (end.y - 300) * 0.35 * k;
            r = lerp(34, 66, k);
          }
        }
        drawBall(g, x, y, r, a.t * 18);
      }
      // znacznik miejsca rzutu
      if (state.marker) {
        const m = state.marker;
        const pulse = 0.5 + Math.sin(now / 160) * 0.5;
        const fade = a ? 1 - seg(a.t, a.contactT + 0.2, a.contactT + 0.4) : 1;
        if (fade > 0) {
          g.save();
          g.globalAlpha = fade;
          g.strokeStyle = '#ffd23f';
          g.lineWidth = 4;
          g.shadowColor = '#ffd23f';
          g.shadowBlur = 16;
          g.beginPath();
          g.arc(m.x, m.y, 40 + pulse * 6, 0, PI * 2);
          g.stroke();
          g.lineWidth = 2.5;
          g.beginPath();
          g.arc(m.x, m.y, 7, 0, PI * 2);
          g.moveTo(m.x - 18, m.y);
          g.lineTo(m.x - 11, m.y);
          g.moveTo(m.x + 11, m.y);
          g.lineTo(m.x + 18, m.y);
          g.stroke();
          g.restore();
        }
      } else if (!state.busy && state.aim && onPick) {
        g.strokeStyle = 'rgba(255,214,63,.55)';
        g.lineWidth = 3;
        g.setLineDash([8, 8]);
        g.beginPath();
        g.arc(state.aim.x, state.aim.y, 40, 0, PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      // rękawice: gotowość, potem rzut do znacznika (przy obronie dokładnie do piłki)
      const ready = { l: { x: 330, y: 455 }, r: { x: 470, y: 455 } };
      const breath = Math.sin(now / 380) * 4;
      let L = { x: ready.l.x, y: ready.l.y + breath };
      let R = { x: ready.r.x, y: ready.r.y + breath };
      let ang = 0;
      if (a && state.marker) {
        const k = easeOut(seg(a.t, a.contactT - 0.02, a.contactT + 0.3));
        const goal = a.result === 'save' ? saveMap(a.kick.ball) : state.marker;
        const side = Math.sign(goal.x - 400) || 1;
        ang = side * 0.45 * k;
        const gap = 40;
        L = { x: lerp(ready.l.x, goal.x - gap * Math.cos(ang), k), y: lerp(ready.l.y, goal.y - gap * Math.sin(ang), k) };
        R = { x: lerp(ready.r.x, goal.x + gap * Math.cos(ang), k), y: lerp(ready.r.y, goal.y + gap * Math.sin(ang), k) };
        if (k > 0.05 && k < 0.95) {
          g.globalAlpha = 0.16;
          drawGlove(g, lerp(ready.l.x, L.x, 0.55), lerp(ready.l.y, L.y, 0.55), 78, ang - 0.22, true);
          drawGlove(g, lerp(ready.r.x, R.x, 0.55), lerp(ready.r.y, R.y, 0.55), 78, ang + 0.22, false);
          g.globalAlpha = 1;
        }
      }
      // lewa dłoń od grzbietu: kciuk do środka; prawa lustrzanie
      drawGlove(g, L.x, L.y, 84, ang - 0.22, true);
      drawGlove(g, R.x, R.y, 84, ang + 0.22, false);
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
      g.translate(W / 2, 140);
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
      wait(view, cb) {
        state.view = view;
        state.marker = null;
        state.busy = false;
        onPick = cb;
      },
      show(view) {
        state.view = view;
        state.marker = null;
        state.busy = true;
        onPick = null;
      },
      play(kick) {
        state.busy = true;
        return new Promise((resolve) => {
          const mine = kick.side === 'my';
          state.anim = mine
            ? { kick, result: kick.result, start: performance.now(), dur: 3000, contactT: 0.38, hitT: 0.53, t: 0, done: resolve }
            : { kick, result: kick.result, start: performance.now(), dur: 3200, contactT: 0.5, hitT: 0.66, t: 0, done: resolve };
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
