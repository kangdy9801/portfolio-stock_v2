import json
from pathlib import Path
R = Path(__file__).resolve().parents[1]
items = [
# Korea: name, sector, display symbol, yahoo symbol, currency, market
('삼성전자','반도체','KRX:005930','005930.KS','KRW','KR'),
('SK하이닉스','반도체','KRX:000660','000660.KS','KRW','KR'),
('DB하이텍','반도체','KRX:000990','000990.KS','KRW','KR'),
('한미반도체','반도체','KRX:042700','042700.KS','KRW','KR'),
('NAVER','인터넷·플랫폼','KRX:035420','035420.KS','KRW','KR'),
('카카오','인터넷·플랫폼','KRX:035720','035720.KS','KRW','KR'),
('현대차','자동차','KRX:005380','005380.KS','KRW','KR'),
('기아','자동차','KRX:000270','000270.KS','KRW','KR'),
('현대모비스','자동차','KRX:012330','012330.KS','KRW','KR'),
('LG에너지솔루션','2차전지','KRX:373220','373220.KS','KRW','KR'),
('삼성SDI','2차전지','KRX:006400','006400.KS','KRW','KR'),
('LG화학','화학','KRX:051910','051910.KS','KRW','KR'),
('에코프로비엠','2차전지','KOSDAQ:247540','247540.KQ','KRW','KR'),
('에코프로','2차전지','KOSDAQ:086520','086520.KQ','KRW','KR'),
('삼성바이오로직스','바이오','KRX:207940','207940.KS','KRW','KR'),
('셀트리온','바이오','KRX:068270','068270.KS','KRW','KR'),
('유한양행','제약','KRX:000100','000100.KS','KRW','KR'),
('KB금융','금융','KRX:105560','105560.KS','KRW','KR'),
('신한지주','금융','KRX:055550','055550.KS','KRW','KR'),
('하나금융지주','금융','KRX:086790','086790.KS','KRW','KR'),
('우리금융지주','금융','KRX:316140','316140.KS','KRW','KR'),
('SK텔레콤','통신','KRX:017670','017670.KS','KRW','KR'),
('KT','통신','KRX:030200','030200.KS','KRW','KR'),
('한국전력','에너지','KRX:015760','015760.KS','KRW','KR'),
('두산에너빌리티','에너지·원전','KRX:034020','034020.KS','KRW','KR'),
('HD한국조선해양','조선','KRX:009540','009540.KS','KRW','KR'),
('삼성중공업','조선','KRX:010140','010140.KS','KRW','KR'),
('한화오션','조선','KRX:042660','042660.KS','KRW','KR'),
('한화에어로스페이스','방산','KRX:012450','012450.KS','KRW','KR'),
('POSCO홀딩스','철강','KRX:005490','005490.KS','KRW','KR'),
('LG전자','전자','KRX:066570','066570.KS','KRW','KR'),
('하이브','엔터테인먼트','KRX:352820','352820.KS','KRW','KR'),
('JYP Ent.','엔터테인먼트','KOSDAQ:035900','035900.KQ','KRW','KR'),
('카카오뱅크','금융','KRX:323410','323410.KS','KRW','KR'),
('KODEX 200','국내 ETF','KRX:069500','069500.KS','KRW','KR'),
('TIGER 미국S&P500','해외 ETF','KRX:360750','360750.KS','KRW','KR'),
('KODEX 미국S&P500','해외 ETF','KRX:379800','379800.KS','KRW','KR'),
('TIGER 미국나스닥100','해외 ETF','KRX:133690','133690.KS','KRW','KR'),
# US: name, sector, display symbol, yahoo symbol, currency, market
('애플','기술','NASDAQ:AAPL','AAPL','USD','US'),
('마이크로소프트','기술','NASDAQ:MSFT','MSFT','USD','US'),
('엔비디아','반도체','NASDAQ:NVDA','NVDA','USD','US'),
('알파벳 (구글)','인터넷·플랫폼','NASDAQ:GOOGL','GOOGL','USD','US'),
('아마존','소비재·플랫폼','NASDAQ:AMZN','AMZN','USD','US'),
('메타','인터넷·플랫폼','NASDAQ:META','META','USD','US'),
('테슬라','자동차','NASDAQ:TSLA','TSLA','USD','US'),
('브로드컴','반도체','NASDAQ:AVGO','AVGO','USD','US'),
('AMD','반도체','NASDAQ:AMD','AMD','USD','US'),
('마이크론','반도체','NASDAQ:MU','MU','USD','US'),
('TSMC','반도체','NYSE:TSM','TSM','USD','US'),
('ASML','반도체 장비','NASDAQ:ASML','ASML','USD','US'),
('팔란티어','소프트웨어','NASDAQ:PLTR','PLTR','USD','US'),
('버크셔 해서웨이 B','금융','NYSE:BRK.B','BRK-B','USD','US'),
('JP모건','금융','NYSE:JPM','JPM','USD','US'),
('코카콜라','필수소비재','NYSE:KO','KO','USD','US'),
('펩시코','필수소비재','NASDAQ:PEP','PEP','USD','US'),
('존슨앤드존슨','헬스케어','NYSE:JNJ','JNJ','USD','US'),
('월마트','유통','NASDAQ:WMT','WMT','USD','US'),
('코스트코','유통','NASDAQ:COST','COST','USD','US'),
('비자','금융','NYSE:V','V','USD','US'),
('엑손모빌','에너지','NYSE:XOM','XOM','USD','US'),
('VOO','미국지수 ETF','NYSEARCA:VOO','VOO','USD','US'),
('QQQ','미국지수 ETF','NASDAQ:QQQ','QQQ','USD','US'),
('QQQM','미국지수 ETF','NASDAQ:QQQM','QQQM','USD','US'),
('SPY','미국지수 ETF','NYSEARCA:SPY','SPY','USD','US'),
('SCHD','배당 ETF','NYSEARCA:SCHD','SCHD','USD','US'),
('JEPQ','월배당 ETF','NASDAQ:JEPQ','JEPQ','USD','US'),
('SGOV','미국채 ETF','NYSEARCA:SGOV','SGOV','USD','US'),
('VTI','미국지수 ETF','NYSEARCA:VTI','VTI','USD','US'),
('SOXX','반도체 ETF','NASDAQ:SOXX','SOXX','USD','US'),
('SMH','반도체 ETF','NASDAQ:SMH','SMH','USD','US'),
('GLD','금 ETF','NYSEARCA:GLD','GLD','USD','US'),
('TLT','미국채 ETF','NASDAQ:TLT','TLT','USD','US'),
]
records=[dict(name=name,sector=sector,display=display,symbol=symbol,currency=currency,market=market,kind=('ETF' if 'ETF' in sector else 'STOCK')) for name,sector,display,symbol,currency,market in items]
# Optional user-defined tracking list, edited as plain JSON via GitHub web UI.
custom_path = R/'data/custom_stocks.json'
if custom_path.exists():
    custom = json.loads(custom_path.read_text(encoding='utf-8'))
    if not isinstance(custom, list) or len(custom) > 100:
        raise ValueError('data/custom_stocks.json must contain <=100 objects')
    for item in custom:
        if not isinstance(item, dict) or not all(isinstance(item.get(k), str) and item[k].strip() for k in ['name','sector','display','symbol','currency','market']):
            raise ValueError('Every custom stock requires name, sector, display, symbol, currency and market')
        if item['currency'] not in ('KRW','USD') or item['market'] not in ('KR','US'):
            raise ValueError('Invalid custom stock currency or market')
        item['symbol'] = item['symbol'].strip().upper()
        if any(existing['symbol'] == item['symbol'] for existing in records):
            continue
        records.append({k:item[k] for k in ('name','sector','display','symbol','currency','market')} | {'kind': item.get('kind','STOCK')})
assert len({x['symbol'] for x in records}) == len(records)
(R/'data/catalog.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(R/'data/catalog.js').write_text('window.FOLIO_CATALOG = '+json.dumps(records,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
print(len(records),'stocks prepared')
