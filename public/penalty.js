// Pojedynek rzutów karnych: scena na canvasie z postaciami szkieletowymi (ludziki) i animacją.
// Wynik każdego strzału liczy serwer; scena pokazuje animacje i zbiera kliknięcia.
// Układ bramki: x od -1 (lewy słupek) do 1 (prawy), y od 0 (murawa) do 1 (poprzeczka).
(() => {
  const W = 800;
  const H = 560;
  const PI = Math.PI;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

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

  // ---------- stroje ----------
  const STYLE = {
    keeper: { shirt: '#ff7a1a', sleeve: '#1d1d1f', shorts: '#1d1d1f', socks: '#ff7a1a', boots: '#111', skin: '#e9b892', hair: '#2a1a12', gloves: '#f4f7f2', num: '1', numColor: '#1d1d1f' },
    shooterOp: { shirt: '#7b3fe4', sleeve: '#7b3fe4', shorts: '#f2f2f2', socks: '#7b3fe4', boots: '#f5f5f5', skin: '#c98d66', hair: '#121212', num: '9', numColor: '#ffffff' },
    shooterMe: { shirt: '#b6f23a', sleeve: '#b6f23a', shorts: '#101410', socks: '#101410', boots: '#ff4d5e', skin: '#f0c4a2', hair: '#3a2416', num: '10', numColor: '#101410' },
  };

  // ---------- tło (stadion nocą), rysowane raz ----------
  function makeBackdrop(horizon, seed) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const r = seeded(seed);
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#020509');
    sky.addColorStop(1, '#0b1f17');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, horizon);
    // dach trybun
    g.fillStyle = '#05090b';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(W, 0);
    g.lineTo(W, 40);
    g.quadraticCurveTo(W / 2, 70, 0, 40);
    g.fill();
    // trybuny z kibicami
    for (let row = 0; row < 9; row++) {
      const y = horizon - 20 - row * 14;
      g.fillStyle = row % 2 ? '#0a1511' : '#0d1b15';
      g.fillRect(0, y, W, 14);
      for (let x = 0; x < W; x += 5) {
        if (r() < 0.8) {
          const hue = r();
          g.fillStyle = hue < 0.22 ? '#b6f23a' : hue < 0.36 ? '#7b3fe4' : hue < 0.5 ? '#e9eef0' : hue < 0.6 ? '#ff7a1a' : '#24392e';
          g.globalAlpha = 0.25 + r() * 0.5;
          g.beginPath();
          g.arc(x + r() * 3, y + 6 + r() * 4, 1.6, 0, PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    }
    // bandy reklamowe
    const ad = g.createLinearGradient(0, 0, W, 0);
    ad.addColorStop(0, '#0d2a17');
    ad.addColorStop(0.5, '#17532a');
    ad.addColorStop(1, '#0d2a17');
    g.fillStyle = ad;
    g.fillRect(0, horizon - 18, W, 18);
    g.fillStyle = '#b6f23a33';
    g.fillRect(0, horizon - 18, W, 2);
    g.font = '700 11px "Chakra Petch", sans-serif';
    g.fillStyle = '#b6f23a';
    for (let x = 18; x < W; x += 160) g.fillText('FOOTBALL STARS', x, horizon - 5);
    // jupitery z poświatą
    for (const fx of [80, W - 80]) {
      const glow = g.createRadialGradient(fx, 34, 0, fx, 34, 190);
      glow.addColorStop(0, 'rgba(225,255,235,.5)');
      glow.addColorStop(1, 'rgba(225,255,235,0)');
      g.fillStyle = glow;
      g.fillRect(fx - 190, 0, 380, 240);
      g.fillStyle = '#26302c';
      g.fillRect(fx - 30, 14, 60, 34);
      g.fillStyle = '#f6fff8';
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) g.fillRect(fx - 27 + i * 11, 17 + j * 10, 9, 8);
    }
    // murawa w pasy z perspektywą
    let y = horizon;
    let band = 7;
    let i = 0;
    while (y < H) {
      g.fillStyle = i % 2 ? '#1e7531' : '#238638';
      g.fillRect(0, y, W, band + 1);
      y += band;
      band *= 1.17;
      i++;
    }
    // faktura trawy
    for (let k = 0; k < 1800; k++) {
      const gy = horizon + r() * (H - horizon);
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)';
      g.fillRect(r() * W, gy, 1 + (gy - horizon) / 160, 1);
    }
    const shadeG = g.createLinearGradient(0, horizon, 0, H);
    shadeG.addColorStop(0, 'rgba(0,0,0,.4)');
    shadeG.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shadeG;
    g.fillRect(0, horizon, W, H - horizon);
    const vig = g.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.9);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
    return c;
  }

  // ---------- postać szkieletowa ----------
  // Kąty kończyn: 0 = w dół, dodatnie = w prawo ekranu (w układzie postaci).
  // pose: { x, y (miednica), h (wysokość), rot (obrót całej postaci), lean, head,
  //         aL1, aL2, aR1, aR2 (ramię, przedramię), lL1, lL2, lR1, lR2 (udo, łydka),
  //         foreL, foreR (skrócenie perspektywiczne nogi 0..1), back (widok od tyłu) }
  const P = { torso: 0.31, shoulder: 0.2, hip: 0.12, uArm: 0.165, fArm: 0.155, thigh: 0.245, shin: 0.235, head: 0.072 };
  const dir = (a) => [Math.sin(a), Math.cos(a)];

  function capsule(g, x1, y1, x2, y2, w1, w2, fill) {
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
  }

  function drawRig(g, pose, st) {
    const h = pose.h;
    g.save();
    g.translate(pose.x, pose.y);
    g.rotate(pose.rot || 0);
    const lean = pose.lean || 0;
    // punkty tułowia
    const sc = [Math.sin(lean) * P.torso * h, -Math.cos(lean) * P.torso * h];
    const px = Math.cos(lean);
    const py = Math.sin(lean);
    const shL = [sc[0] - (px * P.shoulder * h) / 2, sc[1] - (py * P.shoulder * h) / 2];
    const shR = [sc[0] + (px * P.shoulder * h) / 2, sc[1] + (py * P.shoulder * h) / 2];
    const hipL = [-(P.hip * h) / 2, 0];
    const hipR = [(P.hip * h) / 2, 0];
    const limb = (start, a1, a2, l1, l2, fore = 0) => {
      const [d1x, d1y] = dir(a1);
      const k1 = start[0] + d1x * l1 * h * (1 - fore * 0.55);
      const k2 = start[1] + d1y * l1 * h * (1 - fore * 0.55);
      const [d2x, d2y] = dir(a1 + a2);
      return [[k1, k2], [k1 + d2x * l2 * h * (1 - fore * 0.35), k2 + d2y * l2 * h * (1 - fore * 0.35)]];
    };
    const [kneeL, footL] = limb(hipL, pose.lL1, pose.lL2, P.thigh, P.shin, pose.foreL || 0);
    const [kneeR, footR] = limb(hipR, pose.lR1, pose.lR2, P.thigh, P.shin, pose.foreR || 0);
    const [elbL, handL] = limb(shL, pose.aL1, pose.aL2, P.uArm, P.fArm);
    const [elbR, handR] = limb(shR, pose.aR1, pose.aR2, P.uArm, P.fArm);
    const w = h * 0.046;
    // nogi: udo (skóra), łydka (getry), buty
    const leg = (hip, knee, foot) => {
      capsule(g, hip[0], hip[1], knee[0], knee[1], w * 1.15, w * 0.95, st.skin);
      capsule(g, knee[0], knee[1], foot[0], foot[1], w * 0.95, w * 0.75, st.socks);
      g.fillStyle = shade(st.socks, -0.25);
      g.fillRect(lerp(knee[0], foot[0], 0.2) - w, lerp(knee[1], foot[1], 0.2) - w * 0.25, w * 2, w * 0.5);
      g.fillStyle = st.boots;
      g.beginPath();
      g.ellipse(foot[0], foot[1] + w * 0.25, w * 1.25, w * 0.7, 0, 0, PI * 2);
      g.fill();
    };
    leg(hipL, kneeL, footL);
    leg(hipR, kneeR, footR);
    // spodenki
    g.fillStyle = st.shorts;
    g.beginPath();
    g.moveTo(hipL[0] - w * 1.6, -w * 1.4);
    g.lineTo(hipR[0] + w * 1.6, -w * 1.4);
    g.lineTo(lerp(hipR[0], kneeR[0], 0.38) + w * 1.3, lerp(hipR[1], kneeR[1], 0.38));
    g.lineTo(w * 0.2, w * 1.4);
    g.lineTo(lerp(hipL[0], kneeL[0], 0.38) - w * 1.3, lerp(hipL[1], kneeL[1], 0.38));
    g.closePath();
    g.fill();
    // tułów (koszulka)
    const grad = g.createLinearGradient(shL[0], shL[1], shR[0], 0);
    grad.addColorStop(0, shade(st.shirt, 0.12));
    grad.addColorStop(1, shade(st.shirt, -0.3));
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(shL[0] - w * 0.6, shL[1] - w * 0.3);
    g.quadraticCurveTo(sc[0], sc[1] - w * 1.4, shR[0] + w * 0.6, shR[1] - w * 0.3);
    g.lineTo(hipR[0] + w * 1.7, -w * 1.2);
    g.lineTo(hipL[0] - w * 1.7, -w * 1.2);
    g.closePath();
    g.fill();
    // numer
    g.save();
    g.translate(lerp(sc[0], 0, 0.45), lerp(sc[1], 0, 0.45));
    g.rotate(lean);
    g.fillStyle = st.numColor;
    g.font = `700 ${Math.round(h * (pose.back ? 0.13 : 0.075))}px "Chakra Petch", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(st.num, pose.back ? 0 : h * 0.045, pose.back ? 0 : -h * 0.06);
    g.restore();
    // ręce: rękaw, przedramię, dłoń / rękawica
    const arm = (sh, elb, hand) => {
      capsule(g, sh[0], sh[1], elb[0], elb[1], w * 1.05, w * 0.9, st.sleeve);
      capsule(g, elb[0], elb[1], hand[0], hand[1], w * 0.85, w * 0.7, st.sleeve === st.shirt && !st.gloves ? st.skin : st.sleeve);
      if (st.gloves) {
        g.fillStyle = st.gloves;
        g.beginPath();
        g.arc(hand[0], hand[1], w * 1.25, 0, PI * 2);
        g.fill();
        g.fillStyle = '#b6f23a';
        g.fillRect(hand[0] - w * 1.1, hand[1] - w * 0.25, w * 2.2, w * 0.5);
      } else {
        g.fillStyle = st.skin;
        g.beginPath();
        g.arc(hand[0], hand[1], w * 0.85, 0, PI * 2);
        g.fill();
      }
    };
    arm(shL, elbL, handL);
    arm(shR, elbR, handR);
    // szyja i głowa
    const hr = P.head * h;
    const hc = [sc[0] + Math.sin(lean + (pose.head || 0)) * hr * 1.35, sc[1] - Math.cos(lean + (pose.head || 0)) * hr * 1.35];
    capsule(g, sc[0], sc[1], hc[0], hc[1], w * 0.75, w * 0.7, st.skin);
    g.fillStyle = st.skin;
    g.beginPath();
    g.arc(hc[0], hc[1], hr, 0, PI * 2);
    g.fill();
    g.fillStyle = st.hair;
    g.beginPath();
    if (pose.back) g.arc(hc[0], hc[1] - hr * 0.05, hr * 1.02, PI * 0.95, PI * 2.05);
    else g.arc(hc[0], hc[1] - hr * 0.15, hr * 1.02, PI * 1.05, PI * 1.95);
    g.fill();
    if (pose.back) {
      g.fillRect(hc[0] - hr, hc[1] - hr * 0.2, hr * 2, hr * 0.7);
    } else {
      g.fillStyle = '#1a1a1a';
      g.beginPath();
      g.ellipse(hc[0] - hr * 0.35, hc[1] + hr * 0.05, hr * 0.12, hr * 0.17, 0, 0, PI * 2);
      g.ellipse(hc[0] + hr * 0.35, hc[1] + hr * 0.05, hr * 0.12, hr * 0.17, 0, 0, PI * 2);
      g.fill();
      g.strokeStyle = shade(st.skin, -0.35);
      g.lineWidth = Math.max(1, hr * 0.08);
      g.beginPath();
      g.moveTo(hc[0] - hr * 0.25, hc[1] + hr * 0.5);
      g.lineTo(hc[0] + hr * 0.25, hc[1] + hr * 0.5);
      g.stroke();
    }
    g.restore();
  }

  function shadow(g, x, y, rx) {
    g.fillStyle = 'rgba(0,0,0,.32)';
    g.beginPath();
    g.ellipse(x, y, rx, rx * 0.22, 0, 0, PI * 2);
    g.fill();
  }

  // ---------- pozy ----------
  function keeperIdle(t, x, groundY, h) {
    const bob = Math.abs(Math.sin(t * 5.2)) * 4;
    const sway = Math.sin(t * 1.4) * 9;
    return {
      x: x + sway, y: groundY - h * 0.45 + bob, h, rot: 0, lean: Math.sin(t * 1.4) * 0.04,
      lL1: -0.32, lL2: 0.22, lR1: 0.32, lR2: -0.22,
      aL1: -1.0 - Math.sin(t * 5.2) * 0.06, aL2: -0.5, aR1: 1.0 + Math.sin(t * 5.2) * 0.06, aR2: 0.5,
    };
  }
  // Rzut bramkarza do punktu (ekran), t = 0..1
  function keeperDive(t, x0, groundY, h, target) {
    const idle = keeperIdle(0, x0, groundY, h);
    const dx = target.x - x0;
    const center = Math.abs(dx) < h * 0.35;
    const side = Math.sign(dx) || 1;
    const high = clamp((groundY - target.y) / (h * 1.1), 0, 1);
    const crouch = seg(t, 0, 0.16);
    const fly = easeOut(seg(t, 0.14, 0.62));
    const fall = easeIn(seg(t, 0.62, 1));
    if (center) {
      // wyskok w górę z rękami nad głową
      const up = Math.sin(seg(t, 0.12, 0.85) * PI);
      return {
        ...idle, x: lerp(x0, target.x, fly), y: idle.y + crouch * 10 - up * (groundY - target.y - h * 0.55) * 0.9,
        lL1: -0.12, lL2: 0.1, lR1: 0.12, lR2: -0.1, aL1: lerp(-1, -2.85, fly), aL2: 0.1, aR1: lerp(1, 2.85, fly), aR2: -0.1,
      };
    }
    const rot = side * lerp(1.45, 0.82, high) * fly;
    const reach = (P.torso + P.uArm + P.fArm) * h * 0.92;
    const ex = target.x - Math.sin(rot) * reach;
    const ey = target.y + Math.cos(rot) * reach;
    const landY = groundY - h * 0.13;
    let x = lerp(x0, ex, fly);
    let y = lerp(idle.y + crouch * 12, ey, fly) - Math.sin(fly * PI) * 18;
    y = lerp(y, Math.max(y, landY), fall);
    x += side * fall * 10;
    const armsUp = side > 0 ? 1 : -1;
    return {
      x, y, h, rot, lean: 0,
      lL1: lerp(-0.32, -0.45 * armsUp - 0.1, fly), lL2: lerp(0.22, 0.4, fly),
      lR1: lerp(0.32, 0.2 * armsUp + 0.25, fly), lR2: lerp(-0.22, -0.5, fly),
      aL1: lerp(-1.0, -PI + 0.28, fly), aL2: lerp(-0.5, 0.05, fly),
      aR1: lerp(1.0, PI - 0.28, fly), aR2: lerp(0.5, -0.05, fly),
    };
  }
  // Strzelec przodem (widok z bramki): rozbieg, zamach, strzał, dobieg. t = 0..1, kontakt w t=0.62
  function shooterFront(t, from, ball, h, groundY) {
    const run = seg(t, 0, 0.56);
    const x = lerp(from.x, ball.x - h * 0.16, ease(run));
    const gy = lerp(from.y, groundY, ease(run));
    const scale = lerp(0.88, 1, ease(run));
    const ph = run * PI * 7;
    const stride = Math.sin(ph) * (1 - seg(t, 0.48, 0.56));
    const back = seg(t, 0.5, 0.6);
    const swing = seg(t, 0.58, 0.72);
    const follow = seg(t, 0.72, 1);
    const kick = back * (1 - swing) * -0.3 + swing * 1;
    const bob = Math.abs(Math.sin(ph)) * 5 * (1 - back);
    const hh = h * scale;
    return {
      x, y: gy - hh * 0.46 - bob, h: hh, rot: 0, lean: -0.08 * swing + 0.05 * stride,
      lL1: -0.12 + stride * 0.18, lL2: 0.1 + Math.max(0, -stride) * 0.6,
      lR1: 0.12 - stride * 0.18 + kick * 0.42 - follow * 0.2, lR2: -0.1 + Math.max(0, stride) * 0.6 + back * 0.9 - swing * 1.1,
      foreR: clamp(swing * 1.2 - follow * 0.6, 0, 1),
      aL1: -0.35 - stride * 0.5 - swing * 1.0, aL2: -0.4, aR1: 0.35 - stride * 0.5 + swing * 0.9, aR2: 0.4,
    };
  }
  // Mój strzelec tyłem (widok zza piłki). Kontakt w t=0.55
  function shooterBack(t, from, ball, h) {
    const run = seg(t, 0, 0.5);
    const x = lerp(from.x, ball.x - h * 0.2, ease(run));
    const gy = lerp(from.y, ball.y + h * 0.04, ease(run));
    const ph = run * PI * 6;
    const stride = Math.sin(ph) * (1 - seg(t, 0.42, 0.5));
    const swing = seg(t, 0.48, 0.62);
    const follow = seg(t, 0.62, 1);
    return {
      x, y: gy - h * 0.46 - Math.abs(Math.sin(ph)) * 6 * (1 - swing), h, rot: 0, back: true, lean: 0.12 * swing,
      lL1: -0.1 + stride * 0.2, lL2: 0.15 + Math.max(0, stride) * 0.5,
      lR1: 0.1 - stride * 0.2 + swing * 0.55 - follow * 0.2, lR2: -0.1 + Math.max(0, -stride) * 0.5 + (1 - swing) * 0.2,
      foreR: clamp(swing - follow * 0.5, 0, 1) * 0.8,
      aL1: -0.3 + stride * 0.5 - swing * 1.1, aL2: -0.3, aR1: 0.3 + stride * 0.5 + swing * 0.7, aR2: 0.3,
    };
  }

  // ---------- piłka ----------
  function drawBall(g, x, y, r, spin) {
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
    g.lineWidth = Math.max(0.6, r * 0.05);
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
    sh.addColorStop(0, 'rgba(255,255,255,.35)');
    sh.addColorStop(0.55, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(0,20,10,.45)');
    g.fillStyle = sh;
    g.beginPath();
    g.arc(0, 0, r, 0, PI * 2);
    g.fill();
    g.restore();
  }

  // ---------- realistyczna rękawica bramkarska (widok od strony grzbietu) ----------
  function drawGlove(g, x, y, s, angle, mirror) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.scale(mirror ? -s : s, s);
    // cień
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath();
    g.ellipse(0.06, 0.72, 0.5, 0.12, 0, 0, PI * 2);
    g.fill();
    // palce (od małego do wskazującego), lekko rozłożone
    const fingers = [
      { x: 0.3, len: 0.5, w: 0.15, a: 0.16 },
      { x: 0.1, len: 0.62, w: 0.165, a: 0.05 },
      { x: -0.1, len: 0.66, w: 0.17, a: -0.03 },
      { x: -0.3, len: 0.58, w: 0.165, a: -0.12 },
    ];
    for (const f of fingers) {
      g.save();
      g.translate(f.x, -0.05);
      g.rotate(f.a);
      const fg = g.createLinearGradient(-f.w, 0, f.w, 0);
      fg.addColorStop(0, '#d9ded8');
      fg.addColorStop(0.45, '#ffffff');
      fg.addColorStop(1, '#c4cbc4');
      g.fillStyle = fg;
      g.beginPath();
      g.roundRect(-f.w, -f.len, f.w * 2, f.len + 0.1, f.w);
      g.fill();
      g.strokeStyle = 'rgba(30,40,30,.35)';
      g.lineWidth = 0.018;
      g.stroke();
      // zgięcia palca
      g.strokeStyle = 'rgba(40,50,40,.25)';
      g.beginPath();
      g.moveTo(-f.w * 0.7, -f.len * 0.45);
      g.lineTo(f.w * 0.7, -f.len * 0.45);
      g.moveTo(-f.w * 0.7, -f.len * 0.75);
      g.lineTo(f.w * 0.7, -f.len * 0.75);
      g.stroke();
      g.restore();
    }
    // grzbiet dłoni
    const back = g.createLinearGradient(-0.45, -0.1, 0.45, 0.5);
    back.addColorStop(0, '#ffffff');
    back.addColorStop(1, '#cfd6cf');
    g.fillStyle = back;
    g.beginPath();
    g.moveTo(-0.46, -0.08);
    g.quadraticCurveTo(0, -0.2, 0.44, -0.08);
    g.quadraticCurveTo(0.5, 0.25, 0.4, 0.5);
    g.lineTo(-0.4, 0.5);
    g.quadraticCurveTo(-0.52, 0.25, -0.46, -0.08);
    g.fill();
    g.strokeStyle = 'rgba(30,40,30,.35)';
    g.lineWidth = 0.02;
    g.stroke();
    // panel i logo
    g.fillStyle = '#121a14';
    g.beginPath();
    g.moveTo(-0.32, 0.02);
    g.quadraticCurveTo(0, -0.06, 0.32, 0.02);
    g.lineTo(0.26, 0.34);
    g.lineTo(-0.26, 0.34);
    g.closePath();
    g.fill();
    g.strokeStyle = '#b6f23a';
    g.lineWidth = 0.055;
    g.beginPath();
    g.moveTo(-0.2, 0.26);
    g.quadraticCurveTo(0, 0.02, 0.2, 0.1);
    g.stroke();
    // kciuk (po wewnętrznej stronie)
    g.save();
    g.translate(-0.48, 0.22);
    g.rotate(-0.85);
    g.fillStyle = '#e9ede8';
    g.beginPath();
    g.roundRect(-0.12, -0.42, 0.24, 0.48, 0.12);
    g.fill();
    g.strokeStyle = 'rgba(30,40,30,.35)';
    g.lineWidth = 0.018;
    g.stroke();
    g.restore();
    // mankiet z rzepem
    g.fillStyle = '#111613';
    g.beginPath();
    g.roundRect(-0.43, 0.46, 0.86, 0.3, 0.06);
    g.fill();
    g.fillStyle = '#b6f23a';
    g.fillRect(-0.43, 0.56, 0.86, 0.07);
    g.fillStyle = '#2a332d';
    g.beginPath();
    g.roundRect(-0.38, 0.49, 0.5, 0.24, 0.05);
    g.fill();
    // połysk lateksu
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    g.ellipse(0.15, -0.35, 0.05, 0.16, 0.1, 0, PI * 2);
    g.fill();
    g.restore();
  }
  function forearm(g, from, to, w) {
    const sl = g.createLinearGradient(from.x, from.y, to.x, to.y);
    sl.addColorStop(0, '#0f2418');
    sl.addColorStop(1, '#1f4a2f');
    capsule(g, from.x, from.y, to.x, to.y, w * 1.25, w, sl);
    g.strokeStyle = 'rgba(182,242,58,.6)';
    g.lineWidth = w * 0.18;
    g.beginPath();
    g.moveTo(lerp(from.x, to.x, 0.3), lerp(from.y, to.y, 0.3));
    g.lineTo(lerp(from.x, to.x, 0.9), lerp(from.y, to.y, 0.9));
    g.stroke();
  }

  // ---------- scena ----------
  function PenaltyScene(canvas) {
    const g = canvas.getContext('2d');
    const state = { view: 'shoot', aim: null, busy: false, anim: null, particles: [], text: null, shake: 0, marker: null, idleT0: performance.now() };
    const back = { shoot: makeBackdrop(250, 7), save: makeBackdrop(250, 11) };
    let onPick = null;
    let raf = 0;

    // mapowanie bramki na ekran
    const GOAL = { shoot: { cx: 400, gy: 352, hw: 205, hh: 150 }, save: { cx: 400, gy: 520, hw: 350, hh: 455 } };
    const map = (v, p) => ({ x: GOAL[v].cx + p.x * GOAL[v].hw, y: GOAL[v].gy - p.y * GOAL[v].hh });
    const unmap = (v, sx, sy) => ({ x: (sx - GOAL[v].cx) / GOAL[v].hw, y: (GOAL[v].gy - sy) / GOAL[v].hh });

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
      const goal = unmap(state.view, p.x, p.y);
      if (state.view === 'save') state.marker = { x: p.x, y: p.y, at: performance.now() };
      const cb = onPick;
      onPick = null;
      cb({ x: +goal.x.toFixed(3), y: +goal.y.toFixed(3) });
    });

    // Czas animacji postaci: do kontaktu z piłką (k = moment kontaktu w pozie), potem dobieg.
    const phase = (a, k) => (a.t < a.contactT ? (a.t / a.contactT) * k : k + seg(a.t, a.contactT, 1) * (1 - k));

    // ---------- bramka od przodu (widok strzału) ----------
    function drawGoal(bulge) {
      const L = 195, R = 605, T = 202, B = 352, bl = 226, br = 574, bt = 216, bb = 328;
      g.strokeStyle = 'rgba(235,245,240,.4)';
      g.lineWidth = 1;
      const net = (x, y) => {
        if (!bulge) return [x, y];
        const d = Math.hypot(x - bulge.x, y - bulge.y);
        const f = Math.max(0, 1 - d / 95) * bulge.k;
        return [x + ((x - bulge.x) / (d || 1)) * f * 0.35, y - f * 0.35 + ((y - bulge.y) / (d || 1)) * f * 0.2];
      };
      for (let i = 0; i <= 28; i++) {
        g.beginPath();
        for (let j = 0; j <= 12; j++) {
          const [px, py] = net(lerp(bl, br, i / 28), lerp(bt, bb, j / 12));
          j ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
      }
      for (let j = 0; j <= 12; j++) {
        g.beginPath();
        for (let i = 0; i <= 28; i++) {
          const [px, py] = net(lerp(bl, br, i / 28), lerp(bt, bb, j / 12));
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
      }
      for (let j = 0; j <= 9; j++) {
        g.beginPath();
        g.moveTo(L, lerp(T, B, j / 9));
        g.lineTo(bl, lerp(bt, bb, j / 9));
        g.moveTo(R, lerp(T, B, j / 9));
        g.lineTo(br, lerp(bt, bb, j / 9));
        g.stroke();
      }
      for (let i = 0; i <= 18; i++) {
        g.beginPath();
        g.moveTo(lerp(L, R, i / 18), T);
        g.lineTo(lerp(bl, br, i / 18), bt);
        g.stroke();
      }
      g.strokeStyle = 'rgba(200,210,205,.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(L, B);
      g.lineTo(bl, bb);
      g.lineTo(br, bb);
      g.lineTo(R, B);
      g.stroke();
      g.save();
      g.shadowColor = 'rgba(0,0,0,.6)';
      g.shadowBlur = 8;
      const post = g.createLinearGradient(L - 5, 0, L + 5, 0);
      post.addColorStop(0, '#c9d1cd');
      post.addColorStop(0.5, '#ffffff');
      post.addColorStop(1, '#b9c2be');
      g.strokeStyle = '#f4f7f5';
      g.lineWidth = 10;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(L, B + 3);
      g.lineTo(L, T);
      g.lineTo(R, T);
      g.lineTo(R, B + 3);
      g.stroke();
      g.restore();
    }

    function drawPitchLinesShoot() {
      g.strokeStyle = 'rgba(255,255,255,.78)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 352);
      g.lineTo(W, 352);
      g.moveTo(80, 352);
      g.lineTo(-60, 480);
      g.moveTo(720, 352);
      g.lineTo(860, 480);
      g.moveTo(258, 352);
      g.lineTo(226, 394);
      g.lineTo(574, 394);
      g.lineTo(542, 352);
      g.stroke();
      g.beginPath();
      g.ellipse(400, 512, 9, 3.6, 0, 0, PI * 2);
      g.fillStyle = '#fff';
      g.fill();
    }

    // ---------- widok: strzał ----------
    function drawShoot(now) {
      g.drawImage(back.shoot, 0, 0);
      drawPitchLinesShoot();
      const a = state.anim && state.anim.kick.side === 'my' ? state.anim : null;
      const t = (now - state.idleT0) / 1000;
      const ballLand = a ? map('shoot', a.kick.ball) : null;
      // siatka z wybrzuszeniem po golu
      let bulge = null;
      if (a && a.result === 'goal' && a.t > a.hitT) bulge = { ...ballLand, k: Math.sin(seg(a.t, a.hitT, a.hitT + 0.3) * PI) * 16 };
      drawGoal(bulge);
      // bramkarz rywala
      const kh = 168;
      let pose;
      if (a) {
        const diveT = seg(a.t, a.contactT - 0.04, a.contactT + 0.42);
        const target = map('shoot', a.kick.dive);
        pose = diveT > 0 ? keeperDive(diveT, 400 + Math.sin(t * 1.4) * 9, 352, kh, target) : keeperIdle(t, 400, 352, kh);
      } else pose = keeperIdle(t, 400, 352, kh);
      shadow(g, pose.x, 354, 34);
      drawRig(g, pose, STYLE.keeper);
      // piłka i strzelec
      const ballStart = { x: 400, y: 500 };
      if (a) drawShotBall(a, ballStart, ballLand);
      else drawBall(g, ballStart.x, ballStart.y, 15, 0);
      drawRig(g, shooterBack(a ? phase(a, 0.55) : 0, { x: 300, y: 590 }, ballStart, 250), STYLE.shooterMe);
      // celownik
      if (!state.busy && state.aim && onPick) {
        const { x, y } = state.aim;
        g.save();
        g.strokeStyle = '#b6f23a';
        g.lineWidth = 2.5;
        g.shadowColor = '#b6f23a';
        g.shadowBlur = 12;
        g.beginPath();
        g.arc(x, y, 16, 0, PI * 2);
        g.moveTo(x - 25, y);
        g.lineTo(x - 8, y);
        g.moveTo(x + 8, y);
        g.lineTo(x + 25, y);
        g.moveTo(x, y - 25);
        g.lineTo(x, y - 8);
        g.moveTo(x, y + 8);
        g.lineTo(x, y + 25);
        g.stroke();
        g.restore();
      }
    }

    function drawShotBall(a, start, end) {
      let x, y, r;
      if (a.t < a.contactT) {
        x = start.x;
        y = start.y;
        r = 15;
      } else if (a.t <= a.hitT) {
        const e = ease(seg(a.t, a.contactT, a.hitT));
        const cx = (start.x + end.x) / 2;
        const cy = Math.min(start.y, end.y) - 70;
        x = (1 - e) * (1 - e) * start.x + 2 * (1 - e) * e * cx + e * e * end.x;
        y = (1 - e) * (1 - e) * start.y + 2 * (1 - e) * e * cy + e * e * end.y;
        r = lerp(15, 6.5, e);
      } else {
        const k = seg(a.t, a.hitT, 1);
        const side = end.x < 400 ? -1 : 1;
        if (a.result === 'save') {
          x = end.x + side * 170 * k;
          y = end.y - 80 * Math.sin(k * PI) + 150 * k;
          r = lerp(6.5, 8.5, k);
        } else if (a.result === 'post') {
          const top = a.kick.ball.y > 1;
          x = end.x + (top ? side * 40 : -side * 60) * k;
          y = end.y + (top ? -60 : 30) * Math.sin(k * PI) + 120 * k;
          r = lerp(6.5, 8, k);
        } else if (a.result === 'miss') {
          x = end.x + (end.x - 400) * 0.35 * k;
          y = end.y - 50 * k;
          r = lerp(6.5, 4.5, k);
        } else {
          x = end.x;
          y = lerp(end.y, 335, easeIn(k));
          r = 6.5 - k * 0.8;
        }
      }
      const shadowY = a.t < a.contactT ? 512 : lerp(512, 352, ease(seg(a.t, a.contactT, a.hitT)));
      g.fillStyle = 'rgba(0,0,0,.3)';
      g.beginPath();
      g.ellipse(x, shadowY, r * 0.95, r * 0.3, 0, 0, PI * 2);
      g.fill();
      drawBall(g, x, y, r, a.t * 22);
    }

    // ---------- widok: obrona (z bramki) ----------
    function drawSave(now) {
      g.drawImage(back.save, 0, 0);
      g.strokeStyle = 'rgba(255,255,255,.72)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(130, 250);
      g.lineTo(670, 250);
      g.moveTo(130, 250);
      g.lineTo(-80, 560);
      g.moveTo(670, 250);
      g.lineTo(880, 560);
      g.moveTo(296, 250);
      g.lineTo(246, 332);
      g.lineTo(554, 332);
      g.lineTo(504, 250);
      g.stroke();
      g.beginPath();
      g.ellipse(400, 302, 6, 2.2, 0, 0, PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      const a = state.anim && state.anim.kick.side === 'op' ? state.anim : null;
      const t = (now - state.idleT0) / 1000;
      const ball = { x: 400, y: 300 };
      // strzelec rywala
      const from = { x: 330, y: 278 };
      const sp = a ? shooterFront(phase(a, 0.62), from, ball, 110, 300) : { ...shooterFront(0, from, ball, 110, 300), lean: Math.sin(t) * 0.03 };
      shadow(g, sp.x, sp.y + sp.h * 0.46, 16);
      drawRig(g, sp, STYLE.shooterOp);
      // piłka
      if (a) drawIncomingBall(a, ball);
      else drawBall(g, ball.x, ball.y, 5.2, 0);
      // rama bramki z bliska + boczna siatka
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
      g.strokeStyle = 'rgba(255,255,255,.14)';
      g.lineWidth = 1;
      for (let i = 0; i < 10; i++) {
        g.beginPath();
        g.moveTo(12 + i * 3, 64);
        g.lineTo(0, 64 + i * 55);
        g.moveTo(W - 12 - i * 3, 64);
        g.lineTo(W, 64 + i * 55);
        g.stroke();
      }
      // znacznik miejsca rzutu
      if (state.marker) {
        const m = state.marker;
        const p = 0.5 + Math.sin(now / 160) * 0.5;
        g.save();
        g.strokeStyle = `rgba(255,214,63,${0.55 + p * 0.4})`;
        g.lineWidth = 4;
        g.shadowColor = '#ffd23f';
        g.shadowBlur = 14;
        g.beginPath();
        g.arc(m.x, m.y, 42 + p * 6, 0, PI * 2);
        g.stroke();
        g.lineWidth = 2;
        g.beginPath();
        g.arc(m.x, m.y, 8, 0, PI * 2);
        g.stroke();
        g.restore();
      } else if (!state.busy && state.aim && onPick) {
        g.strokeStyle = 'rgba(255,214,63,.5)';
        g.lineWidth = 3;
        g.setLineDash([8, 8]);
        g.beginPath();
        g.arc(state.aim.x, state.aim.y, 42, 0, PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
      // moje ręce i rękawice: gotowość, potem rzut do znacznika
      let lh = { x: 318, y: 452 };
      let rh = { x: 482, y: 452 };
      let ang = 0;
      const breath = Math.sin(now / 380) * 4;
      if (a && state.marker) {
        const k = easeOut(seg(a.t, a.contactT - 0.02, a.contactT + 0.3));
        const m = state.marker;
        const side = Math.sign(m.x - 400);
        ang = side * 0.5 * k;
        lh = { x: lerp(318, m.x - 44, k), y: lerp(452, m.y + 6 * side, k) };
        rh = { x: lerp(482, m.x + 44, k), y: lerp(452, m.y - 6 * side, k) };
        if (k > 0 && k < 1) {
          g.globalAlpha = 0.18;
          drawGlove(g, lerp(318, lh.x, 0.6), lerp(452, lh.y, 0.6), 76, ang - 0.25, true);
          drawGlove(g, lerp(482, rh.x, 0.6), lerp(452, rh.y, 0.6), 76, ang + 0.25, false);
          g.globalAlpha = 1;
        }
      } else {
        lh.y += breath;
        rh.y += breath;
      }
      forearm(g, { x: 150, y: 600 }, { x: lh.x - 6, y: lh.y + 52 }, 26);
      forearm(g, { x: 650, y: 600 }, { x: rh.x + 6, y: rh.y + 52 }, 26);
      // lewa dłoń od strony grzbietu: kciuk do środka (w prawo), mały palec na zewnątrz
      drawGlove(g, lh.x, lh.y, 82, ang - 0.25, true);
      drawGlove(g, rh.x, rh.y, 82, ang + 0.25, false);
    }

    function drawIncomingBall(a, start) {
      const end = map('save', a.kick.ball);
      let x, y, r;
      if (a.t < a.contactT) return drawBall(g, start.x, start.y, 5.2, 0);
      if (a.t <= a.hitT) {
        const f = seg(a.t, a.contactT, a.hitT);
        const e = f * f;
        x = lerp(start.x, end.x, e);
        y = lerp(start.y, end.y, e) - Math.sin(f * PI) * 46;
        r = lerp(5.2, 36, e);
      } else {
        const k = seg(a.t, a.hitT, 1);
        const side = end.x < 400 ? -1 : 1;
        if (a.result === 'save') {
          x = end.x + side * 150 * k;
          y = end.y - 150 * k;
          r = lerp(36, 26, k);
        } else if (a.result === 'post') {
          x = end.x - side * 120 * k;
          y = end.y + 80 * k;
          r = lerp(36, 30, k);
        } else {
          x = end.x + (end.x - 400) * 0.6 * k;
          y = end.y + (end.y - 300) * 0.3 * k;
          r = lerp(36, 64, k);
        }
      }
      drawBall(g, x, y, r, a.t * 16);
    }

    // ---------- efekty ----------
    function burst(x, y, color) {
      for (let i = 0; i < 80; i++) {
        const an = Math.random() * PI * 2;
        const v = 2 + Math.random() * 6.5;
        state.particles.push({ x, y, vx: Math.cos(an) * v, vy: Math.sin(an) * v - 3, life: 1, c: Math.random() < 0.5 ? color : '#ffffff', s: 2 + Math.random() * 4 });
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
      if (!state.text) return;
      const t = (now - state.text.at) / 1500;
      if (t > 1) {
        state.text = null;
        return;
      }
      const sc = t < 0.14 ? lerp(0.4, 1.15, t / 0.14) : t < 0.24 ? lerp(1.15, 1, (t - 0.14) / 0.1) : 1;
      g.save();
      g.globalAlpha = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      g.translate(W / 2, 150);
      g.scale(sc, sc);
      g.font = '700 80px "Chakra Petch", sans-serif';
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
      const p = map(state.view, a.kick.ball);
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
        state.shake = 9;
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
      // widok 'shoot' (strzelasz) albo 'save' (bronisz); cb dostaje wybrany punkt bramki
      wait(view, cb) {
        state.view = view;
        state.marker = null;
        state.busy = false;
        onPick = cb;
      },
      // pokazuje widok bez czekania na kliknięcie (np. przed losowaniem)
      show(view) {
        state.view = view;
        state.marker = null;
        state.busy = true;
        onPick = null;
      },
      // animacja wyniku zwróconego przez serwer
      play(kick) {
        state.busy = true;
        return new Promise((resolve) => {
          const mine = kick.side === 'my';
          state.anim = mine
            ? { kick, result: kick.result, start: performance.now(), dur: 2600, contactT: 0.36, hitT: 0.56, t: 0, done: resolve }
            : { kick, result: kick.result, start: performance.now(), dur: 3000, contactT: 0.5, hitT: 0.7, t: 0, done: resolve };
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
