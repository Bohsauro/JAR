"""Regression tests. Run from the repo root:  python -m unittest discover tests"""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pennyroute import providers, router_proxy


def _client(app, host="127.0.0.1"):
    from fastapi.testclient import TestClient
    return TestClient(app, client=(host, 5000))

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

    def test_spend_uses_openrouter_reported_cost_over_estimate(self):
        self._with_files({})
        usage = {"prompt_tokens": 1000, "completion_tokens": 10, "cost": 0.0123}

        with mock.patch.object(providers.orclient, "fetch_endpoints_raw") as prices:
            providers.record_usage("P", "m/x", usage)

        prices.assert_not_called()
        self.assertEqual(providers.load_usage()["P"]["total"]["spend"], 0.0123)

    def test_spend_falls_back_to_list_price_without_cost(self):
        self._with_files({})
        row = {"provider": "P", "in": 2.0, "cache": None, "out": 10.0}

        with mock.patch.object(providers.orclient, "fetch_endpoints_raw",
                               return_value=[row]):
            providers.record_usage("P", "m/x", {"prompt_tokens": 1000,
                                                "completion_tokens": 100})

        # (2.0 * 1000 + 10.0 * 100) / 1e6
        self.assertEqual(providers.load_usage()["P"]["total"]["spend"], 0.003)


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


class ApiRegressions(unittest.TestCase):
    def test_pipeline_survives_error_rows(self):
        from fastapi.testclient import TestClient
        from pennyroute import app as appmod
        chain = {"name": "c", "primary": True, "entries": []}
        with mock.patch.object(appmod.store, "load_chains", return_value=[chain]), \
             mock.patch.object(appmod.router_proxy, "build_candidates",
                               return_value=[{"model": "m", "provider": "p"}]), \
             mock.patch.object(appmod.ranking, "rank_endpoints",
                               return_value=[{"error": "boom"}]):
            r = _client(appmod.app).get("/api/pipeline")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["candidates"][0]["healthy"])

    def test_revoked_key_stays_revoked_and_verify_works(self):
        from pennyroute import keys
        with tempfile.TemporaryDirectory() as d, \
             mock.patch.object(keys, "KEYS_FILE", Path(d) / "keys.json"):
            k = keys.create_key("t")
            self.assertTrue(keys.verify_key("Bearer " + k["key"]))
            keys.revoke_key(k["id"])
            self.assertFalse(keys.verify_key(k["key"]))

    def test_empty_preset_rejected(self):
        from fastapi.testclient import TestClient
        from pennyroute import app as appmod
        with mock.patch.object(appmod.store, "save_models") as sm:
            r = _client(appmod.app).post("/api/presets/free")
        self.assertEqual(r.status_code, 400)
        sm.assert_not_called()


class MoreRegressions(unittest.TestCase):
    def test_settings_reject_bad_mix(self):
        from fastapi.testclient import TestClient
        from pennyroute import app as appmod
        c = _client(appmod.app)
        with mock.patch.object(appmod.store, "save_settings") as ss:
            for bad in ({"in": "x", "cache": 1, "out": 1}, {"in": 1},
                        {"in": 0, "cache": 0, "out": 0}, {"in": -1, "cache": 1, "out": 1}):
                self.assertEqual(c.put("/api/settings", json={"mix": bad}).status_code, 400)
            ss.assert_not_called()

    def test_auto_step_falls_to_next_healthy_endpoint(self):
        from pennyroute import ranking
        rows = [{"provider": "A", "healthy": True, "blended": 1},
                {"provider": "B", "healthy": True, "blended": 2}]
        chain = {"entries": [{"type": "model", "model": "m"}]}
        with mock.patch.object(ranking, "rank_endpoints", return_value=rows):
            res = ranking.resolve_chain(chain, [], {}, {}, provider_ok=lambda n: n == "B")
        self.assertEqual(res["provider"], "B")

    def test_endpoint_errors_expire_quickly(self):
        from pennyroute import orclient
        orclient._cache.clear()
        calls = []
        def fake(url, timeout=40):
            calls.append(1)
            return {"__error": "net"} if len(calls) == 1 else {"data": {"endpoints": []}}
        with mock.patch.object(orclient, "_get", fake):
            self.assertIn("error", orclient.fetch_endpoints_raw("a/b"))
            orclient._cache["ep:a/b"]["ts"] -= orclient.ERROR_TTL + 1
            self.assertEqual(orclient.fetch_endpoints_raw("a/b"), [])

    def test_events_file_is_trimmed(self):
        from pennyroute import store
        with tempfile.TemporaryDirectory() as d, \
             mock.patch.object(store, "EVENTS_FILE", Path(d) / "e.jsonl"), \
             mock.patch.object(store, "EVENTS_MAX_BYTES", 500), \
             mock.patch.object(store, "EVENTS_KEEP_LINES", 5):
            for i in range(50):
                store.log_event("t", {"i": i})
            n = len(store.EVENTS_FILE.read_text().splitlines())
        self.assertLessEqual(n, 10)


