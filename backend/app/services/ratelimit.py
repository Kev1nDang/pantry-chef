"""A small in-memory sliding-window rate limiter.

Per process only: with several API workers each one keeps its own counts. Good enough to stop a
runaway client from burning Claude credits; move to Redis or Postgres if the API scales out.
"""

import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, window_seconds: float = 60.0) -> None:
        self.window = window_seconds
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int) -> float | None:
        """Record a request. Returns None if allowed, else seconds until the next free slot."""
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= limit:
                return self.window - (now - hits[0])
            hits.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


ai_limiter = RateLimiter()
