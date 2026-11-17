# Abyss

Provably-fair casino games with a live, verifiable Crash implementation.
Every outcome is committed before the bet and reproducible after it, so any
round can be independently checked with cryptographic proof.

**[Play Crash »](games/crash/index.html)** — runs fully client-side.

## Games

| Game | Status | House edge |
|------|--------|-----------|
| Crash | Live | 1.00% |
| Dice | Live | 1.00% |
| Mines | Planned | 1.00% |
| Plinko | Planned | 1.00% |

## Fairness

Standard commit–reveal:

```
1. Server publishes  SHA256(server_seed)   before any bet          (commitment)
2. Player sets their own  client_seed                              (no cherry-picking)
3. outcome = f(server_seed, client_seed, nonce)
4. Server reveals server_seed afterwards:
     re-hash it   -> must equal the commitment   (seed not swapped)
     recompute it -> must equal the outcome       (round not rigged)
```

Crash derives the outcome from `SHA256("server_seed:client_seed:nonce")`, exactly as
the TON contract [ton-abyss](https://github.com/vladslugin/ton-abyss) does, so its
`crashPoint` getter returns the same multiplier for any revealed round. The other
games use HMAC-SHA256 keyed with the server seed.

A seed chain (`seed[i] = SHA256(seed[i+1])`, played tail-first) commits to
every future round with a single published hash, `SeedChain.terminating_hash`:
the SHA-256 of the first seed played. Rounds cannot be inserted or reordered.

### Crash multiplier

Exact closed form in integer arithmetic, the same as in the contract:

```
h        = top 52 bits of SHA256("server_seed:client_seed:nonce")
crash    = max(1.00, floor(99·2⁵² / (2⁵² − h)) / 100)
```

`P(crash ≥ t) = 0.99 / t`, so a bet on any target from 1.01× returns 0.99 on
average: a 1% edge for every target. About 1.98% of rounds end at 1.00×.
An auto cash-out exactly at the crash point wins, as in the contract.

The first version used `(100·2⁵² − h) / (2⁵² − h)` and called its 1% of instant
crashes the house edge. The real edge of that formula depends on the target: 0.01%
at 1.01×, 0.5% at 2×, close to 1% only at high targets.

## Audit

`python server/audit.py` first checks that Crash returns the same multipliers as
the TON contract, that the seed chain and its published hash are correct, and that
a cash-out at the crash point wins. Then it runs a 1,000,000-round Monte-Carlo check:

```
Return to player at auto-cashout targets (fair = 0.9900):
   1.01x  ->  RTP = 0.9898
   2.00x  ->  RTP = 0.9896
  10.00x  ->  RTP = 0.9902

Instant crash (1.00x): 2.00%  (theory 1.98%)
Median: 1.97x  (theory 1.98x)
  P(crash >=   2x) = 49.48%  (theory 49.50%)
  P(crash >= 100x) =  0.99%  (theory  0.99%)
```

The browser verifier and the Python server produce byte-identical output for
the same inputs, so client-side verification is genuinely independent.

## Structure

```
index.html            game lobby
shared/
  provably-fair.js    fairness core (browser)
games/
  crash/              crash game (index.html + crash.js)
server/
  provably_fair.py    fairness core (server)
  crash.py            rounds, bets, settlement
  audit.py            Monte-Carlo fairness audit
```

## Run

```bash
# audit + server smoke test
python server/audit.py
python server/crash.py

# play locally
python -m http.server 8000
# open http://localhost:8000
```

The Python side has no dependencies beyond the standard library. Dice loads three.js from a CDN in the browser.

## License

MIT
