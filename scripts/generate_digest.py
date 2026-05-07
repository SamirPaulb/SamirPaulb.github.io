"""
generate_digest.py — Daily Digest with 5-level fallback
========================================================
Designed to run unchanged for 10+ years.

FALLBACK LEVELS (tried in order):
  Level 1    AI + live web search  (Claude → OpenAI → Gemini → OpenRouter)
  Level 2    AI + pre-fetched data (same four providers + GitHub Models via urllib)
  Level 2.5  Local Ollama model    (qwen2.5:0.5b — set OLLAMA_MODEL env var to enable)
               — installed by the workflow only when all cloud APIs have failed
  Level 3    Data-only template    (stdlib urllib, no packages, no LLM)
  Level 4    Blank template        (pure stdlib, zero deps — ALWAYS SUCCEEDS)

MODEL NAMES are read from env vars so you can update them via GitHub
Variables (Settings → Variables → Actions) without touching this file.

CONFIGURATION — set as GitHub Variables (not Secrets):
  CLAUDE_MODEL             default: claude-haiku-4-5-20251001
  CLAUDE_SEARCH_TOOL       default: web_search_20250305
  OPENAI_SEARCH_MODEL      default: gpt-4o-mini-search-preview
  OPENAI_MODEL             default: gpt-4o-mini
  GEMINI_MODEL             default: gemini-2.0-flash
  OPENROUTER_SEARCH_MODEL  default: perplexity/llama-3.1-sonar-small-128k-online
  OPENROUTER_FREE_MODEL    default: google/gemini-2.0-flash-exp:free
  GITHUB_MODEL             default: gpt-4o-mini  (models.inference.ai.azure.com)

API KEYS — set as GitHub Secrets:
  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY
  (set any subset — only providers with keys are tried)

NOTE: GITHUB_TOKEN is auto-injected in Actions and used by the Level 2
  urllib fallback (GitHub Models). No extra secrets needed for that level.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

# ──────────────────────────────────────────────────────────────────────────────
# Date / paths
# ──────────────────────────────────────────────────────────────────────────────

IST  = timezone(timedelta(hours=5, minutes=30))
_now = datetime.now(IST)

DATE_ISO   = _now.strftime("%Y-%m-%d")           # 2026-05-07
DATE_HUMAN = _now.strftime("%B %d, %Y")          # May 07, 2026
DATE_FRONT = _now.strftime("%Y-%m-%dT07:00:00+05:30")

OUTPUT_DIR  = Path("content/daily-digest")
OUTPUT_FILE = OUTPUT_DIR / f"{DATE_ISO}.md"

# ──────────────────────────────────────────────────────────────────────────────
# Config — model/tool names from env vars with safe defaults
# When a model is deprecated: go to GitHub → Settings → Variables → Actions
# and update the variable. No code change needed.
# ──────────────────────────────────────────────────────────────────────────────

def _env(key: str, default: str) -> str:
    """Return env var value, falling back to default if unset or empty."""
    return os.environ.get(key) or default

CFG = {
    "CLAUDE_MODEL":            _env("CLAUDE_MODEL",            "claude-haiku-4-5-20251001"),
    "CLAUDE_SEARCH_TOOL":      _env("CLAUDE_SEARCH_TOOL",      "web_search_20250305"),
    "OPENAI_SEARCH_MODEL":     _env("OPENAI_SEARCH_MODEL",     "gpt-4o-mini-search-preview"),
    "OPENAI_MODEL":            _env("OPENAI_MODEL",            "gpt-4o-mini"),
    "GEMINI_MODEL":            _env("GEMINI_MODEL",            "gemini-2.0-flash"),
    "OPENROUTER_SEARCH_MODEL": _env("OPENROUTER_SEARCH_MODEL", "perplexity/llama-3.1-sonar-small-128k-online"),
    "OPENROUTER_FREE_MODEL":   _env("OPENROUTER_FREE_MODEL",   "google/gemini-2.0-flash-exp:free"),
    "GITHUB_MODEL":            _env("GITHUB_MODEL",            "gpt-4o-mini"),
}

# ──────────────────────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────────────────────

def _log(tag: str, msg: str) -> None:
    print(f"[{tag:<6}] {msg}", flush=True)

# ──────────────────────────────────────────────────────────────────────────────
# Output format template (embedded here so no external file dependency)
# ──────────────────────────────────────────────────────────────────────────────

_EXPECTED_FORMAT = f"""\
Output ONLY the following Hugo markdown — no preamble, no explanation, \
no code fences:

