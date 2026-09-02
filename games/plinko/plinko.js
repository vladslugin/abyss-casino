import * as THREE from 'three';

const $ = s => document.querySelector(s);
const F = window.Fair;

const ROWS = 12, SLOTS = 13;
const MULT = [87, 13, 3.3, 1.3, 0.76, 0.54, 0.43, 0.54, 0.76, 1.3, 3.3, 13, 87];
const PEG = 0.6, ROW = 0.62, TOP = 3.7;
const slotY = TOP - ROWS * ROW - 0.35;
const state = { serverSeed: null, commit: null, nonce: 0, balance: 1000, rounds: [] };

// ── three.js ──────────────────────────────────────────────────────────────────
const cv = $('#cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
camera.position.set(0, 0.1, 11.2);
camera.lookAt(0, -0.35, 0);
function resize() {
    const r = cv.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    return r;
}
let rect = resize();
addEventListener('resize', () => { rect = resize(); });

scene.add(new THREE.AmbientLight(0xdfe8ff, 0.85));
const key = new THREE.DirectionalLight(0xfff2d8, 1.3);
key.position.set(3, 6, 8); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = -7; key.shadow.camera.right = 7; key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
scene.add(key);

const backing = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 10),
    new THREE.MeshStandardMaterial({ color: 0x0c1626, roughness: 1 }));
backing.position.set(0, 0, -0.6); backing.receiveShadow = true; scene.add(backing);

// pegs
const pegGeo = new THREE.SphereGeometry(0.075, 12, 12);
const pegMat = new THREE.MeshStandardMaterial({ color: 0x9fb4cc, roughness: 0.4, metalness: 0.1 });
for (let r = 0; r < ROWS; r++) {
    const count = r + 2;
    for (let j = 0; j < count; j++) {
        const peg = new THREE.Mesh(pegGeo, pegMat);
        peg.position.set((j - (count - 1) / 2) * PEG, TOP - r * ROW, 0);
        peg.castShadow = true; scene.add(peg);
    }
}

// slots + labels
function slotColor(m) {
    if (m >= 20) return 0xff5468; if (m >= 5) return 0xff8a3d;
    if (m >= 1.3) return 0xf2a413; if (m >= 0.9) return 0x48d3e6; return 0x2f3f6b;
}
function slotTexture(m) {
    const w = 128, h = 96, c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f8ff'; x.font = '700 40px ui-monospace,Consolas,monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText((m >= 10 ? m : m.toFixed(1)) + '×', w / 2, h / 2);
    return new THREE.CanvasTexture(c);
}
const slotMeshes = [];
for (let k = 0; k < SLOTS; k++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(PEG * 0.92, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: slotColor(MULT[k]), roughness: 0.6, emissive: 0x000000 }));
    box.position.set((k - (SLOTS - 1) / 2) * PEG, slotY, 0);
    box.castShadow = true; box.receiveShadow = true; scene.add(box);
    slotMeshes.push(box);
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: slotTexture(MULT[k]), transparent: true }));
    lab.position.set(box.position.x, slotY, 0.42); lab.scale.set(0.54, 0.42, 1);
    scene.add(lab);
}
function flashSlot(k, color = 0xffffff) {
    const m = slotMeshes[k];
    m.material.emissive.setHex(color);
    setTimeout(() => m.material.emissive.setHex(0x000000), 240);
}

// ── audio (soft, Web Audio) ────────────────────────────────────────────────────
let AC = null, master = null;
function audio() {
    if (AC) return;
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.6;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    master.connect(lp); lp.connect(AC.destination);
}
function blip(freq, dur = 0.06, vol = 0.09, type = 'sine') {
    if (!AC) return;
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
const sPeg = () => blip(680 + Math.random() * 240, 0.045, 0.05, 'triangle');
const sPortal = () => { blip(520, 0.18, 0.12); blip(780, 0.22, 0.1); blip(1040, 0.26, 0.08); };
function sLand(mult) {
    blip(300, 0.12, 0.12, 'sine');
    if (mult >= 2) [523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 0.2, 0.12), i * 70));
    else blip(440, 0.1, 0.08);
}

