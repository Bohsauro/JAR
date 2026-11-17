"""JAR — token mix learned from real traffic, and predicted per request.

1. Learning. Every proxied request records the `usage` OpenRouter returns
   (prompt, cached and completion tokens) in `data/tokenmix.json`, a rolling
   log of the last MAX_RECORDS requests. With `settings.mix_mode == "auto"`
   and at least MIN_SAMPLES records, the mix measured there replaces the
   manual one wherever costs are ranked (dashboard, engine, proxy).

2. Prediction. Before a request is sent its own mix is estimated:
   - input tokens  = prompt chars / chars-per-token, calibrated on history
   - output tokens = median completion of recent requests of the same kind
                     ("tools" or "chat"), capped by max_tokens
   - cached tokens = the longest message prefix sent in the last
                     PREFIX_TTL_S seconds. A prompt cache lives on the provider
                     that served it ("affinity"): there those tokens bill at
                     the cache price, anywhere else at the input price. A new
                     conversation assumes the cache share learned in (1).

The log holds token counts only, never content; prefixes are kept as hashes,
in memory.
"""

import hashlib
import json
import statistics
import threading
import time

from . import store

LOG_FILE = store.DATA_DIR / "tokenmix.json"
MAX_RECORDS = 500
MIN_SAMPLES = 20
DEFAULT_CHARS_PER_TOKEN = 4.0
DEFAULT_OUT_TOKENS = 400
PREFIX_TTL_S = 600  # provider prompt caches expire within minutes
PREFIX_MAX = 512
MIX_MODES = ("auto", "manual")

_prefix_lock = threading.Lock()
_prefixes: dict = {}  # prefix hash -> (model, provider, ts), oldest first


def _int(v) -> int:
    try:
        return max(0, int(v or 0))
    except (TypeError, ValueError):
        return 0


def _records() -> list:
    data = store._read_json(LOG_FILE, [])
    return [r for r in data if isinstance(r, dict)] if isinstance(data, list) else []


def _learned_from(recs: list) -> dict:
    unc = cached = out = 0
    for r in recs:
        tin = _int(r.get("in"))
        c = min(_int(r.get("cached")), tin)
        unc += tin - c
        cached += c
        out += _int(r.get("out"))
    total = unc + cached + out
    mix = ({"in": unc / total, "cache": cached / total, "out": out / total}
           if total else None)
    return {"samples": len(recs), "mix": mix}


def _uses_learned(settings: dict, learned: dict) -> bool:
    return (settings.get("mix_mode", "auto") == "auto" and bool(learned["mix"])
            and learned["samples"] >= MIN_SAMPLES)


def effective(settings: dict, recs: list | None = None) -> dict:
    """The mix to rank with: learned from traffic, or the manual one."""
    learned = _learned_from(_records() if recs is None else recs)
    return learned["mix"] if _uses_learned(settings, learned) else settings["mix"]


def stats(settings: dict) -> dict:
    recs = _records()
    learned = _learned_from(recs)
    using = _uses_learned(settings, learned)
    return {"mode": settings.get("mix_mode", "auto"), "manual": settings["mix"],
            "learned": learned["mix"], "samples": learned["samples"],
            "min_samples": MIN_SAMPLES, "source": "learned" if using else "manual",
            "effective": learned["mix"] if using else settings["mix"],
            "chars_per_token": round(_chars_per_token(recs), 2)}


# ------------------------------------------------------------ prediction ---

def _kind(body: dict) -> str:
    return "tools" if body.get("tools") else "chat"


def _messages(body: dict) -> list:
    msgs = body.get("messages")
    return msgs if isinstance(msgs, list) else []


def _msg_chars(msg) -> int:
    if not isinstance(msg, dict):
        return 0
    content = msg.get("content")
    if isinstance(content, list):  # multimodal: images are billed apart, count text
        content = " ".join(p["text"] for p in content
                           if isinstance(p, dict) and isinstance(p.get("text"), str))
    rest = {k: v for k, v in msg.items() if k != "content"}
    text = len(content) if isinstance(content, str) else 0
    return text + len(json.dumps(rest, ensure_ascii=False))


def _tool_chars(body: dict) -> int:
    tools = body.get("tools")
    return len(json.dumps(tools, ensure_ascii=False)) if tools else 0


def _prefix_hashes(msgs: list) -> list:
    """hashes[k] identifies messages[:k + 1]."""
    h = hashlib.sha256()
    out = []
    for m in msgs:
        h.update(json.dumps(m, sort_keys=True, ensure_ascii=False).encode())
        h.update(b"\x00")
        out.append(h.copy().hexdigest())
    return out


