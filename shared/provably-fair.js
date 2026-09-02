// Provably-fair core shared by all games. Mirrors server/provably_fair.py.
const BITS = 52n;
const MAX = 2n ** BITS;

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(key, msg) {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const commitment = (serverSeed) => sha256Hex(serverSeed);

async function crashPoint(serverSeed, clientSeed, nonce) {
  const digest = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}`);
  let h = BigInt("0x" + digest.slice(0, Number(BITS) / 4));
  if (h === 0n) h = 1n;
  let x100 = (100n * MAX - h) / (MAX - h);
  if (x100 < 100n) x100 = 100n;
  return Number(x100) / 100;
}

// Two dice (1-6 each) from one round HMAC.
async function diceRoll(serverSeed, clientSeed, nonce) {
  const digest = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}`);
  const d1 = (parseInt(digest.slice(0, 8), 16) % 6) + 1;
  const d2 = (parseInt(digest.slice(8, 16), 16) % 6) + 1;
  return [d1, d2];
}

// Plinko: a left/right path down N rows, the landing slot, and a bonus portal
// sitting on the path (row + position). If the ball passes through the portal
// its multiplier is doubled. Everything comes from one round HMAC.
async function plinkoRoll(serverSeed, clientSeed, nonce, rows = 12) {
  const digest = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}`);
  let pool = BigInt("0x" + digest);
  const path = [];
  for (let i = 0; i < rows; i++) { path.push(Number(pool & 1n)); pool >>= 1n; }
  const slot = path.reduce((a, b) => a + b, 0);

  const portalRow = 3 + Number(pool % 7n); pool >>= 3n;   // rows 3..9
  const portalPos = Number(pool % BigInt(portalRow + 1)); pool >>= 4n;
  const ballPos = path.slice(0, portalRow).reduce((a, b) => a + b, 0);
  const portalHit = ballPos === portalPos;

  return { path, slot, portalRow, portalPos, portalHit };
}

// Mines: which tiles hide bombs. A deterministic Fisher-Yates shuffle keyed by
// the round HMAC picks `mineCount` positions out of `tiles`. Rejection sampling
// keeps it unbiased; the keystream extends with a counter if a block runs out.
async function minesField(serverSeed, clientSeed, nonce, mineCount, tiles = 25) {
  const order = [...Array(tiles).keys()];
  let block = "", pos = 0, ctr = 0;
  async function byte() {
    if (pos >= block.length) { block = await hmacSha256Hex(serverSeed, `${clientSeed}:${nonce}:${ctr++}`); pos = 0; }
    const b = parseInt(block.slice(pos, pos + 2), 16); pos += 2; return b;
  }
  for (let i = tiles - 1; i > 0; i--) {
    const range = i + 1, limit = 256 - (256 % range);
    let r; do { r = await byte(); } while (r >= limit);
    const j = r % range;
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, mineCount).sort((a, b) => a - b);
}

function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

window.Fair = { sha256Hex, hmacSha256Hex, commitment, crashPoint, diceRoll, plinkoRoll, minesField, randomHex };