// ── portal ring ────────────────────────────────────────────────────────────────
const ringGeo = new THREE.TorusGeometry(0.26, 0.055, 10, 28);
function portalXY(row, pos) {
    return { x: (pos - row / 2) * PEG, y: TOP - row * ROW + ROW / 2 };
}

// ── ball pool + multi-ball ─────────────────────────────────────────────────────
const ballGeo = new THREE.SphereGeometry(0.19, 20, 20);
function newBallMesh() {
    const m = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({
        color: 0xffd36b, emissive: 0x3a2a00, roughness: 0.3, metalness: 0.2
    }));
    m.castShadow = true; scene.add(m); return m;
}
const ballPool = [];
const active = [];
const PER = 115; // ms per row hop

function waypoints(path, slot) {
    const wp = [{ x: 0, y: TOP + ROW }];
    let x = 0;
    for (let r = 0; r < ROWS; r++) { x += (path[r] ? 1 : -1) * PEG / 2; wp.push({ x, y: TOP - r * ROW }); }
    wp.push({ x: (slot - (SLOTS - 1) / 2) * PEG, y: slotY + 0.3 });
    return wp;
}

function launch(roll, stake, nonce) {
    const mesh = ballPool.pop() || newBallMesh();
    mesh.visible = true;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({
        color: 0x9a7bff, emissive: 0x3a2a66, transparent: true, opacity: 0.9
    }));
    const pxy = portalXY(roll.portalRow, roll.portalPos);
    ring.position.set(pxy.x, pxy.y, 0.1);
    scene.add(ring);
    active.push({
        mesh, ring, wp: waypoints(roll.path, roll.slot), segs: ROWS + 1,
        startT: performance.now(), roll, stake, nonce, lastSeg: -1, passed: false,
    });
}

function settle(a) {
    const hit = a.roll.portalHit;
    const mult = +(MULT[a.roll.slot] * (hit ? 2 : 1)).toFixed(2);
    const prize = a.stake * mult;
    state.balance += prize; $('#bal').textContent = state.balance.toFixed(2);
    flashSlot(a.roll.slot, hit ? 0x9a7bff : 0xffffff);
    sLand(mult);
    floatMoney(a.roll.slot, prize, mult >= 1);
    $('#res').textContent = mult + '×'; $('#res').className = mult >= 1 ? 'win' : 'lose';
    $('#reslab').textContent = hit ? 'PORTAL ×2 · +' + prize.toFixed(2) : '+' + prize.toFixed(2);
    state.rounds.push({ nonce: a.nonce, slot: a.roll.slot, portalHit: hit, mult });
    renderHistory();
}

