#!/usr/bin/env python3
"""Update cached daily closing prices, KRW FX, CNN index and selective fundamentals.

Runs in GitHub Actions. Public quotes are not stored as private user holdings.
Data providers are unofficial and may block CI traffic. Failures retain the last
successful values with their original as-of dates; no invented market quotes.
"""
from __future__ import annotations

import argparse
import csv
from io import StringIO
import os
import re
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
            # A 429 is an explicit provider refusal. Retrying immediately adds load.
            if r.status_code == 429:
                raise RuntimeError(f'PROVIDER_RATE_LIMIT_429: {url}')
            r.raise_for_status()
            return r.json()
        except RuntimeError as e:
            if 'PROVIDER_RATE_LIMIT_429' in str(e):
                raise
            last_error = e
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



def make_daily_quote(bars, currency, source, history_limit=65, now=None):
    """Normalize externally obtained *closed* daily bars (never invent prices)."""
    now = now or datetime.now(timezone.utc)
    market_tz = KST if currency == 'KRW' else ZoneInfo('America/New_York')
    local_now = now.astimezone(market_tz)
    # Some daily feeds also expose the unfinished current session. Be conservative.
    too_early = (local_now.hour, local_now.minute) < ((16, 0) if currency == 'KRW' else (16, 30))
    unique = {}
    for item in bars:
        try:
            day = datetime.strptime(str(item['date']), '%Y-%m-%d').date()
            price = safe_float(item['close'])
            if price is None or price <= 0:
                continue
            if day > local_now.date() or (day == local_now.date() and too_early):
                continue
            unique[day.isoformat()] = {'date': day.isoformat(), 'close': round(price, 6)}
        except (KeyError, TypeError, ValueError):
            continue
    rows = [unique[k] for k in sorted(unique)]
    if not rows:
        raise ValueError(f'{source}: no closed daily bars')
    newest = rows[-1]
    prev = rows[-2]['close'] if len(rows)>1 else None
    delta = newest['close']-prev if prev else None
    change_pct = delta/prev*100 if prev else None
    return {'price': newest['close'], 'quote_date': newest['date'],
            'currency': currency, 'previous_close': prev,
            'change': round(delta, 5) if delta is not None else None,
            'change_pct': round(change_pct, 4) if change_pct is not None else None,
            'history': rows[-history_limit:], 'high_52w': None, 'low_52w': None,
            'source': source}


def fetch_naver_chart(symbol, history_limit=65):
    """Daily Korean-market candles from Naver chart XML (unofficial, best-effort)."""
    match = re.fullmatch(r'(\d{6})\.(?:KS|KQ)', symbol)
    if not match:
        raise ValueError('Naver daily chart supports only 6-digit Korean symbols')
    code = match.group(1)
    url = 'https://fchart.stock.naver.com/sise.nhn'
    resp = requests.get(url, params={'symbol':code, 'timeframe':'day',
                         'count':max(history_limit+12,80), 'requestType':'0'},
                         headers={**HEADERS,'Referer':'https://finance.naver.com/'}, timeout=18)
    resp.raise_for_status()
    # Numeric item attributes are ASCII regardless of the Korean text encoding.
    matches = re.findall(r'<item\s+data=[\'\"]([^\'\"]+)[\'\"]', resp.text, flags=re.I)
    if not matches:
        raise ValueError(f'{symbol}: no parseable Naver candles')
    bars=[]
    for item in matches:
        parts=item.split('|')
        if len(parts)>=5 and re.fullmatch(r'\d{8}', parts[0]):
            d=parts[0]
            bars.append({'date': f'{d[:4]}-{d[4:6]}-{d[6:8]}', 'close':parts[4]})
    return make_daily_quote(bars, 'KRW', 'Naver Finance daily chart (unofficial)', history_limit)


def fetch_stooq_chart(symbol, history_limit=65):
    """Fallback for US tickers; may require STOOQ_API_KEY and can also rate-limit."""
    if not re.fullmatch(r'[A-Z][A-Z0-9.\-]{0,14}', symbol):
        raise ValueError('Unsupported Stooq symbol')
    today=datetime.now(timezone.utc).date()
    months=max(200, int(history_limit*1.85))
    start=today-timedelta(days=months)
    params={'s': symbol.lower()+'.us', 'd1': start.strftime('%Y%m%d'),
            'd2': today.strftime('%Y%m%d'), 'i':'d'}
    api_key=os.environ.get('STOOQ_API_KEY','').strip()
    if api_key:
        params['apikey']=api_key
    response=requests.get('https://stooq.com/q/d/l/', params=params,
                         headers={**HEADERS,'Accept':'text/csv,*/*'}, timeout=18)
    response.raise_for_status()
    if not response.text.lstrip().startswith('Date,Open,High,Low,Close'):
        raise ValueError('Stooq CSV unavailable; provider may require an API key or deny CI traffic')
    bars=[{'date':row.get('Date'), 'close':row.get('Close')}
          for row in csv.DictReader(StringIO(response.text))]
    return make_daily_quote(bars, 'USD', 'Stooq daily CSV (unofficial)', history_limit)


