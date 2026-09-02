import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const $ = s => document.querySelector(s);
const F = window.Fair;

// ── engine (identical to the reference sim that fixed RTP at ~1% edge) ──────────
const W = 5, H = 5, N = W * H, MINCLUST = 4, MAXCASC = 20, MAXWIN = 5000;
const WEIGHTS = [28, 24, 20, 16, 11, 7];
const BASEPAY = [0.1112, 0.1779, 0.2891, 0.5338, 1.1121, 2.6690];
const CASC = [1, 2, 3, 5, 8, 12];
const SYM = [
    { name: 'bubble', col: '#3fb7e8' },
    { name: 'kelp', col: '#3fd17c' },
    { name: 'star', col: '#f2a413' },
    { name: 'shell', col: '#e87fb0' },
    { name: 'pearl', col: '#e7edf5' },
    { name: 'ruby', col: '#ff4d5e' },
];
function sizeMult(sz) {
    if (sz <= 4) return 1; if (sz === 5) return 1.8; if (sz === 6) return 3; if (sz === 7) return 5; if (sz === 8) return 8;
    if (sz <= 10) return 8 + (sz - 8) * 6; if (sz <= 14) return 20 + (sz - 10) * 10; return 60 + (sz - 14) * 20;
}
const cascMult = step => CASC[Math.min(step, 5)];
const pay = (sym, sz) => BASEPAY[sym] * sizeMult(sz);

function findClusters(g) {
    const seen = new Array(N).fill(false), res = [];
    for (let i = 0; i < N; i++) {
        if (seen[i] || g[i] < 0) continue;
        const sym = g[i], st = [i], cells = []; seen[i] = true;
        while (st.length) {
            const c = st.pop(); cells.push(c); const r = (c / W) | 0, col = c % W, nb = [];
            if (r > 0) nb.push(c - W); if (r < H - 1) nb.push(c + W); if (col > 0) nb.push(c - 1); if (col < W - 1) nb.push(c + 1);
            for (const nn of nb) if (!seen[nn] && g[nn] === sym) { seen[nn] = true; st.push(nn); }
        }
        if (cells.length >= MINCLUST) res.push({ sym, cells });
    }
    return res;
}
function gravity(g, refill) {
    for (let col = 0; col < W; col++) {
        const keep = [];
        for (let r = H - 1; r >= 0; r--) { const idx = r * W + col; if (g[idx] >= 0) keep.push(g[idx]); }
        for (let r = H - 1, k = 0; r >= 0; r--) { const idx = r * W + col; g[idx] = k < keep.length ? keep[k++] : refill(); }
    }
}
async function computeSpin(ss, cs, n) {
    const stream = await F.slotStream(ss, cs, n, WEIGHTS, 525);
    let si = 0; const take = () => stream[si++];
    const grid = []; for (let i = 0; i < N; i++) grid.push(take());
    const initial = grid.slice(), steps = []; let step = 0, totalWin = 0;
    while (step < MAXCASC) {
        const cl = findClusters(grid); if (!cl.length) break;
        let sw = 0; for (const c of cl) { sw += pay(c.sym, c.cells.length); for (const x of c.cells) grid[x] = -1; }
        const mult = cascMult(step), stepWin = sw * mult; totalWin += stepWin;
        gravity(grid, take);
        steps.push({ clusters: cl, stepWin, mult, after: grid.slice() });
        step++;
    }
    return { initial, steps, totalWin: Math.min(totalWin, MAXWIN) };
}

const state = { serverSeed: null, commit: null, nonce: 0, balance: 1000, spinning: false, rounds: [] };

// ── three.js ───────────────────────────────────────────────────────────────────
const cv = $('#cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const camBase = new THREE.Vector3(0, 0.4, 9.2);
camera.position.copy(camBase); camera.lookAt(0, 0, 0);
let rect;
function resize() {
    rect = cv.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
}
resize(); addEventListener('resize', resize);

scene.add(new THREE.AmbientLight(0xdfe8ff, 0.9));
const key = new THREE.DirectionalLight(0xfff2d8, 1.25);
key.position.set(3, 6, 8); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 30;
key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
key.shadow.bias = -0.0004; scene.add(key);
scene.add(new THREE.DirectionalLight(0x48d3e6, 0.4).translateZ(0));

const CELL = 1.16;
const back = new THREE.Mesh(new RoundedBoxGeometry(W * CELL + 0.5, H * CELL + 0.5, 0.5, 6, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x0a1420, roughness: 0.95 }));
back.position.z = -0.5; back.receiveShadow = true; scene.add(back);

function cellPos(i) { const r = (i / W) | 0, c = i % W; return { x: (c - (W - 1) / 2) * CELL, y: ((H - 1) / 2 - r) * CELL }; }

