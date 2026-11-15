"""PennyRoute — per-provider registry + usage tracking (v2.0).

Registry (`data/providers.json`) is user-configured and only written via API.
Usage (`data/usage.json`) is auto-recorded by the router and never hand-edited.

All public functions are thread-safe (internal lock). Windows auto-rotate on
write: day → YYYY-MM-DD, month → YYYY-MM, total → "all".
"""

import datetime
import threading
import time

from . import orclient
from .store import DATA_DIR, _read_json, _write_json

REGISTRY_FILE = DATA_DIR / "providers.json"
USAGE_FILE = DATA_DIR / "usage.json"

_lock = threading.RLock()  # reentrant: setters hold it while calling loads/saves

LIMIT_TYPES = ("requests", "tokens", "spend")
WINDOWS = ("day", "month", "total")


def load_registry() -> dict:
    with _lock:
        reg = _read_json(REGISTRY_FILE, {})
        return reg if isinstance(reg, dict) else {}


def save_registry(reg: dict) -> None:
    with _lock:
        _write_json(REGISTRY_FILE, reg_dict(reg))


def reg_dict(reg) -> dict:
    return reg if isinstance(reg, dict) else {}


def get_provider(name: str) -> dict:
    reg = load_registry()
    entry = reg.get(name)
    return entry if isinstance(entry, dict) else {}


def _valid_per(per) -> bool:
    return per in ("day", "month", "total")


def set_provider(name: str, patch: dict) -> dict:
    """Upsert a registry entry. Patch keys: note, blocked, limits.
    Limits merge per limit-type; invalid `per` ignores that limit type."""
    patch = patch or {}
    with _lock:
        reg = load_registry()
        cur = reg.get(name)
        if not isinstance(cur, dict):
            cur = {"note": "", "blocked": False, "limits": {}}
            reg[name] = cur
        if "note" in patch:
            cur["note"] = patch["note"] if isinstance(patch["note"], str) else ""
        if "blocked" in patch:
            cur["blocked"] = bool(patch["blocked"])
        limits = patch.get("limits")
        if limits is not None:
            cur_limits = cur.get("limits")
            cur_limits = cur_limits if isinstance(cur_limits, dict) else {}
            if isinstance(limits, dict):
                for ltype, conf in limits.items():
                    if ltype not in LIMIT_TYPES or not isinstance(conf, dict):
                        continue
                    per = conf.get("per")
                    if not _valid_per(per):
                        continue  # invalid per -> ignore this limit type
                    mx = conf.get("max")
                    new = {"per": per}
                    if mx is not None:
                        try:
                            new["max"] = float(mx)
                        except (TypeError, ValueError):
                            continue
                    cur_limits[ltype] = new
            cur["limits"] = cur_limits
        save_registry(reg)
        return dict(cur)


def remove_provider(name: str) -> bool:
    with _lock:
        reg = load_registry()
        if name not in reg:
            return False
        del reg[name]
        save_registry(reg)
        return True


def load_usage() -> dict:
    """Usage per provider. Expired day/month windows read as blank, so an
    exhausted provider frees up when its window rolls over."""
    with _lock:
        u = _read_json(USAGE_FILE, {})
        if not isinstance(u, dict):
            return {}
        return {name: {per: _rotated(ent.get(per), per) for per in WINDOWS}
                for name, ent in u.items() if isinstance(ent, dict)}


def save_usage(u: dict) -> None:
    with _lock:
        _write_json(USAGE_FILE, u if isinstance(u, dict) else {})


def _window(per: str) -> str:
    t = datetime.date.today()
    if per == "day":
        return t.isoformat()
    if per == "month":
        return t.strftime("%Y-%m")
    return "all"


def _blank_window(per: str) -> dict:
    return {
        "window": _window(per),
        "requests": 0,
        "tokens_in": 0,
        "tokens_out": 0,
        "spend": 0.0,
        "last_used": None,
    }


def _rotated(win, per: str):
    if not isinstance(win, dict) or win.get("window") != _window(per):
        return _blank_window(per)
    return win


def _int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def reset_usage(name: str) -> bool:
    """Zero all windows for provider in usage.json. False if it had none."""
    with _lock:
        u = load_usage()
        if name not in u:
            return False
        u[name] = {
            "day": _blank_window("day"),
            "month": _blank_window("month"),
            "total": _blank_window("total"),
        }
        save_usage(u)
        return True


