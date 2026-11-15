"""Regression tests. Run from the repo root:  python -m unittest discover tests"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pennyroute import providers, router_proxy

DAY_LIMIT = {"P": {"note": "", "blocked": False,
                   "limits": {"requests": {"per": "day", "max": 10.0}}}}


def _day_usage(window: str) -> dict:
    return {"P": {"day": {"window": window, "requests": 10, "tokens_in": 0,
                          "tokens_out": 0, "spend": 0.0, "last_used": None}}}


class UsageWindowTest(unittest.TestCase):
    def _with_files(self, usage: dict):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        reg, use = Path(tmp.name) / "providers.json", Path(tmp.name) / "usage.json"
        reg.write_text(json.dumps(DAY_LIMIT))
        use.write_text(json.dumps(usage))
        for name, path in (("REGISTRY_FILE", reg), ("USAGE_FILE", use)):
            patcher = mock.patch.object(providers, name, path)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_day_limit_exhausted_yesterday_is_available_again_today(self):
        self._with_files(_day_usage("2000-01-01"))

        self.assertTrue(providers.is_available("P")["available"])
        self.assertEqual(providers.limits_status("P")["requests"]["used"], 0.0)
        self.assertEqual(providers.load_usage()["P"]["day"]["requests"], 0)

    def test_day_limit_exhausted_today_stays_unavailable(self):
        self._with_files(_day_usage(providers._window("day")))

        self.assertEqual(providers.is_available("P"),
                         {"available": False, "reasons": ["requests/day exhausted"]})


class _FakeUpstream:
    def __init__(self, chunks: list[bytes]):
        self._chunks = chunks

    async def aiter_bytes(self):
        for chunk in self._chunks:
            yield chunk


class StreamPassthroughTest(unittest.TestCase):
    def test_multibyte_char_split_across_chunks_reaches_the_client_intact(self):
        payload = ('data: {"content": "perché"}\n\n'
                   'data: {"usage": {"prompt_tokens": 3, "completion_tokens": 2}}\n\n'
                   ).encode("utf-8")
        cut = payload.index("é".encode("utf-8")) + 1  # inside the 2-byte char
        upstream = _FakeUpstream([payload[:cut], payload[cut:]])

        async def collect() -> bytes:
            stream = router_proxy._wrap_stream(upstream, "m", "P")
            return b"".join([chunk async for chunk in stream])

        with mock.patch.object(router_proxy.providers, "record_usage") as record:
            out = asyncio.run(collect())

        self.assertEqual(out, payload)
        record.assert_called_once_with(
            "P", "m", {"prompt_tokens": 3, "completion_tokens": 2})


if __name__ == "__main__":
    unittest.main()