// symbol textures
const texCache = {};
function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
function star(x, cx, cy, n, ro, ri) { x.beginPath(); for (let k = 0; k < 2 * n; k++) { const rr = k % 2 ? ri : ro, a = k * Math.PI / n - Math.PI / 2; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; k ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); }
function symTexture(i) {
    if (texCache[i]) return texCache[i];
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
    roundRect(x, 8, 8, s - 16, s - 16, 22); x.fillStyle = SYM[i].col; x.fill();
    const g = x.createLinearGradient(0, 8, 0, s - 8); g.addColorStop(0, 'rgba(255,255,255,.30)'); g.addColorStop(.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
    roundRect(x, 8, 8, s - 16, s - 16, 22); x.fillStyle = g; x.fill();
    const cx = s / 2, cy = s / 2, R = 30, white = 'rgba(255,255,255,.95)';
    x.fillStyle = white; x.strokeStyle = white; x.lineWidth = 8; x.lineJoin = 'round'; x.lineCap = 'round';
    if (i === 0) { x.beginPath(); x.arc(cx, cy, R, 0, 7); x.stroke(); x.beginPath(); x.arc(cx - R * .35, cy - R * .35, R * .16, 0, 7); x.fill(); }
    else if (i === 1) { x.beginPath(); for (let t = -1; t <= 1.001; t += 0.04) { const yy = cy + t * R * 1.15, xx = cx + Math.sin(t * Math.PI * 2) * R * 0.5; t === -1 ? x.moveTo(xx, yy) : x.lineTo(xx, yy); } x.stroke(); }
    else if (i === 2) { star(x, cx, cy, 5, R, R * 0.45); x.fill(); }
    else if (i === 3) { for (let k = 0; k < 3; k++) { x.beginPath(); x.arc(cx, cy + R * 0.6, R * (0.45 + k * 0.32), Math.PI * 1.18, Math.PI * 1.82); x.stroke(); } }
    else if (i === 4) { x.beginPath(); x.arc(cx, cy, R * 0.82, 0, 7); x.fill(); }
    else { x.beginPath(); x.moveTo(cx, cy - R); x.lineTo(cx + R * 0.78, cy); x.lineTo(cx, cy + R); x.lineTo(cx - R * 0.78, cy); x.closePath(); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; texCache[i] = t; return t;
}

const tileGeo = new RoundedBoxGeometry(1.02, 1.02, 0.42, 4, 0.12);
const pool = [];
function makeSym(sym) {
    const o = pool.pop() || { mesh: new THREE.Mesh(tileGeo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0 })) };
    o.mesh.material.map = symTexture(sym); o.mesh.material.needsUpdate = true;
    o.mesh.castShadow = true; o.mesh.visible = true; o.sym = sym; o.pulse = false; o.ts = 1;
    if (!o.mesh.parent) scene.add(o.mesh);
    return o;
}
function setSym(o, sym) { if (o.sym !== sym) { o.sym = sym; o.mesh.material.map = symTexture(sym); o.mesh.material.needsUpdate = true; } }
function freeSym(o) { o.mesh.visible = false; o.pulse = false; pool.push(o); }
const board = new Array(N).fill(null);
const dying = [];
function clearBoard() { for (let i = 0; i < N; i++) { if (board[i]) freeSym(board[i]); board[i] = null; } for (const o of dying) freeSym(o); dying.length = 0; }

// ── particles ────────────────────────────────────────────────────────────────
const partGeo = new THREE.TetrahedronGeometry(0.12);
const particles = [];
for (let i = 0; i < 90; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshStandardMaterial({ emissiveIntensity: 0.7, roughness: 0.5 }));
    m.visible = false; scene.add(m); particles.push({ m, life: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0 });
}
function burst(x, y, col) {
    let n = 0;
    for (const p of particles) {
        if (p.life > 0) continue;
        p.m.position.set(x, y, 0.3); p.m.material.color.set(col); p.m.material.emissive.set(col);
        const a = Math.random() * 6.28, sp = 1.6 + Math.random() * 3;
        p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp + 1.2; p.vz = (Math.random() - 0.5) * 2;
        p.rx = (Math.random() - 0.5) * 0.5; p.ry = (Math.random() - 0.5) * 0.5;
        p.life = 1; p.m.visible = true; p.m.scale.setScalar(1);
        if (++n >= 8) break;
    }
}

