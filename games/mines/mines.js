import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const $ = s => document.querySelector(s);
const F = window.Fair;

const GRID = 5, TILES = GRID * GRID, GAP = 1.06, EDGE = 0.01;
const state = {
    serverSeed: null, commit: null, nonce: 0, balance: 1000,
    mines: 3, stake: 10, field: [], picks: 0, active: false, starting: false, mult: 1, rounds: [],
};

// fair cash-out multiplier after `picks` safe tiles, house edge folded in
function multFor(picks, mines) {
    const safe = TILES - mines;
    let m = 1;
    for (let i = 0; i < picks; i++) m *= (TILES - i) / (safe - i);
    return (1 - EDGE) * m;
}

// ── three.js ───────────────────────────────────────────────────────────────────
const cv = $('#cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const camBase = new THREE.Vector3(0, 8.6, 6.4);
camera.position.copy(camBase);
camera.lookAt(0, -0.3, 0.2);
let rect;
function resize() {
    rect = cv.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
}
resize(); addEventListener('resize', resize);

scene.add(new THREE.AmbientLight(0xdfe8ff, 0.8));
const key = new THREE.DirectionalLight(0xfff2d8, 1.45);
key.position.set(4, 11, 6); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 34;
key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
key.shadow.bias = -0.0004;
scene.add(key);
const rim = new THREE.DirectionalLight(0x48d3e6, 0.55);
rim.position.set(-6, 4, -5); scene.add(rim);

const board = new THREE.Group(); scene.add(board);
const span = GRID * GAP;
const base = new THREE.Mesh(
    new RoundedBoxGeometry(span + 0.5, 0.6, span + 0.5, 6, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x0c1826, roughness: 0.95, metalness: 0 }));
base.position.y = -0.5; base.receiveShadow = true; board.add(base);

// ── palette ──────────────────────────────────────────────────────────────────
const COL_TILE = new THREE.Color(0x244a75);
const COL_SAFE = new THREE.Color(0x0d1a2b);
const COL_MINE = new THREE.Color(0x3a0d14);
const tileGeo = new RoundedBoxGeometry(0.94, 0.42, 0.94, 4, 0.13);
const gemGeo = new THREE.OctahedronGeometry(0.3);
const bombGeo = new THREE.IcosahedronGeometry(0.3, 0);
const fuseGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.16, 6);

const tiles = [];
for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
    const idx = r * GRID + c;
    const x = (c - (GRID - 1) / 2) * GAP, z = (r - (GRID - 1) / 2) * GAP;
    const mesh = new THREE.Mesh(tileGeo, new THREE.MeshStandardMaterial({
        color: COL_TILE.clone(), roughness: 0.5, metalness: 0.12,
        emissive: new THREE.Color(0x2f6bd8), emissiveIntensity: 0,
    }));
    mesh.position.set(x, 0, z); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.idx = idx; board.add(mesh);

    const gem = new THREE.Mesh(gemGeo, new THREE.MeshStandardMaterial({
        color: 0x38f5cf, emissive: 0x0f9c86, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3 }));
    gem.position.set(x, 0.55, z); gem.visible = false; gem.castShadow = true; board.add(gem);

    const bomb = new THREE.Group();
    const orb = new THREE.Mesh(bombGeo, new THREE.MeshStandardMaterial({
        color: 0x14181f, emissive: 0x550810, emissiveIntensity: 0.4, roughness: 0.35, metalness: 0.5, flatShading: true }));
    orb.castShadow = true;
    const fuse = new THREE.Mesh(fuseGeo, new THREE.MeshStandardMaterial({ color: 0x8a6b3a, roughness: 0.9 }));
    fuse.position.y = 0.32;
    bomb.add(orb, fuse);
    bomb.position.set(x, 0.5, z); bomb.visible = false; board.add(bomb);

    tiles.push({ idx, x, z, mesh, gem, bomb, orb, baseY: 0, opened: false, mineShown: false, triggered: false, animT: 0, animDur: 380, kind: null });
}

// ── explosion particles (shared pool) ──────────────────────────────────────────
const partGeo = new THREE.TetrahedronGeometry(0.13);
const partColors = [0xff8a2b, 0xff4b3d, 0xffd23d, 0xff6a1f];
const particles = [];
for (let i = 0; i < 54; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshStandardMaterial({
        color: partColors[i % 4], emissive: partColors[i % 4], emissiveIntensity: 0.7, roughness: 0.5 }));
    m.visible = false; board.add(m);
    particles.push({ m, life: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0 });
}
function explodeAt(x, z) {
    let n = 0;
    for (const p of particles) {
        if (p.life > 0) continue;
        p.m.position.set(x, 0.5, z);
        const a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 4.5;
        p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 3.5 + Math.random() * 4.5;
        p.rx = (Math.random() - 0.5) * 0.5; p.ry = (Math.random() - 0.5) * 0.5;
        p.life = 1; p.m.visible = true; p.m.scale.setScalar(1);
        if (++n >= 30) break;
    }
}

