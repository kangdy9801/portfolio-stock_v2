"""Optional online refresh for GitHub Actions. Preserves verified fallback data on failure.

FRED: US target-range daily (DFEDTARL, DFEDTARU) and CPI SA/NSA.  BOK ECOS
requires a personal API key configured as ECOS_API_KEY GitHub secret.
This script never fabricates consensus expectations; forecasts are browser-only manual records.
"""
import csv
import datetime as dt
import io
import json
import os
from pathlib import Path
from typing import Any
import requests
ROOT=Path(__file__).resolve().parents[1]
FILE=ROOT/'data'/'macro.json'
macro=json.loads(FILE.read_text(encoding='utf-8'))
WARN=[]
SESSION=requests.Session();SESSION.headers.update({'User-Agent':'FOLIO-personal-economics-dashboard/1.0 (+GitHub Pages; non-commercial)'})

def fred(series,start='2024-01-01'):
    url='https://fred.stlouisfed.org/graph/fredgraph.csv'
    r=SESSION.get(url,params={'id':series,'cosd':start},timeout=26)
    r.raise_for_status()
    lines=list(csv.DictReader(io.StringIO(r.text.lstrip('\ufeff'))))
    if not lines or 'DATE' not in lines[0] and 'observation_date' not in lines[0]:
        raise ValueError('Unexpected FRED format')
    result={}
    for row in lines:
        date=row.get('DATE') or row.get('observation_date')
        raw=row.get(series,'')
        try:
            val=float(raw)
            if 0<=val<=10000 and date:result[date]=val
        except (TypeError,ValueError):pass
    if not result:raise ValueError('No numeric rows in FRED '+series)
    return result

def update_us_rates():
    lower=fred('DFEDTARL',start='2025-01-01')
    upper=fred('DFEDTARU',start='2025-01-01')
    entries=macro['rates']['US']['history']
    by_date={row['date']:row for row in entries}
    previous=None
    for date in sorted(set(lower)&set(upper)):
        vals=(lower[date],upper[date])
        if previous is None or vals!=previous:
            # Dates in FRED are effective dates, not necessarily FOMC decision dates.
            if date not in by_date:
                by_date[date]={'date':date,'lower':vals[0],'upper':vals[1],
                               'event':'목표범위 유효일(FRED 관측)','source_url':'https://fred.stlouisfed.org/series/DFEDTARU',
                               'source_type':'fred-observation'}
        previous=vals
    macro['rates']['US']['history']=sorted(by_date.values(),key=lambda row:row['date'])
    last_date=max(set(lower)&set(upper))
    official=[x for x in macro['rates']['US']['history'] if x.get('source_type')=='official']
    last_official=official[-1] if official else None
    current={'date':last_date,'lower':lower[last_date],'upper':upper[last_date],
             'source_url':'https://fred.stlouisfed.org/series/DFEDTARU'}
    # Don't regress if stale downloaded data precede the verified seed rate.
    if not last_official or last_date>=last_official['date']:
        macro['rates']['US']['current']=current
    macro['rates']['US']['retrieval']='FRED 연방기금금리 목표범위 일별 관측(발표일과 유효일 상이 가능)'
    print('FRED US rates:',last_date,lower[last_date],upper[last_date])

def update_us_cpi():
    # MoM SA uses CPIAUCSL; YoY NSA uses CPIAUCNS; these bases deliberately differ.
    sa=fred('CPIAUCSL',start='2023-01-01');nsa=fred('CPIAUCNS',start='2023-01-01')
    us=[]
    for date,val in sorted(sa.items()):
        if date not in nsa or not date.endswith('-01'):continue
        month=date[:7]
        yy=int(month[:4]);mm=int(month[5:]);previous=f'{(yy-1) if mm==1 else yy}-{12 if mm==1 else mm-1:02d}-01'
        if previous not in sa or f'{yy-1}-{mm:02d}-01' not in nsa:continue
        mom=(val/sa[previous]-1)*100
        yoy=(nsa[date]/nsa[f'{yy-1}-{mm:02d}-01']-1)*100
        if date>dt.date.today().isoformat() or date<'2025-01-01':continue
        us.append({'month':month,'mom':round(mom,2),'yoy':round(yoy,2),
                   'source_type':'FRED derived from official BLS CPI','source':'https://fred.stlouisfed.org/series/CPIAUCSL; https://fred.stlouisfed.org/series/CPIAUCNS',
                   'note':'전월비: 계절조정 CPIAUCSL / 전년동월비: 비계절조정 CPIAUCNS'})
    if us:macro['cpi']['US']=us
    print('FRED US CPI:',len(us),'months',us[-1] if us else None)

def update_bok_with_key():
    key=os.environ.get('ECOS_API_KEY','').strip()
    if not key:
        print('BOK ECOS key not configured, keeping official source snapshots.');return
    today=dt.date.today()
    start=(today-dt.timedelta(days=400)).strftime('%Y%m%d')
    end=today.strftime('%Y%m%d')
    url=f'https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/1000/722Y001/D/{start}/{end}/0101000'
    res=SESSION.get(url,timeout=25);res.raise_for_status()
    obj=res.json();rows=obj.get('StatisticSearch',{}).get('row') or []
    if not rows:raise ValueError('BOK ECOS response has no target rate observations')
    parsed=[]
    for row in rows:
        date=dt.datetime.strptime(row['TIME'],'%Y%m%d').date().isoformat()
        v=float(row['DATA_VALUE'])
        if 0<=v<=25:parsed.append((date,v))
    if not parsed:return
    parsed.sort()
    current=macro['rates']['KR']['current'];last=parsed[-1]
    if last[0]>=current['date']:
        current.update(date=last[0],lower=last[1],upper=last[1],source_url='https://ecos.bok.or.kr')
    # Official decision history already seeded. Do not insert daily flat observations.
    h={v['date']:v for v in macro['rates']['KR']['history']}
    last_val=None
    for date,v in parsed:
        if last_val is None or v!=last_val:
            if date not in h:h[date]={'date':date,'lower':v,'upper':v,'event':'ECOS 기준금리 유효일',
                                      'source_url':'https://ecos.bok.or.kr','source_type':'ecos-observation'}
        last_val=v
    macro['rates']['KR']['history']=sorted(h.values(),key=lambda r:r['date'])
    macro['rates']['KR']['retrieval']='한국은행 ECOS(722Y001) 기준금리 일별 자료'
    print('ECOS KR base rate:',last)

for name,func in [('US policy',update_us_rates),('US CPI',update_us_cpi),('KR ECOS',update_bok_with_key)]:
    try:func()
    except Exception as e:
        WARN.append(f'{name}: {type(e).__name__}: {e}')
        print('WARNING',WARN[-1])
macro['last_refresh_attempt']=dt.datetime.now(dt.timezone.utc).isoformat()
macro['refresh_warnings']=WARN
FILE.write_text(json.dumps(macro,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
FILE.with_suffix('.js').write_text('window.FOLIO_MACRO = '+json.dumps(macro,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
print('Macro updates finished; warnings:',len(WARN))
