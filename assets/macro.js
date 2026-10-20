/* FOLIO v4 - verified economic releases and local-only monthly PDF archive. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const seed = window.FOLIO_REPORT_SEED?.reports || [];
  const macro = window.FOLIO_MACRO || {rates:{},events:[],cpi:{},projections:[]};
  const KEY = 'folio-economics-v4';
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const text = v => String(v ?? '');
  const esc = v => text(v).replace(/[&<>"']/g,ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const compact = n => finite(n) ? (n>0?'+':'')+n.toFixed(1)+'%' : '—';
  const rateFmt = (lo,hi) => finite(lo) && finite(hi) ? (Math.abs(lo-hi)<.00001 ? lo.toFixed(2)+'%' : lo.toFixed(2)+'–'+hi.toFixed(2)+'%') : '—';
  const KST = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const ROOT_KIND = {CPI:'소비자물가동향',INDUSTRY:'산업활동동향',TRADE:'수출입동향'};
  const safeJson = raw => {try{return JSON.parse(raw);}catch(e){return null;}};
  const note = msg => {const el=$('toast');if(!el)return;el.textContent=msg;el.classList.add('visible');clearTimeout(note.tm);note.tm=setTimeout(()=>el.classList.remove('visible'),3400);};
  let showPast=false, chosenMonth='LATEST';
  let chosenIds={INDUSTRY:null,CPI:null,TRADE:null};
  let uploadPreview=null;

  function validReport(r){
    return Boolean(r && typeof r==='object' && ['CPI','INDUSTRY','TRADE'].includes(r.kind) && /^20\d{2}-(0[1-9]|1[0-2])$/.test(r.month) &&
      r.metrics && typeof r.metrics==='object' && Object.values(r.metrics).every(v=>v===null||finite(v)) &&
      Array.isArray(r.sectors) && r.sectors.length<=100 && r.sectors.every(s=>s && text(s.name).length<80 && text(s.indicator).length<80 && [s.mom,s.yoy].every(v=>v===null||finite(v)) && (s.amount===undefined||s.amount===null||finite(s.amount))) &&
      text(r.id).length<150 && text(r.filename).length<250 && text(r.notes).length<12000);
  }
  function validData(data){
    return Boolean(data && typeof data==='object' && Array.isArray(data.reports) && data.reports.length<=240 && data.reports.every(validReport) &&
      Array.isArray(data.forecasts) && data.forecasts.length<=150 && data.forecasts.every(f=>f&&['KR','US'].includes(f.country)&&/^20\d\d-\d\d-\d\d$/.test(f.date)&&finite(f.lower)&&finite(f.upper)&&text(f.source).length<200));
  }
  function normalState(data){return {reports:data.reports.slice(),forecasts:data.forecasts.slice()};}
  const initial=safeJson(localStorage.getItem(KEY));
  let userState=validData(initial)?normalState(initial):{reports:[],forecasts:[]};
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(userState));return true;}catch(e){note('브라우저 저장공간 부족으로 기록을 저장하지 못했습니다.');return false;}}
  function exportData(){return JSON.parse(JSON.stringify(userState));}
  function importData(data){if(!validData(data))throw new Error('경제보고서 백업 형식 오류');userState=normalState(data);persist();renderAll();}
  const allReports = () => [...seed, ...userState.reports].filter(validReport);
  function recordLatest(kind,month){
    const rows=allReports().filter(r=>r.kind===kind && (!month || r.month===month));
    if(!rows.length)return null;
    return rows.sort((a,b)=>a.month.localeCompare(b.month)||text(a.importedAt).localeCompare(text(b.importedAt))).at(-1);
  }
  function recordForDisplay(kind,month){
    if(chosenIds[kind]){const override=allReports().find(r=>r.id===chosenIds[kind]&&r.kind===kind&&(!month||month===r.month));if(override)return override;}
    return recordLatest(kind,month);
  }
  function badge(status){return status==='verified'?'공식 PDF 확인':status==='reviewed'?'사용자 검토 저장':'자동추출·검토 필요';}

  // ---------- Dashboard: dates, central-bank decisions, inflation ----------
  function renderCalendar(){
    const region=$('econCalRegion').value,kind=$('econCalKind').value,today=KST();
    const events=(macro.events||[]).filter(e=>(region==='ALL'||e.region===region)&&(kind==='ALL'||e.kind===kind));
    const subset=(showPast?events.filter(e=>e.date<today).slice(-9).reverse():events.filter(e=>e.date>=today).slice(0,8));
    const tag={RATE:'금리',CPI:'물가',INDUSTRY:'산업',EMPLOYMENT:'고용'};
    $('econCalendarList').innerHTML=subset.length?subset.map(ev=>{
      const day=ev.date.slice(8),month=Number(ev.date.slice(5,7));
      return `<div class="econ-event ${ev.date<today?'past':''}"><div class="econ-event-day"><b>${day}</b><span>${month}월</span></div><div class="econ-event-main"><strong>${esc(ev.title)}</strong><small>${ev.region==='KR'?'🇰🇷 한국':'🇺🇸 미국'}${ev.reference_month?' · '+esc(ev.reference_month)+' 기준':''} · ${esc(ev.local_time||'시간 미정')}</small></div><span class="econ-event-tag ${ev.kind==='RATE'?'rate':ev.kind==='CPI'?'cpi':''}">${tag[ev.kind]||'지표'}</span></div>`;
    }).join(''):'<div class="report-sector-empty">해당 조건의 '+(showPast?'지난':'향후')+' 발표 일정이 없습니다. 공식 발표 일정을 확인해 주세요.</div>';
    $('econShowPast').textContent=showPast?'다가오는 일정 보기':'지난 발표 보기';
    $('econCalendarNote').textContent='한국: 국가데이터처·한국은행 2026년 공표표 / 미국: FOMC·BLS 공개 일정. 일정 변경·공휴일 및 시차 확인이 필요하며, 예약 실행은 실제 발표를 보장하지 않습니다.';
  }
  function ratePlot(){
    const chart=$('econRateChart'),end=KST();
    const begin='2025-01-01';
    const dateTime=s=>Date.parse(s+'T00:00:00Z');const startT=dateTime(begin),endT=Math.max(startT+86400000,dateTime(end));
    const rows=[{region:'KR',color:'#2aa88a'},{region:'US',color:'#ed9a66'}];
    const W=600,H=220,L=49,R=17,T=22,B=36,innerW=W-L-R,innerH=H-T-B;
    const X=d=>L+(Math.max(startT,Math.min(endT,dateTime(d)))-startT)/(endT-startT)*innerW;
    const Y=v=>T+(5.25-v)/5.25*innerH;
    const grids=[0,1,2,3,4,5].map(n=>`<line x1="${L}" y1="${Y(n)}" x2="${W-R}" y2="${Y(n)}" stroke="#e8f0f0"/><text x="${L-8}" y="${Y(n)+4}" text-anchor="end" fill="#93a4ad" font-size="11">${n}%</text>`).join('');
    const lines=rows.map(row=>{
      const hs=(macro.rates?.[row.region]?.history||[]).filter(v=>v.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
      if(!hs.length)return '';
      const filtered=hs.filter(v=>v.date>=begin),prev=hs.filter(v=>v.date<begin).at(-1);
      const points=[];
      if(prev)points.push([begin,(prev.lower+prev.upper)/2]);
      for(const p of filtered)points.push([p.date,(p.lower+p.upper)/2]);
      if(!points.length)return '';
      let path=`M ${X(points[0][0])} ${Y(points[0][1])}`;
      for(let i=1;i<points.length;i++)path+=` H ${X(points[i][0])} V ${Y(points[i][1])}`;
      path+=` H ${X(end)}`;
      return `<path d="${path}" fill="none" stroke="${row.color}" stroke-width="3" stroke-linejoin="round"/>`;
    }).join('');
    const labels=['2025-01-01','2025-07-01','2026-01-01','2026-07-01'].filter(d=>d<=end).map(d=>`<text x="${X(d)}" y="${H-8}" font-size="10" text-anchor="middle" fill="#96a5b2">${d.slice(2,7)}</text>`).join('');
    chart.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="한국은행 기준금리와 미국 목표금리 중간값 변경 이력"><rect width="${W}" height="${H}" fill="#fbfdfd"/>${grids}${lines}${labels}<text x="${W-15}" y="15" text-anchor="end" font-size="11" fill="#5d7787">● 한국 <tspan fill="#df9257">● 미국 (범위 중간값)</tspan></text></svg>`;
  }
  function displayForecast(country,date){return userState.forecasts.find(f=>f.country===country&&f.date===date)||null;}
  function rateRows(){
    const meeting=(macro.events||[]).filter(e=>e.kind==='RATE').map(e=>({...e,meetingDate:e.region==='US'?new Date(Date.parse(e.date+'T00:00:00Z')-86400000).toISOString().slice(0,10):e.date}));
    const results=[];
    for(const r of ['KR','US']){
      const rate=macro.rates?.[r];
      for(const m of meeting.filter(x=>x.region===r)){
        const actual=(rate?.history||[]).find(p=>p.date===m.meetingDate);
        const forecast=displayForecast(r,m.meetingDate);
        // For hold decisions not represented in a change-point series, show 'unverified' rather than claiming no-change.
        results.push({date:m.meetingDate,country:r,forecast,actual,source:m.source_url});
      }
    }
    return results.sort((a,b)=>b.date.localeCompare(a.date));
  }
  function renderRateTable(){
    const rows=rateRows();
    $('econRateHistoryBody').innerHTML=rows.map(r=>{
      const result=r.actual?rateFmt(r.actual.lower,r.actual.upper):'—';
      const estimate=r.forecast?rateFmt(r.forecast.lower,r.forecast.upper):'—';
      return `<tr><td>${esc(r.date)}</td><td>${r.country==='KR'?'🇰🇷 한국':'🇺🇸 미국'}</td><td>${r.country==='KR'?'금통위 기준금리':'FOMC 목표범위'}</td><td class="${r.forecast?'':'econ-blank'}">${esc(estimate)}${r.forecast?`<br><small>사용자 입력 · ${esc(r.forecast.source)}</small>`:''}</td><td><b>${esc(result)}</b>${r.actual?'':'<br><small>해당 회의 확인값 없음</small>'}</td><td><a href="${esc(r.actual?.source_url||r.source||'#')}" target="_blank" rel="noopener noreferrer">공식 일정/결정 ↗</a></td></tr>`;
    }).join('');
    const dots=(macro.projections||[]).map(x=>`미 연준 ${esc(x.period)} ${esc(x.type)}: <b>${finite(x.value)?x.value.toFixed(1)+'%':'—'}</b> · <a href="${esc(x.source_url)}" target="_blank" rel="noopener noreferrer">공식 자료 ↗</a> (다음 회의 시장 예상치가 아님)`).join('<hr>');
    $('econFedProjection').innerHTML=dots||'공식 중장기 전망 없음';
  }
  function renderRates(){
    for(const [c,rateId,sinceId] of [['KR','econKrRate','econKrSince'],['US','econUsRate','econUsSince']]){
      const d=macro.rates?.[c]?.current;
      $(rateId).textContent=rateFmt(d?.lower,d?.upper);
      $(sinceId).textContent=d?.date?`${d.date} 공식 발표 기록`:'자료 없음';
    }
    $('econRateUpdated').textContent='최신 금리 자료·원천 확인';
    ratePlot();renderRateTable();
  }
  function plotCpiSeries(series){
    const W=510,H=173,L=37,R=13,T=19,B=34,x=i=>L+i/(series.length-1||1)*(W-L-R);
    const y=v=>T+(Math.max(4,Math.ceil(Math.max(...series.map(p=>Math.abs(p.yoy||0)))))+1-v)/7*120;
    const vals=[...series.map(v=>v.mom||0),...series.map(v=>v.yoy||0)];
    const min=Math.min(0,...vals)-.2,max=Math.max(4,...vals)+.4;
    const Y=v=>T+(max-v)/(max-min)*(H-B-T);
    const tick=[0,1,2,3,4].filter(n=>n<=max).map(n=>`<line x1="${L}" x2="${W-R}" y1="${Y(n)}" y2="${Y(n)}" stroke="#e7eeef"/><text x="${L-7}" y="${Y(n)+4}" text-anchor="end" font-size="10" fill="#a0aeb9">${n}%</text>`).join('');
    const line=k=>series.map((v,i)=>`${x(i)},${Y(v[k])}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="한국 소비자물가 전월 및 전년동월 상승률 추이">${tick}<polyline fill="none" points="${line('yoy')}" stroke="#38a48a" stroke-width="3"/><polyline fill="none" points="${line('mom')}" stroke="#e4a363" stroke-width="3"/>${series.map((v,i)=>`<text x="${x(i)}" y="${H-6}" text-anchor="middle" fill="#94a7b1" font-size="10">${v.month.slice(5)}월</text>`).join('')}<text x="${W-R}" y="14" text-anchor="end" fill="#45917e" font-size="11">● 전년동월 <tspan fill="#d6975d">● 전월</tspan></text></svg>`;
  }
  function renderCpi(){
    // A new locally-reviewed CPI PDF supersedes older release snapshots for that statistical month.
    // Store history separately: reporting chart shows newest verified entry per reference month.
    const monthData=new Map((macro.cpi?.KR||[]).filter(v=>finite(v.mom)&&finite(v.yoy)).map(v=>[v.month,v]));
    for(const doc of allReports().filter(r=>r.kind==='CPI').sort((a,b)=>a.month.localeCompare(b.month)||text(a.importedAt).localeCompare(text(b.importedAt)))){
      if(finite(doc.metrics.headlineMom)&&finite(doc.metrics.headlineYoy))monthData.set(doc.month,{month:doc.month,mom:doc.metrics.headlineMom,yoy:doc.metrics.headlineYoy,source:doc.source});
    }
    const kr=[...monthData.values()].sort((a,b)=>a.month.localeCompare(b.month));
    const us=(macro.cpi?.US||[]).filter(v=>finite(v.mom)&&finite(v.yoy)).sort((a,b)=>a.month.localeCompare(b.month));
    const a=kr.at(-1),b=us.at(-1);
    $('econCpiStats').innerHTML=[{name:'🇰🇷 한국 CPI',d:a},{name:'🇺🇸 미국 CPI',d:b}].map(v=>`<div class="econ-cpi-tile"><span>${v.name} · ${v.d?.month||'미수집'}</span><strong>${compact(v.d?.yoy)}</strong><small>전년동월비 (물가상승률)</small><strong style="font-size:18px;color:#537b77;margin-bottom:2px">${compact(v.d?.mom)}</strong><small>전월비</small></div>`).join('');
    $('econCpiMiniChart').innerHTML=kr.length>=2?plotCpiSeries(kr.slice(-7)):'<div class="report-sector-empty">소비자물가 과거 추이 데이터가 부족합니다.</div>';
  }
  function renderDashboard(){renderCalendar();renderRates();renderCpi();}

  // ---------- v5: trade(t) + industry(t-1), CPI independent ----------
  function numberFrom(s){if(s===undefined||s===null||String(s).trim()==='')return null;const n=Number(String(s).replace(/,/g,''));return Number.isFinite(n)?n:null;}
  function cleanText(s){return text(s).replace(/\s+/g,' ').replace(/[％﹪]/g,'%').replace(/−/g,'-');}
  function previousMonth(m){if(!/^20\d{2}-\d\d$/.test(text(m)))return '';const [y,mon]=m.split('-').map(Number);const d=new Date(Date.UTC(y,mon-2,1));return d.toISOString().slice(0,7);}
  function nextMonth(m){if(!/^20\d{2}-\d\d$/.test(text(m)))return '';const [y,mon]=m.split('-').map(Number);const d=new Date(Date.UTC(y,mon,1));return d.toISOString().slice(0,7);}
  function deltaPct(before,after){return finite(before)&&finite(after)&&before!==0 ?(after/before-1)*100:null;}
  function decimal(v,precision=1){return finite(v)?Number(v).toLocaleString('ko-KR',{maximumFractionDigits:precision,minimumFractionDigits:precision}):'—';}
  function signedAmount(v,unit='억 달러',precision=1){return finite(v)?(v>0?'+':'')+decimal(v,precision)+' '+unit:'—';}
  function rateLabel(v){return finite(v)?(v>0?'+':'')+decimal(v,1)+'%':'—';}
  function tradeAmount(doc){return doc?.metrics?.exportAmount;}
  function findSector(doc,name,preferred=''){const all=(doc?.sectors||[]).filter(s=>s.name===name);return all.find(s=>text(s.indicator).includes(preferred))||all[0]||null;}
  function tradeMonths(){return [...new Set(allReports().filter(r=>r.kind==='TRADE').map(r=>r.month))].sort((a,b)=>b.localeCompare(a));}
  function cpiMonths(){return [...new Set(allReports().filter(r=>r.kind==='CPI').map(r=>r.month))].sort((a,b)=>b.localeCompare(a));}
  let chosenTradeMonth='2026-09',chosenCpiMonth='2026-05';
  function reportChosen(kind,month){const selected=allReports().find(r=>r.id===chosenIds[kind]&&r.kind===kind&&r.month===month);return selected||recordLatest(kind,month);}
  function refreshChoice(id,months,selected){const e=$(id);if(!e)return '';
    e.innerHTML=months.map(m=>`<option value="${esc(m)}">${esc(m)} 기준</option>`).join('');
    if(!months.includes(selected))selected=months[0]||'';e.value=selected;return selected;
  }
  const tradeSectorAlias={
    '반도체':{industry:'반도체',type:'exact'},'자동차':{industry:'자동차',type:'exact'},
    '일반기계':{industry:'기계장비',type:'proxy'},'컴퓨터':{industry:'컴퓨터',type:'proxy'},
    '선박':{industry:'기타운송장비',type:'proxy'},'디스플레이':{industry:'전자부품',type:'proxy'},
    '석유제품':{industry:'석유정제',type:'proxy'},'석유화학':{industry:'화학제품',type:'proxy'},
    '바이오헬스':{industry:'의약품',type:'proxy'},'철강':{industry:'1차금속',type:'proxy'},
    '무선통신기기':{industry:'통신·방송장비',type:'proxy'}
  };
  function selectIndustrySignal(doc,sector){
    const alias=tradeSectorAlias[sector];if(!alias||!doc)return null;
    const same=doc.sectors.filter(s=>s.name===alias.industry);
    const preferred=same.find(s=>/제조업 생산|생산지수/.test(s.indicator))||same.find(s=>/수출출하/.test(s.indicator))||same.find(s=>/제조업 출하/.test(s.indicator))||same[0];
    return preferred?{...preferred,proxy:alias.type==='proxy',proxyName:alias.industry}:null;
  }
  function getPreviousSectorGrowth(trade,tradePrior,s){
    const old=findSector(tradePrior,s.name),oldAmt=old?.amount;
    if(finite(oldAmt))return {value:deltaPct(oldAmt,s.amount),source:'직전 월 공식 수출액'};
    const approx=trade?.previousMonthApprox?.[s.name];
    if(approx&&finite(approx.amount))return {value:deltaPct(approx.amount,s.amount),source:'직전 월 반올림 참고값 · 약식'};
    return {value:null,source:'직전월 품목별 금액 없음'};
  }
  function industryPreviousRate(current,prev,s){
    const revised=(current?.previousRevisions?.sectors||[]).find(x=>x.name===s.name&&x.indicator===s.indicator);
    const orig=(prev?.sectors||[]).find(x=>x.name===s.name&&x.indicator===s.indicator);
    return {value:finite(revised?.mom)?revised.mom:orig?.mom,source:finite(revised?.mom)?'수정치':'최초치'};
  }
  function buildKpi(title,value,sub){return `<article class="report-stat"><span>${esc(title)}</span><strong>${esc(value)}</strong><small>${esc(sub)}</small></article>`;}
  function renderKpis(trade,old,industry,oldIndustry){
    const t=trade?.metrics||{},a=old?.metrics||{},i=industry?.metrics||{};
    const revised=industry?.previousRevisions?.metrics||{};
    const indPrior=finite(revised.headlineMom)?revised.headlineMom:oldIndustry?.metrics?.headlineMom;
    $('reportTopStats').innerHTML=[
      buildKpi('선택 월 수출액',finite(t.exportAmount)?decimal(t.exportAmount,1)+'억 달러':'—',`${trade?.month||'—'} · 전월대비 ${rateLabel(deltaPct(a.exportAmount,t.exportAmount))}`),
      buildKpi('선택 월 수입액',finite(t.importAmount)?decimal(t.importAmount,1)+'억 달러':'—',`${trade?.month||'—'} · 전월대비 ${rateLabel(deltaPct(a.importAmount,t.importAmount))}`),
      buildKpi('무역수지',finite(t.tradeBalance)?decimal(t.tradeBalance,1)+'억 달러':'—',`${trade?.month||'—'} · 전월보다 ${signedAmount(finite(a.tradeBalance)?t.tradeBalance-a.tradeBalance:null)}`),
      buildKpi('직전월 산업생산',rateLabel(i.headlineMom),`${industry?.month||'—'} · 이전달 전월비 ${rateLabel(indPrior)}${finite(revised.headlineMom)?' (수정치)':''}`)
    ].join('');
  }
  function renderTradeDelta(trade,old){
    const t=trade?.metrics||{},a=old?.metrics||{};
    $('reportTradeRange').textContent=trade&&old?`${old.month} → ${trade.month} · 기준: 통관 수출입 금액 · 단위: 억 달러`:'직전 월 수출입동향이 없으면 금액의 전월 변화율은 계산하지 않습니다.';
    const cells=[['수출액',a.exportAmount,t.exportAmount],['수입액',a.importAmount,t.importAmount],['무역수지',a.tradeBalance,t.tradeBalance]];
    $('reportTradeChange').innerHTML=cells.map(([title,before,after])=>{
      const diff=finite(before)&&finite(after)?after-before:null,pct=deltaPct(before,after);
      return `<div class="trade-summary ${finite(diff)&&diff>0?'positive':finite(diff)&&diff<0?'negative':''}"><span>${title}</span><strong>${rateLabel(pct)}</strong><small>${finite(before)?decimal(before,1):'—'} → ${finite(after)?decimal(after,1):'—'}억 달러 · 차이 ${signedAmount(diff)}</small></div>`;
    }).join('');
    const rows=trade?.sectors||[];
    const matched=rows.map(s=>({s,prev:findSector(old,s.name)?.amount}));
    $('reportTradeSectorBody').innerHTML=matched.length?matched.map(({s,prev})=>{
      const diff=finite(prev)&&finite(s.amount)?s.amount-prev:null,pct=deltaPct(prev,s.amount);
      return `<tr><td><b>${esc(s.name)}</b></td><td class="num">${decimal(prev)}</td><td class="num">${decimal(s.amount)}</td><td class="num ${finite(diff)?diff>=0?'up':'down':''}">${signedAmount(diff)}</td><td class="num ${finite(pct)?pct>=0?'up':'down':''}">${rateLabel(pct)}</td><td class="num">${rateLabel(s.yoy)}</td></tr>`;
    }).join(''):'<tr><td colspan="6">등록된 수출 품목 상세 금액이 없습니다. PDF 업로드 시 검토해 입력하세요.</td></tr>';
    const chartRows=matched.filter(x=>finite(x.prev)&&finite(x.s.amount)).map(x=>({name:x.s.name,diff:x.s.amount-x.prev})).sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff)).slice(0,9);
    const max=Math.max(1,...chartRows.map(r=>Math.abs(r.diff)));
    const W=760,L=130,R=100,rowH=28,H=chartRows.length*rowH+34;
    const center=L+(W-L-R)/2,scale=(W-L-R)/2/max;
    $('reportTradeChart').innerHTML=chartRows.length?`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="품목별 수출액의 전월 대비 증감(억 달러)"><line x1="${center}" y1="16" x2="${center}" y2="${H-17}" stroke="#91a9b0" stroke-dasharray="3 5"/>${chartRows.map((r,j)=>{const y=19+j*rowH,len=Math.abs(r.diff)*scale,up=r.diff>=0;return `<text x="${L-11}" y="${y+14}" text-anchor="end" font-size="11" fill="#597588">${esc(r.name)}</text><rect x="${up?center:center-len}" y="${y+2}" width="${len}" height="15" rx="4" fill="${up?'#43af90':'#df8078'}"/><text x="${up?center+len+7:center-len-7}" y="${y+14}" text-anchor="${up?'start':'end'}" font-size="10" fill="#435867">${r.diff>0?'+':''}${decimal(r.diff,1)}</text>`;}).join('')}<text x="${W-12}" y="${H-7}" text-anchor="end" font-size="10" fill="#8da2ac">단위: 억 달러 · 8→9월 금액 차이</text></svg>`:'<div class="report-sector-empty">직전 월의 수출 품목별 금액이 없어 변화 그래프를 만들 수 없습니다.</div>';
  }
  function renderImports(trade,old){
    const a=[{name:'총수입',amount:trade?.metrics?.importAmount,yoy:trade?.metrics?.secondaryYoy,prior:old?.metrics?.importAmount}];
    for(const r of trade?.imports||[]){const oldr=(old?.imports||[]).find(s=>s.name===r.name);a.push({...r,prior:oldr?.amount});}
    $('reportImportBody').innerHTML=a.map(r=>{
      const yoy=rateLabel(r.yoy),mom=rateLabel(deltaPct(r.prior,r.amount));
      const note=(r.name==='원유'?'원유 금액 반올림 · ': '')+(finite(r.quantityYoy)?'수입 물량 전년비 '+rateLabel(r.quantityYoy)+' · ':'')+(finite(r.priceYoy)?'수입단가 전년비 '+rateLabel(r.priceYoy):'');
      return `<tr><td><b>${esc(r.name)}</b></td><td class="num">${finite(r.prior)?decimal(r.prior,1):'—'}</td><td class="num">${finite(r.amount)?decimal(r.amount,1):'—'}</td><td class="num">${mom}</td><td class="num">${yoy}</td><td><small>${esc(note||'—')}</small></td></tr>`;
    }).join('');
  }
  function compareBadge(label,status){return `<span class="trade-tag ${status}">${esc(label)}</span>`;}
  function directionOf(a,b){if(!finite(a)||!finite(b)||a===0||b===0)return 'missing';return Math.sign(a)===Math.sign(b)?'same':'opposite';}
  function directionLabel(dir){return dir==='same'?'방향 일치':dir==='opposite'?'방향 반대':'판정보류';}
  function renderSectorPair(trade,prevTrade,industry){
    const basis=$('reportSectorBasis').value;
    $('reportSectorPairTitle').textContent=`${trade?.month||'—'} 수출입 ↔ ${industry?.month||'—'} 산업활동`;
    const isMatching=Boolean(trade&&industry&&industry.month===previousMonth(trade.month));
    $('reportPairBadge').textContent=isMatching?'1개월 시차 확인':'보고서 누락 · 비교보류';
    $('reportPairBadge').classList.toggle('matched',isMatching);
    $('reportCoverageTag').textContent=isMatching?`${trade.month} 무역 / ${industry.month} 산업`:'한 달 전 산업 보고서 필요';
    $('reportCoverageTag').classList.toggle('matched',isMatching);
    $('reportPairIntro').innerHTML=isMatching?`<strong>기준월을 1개월 어긋나게 짝짓기</strong>무역: ${esc(trade.month)} · 산업: ${esc(industry.month)} (이전달)<br>수출 통관금액과 전월 산업생산의 증감률 부호를 비교합니다.`:'<strong>비교 보류</strong>선택한 수출입 월의 직전 산업활동 PDF가 없습니다. 보고서 파일을 추가하세요.';
    if(!isMatching){$('reportSectorCrossBody').innerHTML='<tr><td colspan="6">두 기준월의 문서가 모두 있어야 비교할 수 있습니다.</td></tr>';$('reportSectorInsight').textContent='비교 자료 부족';return;}
    const rows=(trade.sectors||[]).map(s=>{
      const ind=selectIndustrySignal(industry,s.name),mom=getPreviousSectorGrowth(trade,prevTrade,s);
      let selectedBasis=basis,tradeVal=mom.value,indVal=ind?.mom;
      if(basis==='yoy'){tradeVal=s.yoy;indVal=ind?.yoy;}
      else if(basis==='auto'&&(!finite(tradeVal)||!finite(indVal))){selectedBasis='yoy';tradeVal=s.yoy;indVal=ind?.yoy;}
      const result=ind?.proxy?'proxy':directionOf(tradeVal,indVal);
      const label=ind?.proxy?'유사업종 · 참고':directionLabel(result);
      return {s,ind,mom,selectedBasis,tradeVal,indVal,result,label};
    });
    $('reportSectorCrossBody').innerHTML=rows.map(r=>{
      const tradeMeta=r.selectedBasis==='yoy'?'전년동월비':'전월비',indMeta=r.selectedBasis==='yoy'?'전년동월비':'전월비';
      const extra=(r.s.name==='반도체'&&industry.month==='2026-08')?' · 반도체 수출출하 전월 +7.9% (생산과 방향 상이)':'';
      return `<tr><td><b>${esc(r.s.name)}</b></td><td class="num">${decimal(r.s.amount,1)}억 달러</td><td class="num ${finite(r.tradeVal)?r.tradeVal>=0?'up':'down':''}">${rateLabel(r.tradeVal)}<small class="trade-aux">${tradeMeta}${r.selectedBasis==='mom'&&r.mom.source.includes('반올림')?' · 근사치':''}</small></td><td><b>${esc(r.ind?.proxyName||'일치 산업분류 없음')}</b><small class="trade-aux">${esc(r.ind?.indicator||'—')}${esc(extra)}</small></td><td class="num ${finite(r.indVal)?r.indVal>=0?'up':'down':''}">${rateLabel(r.indVal)}<small class="trade-aux">${indMeta}</small></td><td>${compareBadge(r.label,r.result)}</td></tr>`;
    }).join('')||'<tr><td colspan="6">수출 품목별 자료가 필요합니다.</td></tr>';
    const avail=rows.filter(x=>x.result==='same'||x.result==='opposite'),same=avail.filter(x=>x.result==='same').length,opp=avail.length-same;
    let summary=`<b>${esc(trade.month)} ↔ ${esc(industry.month)} 섹터 신호</b> · 비교 가능한 동일 산업분류 ${avail.length}개 중 ${same}개 동일방향 / ${opp}개 반대방향. 연관업종 대리 지표와 미제공 수치는 집계에서 제외합니다.`;
    const semi=rows.find(x=>x.s.name==='반도체');if(semi&&trade.month==='2026-09'&&industry.month==='2026-08')summary+=' <br>반도체는 9월 수출액이 8월보다 증가했지만 8월 생산은 감소했습니다. 반면 8월 수출출하 지수는 증가해 생산과 출하를 구분해야 합니다.';
    if(trade.month==='2026-08')summary+=' <br>8월 자료의 직전 7월 품목별 수출액은 대부분 제출되지 않았습니다. 7월 반올림 참고값이 없는 항목은 전년동월비 기준으로만 표시되거나 판정보류됩니다.';
    $('reportSectorInsight').innerHTML=summary;
  }
  function renderIndustryChange(ind,prev){
    $('reportIndustryRange').textContent=`${prev?.month||'—'} → ${ind?.month||'—'} 산업활동 변화`;
    const rev=ind?.previousRevisions?.metrics||{};
    const metricRows=[['전산업 생산','headlineMom'],['제조업 생산','secondaryMom'],['제조업 수출출하','exportShipmentMom']];
    const rows=metricRows.map(([name,key])=>({name,prior:finite(rev[key])?rev[key]:prev?.metrics?.[key],cur:ind?.metrics?.[key],revised:finite(rev[key])}));
    const picked=[['자동차','제조업 생산'],['기계장비','제조업 생산'],['반도체','제조업 생산'],['반도체','수출출하'],['서비스업','서비스업 생산'],['소매판매','판매액 지수'],['설비투자','설비투자 지수'],['건설기성','건설기성']];
    for(const [name,indicator] of picked){const s=(ind?.sectors||[]).find(x=>x.name===name&&x.indicator===indicator),p=(prev?.sectors||[]).find(x=>x.name===name&&x.indicator===indicator);if(!s&&!p)continue;
      const v=industryPreviousRate(ind,prev,{name,indicator});
      rows.push({name:name+' · '+indicator,prior:v.value,cur:s?.mom,revised:v.source==='수정치'});
    }
    $('reportIndustryChangeBody').innerHTML=rows.map(r=>{
      const change=finite(r.prior)&&finite(r.cur)?r.cur-r.prior:null;
      const category=!finite(change)?'missing':change>0?'same':change<0?'opposite':'missing';
      return `<tr><td><b>${esc(r.name)}</b></td><td class="num">${rateLabel(r.prior)}${r.revised?'<small class="trade-aux">수정치</small>':''}</td><td class="num">${rateLabel(r.cur)}</td><td class="num ${finite(change)?change>=0?'up':'down':''}">${finite(change)?signedAmount(change,'%p'):'—'}</td><td>${compareBadge(!finite(change)?'비교 데이터 부족':change>0?'증감률 개선':change<0?'증감률 악화':'보합',category)}</td></tr>`;
    }).join('');
  }
  function renderPrices(trade,old){
    const commodities=trade?.tradeComponents||[],previous=old?.tradeComponents||[];
    $('reportPriceQty').innerHTML=commodities.map(a=>{
      const b=previous.find(x=>x.name===a.name);
      const q=deltaPct(b?.quantity,a.quantity),p=deltaPct(b?.unitPrice,a.unitPrice);
      const qText=finite(a.quantity)?`<div><span>수출 수량</span><b>${decimal(b?.quantity,0)} → ${decimal(a.quantity,0)} ${esc(a.unit||'')} / ${rateLabel(q)}</b></div>`:'';
      return `<div class="report-price-card"><h3>${esc(a.name)}</h3><dl>${qText}<div><span>${esc(a.priceUnit==='USD'?'고정가격':'수출단가')}</span><b>${decimal(b?.unitPrice,2)} → ${decimal(a.unitPrice,2)} ${esc(a.priceUnit||'')} / ${rateLabel(p)}</b></div><div><span>당월 수량 전년비</span><b>${rateLabel(a.quantityYoy)}</b></div><div><span>당월 가격 전년비</span><b>${rateLabel(a.priceYoy)}</b></div></dl><p>${qText?'수량과 단가의 전월 변화 별도 계산':'보고서에 수출 수량 정보가 없어 가격만 비교'}. p.${Number(a.page)||'—'} · 공식 자료의 반올림 수치에 따른 근사 변화율입니다.</p></div>`;
    }).join('')||'<div class="report-sector-empty">수출 수량·단가 자료가 등록되지 않았습니다.</div>';
  }
  function cpiSectorDisplay(doc){
    $('reportCpiSectors').innerHTML=doc?.sectors?.length?doc.sectors.map(s=>`<div class="report-sector-row"><div class="report-sector-name">${esc(s.name)}<small>${esc(s.indicator)}</small></div>${displayRow('전월비',s.mom)}${displayRow('전년동월비',s.yoy)}</div>`).join(''):'<div class="report-sector-empty">해당 월 소비자물가 세부 품목을 추가할 수 있습니다.</div>';
  }
  function displayRow(label,val){const d=!finite(val)?'':val>0?'positive':val<0?'negative':'';return `<div class="report-sector-num ${d}"><span>${label}</span>${rateLabel(val)}</div>`;}
  function renderCpiSeparated(){
    chosenCpiMonth=refreshChoice('reportCpiMonthSelect',cpiMonths(),chosenCpiMonth);
    const r=reportChosen('CPI',chosenCpiMonth);
    const cards=r?[buildKpi('CPI 전월대비',rateLabel(r.metrics.headlineMom),r.month+' · 단기 물가 변화'),buildKpi('CPI 전년동월대비',rateLabel(r.metrics.headlineYoy),r.month+' · 물가상승률'),buildKpi('근원물가 전월대비',rateLabel(r.metrics.secondaryMom),'식료품·에너지 제외'),buildKpi('근원물가 전년동월대비',rateLabel(r.metrics.secondaryYoy),'식료품·에너지 제외')]:[];
    $('reportCpiCards').innerHTML=cards.join('')||'<div class="report-sector-empty">소비자물가 PDF를 등록해주세요.</div>';
    $('reportCpiAnalysis').innerHTML=r?`<b>${esc(r.month)} 소비자물가동향</b> · 전월대비 ${rateLabel(r.metrics.headlineMom)}, 전년동월대비 ${rateLabel(r.metrics.headlineYoy)}. ${esc(r.notes||'')}`:'CPI는 산업·무역 시차 판정에서 제외합니다.';
    cpiSectorDisplay(r);
  }
  function renderArchive(){
    const docs=allReports().slice().sort((a,b)=>b.month.localeCompare(a.month)||text(b.importedAt).localeCompare(text(a.importedAt)));
    const countBy=new Map(),seen=new Map();for(const r of docs){const key=r.kind+'|'+r.month;countBy.set(key,(countBy.get(key)||0)+1);}
    $('reportArchiveBody').innerHTML=docs.map(r=>{const key=r.kind+'|'+r.month;seen.set(key,(seen.get(key)||0)+1);const v=countBy.get(key)-seen.get(key)+1;
      const headline=r.kind==='TRADE'?`${decimal(r.metrics.exportAmount)}억불 수출 / ${decimal(r.metrics.importAmount)}억불 수입`:rateLabel(r.metrics.headlineMom)+' 전월비';
      return `<tr><td><b>${esc(r.month)}</b></td><td>${esc(ROOT_KIND[r.kind])}</td><td>${esc(headline)}</td><td><small>${esc(r.filename)}</small></td><td>${esc(r.releaseDate||'—')}</td><td><span class="report-badge ${r.verification==='verified'?'seed':''}">${esc(badge(r.verification))} · v${v}</span></td><td><button type="button" class="report-row-btn" data-report-view="${esc(r.id)}">보기</button></td></tr>`;
    }).join('')||'<tr><td colspan="7">보관된 보고서가 없습니다.</td></tr>';
    $('reportCountPill').textContent=`${docs.length}건 / ${new Set(docs.map(r=>r.month)).size}개월`;
  }
  function renderReports(){
    chosenTradeMonth=refreshChoice('reportTradeMonthSelect',tradeMonths(),chosenTradeMonth);
    const trade=reportChosen('TRADE',chosenTradeMonth),old=reportChosen('TRADE',previousMonth(chosenTradeMonth));
    const industry=reportChosen('INDUSTRY',previousMonth(chosenTradeMonth));
    const industryBefore=reportChosen('INDUSTRY',previousMonth(previousMonth(chosenTradeMonth)));
    renderKpis(trade,old,industry,industryBefore);renderTradeDelta(trade,old);renderImports(trade,old);
    renderSectorPair(trade,old,industry);renderIndustryChange(industry,industryBefore);renderPrices(trade,old);
    renderCpiSeparated();renderArchive();
  }
  // Extract explicitly-labeled export item tables; keep all values reviewable before saving.
  function extractTradeItemTable(pages){
    const full=cleanText(pages.slice(4,10).join(' '));
    const groups=[
      ['반도체','디스플레이','무선통신기기','컴퓨터','자동차','자동차부품','선박'],
      ['석유제품','석유화학','이차전지','일반기계','전기기기','철강','비철금속'],
      ['농수산식품','화장품','생활용품','섬유','가전','바이오헬스']
    ];
    const result=[];
    for(const group of groups){
      const escaped=group.join('\\s+');
      const regex=new RegExp('구\\s*분\\s+'+escaped+'(?:\\s+전체)?\\s+수출액\\s+([0-9.,\\s]+?)\\s+증감률\\s+([+△−\\-0-9.\\s]+?)\\s+역대순위');
      const match=full.match(regex);if(!match)continue;
      const a=match[1].trim().split(/\s+/).map(numberFrom),b=match[2].trim().split(/\s+/).map(x=>numberFrom(x.replace(/[△−]/g,'-')));
      const expected=group.length===6?7:group.length;
      if(a.length!==expected||b.length!==expected)continue;
      for(let i=0;i<group.length;i++){
        if(finite(a[i])&&finite(b[i]))result.push({name:group[i],indicator:'통관기준 수출액',amount:a[i],mom:null,yoy:b[i],page:6});
      }
    }
    return result;
  }
  function extractTradeComponents(pages){
    const str=cleanText(pages.slice(6,10).join(' ')),components=[];
    for(const name of ['석유제품','석유화학']){
      const re=new RegExp(name+' 수출액\\s*([\\d,.]+)억불\\s*\\(([+△−\\-]?[\\d.]+)%\\)\\s*\\/\\s*물량\\s*([\\d,.]+)만톤\\s*\\(([+△−\\-]?[\\d.]+)%\\)\\s*\\/\\s*단가\\s*([\\d,]+)\\$\\/톤\\s*\\(([+△−\\-]?[\\d.]+)%\\)');
      const m=str.match(re);if(!m)continue;
      const norm=x=>numberFrom(x.replace(/[△−]/g,'-'));
      components.push({name,quantity:numberFrom(m[3]),unit:'만 톤',unitPrice:numberFrom(m[5]),priceUnit:'USD/톤',quantityYoy:norm(m[4]),priceYoy:norm(m[6]),page:8});
    }
    return components;
  }
  function extractTradeImports(pages){
    const str=cleanText(pages.slice(0,5).join(' '));const rows=[];
    for(const [name,regex] of [
      ['에너지',/에너지 수입은\s*\(([\d,.]+)억 달러\)\s*([\d.]+)% 증가/],
      ['비에너지',/에너지 외 수입\s*\(([\d,.]+)억 달러\)은\s*([\d.]+)% 증가/],
      ['반도체장비',/반도체장비\s*\(([\d,.]+)억 달러,\s*\+([\d.]+)%\)/]
    ]){const m=str.match(regex);if(m)rows.push({name,amount:numberFrom(m[1]),yoy:numberFrom(m[2]),page:3});}
    return rows;
  }
  function extractIndustrySectorSignals(pages){
    const str=cleanText(pages.slice(5,7).join(' '));
    const start=str.search(/□\s*\(?광공업생산\)?/);if(start<0)return [];
    const boundary=str.indexOf('○전년동월대비',start);
    const short=str.slice(start,boundary>start?boundary:start+330);const result=[];
    for(const name of ['반도체','자동차','기계장비','전자부품','고무·플라스틱','1차금속','석유정제']){
      const m=short.match(new RegExp(name+'\\*{0,2}\\s*\\(([+−\\-]?[0-9.]+)%\\)')); 
      if(m)result.push({name,indicator:'제조업 생산',mom:numberFrom(m[1].replace(/−/g,'-')),yoy:null,page:3});
    }
    return result;
  }
  // PDF parsing is conservative. A human must inspect the extracted values and fill missing sectors.
  function parseRelease({name,pages}){
    const cover=cleanText((pages.slice(0,6)).join(' '));const summary=cleanText((pages.slice(0,23)).join(' '));
    const source=name+' '+cover.slice(0,1200);
    const kind=/수출입\s*동향/.test(source)?'TRADE':/산업활동\s*동향/.test(source)?'INDUSTRY':/소비자물가\s*동향/.test(source)?'CPI':null;
    const match=source.match(/(20\d{2})\s*년[_\s-]*(\d{1,2})\s*월[_\s-]*(?:수출입\s*동향|산업활동\s*동향|소비자물가\s*동향)/);
    const month=match?match[1]+'-'+String(Number(match[2])).padStart(2,'0'):'';
    const metrics={headlineMom:null,headlineYoy:null,secondaryMom:null,secondaryYoy:null,exportAmount:null,importAmount:null,tradeBalance:null,exportShipmentMom:null,exportShipmentYoy:null,exportQuantityMom:null,exportQuantityYoy:null,exportPriceMom:null,exportPriceYoy:null};
    let sectors=[],imports=[],tradeComponents=[];
    if(kind==='TRADE'){
      const a=summary.match(/수출\s*([\d,]+(?:\.\d+)?)\s*억\s*달러\s*\(\s*\+?([\d.]+)%\s*\)/);
      const b=summary.match(/수입\s*([\d,]+(?:\.\d+)?)\s*억\s*달러\s*\(\s*\+?([\d.]+)%\s*\)/);
      if(a){metrics.exportAmount=numberFrom(a[1]);metrics.headlineYoy=numberFrom(a[2]);}
      if(b){metrics.importAmount=numberFrom(b[1]);metrics.secondaryYoy=numberFrom(b[2]);}
      const c=summary.match(/(?:수지|무역수지)\s*([\d,]+(?:\.\d+)?)\s*억\s*달러\s*흑자/);
      if(c)metrics.tradeBalance=numberFrom(c[1]);
      sectors=extractTradeItemTable(pages);imports=extractTradeImports(pages);tradeComponents=extractTradeComponents(pages);
      // When a table cannot be extracted, use narrowly matched narrative values.
      for(const sector of ['반도체','컴퓨터','자동차','선박','석유제품','석유화학','바이오헬스','화장품']){
        const re=new RegExp(sector+'\\s*수출\\s*\\(\\s*([\\d,.]+)\\s*억\\s*달러\\s*,?\\s*([+△-]?\\d+(?:\\.\\d+)?)%');
        const m=re.exec(summary);if(m){const a=numberFrom(m[1]);const yoy=numberFrom(m[2].replace('△','-'));if(finite(a)&&!sectors.some(x=>x.name===sector))sectors.push({name:sector,indicator:'통관기준 수출액',mom:null,yoy,amount:a,page:null});}
      }
    }else if(kind==='CPI'){
      const m=summary.match(/소비자물가지수는\s*전월대비\s*([\d.]+)%\s*,?\s*전년동월대비\s*([\d.]+)%/);
      if(m){metrics.headlineMom=numberFrom(m[1]);metrics.headlineYoy=numberFrom(m[2]);}
      const core=summary.match(/식료품\s*및\s*에너지\s*제외지수는\s*전월대비\s*([\d.]+)%\s*,?\s*전년동월대비\s*([\d.]+)%/);
      if(core){metrics.secondaryMom=numberFrom(core[1]);metrics.secondaryYoy=numberFrom(core[2]);}
    }else if(kind==='INDUSTRY'){
      sectors=extractIndustrySectorSignals(pages);
      const m=summary.match(/전산업\s*생산은[\s\S]{0,360}?전월대비\s*([\d.]+)%\s*(감소|증가|보합)/);
      if(m)metrics.headlineMom=m[2]==='보합'?0:Number(m[1])*(m[2]==='감소'?-1:1);
      if(/전산업생산[^]{0,400}전월대비\s*보합/.test(summary))metrics.headlineMom=0;
      const manu=summary.match(/제조업\s*생산은[\s\S]{0,300}?전월대비\s*([\d.]+)%\s*(감소|증가)/);
      if(manu)metrics.secondaryMom=Number(manu[1])*(manu[2]==='감소'?-1:1);
    }
    return {kind,month,metrics,sectors,imports,tradeComponents,evidence:summary.slice(0,1400),status:kind==='TRADE'?(finite(metrics.exportAmount)?'무역 금액 일부 감지 · 품목별 표 확인 필요':'수출입 수치 수동 확인 필요'):(finite(metrics.headlineMom)||finite(metrics.headlineYoy)?'기본 수치 일부 감지 · 확인 필요':'주요 수치 미검출 · 원문 확인 필요')};
  }
  let pdfLibraryLoading=null;
  async function loadPdfLibrary(){
    if(window.pdfjsLib?.getDocument)return;
    if(!pdfLibraryLoading)pdfLibraryLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload=()=>window.pdfjsLib?.getDocument?resolve():reject(new Error('PDF 모듈 초기화 실패'));
      script.onerror=()=>reject(new Error('PDF 분석 모듈을 가져올 수 없습니다. 네트워크 환경을 확인하세요.'));
      document.head.appendChild(script);
    }).catch(e=>{pdfLibraryLoading=null;throw e;});
    await pdfLibraryLoading;
  }
  async function readPdf(file){
    await loadPdfLibrary();
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const bytes=await file.arrayBuffer();const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;
    const pages=[],count=Math.min(pdf.numPages,23);
    for(let i=1;i<=count;i++){
      $('reportImportStatus').textContent=`PDF의 내용을 분석 중: ${i}/${count}쪽`;
      const p=await pdf.getPage(i),a=await p.getTextContent();pages.push(a.items.map(x=>x.str).join(' '));
    }
    return parseRelease({name:file.name,pages});
  }
  const sectorLine=(sectors,kind)=>sectors.map(s=>kind==='TRADE'?[s.name,s.indicator,finite(s.amount)?s.amount:'',finite(s.yoy)?s.yoy:''].join(' | '):[s.name,s.indicator,finite(s.mom)?s.mom:'',finite(s.yoy)?s.yoy:''].join(' | ')).join('\n');
  function setField(id,n){$(id).value=finite(n)?String(n):'';}
  function updateReviewKind(){const kind=$('reportReviewKind').value;
    for(const field of document.querySelectorAll('#reportReviewForm .report-trade-only'))field.hidden=kind!=='TRADE';
    $('reportIndustryFields').hidden=kind!=='INDUSTRY';for(const id of ['reportTradeBalanceField','reportTradeImportField','reportTradeQuantityField'])$(id).hidden=kind!=='TRADE';
    $('reviewMomLabel').textContent=kind==='TRADE'?'수출 전월비 (기타 월 PDF 있으면 자동 계산)':kind==='INDUSTRY'?'전산업생산 전월비':'CPI 전월비';
    $('reviewYoyLabel').textContent=kind==='TRADE'?'수출 전년동월비':kind==='INDUSTRY'?'전산업생산 전년동월비':'CPI 전년동월비';
    $('reviewSecondMomLabel').textContent=kind==='TRADE'?'수입 전월비 (선택)':kind==='INDUSTRY'?'제조업생산 전월비':'근원물가 전월비';
    $('reviewSecondYoyLabel').textContent=kind==='TRADE'?'수입 전년동월비':kind==='INDUSTRY'?'제조업생산 전년동월비':'근원물가 전년동월비';
    $('reportSectorHelp').innerHTML=kind==='TRADE'?'수출입 자료: <code>반도체 | 수출액 | 603.0 | 262.8</code> (금액 억 달러 | 전년동월비 %)':'산업/물가: <code>자동차 | 제조업 생산 | -24.8 | -29.4</code> (전월비 % | 전년동월비 %).';
  }
  function openReportReview(file,parsed){
    uploadPreview={file,parsed};$('reportReviewKind').value=parsed.kind||'TRADE';$('reportReviewMonth').value=parsed.month;
    setField('reportReviewMom',parsed.metrics.headlineMom);setField('reportReviewYoy',parsed.metrics.headlineYoy);
    setField('reportReviewSecondMom',parsed.metrics.secondaryMom);setField('reportReviewSecondYoy',parsed.metrics.secondaryYoy);
    setField('reportReviewExportAmount',parsed.metrics.exportAmount);setField('reportReviewImportAmount',parsed.metrics.importAmount);
    setField('reportReviewBalance',parsed.metrics.tradeBalance);
    $('reportReviewImportText').value=(parsed.imports||[]).map(x=>[x.name,finite(x.amount)?x.amount:'',finite(x.yoy)?x.yoy:''].join(' | ')).join('\n');
    $('reportReviewQtyText').value=(parsed.tradeComponents||[]).map(x=>[x.name,finite(x.quantity)?x.quantity:'',x.unit||'',finite(x.unitPrice)?x.unitPrice:'',x.priceUnit||'',finite(x.quantityYoy)?x.quantityYoy:'',finite(x.priceYoy)?x.priceYoy:''].join(' | ')).join('\n');setField('reportReviewBalance',parsed.metrics.tradeBalance);
    $('reportReviewImportText').value=(parsed.imports||[]).map(r=>[r.name,finite(r.amount)?r.amount:'',finite(r.yoy)?r.yoy:''].join(' | ')).join('\n');
    $('reportReviewQtyText').value=(parsed.tradeComponents||[]).map(r=>[r.name,finite(r.quantity)?r.quantity:'',r.unit||'',finite(r.unitPrice)?r.unitPrice:'',r.priceUnit||'',finite(r.quantityYoy)?r.quantityYoy:'',finite(r.priceYoy)?r.priceYoy:''].join(' | ')).join('\n');
    setField('reportReviewShipmentMom',parsed.metrics.exportShipmentMom);setField('reportReviewShipmentYoy',parsed.metrics.exportShipmentYoy);
    $('reportReviewSectorText').value=sectorLine(parsed.sectors,parsed.kind);$('reportReviewNotes').value='';updateReviewKind();
    $('reportReviewEvidence').textContent=`${parsed.status} / ${file.name} / 분석 결과는 반드시 원본 PDF의 기준월·부호·단위를 대조해야 합니다. 이미지 전용 PDF는 자동 인식할 수 없습니다.`;
    $('reportReviewModal').classList.add('open');$('reportReviewModal').setAttribute('aria-hidden','false');
  }
  function closePopup(id){$(id).classList.remove('open');$(id).setAttribute('aria-hidden','true');}
  async function importFile(file){
    if(!file)return;if(!/\.pdf$/i.test(file.name)||file.size>25*1024*1024){note('25MB 이하 PDF만 지원합니다.');return;}
    $('reportImportStatus').textContent='PDF 추출 중 · 파일은 외부 서버에 전송하지 않습니다.';
    try{const parsed=await readPdf(file);openReportReview(file,parsed);$('reportImportStatus').textContent='추출 완료: 원문과 비교해 수치·부호를 검토한 후 저장하세요.';}
    catch(err){$('reportImportStatus').textContent='파일 분석 실패: '+text(err.message||err);note('PDF 분석에 실패했습니다.');}
  }
  function parseSectorRows(raw,kind){
    const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(lines.length>100)throw new Error('섹터는 최대 100개까지 입력할 수 있습니다.');
    return lines.map((line,i)=>{const v=line.split('|').map(x=>x.trim());if(v.length<2||v[0].length>80||v[1].length>80)throw new Error(`${i+1}번째 섹터 입력 형식 오류`);
      for(const x of [v[2]||'',v[3]||''])if(x!==''&&!finite(numberFrom(x)))throw new Error(`${i+1}번째 숫자를 확인하세요`);
      return kind==='TRADE'?{name:v[0],indicator:v[1],amount:numberFrom(v[2]),mom:null,yoy:numberFrom(v[3]),page:null}:{name:v[0],indicator:v[1],mom:numberFrom(v[2]),yoy:numberFrom(v[3]),page:null};
    });
  }
  function openManualReportReview(){
    const kind='TRADE',month=chosenTradeMonth||KST().slice(0,7);
    const metrics={headlineMom:null,headlineYoy:null,secondaryMom:null,secondaryYoy:null,exportAmount:null,importAmount:null,tradeBalance:null,exportShipmentMom:null,exportShipmentYoy:null};
    openReportReview({name:'직접 입력 · 공식 자료 대조',size:0},{kind,month,metrics,sectors:[],imports:[],tradeComponents:[],status:'직접 입력 모드 · 원본 보고서 수치를 입력하세요.'});
    uploadPreview.manual=true;
  }
  function parseImportsInput(raw){
    const rows=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(rows.length>60)throw new Error('수입 항목은 최대 60개까지 입력할 수 있습니다.');
    return rows.map((line,i)=>{
      const a=line.split('|').map(x=>x.trim());if(a.length!==3||!a[0]||a[0].length>80)throw new Error('수입 '+(i+1)+'행: 품목 | 억 달러 | 전년비 형식을 확인하세요.');
      const amount=numberFrom(a[1]),yoy=numberFrom(a[2]);if(!finite(amount)||amount<0||(a[2]&&!finite(yoy)))throw new Error('수입 '+(i+1)+'행: 금액과 전년비를 확인하세요.');
      return {name:a[0],amount,yoy,page:null};
    });
  }
  function parseQuantityInput(raw){
    const rows=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(rows.length>60)throw new Error('수량·단가 항목은 최대 60개까지 입력할 수 있습니다.');
    return rows.map((line,i)=>{
      const a=line.split('|').map(x=>x.trim());if(a.length!==7||!a[0]||a[0].length>80)throw new Error('수량·단가 '+(i+1)+'행: 7개 항목을 확인하세요.');
      const quantity=numberFrom(a[1]),unitPrice=numberFrom(a[3]),quantityYoy=numberFrom(a[5]),priceYoy=numberFrom(a[6]);
      if((a[1]&&(!finite(quantity)||quantity<0))||(a[3]&&(!finite(unitPrice)||unitPrice<0))||(a[5]&&!finite(quantityYoy))||(a[6]&&!finite(priceYoy)))throw new Error('수량·단가 '+(i+1)+'행: 숫자·부호를 확인하세요.');
      return {name:a[0],quantity,unit:a[2].slice(0,35),unitPrice,priceUnit:a[4].slice(0,35),quantityYoy,priceYoy,page:null};
    });
  }
  function saveReportReview(ev){
    ev.preventDefault();if(!uploadPreview)return;
    const kind=$('reportReviewKind').value,month=$('reportReviewMonth').value;
    if(!ROOT_KIND[kind]||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)){note('보고서 종류와 기준월을 확인하세요.');return;}
    const metrics={headlineMom:numberFrom($('reportReviewMom').value),headlineYoy:numberFrom($('reportReviewYoy').value),secondaryMom:numberFrom($('reportReviewSecondMom').value),secondaryYoy:numberFrom($('reportReviewSecondYoy').value),
      exportAmount:kind==='TRADE'?numberFrom($('reportReviewExportAmount').value):null,importAmount:kind==='TRADE'?numberFrom($('reportReviewImportAmount').value):null,tradeBalance:kind==='TRADE'?numberFrom($('reportReviewBalance').value):null,
      exportShipmentMom:kind==='INDUSTRY'?numberFrom($('reportReviewShipmentMom').value):null,exportShipmentYoy:kind==='INDUSTRY'?numberFrom($('reportReviewShipmentYoy').value):null,
      exportQuantityMom:null,exportQuantityYoy:null,exportPriceMom:null,exportPriceYoy:null};
    if(kind==='TRADE'&&(!finite(metrics.exportAmount)||!finite(metrics.importAmount))){note('총수출액과 총수입액을 확인해 입력하세요.');return;}
    if(kind!=='TRADE'&&!finite(metrics.headlineMom)&&!finite(metrics.headlineYoy)){note('전월비 또는 전년동월비가 필요합니다.');return;}
    if(kind==='TRADE'){const prevMonthTrade=recordLatest('TRADE',previousMonth(month));
      if(prevMonthTrade){metrics.headlineMom=deltaPct(prevMonthTrade.metrics.exportAmount,metrics.exportAmount);metrics.secondaryMom=deltaPct(prevMonthTrade.metrics.importAmount,metrics.importAmount);}}
    let sectors,imports=[],tradeComponents=[];try{
      sectors=parseSectorRows($('reportReviewSectorText').value,kind);
      if(kind==='TRADE'){
        const lines=$('reportReviewImportText').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length>50)throw new Error('수입 항목은 50개 이하로 입력하세요.');
        imports=lines.map((line,i)=>{const a=line.split('|').map(v=>v.trim());if(a.length<3||!a[0]||!finite(numberFrom(a[1])))throw new Error(`수입 항목 ${i+1}번째 형식 오류`);return {name:a[0].slice(0,80),amount:numberFrom(a[1]),yoy:numberFrom(a[2])};});
        const qtyLines=$('reportReviewQtyText').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(qtyLines.length>30)throw new Error('수량/단가 항목은 30개 이하로 입력하세요.');
        tradeComponents=qtyLines.map((line,i)=>{const a=line.split('|').map(v=>v.trim());if(a.length<5||!a[0]||!finite(numberFrom(a[3])))throw new Error(`수량/단가 ${i+1}번째 형식 오류`);return {name:a[0].slice(0,80),quantity:numberFrom(a[1]),unit:a[2].slice(0,30),unitPrice:numberFrom(a[3]),priceUnit:a[4].slice(0,30),quantityYoy:numberFrom(a[5]),priceYoy:numberFrom(a[6])};});
      }
    }catch(err){note(err.message);return;}
    const extracted=uploadPreview.parsed;
    const doc={id:'user-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),kind,month,releaseDate:null,filename:uploadPreview.file.name,
      importedAt:new Date().toISOString(),origin:uploadPreview.manual?'manual-entry':'local-pdf',verification:'reviewed',source:uploadPreview.file.name,sourceUrl:'',metrics,sectors,notes:$('reportReviewNotes').value.slice(0,8000),
      ...(kind==='TRADE'?{imports,tradeComponents,previousMonthApprox:extracted.previousMonthApprox||{}}:{})};
    if(!validReport(doc)){note('수치가 유효하지 않습니다.');return;}
    userState.reports.push(doc);if(!persist()){userState.reports.pop();return;}
    chosenIds[kind]=null;if(kind==='TRADE')chosenTradeMonth=month;if(kind==='INDUSTRY')chosenTradeMonth=nextMonth(month);if(kind==='CPI')chosenCpiMonth=month;
    closePopup('reportReviewModal');uploadPreview=null;renderAll();note(`${month} ${ROOT_KIND[kind]} 저장 완료 (이전 기록은 유지됨).`);
  }

  function exportReportBackup(){
    const data={app:'folio-economic-reports',version:1,exportedAt:new Date().toISOString(),data:exportData()};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='folio_economic_reports_'+KST()+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);note('경제보고서 기록을 백업했습니다. 포트폴리오 전체 JSON 백업에도 포함됩니다.');
  }
  function saveForecast(e){
    e.preventDefault();const country=$('forecastCountry').value,date=$('forecastDate').value;
    const lower=numberFrom($('forecastLow').value),upper=country==='KR'?lower:numberFrom($('forecastHigh').value);
    if(!date||!finite(lower)||!finite(upper)||lower<0||upper<lower||upper>30){note('예상금리 범위를 확인해 주세요.');return;}
    const row={country,date,lower,upper,source:$('forecastSource').value.trim().slice(0,180)};
    if(!row.source){note('예상치 출처를 입력해 주세요.');return;}
    userState.forecasts=userState.forecasts.filter(x=>!(x.country===country&&x.date===date));userState.forecasts.push(row);
    persist();closePopup('econForecastModal');renderRateTable();$('econRateHistoryPanel').hidden=false;note('시장 예상치를 사용자 기록으로 저장했습니다.');
  }
  function renderAll(){renderDashboard();renderReports();}
  function init(){
    $('econCalRegion').addEventListener('change',renderCalendar);$('econCalKind').addEventListener('change',renderCalendar);
    $('econShowPast').addEventListener('click',()=>{showPast=!showPast;renderCalendar();});
    $('econOpenRateTable').addEventListener('click',()=>{$('econRateHistoryPanel').hidden=!$('econRateHistoryPanel').hidden;});
    $('econForecastOpen').addEventListener('click',()=>{$('econForecastModal').classList.add('open');$('econForecastModal').setAttribute('aria-hidden','false');});
    $('forecastClose').addEventListener('click',()=>closePopup('econForecastModal'));$('forecastCancel').addEventListener('click',()=>closePopup('econForecastModal'));$('forecastForm').addEventListener('submit',saveForecast);
    $('econGoReports').addEventListener('click',()=>{location.hash='reports';});
    $('reportTradeMonthSelect').addEventListener('change',e=>{chosenTradeMonth=e.target.value;chosenIds.TRADE=null;chosenIds.INDUSTRY=null;renderReports();});
    $('reportSectorBasis').addEventListener('change',renderReports);
    $('reportCpiMonthSelect').addEventListener('change',e=>{chosenCpiMonth=e.target.value;chosenIds.CPI=null;renderCpiSeparated();});
    $('reportArchiveBody').addEventListener('click',e=>{const b=e.target.closest('[data-report-view]');if(!b)return;const r=allReports().find(x=>x.id===b.dataset.reportView);if(!r)return;
      chosenIds[r.kind]=r.id;if(r.kind==='TRADE')chosenTradeMonth=r.month;else if(r.kind==='INDUSTRY')chosenTradeMonth=nextMonth(r.month);else chosenCpiMonth=r.month;
      renderReports();$('reportTradeMonthSelect').scrollIntoView({block:'nearest',behavior:'smooth'});
    });
    $('reportExportJson').addEventListener('click',exportReportBackup);
    const input=$('reportFileInput');input.addEventListener('change',()=>{const f=input.files?.[0];input.value='';importFile(f);});
    const drop=$('reportDrop');drop.addEventListener('dragenter',e=>{e.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragover',e=>e.preventDefault());drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
    drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');importFile(e.dataTransfer?.files?.[0]);});
    $('reportReviewKind').addEventListener('change',updateReviewKind);$('reportManualEntry').addEventListener('click',openManualReportReview);
    $('reportReviewForm').addEventListener('submit',saveReportReview);
    $('reportReviewClose').addEventListener('click',()=>closePopup('reportReviewModal'));$('reportCancel').addEventListener('click',()=>closePopup('reportReviewModal'));
    for(const id of ['reportReviewModal','econForecastModal'])$(id).addEventListener('click',e=>{if(e.target===$(id))closePopup(id);});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePopup('reportReviewModal');closePopup('econForecastModal');}});
    window.FOLIO_MACRO_UI={exportData,importData,validateData:validData,renderReports,parseRelease,allReports,previousMonth,deltaPct,selectIndustrySignal,reportChosen};
    renderAll();
  }
  init();
})();
