import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as CANNON from 'cannon-es';

const $ = s => document.querySelector(s);
const F = window.Fair;

const PAYOUT = { under: 2.376, seven: 5.94, over: 2.376 };
const state = {
    serverSeed: null, commit: null, nonce: 0, balance: 1000,
    bet: 'under', rolling: false, rounds: [],
};

// ── three.js scene ────────────────────────────────────────────────────────────
const cv = $('#cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 8.2, 7.2);
camera.lookAt(0, 0.4, 0);

function resize() {
    const r = cv.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// lights — soft hyper-casual
scene.add(new THREE.AmbientLight(0xdfe8ff, 0.75));
const key = new THREE.DirectionalLight(0xfff2d8, 1.5);
key.position.set(4, 10, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1; key.shadow.camera.far = 30;
key.shadow.camera.left = -8; key.shadow.camera.right = 8;
key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
key.shadow.bias = -0.0004;
scene.add(key);
const rim = new THREE.DirectionalLight(0x48d3e6, 0.5);
rim.position.set(-6, 4, -4);
scene.add(rim);

// table — a soft rounded mat
const table = new THREE.Mesh(
    new RoundedBoxGeometry(12, 0.8, 9, 6, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x2c3566, roughness: 0.9, metalness: 0 })
);
table.position.y = -0.4;
table.receiveShadow = true;
scene.add(table);

// pip textures for faces 1..6
function pipTexture(n) {
    const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d');
    x.fillStyle = '#f4f6fb'; x.fillRect(0, 0, s, s);
    x.fillStyle = '#1a2233';
    const p = 0.26, m = 0.5, q = 0.74;
    const spots = {
        1: [[m, m]],
        2: [[p, p], [q, q]],
        3: [[p, p], [m, m], [q, q]],
        4: [[p, p], [q, p], [p, q], [q, q]],
        5: [[p, p], [q, p], [m, m], [p, q], [q, q]],
        6: [[p, p], [q, p], [p, m], [q, m], [p, q], [q, q]],
    }[n];
    for (const [px, py] of spots) {
        x.beginPath(); x.arc(px * s, py * s, s * 0.09, 0, 7); x.fill();
    }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
}
// BoxGeometry material order: +X,-X,+Y,-Y,+Z,-Z  →  faces 3,4,1,6,2,5 (opposite sum 7)
const faceValues = [3, 4, 1, 6, 2, 5];
const pipMats = faceValues.map(v => new THREE.MeshStandardMaterial({
    map: pipTexture(v), roughness: 0.55, metalness: 0.05,
}));

// ── physics ───────────────────────────────────────────────────────────────────
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -14, 0) });
world.defaultContactMaterial.restitution = 0.45;   // how bouncy
world.defaultContactMaterial.friction = 0.28;
world.allowSleep = false;

// static table top at y = 0, plus invisible walls so dice stay on it
const tableBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(6, 0.4, 4.5)) });
tableBody.position.set(0, -0.4, 0);
world.addBody(tableBody);
for (const [x, z, hx, hz] of [[5.6, 0, 0.3, 4.5], [-5.6, 0, 0.3, 4.5], [0, 4.2, 6, 0.3], [0, -4.2, 6, 0.3]]) {
    const w = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Box(new CANNON.Vec3(hx, 2, hz)) });
    w.position.set(x, 1, z);
    world.addBody(w);
}

const HALF = 0.7;
function makeDie() {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(1.4, 1.4, 1.4, 5, 0.22), pipMats);
    mesh.castShadow = true;
    scene.add(mesh);
    const body = new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(HALF, HALF, HALF)) });
    body.linearDamping = 0.04;
    body.angularDamping = 0.06;
    world.addBody(body);
    return { mesh, body };
}
const dice = [makeDie(), makeDie()];

// which value ends up on top, read from an orientation
const faceDirs = [
    { n: new THREE.Vector3(1, 0, 0), v: 3 }, { n: new THREE.Vector3(-1, 0, 0), v: 4 },
    { n: new THREE.Vector3(0, 1, 0), v: 1 }, { n: new THREE.Vector3(0, -1, 0), v: 6 },
    { n: new THREE.Vector3(0, 0, 1), v: 2 }, { n: new THREE.Vector3(0, 0, -1), v: 5 },
];
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
function topFace(q) {
    _q.set(q.x, q.y, q.z, q.w);
    let best = -2, val = 1;
    for (const f of faceDirs) { const y = _v.copy(f.n).applyQuaternion(_q).y; if (y > best) { best = y; val = f.v; } }
    return val;
}
function syncMeshes() {
    for (const d of dice) { d.mesh.position.copy(d.body.position); d.mesh.quaternion.copy(d.body.quaternion); }
}

const rand = (a, b) => a + Math.random() * (b - a);
function randomThrow() {
    return dice.map((_, i) => ({
        pos: [(i ? 1.7 : -1.7) + rand(-.4, .4), rand(4.2, 6), rand(-1.2, 1.2)],
        q: new CANNON.Quaternion().setFromEuler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)),
        vel: [rand(-2, 2), rand(0, 1.2), rand(-2, 2)],
        av: [rand(-11, 11), rand(-11, 11), rand(-11, 11)],
    }));
}
function applyThrow(t) {
    dice.forEach((d, i) => {
        const c = t[i];
        d.body.position.set(...c.pos);
        d.body.quaternion.copy(c.q);
        d.body.velocity.set(...c.vel);
        d.body.angularVelocity.set(...c.av);
    });
}
const asleep = () => dice.every(d =>
    d.body.velocity.length() < 0.08 && d.body.angularVelocity.length() < 0.08);