function frame(now) {
    for (let i = active.length - 1; i >= 0; i--) {
        const a = active[i];
        const t = Math.max(0, (now - a.startT) / (PER * a.segs));
        // portal pulse
        const s = 1 + Math.sin(now / 160) * 0.12;
        a.ring.scale.set(s, s, s);
        a.ring.rotation.z += 0.04;
        if (t >= 1) {
            a.mesh.position.set(a.wp[a.segs].x, a.wp[a.segs].y, 0);
            settle(a);
            setTimeout(m => { m.visible = false; ballPool.push(m); }, 350, a.mesh);
            scene.remove(a.ring);
            active.splice(i, 1);
            continue;
        }
        const f = t * a.segs, seg = Math.min(Math.floor(f), a.segs - 1), lt = f - seg;
        const p = a.wp[seg], q = a.wp[seg + 1];
        a.mesh.position.x = p.x + (q.x - p.x) * lt;
        a.mesh.position.y = p.y + (q.y - p.y) * lt + Math.sin(lt * Math.PI) * 0.2;
        a.mesh.position.z = 0.15;
        if (seg !== a.lastSeg) { a.lastSeg = seg; if (seg > 0 && seg <= ROWS) sPeg(); }
        // portal crossing
        if (!a.passed && seg >= a.roll.portalRow) {
            a.passed = true;
            if (a.roll.portalHit) {
                sPortal();
                a.ring.material.emissive.setHex(0xffffff);
                a.mesh.material.emissive.setHex(0x9a7bff);
                setTimeout(() => a.mesh.material.emissive.setHex(0x3a2a00), 400);
            }
        }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
}

// ── floating +money (DOM over canvas) ──────────────────────────────────────────
function floatMoney(slot, prize, positive) {
    const box = slotMeshes[slot];
    const v = new THREE.Vector3(box.position.x, box.position.y + 0.3, 0.5).project(camera);
    const sx = (v.x * 0.5 + 0.5) * rect.width;
    const sy = (-v.y * 0.5 + 0.5) * rect.height;
    const el = document.createElement('div');
    el.className = 'float-money ' + (positive ? 'pos' : 'neg');
    el.textContent = (positive ? '+' : '') + prize.toFixed(2);
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    $('#stage').appendChild(el);
    setTimeout(() => el.remove(), 1300);
}

// ── game plumbing ──────────────────────────────────────────────────────────────
async function newSession() {
    state.serverSeed = F.randomHex(32);
    state.commit = await F.commitment(state.serverSeed);
    state.nonce = 0; state.rounds = [];
    $('#commit').textContent = state.commit; $('#nonce').textContent = 0;
    $('#revealBox').style.display = 'none'; renderHistory();
}
function renderHistory() {
    $('#history').innerHTML = state.rounds.slice(-16).reverse()
        .map(r => `<span class="h ${r.mult >= 1 ? 'w' : 'l'}">${r.mult}×</span>`).join('');
}
async function drop() {
    audio(); if (AC && AC.state === 'suspended') AC.resume();
    const stake = Math.max(1, +$('#bet').value || 0);
    if (stake > state.balance) { $('#res').textContent = 'LOW'; $('#res').className = 'lose'; return; }
    state.balance -= stake; $('#bal').textContent = state.balance.toFixed(2);
    const nonce = state.nonce++; $('#nonce').textContent = state.nonce;
    $('#reslab').textContent = 'DROPPING';
    const roll = await F.plinkoRoll(state.serverSeed, $('#clientSeed').value, nonce, ROWS);
    launch(roll, stake, nonce);
}

$('#dropBtn').onclick = drop;   // no blocking — spam away
$('#rerollBtn').onclick = () => { $('#clientSeed').value = F.randomHex(8); };
$('#revealBtn').onclick = async () => {
    if (!state.rounds.length) { $('#res').textContent = '—'; $('#res').className = 'idle'; return; }
    $('#revealBox').style.display = 'block';
    $('#serverSeed').textContent = state.serverSeed;
    const okC = (await F.commitment(state.serverSeed)) === state.commit;
    $('#revStatus').textContent = okC ? 'verified' : 'mismatch';
    $('#revStatus').className = 'badge ' + (okC ? 'ok' : 'bad-b');
    const tb = $('#verifyTbl').querySelector('tbody'); tb.innerHTML = '';
    for (const r of state.rounds.slice(-12)) {
        const { slot, portalHit } = await F.plinkoRoll(state.serverSeed, $('#clientSeed').value, r.nonce, ROWS);
        const ok = slot === r.slot && portalHit === r.portalHit;
        tb.innerHTML += `<tr><td>${r.nonce}</td><td>${r.slot}${r.portalHit ? '·P' : ''}</td><td>${slot}${portalHit ? '·P' : ''}</td><td class="${ok ? 'g' : 'r'}">${ok ? '✓' : '✗'}</td></tr>`;
    }
};

(async function init() {
    $('#clientSeed').value = F.randomHex(8);
    await newSession();
    requestAnimationFrame(frame);
})();