// ── camera shake ────────────────────────────────────────────────────────────────
let shake = 0;
function kick(amount) { shake = Math.min(1, shake + amount); }

// ── audio ────────────────────────────────────────────────────────────────────
let AC = null, master = null;
function audio() {
    if (AC) return;
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.55; master.connect(AC.destination);
}
function blip(freq, dur = 0.08, vol = 0.08, type = 'sine', slideTo = null) {
    if (!AC) return;
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
const sClick = () => blip(300, 0.045, 0.05, 'square', 220);
function sSafe(picks) {
    const f = 480 + picks * 26;
    blip(f, 0.1, 0.09, 'sine', f * 1.5);
    setTimeout(() => blip(f * 2, 0.08, 0.04, 'triangle'), 45);
}
function sCash() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.16, 0.1, 'sine'), i * 70));
}
function sBoom() {
    if (!AC) return;
    const t = AC.currentTime;
    const n = AC.createBufferSource();
    const buf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    n.buffer = buf;
    const nf = AC.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(2000, t); nf.frequency.exponentialRampToValueAtTime(180, t + 0.4);
    const ng = AC.createGain(); ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    n.connect(nf); nf.connect(ng); ng.connect(master); n.start(t);
    const o = AC.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.4);
    const og = AC.createGain(); og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.55);
}

// ── reveal helpers ──────────────────────────────────────────────────────────────
const easeOutBack = x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

function showGem(t) { t.opened = true; t.kind = 'gem'; t.animT = performance.now(); t.gem.visible = true; t.gem.scale.setScalar(0.001); }
function showBomb(t, triggered) {
    t.mineShown = true; t.triggered = triggered; t.kind = 'bomb';
    t.animT = performance.now(); t.animDur = triggered ? 220 : 340;
    t.bomb.visible = true; t.bomb.scale.setScalar(0.001);
    t.orb.material.emissiveIntensity = triggered ? 1.2 : 0.4;
    if (triggered) { explodeAt(t.x, t.z); kick(1); flash(); }
}
function flash() {
    const el = $('#flash'); el.style.opacity = '0.85';
    setTimeout(() => { el.style.opacity = '0'; }, 60);
}

// ── float payout ────────────────────────────────────────────────────────────────
const _v = new THREE.Vector3();
function floatMoney(x, z, prize, positive) {
    _v.set(x, 1.1, z).project(camera);
    const sx = (_v.x * 0.5 + 0.5) * rect.width, sy = (-_v.y * 0.5 + 0.5) * rect.height;
    const el = document.createElement('div');
    el.className = 'float-money ' + (positive ? 'pos' : 'neg');
    el.textContent = (positive ? '+' : '') + prize.toFixed(2);
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    $('#stage').appendChild(el); setTimeout(() => el.remove(), 1400);
}

