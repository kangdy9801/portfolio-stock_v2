/* FOLIO v3: CNN seven indicators/history, 3-peer valuation, dividend cash flows */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const market=window.FOLIO_MARKET||{};
const catalog=Array.isArray(window.FOLIO_CATALOG)?window.FOLIO_CATALOG:[];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const intFmt=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
const fmt=n=>finite(n)?intFmt.format(Math.round(n))+'원':'—';
const fmtDecimal=n=>finite(n)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2}).format(n):'—';
const yearKST=()=>Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date()));
const todayKST=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const colorFor=n=>n<25?'#f4757c':n<45?'#f4a15c':n<56?'#e6be69':n<75?'#95c970':'#4fc99a';
const bucket=n=>n<25?'극도의 공포':n<45?'공포':n<=55?'중립':n<75?'탐욕':'극도의 탐욕';
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const quote=s=>(market.stocks||{})[s]||{};
const hold=()=>window.FOLIO_APP?.getHoldings?.()||[];
const getCompany=s=>hold().find(h=>h.symbol===s)||catalog.find(c=>c.symbol===s);
const usdFx=()=>finite(market.fx?.rate)&&market.fx.rate>0?market.fx.rate:null;
function note(message){const el=$('toast');if(!el)return;el.textContent=message;el.classList.add('visible');clearTimeout(note.timer);note.timer=setTimeout(()=>el.classList.remove('visible'),3500);}
function closeModal(id){$(id)?.classList.remove('open');$(id)?.setAttribute('aria-hidden','true');}
function openModal(id){$(id)?.classList.add('open');$(id)?.setAttribute('aria-hidden','false');}
function timeDate(s){return s?String(s).slice(0,10):'—';}

// ── Market sentiment: all values from CNN, never a Korean-index proxy ──
const fearParts=[
 ['market_momentum_sp500','시장 모멘텀'],['stock_price_strength','주가 강도'],
 ['stock_price_breadth','거래량·시장 폭'],['put_call_options','풋/콜 옵션'],
 ['junk_bond_demand','정크본드 수요'],['market_volatility_vix','시장 변동성'],
 ['safe_haven_demand','안전자산 선호']
];
let fearDays=90;
function fearHistoryRender(){
 const root=$('fearHistoryChart');if(!root)return;
 const fear=market.fear_greed||{};
 const history=Array.isArray(fear.history)?fear.history.filter(x=>finite(x.score)&&/^20\d\d-\d\d-\d\d$/.test(x.date)):[];
 if(!history.length){root.innerHTML='<div style="color:#91a5b6;font-size:12px;text-align:center;padding:70px 10px">CNN 과거 지수 데이터가 아직 없습니다.<br>GitHub Actions 최초 수집 후 표시됩니다.</div>';return;}
 const last=history.at(-1).date;
 const cutoff=new Date(new Date(last+'T12:00:00Z').getTime()-(fearDays-1)*86400000).toISOString().slice(0,10);
 const series=history.filter(p=>p.date>=cutoff).sort((a,b)=>a.date.localeCompare(b.date));
 if(series.length<2){root.innerHTML='<div class="empty-helper">이 구간의 지수 데이터가 부족합니다.</div>';return;}
 const sp=(market.indices||{})['S&P 500']?.history||[];
 const indexMap=new Map(sp.filter(x=>finite(x.close)).map(x=>[x.date,x.close]));
 const aligned=series.map(x=>({...x,sp:indexMap.get(x.date)||null}));
 const prices=aligned.map(x=>x.sp).filter(finite);const low=prices.length?Math.min(...prices):0;const high=prices.length?Math.max(...prices):1;const range=high-low||1;
 const W=960,H=325,L=38,R=65,T=24,B=36;const cw=W-L-R,ch=H-T-B;
 const x=i=>L+i/(aligned.length-1)*cw;const y=n=>T+(100-n)/100*ch;const yp=n=>T+(high-n)/range*ch;
 const fearPts=aligned.map((v,i)=>`${x(i).toFixed(1)},${y(v.score).toFixed(1)}`).join(' ');
 const priceRuns=[];let run=[];
 for(let i=0;i<aligned.length;i++){
   if(finite(aligned[i].sp))run.push(`${x(i).toFixed(1)},${yp(aligned[i].sp).toFixed(1)}`);
   else if(run.length){if(run.length>1)priceRuns.push(run);run=[];}
 }
 if(run.length>1)priceRuns.push(run);
 const horizontal=[0,25,50,75,100].map(n=>`<line x1="${L}" y1="${y(n)}" x2="${W-R}" y2="${y(n)}" stroke="#485461" stroke-dasharray="2 6" opacity=".55"/><text x="${L-11}" y="${y(n)+4}" fill="#8093a4" text-anchor="end" font-size="12">${n}</text>`).join('');
 const labels=[0,Math.floor((aligned.length-1)/3),Math.floor((aligned.length-1)*2/3),aligned.length-1].map(i=>`<text x="${x(i)}" y="${H-5}" fill="#8396aa" text-anchor="middle" font-size="11">${aligned[i].date.slice(5)}</text>`).join('');
 let right='';if(prices.length>1)right=[0,.5,1].map(v=>`<text x="${W-R+7}" y="${T+(1-v)*ch+3}" fill="#8799ad" font-size="11">${intFmt.format(low+range*v)}</text>`).join('');
 root.innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="CNN 공포·탐욕 지수 0부터 100까지, S&P 500 종가 히스토리"><rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>${horizontal}${labels}${right}<line x1="${L}" y1="${y(25)}" x2="${W-R}" y2="${y(25)}" stroke="#e68b8f" stroke-dasharray="5 5" opacity=".4"/><line x1="${L}" y1="${y(75)}" x2="${W-R}" y2="${y(75)}" stroke="#5fcea5" stroke-dasharray="5 5" opacity=".4"/>${priceRuns.map(v=>`<polyline points="${v.join(' ')}" stroke="#a4aab9" opacity=".8" stroke-width="2.3" fill="none"/>`).join('')}<polyline points="${fearPts}" stroke="#f5a362" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" fill="none"/><circle cx="${x(aligned.length-1)}" cy="${y(aligned.at(-1).score)}" r="4.5" fill="#f5a362"/></svg>`;
}
function initFear(){
 const f=market.fear_greed||{};
 $('fearIndicators').innerHTML=fearParts.map(([key,name])=>{const n=f.indicators?.[key]?.score;const good=finite(n)&&n>=0&&n<=100;const v=good?clamp(n,0,100):0;return `<div class="fear-indicator-row"><span class="fear-indicator-label">${name}</span><div class="fear-indicator-track"><span class="fear-indicator-fill" style="width:${v}%;background:${good?colorFor(v):'transparent'}"></span></div><span class="fear-indicator-status" style="color:${good?colorFor(v):'#94a8b9'}"><strong>${good?fmtDecimal(v):'—'}</strong> ${good?bucket(v):'미수집'}</span></div>`;}).join('');
 let three=null;const history=Array.isArray(f.history)?f.history:[];
 if(history.length&&finite(f.score)){
  const date=f.timestamp?.slice(0,10)||history.at(-1)?.date;
  const target=new Date(new Date(date+'T00:00:00Z').getTime()-90*86400000).toISOString().slice(0,10);
  const before=history.filter(x=>x.date<=target&&finite(x.score));
  if(before.length)three=before.at(-1).score;
 }
 $('fearLastThreeMonths').textContent=finite(three)?three.toFixed(1):'—';
 $('fearLastThreeMonths').style.color=finite(three)?colorFor(three):'';
 ['fearYesterday','fearLastWeek','fearLastMonth'].forEach(id=>{const n=Number($(id).textContent);if(Number.isFinite(n)&&$(id).textContent!=='—')$(id).style.color=colorFor(n);});
 $('fearDetailsToggle').addEventListener('click',()=>{const node=$('fearDetailsBody');node.hidden=!node.hidden;$('fearDetailsToggle').setAttribute('aria-expanded',String(!node.hidden));$('fearDetailsToggle').querySelector('span').textContent=node.hidden?'⌄':'⌃';});
 $('fearHistoryPeriods').addEventListener('click',e=>{const b=e.target.closest('[data-days]');if(!b)return;fearDays=Number(b.dataset.days);$('fearHistoryPeriods').querySelectorAll('button').forEach(n=>n.classList.toggle('on',n===b));fearHistoryRender();});
 fearHistoryRender();
}

