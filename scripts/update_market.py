#!/usr/bin/env python3
"""Update cached daily closing prices, KRW FX, CNN index and selective fundamentals.

Runs in GitHub Actions. Public quotes are not stored as private user holdings.
Data providers are unofficial and may block CI traffic. Failures retain the last
successful values with their original as-of dates; no invented market quotes.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import random
import sys
import time
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
KST = ZoneInfo('Asia/Seoul')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'
HEADERS = {'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*'}
INDEX = {'KOSPI': '^KS11', 'KOSDAQ': '^KQ11', 'S&P 500': '^GSPC', 'NASDAQ': '^IXIC'}


def safe_float(v):
    try:
        a = float(v)
        return a if math.isfinite(a) else None
    except (TypeError, ValueError, OverflowError):
        return None


def get_json(url, headers=None, timeout=18, attempts=2):
    last_error = None
    for attempt in range(attempts):
        try:
            r = requests.get(url, headers=headers or HEADERS, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except (ValueError, requests.RequestException) as e:
            last_error = e
            if attempt + 1 < attempts:
                time.sleep(1.1 + random.random())
    raise RuntimeError(f'{url}: {last_error}')


def parse_yahoo_chart(result, now=None, history_limit=65):
    """Only CLOSED daily bars; exclude today's still-open candle for equity exchanges."""
    now = now or datetime.now(timezone.utc)
    timestamps = result.get('timestamp') or []
    closes = ((result.get('indicators') or {}).get('quote') or [{}])[0].get('close') or []
    meta = result.get('meta') or {}
    tz_name = meta.get('exchangeTimezoneName') or 'UTC'
    try:
        tz = ZoneInfo(tz_name)
    except (KeyError, ValueError):
        tz = timezone.utc
    local_now = now.astimezone(tz)
    market_close = ((meta.get('currentTradingPeriod') or {}).get('regular') or {}).get('end')
    # If the exchange is currently trading, today's candle is not a closing price.
    is_open = bool(market_close and now.timestamp() < market_close and
                   local_now.date() == datetime.fromtimestamp(market_close, tz=tz).date())
    clean = []
    for stamp, raw in zip(timestamps, closes):
        value = safe_float(raw)
        if value is None or value <= 0:
            continue
        date = datetime.fromtimestamp(stamp, tz=tz).date()
        if is_open and date == local_now.date():
            continue
        clean.append({'date': date.isoformat(), 'close': round(value, 6)})
    if not clean:
        raise ValueError('No completed daily bars')
    latest = clean[-1]
    prev = clean[-2]['close'] if len(clean) > 1 else None
    delta = (latest['close'] - prev) if prev else None
    change = (delta / prev * 100) if prev else None
    return {
        'price': latest['close'], 'quote_date': latest['date'],
        'currency': meta.get('currency'), 'previous_close': prev,
        'change': round(delta, 5) if delta is not None else None,
        'change_pct': round(change, 4) if change is not None else None,
        'history': clean[-history_limit:],
        'high_52w': safe_float(meta.get('fiftyTwoWeekHigh')),
        'low_52w': safe_float(meta.get('fiftyTwoWeekLow')),
        'source': 'Yahoo Finance chart (unofficial)',
    }


def fetch_chart(symbol, history_limit=65):
    from urllib.parse import quote
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe="")}?range={"2y" if history_limit > 180 else "6mo"}&interval=1d'
    data = get_json(url)
    res = (data.get('chart') or {}).get('result') or []
    if not res:
        raise ValueError(f'{symbol}: empty chart result')
    return parse_yahoo_chart(res[0], history_limit=history_limit)


CNN_COMPONENT_KEYS = (
    'market_momentum_sp500', 'stock_price_strength', 'stock_price_breadth',
    'put_call_options', 'junk_bond_demand', 'market_volatility_vix',
    'safe_haven_demand',
)