// ── audio ────────────────────────────────────────────────────────────────────
let AC = null, master = null;
function audio() { if (AC) { if (AC.state === 'suspended') AC.resume(); return; } AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.5; master.connect(AC.destination); }
function blip(freq, dur = 0.08, vol = 0.08, type = 'sine', slideTo = null) {
    if (!AC) return; const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
const sSpin = () => blip(220, 0.18, 0.06, 'sawtooth', 480);
const sLand = () => blip(200 + Math.random() * 80, 0.05, 0.03, 'sine');
const sPop = step => { const f = 440 + step * 90; blip(f, 0.1, 0.09, 'triangle', f * 1.6); };
const sCascade = step => [0, 1, 2].forEach(k => setTimeout(() => blip(520 + step * 80 + k * 130, 0.12, 0.06, 'sine'), k * 45));
const sWin = big => { const seq = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784]; seq.forEach((f, i) => setTimeout(() => blip(f, 0.16, 0.1, 'sine'), i * 80)); };

// ── float win ──────────────────────────────────────────────────────────────────
const _v = new THREE.Vector3();
function floatMoney(amount) {
    _v.set(0, (H - 1) / 2 * CELL + 0.6, 0.5).project(camera);
    const sx = (_v.x * 0.5 + 0.5) * rect.width, sy = (-_v.y * 0.5 + 0.5) * rect.height;
    const el = document.createElement('div'); el.className = 'float-money';
    el.textContent = '+' + amount.toFixed(2); el.style.left = sx + 'px'; el.style.top = sy + 'px';
    $('#stage').appendChild(el); setTimeout(() => el.remove(), 1500);
}
function showMult(m) {
    const el = $('#mult'); el.textContent = '×' + m;
    el.style.transition = 'none'; el.style.opacity = '0'; el.style.transform = 'translate(-50%,-50%) scale(.5)';
    requestAnimationFrame(() => { el.style.transition = 'opacity .12s, transform .3s'; el.style.opacity = '1'; el.style.transform = 'translate(-50%,-50%) scale(1.15)'; });
    setTimeout(() => { el.style.opacity = '0'; }, 520);
}

// ── render loop ──────────────────────────────────────────────────────────────
function frame() {
    for (let i = 0; i < N; i++) {
        const o = board[i]; if (!o) continue;
        const p = o.tp;
        o.mesh.position.x += (p.x - o.mesh.position.x) * 0.2;
        o.mesh.position.y += (p.y - o.mesh.position.y) * 0.2;
        o.mesh.position.z += (0.15 - o.mesh.position.z) * 0.2;
        const s = o.mesh.scale.x + (o.ts - o.mesh.scale.x) * 0.25; o.mesh.scale.setScalar(s);
        o.mesh.material.emissiveIntensity += ((o.pulse ? 0.6 : 0) - o.mesh.material.emissiveIntensity) * 0.18;
    }
    for (let i = dying.length - 1; i >= 0; i--) {
        const o = dying[i]; const s = o.mesh.scale.x * 0.78; o.mesh.scale.setScalar(s);
        if (s < 0.06) { freeSym(o); dying.splice(i, 1); }
    }
    const dt = 0.016;
    for (const p of particles) {
        if (p.life <= 0) continue;
        p.vy -= 9 * dt; p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
        p.m.rotation.x += p.rx; p.m.rotation.y += p.ry; p.life -= dt * 1.4; p.m.scale.setScalar(Math.max(0.001, p.life));
        if (p.life <= 0) { p.life = 0; p.m.visible = false; }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
}

// ── spin orchestration ─────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function dropIn(syms) {
    clearBoard();
    for (let i = 0; i < N; i++) {
        const o = makeSym(syms[i]); const p = cellPos(i);
        o.mesh.position.set(p.x, p.y + 6, 0.15); o.mesh.scale.setScalar(1);
        o.tp = { x: p.x, y: p.y }; o.ts = 1; board[i] = o;
    }
}
function highlight(clusters, on) { for (const c of clusters) for (const cell of c.cells) if (board[cell]) board[cell].pulse = on; }
function explode(clusters) {
    for (const c of clusters) for (const cell of c.cells) {
        const o = board[cell]; if (!o) continue;
        const p = cellPos(cell); burst(p.x, p.y, SYM[c.sym].col);
        o.ts = 0; o.pulse = false; dying.push(o); board[cell] = null;
    }
}
function settle(after) {
    for (let c = 0; c < W; c++) {
        const surv = [];
        for (let r = H - 1; r >= 0; r--) { const cell = r * W + c; if (board[cell]) { surv.push(board[cell]); board[cell] = null; } }
        let rr = H - 1;
        for (const o of surv) { const cell = rr * W + c; board[cell] = o; setSym(o, after[cell]); o.tp = cellPos(cell); rr--; }
        for (; rr >= 0; rr--) {
            const cell = rr * W + c; const o = makeSym(after[cell]); const p = cellPos(cell);
            o.mesh.position.set(p.x, p.y + (rr + 2) * CELL + 3, 0.15); o.mesh.scale.setScalar(1);
            o.tp = { x: p.x, y: p.y }; o.ts = 1; board[cell] = o;
        }
    }
}

