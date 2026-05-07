"""
generate_digest.py — Daily Digest with 6-level fallback
========================================================
Designed to run unchanged for 10+ years.

ARCHITECTURE — pre-fetch first, then AI:
  All data is fetched ONCE at startup (Yahoo Finance + HN + Tavily/Exa/DDG/Mojeek news).
  Every AI provider receives the same rich context so even standard models produce
  quality digests — no model needs to search independently.

FALLBACK LEVELS (tried in order):
  Level 1    AI + pre-fetched context + optional extra search
               (Claude with web_search, OpenAI search-preview, Gemini grounding,
                OpenRouter Perplexity — each also gets the pre-fetched news data)
  Level 1.5  Direct assembly — no LLM, pre-fetched data only
               (builds digest straight from Tavily/Exa/DDG/Mojeek results)
  Level 2    Standard AI + pre-fetched context (no extra search)
               (Claude, OpenAI, Gemini, OpenRouter free model, GitHub Models)
  Level 2.5  Local Ollama model (gemma2:2b-instruct-q8_0 — distilled from 9B, near-lossless Q8)
               — installed by the workflow only when all cloud APIs have failed
  Level 3    Data-only template  (stdlib; same search chain for news sections)
  Level 4    Blank template      (pure stdlib, zero deps — ALWAYS SUCCEEDS)

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
  TAVILY_API_KEY  — tavily.com (used at Level 1.5 and Level 3, news + finance)
  EXA_API_KEY     — exa.ai (fallback when Tavily section returns empty)
  (set any subset — only providers with keys are tried)

NOTE: GITHUB_TOKEN is auto-injected in Actions and used by the Level 2
  urllib fallback (GitHub Models). No extra secrets needed for that level.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Callable, Optional

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
# Logging — timestamps make it easy to spot slow steps in CI logs
# ──────────────────────────────────────────────────────────────────────────────

def _log(tag: str, msg: str) -> None:
    ts = datetime.now(IST).strftime("%H:%M:%S")
    print(f"{ts} [{tag:<6}] {msg}", flush=True)

# ──────────────────────────────────────────────────────────────────────────────
# Retry helper — exponential back-off for transient network failures
# ──────────────────────────────────────────────────────────────────────────────

def _retry(fn: Callable, attempts: int = 3, base_delay: float = 1.5) -> Any:
    """Retry fn up to `attempts` times with exponential back-off on any exception."""
    last_exc: BaseException = RuntimeError("no attempts made")
    for attempt in range(attempts):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if attempt < attempts - 1:
                delay = base_delay * (2 ** attempt)
                _log("WARN", f"  retry {attempt + 1}/{attempts} in {delay:.1f}s — {exc}")
                time.sleep(delay)
    raise last_exc

# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

# HN meta-post prefixes — community posts, not real tech/news items
_HN_META_PREFIXES = ("ask hn:", "show hn:", "tell hn:", "launch hn:")

# Placeholder markers that indicate an AI returned template content, not real data.
# _validate() rejects any output containing these strings.
_PLACEHOLDER_PATTERNS = ("[DRAFT", "[verify]", "[Headline]", "[price]")

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

def _prompt_with_rich_data(
    market: dict,
    hn: list,
    glob_news: list,
    india_news: list,
    tech_news: list,
    mkt_commentary: str = "",
    search_hint: bool = False,
) -> str:
    """
    Build a prompt pre-loaded with all pre-fetched real-time data.
    search_hint=True  → for search-capable models (Claude, GPT-search, Gemini grounding,
                         Perplexity) — they can supplement the data with their own search.
    search_hint=False → for standard models and Ollama — data is self-contained.
    """
    mkt_lines = "\n".join(
        f"  {k}: {v['price']} ({v['change']})" for k, v in market.items()
    ) or "  [fetch failed]"

    hn_lines = "\n".join(f"  - {h}" for h in hn[:8]) or "  [fetch failed]"

    def _sec(items: list, label: str) -> str:
        if items:
            return "\n".join(f"  - {item}" for item in items[:5])
        hint = f"search for today's {label} stories" if search_hint else "use general knowledge"
        return f"  [no pre-fetched data — {hint}]"

    # Blend tech search results with HN headlines for the tech section
    tech_combined = tech_news[:3] + [f"**{h}**" for h in hn[:3]]

    mkt_note = (
        f"\n\nMARKET COMMENTARY (Tavily finance search):\n  {mkt_commentary[:400]}"
        if mkt_commentary else ""
    )
    supplement = (
        "\n\nYou also have live web search — use it to add depth, verify details, "
        "or fill any section where pre-fetched data is sparse."
        if search_hint else ""
    )

    return f"""\