def parse_fear_payload(data):
    """Parse CNN's undocumented JSON defensively; no inferred/placeholder scores."""
    obj = data.get('fear_and_greed') or {}
    score = safe_float(obj.get('score'))
    if score is None or not 0 <= score <= 100:
        raise ValueError('CNN returned no valid composite score')

    def headline(key):
        v = safe_float(obj.get(key))
        return round(v, 2) if v is not None and 0 <= v <= 100 else None

    components = {}
    for key in CNN_COMPONENT_KEYS:
        entry = data.get(key) or {}
        raw = safe_float(entry.get('score'))
        components[key] = {
            'score': round(raw, 2) if raw is not None and 0 <= raw <= 100 else None,
            'rating': str(entry.get('rating') or '').lower(),
        }

    by_date = {}
    for point in (data.get('fear_and_greed_historical') or {}).get('data') or []:
        try:
            t = safe_float(point.get('x'))
            v = safe_float(point.get('y'))
            if t is None or v is None or not 0 <= v <= 100:
                continue
            day = datetime.fromtimestamp(t / 1000, tz=timezone.utc).date().isoformat()
            by_date[day] = {'date': day, 'score': round(v, 2)}
        except (ValueError, OverflowError, OSError, TypeError):
            continue
    history = [by_date[d] for d in sorted(by_date)][-380:]
    return {
        'score': round(score, 2), 'rating': str(obj.get('rating') or '').lower(),
        'timestamp': obj.get('timestamp'), 'previous_close': headline('previous_close'),
        'previous_1_week': headline('previous_1_week'),
        'previous_1_month': headline('previous_1_month'),
        'previous_1_year': headline('previous_1_year'),
        'indicators': components, 'history': history,
        'source_url': 'https://edition.cnn.com/markets/fear-and-greed',
        'source_note': 'CNN USA Fear & Greed. KOSPI-specific index not provided.',
    }


def fetch_fear_greed():
    h = {**HEADERS, 'Referer': 'https://edition.cnn.com/markets/fear-and-greed', 'Origin': 'https://edition.cnn.com'}
    data = get_json('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', headers=h, timeout=22)
    return parse_fear_payload(data)