---
title: "Daily Digest — {DATE_HUMAN}"
date: {DATE_FRONT}
summary: "One sentence covering the 3-4 top stories of today"
---

## Markets

| Index | Price | Change |
|-------|-------|--------|
| Nifty 50 | ... | ...% |
| Sensex | ... | ...% |

One or two sentences of market commentary.

---

## Global News

- **Headline** — brief detail.
- **Headline** — brief detail.

---

## India

- **Headline** — brief detail.
- **Headline** — brief detail.

---

## Jobs & Tech

- **Headline** — brief detail.
- **Headline** — brief detail."""

PROMPT_SEARCH = f"""\
You are a daily digest writer for an Indian finance and tech blog.
Today is {DATE_HUMAN}.

Search the web for today's real data:
1. Nifty 50 and Sensex closing prices and % change
2. 2-3 major global news stories
3. 2-3 India stories (economy, policy, business)
4. 2-3 Jobs & Tech stories (AI, startups, hiring)

{_EXPECTED_FORMAT}"""


def _prompt_with_data(market: dict, hn: list) -> str:
    mkt = "\n".join(
        f"  {k}: {v['price']} ({v['change']})" for k, v in market.items()
    ) or "  [fetch failed]"
    headlines = "\n".join(f"  - {h}" for h in hn[:8]) or "  [fetch failed]"
    return f"""\
You are a daily digest writer for an Indian finance and tech blog.
Today is {DATE_HUMAN}.

Use this pre-fetched data and your knowledge for remaining sections:

MARKET DATA (Yahoo Finance):
{mkt}

HACKER NEWS TOP STORIES (use for Jobs & Tech section):
{headlines}