You are a daily digest writer for an Indian finance and tech blog.
Today is {DATE_HUMAN}.

Real-time data has already been fetched for you — use it as your primary source.
Synthesize it into a polished digest with concise, insightful commentary.{supplement}

MARKET DATA (Yahoo Finance — live prices):
{mkt_lines}{mkt_note}

PRE-FETCHED GLOBAL NEWS (Tavily / Exa / DDG):
{_sec(glob_news, 'global')}

PRE-FETCHED INDIA NEWS (Tavily / Exa / DDG):
{_sec(india_news, 'India')}

PRE-FETCHED JOBS & TECH NEWS (Tavily / Exa / DDG + HN):
{_sec(tech_combined, 'tech/jobs')}

HACKER NEWS TOP STORIES (raw titles for reference):
{hn_lines}

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
    """
    Return True if text looks like a valid, publishable digest.

    Rejects:
    - Short or structurally incomplete outputs
    - Outputs containing placeholder markers (template not filled in)
    - Outputs with fewer than 2 real headline bullets
    """
    text = _normalize(text)
    if len(text) < 300:
        return False
    if not text.startswith("---"):
        return False
    if not all(s in text for s in _REQUIRED):
        return False
    # Reject outputs that still contain placeholder markers —
    # these indicate the AI echoed the template rather than generating real content
    for placeholder in _PLACEHOLDER_PATTERNS:
        if placeholder in text:
            return False
    # Require at least 2 real headline bullets (- **...**)
    if text.count("- **") < 2:
        return False
    return True


def _clean(text: str) -> str:
    """Return normalised text guaranteed to end with a single newline."""
    return _normalize(text) + "\n"