def _chars_per_token(recs: list) -> float:
    ratios = [_int(r.get("chars")) / _int(r.get("in")) for r in recs
              if _int(r.get("chars")) and _int(r.get("in"))]
    return statistics.median(ratios) if ratios else DEFAULT_CHARS_PER_TOKEN


def _expected_out(recs: list, body: dict) -> float:
    kind = _kind(body)
    outs = ([_int(r.get("out")) for r in recs if r.get("kind") == kind]
            or [_int(r.get("out")) for r in recs])
    est = float(statistics.median(outs)) if outs else float(DEFAULT_OUT_TOKENS)
    cap = body.get("max_completion_tokens") or body.get("max_tokens")
    if isinstance(cap, int) and not isinstance(cap, bool) and cap > 0:
        est = min(est, float(cap))
    return est


def _affinity(hashes: list, chars: list):
    """(model, provider) that holds the longest live cached prefix, and its chars."""
    now = time.time()
    with _prefix_lock:
        for k in range(len(hashes), 0, -1):
            hit = _prefixes.get(hashes[k - 1])
            if hit and now - hit[2] < PREFIX_TTL_S:
                return (hit[0], hit[1]), sum(chars[:k])
    return None, 0


def predict(body: dict, settings: dict) -> dict:
    """Estimated tokens and mix of this request, plus cache affinity."""
    recs = _records()
    msgs = _messages(body)
    cpt = _chars_per_token(recs)
    msg_chars = [_msg_chars(m) for m in msgs]
    tool_chars = _tool_chars(body)
    chars = sum(msg_chars) + tool_chars
    tin = chars / cpt
    tout = _expected_out(recs, body)
    affinity, prefix_chars = _affinity(_prefix_hashes(msgs), msg_chars)
    if affinity:
        tcached = min(tin, (prefix_chars + tool_chars) / cpt)
    else:
        base = effective(settings, recs)
        inputs = base["in"] + base["cache"]
        tcached = tin * (base["cache"] / inputs) if inputs else 0.0
    total = tin + tout
    mix = ({"in": (tin - tcached) / total, "cache": tcached / total,
            "out": tout / total} if total else effective(settings, recs))
    return {"chars": chars, "in": tin, "cached": tcached, "out": tout,
            "mix": mix, "affinity": list(affinity) if affinity else None}


def order(candidates: list, pred: dict) -> list:
    """Re-sort cost-ordered chain steps by this request's real cost.

    Step order is kept; steps with an explicit provider order are kept as is.
    Cached tokens bill at the cache price only on the affinity endpoint.
    """
    aff = tuple(pred["affinity"]) if pred.get("affinity") else None
    unc = pred["in"] - pred["cached"]

    def cost(c) -> float:
        p = c.get("price")
        if c.get("ordered") or not p:
            return 0.0
        hit = aff is None or (c["model"], c["provider"]) == aff
        return (unc * p["in"] + pred["cached"] * (p["cache"] if hit else p["in"])
                + pred["out"] * p["out"])

    keyed = sorted(((c.get("step", 0), cost(c), i, c)
                    for i, c in enumerate(candidates)), key=lambda t: t[:3])
    return [c for *_, c in keyed]


# ------------------------------------------------------------- learning ---

def remember(body: dict, model: str, provider: str) -> None:
    """Note which endpoint now holds this conversation's prompt cache."""
    hashes = _prefix_hashes(_messages(body))
    if not hashes:
        return
    with _prefix_lock:
        _prefixes.pop(hashes[-1], None)
        _prefixes[hashes[-1]] = (model, provider, time.time())
        while len(_prefixes) > PREFIX_MAX:
            _prefixes.pop(next(iter(_prefixes)))


def observe(body: dict, model: str, provider: str, usage, pred: dict | None = None):
    """Record a served request: cache affinity, then its real token usage."""
    remember(body, model, provider)
    if not isinstance(usage, dict) or not _int(usage.get("prompt_tokens")):
        return
    details = usage.get("prompt_tokens_details")
    chars = pred["chars"] if pred else (
        sum(_msg_chars(m) for m in _messages(body)) + _tool_chars(body))
    rec = {"ts": int(time.time()), "kind": _kind(body), "chars": chars,
           "in": _int(usage.get("prompt_tokens")),
           "cached": _int(details.get("cached_tokens")) if isinstance(details, dict) else 0,
           "out": _int(usage.get("completion_tokens")),
           "model": model, "provider": provider}
    with store.lock:
        recs = _records()
        recs.append(rec)
        store._write_json(LOG_FILE, recs[-MAX_RECORDS:])