def fetch_fundamentals(symbol):
    import yfinance as yf
    # yfinance info can be intermittently rate-limited. Do not fill missing fields.
    obj = yf.Ticker(symbol)
    info = obj.info or {}
    metrics = {
        'pe': safe_float(info.get('trailingPE')),
        'forward_pe': safe_float(info.get('forwardPE')),
        'pb': safe_float(info.get('priceToBook')),
        'eps': safe_float(info.get('trailingEps')),
        'roe': safe_float(info.get('returnOnEquity')),
        'operating_margin': safe_float(info.get('operatingMargins')),
        'profit_margin': safe_float(info.get('profitMargins')),
        'revenue': safe_float(info.get('totalRevenue')),
        'net_income': safe_float(info.get('netIncomeToCommon')),
        'market_cap': safe_float(info.get('marketCap')),
        'dividend_yield': safe_float(info.get('dividendYield')),
        'free_cash_flow': safe_float(info.get('freeCashflow')),
        'total_debt': safe_float(info.get('totalDebt')),
        'total_cash': safe_float(info.get('totalCash')),
    }
    try:
        statements = obj.income_stmt
        history = []
        if statements is not None and not statements.empty:
            for col in list(statements.columns)[:4]:
                def income_line(keys):
                    for key in keys:
                        if key in statements.index:
                            return safe_float(statements.loc[key, col])
                    return None
                dt = col.to_pydatetime() if hasattr(col, 'to_pydatetime') else col
                year = dt.year if hasattr(dt, 'year') else str(dt)[:4]
                history.append({'year': str(year),
                                'revenue': income_line(['Total Revenue', 'Operating Revenue']),
                                'net_income': income_line(['Net Income', 'Net Income Common Stockholders']),
                                'operating_income': income_line(['Operating Income'])})
            history.sort(key=lambda x: x['year'])
        else:
            history = []
    except Exception as e:
        print(f'  financial statements {symbol}: {str(e)[:90]}', flush=True)
        history = []
    if not any(v is not None for v in metrics.values()) and not history:
        raise ValueError(f'{symbol}: no fundamentals')
    return {'metrics': metrics, 'annual_income': history,
            'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'source': 'Yahoo Finance via yfinance (unofficial)'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--skip-fundamentals', action='store_true')
    ap.add_argument('--fundamentals-limit', type=int, default=8)
    args = ap.parse_args()
    catalog = json.loads((DATA / 'catalog.json').read_text(encoding='utf-8'))
    market_path = DATA / 'market.json'
    state = json.loads(market_path.read_text(encoding='utf-8')) if market_path.exists() else {}
    state.setdefault('stocks', {})
    state.setdefault('indices', {})
    state['warnings'] = []

    tasks = {i['symbol']: ('stocks', i['symbol']) for i in catalog}
    tasks.update({sym: ('indices', name) for name, sym in INDEX.items()})
    tasks['KRW=X'] = ('fx', 'USD/KRW')
    count = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_chart, sym, 265 if sym == INDEX['S&P 500'] else 65): sym for sym in tasks}
        for future in as_completed(futures):
            sym = futures[future]
            section, key = tasks[sym]
            try:
                data = future.result()
                if section == 'stocks':
                    previous = state['stocks'].get(key) or {}
                    data['fundamentals'] = previous.get('fundamentals')
                    state['stocks'][key] = data
                elif section == 'indices':
                    state['indices'][key] = data
                else:
                    state['fx'] = {'rate': data['price'], 'quote_date': data['quote_date'],
                                   'source': data['source']}
                count += 1
                print(f'OK {sym} {data["quote_date"]} {data["price"]}', flush=True)
            except Exception as e:
                msg = f'{sym} 종가 갱신 실패: {str(e)[:150]}'
                state['warnings'].append(msg)
                print('WARN', msg, flush=True)

    try:
        state['fear_greed'] = fetch_fear_greed()
        print('OK CNN', state['fear_greed']['score'], flush=True)
    except Exception as e:
        msg = f'CNN 지수 갱신 실패: {str(e)[:180]}'
        state['warnings'].append(msg)
        print('WARN', msg, flush=True)

    if not args.skip_fundamentals and args.fundamentals_limit > 0:
        now = datetime.now(timezone.utc)
        eligible = [p for p in catalog if p['kind'] == 'STOCK' and p['symbol'] in state['stocks']]
        def freshness(p):
            base = (state['stocks'][p['symbol']].get('fundamentals') or {}).get('updated_at')
            try:
                return datetime.fromisoformat(base) if base else datetime.min.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError):
                return datetime.min.replace(tzinfo=timezone.utc)
        stale = sorted((p for p in eligible if freshness(p) < now - timedelta(days=10)), key=freshness)
        for p in stale[:args.fundamentals_limit]:
            symbol = p['symbol']
            try:
                state['stocks'][symbol]['fundamentals'] = fetch_fundamentals(symbol)
                print('OK fundamentals', symbol, flush=True)
            except Exception as e:
                msg = f'{symbol} 재무지표 실패: {str(e)[:130]}'
                state['warnings'].append(msg)
                print('WARN', msg, flush=True)
            time.sleep(.4)
    state['updated_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    serialized = json.dumps(state, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    market_path.write_text(serialized, encoding='utf-8')
    (DATA / 'market.js').write_text('window.FOLIO_MARKET = ' + json.dumps(state, ensure_ascii=False, separators=(',',':'), allow_nan=False) + ';\n', encoding='utf-8')
    print(f'Updated {count}/{len(tasks)} quotes. {len(state["warnings"])} warnings.')
    # Partial failures need not make the site unusable. No quotes at all must fail the job.
    return 0 if count or state['stocks'] else 1

if __name__ == '__main__':
    sys.exit(main())