class HostingGuards(unittest.TestCase):
    def test_management_api_local_only_without_token(self):
        from pennyroute import app as appmod
        with mock.patch.dict("os.environ", {"PENNY_ADMIN_TOKEN": ""}):
            self.assertEqual(_client(appmod.app, "10.0.0.5").get("/api/settings").status_code, 403)
            self.assertEqual(_client(appmod.app).get("/api/settings").status_code, 200)
            self.assertEqual(_client(appmod.app).get(
                "/api/settings", headers={"X-Forwarded-For": "8.8.8.8"}).status_code, 403)

    def test_admin_token_required_remotely(self):
        from pennyroute import app as appmod, security
        security._hits.clear()
        with mock.patch.dict("os.environ", {"PENNY_ADMIN_TOKEN": "s3cret"}):
            c = _client(appmod.app, "10.0.0.5")
            self.assertEqual(c.get("/api/settings").status_code, 401)
            self.assertEqual(c.get("/api/settings", headers={"X-Admin-Token": "bad"}).status_code, 401)
            self.assertEqual(c.get("/api/settings", headers={"X-Admin-Token": "s3cret"}).status_code, 200)
            self.assertEqual(c.get("/api/settings",
                                   headers={"Authorization": "Bearer s3cret"}).status_code, 200)

    def test_failed_admin_attempts_get_throttled(self):
        from pennyroute import app as appmod, security
        security._hits.clear()
        with mock.patch.dict("os.environ", {"PENNY_ADMIN_TOKEN": "s3cret"}):
            c = _client(appmod.app, "10.0.0.6")
            codes = [c.get("/api/settings").status_code for _ in range(security.ADMIN_FAIL_LIMIT + 2)]
        self.assertEqual(codes[-1], 429)

    def test_v1_rate_limit(self):
        from pennyroute import app as appmod, security
        security._hits.clear()
        with mock.patch.dict("os.environ", {"PENNY_RATE_LIMIT": "3"}):
            c = _client(appmod.app, "10.0.0.7")
            codes = [c.get("/v1/models").status_code for _ in range(5)]
        self.assertEqual(codes[:3], [401] * 3)  # no key, but not rate limited yet
        self.assertEqual(codes[3:], [429, 429])

    def test_healthz_is_open(self):
        from pennyroute import app as appmod
        self.assertEqual(_client(appmod.app, "10.0.0.8").get("/healthz").status_code, 200)