// headless simulation — where does this throw land?
function simulate(t) {
    applyThrow(t);
    for (let i = 0; i < 480; i++) { world.step(1 / 60); if (i > 40 && asleep()) break; }
    return dice.map(d => topFace(d.body.quaternion));
}
// pick a real throw that happens to land on the fair result
function findThrow(d1, d2) {
    for (let k = 0; k < 500; k++) {
        const t = randomThrow();
        const [a, b] = simulate(t);
        if (a === d1 && b === d2) return t;
    }
    return randomThrow();
}
// play it for real, with rendering
function playThrow(t, onDone) {
    applyThrow(t);
    let steps = 0;
    (function frame() {
        world.step(1 / 60); syncMeshes(); renderer.render(scene, camera); steps++;
        if (steps < 480 && !(steps > 40 && asleep())) requestAnimationFrame(frame);
        else onDone();
    })();
}

// settle dice at rest for the idle view
applyThrow(randomThrow());
for (let i = 0; i < 300; i++) { world.step(1 / 60); if (i > 40 && asleep()) break; }
syncMeshes();

function idleRender() { renderer.render(scene, camera); requestAnimationFrame(idleRender); }

// ── game ──────────────────────────────────────────────────────────────────────
function outcome(sum, bet) {
    if (bet === 'seven') return sum === 7;
    if (bet === 'under') return sum < 7;
    return sum > 7;
}
function setPhase(t, cls) { $('#phase').innerHTML = `<span class="${cls || 'idle'}">${t}</span>`; }

async function newSession() {
    state.serverSeed = F.randomHex(32);
    state.commit = await F.commitment(state.serverSeed);
    state.nonce = 0; state.rounds = [];
    $('#commit').textContent = state.commit; $('#nonce').textContent = 0;
    $('#revealBox').style.display = 'none'; renderHistory();
}
function renderHistory() {
    $('#history').innerHTML = state.rounds.slice(-14).reverse()
        .map(r => `<span class="h ${r.win ? 'w' : 'l'}">${r.d1}+${r.d2}</span>`).join('');
}

async function roll() {
    if (state.rolling) return;
    const stake = Math.max(1, +$('#bet').value || 0);
    if (stake > state.balance) { setPhase('not enough balance', 'lose'); return; }
    state.rolling = true;
    state.balance -= stake; $('#bal').textContent = state.balance.toFixed(2);
    $('#rollBtn').disabled = true; $('#sum').className = 'rolling'; $('#sum').textContent = '…';
    setPhase('rolling', 'rolling');

    const [d1, d2] = await F.diceRoll(state.serverSeed, $('#clientSeed').value, state.nonce);
    const t = findThrow(d1, d2);   // pre-simulate to a throw that lands on the fair result
    playThrow(t, () => {
        const sum = d1 + d2;
        const win = outcome(sum, state.bet);
        $('#sum').textContent = String(sum);
        $('#sum').className = win ? 'win' : 'lose';
        if (win) {
            const prize = stake * PAYOUT[state.bet];
            state.balance += prize; $('#bal').textContent = state.balance.toFixed(2);
            setPhase(`+${prize.toFixed(2)} — ${d1} + ${d2} = ${sum}`, 'win');
        } else {
            setPhase(`${d1} + ${d2} = ${sum} — no win`, 'lose');
        }
        state.rounds.push({ nonce: state.nonce, d1, d2, win });
        state.nonce++; $('#nonce').textContent = state.nonce; renderHistory();
        state.rolling = false; $('#rollBtn').disabled = false;
    });
}

// ── wiring ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.pick').forEach(el => el.onclick = () => {
    if (state.rolling) return;
    document.querySelectorAll('.pick').forEach(p => p.classList.remove('on'));
    el.classList.add('on'); state.bet = el.dataset.bet;
});
$('#rollBtn').onclick = roll;
$('#rerollBtn').onclick = () => { $('#clientSeed').value = F.randomHex(8); };
$('#revealBtn').onclick = async () => {
    if (!state.rounds.length) { setPhase('play a round first', 'idle'); return; }
    $('#revealBox').style.display = 'block';
    $('#serverSeed').textContent = state.serverSeed;
    const okC = (await F.commitment(state.serverSeed)) === state.commit;
    $('#revStatus').textContent = okC ? 'verified' : 'mismatch';
    $('#revStatus').className = 'badge ' + (okC ? 'ok' : 'bad-b');
    const tb = $('#verifyTbl').querySelector('tbody'); tb.innerHTML = '';
    for (const r of state.rounds) {
        const [a, b] = await F.diceRoll(state.serverSeed, $('#clientSeed').value, r.nonce);
        const ok = a === r.d1 && b === r.d2;
        tb.innerHTML += `<tr><td>${r.nonce}</td><td>${r.d1}+${r.d2}</td><td>${a}+${b}</td><td class="${ok ? 'g' : 'r'}">${ok ? '✓' : '✗'}</td></tr>`;
    }
};

(async function init() {
    resize();
    $('#clientSeed').value = F.randomHex(8);
    await newSession();
    idleRender();
})();
