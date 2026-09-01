"""Crash game: multiplier derivation, rounds, bets, settlement."""

from __future__ import annotations

from dataclasses import dataclass, field

from provably_fair import SeedChain, commitment, uniform

_MAX = 2 ** 52


def crash_point(server_seed: str, client_seed: str, nonce: int) -> float:
    """Multiplier for one round. 1% house edge folded into the distribution
    via the exact closed form: floor((100*E - h)/(E - h)) / 100."""
    h = uniform(server_seed, client_seed, nonce) or 1
    x100 = (100 * _MAX - h) // (_MAX - h)
    return max(100, x100) / 100.0


@dataclass
class Bet:
    player: str
    amount: float
    auto_cashout: float | None = None
    cashed_at: float | None = None


@dataclass
class Round:
    nonce: int
    client_seed: str
    crash: float
    bets: list[Bet] = field(default_factory=list)

    def settle(self) -> dict[str, float]:
        out = {}
        for b in self.bets:
            cash = b.cashed_at if b.cashed_at is not None else b.auto_cashout
            out[b.player] = round(b.amount * cash, 2) if cash and cash < self.crash else 0.0
        return out


class CrashGame:
    def __init__(self, chain_length: int = 10_000):
        self._chain = SeedChain.generate(chain_length)
        self._idx = 0
        self.client_seed = "default-client-seed"
        self.nonce = 0

    @property
    def public_commitment(self) -> str:
        return commitment(self._chain.seeds[self._idx])

    def play_round(self, client_seed: str | None = None) -> Round:
        cs = client_seed or self.client_seed
        r = Round(self.nonce, cs, crash_point(self._chain.seeds[self._idx], cs, self.nonce))
        self.nonce += 1
        return r

    def reveal(self) -> str:
        seed = self._chain.seeds[self._idx]
        self._idx = min(self._idx + 1, len(self._chain.seeds) - 1)
        self.nonce = 0
        return seed


if __name__ == "__main__":
    g = CrashGame(chain_length=100)
    print("commitment:", g.public_commitment)
    r = g.play_round("alice-seed")
    r.bets = [Bet("alice", 100, auto_cashout=2.0), Bet("bob", 50, auto_cashout=10.0)]
    print(f"round #{r.nonce}: crashed at {r.crash:.2f}x")
    print("payouts:", r.settle())
