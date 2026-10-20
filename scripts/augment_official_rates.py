import json
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'data'/'macro.json'
d=json.loads(p.read_text(encoding='utf-8'))
kr=[
 ('2026-01-15',2.5,'https://www.bok.or.kr/portal/bbs/P0000559/view.do?menuNo=200788&nttId=10095711','동결'),
 ('2026-02-26',2.5,'https://www.bok.or.kr/portal/bbs/P0000559/view.do?menuNo=200789&nttId=10096670','동결'),
 ('2026-04-10',2.5,'https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=10097452','동결'),
 ('2026-05-28',2.5,'https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=10098188','동결'),
 ('2026-07-16',2.75,'https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=11062942','인상'),
 ('2026-08-27',3.0,'https://www.bok.or.kr/portal/bbs/P0000559/view.do?nttId=11064191','인상'),
]
us=[
 ('2026-01-28',3.5,3.75,'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260128a.htm','동결'),
 ('2026-03-18',3.5,3.75,'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260318a.htm','동결'),
 ('2026-04-29',3.5,3.75,'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260429a1.htm','동결'),
 ('2026-06-17',3.5,3.75,'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260617a.htm','동결'),
 ('2026-07-29',3.5,3.75,'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm','동결'),
 ('2026-09-16',3.75,4.,'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm','인상'),
]
for code,rr in [('KR',kr),('US',us)]:
 h=d['rates'][code]['history']; bydate={v['date']:v for v in h}
 for row in rr:
  if code=='KR':date,lo,src,event=row;hi=lo
  else:date,lo,hi,src,event=row
  bydate[date]={'date':date,'lower':lo,'upper':hi,'event':event,'source_url':src,'source_type':'official'}
 d['rates'][code]['history']=sorted(bydate.values(),key=lambda x:x['date'])
for obj in d['events']:
 if obj['region']=='US' and obj['kind']=='RATE':
  obj['source_url']='https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p.with_suffix('.js').write_text('window.FOLIO_MACRO = '+json.dumps(d,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
print('historical decisions: KR',len(d['rates']['KR']['history']),'US',len(d['rates']['US']['history']))
