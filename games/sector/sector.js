import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const $ = s => document.querySelector(s);
const F = window.Fair;

const GRID = 7, TILES = GRID * GRID, GAP = 0.82, EDGE = 0.01;
const MAX_AREA = 24, MAX_MULT = 1000;   // area stays below the safe-cell count (37) so every
                                        // bet is winnable; the win cap only ever raises the edge
const state = {
    serverSeed: null, commit: null, nonce: 0, balance: 1000,
    mines: 3, stake: 10, rounds: [],
    dragging: false, resolving: false, shown: false, invalid: false, start: -1, cur: -1,
};

// fair payout multiplier for a cleared rectangle of `area` cells, edge folded in,
// then capped so a single huge sector can't outrun the house
function multFor(area, mines) {
    const safe = TILES - mines;
    let m = 1;
    for (let i = 0; i < area; i++) m *= (TILES - i) / (safe - i);
    return Math.min((1 - EDGE) * m, MAX_MULT);
}

// ── three.js ───────────────────────────────────────────────────────────────────
const cv = $('#cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const camBase = new THREE.Vector3(0, 10.4, 4.8);
camera.position.copy(camBase);
camera.lookAt(0, -0.3, -0.2);
let rect;
function resize() {
    rect = cv.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
}
resize(); addEventListener('resize', resize);

scene.add(new THREE.AmbientLight(0xdfe8ff, 0.8));
const key = new THREE.DirectionalLight(0xfff2d8, 1.4);
key.position.set(4, 12, 6); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 36;
key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
key.shadow.bias = -0.0004;
scene.add(key);
const rim = new THREE.DirectionalLight(0x48d3e6, 0.5);
rim.position.set(-6, 5, -5); scene.add(rim);

const board = new THREE.Group(); scene.add(board);
const span = GRID * GAP;
const baseMesh = new THREE.Mesh(
    new RoundedBoxGeometry(span + 0.4, 0.55, span + 0.4, 6, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x0c1826, roughness: 0.95, metalness: 0 }));
baseMesh.position.y = -0.45; baseMesh.receiveShadow = true; board.add(baseMesh);

const COL_TILE = new THREE.Color(0x244a75);
const COL_SAFE = new THREE.Color(0x0d1a2b);
const COL_MINE = new THREE.Color(0x3a0d14);
const tileGeo = new RoundedBoxGeometry(0.74, 0.34, 0.74, 4, 0.1);
const gemGeo = new THREE.OctahedronGeometry(0.24);
const bombGeo = new THREE.IcosahedronGeometry(0.24, 0);

const cellXZ = i => { const r = Math.floor(i / GRID), c = i % GRID; return { x: (c - (GRID - 1) / 2) * GAP, z: (r - (GRID - 1) / 2) * GAP }; };
const tiles = [];
for (let i = 0; i < TILES; i++) {
    const { x, z } = cellXZ(i);
    const mesh = new THREE.Mesh(tileGeo, new THREE.MeshStandardMaterial({
        color: COL_TILE.clone(), roughness: 0.5, metalness: 0.12,
        emissive: new THREE.Color(0x2f6bd8), emissiveIntensity: 0 }));
    mesh.position.set(x, 0, z); mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.idx = i; board.add(mesh);
    const gem = new THREE.Mesh(gemGeo, new THREE.MeshStandardMaterial({
        color: 0x38f5cf, emissive: 0x0f9c86, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.3 }));
    gem.position.set(x, 0.4, z); gem.visible = false; gem.castShadow = true; board.add(gem);
    const bomb = new THREE.Mesh(bombGeo, new THREE.MeshStandardMaterial({
        color: 0x14181f, emissive: 0x550810, emissiveIntensity: 0.4, roughness: 0.35, metalness: 0.5, flatShading: true }));
    bomb.position.set(x, 0.36, z); bomb.visible = false; bomb.castShadow = true; board.add(bomb);
    tiles.push({ idx: i, x, z, mesh, gem, bomb, selected: false, opened: false, mineShown: false, triggered: false, animT: 0, animDur: 360, kind: null });
}

