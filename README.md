# Abyss

Provably-fair casino games with a live, verifiable Crash implementation.
Every outcome is committed before the bet and reproducible after it, so any
round can be independently checked with cryptographic proof.

**[Play Crash »](games/crash/index.html)** — runs fully client-side.

## Games

| Game | Status | House edge |
|------|--------|-----------|
| Crash | Live | 1.00% |
| Dice | Planned | 1.00% |
| Mines | Planned | 1.00% |
| Plinko | Planned | 1.00% |

## Fairness

Standard commit–reveal:

```
1. Server publishes  SHA256(server_seed)   before any bet          (commitment)
2. Player sets their own  client_seed                              (no cherry-picking)
3. outcome = f(server_seed, client_seed, nonce)  via HMAC-SHA256
4. Server reveals server_seed afterwards:
     re-hash it   -> must equal the commitment   (seed not swapped)
     recompute it -> must equal the outcome       (round not rigged)
```

A seed chain (`seed[i] = SHA256(seed[i+1])`, played tail-first) commits to
every future round with a single published hash, so rounds cannot be inserted
or reordered.

### Crash multiplier

Exact closed form in integer arithmetic, 1% edge folded into the distribution:

```
h        = top 52 bits of HMAC-SHA256(server_seed, "client_seed:nonce")
crash    = max(1.00, floor((100·2⁵² − h) / (2⁵² − h)) / 100)
```

The multiplier is `1.00×` exactly when `h < 2⁵²/100` — a clean 1% of rounds.

## Audit

`python server/audit.py` runs a 1,000,000-round Monte-Carlo check:

```
Instant crash (1.00x): 1.01%   (target 1.00%)
Median: 1.98x                  (theory ~2.00x)
P(crash >=   2x) = 49.75%      (theory 49.50%)
P(crash >= 100x) =  0.99%      (theory  0.99%)
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

No dependencies beyond the Python standard library.

## License

MIT