{_EXPECTED_FORMAT}"""

# ──────────────────────────────────────────────────────────────────────────────
# Output normalisation and validation
# ──────────────────────────────────────────────────────────────────────────────

_REQUIRED = ["## Markets", "## Global News", "## India", "## Jobs & Tech"]


def _normalize(text: str) -> str:
    """Strip code fences, leading preamble, and surrounding whitespace."""
    if not isinstance(text, str):
        return ""
    text = text.strip()
    # Strip markdown code fence wrapper (```markdown ... ```)
    if text.startswith("```"):
        lines = text.splitlines()
        if lines:
            lines = lines[1:]           # remove opening fence
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]          # remove closing fence
        text = "\n".join(lines).strip()
    # Strip any preamble before the front-matter opening ---
    idx = text.find("---")
    if idx > 0:
        text = text[idx:]
    return text.strip()


def _validate(text: str) -> bool:
    """Return True if text looks like a valid digest."""
    text = _normalize(text)
    if len(text) < 300:
        return False
    if not text.startswith("---"):
        return False
    return all(s in text for s in _REQUIRED)


def _clean(text: str) -> str:
    """Return normalised text guaranteed to end with a single newline."""
    return _normalize(text) + "\n"


# Map source identifiers → human-readable author label for front matter.
# Data-only and blank-template levels produce no AI author, so they are omitted.
_SOURCE_AUTHOR: dict[str, str] = {
    "claude":               "Claude",
    "claude+data":          "Claude",
    "openai":               "OpenAI",
    "openai+data":          "OpenAI",
    "gemini":               "Gemini",
    "gemini+data":          "Gemini",
    "openrouter":           "OpenRouter",
    "openrouter+data":      "OpenRouter",
    "github-models":        "GitHub Models",
    "ollama":               "Local AI",
}


def _inject_author(text: str, author: str) -> str:
    """
    Insert 'author: "Name"' into the YAML front matter block.
    No-op if author is blank or if 'author:' is already present.
    """
    if not author:
        return text
    # Front matter must start at position 0
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    if end == -1:
        return text
    fm = text[3:end]
    if "author:" in fm:
        return text
    return text[:end] + f'\nauthor: "{author}"' + text[end:]

# ──────────────────────────────────────────────────────────────────────────────
# Data fetchers — stdlib urllib only, no packages required
# ──────────────────────────────────────────────────────────────────────────────

def _fetch_market_data() -> dict:
    """
    Yahoo Finance unofficial endpoint.
    In production since ~2010; highly unlikely to disappear.
    Falls back gracefully per symbol on any error.
    """
    symbols = {"Nifty 50": "^NSEI", "Sensex": "^BSESN"}
    result: dict = {}
    for name, sym in symbols.items():
        try:
            url = (
                f"https://query1.finance.yahoo.com/v8/finance/chart/"
                f"{sym}?interval=1d&range=1d"
            )
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (digest-bot/1.0)"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.load(resp)
            meta  = data["chart"]["result"][0]["meta"]
            price = float(meta.get("regularMarketPrice") or 0)
            prev  = float(meta.get("chartPreviousClose") or price) or price
            chg   = ((price - prev) / prev * 100) if prev else 0.0
            result[name] = {
                "price":  f"{price:,.2f}",
                "change": f"{chg:+.2f}%",
            }
            _log("DATA", f"  {name}: {result[name]['price']} ({result[name]['change']})")
        except Exception as exc:
            _log("WARN", f"  {name} fetch failed: {exc}")
            result[name] = {"price": "[N/A]", "change": "[N/A]"}
    return result


def _fetch_hn_headlines(n: int = 8) -> list:
    """
    HackerNews official Firebase API.
    Running since 2013; stable indefinitely.
    """
    try:
        with urllib.request.urlopen(
            "https://hacker-news.firebaseio.com/v0/topstories.json",
            timeout=10,
        ) as resp:
            ids = json.load(resp)[: n * 2]
    except Exception as exc:
        _log("WARN", f"  HN topstories failed: {exc}")
        return []

    titles = []
    for story_id in ids:
        if len(titles) >= n:
            break
        try:
            with urllib.request.urlopen(
                f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json",
                timeout=5,
            ) as resp:
                item = json.load(resp)
            if item.get("type") == "story" and item.get("title"):
                titles.append(item["title"])
        except Exception:
            pass
        time.sleep(0.05)  # gentle rate limiting

    _log("DATA", f"  HN: {len(titles)} headlines fetched")
    return titles

# ──────────────────────────────────────────────────────────────────────────────
# Level 1 — AI with live web search
# ──────────────────────────────────────────────────────────────────────────────

def _claude_search() -> str:
    import anthropic
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    resp = client.messages.create(
        model=CFG["CLAUDE_MODEL"],
        max_tokens=2048,
        tools=[{"type": CFG["CLAUDE_SEARCH_TOOL"]}],
        messages=[{"role": "user", "content": PROMPT_SEARCH}],
    )
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


def _openai_search() -> str:
    from openai import OpenAI
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    # gpt-4o-*-search-preview models have built-in web search via Chat Completions
    resp = client.chat.completions.create(
        model=CFG["OPENAI_SEARCH_MODEL"],
        messages=[{"role": "user", "content": PROMPT_SEARCH}],
    )
    return resp.choices[0].message.content or ""


def _gemini_search() -> str:
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    resp = client.models.generate_content(
        model=CFG["GEMINI_MODEL"],
        contents=PROMPT_SEARCH,
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())]
        ),
    )
    return resp.text or ""


def _openrouter_search() -> str:
    from openai import OpenAI
    client = OpenAI(
        api_key=os.environ["OPENROUTER_API_KEY"],
        base_url="https://openrouter.ai/api/v1",
    )
    resp = client.chat.completions.create(
        model=CFG["OPENROUTER_SEARCH_MODEL"],   # Perplexity online model by default
        messages=[{"role": "user", "content": PROMPT_SEARCH}],
    )
    return resp.choices[0].message.content or ""

# ──────────────────────────────────────────────────────────────────────────────
# GitHub Models helper — stdlib urllib, no packages, GITHUB_TOKEN always set
# ──────────────────────────────────────────────────────────────────────────────

def _github_models_call(prompt: str) -> str:
    """
    Call GitHub Models via the OpenAI-compatible endpoint.
    Uses GITHUB_TOKEN (auto-injected in Actions, needs models: read permission).
    Pure stdlib — no extra packages required.
    """
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        return ""
    # The REST API uses the bare model ID (e.g. "gpt-4o-mini"), not the
    # publisher-prefixed catalog ID ("openai/gpt-4o-mini") used by actions/ai-inference.
    model_id = CFG["GITHUB_MODEL"].split("/")[-1]
    body = json.dumps({
        "model": model_id,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 2048,
    }).encode()
    req = urllib.request.Request(
        "https://models.inference.ai.azure.com/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return data["choices"][0]["message"]["content"] or ""


# ──────────────────────────────────────────────────────────────────────────────
# Level 2 — AI with pre-fetched data (no web search needed)
# ──────────────────────────────────────────────────────────────────────────────

def _make_level2(market: dict, hn: list) -> list:
    """Return provider list for Level 2, closing over pre-fetched data."""
    prompt = _prompt_with_data(market, hn)

    def _claude_data() -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        resp = client.messages.create(
            model=CFG["CLAUDE_MODEL"],
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                return block.text
        return ""

    def _openai_data() -> str:
        from openai import OpenAI
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        resp = client.chat.completions.create(
            model=CFG["OPENAI_MODEL"],
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content or ""

    def _gemini_data() -> str:
        from google import genai
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        resp = client.models.generate_content(
            model=CFG["GEMINI_MODEL"],
            contents=prompt,
        )
        return resp.text or ""

    def _openrouter_data() -> str:
        from openai import OpenAI
        client = OpenAI(
            api_key=os.environ["OPENROUTER_API_KEY"],
            base_url="https://openrouter.ai/api/v1",
        )
        resp = client.chat.completions.create(
            model=CFG["OPENROUTER_FREE_MODEL"],
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content or ""

    def _github_models_data() -> str:
        return _github_models_call(prompt)

    return [
        ("claude+data",     "ANTHROPIC_API_KEY",  _claude_data),
        ("openai+data",     "OPENAI_API_KEY",      _openai_data),
        ("gemini+data",     "GEMINI_API_KEY",      _gemini_data),
        ("openrouter+data", "OPENROUTER_API_KEY",  _openrouter_data),
        # Level 2 urllib fallback — has real market data in prompt, no extra secrets
        ("github-models",   "GITHUB_TOKEN",        _github_models_data),
    ]

# ──────────────────────────────────────────────────────────────────────────────
# Level 3 — data-only, no LLM
# ──────────────────────────────────────────────────────────────────────────────

def _data_only(market: dict, hn: list) -> str:
    """Build a digest from fetched data. No LLM. [verify] marks need editing."""
    nifty  = market.get("Nifty 50", {"price": "[N/A]", "change": "[N/A]"})
    sensex = market.get("Sensex",   {"price": "[N/A]", "change": "[N/A]"})

    tech_bullets = "\n".join(f"- **{h}**" for h in hn[:4])
    if not tech_bullets:
        tech_bullets = "- [verify] — _Add tech/jobs news._"

    parts = []
    if nifty["price"] != "[N/A]":
        parts.append(f"Nifty {nifty['price']} ({nifty['change']})")
    if hn:
        parts.append(hn[0][:80])
    summary = "; ".join(parts) + "." if parts else "[AUTO — verify content before publishing]"

    return f"""\
