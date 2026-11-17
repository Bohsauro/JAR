"""PennyRoute — OpenRouter API client with in-memory caching.

Endpoints data is cached raw (10 min) so re-ranking with different cost mixes
never re-fetches. The full catalog is cached for 1 h (used for model search).
"""

import json
import os
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

import httpx

HOME = Path.home()
ENV_FILE = HOME / ".hermes" / ".env"
# key entered in the dashboard; data/ is the one directory persisted in Docker
SAVED_KEY_FILE = Path(__file__).resolve().parent.parent / "data" / "openrouter_key"
KEY_TEST_URL = "https://openrouter.ai/api/v1/key"
KEY_TEST_TIMEOUT_S = 10

ENDPOINTS_TTL = 600
ERROR_TTL = 30  # failures are retried soon, not cached like good data
CATALOG_TTL = 3600

_lock = threading.Lock()
_cache: dict = {}


def _env_file_key(path: Path, name: str = "OPENROUTER_API_KEY") -> str:
    try:
        for line in path.read_text().splitlines():
            if line.startswith(name + "="):
                v = line.split("=", 1)[1].strip()
                if v:
                    return v
    except OSError:
        pass
    return ""


def _key_lookup() -> tuple[str | None, str]:
    """(source, key). The dashboard key wins: saving one is an explicit choice."""
    try:
        saved = SAVED_KEY_FILE.read_text().strip()
    except OSError:
        saved = ""
    if saved:
        return "dashboard", saved
    env = (os.environ.get("OPENROUTER_API_KEY") or "").strip()
    if env:
        return "environment", env
    # project-local .env (gitignored): the installer writes the key here
    local = _env_file_key(Path.cwd() / ".env")
    if local:
        return ".env", local
    hermes = _env_file_key(ENV_FILE, "OPENROUTER_API_" + "KEY")
    if hermes:
        return "hermes", hermes
    return None, ""


def get_key() -> str:
    return _key_lookup()[1]


def key_source() -> str | None:
    return _key_lookup()[0]


def test_key(key: str) -> tuple[bool, str]:
    """Ask OpenRouter whether the key is valid. Never echoes the key back."""
    try:
        r = httpx.get(KEY_TEST_URL, headers={"Authorization": f"Bearer {key}"},
                      timeout=KEY_TEST_TIMEOUT_S)
    except httpx.HTTPError as e:
        return False, f"could not reach OpenRouter ({type(e).__name__})"
    if r.status_code == 200:
        return True, ""
    if r.status_code in (401, 403):
        return False, "OpenRouter rejected the key"
    return False, f"OpenRouter answered {r.status_code}"


def save_key(key: str) -> None:
    """Atomic write, owner-only permissions where the OS supports them."""
    SAVED_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SAVED_KEY_FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key + "\n")
    os.replace(tmp, SAVED_KEY_FILE)


def _get(url: str, timeout: int = 40):
    """GET JSON. Returns {'__error': str} on any failure (never raises)."""
    key = get_key()
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception as e:  # noqa: BLE001 — report, don't crash the router
        return {"__error": str(e)}


def _g(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_endpoints_raw(slug: str, force: bool = False) -> list | dict:
    """Raw endpoint list for a model. list on success, {'error': ...} on failure."""
    now = time.time()
    with _lock:
        hit = _cache.get("ep:" + slug)
        ttl = ERROR_TTL if hit and isinstance(hit["data"], dict) else ENDPOINTS_TTL
        if hit and not force and now - hit["ts"] < ttl:
            return hit["data"]

    enc = urllib.parse.quote(slug, safe="/")
    data = _get(f"https://openrouter.ai/api/v1/models/{enc}/endpoints")
    if "__error" in data:
        raw = {"error": data["__error"]}
    else:
        eps = (data.get("data") or {}).get("endpoints") or []
        rows = []
        for ep in eps:
            pn = ep.get("provider_name")
            if not pn:
                continue
            pr = ep.get("pricing") or {}
            disc = _g(pr.get("discount")) or 0.0
            mult = 1.0 - disc
            prompt = _g(pr.get("prompt"))
            cache = _g(pr.get("input_cache_read"))
            comp = _g(pr.get("completion"))
            if prompt is None:
                continue
            rows.append({
                "provider": pn,
                "quant": ep.get("quantization") or "",
                "in": prompt * mult * 1e6,
                # cache not exposed -> pessimistic estimate = input price
                "cache": (cache * mult * 1e6) if cache is not None else (prompt * mult * 1e6),
                "cache_est": cache is None,
                "out": (comp * mult * 1e6) if comp is not None else None,
                "discount": disc,
                "latency": _g((ep.get("latency_last_30m") or {}).get("p50")),
                "tps": _g((ep.get("throughput_last_30m") or {}).get("p50")),
                "uptime": _g(ep.get("uptime_last_1d")),
            })
        raw = rows
    with _lock:
        _cache["ep:" + slug] = {"ts": now, "data": raw}
    return raw


# Catalog classification (spec 1.3). Ordered: first tag match wins.
TAG_RULES = [
    ("reasoning", ["r1", "o1", "o3", "o4", "thinking", "reasoner"]),
    ("coding",    ["code", "coder"]),
    ("vision",    ["vision", " vl", "multimodal"]),
    ("embedding", ["embed", "ada"]),
    ("image",     ["image", "dall-e", "flux", "sdxl", "stable-diffusion", "pixel"]),
    ("audio",     ["audio", "whisper", "tts", "speech", "music"]),
    ("agent",     ["agent"]),
]


def _tier(in_pm):
    """Tier from prompt $/M (missing price → unknown)."""
    if in_pm is None:
        return "unknown"
    if in_pm <= 0:
        return "free"
    if in_pm < 0.5:
        return "budget"
    if in_pm < 1.5:
        return "value"
    if in_pm < 5:
        return "mid"
    if in_pm < 15:
        return "premium"
    return "ultra"


def _tags(mid: str, name: str) -> list:
    hay = ((mid or "") + " " + (name or "")).lower()
    for tag, needles in TAG_RULES:
        for n in needles:
            if n in hay:
                return [tag]
    return []


def _catalog_entry(m) -> dict:
    mid = m.get("id") or ""
    name = m.get("name") or ""
    pr = m.get("pricing") or {}
    in_t = _g(pr.get("prompt"))
    in_pm = (in_t * 1e6) if in_t is not None else None
    out_t = _g(pr.get("completion"))
    out_pm = (out_t * 1e6) if out_t is not None else None
    return {
        "id": mid,
        "name": name,
        "in": in_t,
        "out": out_t,
        "ctx": m.get("context_length"),
        "family": mid.split("/")[0] if mid else "",
        "tier": _tier(in_pm),
        "tags": _tags(mid, name),
        "in_$M": in_pm,
        "out_$M": out_pm,
    }


def fetch_catalog(force: bool = False) -> list | dict:
    """Full model catalog (id, name, list pricing, family/tier/tags)."""
    now = time.time()
    with _lock:
        hit = _cache.get("catalog")
        ttl = ERROR_TTL if hit and isinstance(hit["data"], dict) else CATALOG_TTL
        if hit and not force and now - hit["ts"] < ttl:
            return hit["data"]
    data = _get("https://openrouter.ai/api/v1/models", timeout=60)
    if "__error" in data:
        out = {"error": data["__error"]}
    else:
        out = [_catalog_entry(m) for m in (data.get("data") or [])]
    with _lock:
        _cache["catalog"] = {"ts": now, "data": out}
    return out