def fetch_fx_reference():
    """USD/KRW reference-rate fallback. This is not a broker transaction FX rate."""
    data=get_json('https://api.frankfurter.dev/v2/rate/USD/KRW', timeout=18)
    rate=safe_float(data.get('rate') if isinstance(data,dict) else None)
    date=data.get('date') if isinstance(data,dict) else None
    if not rate or not 100<rate<10000 or not isinstance(date,str) or len(date)!=10:
        raise ValueError('Frankfurter returned no valid USD/KRW rate')
    return {'rate':rate,'quote_date':date,
            'source':'Frankfurter central-bank reference rates (not broker FX)'}


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
    count = 0
    yahoo_blocked = False
    stooq_blocked = False

    # Sequential instead of 70+ concurrent Yahoo calls. Korean stocks no longer
    # depend on Yahoo: use Naver first, and preserve cached quotes on failure.
    for sym, (section, key) in tasks.items():
        data = None
        problems = []
        if re.fullmatch(r'\d{6}\.(?:KS|KQ)', sym):
            try:
                data = fetch_naver_chart(sym, 265 if section=='indices' else 65)
            except Exception as e:
                problems.append('Naver: '+str(e)[:90])
        if data is None and not yahoo_blocked:
            try:
                data = fetch_chart(sym, 265 if sym == INDEX['S&P 500'] else 65)
            except Exception as e:
                error=str(e)
                problems.append('Yahoo: '+error[:90])
                if '429' in error or 'Too Many Requests' in error:
                    yahoo_blocked = True
                    print('WARN Yahoo 429; skipping further Yahoo calls this run', flush=True)
        if data is None and section == 'stocks' and not stooq_blocked and not sym[0].isdigit():
            try:
                data = fetch_stooq_chart(sym)
            except Exception as e:
                error=str(e)
                problems.append('Stooq: '+error[:90])
                if ('403' in error or '429' in error or 'API key' in error or
                    'rate limit' in error.lower()):
                    stooq_blocked = True
                    print('WARN Stooq unavailable; skipping further Stooq calls this run', flush=True)
        if data is not None:
            if section == 'stocks':
                previous = state['stocks'].get(key) or {}
                previous_date = previous.get('quote_date') or ''
                if previous_date and data['quote_date'] < previous_date:
                    state['warnings'].append(f'{sym}: provider quote older than saved quote; kept {previous_date}')
                    continue
                data['fundamentals'] = previous.get('fundamentals')
                state['stocks'][key] = data
            else:
                previous = state['indices'].get(key) or {}
                if previous.get('quote_date','') <= data['quote_date']:
                    state['indices'][key] = data
            count += 1
            print(f'OK {sym} {data["quote_date"]} {data["price"]} [{data["source"]}]', flush=True)
        else:
            msg=f'{sym} 종가 미갱신: '+('; '.join(problems) if problems else 'all providers unavailable')
            state['warnings'].append(msg)
            print('WARN', msg, flush=True)
        time.sleep(0.18)

    # Prefer a provider independent from Yahoo for FX; never fake market rates.
    try:
        fx=fetch_fx_reference()
        if not state.get('fx') or fx['quote_date'] >= state['fx'].get('quote_date',''):
            state['fx']=fx
        print('OK USD/KRW', fx['quote_date'], fx['rate'], flush=True)
    except Exception as e:
        state['warnings'].append('USD/KRW 환율 미갱신: '+str(e)[:160])
        print('WARN USD/KRW:',str(e)[:160],flush=True)

    try:
        state['fear_greed'] = fetch_fear_greed()
        print('OK CNN', state['fear_greed']['score'], flush=True)
    except Exception as e:
        msg = f'CNN 지수 갱신 실패: {str(e)[:180]}'
        state['warnings'].append(msg)
        print('WARN', msg, flush=True)

    if not yahoo_blocked and not args.skip_fundamentals and args.fundamentals_limit > 0:
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
    if yahoo_blocked:
        state['warnings'].append('Yahoo Finance가 HTTP 429로 요청을 제한했습니다. 대체 제공처 데이터를 우선 사용했습니다.')
    state['updated_at'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    serialized = json.dumps(state, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    market_path.write_text(serialized, encoding='utf-8')
    (DATA / 'market.js').write_text('window.FOLIO_MARKET = ' + json.dumps(state, ensure_ascii=False, separators=(',',':'), allow_nan=False) + ';\n', encoding='utf-8')
    print(f'Updated {count}/{len(tasks)} quotes. {len(state["warnings"])} warnings.')
    # Partial failures need not make the site unusable. No quotes at all must fail the job.
    return 0 if count or state['stocks'] else 1

if __name__ == '__main__':
    sys.exit(main())
