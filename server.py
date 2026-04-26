#!/usr/bin/env python3
"""
DCA Calculator — Flask backend
Serves static files + Yahoo Finance data via yfinance.
"""

import os, threading
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory

try:
    import yfinance as yf
except ImportError:
    raise SystemExit("yfinance not found. Run: pip3 install flask yfinance")

# ── App setup ────────────────────────────────────────────────────
app = Flask(__name__, static_folder=".")
_cache: dict = {}
_lock = threading.Lock()
CACHE_TTL = 3600  # 1 hour

# ── Cache helpers ─────────────────────────────────────────────────
def cache_get(key):
    with _lock:
        entry = _cache.get(key)
        if entry:
            val, ts = entry
            if datetime.now() - ts < timedelta(seconds=CACHE_TTL):
                return val
    return None

def cache_set(key, val):
    with _lock:
        _cache[key] = (val, datetime.now())

# ── Static file serving ───────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    if filename.startswith("api/"):
        return jsonify({"error": "not found"}), 404
    return send_from_directory(".", filename)

# ── API: Search tickers ───────────────────────────────────────────
@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])

    cached = cache_get(f"search:{q.upper()}")
    if cached is not None:
        return jsonify(cached)

    try:
        search = yf.Search(q, max_results=10, news_count=0)
        raw = search.quotes or []
    except Exception:
        # Fallback: treat the query itself as a ticker candidate
        raw = []

    results = []
    for item in raw:
        symbol   = item.get("symbol", "")
        name     = item.get("longname") or item.get("shortname") or symbol
        qtype    = item.get("quoteType", "EQUITY")
        exchange = item.get("exchange", "")
        if symbol and qtype in ("EQUITY", "ETF", "MUTUALFUND", "INDEX"):
            results.append({
                "ticker":   symbol,
                "name":     name,
                "exchange": exchange,
                "type":     qtype,
            })

    results = results[:9]
    cache_set(f"search:{q.upper()}", results)
    return jsonify(results)

# ── API: Ticker metadata (name + earliest date) ───────────────────
@app.route("/api/info")
def api_info():
    ticker = request.args.get("ticker", "").strip().upper()
    if not ticker:
        return jsonify({"error": "ticker 파라미터가 필요합니다."}), 400

    cached = cache_get(f"info:{ticker}")
    if cached is not None:
        return jsonify(cached)

    try:
        t = yf.Ticker(ticker)
        hist = t.history(period="max", auto_adjust=True)
        if hist.empty:
            return jsonify({"error": f"'{ticker}'의 데이터를 찾을 수 없습니다."}), 404

        first_date = hist.index[0].strftime("%Y-%m-%d")
        last_date  = hist.index[-1].strftime("%Y-%m-%d")

        # info can be slow — skip silently if it fails
        name = ticker
        currency = "USD"
        try:
            info = t.info or {}
            name     = info.get("longName") or info.get("shortName") or ticker
            currency = info.get("currency", "USD")
        except Exception:
            pass

        result = {
            "ticker":    ticker,
            "name":      name,
            "firstDate": first_date,
            "lastDate":  last_date,
            "currency":  currency,
        }
        cache_set(f"info:{ticker}", result)
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── API: Historical close prices ──────────────────────────────────
@app.route("/api/history")
def api_history():
    ticker = request.args.get("ticker", "").strip().upper()
    start  = request.args.get("start", "")
    end    = request.args.get("end", "")

    if not ticker or not start or not end:
        return jsonify({"error": "ticker / start / end 파라미터가 필요합니다."}), 400

    cache_key = f"hist:{ticker}:{start}:{end}"
    cached = cache_get(cache_key)
    if cached is not None:
        return jsonify(cached)

    try:
        t = yf.Ticker(ticker)
        hist = t.history(start=start, end=end, auto_adjust=True)

        if hist.empty:
            return jsonify({
                "error": f"'{ticker}': {start} ~ {end} 구간에 데이터가 없습니다."
            }), 404

        data = [
            {
                "date":  idx.strftime("%Y-%m-%d"),
                "close": round(float(row["Close"]), 6),
            }
            for idx, row in hist.iterrows()
            if float(row["Close"]) > 0
        ]

        result = {"ticker": ticker, "data": data}
        cache_set(cache_key, result)
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Entry point ───────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print(f"[DCA] http://0.0.0.0:{port}  |  yfinance {yf.__version__}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