class RouteChangeNotifications(unittest.TestCase):
    def _evaluate(self, last_point, resolution, webhook="https://hooks.example/x"):
        from pennyroute import engine, notify
        primary = {"name": "main", "primary": True, "auto_apply": False, "entries": []}
        settings = {"mix": {}, "min_tps": 0, "min_uptime": 0}
        env = {"PENNY_WEBHOOK_URL": webhook} if webhook else {}
        with mock.patch.dict("os.environ", env, clear=False), \
             mock.patch.object(engine.store, "load_settings", return_value=settings), \
             mock.patch.object(engine.store, "load_models", return_value=["m"]), \
             mock.patch.object(engine.store, "load_chains", return_value=[primary]), \
             mock.patch.object(engine.store, "load_telemetry",
                               return_value=[last_point] if last_point else []), \
             mock.patch.object(engine.store, "push_telemetry"), \
             mock.patch.object(engine.store, "log_event"), \
             mock.patch.object(engine.ranking, "rank_models", return_value=[]), \
             mock.patch.object(engine.ranking, "resolve_chain", return_value=resolution), \
             mock.patch.object(notify.httpx, "post") as post:
            if not webhook:
                import os
                os.environ.pop("PENNY_WEBHOOK_URL", None)
            engine.evaluate_primary()
        return post

    def test_route_change_posts_webhook(self):
        post = self._evaluate({"model": "a", "provider": "P", "blended": 1.0},
                              {"model": "b", "provider": "Q", "blended": 0.5,
                               "reason": "cheaper"})

        post.assert_called_once()
        body = post.call_args.kwargs["json"]
        self.assertIn("a @ P", body["text"])
        self.assertIn("b @ Q", body["text"])
        self.assertEqual(body["text"], body["content"])  # Slack/Telegram + Discord

    def test_same_route_does_not_notify(self):
        post = self._evaluate({"model": "a", "provider": "P", "blended": 1.0},
                              {"model": "a", "provider": "P", "blended": 0.9,
                               "reason": "x"})
        post.assert_not_called()

    def test_first_evaluation_does_not_notify(self):
        post = self._evaluate(None, {"model": "a", "provider": "P", "blended": 1.0,
                                     "reason": "x"})
        post.assert_not_called()

    def test_no_webhook_configured_does_not_notify(self):
        post = self._evaluate({"model": "a", "provider": "P", "blended": 1.0},
                              {"model": "b", "provider": "Q", "blended": 0.5,
                               "reason": "x"}, webhook=None)
        post.assert_not_called()

    def test_webhook_failure_is_logged_without_leaking_url(self):
        from pennyroute import notify
        with mock.patch.dict("os.environ", {"PENNY_WEBHOOK_URL": "https://h/secret-token"}), \
             mock.patch.object(notify.httpx, "post", side_effect=OSError("boom https://h/secret-token")), \
             mock.patch.object(notify.store, "log_event") as log:
            notify.route_changed({"model": "a", "provider": "P"},
                                 {"model": "b", "provider": "Q", "blended": 0.5})
        kind, detail = log.call_args.args
        self.assertEqual(kind, "notify_error")
        self.assertNotIn("secret-token", json.dumps(detail))


class OpenRouterKeyFromDashboard(unittest.TestCase):
    def setUp(self):
        from pennyroute import orclient
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.key_file = Path(tmp.name) / "openrouter_key"
        for patcher in (mock.patch.object(orclient, "SAVED_KEY_FILE", self.key_file),
                        mock.patch.dict("os.environ", {"OPENROUTER_API_KEY": "sk-or-env"})):
            patcher.start()
            self.addCleanup(patcher.stop)
        from pennyroute import app as appmod
        self.orclient = orclient
        self.c = _client(appmod.app)

    def test_valid_key_is_tested_saved_and_never_returned(self):
        with mock.patch.object(self.orclient, "test_key", return_value=(True, "")) as t:
            r = self.c.put("/api/openrouter-key", json={"key": " sk-or-NEW "})

        t.assert_called_once_with("sk-or-NEW")
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("sk-or-NEW", r.text)
        self.assertEqual(self.key_file.read_text().strip(), "sk-or-NEW")
        self.assertEqual(self.orclient.get_key(), "sk-or-NEW")  # beats the env var
        status = self.c.get("/api/openrouter-key")
        self.assertEqual(status.json(), {"configured": True, "source": "dashboard"})
        self.assertNotIn("sk-or", status.text)

    def test_rejected_key_is_not_saved(self):
        with mock.patch.object(self.orclient, "test_key",
                               return_value=(False, "OpenRouter rejected the key")):
            r = self.c.put("/api/openrouter-key", json={"key": "sk-or-BAD"})

        self.assertEqual(r.status_code, 400)
        self.assertNotIn("sk-or-BAD", r.text)
        self.assertFalse(self.key_file.exists())
        self.assertEqual(self.orclient.get_key(), "sk-or-env")

    def test_malformed_key_is_rejected_before_testing(self):
        with mock.patch.object(self.orclient, "test_key") as t:
            for bad in ("", "sk-or a", "sk-or\nX=1", "x" * 300):
                self.assertEqual(
                    self.c.put("/api/openrouter-key", json={"key": bad}).status_code, 400)
        t.assert_not_called()

    def test_status_reports_env_source(self):
        self.assertEqual(self.c.get("/api/openrouter-key").json(),
                         {"configured": True, "source": "environment"})


class DashboardCaching(unittest.TestCase):
    def test_dashboard_files_are_revalidated(self):
        from pennyroute import app as appmod
        c = _client(appmod.app)
        for path in ("/", "/landing", "/app.js", "/style.css"):
            self.assertEqual(c.get(path).headers.get("cache-control"), "no-cache", path)