// ── render loop ──────────────────────────────────────────────────────────────
function frame(now) {
    const bob = Math.sin(now / 900) * 0.05;
    board.position.y = bob;
    for (const t of tiles) {
        // lift / sink
        let ty = t.baseY;
        if (t.opened) ty = -0.16; else if (t.mineShown) ty = -0.05;
        else if (hovered === t.idx && state.active) ty = 0.18;
        t.mesh.position.y += (ty - t.mesh.position.y) * 0.22;
        // colour + emissive
        if (t.opened) { t.mesh.material.color.lerp(COL_SAFE, 0.18); t.mesh.material.emissiveIntensity += (0 - t.mesh.material.emissiveIntensity) * 0.2; }
        else if (t.mineShown) { t.mesh.material.color.lerp(COL_MINE, 0.22); t.mesh.material.emissive.setHex(0x5a0912); t.mesh.material.emissiveIntensity += ((t.triggered ? 0.9 : 0.5) - t.mesh.material.emissiveIntensity) * 0.2; }
        else { const hov = hovered === t.idx && state.active; t.mesh.material.emissiveIntensity += ((hov ? 0.55 : 0) - t.mesh.material.emissiveIntensity) * 0.2; }
        // reveal pop
        if (t.animT) {
            const e = (now - t.animT) / t.animDur, k = Math.min(1, e), b = easeOutBack(k);
            if (t.kind === 'gem') { t.gem.scale.setScalar(0.001 + b * 0.92); t.gem.position.y = -0.05 + b * 0.62; }
            else { t.bomb.scale.setScalar(0.001 + b * (t.triggered ? 1.25 : 0.85)); t.bomb.position.y = -0.05 + b * 0.55; }
            if (e >= 1) t.animT = 0;
        }
        if (t.gem.visible) { t.gem.rotation.y += 0.03; t.gem.rotation.x += 0.008; }
        if (t.bomb.visible && t.triggered) t.bomb.rotation.y += 0.05;
    }
    // particles
    const dt = 0.016;
    for (const p of particles) {
        if (p.life <= 0) continue;
        p.vy -= 15 * dt;
        p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
        p.m.rotation.x += p.rx; p.m.rotation.y += p.ry;
        p.life -= dt * 1.15;
        p.m.scale.setScalar(Math.max(0.001, p.life));
        if (p.life <= 0 || p.m.position.y < -0.4) { p.life = 0; p.m.visible = false; }
    }
    // camera shake
    if (shake > 0.001) {
        camera.position.set(
            camBase.x + (Math.random() - 0.5) * shake * 0.7,
            camBase.y + (Math.random() - 0.5) * shake * 0.7,
            camBase.z + (Math.random() - 0.5) * shake * 0.5);
        shake *= 0.86;
    } else camera.position.copy(camBase);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
}

// ── input ────────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let hovered = -1;
function pick(ev) {
    const r = cv.getBoundingClientRect();
    ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(tiles.map(t => t.mesh));
    return hit.length ? hit[0].object.userData.idx : -1;
}
cv.addEventListener('mousemove', ev => {
    hovered = state.active ? pick(ev) : -1;
    const t = hovered >= 0 && !tiles[hovered].opened && !tiles[hovered].mineShown;
    cv.style.cursor = t ? 'pointer' : 'default';
});
cv.addEventListener('mouseleave', () => { hovered = -1; });
cv.addEventListener('click', ev => {
    if (!state.active) return;
    const idx = pick(ev);
    if (idx < 0) return;
    reveal(idx);
});

// ── game flow ────────────────────────────────────────────────────────────────
function resetTiles() {
    for (const t of tiles) {
        t.opened = false; t.mineShown = false; t.triggered = false; t.animT = 0; t.kind = null;
        t.mesh.material.color.copy(COL_TILE); t.mesh.material.emissive.setHex(0x2f6bd8);
        t.gem.visible = false; t.bomb.visible = false;
    }
    for (const p of particles) { p.life = 0; p.m.visible = false; }
}

async function startRound() {
    if (state.active || state.starting) return;
    audio(); if (AC && AC.state === 'suspended') AC.resume();
    const stake = Math.max(1, +$('#bet').value || 0);
    if (stake > state.balance) { $('#res').textContent = 'LOW'; $('#res').className = 'lose'; $('#reslab').textContent = 'NOT ENOUGH BALANCE'; return; }
    state.starting = true; $('#startBtn').disabled = true;   // hold the door until the field is ready
    state.stake = stake; state.balance -= stake; $('#bal').textContent = state.balance.toFixed(2);
    state.field = await F.minesField(state.serverSeed, $('#clientSeed').value, state.nonce, state.mines, TILES);
    state.picks = 0; state.mult = 1; state.active = true; state.starting = false;
    resetTiles();
    $('#res').textContent = '×1.00'; $('#res').className = 'playing';
    $('#reslab').textContent = 'PICK A TILE';
    setButtons();
}

function reveal(idx) {
    const t = tiles[idx];
    if (t.opened || t.mineShown) return;
    sClick();
    if (state.field.includes(idx)) return bust(idx);
    showGem(t);
    state.picks++;
    state.mult = multFor(state.picks, state.mines);
    sSafe(state.picks);
    $('#res').textContent = '×' + state.mult.toFixed(2); $('#res').className = 'playing';
    const payout = state.stake * state.mult;
    $('#reslab').textContent = 'CASH OUT +' + payout.toFixed(2);
    setButtons();
    if (state.picks >= TILES - state.mines) cashOut(true); // cleared the board
}