def _estimate_spend(name: str, model: str, usage: dict) -> float:
    """Best-effort spend in USD. Never raises (returns 0.0 on any failure)."""
    try:
        # OpenRouter reports the exact cost — prefer it when present.
        cost = _float(usage.get("cost"))
        if cost > 0:
            return cost
        prompt = _int(usage.get("prompt_tokens"))
        completion = _int(usage.get("completion_tokens"))
        details = usage.get("prompt_tokens_details") or {}
        cached = _int(details.get("cached_tokens"))
        if cached < 0:
            cached = 0
        prompt_new = max(0, prompt - cached)

        raw = orclient.fetch_endpoints_raw(model)
        if not isinstance(raw, list):
            return 0.0
        row = next((r for r in raw if r.get("provider") == name), None)
        if not row:
            return 0.0
        p_in = row.get("in")
        if p_in is None:
            return 0.0
        p_cache = row.get("cache")
        p_out = row.get("out")
        if p_cache is None:
            p_cache = p_in
        if p_out is None:
            p_out = p_in
        spend = (p_in * prompt_new + p_cache * cached + p_out * completion) / 1e6
        return spend if spend > 0 else 0.0
    except Exception:  # noqa: BLE001 — best effort, never crash the router
        return 0.0


def record_usage(name: str, model: str, usage: dict | None = None,
                 stream_ok: bool = True) -> None:
    """Record one successful request against day/month/total windows."""
    usage = usage if isinstance(usage, dict) else None
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    requests = 1
    tin = tout = 0
    spend = 0.0
    if usage:
        tin = _int(usage.get("prompt_tokens"))
        tout = _int(usage.get("completion_tokens"))
        spend = _estimate_spend(name, model, usage)

    with _lock:
        u = load_usage()
        ent = u.get(name)
        if not isinstance(ent, dict):
            ent = {}
            u[name] = ent
        for per in ("day", "month", "total"):
            win = _rotated(ent.get(per), per)
            win["requests"] = _int(win.get("requests")) + requests
            win["tokens_in"] = _int(win.get("tokens_in")) + tin
            win["tokens_out"] = _int(win.get("tokens_out")) + tout
            win["spend"] = round(_float(win.get("spend")) + spend, 6)
            win["last_used"] = now
            ent[per] = win
        save_usage(u)


def _used_for(ltype: str, per: str, usage: dict) -> float:
    win = usage.get(per)
    if not isinstance(win, dict):
        return 0.0
    if ltype == "requests":
        return float(_int(win.get("requests")))
    if ltype == "tokens":
        return float(_int(win.get("tokens_in")) + _int(win.get("tokens_out")))
    if ltype == "spend":
        return _float(win.get("spend"))
    return 0.0


def is_available(name: str) -> dict:
    """{'available': bool, 'reasons': [str, ...]}. Unknown providers → available."""
    reasons: list[str] = []
    reg = load_registry()
    entry = reg.get(name)
    if isinstance(entry, dict):
        if entry.get("blocked"):
            reasons.append("blocked")
        limits = entry.get("limits") or {}
        usage = load_usage().get(name) or {}
        for ltype, conf in limits.items():
            per = conf.get("per")
            mx = conf.get("max")
            if ltype not in LIMIT_TYPES or not _valid_per(per) or mx is None:
                continue
            if _used_for(ltype, per, usage) >= mx:
                reasons.append(f"{ltype}/{per} exhausted")
    return {"available": not reasons, "reasons": reasons}


def _last_used(usage: dict) -> str | None:
    lu = None
    for per in WINDOWS:
        v = (usage.get(per) or {}).get("last_used")
        if v and (lu is None or v > lu):
            lu = v
    return lu


def limits_status(name: str) -> dict:
    """Per-limit-type status for the GUI + blocked/note/last_used."""
    reg = load_registry()
    entry = reg.get(name) or {}
    usage = load_usage().get(name) or {}
    out = {
        "blocked": bool(entry.get("blocked")),
        "note": entry.get("note") or "",
        "last_used": _last_used(usage),
    }
    limits = entry.get("limits") or {}
    for ltype in LIMIT_TYPES:
        conf = limits.get(ltype)
        if not isinstance(conf, dict) or not _valid_per(conf.get("per")):
            continue
        per = conf["per"]
        mx = conf.get("max")
        used = _used_for(ltype, per, usage)
        if mx is None:
            out[ltype] = {"per": per, "max": None, "used": used, "pct": 0.0,
                          "remaining": None, "exhausted": False}
            continue
        maxv = float(mx)
        pct = (used / maxv * 100.0) if maxv else 0.0
        out[ltype] = {
            "per": per,
            "max": maxv,
            "used": used,
            "pct": round(pct, 1),
            "remaining": round(max(0.0, maxv - used), 6),
            "exhausted": used >= maxv,
        }
    return out


def overview() -> dict:
    """Cheap summary for /api/state."""
    reg = load_registry()
    exhausted = 0
    for name in reg:
        if not is_available(name)["available"]:
            exhausted += 1
    return {"tracked": len(reg), "exhausted": exhausted}