// ── particles ────────────────────────────────────────────────────────────────
const partGeo = new THREE.TetrahedronGeometry(0.12);
const partColors = [0xff8a2b, 0xff4b3d, 0xffd23d, 0xff6a1f];
const particles = [];
for (let i = 0; i < 64; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshStandardMaterial({
        color: partColors[i % 4], emissive: partColors[i % 4], emissiveIntensity: 0.7, roughness: 0.5 }));
    m.visible = false; board.add(m);
    particles.push({ m, life: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0 });
}
function explodeAt(x, z) {
    let n = 0;
    for (const p of particles) {
        if (p.life > 0) continue;
        p.m.position.set(x, 0.4, z);
        const a = Math.random() * Math.PI * 2, sp = 2.5 + Math.random() * 4.5;
        p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 3.5 + Math.random() * 4.5;
        p.rx = (Math.random() - 0.5) * 0.5; p.ry = (Math.random() - 0.5) * 0.5;
        p.life = 1; p.m.visible = true; p.m.scale.setScalar(1);
        if (++n >= 24) break;
    }
}
let shake = 0;
const kick = a => { shake = Math.min(1, shake + a); };

// ── audio ────────────────────────────────────────────────────────────────────
let AC = null, master = null;
function audio() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
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
const sTick = () => blip(340, 0.03, 0.03, 'square', 300);
const sGem = i => blip(520 + i * 22, 0.09, 0.07, 'sine', (520 + i * 22) * 1.5);
const sCash = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.16, 0.1, 'sine'), i * 70));
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
function showGem(t, delay = 0) {
    setTimeout(() => { t.opened = true; t.kind = 'gem'; t.animT = performance.now(); t.gem.visible = true; t.gem.scale.setScalar(0.001); }, delay);
}
function showBomb(t, triggered, delay = 0) {
    setTimeout(() => {
        t.mineShown = true; t.triggered = triggered; t.kind = 'bomb';
        t.animT = performance.now(); t.animDur = triggered ? 200 : 320;
        t.bomb.visible = true; t.bomb.scale.setScalar(0.001);
        t.bomb.material.emissiveIntensity = triggered ? 1.2 : 0.4;
        if (triggered) { explodeAt(t.x, t.z); kick(1); flash(); }
    }, delay);
}
function flash() { const el = $('#flash'); el.style.opacity = '0.85'; setTimeout(() => { el.style.opacity = '0'; }, 60); }

const _v = new THREE.Vector3();
function floatMoney(x, z, amount, positive) {
    _v.set(x, 1, z).project(camera);
    const sx = (_v.x * 0.5 + 0.5) * rect.width, sy = (-_v.y * 0.5 + 0.5) * rect.height;
    const el = document.createElement('div');
    el.className = 'float-money ' + (positive ? 'pos' : 'neg');
    el.textContent = (positive ? '+' : '') + amount.toFixed(2);
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    $('#stage').appendChild(el); setTimeout(() => el.remove(), 1400);
}

// ── selection geometry ──────────────────────────────────────────────────────────
function rectOf(a, b) {
    const r0 = Math.floor(a / GRID), c0 = a % GRID, r1 = Math.floor(b / GRID), c1 = b % GRID;
    const rMin = Math.min(r0, r1), rMax = Math.max(r0, r1), cMin = Math.min(c0, c1), cMax = Math.max(c0, c1);
    const cells = [];
    for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) cells.push(r * GRID + c);
    return { cells, w: cMax - cMin + 1, h: rMax - rMin + 1 };
}
function applySelection() {
    const sel = new Set(state.dragging ? rectOf(state.start, state.cur).cells : []);
    for (const t of tiles) t.selected = sel.has(t.idx);
}
function updatePreview() {
    applySelection();
    if (!state.dragging) return;
    const { w, h, cells } = rectOf(state.start, state.cur);
    state.invalid = cells.length > MAX_AREA;
    if (state.invalid) {
        $('#res').textContent = 'TOO BIG'; $('#res').className = 'lose';
        $('#reslab').textContent = `MAX ${MAX_AREA} CELLS`;
        return;
    }
    const mult = multFor(cells.length, state.mines);
    const stake = Math.max(1, +$('#bet').value || 0);
    $('#res').textContent = '×' + mult.toFixed(2); $('#res').className = 'drawing';
    $('#reslab').textContent = `${w}×${h} · +${(stake * mult).toFixed(2)}`;
}
function resetPreview() {
    $('#res').textContent = '×1.00'; $('#res').className = 'idle'; $('#reslab').textContent = 'DRAG A RECTANGLE';
}