---
title: "Daily Digest — {DATE_HUMAN}"
date: {DATE_FRONT}
summary: "{summary}"
---

## Markets

| Index | Price | Change |
|-------|-------|--------|
| Nifty 50 | {nifty['price']} | {nifty['change']} |
| Sensex | {sensex['price']} | {sensex['change']} |

_Market data auto-fetched. Add commentary._

---

## Global News

- **[verify]** — _Add today's global news._
- **[verify]** — _Add today's global news._

---

## India

- **[verify]** — _Add today's India news._
- **[verify]** — _Add today's India news._

---

## Jobs & Tech

{tech_bullets}"""

# ──────────────────────────────────────────────────────────────────────────────
# Level 4 — blank template, zero dependencies, always succeeds
# ──────────────────────────────────────────────────────────────────────────────

def _template_only() -> str:
    """Pure Python stdlib. Never fails. Edit before publishing."""
    return f"""\
---
title: "Daily Digest — {DATE_HUMAN}"
date: {DATE_FRONT}
summary: "[DRAFT — fill in summary before publishing]"
---

## Markets

| Index | Price | Change |
|-------|-------|--------|
| Nifty 50 | [price] | [change]% |
| Sensex | [price] | [change]% |

[Market commentary]

---

## Global News

- **[Headline]** — [detail].
- **[Headline]** — [detail].

---

## India

- **[Headline]** — [detail].
- **[Headline]** — [detail].

---

## Jobs & Tech