// ── Sector and company valuation additions ──
let trioKey='',trioSymbols=[],scatterScope='market';
function selectedSector(){return {region:$('sectorMarket')?.value||'KR',sector:$('sectorSelect')?.value||'반도체'};}
function sectorList(){const {region,sector}=selectedSector();return catalog.filter(c=>c.kind==='STOCK'&&c.market===region&&c.sector===sector);}
const fmtRatio=n=>finite(n)&&n>0?n.toFixed(2)+'배':'—';
const fmtPct=n=>finite(n)?(n*100).toFixed(1)+'%':'—';
function shortWon(n,c){if(!finite(n))return '—';const unit=c==='USD'?'$':'';const v=Math.abs(n);return (n<0?'−':'')+unit+(v>=1e12?(v/1e12).toFixed(2)+'조':v>=1e9?(v/1e9).toFixed(1)+'B':v>=1e8?(v/1e8).toFixed(1)+'억':v>=1e6?(v/1e6).toFixed(1)+'M':fmtDecimal(v));}
function sectorExtraRender(){
 const all=sectorList(),{region,sector}=selectedSector();const key=region+'|'+sector;
 if(key!==trioKey){trioKey=key;trioSymbols=all.slice(0,3).map(c=>c.symbol);}
 for(let i=0;i<3;i++){
  const sel=$('peerSelect'+i);if(!sel)continue;
  sel.innerHTML='<option value="">기업 선택</option>'+all.map(c=>`<option value="${esc(c.symbol)}">${esc(c.name)}</option>`).join('');sel.value=trioSymbols[i]||'';
 }
 $('peerTrioCards').innerHTML=trioSymbols.length?trioSymbols.map((sym,i)=>{
  const c=all.find(v=>v.symbol===sym);if(!c)return '';
  const info=quote(sym).fundamentals?.metrics||{};
  return `<button type="button" class="peer-trio-card" data-trio-detail="${esc(sym)}"><div class="trio-head"><div><strong>${esc(c.name)}</strong><small>${esc(c.display)}</small></div><span class="trio-badge">기업 ${'ABC'[i]}</span></div><div class="trio-metrics"><div><span>PER</span><strong>${fmtRatio(info.pe)}</strong></div><div><span>PBR</span><strong>${fmtRatio(info.pb)}</strong></div><div><span>ROE</span><strong>${fmtPct(info.roe)}</strong></div><div><span>순이익</span><strong>${shortWon(info.net_income,c.currency)}</strong></div></div></button>`;
 }).join(''):'<div class="trio-empty">비교할 기업이 없습니다. 다른 섹터를 선택해 주세요.</div>';
 scatterRender();
}
function scatterRender(){
 const {region,sector}=selectedSector();const names=catalog.filter(c=>c.kind==='STOCK'&&c.market===region&&(scatterScope==='market'||c.sector===sector));
 const pts=names.map(c=>({c,pb:quote(c.symbol)?.fundamentals?.metrics?.pb,pe:quote(c.symbol)?.fundamentals?.metrics?.pe})).filter(v=>finite(v.pb)&&v.pb>0&&finite(v.pe)&&v.pe>0);
 $('scatterInfo').textContent=`${region==='KR'?'한국':'미국'} · ${scatterScope==='market'?'선택 시장 전체':sector} · 재무지표가 있는 기업 ${pts.length}/${names.length}개 · 점을 누르면 상세 정보`;
 const chart=$('pePbScatter');
 if(!pts.length){chart.innerHTML='<div class="empty-helper">PER·PBR이 모두 유효한 기업이 아직 없습니다.<br>GitHub Actions에서 재무 데이터를 수집하면 산점도가 표시됩니다.</div>';return;}
 const rawMaxX=Math.max(...pts.map(v=>v.pb));const rawMaxY=Math.max(...pts.map(v=>v.pe));
 const xmax=Math.max(2,Math.ceil(rawMaxX*1.13)),ymax=Math.max(10,Math.ceil(rawMaxY*1.15));
 const W=950,H=470,L=72,R=28,T=20,B=70;const width=W-L-R,height=H-T-B;
 const X=v=>L+(v/xmax)*width,Y=v=>T+(1-v/ymax)*height;
 const xTicks=Array.from({length:6},(_,i)=>xmax/5*i),yTicks=Array.from({length:5},(_,i)=>ymax/4*i);
 const grid=xTicks.map(v=>`<line x1="${X(v)}" y1="${T}" x2="${X(v)}" y2="${H-B}" stroke="#e7edf2"/><text x="${X(v)}" y="${H-B+24}" text-anchor="middle" fill="#7b8a9a" font-size="12">${fmtDecimal(v)}</text>`).join('')+yTicks.map(v=>`<line x1="${L}" y1="${Y(v)}" x2="${W-R}" y2="${Y(v)}" stroke="#dfe5eb"/><text x="${L-12}" y="${Y(v)+5}" text-anchor="end" fill="#7b8a9a" font-size="12">${fmtDecimal(v)}</text>`).join('');
 const palette=['#2cb49d','#5884da','#d7a05a','#956ade','#e37a94','#4aa3c0'];
 const sectorColors=new Map();let k=0;
 const dots=pts.map((v,i)=>{
  if(!sectorColors.has(v.c.sector))sectorColors.set(v.c.sector,palette[(k++)%palette.length]);
  const chosen=trioSymbols.includes(v.c.symbol),showLabel=chosen||pts.length<=8;
  const x=X(v.pb),y=Y(v.pe),col=sectorColors.get(v.c.sector);
  const lx=x>W-190?-11:11;const ly=(i%3===0?-13:15);
  return `<g class="scatter-dot" tabindex="0" role="button" aria-label="${esc(v.c.name)} PER ${fmtDecimal(v.pe)}배 PBR ${fmtDecimal(v.pb)}배 재무제표 열기" data-scatter-detail="${esc(v.c.symbol)}"><title>${esc(v.c.name)} · ${esc(v.c.sector)} · PER ${fmtDecimal(v.pe)} · PBR ${fmtDecimal(v.pb)}</title><circle cx="${x}" cy="${y}" r="${chosen?9:7}" fill="${col}" fill-opacity=".88" stroke="${chosen?'#fff':'#ffffff88'}" stroke-width="${chosen?3:1}"/>${showLabel?`<text x="${x+lx}" y="${y+ly}" text-anchor="${lx<0?'end':'start'}" font-size="${chosen?15:12}" fill="#394c61" font-weight="${chosen?800:500}">${esc(v.c.name)}</text>`:''}</g>`;
 }).join('');
 chart.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="가로축 PBR, 세로축 PER 기업 분포">${grid}${xmax>=1?`<line x1="${X(1)}" y1="${T}" x2="${X(1)}" y2="${H-B}" stroke="#6e8097" stroke-width="1.7" stroke-dasharray="5 7"/><text x="${X(1)+6}" y="${T+19}" fill="#65768c" font-size="14">PBR 1배</text>`:''}${dots}<text x="${(W+L-R)/2}" y="${H-17}" text-anchor="middle" class="scatter-chart-label">PBR (배)</text><text x="21" y="${H/2}" transform="rotate(-90 21 ${H/2})" text-anchor="middle" class="scatter-chart-label">PER (배)</text></svg>`;
}
function initSectorExtra(){
 for(let i=0;i<3;i++)$('peerSelect'+i).addEventListener('change',e=>{const sym=e.target.value;if(sym&&trioSymbols.includes(sym)){note('같은 기업을 두 번 선택할 수 없습니다.');sectorExtraRender();return;}trioSymbols[i]=sym;sectorExtraRender();});
 for(const id of ['sectorMarket','sectorSelect'])$(id).addEventListener('change',()=>setTimeout(sectorExtraRender,0));
 $('scatterScope').addEventListener('change',e=>{scatterScope=e.target.value;scatterRender();});
 for(const id of ['sectorOverviewTbody','sectorOverviewBars'])$(id).addEventListener('click',e=>{if(e.target.closest('[data-sector-choose]'))setTimeout(sectorExtraRender,0);});
 $('peerTrioCards').addEventListener('click',e=>{const t=e.target.closest('[data-trio-detail]');if(t)window.FOLIO_APP?.openDetail?.(t.dataset.trioDetail);});
 const onScatter=e=>{const t=e.target.closest('[data-scatter-detail]');if(t)window.FOLIO_APP?.openDetail?.(t.dataset.scatterDetail);};
 $('pePbScatter').addEventListener('click',onScatter);
 $('pePbScatter').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onScatter(e);}});
 sectorExtraRender();
}

// ── Long-term dividend ledger: planned versus confirmed deposits ──
const DIV_STORE='folio_dividends_v1';
const moneyCurrency=(n,c)=>finite(n)?c==='USD'?'$'+n.toLocaleString('en-US',{maximumFractionDigits:4}):fmt(n):'—';
const dateOk=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const rawNum=v=>Number(v);
const amountOk=v=>finite(Number(v))&&Number(v)>=0&&Number(v)<=1e15;
const symOk=s=>typeof s==='string'&&/^[A-Z0-9.^=\-]{1,30}$/.test(s);
const monthsValid=a=>Array.isArray(a)&&a.length>=1&&a.length<=12&&a.every(n=>Number.isInteger(n)&&n>=1&&n<=12)&&new Set(a).size===a.length;
function validDivData(data){
 if(!data||typeof data!=='object'||!Array.isArray(data.plans)||!Array.isArray(data.receipts)||!data.gains||typeof data.gains!=='object')return false;
 if(data.plans.length>250||data.receipts.length>5000)return false;
 if(data.plans.some(p=>!symOk(p.symbol)||!amountOk(p.perShare)||p.perShare<=0||!monthsValid(p.months)||!amountOk(p.taxRate)||p.taxRate>100||!([null,undefined].includes(p.fxOverride)||amountOk(p.fxOverride)&&Number(p.fxOverride)>0)))return false;
 if(new Set(data.plans.map(p=>p.symbol)).size!==data.plans.length)return false;
 if(data.receipts.some(r=>typeof r.id!=='string'||r.id.length>100||!symOk(r.symbol)||!dateOk(r.date)||!amountOk(r.gross)||r.gross<=0||!amountOk(r.foreignTax)||Number(r.foreignTax)>Number(r.gross)||!amountOk(r.fx)||Number(r.fx)<=0||!amountOk(r.localTax)||!amountOk(r.fee)||!amountOk(r.bank)))return false;
 if(new Set(data.receipts.map(r=>r.id)).size!==data.receipts.length)return false;
 if(Object.keys(data.gains).length>40)return false;
 return Object.entries(data.gains).every(([y,v])=>/^20\d{2}$/.test(y)&&v&&['profit','loss','fees','proceeds'].every(k=>amountOk(v[k])));
}
function normalizedDiv(data){
 return {plans:data.plans.map(p=>({symbol:p.symbol,perShare:Number(p.perShare),months:[...p.months].sort((a,b)=>a-b),taxRate:Number(p.taxRate),fxOverride:Number(p.fxOverride)>0?Number(p.fxOverride):null})),
 receipts:data.receipts.map(r=>({id:r.id,symbol:r.symbol,date:r.date,gross:Number(r.gross),foreignTax:Number(r.foreignTax),fx:Number(r.fx),localTax:Number(r.localTax),fee:Number(r.fee),bank:Number(r.bank)})),
 gains:Object.fromEntries(Object.entries(data.gains).map(([year,v])=>[year,{profit:Number(v.profit),loss:Number(v.loss),fees:Number(v.fees),proceeds:Number(v.proceeds)}]))};
}
function readDivData(){try{const data=JSON.parse(localStorage.getItem(DIV_STORE)||'null');return validDivData(data)?normalizedDiv(data):{plans:[],receipts:[],gains:{}};}catch(e){return {plans:[],receipts:[],gains:{}};}}
let divData=readDivData(),divYear=yearKST(),editingDiv=null,editingReceipt=null;
function saveDiv(){try{localStorage.setItem(DIV_STORE,JSON.stringify(divData));return true;}catch(e){note('배당 기록을 저장하지 못했습니다. 브라우저 용량을 확인해주세요.');return false;}}
function dataCompany(symbol){return getCompany(symbol)||{symbol,name:symbol,currency:symbol.includes('.K')?'KRW':'USD',display:symbol};}
function divQty(symbol){return hold().find(h=>h.symbol===symbol)?.qty||0;}
function planFx(plan){const c=dataCompany(plan.symbol);return c.currency==='USD'?(plan.fxOverride||usdFx()):1;}
function forecastByMonth(year){
 const result=Array.from({length:12},(_,i)=>({year,month:i+1,gross:0,net:0,missing:0,entries:0}));
 for(const p of divData.plans){
  const qty=divQty(p.symbol),fx=planFx(p);
  for(const m of p.months){const cell=result[m-1];if(qty<=0)continue;
   if(!finite(fx)||fx<=0){cell.missing++;continue;}
   const gross=p.perShare*qty*fx;cell.gross+=gross;cell.net+=gross*(1-p.taxRate/100);cell.entries++;
  }
 }
 return result;
}
function receiptStats(r){
 const gross=r.gross*r.fx;
 const foreign=r.foreignTax*r.fx;
 const local=r.localTax+r.fee;
 const calculated=gross-foreign-local;
 return {gross,foreign,local,calculated,bank:r.bank,taxes:foreign+local,difference:r.bank-calculated};
}
function actualByMonth(year){
 const result=Array.from({length:12},(_,i)=>({month:i+1,gross:0,taxes:0,bank:0,count:0}));
 for(const r of divData.receipts){if(Number(r.date.slice(0,4))!==Number(year))continue;const m=Number(r.date.slice(5,7))-1;const n=receiptStats(r);const cell=result[m];cell.gross+=n.gross;cell.taxes+=n.taxes;cell.bank+=n.bank;cell.count++;}
 return result;
}
function capCalc({profit=0,loss=0,fees=0,proceeds=0}={}){
 const net=profit-loss-fees,taxable=Math.max(0,net-2500000),tax=taxable*.22;
 return {net,taxable,tax,after:proceeds?proceeds-tax:null};
}
function dividendSummary(){
 const plans=forecastByMonth(divYear),actual=actualByMonth(divYear);
 return {plans,actual,gross:plans.reduce((a,x)=>a+x.gross,0),estimatedNet:plans.reduce((a,x)=>a+x.net,0),missing:plans.reduce((a,x)=>a+x.missing,0),actualGross:actual.reduce((a,x)=>a+x.gross,0),actualTax:actual.reduce((a,x)=>a+x.taxes,0),actualBank:actual.reduce((a,x)=>a+x.bank,0)};
}
function allDividendSymbols(){
 const list=[...new Set([...hold().map(h=>h.symbol),...divData.plans.map(p=>p.symbol),...divData.receipts.map(r=>r.symbol)])];
 return list.sort((a,b)=>dataCompany(a).name.localeCompare(dataCompany(b).name,'ko'));
}
function optionsForStocks(selected){return allDividendSymbols().map(s=>`<option value="${esc(s)}" ${s===selected?'selected':''}>${esc(dataCompany(s).name)} · ${esc(s)}</option>`).join('');}
const keyId=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'rec-'+Date.now()+'-'+Math.random().toString(36).slice(2);
function renderDividends(){
 $('divYearBadge').textContent=divYear+' YEAR';
 const s=dividendSummary();
 $('divEstimatedGross').textContent=s.missing?'—':fmt(s.gross);
 $('divEstimatedNet').textContent=s.missing?'—':fmt(s.estimatedNet);
 $('divWithheld').textContent=fmt(s.actualTax);
 $('divBankActual').textContent=fmt(s.actualBank);
 let plans=divData.plans;
 $('divPlanBody').innerHTML=plans.length?plans.map(p=>{
  const h=dataCompany(p.symbol),qty=divQty(p.symbol),fx=planFx(p),g=finite(fx)?p.perShare*qty*fx*p.months.length:null,n=finite(g)?g*(1-p.taxRate/100):null;
  return `<tr><td><strong>${esc(h.name)}</strong><span class="div-minor">${esc(p.symbol)} · ${esc(h.currency)}</span></td><td>${moneyCurrency(p.perShare,h.currency)}</td><td class="num">${fmtDecimal(qty)}주</td><td>${p.months.join(' · ')}월</td><td class="num">${fmt(g)}</td><td class="num"><strong>${fmt(n)}</strong></td><td class="num">${fmtDecimal(p.taxRate)}%</td><td><button class="div-row-button" type="button" data-div-plan-edit="${esc(p.symbol)}">수정</button><button class="div-row-button danger" type="button" data-div-plan-delete="${esc(p.symbol)}">삭제</button></td></tr>`;
 }).join(''):'<tr><td colspan="8" class="div-empty">아직 배당 종목이 없습니다. 나의 포트폴리오에 종목을 등록한 뒤 배당 금액을 설정해 주세요.</td></tr>';
 const max=Math.max(1,...s.plans.map((x,i)=>Math.max(x.net,s.actual[i].bank)));
 $('divMonthlyChart').innerHTML=s.plans.map((m,i)=>{
  const a=s.actual[i];const h1=m.net?Math.max(3,m.net/max*100):0,h2=a.bank?Math.max(3,a.bank/max*100):0;
  return `<div class="div-month-col" title="${i+1}월 예상 세후 ${fmt(m.net)} · 실제 통장 ${fmt(a.bank)}"><div class="div-col-chart"><div class="div-bar forecast" style="height:${h1}%"></div><div class="div-bar actual" style="height:${h2}%"></div></div><small>${i+1}월</small></div>`;
 }).join('');
 $('divMonthBody').innerHTML=s.plans.map((m,i)=>{
  const a=s.actual[i],maybe=m.missing?'—':fmt(m.gross),net=m.missing?'—':fmt(m.net);
  return `<tr><td><strong>${i+1}월</strong></td><td class="num">${maybe}</td><td class="num">${net}</td><td class="num">${fmt(a.gross)}</td><td class="num">${fmt(a.taxes)}</td><td class="num"><strong>${fmt(a.bank)}</strong> <span class="div-minor">${a.count}건 확인</span></td></tr>`;
 }).join('');
 $('divMonthFoot').innerHTML=`<tr><td>연간 합계</td><td class="num">${s.missing?'—':fmt(s.gross)}</td><td class="num">${s.missing?'—':fmt(s.estimatedNet)}</td><td class="num">${fmt(s.actualGross)}</td><td class="num">${fmt(s.actualTax)}</td><td class="num">${fmt(s.actualBank)}</td></tr>`;
 const rows=divData.receipts.filter(r=>Number(r.date.slice(0,4))===divYear).sort((a,b)=>b.date.localeCompare(a.date));
 $('divReceiptBody').innerHTML=rows.length?rows.map(r=>{
  const c=dataCompany(r.symbol),n=receiptStats(r);
  return `<tr><td><strong>${esc(c.name)}</strong><span class="div-minor">${esc(r.date)} · ${esc(c.currency)}</span></td><td class="num">${fmt(n.gross)}<span class="div-minor">${moneyCurrency(r.gross,c.currency)}</span></td><td class="num">${fmt(n.foreign)}</td><td class="num">${fmt(n.local)}</td><td class="num">${fmt(n.calculated)}</td><td class="num"><strong>${fmt(n.bank)}</strong>${Math.abs(n.difference)>1?`<span class="div-minor" title="실입금과 입력한 원천세·수수료의 계산 차이">계산 차이 ${fmt(n.difference)}</span>`:''}</td><td><button type="button" class="div-row-button" data-div-receipt-edit="${esc(r.id)}">수정</button><button type="button" class="div-row-button danger" data-div-receipt-delete="${esc(r.id)}">삭제</button></td></tr>`;
 }).join(''):'<tr><td colspan="7" class="div-empty">이 연도에 입력된 실제 배당금이 없습니다. 증권사 지급명세를 확인해 추가해 주세요.</td></tr>';
 renderCapital();
}
function readCG(){return divData.gains[String(divYear)]||{profit:0,loss:0,fees:0,proceeds:0};}
function renderCapital(){
 const v=capCalc(readCG());
 $('cgNetGain').textContent=fmt(v.net);$('cgTaxable').textContent=fmt(v.taxable);$('cgTax').textContent=fmt(v.tax);$('cgAfter').textContent=fmt(v.after);
 $('cgExplanation').textContent=v.net<=2500000?'입력한 연간 순실현손익이 기본공제 250만 원을 넘지 않아 이 단순 계산에서는 예상 양도소득세가 0원입니다.':'과세표준 '+fmt(v.taxable)+' × 22% = 예상 합산세액 '+fmt(v.tax)+' (신고 전 추정치).';
}
function loadCapitalFields(){const g=readCG();for(const id of ['profit','loss','fees','proceeds'])$('cg'+id[0].toUpperCase()+id.slice(1)).value=g[id]||'';}
function exportDividendCSV(){
 const cols=['입금일','종목명','티커','통화','세전배당금(원화환산)','해외원천세(원)','국내추가세(원)','기타비용(원)','계산세후(원)','통장실입금(원)','환율'];
 const v=divData.receipts.filter(r=>Number(r.date.slice(0,4))===divYear).map(r=>{const n=receiptStats(r);return [r.date,dataCompany(r.symbol).name,r.symbol,dataCompany(r.symbol).currency,n.gross,n.foreign,r.localTax,r.fee,n.calculated,r.bank,r.fx];});
 const cell=x=>{let t=String(x??'');if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
 const txt='\uFEFF'+[cols,...v].map(r=>r.map(cell).join(',')).join('\r\n');
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'}));a.href=url;a.download=`folio_dividends_${divYear}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function openDivPlan(symbol=null){
 editingDiv=symbol;
 const p=divData.plans.find(x=>x.symbol===symbol)||null;
 const options=hold().map(h=>h.symbol);
 if(!options.length){note('먼저 1번 나의 포트폴리오 탭에서 보유 종목과 수량을 등록해 주세요.');return;}
 $('divPlanForm').reset();$('divPlanSymbol').innerHTML=optionsForStocks(symbol);
 $('divPlanTitle').textContent=p?'배당 종목 수정':'배당 종목 설정';
 $('divPlanSymbol').disabled=!!p;
 if(p){$('divPlanSymbol').value=p.symbol;$('divPlanPerShare').value=p.perShare;$('divPlanMonths').value=p.months.join(',');$('divPlanTaxRate').value=p.taxRate;$('divPlanFx').value=p.fxOverride||'';}
 else{$('divPlanMonths').value='3,6,9,12';const c=dataCompany($('divPlanSymbol').value);$('divPlanTaxRate').value=c.currency==='USD'?15:15.4;}
 openModal('divPlanModal');
}
function saveDivPlan(e){
 e.preventDefault();const symbol=$('divPlanSymbol').value;
 const perShare=Number($('divPlanPerShare').value),taxRate=Number($('divPlanTaxRate').value),fxText=$('divPlanFx').value.trim();
 const fxOverride=fxText===''?null:Number(fxText);
 const months=$('divPlanMonths').value.split(/[,;\s]+/).filter(Boolean).map(Number);
 if(!symOk(symbol)||!hold().some(h=>h.symbol===symbol)){note('보유 종목을 선택해 주세요.');return;}
 if(!Number.isFinite(perShare)||perShare<=0||!Number.isFinite(taxRate)||taxRate<0||taxRate>100||!monthsValid(months)||fxOverride!==null&&(!finite(fxOverride)||fxOverride<=0)){
  note('배당금·지급월·세율·환율을 확인하세요. 지급월은 1~12를 중복 없이 입력합니다.');return;
 }
 if(!editingDiv&&divData.plans.some(p=>p.symbol===symbol)){note('이미 배당 설정이 있습니다. 수정 버튼을 사용해 주세요.');return;}
 const obj={symbol,perShare,months:months.sort((a,b)=>a-b),taxRate,fxOverride};
 if(editingDiv)divData.plans=divData.plans.map(p=>p.symbol===editingDiv?obj:p);
 else divData.plans.push(obj);
 saveDiv();closeModal('divPlanModal');renderDividends();note('배당 설정을 저장했습니다.');
}
function openReceipt(id=null){
 editingReceipt=id;const r=divData.receipts.find(x=>x.id===id)||null;
 if(!allDividendSymbols().length){note('먼저 포트폴리오에 종목을 추가해 주세요.');return;}
 $('divReceiptForm').reset();$('divReceiptSymbol').innerHTML=optionsForStocks(r?.symbol);
 $('divReceiptTitle').textContent=r?'배당 입금 기록 수정':'실제 배당 입금 기록';
 $('divReceiptDate').value=r?.date||todayKST();
 if(r){for(const [id,key] of [['divReceiptGross','gross'],['divReceiptForeignTax','foreignTax'],['divReceiptFx','fx'],['divReceiptLocalTax','localTax'],['divReceiptFee','fee'],['divReceiptBank','bank']])$(id).value=r[key];}
 else{
  $('divReceiptGross').value='';$('divReceiptForeignTax').value=0;$('divReceiptLocalTax').value=0;$('divReceiptFee').value=0;$('divReceiptBank').value='';
  $('divReceiptFx').value=dataCompany($('divReceiptSymbol').value).currency==='USD'?usdFx()||'':1;
 }
 openModal('divReceiptModal');updateReceiptHelp();
}
function updateReceiptHelp(){
 const gross=Number($('divReceiptGross').value),tax=Number($('divReceiptForeignTax').value),fx=Number($('divReceiptFx').value),local=Number($('divReceiptLocalTax').value||0),fees=Number($('divReceiptFee').value||0);
 const valid=finite(gross)&&gross>0&&finite(tax)&&tax>=0&&tax<=gross&&fx>0&&finite(local)&&finite(fees);
 const el=$('receiptCalcHelp');if(!valid){el.textContent='세전 금액, 해외 원천세, 환율을 입력하면 계산 세후 금액이 나타납니다.';return;}
 const calc=(gross-tax)*fx-local-fees;
 el.textContent='입력값 기준 계산 세후 금액: '+fmt(calc)+' · 실제 입금액은 증권사 지급내역에서 확인해 주세요.';
}
function saveReceipt(e){
 e.preventDefault();const symbol=$('divReceiptSymbol').value,date=$('divReceiptDate').value;
 const get=id=>Number($(id).value);const r={id:editingReceipt||keyId(),symbol,date,gross:get('divReceiptGross'),foreignTax:get('divReceiptForeignTax'),fx:get('divReceiptFx'),localTax:get('divReceiptLocalTax'),fee:get('divReceiptFee'),bank:get('divReceiptBank')};
 if(!symOk(symbol)||!dateOk(date)||!amountOk(r.gross)||r.gross<=0||!amountOk(r.foreignTax)||r.foreignTax>r.gross||!amountOk(r.fx)||r.fx<=0||!amountOk(r.localTax)||!amountOk(r.fee)||!amountOk(r.bank)||!$('divReceiptBank').value.trim()){
  note('실제 입금액·지급일·환율·원천징수 금액을 확인해 주세요.');return;
 }
 const c=dataCompany(symbol);
 if(c.currency==='KRW'&&r.fx!==1){note('원화 배당의 환율은 1을 입력해야 합니다.');return;}
 const calculated=receiptStats(r).calculated;
 if(calculated<0){note('원천세·수수료 합계가 세전 배당금보다 큽니다.');return;}
 if(Math.abs(r.bank-calculated)>Math.max(1000,calculated*.15)&&!confirm(`실제 통장 입금 ${fmt(r.bank)}과 계산 세후 ${fmt(calculated)}의 차이가 큽니다. 실제 입금액을 기준으로 저장할까요?`))return;
 if(editingReceipt)divData.receipts=divData.receipts.map(x=>x.id===editingReceipt?r:x);
 else divData.receipts.push(r);
 if(divData.receipts.length>5000){note('저장 가능한 배당 내역은 최대 5,000건입니다.');return;}
 saveDiv();closeModal('divReceiptModal');divYear=Number(date.slice(0,4));$('divYear').value=divYear;loadCapitalFields();renderDividends();note('실제 통장 입금 기록을 저장했습니다.');
}
function initDividends(){
 const curr=yearKST();
 const years=[...new Set([...Array.from({length:15},(_,i)=>curr-4+i),...divData.receipts.map(r=>Number(r.date.slice(0,4))),...Object.keys(divData.gains).map(Number)])].sort((a,b)=>a-b);
 $('divYear').innerHTML=years.map(y=>`<option value="${y}">${y}년</option>`).join('');
 $('divYear').value=divYear;
 $('divYear').addEventListener('change',e=>{divYear=Number(e.target.value);loadCapitalFields();renderDividends();});
 $('exportDivCsv').addEventListener('click',exportDividendCSV);
 $('addDivPlan').addEventListener('click',()=>openDivPlan());
 $('addDivReceipt').addEventListener('click',()=>openReceipt());
 $('divPlanSymbol').addEventListener('change',e=>{$('divPlanTaxRate').value=dataCompany(e.target.value).currency==='USD'?15:15.4;});
 $('divPlanForm').addEventListener('submit',saveDivPlan);
 $('divReceiptSymbol').addEventListener('change',e=>{$('divReceiptFx').value=dataCompany(e.target.value).currency==='USD'?usdFx()||'':1;updateReceiptHelp();});
 $('divReceiptForm').addEventListener('submit',saveReceipt);
 for(const id of ['divReceiptGross','divReceiptForeignTax','divReceiptFx','divReceiptLocalTax','divReceiptFee'])$(id).addEventListener('input',updateReceiptHelp);
 document.querySelectorAll('[data-div-close]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.divClose)));
 for(const id of ['divPlanModal','divReceiptModal'])$(id).addEventListener('click',e=>{if(e.target===$(id))closeModal(id);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal('divPlanModal');closeModal('divReceiptModal');}});
 $('divPlanBody').addEventListener('click',e=>{
  const edit=e.target.closest('[data-div-plan-edit]'),del=e.target.closest('[data-div-plan-delete]');
  if(edit)openDivPlan(edit.dataset.divPlanEdit);
  if(del&&confirm('이 종목의 배당 예상 설정을 삭제할까요? 기존 실제 배당 입금 기록은 남습니다.')){divData.plans=divData.plans.filter(p=>p.symbol!==del.dataset.divPlanDelete);saveDiv();renderDividends();}
 });
 $('divReceiptBody').addEventListener('click',e=>{
  const edit=e.target.closest('[data-div-receipt-edit]'),del=e.target.closest('[data-div-receipt-delete]');
  if(edit)openReceipt(edit.dataset.divReceiptEdit);
  if(del&&confirm('선택한 실제 배당 입금 기록을 삭제할까요?')){divData.receipts=divData.receipts.filter(r=>r.id!==del.dataset.divReceiptDelete);saveDiv();renderDividends();}
 });
 for(const id of ['Profit','Loss','Fees','Proceeds'])$('cg'+id).addEventListener('input',()=>{
  const vals={};for(const [key,suffix] of [['profit','Profit'],['loss','Loss'],['fees','Fees'],['proceeds','Proceeds']])vals[key]=Number($('cg'+suffix).value||0);
  if(!Object.values(vals).every(amountOk)){note('금액은 0 이상의 유효한 숫자로 입력해주세요.');return;}
  divData.gains[String(divYear)]=vals;saveDiv();renderCapital();
 });
 window.addEventListener('folio:portfolio-updated',()=>renderDividends());
 // Save and restore alongside the existing JSON portfolio backup.
 window.FOLIO_DIVIDENDS={
  exportData:()=>JSON.parse(JSON.stringify(divData)),
  validateData:validDivData,
  importData:v=>{if(!validDivData(v))throw new Error('배당 백업 형식 오류');divData=normalizedDiv(v);saveDiv();renderDividends();},
  summary:dividendSummary,
  capCalc,
  getData:()=>JSON.parse(JSON.stringify(divData))
 };
 loadCapitalFields();renderDividends();
}
initFear();initSectorExtra();initDividends();
})();
