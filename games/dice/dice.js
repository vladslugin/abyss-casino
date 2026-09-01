import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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

// orientation that puts value V face-up
const up = {};
{
    const e = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    up[1] = e(0, 0, 0);
    up[6] = e(Math.PI, 0, 0);
    up[2] = e(-Math.PI / 2, 0, 0);
    up[5] = e(Math.PI / 2, 0, 0);
    up[3] = e(0, 0, Math.PI / 2);
    up[4] = e(0, 0, -Math.PI / 2);
}

function makeDie() {
    const m = new THREE.Mesh(new RoundedBoxGeometry(1.4, 1.4, 1.4, 5, 0.22), pipMats);
    m.castShadow = true;
    scene.add(m);
    return m;
}
const dice = [makeDie(), makeDie()];
const restY = 0.7;
dice[0].position.set(-1.6, restY, 0.4);
dice[1].position.set(1.6, restY, -0.2);
dice.forEach(d => d.quaternion.copy(up[1]));

// ── roll animation to a predetermined face ────────────────────────────────────
const easeOut = t => 1 - Math.pow(1 - t, 3);
function animateRoll(values, onDone) {
    const T = 1700;
    const start = performance.now();
    const setups = dice.map((d, i) => {
        const axis = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize();
        const spin = Math.PI * 2 * (3 + Math.floor(Math.random() * 3)) + Math.random() * Math.PI;
        const fromX = (i ? 2.6 : -2.6) + (Math.random() - .5);
        const toX = (i ? 1.6 : -1.6) + (Math.random() - .5) * 0.4;
        const toZ = (i ? -0.2 : 0.4) + (Math.random() - .5) * 0.4;
        return { axis, spin, target: up[values[i]].clone(), fromX, toX, toZ };
    });
    function frame(now) {
        const t = Math.min((now - start) / T, 1);
        const e = easeOut(t);
        dice.forEach((d, i) => {
            const s = setups[i];
            // position: horizontal ease + a couple of damped bounces settling to rest
            d.position.x = s.fromX + (s.toX - s.fromX) * e;
            d.position.z = s.toZ * e;
            const bounce = Math.abs(Math.cos(t * Math.PI * 2.5)) * (1 - e);
            d.position.y = restY + 5.2 * (1 - e) * (1 - e) + bounce * 1.4;
            // orientation: extra spin that decays into the target face
            const angle = (1 - e) * s.spin;
            d.quaternion.copy(s.target).premultiply(new THREE.Quaternion().setFromAxisAngle(s.axis, angle));
        });
        renderer.render(scene, camera);
        if (t < 1) requestAnimationFrame(frame);
        else { dice.forEach((d, i) => d.quaternion.copy(setups[i].target)); renderer.render(scene, camera); onDone(); }
    }
    requestAnimationFrame(frame);
}

function idleRender() {
    if (!state.rolling) {
        const t = performance.now() / 1000;
        dice.forEach((d, i) => { d.position.y = restY + Math.sin(t * 1.4 + i) * 0.05; });
        renderer.render(scene, camera);
    }
    requestAnimationFrame(idleRender);
}

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
    animateRoll([d1, d2], () => {
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
