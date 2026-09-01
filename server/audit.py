"""Monte-Carlo audit of the crash distribution and house edge."""

import statistics as st
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from crash import crash_point
from provably_fair import new_server_seed

N = 1_000_000
server = new_server_seed()
pts = [crash_point(server, "player-seed", n) for n in range(N)]

print(f"Monte-Carlo audit — {N:,} rounds\n")

print("Return to player at auto-cashout targets (fair = 0.9900):")
for t in (1.5, 2.0, 5.0, 10.0, 50.0):
    rtp = sum(1 for p in pts if p >= t) / N * t
    print(f"  {t:>5.2f}x  ->  RTP = {rtp:.4f}")

instant = sum(1 for p in pts if p == 1.00) / N
print(f"\nInstant crash (1.00x): {instant*100:.2f}%  (target 1.00%)")
print(f"Median: {st.median(pts):.2f}x  (theory ~2.00x)")
for t in (2, 5, 10, 100):
    p = sum(1 for x in pts if x >= t) / N
    print(f"  P(crash >= {t:>3}x) = {p*100:5.2f}%  (theory {99.0/t:5.2f}%)")
