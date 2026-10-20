#!/usr/bin/env python3
"""Collect public KR company financial metrics INDEPENDENTLY of Yahoo stock quotes.

Best effort Naver mobile JSON integration and annual financial statements endpoints.
This program never guesses values, overwrites an existing quote or touches holdings.
Financial results are written into data/market.json + data/market.js. The endpoints
are unofficial and can change; verify source numbers before making decisions.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://m.stock.naver.com/',
}
NOW_TZ = ZoneInfo('Asia/Seoul')
NA = {'', '-', '--', 'N/A', 'NA', 'NULL', 'NONE', '적자', '흑자전환', '적자전환', '미제공', '자료없음'}
FINANCIAL_METRICS = ('pe', 'pb', 'forward_pe', 'eps', 'bps', 'roe', 'profit_margin',
                     'revenue', 'net_income', 'operating_margin', 'operating_income',
                     'market_cap', 'dividend_yield')


def number(raw):
    if isinstance(raw, dict):
        raw = raw.get('value')
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
        return value if math.isfinite(value) else None
    raw = str(raw).replace(',', '').replace('−', '-').replace('△', '-').replace(' ', '').strip()
    if raw.upper() in NA:
        return None
    match = re.match(r'^[+-]?\d+(?:\.\d+)?', raw)
    if not match:
        return None
    value = float(match.group())
    return value if math.isfinite(value) else None


def capital_won(raw):
    """Naver marketValue strings, e.g. '2,069조 5,826억' => KRW."""
    if raw is None:
        return None
    s = str(raw).replace(',', '').replace(' ', '')
    total = 0.0
    found = False
    for unit, factor in [('조', 1e12), ('억', 1e8), ('만', 1e4)]:
        hit = re.search(r'([0-9]+(?:\.[0-9]+)?)' + unit, s)
        if hit:
            found = True
            total += float(hit.group(1)) * factor
    return total if found and total > 0 else None


def fetch_json(code, suffix, session=None):
    session = session or requests
    url = f'https://m.stock.naver.com/api/stock/{code}/{suffix}'
    response = session.get(url, headers=HEADERS, timeout=18)
    if response.status_code == 429:
        raise RuntimeError(f'RATE_LIMIT_429 {url}')
    response.raise_for_status()
    result = response.json()
    if not isinstance(result, dict):
        raise ValueError(f'{suffix}: JSON object expected')
    return result


def parse_snapshot(data):
    infos = data.get('totalInfos') or []
    if not isinstance(infos, list):
        raise ValueError('Invalid totalInfos')
    keys = {}
    for item in infos:
        if not isinstance(item, dict):
            continue
        code = str(item.get('code') or '').lower().strip()
        key = str(item.get('key') or '').strip().lower()
        if code:
            keys[code] = item.get('value')
        if key:
            keys.setdefault(key, item.get('value'))
    def v(*labels):
        for label in labels:
            if label.lower() in keys:
                value = number(keys[label.lower()])
                if value is not None:
                    return value
        return None
    metrics = {
        'pe': v('per', 'PER'),
        'pb': v('pbr', 'PBR'),
        'forward_pe': v('cnsPer', '추정PER'),
        'eps': v('eps', 'EPS'),
        'bps': v('bps', 'BPS'),
        'market_cap': capital_won(keys.get('marketvalue') or keys.get('시가총액')),
    }
    div = v('dividendYieldRatio', '배당수익률')
    metrics['dividend_yield'] = div / 100 if div is not None else None
    # Negative PER/PBR is not an interpretable valuation multiple.
    for key in ('pe', 'pb', 'forward_pe'):
        if metrics[key] is not None and metrics[key] <= 0:
            metrics[key] = None
    return metrics


def parse_annual(data):
    finance = data.get('financeInfo') or {}
    titles = finance.get('trTitleList') or []
    rows = finance.get('rowList') or []
    if not isinstance(titles, list) or not isinstance(rows, list):
        return [], None
    actual_periods = {}
    for item in titles:
        if not isinstance(item, dict):
            continue
        period = str(item.get('key') or '').strip()
        forecast = str(item.get('isConsensus') or '').upper()
        if re.fullmatch(r'20\d{4}', period) and forecast not in ('Y', 'TRUE', '1'):
            actual_periods[period] = period[:4]
    if not actual_periods:
        return [], None
    mapping = {
        '매출액': 'revenue', '영업이익': 'operating_income',
        '당기순이익': 'net_income', '지배주주순이익': 'net_income',
        '지배주주지분순이익': 'net_income', 'ROE': 'roe',
    }
    incomes = {period: {'year': year, 'revenue': None, 'operating_income': None,
                        'net_income': None} for period, year in actual_periods.items()}
    roe_series = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = re.sub(r'\s+', '', str(row.get('title') or ''))
        norm = name.replace('(지배)', '').replace('(연결)', '').replace('(%)', '')
        col = mapping.get(norm) or ('roe' if norm.startswith('ROE') else None)
        if not col:
            continue
        column_values = row.get('columns') or {}
        if not isinstance(column_values, dict):
            continue
        for period in actual_periods:
            val = number(column_values.get(period))
            if val is None:
                continue
            if col == 'roe':
                roe_series[period] = val / 100
            elif incomes[period][col] is None:
                # Official Naver finance/annual rows represent KRW amounts in 100 million KRW.
                incomes[period][col] = val * 1e8
    history = [incomes[k] for k in sorted(incomes)][-4:]
    history = [row for row in history if any(row[key] is not None for key in
                                              ('revenue', 'operating_income', 'net_income'))]
    latest_roe = roe_series[sorted(roe_series)[-1]] if roe_series else None
    return history, latest_roe


def kr_companies(catalog):
    return [item for item in catalog if item.get('kind') == 'STOCK' and
            re.fullmatch(r'\d{6}\.(?:KS|KQ)', item.get('symbol', ''))]


def fresh_enough(existing, days):
    if not isinstance(existing, dict) or not existing.get('updated_at'):
        return False
    if number((existing.get('metrics') or {}).get('pe')) is None and number((existing.get('metrics') or {}).get('pb')) is None:
        return False
    try:
        stamp = datetime.fromisoformat(existing['updated_at'].replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return stamp >= datetime.now(timezone.utc) - timedelta(days=days)
    except (TypeError, ValueError):
        return False


def run(limit=36, max_age=5, pause=0.55, only=None, session=None):
    catalog = json.loads((DATA / 'catalog.json').read_text(encoding='utf-8'))
    state_path = DATA / 'market.json'
    market = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
    stocks = market.setdefault('stocks', {})
    market.setdefault('warnings', [])
    eligible = kr_companies(catalog)
    if only:
        eligible = [x for x in eligible if x['symbol'] == only]
    stale = [p for p in eligible if not fresh_enough((stocks.get(p['symbol']) or {}).get('fundamentals'), max_age)]
    # Existing Korean stock order starts with semiconductor peers, ensuring the first run is useful.
    done = 0
    errors = 0
    rate_limited = False
    for item in stale[:limit]:
        symbol = item['symbol']
        code = symbol[:6]
        previous = (stocks.get(symbol) or {}).get('fundamentals') or {}
        try:
            snap = parse_snapshot(fetch_json(code, 'integration', session=session))
            # Annual income is an optional second endpoint; a failure must not discard PER/PBR.
            income = previous.get('annual_income') or []
            roe = None
            annual_obtained = False
            try:
                annual, roe = parse_annual(fetch_json(code, 'finance/annual', session=session))
                if annual:
                    income = annual
                    annual_obtained = True
            except Exception as annual_error:
                print(f'WARN annual {symbol}: {str(annual_error)[:170]}', flush=True)
            if roe is not None:
                snap['roe'] = roe
            valid = [k for k, v in snap.items() if v is not None]
            if not valid and not annual_obtained:
                raise ValueError('PER/PBR/EPS/annual statement all unavailable')
            # Metrics derived from the latest published fiscal YEAR, not TTM.
            # The UI labels them as 'most recently published data'.
            if annual_obtained:
                last = income[-1]
                rev, net, op = last.get('revenue'), last.get('net_income'), last.get('operating_income')
                snap['revenue'] = rev
                snap['net_income'] = net
                snap['operating_income'] = op
                if rev is not None and rev > 0:
                    snap['profit_margin'] = net / rev if net is not None else None
                    snap['operating_margin'] = op / rev if op is not None else None
            # No fictional defaults; absent metrics remain null.
            metrics = {key: None for key in FINANCIAL_METRICS}
            metrics.update(snap)
            stocks.setdefault(symbol, {})['fundamentals'] = {
                'metrics': metrics, 'annual_income': income,
                'financial_period': income[-1]['year'] if annual_obtained else None,
                'updated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                'source': 'Naver Finance mobile JSON (unofficial)',
                'source_url': f'https://m.stock.naver.com/domestic/stock/{code}/finance',
            }
            done += 1
            print(f'OK fundamentals {symbol} | PER={snap.get("pe")} PBR={snap.get("pb")} | annual={len(income)}', flush=True)
        except Exception as error:
            errors += 1
            description = str(error)[:180]
            msg = f'{symbol} Naver 재무정보 미갱신: {description}'
            market['warnings'].append(msg)
            print('WARN fundamentals', msg, flush=True)
            if 'RATE_LIMIT_429' in description:
                rate_limited = True
                print('::warning::Naver finance HTTP 429; no further financial requests this run.', flush=True)
                break
        time.sleep(pause)
    covered = sum(1 for p in kr_companies(catalog)
                  if any(number(((stocks.get(p['symbol']) or {}).get('fundamentals') or {}).get('metrics', {}).get(key)) is not None
                         for key in ('pe', 'pb')))
    total = len(kr_companies(catalog))
    print(f'FINANCIAL_COVERAGE KR: {covered}/{total} (processed={done}, errors={errors}, stale={len(stale)}, rate_limited={rate_limited})', flush=True)
    if covered == 0:
        print('::warning::KR PER/PBR coverage is 0. Check the Naver errors above; deployment green != financial-data success.', flush=True)
    elif covered < total:
        print(f'::notice::KR PER/PBR covered {covered}/{total}; absent PER is normal for loss-making firms and data-missing firms.', flush=True)
    # Preserve quotes, histories, indices, FX and previous warnings.
    DATA.mkdir(exist_ok=True, parents=True)
    serialized = json.dumps(market, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    state_path.write_text(serialized, encoding='utf-8')
    (DATA / 'market.js').write_text('window.FOLIO_MARKET = ' +
                                    json.dumps(market, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + ';\n',
                                    encoding='utf-8')
    return covered


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=36, help='Maximum KR companies per run')
    parser.add_argument('--max-age', type=int, default=5, help='Days before refreshing valid financial metrics')
    parser.add_argument('--pause', type=float, default=0.55, help='Seconds between companies')
    parser.add_argument('--only', default=None, help='Run only a specific stock symbol (e.g., 005930.KS)')
    args = parser.parse_args()
    run(limit=max(0, args.limit), max_age=max(0, args.max_age), pause=max(.1, args.pause), only=args.only)
    # A finance provider blockage must not prevent GitHub Pages from being deployed.
    return 0


if __name__ == '__main__':
    sys.exit(main())
