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

function randomHex(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

window.Fair = { sha256Hex, hmacSha256Hex, commitment, crashPoint, randomHex };