// ── render loop ──────────────────────────────────────────────────────────────
function frame(now) {
    board.position.y = Math.sin(now / 950) * 0.045;
    for (const t of tiles) {
        let ty = 0;
        if (t.selected) ty = 0.16; else if (t.opened) ty = -0.14; else if (t.mineShown) ty = -0.05;
        t.mesh.position.y += (ty - t.mesh.position.y) * 0.25;
        if (t.opened) { t.mesh.material.color.lerp(COL_SAFE, 0.18); t.mesh.material.emissiveIntensity += (0 - t.mesh.material.emissiveIntensity) * 0.2; }
        else if (t.mineShown) { t.mesh.material.color.lerp(COL_MINE, 0.22); t.mesh.material.emissive.setHex(0x5a0912); t.mesh.material.emissiveIntensity += ((t.triggered ? 0.9 : 0.5) - t.mesh.material.emissiveIntensity) * 0.2; }
        else { t.mesh.material.color.lerp(COL_TILE, 0.2); t.mesh.material.emissive.setHex(t.selected ? (state.invalid ? 0xf2a413 : 0x2ce7c2) : 0x2f6bd8); t.mesh.material.emissiveIntensity += ((t.selected ? 0.6 : 0) - t.mesh.material.emissiveIntensity) * 0.25; }
        if (t.animT) {
            const e = (now - t.animT) / t.animDur, k = Math.min(1, e), b = easeOutBack(k);
            if (t.kind === 'gem') { t.gem.scale.setScalar(0.001 + b * 0.85); t.gem.position.y = -0.05 + b * 0.5; }
            else { t.bomb.scale.setScalar(0.001 + b * (t.triggered ? 1.2 : 0.8)); t.bomb.position.y = -0.05 + b * 0.42; }
            if (e >= 1) t.animT = 0;
        }
        if (t.gem.visible) { t.gem.rotation.y += 0.03; t.gem.rotation.x += 0.008; }
        if (t.bomb.visible && t.triggered) t.bomb.rotation.y += 0.05;
    }
    const dt = 0.016;
    for (const p of particles) {
        if (p.life <= 0) continue;
        p.vy -= 15 * dt;
        p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
        p.m.rotation.x += p.rx; p.m.rotation.y += p.ry;
        p.life -= dt * 1.15; p.m.scale.setScalar(Math.max(0.001, p.life));
        if (p.life <= 0 || p.m.position.y < -0.4) { p.life = 0; p.m.visible = false; }
    }
    if (shake > 0.001) {
        camera.position.set(camBase.x + (Math.random() - 0.5) * shake * 0.7, camBase.y + (Math.random() - 0.5) * shake * 0.7, camBase.z + (Math.random() - 0.5) * shake * 0.5);
        shake *= 0.86;
    } else camera.position.copy(camBase);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
}

