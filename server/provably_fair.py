"""Provably-fair primitives shared by every game."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass

_BITS = 52
_MAX = 2 ** _BITS


def new_server_seed() -> str:
    return secrets.token_hex(32)


def commitment(server_seed: str) -> str:
    return hashlib.sha256(server_seed.encode()).hexdigest()


def hmac_hex(server_seed: str, client_seed: str, nonce: int) -> str:
    msg = f"{client_seed}:{nonce}".encode()
    return hmac.new(server_seed.encode(), msg, hashlib.sha256).hexdigest()


def uniform(server_seed: str, client_seed: str, nonce: int) -> int:
    """Top 52 bits of the round HMAC as an integer in [0, 2**52)."""
    return int(hmac_hex(server_seed, client_seed, nonce)[: _BITS // 4], 16)


def crash_uniform(server_seed: str, client_seed: str, nonce: int) -> int:
    """Top 52 bits of SHA256("server:client:nonce"), exactly as the TON contract
    (ton-abyss) computes them, so the contract can check any Crash round."""
    digest = hashlib.sha256(f"{server_seed}:{client_seed}:{nonce}".encode()).hexdigest()
    return int(digest[: _BITS // 4], 16)


def verify(server_seed: str, expected_commitment: str) -> bool:
    return hmac.compare_digest(commitment(server_seed), expected_commitment)


@dataclass
class SeedChain:
    """Pre-committed chain: seed[i] = SHA256(seed[i+1]), played tail-first."""

    seeds: list[str]

    @classmethod
    def generate(cls, length: int) -> "SeedChain":
        cur = new_server_seed()
        chain = [cur]
        for _ in range(length - 1):
            cur = hashlib.sha256(cur.encode()).hexdigest()
            chain.append(cur)
        return cls(seeds=list(reversed(chain)))

    @property
    def terminating_hash(self) -> str:
        """The one hash to publish before play: SHA256 of the first seed played.
        Every later seed hashes to the one played before it, so this commits to the
        whole chain without revealing any of it. (It used to hash the last seed,
        which is itself a seed of the chain and gave away every round before it.)"""
        return hashlib.sha256(self.seeds[0].encode()).hexdigest()
