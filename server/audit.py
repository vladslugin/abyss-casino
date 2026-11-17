"""Checks the fairness primitives, then runs a Monte-Carlo audit of Crash."""

import statistics as st
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from crash import Bet, Round, crash_point
from provably_fair import SeedChain, commitment, new_server_seed

# Multipliers returned by the TON contract's crashPoint getter (ton-abyss, in the
# sandbox) for these inputs. The game has to produce exactly the same numbers.
CONTRACT = [
    (("0123456789abcdef" * 4, "player-seed", 0), 7.89),
    (("0123456789abcdef" * 4, "player-seed", 1), 5.32),
    (("0123456789abcdef" * 4, "player-seed", 42), 2.00),
    (("0123456789abcdef" * 4, "c" * 64, 7), 1.75),
    (("0123456789abcdef" * 4, "alice-seed", 4294967295), 2.01),
]
for args, expected in CONTRACT:
    assert crash_point(*args) == expected, (args, crash_point(*args), expected)

chain = SeedChain.generate(100)
assert chain.terminating_hash == commitment(chain.seeds[0])
assert chain.terminating_hash not in chain.seeds, "the published hash must not be a seed"
for earlier, later in zip(chain.seeds, chain.seeds[1:]):
    assert commitment(later) == earlier

edge = Round(0, "c", 2.0, [Bet("exact", 10, auto_cashout=2.0), Bet("above", 10, auto_cashout=2.01)])
assert edge.settle() == {"exact": 20.0, "above": 0.0}

print("Checks: same multipliers as the TON contract, seed chain, cash-out at the crash point\n")

N = 1_000_000
server = new_server_seed()
pts = [crash_point(server, "player-seed", n) for n in range(N)]

print(f"Monte-Carlo audit — {N:,} rounds\n")

print("Return to player at auto-cashout targets (fair = 0.9900):")
for t in (1.01, 1.5, 2.0, 5.0, 10.0, 50.0):
    rtp = sum(1 for p in pts if p >= t) / N * t
    print(f"  {t:>5.2f}x  ->  RTP = {rtp:.4f}")

instant = sum(1 for p in pts if p == 1.00) / N
print(f"\nInstant crash (1.00x): {instant*100:.2f}%  (theory {100 - 99 / 1.01:.2f}%)")
print(f"Median: {st.median(pts):.2f}x  (theory 1.98x)")
for t in (2, 5, 10, 100):
    p = sum(1 for x in pts if x >= t) / N
    print(f"  P(crash >= {t:>3}x) = {p*100:5.2f}%  (theory {99.0/t:5.2f}%)")