// ── input: drag a rectangle ─────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();
// snap the cursor to the nearest cell via the board plane — robust to the gaps
// between tiles. `clamp` keeps a drag glued to the edge when it leaves the grid.
function cellAt(ev, clamp) {
    const r = cv.getBoundingClientRect();
    ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    camera.updateMatrixWorld();   // don't rely on a render frame having run first
    ray.setFromCamera(ptr, camera);
    plane.constant = -board.position.y;
    if (!ray.ray.intersectPlane(plane, _hit)) return -1;
    const fc = _hit.x / GAP + (GRID - 1) / 2, fr = _hit.z / GAP + (GRID - 1) / 2;
    if (!clamp && (fc < -0.55 || fc > GRID - 0.45 || fr < -0.55 || fr > GRID - 0.45)) return -1;
    const c = Math.max(0, Math.min(GRID - 1, Math.round(fc)));
    const rr = Math.max(0, Math.min(GRID - 1, Math.round(fr)));
    return rr * GRID + c;
}
cv.addEventListener('pointerdown', ev => {
    if (state.resolving) return;
    audio();
    if (state.shown) { resetTiles(); state.shown = false; }
    const c = cellAt(ev); if (c < 0) return;
    try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
    state.dragging = true; state.start = c; state.cur = c;
    updatePreview();
});
cv.addEventListener('pointermove', ev => {
    if (!state.dragging) return;
    const c = cellAt(ev, true);
    if (c >= 0 && c !== state.cur) { state.cur = c; sTick(); }
    updatePreview();
});
function endDrag(ev) {
    if (!state.dragging) return;
    state.dragging = false;
    try { cv.releasePointerCapture(ev.pointerId); } catch (e) {}
    const { cells } = rectOf(state.start, state.cur);
    for (const t of tiles) t.selected = false;
    if (state.invalid || cells.length > MAX_AREA) { state.invalid = false; resetPreview(); return; }
    commit(cells);
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

// ── commit the bet ──────────────────────────────────────────────────────────────
async function commit(cells) {
    const stake = Math.max(1, +$('#bet').value || 0);
    if (stake > state.balance) { $('#res').textContent = 'LOW'; $('#res').className = 'lose'; $('#reslab').textContent = 'NOT ENOUGH BALANCE'; return; }
    state.resolving = true;
    state.stake = stake; state.balance -= stake; $('#bal').textContent = state.balance.toFixed(2);
    const field = await F.minesField(state.serverSeed, $('#clientSeed').value, state.nonce, state.mines, TILES);
    const set = new Set(field);
    const hits = cells.filter(c => set.has(c));
    const area = cells.length, mult = multFor(area, state.mines);
    let result;
    if (hits.length === 0) {
        const prize = stake * mult;
        state.balance += prize; $('#bal').textContent = state.balance.toFixed(2);
        cells.forEach((c, i) => showGem(tiles[c], 20 + i * 45));
        cells.forEach((c, i) => setTimeout(() => sGem(i), 20 + i * 45));
        setTimeout(sCash, 60 + cells.length * 45);
        $('#res').textContent = '×' + mult.toFixed(2); $('#res').className = 'win';
        $('#reslab').textContent = `${area} CLEARED · +${prize.toFixed(2)}`;
        const mid = cellXZ(cells[Math.floor(cells.length / 2)]);
        floatMoney(mid.x, mid.z, prize, true);
        result = 'win';
    } else {
        sBoom();
        hits.forEach((c, i) => showBomb(tiles[c], true, i * 60));
        const mid = cellXZ(hits[0]);
        $('#res').textContent = 'BOOM'; $('#res').className = 'lose';
        $('#reslab').textContent = '−' + stake.toFixed(2);
        floatMoney(mid.x, mid.z, stake, false);
        result = 'bust';
    }
    // uncover the rest of the field
    field.forEach((m, i) => { if (!hits.includes(m)) showBomb(tiles[m], false, 120 + i * 55); });
    state.rounds.push({ nonce: state.nonce, mines: state.mines, area, mult: +mult.toFixed(2), field: field.slice(), result });
    state.nonce++; $('#nonce').textContent = state.nonce;
    renderHistory();
    state.resolving = false; state.shown = true;
}

function resetTiles() {
    for (const t of tiles) {
        t.selected = false; t.opened = false; t.mineShown = false; t.triggered = false; t.animT = 0; t.kind = null;
        t.mesh.material.color.copy(COL_TILE); t.mesh.material.emissive.setHex(0x2f6bd8);
        t.gem.visible = false; t.bomb.visible = false;
    }
    for (const p of particles) { p.life = 0; p.m.visible = false; }
    $('#res').textContent = '×1.00'; $('#res').className = 'idle'; $('#reslab').textContent = 'DRAG A RECTANGLE';
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

document.querySelectorAll('#minesPick button').forEach(b => b.onclick = () => {
    if (state.dragging || state.resolving) return;
    document.querySelectorAll('#minesPick button').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); state.mines = +b.dataset.m;
});
$('#rerollBtn').onclick = () => { if (!state.dragging && !state.resolving) $('#clientSeed').value = F.randomHex(8); };
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
    requestAnimationFrame(frame);
})();