function bust(idx) {
    showBomb(tiles[idx], true);
    sBoom();
    state.active = false;
    $('#res').textContent = 'BOOM'; $('#res').className = 'lose';
    $('#reslab').textContent = '−' + state.stake.toFixed(2);
    floatMoney(tiles[idx].x, tiles[idx].z, state.stake, false);
    // uncover the rest of the field
    state.field.forEach((m, i) => { if (m !== idx) setTimeout(() => showBomb(tiles[m], false), 90 + i * 70); });
    finishRound('bust', 0);
}

function cashOut(cleared) {
    if (!state.active || state.picks < 1) return;
    const prize = state.stake * state.mult;
    state.balance += prize; $('#bal').textContent = state.balance.toFixed(2);
    state.active = false;
    sCash();
    $('#res').textContent = '×' + state.mult.toFixed(2); $('#res').className = 'win';
    $('#reslab').textContent = (cleared ? 'CLEARED · +' : 'WON +') + prize.toFixed(2);
    // gently show where the mines were
    state.field.forEach((m, i) => setTimeout(() => showBomb(tiles[m], false), 60 + i * 60));
    const mid = tiles[Math.floor(TILES / 2)];
    floatMoney(mid.x, mid.z, prize, true);
    finishRound(cleared ? 'cleared' : 'cash', prize);
}

function finishRound(result, prize) {
    state.rounds.push({ nonce: state.nonce, mines: state.mines, picks: state.picks, mult: +state.mult.toFixed(2), field: state.field.slice(), result });
    state.nonce++; $('#nonce').textContent = state.nonce;
    renderHistory(); setButtons();
}

function setButtons() {
    $('#startBtn').disabled = state.active;
    $('#cashBtn').disabled = !state.active || state.picks < 1;
    $('#bet').disabled = state.active;
    document.querySelectorAll('#minesPick button').forEach(b => b.disabled = state.active);
    if (state.active && state.picks >= 1) {
        const next = multFor(state.picks + 1, state.mines);
        $('#cashBtn').innerHTML = 'Cash out<small>×' + state.mult.toFixed(2) + ' · next ×' + next.toFixed(2) + '</small>';
    } else if (state.active) {
        $('#cashBtn').innerHTML = 'Cash out<small>reveal a tile first</small>';
    } else {
        $('#cashBtn').textContent = 'Cash out';
    }
    $('#startBtn').textContent = state.active ? 'In play' : 'Start';
}

// ── session + fairness ────────────────────────────────────────────────────────
async function newSession() {
    state.serverSeed = F.randomHex(32);
    state.commit = await F.commitment(state.serverSeed);
    state.nonce = 0; state.rounds = [];
    $('#commit').textContent = state.commit; $('#nonce').textContent = 0;
    $('#revealBox').style.display = 'none'; renderHistory();
}
function renderHistory() {
    $('#history').innerHTML = state.rounds.slice(-16).reverse()
        .map(r => `<span class="h ${r.result === 'bust' ? 'l' : 'w'}">${r.result === 'bust' ? 'x' : '×' + r.mult}</span>`).join('');
}

$('#startBtn').onclick = startRound;
$('#cashBtn').onclick = () => cashOut(false);
$('#rerollBtn').onclick = () => { if (!state.active) $('#clientSeed').value = F.randomHex(8); };
document.querySelectorAll('#minesPick button').forEach(b => b.onclick = () => {
    if (state.active) return;
    document.querySelectorAll('#minesPick button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); state.mines = +b.dataset.m;
});
$('#revealBtn').onclick = async () => {
    if (!state.rounds.length) { $('#reslab').textContent = 'PLAY A ROUND FIRST'; return; }
    $('#revealBox').style.display = 'block';
    $('#serverSeed').textContent = state.serverSeed;
    const okC = (await F.commitment(state.serverSeed)) === state.commit;
    $('#revStatus').textContent = okC ? 'verified' : 'mismatch';
    $('#revStatus').className = 'badge ' + (okC ? 'ok' : 'bad-b');
    const tb = $('#verifyTbl').querySelector('tbody'); tb.innerHTML = '';
    for (const r of state.rounds.slice(-12)) {
        const f = await F.minesField(state.serverSeed, $('#clientSeed').value, r.nonce, r.mines, TILES);
        const ok = f.length === r.field.length && f.every((v, i) => v === r.field[i]);
        tb.innerHTML += `<tr><td>${r.nonce}</td><td>${r.field.join(',')}</td><td>${f.join(',')}</td><td class="${ok ? 'g' : 'r'}">${ok ? '✓' : '✗'}</td></tr>`;
    }
};

(async function init() {
    $('#clientSeed').value = F.randomHex(8);
    await newSession();
    setButtons();
    requestAnimationFrame(frame);
})();