# Map source identifiers → human-readable author label for front matter.
# Data-only and blank-template levels produce no AI author, so they are omitted.
_SOURCE_AUTHOR: dict[str, str] = {
    "claude":         "Claude",
    "claude+data":    "Claude",
    "openai":         "OpenAI",
    "openai+data":    "OpenAI",
    "gemini":         "Gemini",
    "gemini+data":    "Gemini",
    "openrouter":     "OpenRouter",
    "openrouter+data":"OpenRouter",
    "github-models":  "GitHub Models",
    "ollama":         "Local AI",
    # tavily-direct and data-only are data-derived, no AI author
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


def _dedup_news(
    glob_news: list, india_news: list, tech_news: list,
) -> tuple[list, list, list]:
    """
    Remove cross-section and within-section duplicate headlines.
    Uses the first 60 normalised characters as the dedup key.
    Processes sections in order (glob → india → tech), so earlier sections
    get priority when the same story appears in multiple sections.
    """
    seen: set[str] = set()

    def _key(item: str) -> str:
        # Strip markdown bold markers before comparing
        return item.replace("**", "").lower()[:60].strip()

    def _dedup(items: list) -> list:
        out = []
        for item in items:
            k = _key(item)
            if k and k not in seen:
                seen.add(k)
                out.append(item)
        return out

    return _dedup(glob_news), _dedup(india_news), _dedup(tech_news)

# ──────────────────────────────────────────────────────────────────────────────
# Data fetchers — stdlib urllib only, no packages required
# ──────────────────────────────────────────────────────────────────────────────

# Yahoo Finance has two equivalent query hosts; try both for resilience.
_YAHOO_ENDPOINTS = [
    "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=1d",
    "https://query2.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=1d",
]


def _fetch_market_data() -> dict:
    """
    Yahoo Finance unofficial endpoint.
    Tries query1 first, falls back to query2 on any error.
    Each URL is retried up to 2 times with exponential back-off.
    Falls back gracefully per symbol on all errors.
    """
    symbols = {"Nifty 50": "^NSEI", "Sensex": "^BSESN"}
    result: dict = {}

    def _fetch_url(url: str) -> dict:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0 (digest-bot/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.load(resp)

    for name, sym in symbols.items():
        sym_enc = urllib.parse.quote(sym)
        data = None
        for url_tmpl in _YAHOO_ENDPOINTS:
            url = url_tmpl.format(sym=sym_enc)
            try:
                data = _retry(lambda u=url: _fetch_url(u), attempts=2, base_delay=2.0)
                break  # success — no need to try query2
            except Exception as exc:
                _log("WARN", f"  {name} {url_tmpl.split('/')[2]} failed: {exc}")

        if data:
            try:
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
                _log("WARN", f"  {name} parse failed: {exc}")
                result[name] = {"price": "[N/A]", "change": "[N/A]"}
        else:
            result[name] = {"price": "[N/A]", "change": "[N/A]"}

    return result


def _fetch_hn_headlines(n: int = 8) -> list:
    """
    HackerNews official Firebase API.
    Running since 2013; stable indefinitely.
    Fetches extra IDs to account for filtered meta-posts (Ask/Show/Tell/Launch HN).
    Retries the topstories endpoint on transient failures.
    """
    try:
        ids = _retry(
            lambda: json.loads(
                urllib.request.urlopen(
                    "https://hacker-news.firebaseio.com/v0/topstories.json",
                    timeout=10,
                ).read()
            )[: n * 3],  # fetch 3× to account for filtered meta-posts
            attempts=3,
            base_delay=1.5,
        )
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
            title = (item.get("title") or "").strip()
            # Skip meta-posts (Ask HN, Show HN, Tell HN, Launch HN) —
            # these are community discussions, not real news/tech items.
            if any(title.lower().startswith(p) for p in _HN_META_PREFIXES):
                continue
            if item.get("type") == "story" and title:
                titles.append(title)
        except Exception:
            pass
        time.sleep(0.05)  # gentle rate limiting

    _log("DATA", f"  HN: {len(titles)} headlines fetched")
    return titles


# ──────────────────────────────────────────────────────────────────────────────
# Search fallbacks — per-section chain: Exa → DDG Lite → Mojeek
# Exa is a paid API (EXA_API_KEY); DDG and Mojeek need no key.
# All three are tried in order; _fetch_free_search() encapsulates the chain.
# ──────────────────────────────────────────────────────────────────────────────

def _fetch_ddg_headlines(query: str, n: int = 4) -> list:
    """
    Search via DuckDuckGo Lite (lite.duckduckgo.com/lite/).
    Simple POST, returns plain HTML — no JS, no cookies needed on clean IPs.
    Requires beautifulsoup4 (in requirements-digest.txt).
    Falls back gracefully to [] on any error.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        _log("WARN", "  DDG: beautifulsoup4 not installed")
        return []
    data = urllib.parse.urlencode({"q": query, "kl": "us-en"}).encode()
    req = urllib.request.Request(
        "https://lite.duckduckgo.com/lite/",
        data=data,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                          "Chrome/120.0.0.0 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read()
        soup = BeautifulSoup(html, "html.parser")
        items = []
        for link in soup.find_all("a", class_="result-link"):
            if len(items) >= n:
                break
            title = link.get_text(strip=True)
            if not title:
                continue
            snippet = ""
            row = link.find_parent("tr")
            if row:
                next_row = row.find_next_sibling("tr")
                if next_row:
                    cells = next_row.find_all("td")
                    cell = cells[1] if len(cells) >= 2 else (cells[0] if cells else None)
                    if cell:
                        text = cell.get_text(strip=True)
                        if text and not text.startswith(("http", "www.")):
                            snippet = text[:150]
            items.append(f"**{title}** — {snippet}." if snippet else f"**{title}**")
        _log("DATA", f"  DDG: {len(items)} results")
        return items
    except Exception as exc:
        _log("WARN", f"  DDG search failed: {exc}")
        return []


def _fetch_mojeek_headlines(query: str, n: int = 4) -> list:
    """
    Search via Mojeek (mojeek.com) — independent index, no CAPTCHA, no API key.
    Requires beautifulsoup4.
    Falls back gracefully to [] on any error.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        _log("WARN", "  Mojeek: beautifulsoup4 not installed")
        return []
    req = urllib.request.Request(
        "https://www.mojeek.com/search?" + urllib.parse.urlencode({"q": query, "num": n + 2}),
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                          "Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read()
        soup = BeautifulSoup(html, "html.parser")
        items = []
        for item in soup.select("ul.results-standard li"):
            if len(items) >= n:
                break
            title_el = item.select_one("a.ob")
            if not title_el:
                continue
            span = title_el.select_one("span")
            if span:
                span.decompose()
            title = title_el.get_text(strip=True)
            snippet_el = item.select_one("p.s")
            snippet = snippet_el.get_text(strip=True)[:150] if snippet_el else ""
            if title:
                items.append(f"**{title}** — {snippet}." if snippet else f"**{title}**")
        _log("DATA", f"  Mojeek: {len(items)} results")
        return items
    except Exception as exc:
        _log("WARN", f"  Mojeek search failed: {exc}")
        return []


def _fetch_exa_headlines(query: str, n: int = 4) -> list:
    """
    Search via Exa deep neural search (api.exa.ai).
    Requires EXA_API_KEY and exa-py package.
    Uses type="deep", category="news", highlights for brief snippets.
    Falls back gracefully to [] on any error or missing key.
    """
    api_key = os.environ.get("EXA_API_KEY", "")
    if not api_key:
        return []
    try:
        from exa_py import Exa
        client = Exa(api_key)
        # yesterday as start date to filter to today's news only
        yesterday = (_now - timedelta(hours=36)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        resp = client.search(
            query,
            category="news",
            num_results=n + 2,
            type="deep",
            contents={
                "text": {"max_characters": 500},
                "highlights": True,
            },
            start_published_date=yesterday,
        )
        items = []
        for r in (resp.results or []):
            if len(items) >= n:
                break
            title = (r.title or "").strip()
            if not title:
                continue
            # prefer first highlight snippet over raw text (more relevant)
            brief = ""
            if r.highlights:
                brief = r.highlights[0].strip()[:150]
            elif r.text:
                brief = r.text.split(". ")[0].strip()[:150]
            items.append(f"**{title}** — {brief}." if brief else f"**{title}**")
        _log("DATA", f"  Exa: {len(items)} results")
        return items
    except Exception as exc:
        _log("WARN", f"  Exa search failed: {exc}")
        return []


def _fetch_free_search(query: str, n: int = 4) -> list:
    """
    Per-section search fallback chain (no LLM):
      Exa (paid, deep neural) → DDG Lite (free) → Mojeek (free, independent index).
    Returns the first non-empty result list.
    """
    # Exa: best quality, requires EXA_API_KEY
    results = _fetch_exa_headlines(query, n)
    if results:
        return results
    # DDG Lite: free, no key
    results = _fetch_ddg_headlines(query, n)
    if results:
        return results
    # Mojeek: free, independent index
    _log("INFO", "  DDG empty — trying Mojeek ...")
    return _fetch_mojeek_headlines(query, n)


def _fetch_tavily_section(label: str, query: str,
                          topic: str = "news", n: int = 4) -> tuple:
    """
    Fetch news via Tavily SDK.
    Returns (answer: str, bullets: list[str]).
      answer  — Tavily's AI-synthesized paragraph (use as section intro/commentary)
      bullets — list of "**Title** — brief." strings for individual headlines
    Falls back to ("", []) on any error or missing key.
    """
    api_key = os.environ.get("TAVILY_API_KEY", "")
    if not api_key:
        return "", []
    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key, timeout=30)
        resp = client.search(
            query=query,
            topic=topic,
            search_depth="advanced",
            include_answer="advanced",
            max_results=n + 2,      # fetch extras in case some have no title
            time_range="day",
        )
        answer  = (resp.get("answer") or "").strip()
        bullets = []
        for r in (resp.get("results") or []):
            if len(bullets) >= n:
                break
            title   = (r.get("title") or "").strip()
            content = (r.get("content") or "").strip()
            brief   = content.split(". ")[0][:150] if content else ""
            if title:
                bullets.append(f"**{title}** — {brief}." if brief else f"**{title}**")
        _log("DATA", f"  Tavily [{label}]: {len(bullets)} bullets"
                     f"{', answer ok' if answer else ''}")
        return answer, bullets
    except Exception as exc:
        _log("WARN", f"  Tavily [{label}] failed: {exc}")
        return "", []


def _build_direct(
    market: dict, hn: list,
    mkt_commentary: str,
    glob_news: list, india_news: list, tech_news: list,
) -> str:
    """
    Level 1.5: assemble a complete digest from pre-fetched data. No LLM, no new API calls.
    Returns empty string if no news data is available at all.
    """
    if not (glob_news or india_news or tech_news):
        _log("SKIP", "data-direct — no news data available, skipping Level 1.5")
        return ""

    nifty  = market.get("Nifty 50", {"price": "[N/A]", "change": "[N/A]"})
    sensex = market.get("Sensex",   {"price": "[N/A]", "change": "[N/A]"})

    def _section(items: list, placeholder: str) -> str:
        return ("\n".join(f"- {b}" for b in items[:3])
                if items else placeholder)

    global_sec = _section(glob_news,  "- _No global news available today._")
    india_sec  = _section(india_news, "- _No India news available today._")
    tech_mixed = tech_news[:2] + [f"**{h}**" for h in hn[:2]]
    tech_sec   = _section(tech_mixed, "- _No tech news available today._")

    if mkt_commentary:
        mkt_comment = mkt_commentary[:400]
    else:
        chg = nifty["change"]
        direction = "gained" if chg.startswith("+") else "fell"
        mkt_comment = f"Nifty {direction} {chg} to {nifty['price']}."

    parts = []
    if nifty["price"] != "[N/A]":
        parts.append(f"Nifty {nifty['price']} ({nifty['change']})")
    if glob_news:
        parts.append(glob_news[0].replace("**", "").split(" — ")[0][:80])
    summary = "; ".join(parts) + "." if parts else "Daily markets and news digest."

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

{mkt_comment}

---

## Global News

{global_sec}

---

## India

{india_sec}

---

## Jobs & Tech

{tech_sec}"""


# ──────────────────────────────────────────────────────────────────────────────
# Level 1 — search-capable AI with pre-fetched context
# ──────────────────────────────────────────────────────────────────────────────

def _make_level1(prompt: str) -> list:
    """
    Search-capable providers: each receives the pre-fetched rich context prompt
    AND can use its own web search to add depth or verify details.
    """
    def _claude() -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=90.0)
        resp = client.messages.create(
            model=CFG["CLAUDE_MODEL"],
            max_tokens=2048,
            tools=[{"type": CFG["CLAUDE_SEARCH_TOOL"]}],
            messages=[{"role": "user", "content": prompt}],
        )
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                return block.text
        return ""

    def _openai() -> str:
        from openai import OpenAI
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=90.0)
        resp = client.chat.completions.create(
            model=CFG["OPENAI_SEARCH_MODEL"],
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content or ""

    def _gemini() -> str:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                              http_options={"timeout": 90})
        resp = client.models.generate_content(
            model=CFG["GEMINI_MODEL"],
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())]
            ),
        )
        return resp.text or ""

    def _openrouter() -> str:
        from openai import OpenAI
        client = OpenAI(
            api_key=os.environ["OPENROUTER_API_KEY"],
            base_url="https://openrouter.ai/api/v1",
            timeout=90.0,
        )
        resp = client.chat.completions.create(
            model=CFG["OPENROUTER_SEARCH_MODEL"],
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content or ""

    return [
        ("claude",     "ANTHROPIC_API_KEY",  _claude),
        ("openai",     "OPENAI_API_KEY",      _openai),
        ("gemini",     "GEMINI_API_KEY",      _gemini),
        ("openrouter", "OPENROUTER_API_KEY",  _openrouter),
    ]


# ──────────────────────────────────────────────────────────────────────────────
# Level 1.5 — direct assembly from pre-fetched data, no LLM
# ──────────────────────────────────────────────────────────────────────────────

def _make_level1_5(
    market: dict, hn: list,
    mkt_commentary: str,
    glob_news: list, india_news: list, tech_news: list,
) -> list:
    """
    Build the digest directly from pre-fetched data — no LLM, no extra API calls.
    key_env=None means always attempt (data availability checked inside).
    """
    def _direct() -> str:
        return _build_direct(market, hn, mkt_commentary, glob_news, india_news, tech_news)

    return [("data-direct", None, _direct)]


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
# Level 2 — standard AI with pre-fetched rich context (no extra search)
# ──────────────────────────────────────────────────────────────────────────────

def _make_level2(prompt: str) -> list:
    """Standard models — no web search, but prompt contains all pre-fetched data."""

    def _claude_data() -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=90.0)
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
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=90.0)
        resp = client.chat.completions.create(
            model=CFG["OPENAI_MODEL"],
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        return resp.choices[0].message.content or ""

    def _gemini_data() -> str:
        from google import genai
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                              http_options={"timeout": 90})
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
            timeout=90.0,
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

def _data_only(market: dict, hn: list,
               tavily_global: Optional[list] = None,
               tavily_india:  Optional[list] = None,
               tavily_tech:   Optional[list] = None) -> str:
    """
    Build a digest from fetched data. No LLM.
    When Tavily results are provided, all sections are filled with real news.
    When Tavily is absent, Global News and India sections show [verify] markers.
    """
    nifty  = market.get("Nifty 50", {"price": "[N/A]", "change": "[N/A]"})
    sensex = market.get("Sensex",   {"price": "[N/A]", "change": "[N/A]"})

    def _section_bullets(tavily: Optional[list], hn_items: list,
                         verify_msg: str) -> str:
        if tavily:
            return "\n".join(f"- {h}" for h in tavily[:3])
        if hn_items:
            return "\n".join(f"- **{h}**" for h in hn_items[:3])
        return verify_msg

    global_bullets = _section_bullets(
        tavily_global, [],
        "- **[verify]** — _Add today's global news._\n"
        "- **[verify]** — _Add today's global news._",
    )
    india_bullets = _section_bullets(
        tavily_india, [],
        "- **[verify]** — _Add today's India news._\n"
        "- **[verify]** — _Add today's India news._",
    )
    # Tech: prefer Tavily tech news, fall back to HN, then verify
    tech_hn = [f"**{h}**" for h in hn[:4]]
    tech_bullets = _section_bullets(
        (tavily_tech or [])[:2] + tech_hn[:2] if (tavily_tech or tech_hn) else None,
        tech_hn,
        "- **[verify]** — _Add tech/jobs news._",
    )

    parts = []
    if nifty["price"] != "[N/A]":
        parts.append(f"Nifty {nifty['price']} ({nifty['change']})")
    if tavily_global:
        first = tavily_global[0].replace("**", "").split(" — ")[0][:80]
        parts.append(first)
    elif hn:
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

_Market data auto-fetched._

---

## Global News

{global_bullets}

---

## India

{india_bullets}

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
    key_env=None means always attempt (used for data-direct which needs no key).
    Return (text, name) on first success, None if all fail.
    """
    for name, key_env, fn in providers:
        if key_env and not os.environ.get(key_env):
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
# Parallel pre-fetch
# ──────────────────────────────────────────────────────────────────────────────

def _parallel_prefetch() -> dict:
    """
    Fetch all data sources concurrently using a thread pool.
    Returns a dict with keys: market, hn, mkt, glob, india, tech.
    Each value is the raw return of the corresponding fetch function.
    """
    tasks: dict[str, Callable] = {
        "market": _fetch_market_data,
        "hn":     _fetch_hn_headlines,
        "mkt":    lambda: _fetch_tavily_section(
            "finance",
            f"India Nifty Sensex stock market today {DATE_HUMAN}",
            topic="finance",
        ),
        "glob":   lambda: _fetch_tavily_section(
            "global", f"major world news today {DATE_HUMAN}",
        ),
        "india":  lambda: _fetch_tavily_section(
            "india", f"India economy politics business news {DATE_HUMAN}",
        ),
        "tech":   lambda: _fetch_tavily_section(
            "tech", f"AI technology startup jobs news {DATE_HUMAN}",
        ),
    }
    results: dict = {}
    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        future_to_key = {executor.submit(fn): key for key, fn in tasks.items()}
        for future in as_completed(future_to_key):
            key = future_to_key[future]
            try:
                results[key] = future.result()
            except Exception as exc:
                _log("WARN", f"  parallel fetch [{key}] failed: {exc}")
                results[key] = None
    return results

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

    # ── Pre-fetch ALL data concurrently ────────────────────────────────────
    # All six fetches run in parallel — market, HN, and four Tavily sections.
    # Sequential total was ~15-25s; parallel total is ~max(individual) ~8-12s.
    _log("INFO", "─── Pre-fetching data (parallel) ────────────────────────")
    prefetch = _parallel_prefetch()

    market         = prefetch.get("market") or {}
    hn             = prefetch.get("hn") or []
    mkt_commentary = (prefetch.get("mkt") or ("", []))[0]
    glob_news      = (prefetch.get("glob") or ("", []))[1]
    india_news     = (prefetch.get("india") or ("", []))[1]
    tech_news      = (prefetch.get("tech") or ("", []))[1]

    # Per-section fallback: Exa → DDG → Mojeek (run in parallel if multiple needed)
    sections_needing_fallback: dict[str, Callable] = {}
    if not glob_news:
        sections_needing_fallback["glob"]  = lambda: _fetch_free_search(
            f"world news today {DATE_HUMAN}"
        )
    if not india_news:
        sections_needing_fallback["india"] = lambda: _fetch_free_search(
            f"India news today {DATE_HUMAN}"
        )
    if not tech_news:
        sections_needing_fallback["tech"]  = lambda: _fetch_free_search(
            f"AI technology news today {DATE_HUMAN}"
        )

    if sections_needing_fallback:
        _log("INFO", f"  Tavily empty for: {list(sections_needing_fallback)} — running fallback")
        with ThreadPoolExecutor(max_workers=len(sections_needing_fallback)) as executor:
            future_to_key = {executor.submit(fn): key
                             for key, fn in sections_needing_fallback.items()}
            for future in as_completed(future_to_key):
                key = future_to_key[future]
                try:
                    res = future.result() or []
                    if key == "glob":
                        glob_news = res
                    elif key == "india":
                        india_news = res
                    elif key == "tech":
                        tech_news = res
                except Exception as exc:
                    _log("WARN", f"  fallback fetch [{key}] failed: {exc}")

    # Deduplicate — remove cross-section duplicates (same story in global + india, etc.)
    glob_news, india_news, tech_news = _dedup_news(glob_news, india_news, tech_news)

    _log("INFO", f"  Pre-fetch done: market={bool(market)}, hn={len(hn)}, "
                 f"global={len(glob_news)}, india={len(india_news)}, tech={len(tech_news)}")

    # Build prompts for Level 1 (search hint on) and Level 2/Ollama (self-contained)
    search_prompt = _prompt_with_rich_data(
        market, hn, glob_news, india_news, tech_news, mkt_commentary,
        search_hint=True,
    )
    data_prompt = _prompt_with_rich_data(
        market, hn, glob_news, india_news, tech_news, mkt_commentary,
        search_hint=False,
    )

    # ── Level 1: search-capable AI + pre-fetched context ───────────────────
    _log("INFO", "─── Level 1: AI + search + pre-fetched context ──────────")
    outcome = _run(_make_level1(search_prompt))
    if outcome:
        result, source = outcome

    # ── Level 1.5: direct assembly — no LLM ────────────────────────────────
    if not result:
        _log("INFO", "─── Level 1.5: direct assembly (no LLM) ─────────────")
        outcome = _run(_make_level1_5(
            market, hn, mkt_commentary, glob_news, india_news, tech_news,
        ))
        if outcome:
            result, source = outcome

    # ── Level 2: standard AI + pre-fetched rich context ────────────────────
    if not result:
        _log("INFO", "─── Level 2: standard AI + pre-fetched context ───────")
        outcome = _run(_make_level2(data_prompt))
        if outcome:
            result, source = outcome

    # ── Level 2.5: Local Ollama model ──────────────────────────────────────
    # Only active when OLLAMA_MODEL env var is set (by the workflow after it
    # detects all cloud APIs failed and installs Ollama as a fallback).
    # Receives the same rich pre-fetched context — biggest benefit here since
    # local models cannot search the web themselves.
    if not result:
        _log("INFO", "─── Level 2.5: local Ollama model ────────────────────")
        ollama_model = os.environ.get("OLLAMA_MODEL", "")
        if not ollama_model:
            _log("SKIP", "ollama — OLLAMA_MODEL not set")
        else:
            try:
                _log("TRY", f"ollama ({ollama_model}) ...")
                body = json.dumps({
                    "model": ollama_model,
                    "prompt": data_prompt,
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 4096},
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

    # ── Level 3: data-only template — reuses pre-fetched news (no new calls) ──
    if not result:
        _log("INFO", "─── Level 3: data-only template ──────────────────────")
        try:
            candidate = _data_only(market, hn, glob_news, india_news, tech_news)
            if _validate(candidate):
                result, source = candidate, "data-only"
                _log("OK", "data-only template ✓")
            else:
                # _validate rejects [verify] markers — Level 3 falls through to Level 4
                # The workflow Ollama check will trigger on the [DRAFT markers below.
                _log("WARN", "data-only template contains placeholder markers — falling to Level 4")
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