async function doSpin() {
    if (state.spinning) return;
    audio();
    const bet = Math.max(1, +$('#bet').value || 0);
    if (bet > state.balance) { $('#res').textContent = 'LOW'; $('#res').className = 'lose'; $('#reslab').textContent = 'NOT ENOUGH BALANCE'; return; }
    state.spinning = true; $('#spinBtn').disabled = true; $('#bet').disabled = true;
    state.balance -= bet; $('#bal').textContent = state.balance.toFixed(2);
    const nonce = state.nonce;
    const spin = await computeSpin(state.serverSeed, $('#clientSeed').value, nonce);

    sSpin(); $('#res').textContent = '0.00'; $('#res').className = 'spinning'; $('#reslab').textContent = 'SPINNING';
    dropIn(spin.initial);
    await sleep(560); sLand();

    let running = 0;
    for (let s = 0; s < spin.steps.length; s++) {
        const step = spin.steps[s];
        highlight(step.clusters, true);
        await sleep(330);
        highlight(step.clusters, false);
        if (step.mult > 1) showMult(step.mult);
        sPop(s); explode(step.clusters);
        running += step.stepWin;
        $('#res').textContent = (bet * running).toFixed(2); $('#res').className = 'win';
        $('#reslab').textContent = 'CASCADE ×' + step.mult;
        await sleep(360);
        settle(step.after);
        if (s > 0) sCascade(s);
        await sleep(470);
    }

    const payout = bet * spin.totalWin;
    if (spin.totalWin > 0) {
        state.balance += payout; $('#bal').textContent = state.balance.toFixed(2);
        $('#res').textContent = payout.toFixed(2); $('#res').className = 'win';
        $('#reslab').textContent = (spin.totalWin >= 20 ? 'BIG WIN +' : 'WIN +') + payout.toFixed(2);
        floatMoney(payout); sWin(spin.totalWin >= 20);
    } else {
        $('#res').textContent = '—'; $('#res').className = 'idle'; $('#reslab').textContent = 'NO WIN';
    }
    state.rounds.push({ nonce, win: +spin.totalWin.toFixed(4) });
    state.nonce++; $('#nonce').textContent = state.nonce; renderHistory();
    state.spinning = false; $('#spinBtn').disabled = false; $('#bet').disabled = false;
}

// ── paytable, session, fairness ─────────────────────────────────────────────────
function renderPaytable() {
    $('#paytable').innerHTML = SYM.map((s, i) =>
        `<div class="s"><div class="dot" style="background:${s.col}"></div><div class="nm">${s.name}</div><div class="pv">×${BASEPAY[i].toFixed(2)}</div></div>`).join('');
}
async function newSession() {
    state.serverSeed = F.randomHex(32); state.commit = await F.commitment(state.serverSeed);
    state.nonce = 0; state.rounds = [];
    $('#commit').textContent = state.commit; $('#nonce').textContent = 0;
    $('#revealBox').style.display = 'none'; renderHistory();
}
function renderHistory() {
    $('#history').innerHTML = state.rounds.slice(-16).reverse()
        .map(r => `<span class="h ${r.win > 0 ? 'w' : 'l'}">${r.win > 0 ? '×' + r.win.toFixed(2) : '—'}</span>`).join('');
}
$('#spinBtn').onclick = doSpin;
$('#rerollBtn').onclick = () => { if (!state.spinning) $('#clientSeed').value = F.randomHex(8); };
$('#revealBtn').onclick = async () => {
    if (!state.rounds.length) { $('#reslab').textContent = 'SPIN A ROUND FIRST'; return; }
    $('#revealBox').style.display = 'block'; $('#serverSeed').textContent = state.serverSeed;
    const okC = (await F.commitment(state.serverSeed)) === state.commit;
    $('#revStatus').textContent = okC ? 'verified' : 'mismatch'; $('#revStatus').className = 'badge ' + (okC ? 'ok' : 'bad-b');
    const tb = $('#verifyTbl').querySelector('tbody'); tb.innerHTML = '';
    for (const r of state.rounds.slice(-12)) {
        const s = await computeSpin(state.serverSeed, $('#clientSeed').value, r.nonce);
        const rec = +s.totalWin.toFixed(4), ok = Math.abs(rec - r.win) < 1e-4;
        tb.innerHTML += `<tr><td>${r.nonce}</td><td>×${r.win.toFixed(2)}</td><td>×${rec.toFixed(2)}</td><td class="${ok ? 'g' : 'r'}">${ok ? '✓' : '✗'}</td></tr>`;
    }
};

(async function init() {
    $('#clientSeed').value = F.randomHex(8);
    renderPaytable();
    await newSession();
    requestAnimationFrame(frame);
})();