- **[Headline]** — [detail].
- **[Headline]** — [detail]."""

# ──────────────────────────────────────────────────────────────────────────────
# Provider runner
# ──────────────────────────────────────────────────────────────────────────────

def _run(providers: list) -> Optional[tuple]:
    """
    Try providers in order. Skip those with no API key.
    Return (text, name) on first success, None if all fail.
    """
    for name, key_env, fn in providers:
        if not os.environ.get(key_env):
            _log("SKIP", f"{name} — {key_env} not set")
            continue
        try:
            _log("TRY", f"{name} ...")
            text = fn()
            if _validate(text):
                _log("OK", f"{name} ✓")
                return text, name
            snippet = (_normalize(text) or "")[:100].replace("\n", "↵")
            _log("FAIL", f"{name} — invalid output: {snippet!r}")
        except Exception as exc:
            _log("FAIL", f"{name} — {type(exc).__name__}: {exc}")
    return None

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────

def main() -> None:
    _log("START", f"Daily Digest generator — {DATE_HUMAN}")
    _log("START", f"Target: {OUTPUT_FILE}")

    # Idempotent — skip if already generated today
    if OUTPUT_FILE.exists():
        _log("SKIP", "File already exists — nothing to do.")
        sys.exit(0)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    result: Optional[str] = None
    source: str = "unknown"
    market: Optional[dict] = None
    hn: Optional[list] = None

    # ── Level 1: AI + live web search ──────────────────────────────────────
    if not result:
        _log("INFO", "─── Level 1: AI + live web search ───────────────────────")
        outcome = _run([
            ("claude",      "ANTHROPIC_API_KEY",  _claude_search),
            ("openai",      "OPENAI_API_KEY",      _openai_search),
            ("gemini",      "GEMINI_API_KEY",      _gemini_search),
            ("openrouter",  "OPENROUTER_API_KEY",  _openrouter_search),
        ])
        if outcome:
            result, source = outcome

    # ── Level 2: pre-fetch data, then AI ───────────────────────────────────
    if not result:
        _log("INFO", "─── Level 2: pre-fetch data + AI ─────────────────────")
        market = _fetch_market_data()
        hn     = _fetch_hn_headlines()
        outcome = _run(_make_level2(market, hn))
        if outcome:
            result, source = outcome

    # ── Level 2.5: Local Ollama model ──────────────────────────────────────
    # Only active when OLLAMA_MODEL env var is set (by the workflow after it
    # detects all cloud APIs failed and installs Ollama as a fallback).
    # Pure urllib — no extra packages. Uses pre-fetched market data if available.
    if not result:
        _log("INFO", "─── Level 2.5: local Ollama model ────────────────────")
        ollama_model = os.environ.get("OLLAMA_MODEL", "")
        if not ollama_model:
            _log("SKIP", "ollama — OLLAMA_MODEL not set")
        else:
            try:
                _log("TRY", f"ollama ({ollama_model}) ...")
                if market is None:
                    market = _fetch_market_data()
                    hn     = _fetch_hn_headlines()
                prompt = _prompt_with_data(market, hn or [])
                body = json.dumps({
                    "model": ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 1024},
                }).encode()
                req = urllib.request.Request(
                    "http://localhost:11434/api/generate",
                    data=body,
                    headers={"Content-Type": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=180) as resp:
                    data = json.loads(resp.read())
                text = data.get("response", "")
                if _validate(text):
                    result, source = text, "ollama"
                    _log("OK", f"ollama ({ollama_model}) ✓")
                else:
                    snippet = (_normalize(text) or "")[:100].replace("\n", "↵")
                    _log("FAIL", f"ollama — invalid output: {snippet!r}")
            except Exception as exc:
                _log("FAIL", f"ollama — {type(exc).__name__}: {exc}")

    # ── Level 3: data-only, no LLM ─────────────────────────────────────────
    if not result:
        _log("INFO", "─── Level 3: data-only template ──────────────────────")
        try:
            if market is None:
                market = _fetch_market_data()
                hn     = _fetch_hn_headlines()
            candidate = _data_only(market, hn or [])
            if _validate(candidate):
                result, source = candidate, "data-only"
                _log("OK", "data-only template ✓")
        except Exception as exc:
            _log("FAIL", f"data-only failed: {exc}")

    # ── Level 4: blank template — always succeeds ──────────────────────────
    if not result:
        _log("INFO", "─── Level 4: blank template ──────────────────────────")
        result = _template_only()
        source = "blank-template"
        _log("OK", "blank template created — edit before publishing")

    # ── Write ───────────────────────────────────────────────────────────────
    author = _SOURCE_AUTHOR.get(source, "")
    final  = _inject_author(_clean(result), author)
    OUTPUT_FILE.write_text(final, encoding="utf-8")
    _log("DONE", f"Written via [{source}]{f' · author: {author}' if author else ''} → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

