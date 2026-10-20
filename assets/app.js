(() => {
  'use strict';
  const catalog = Array.isArray(window.FOLIO_CATALOG) ? window.FOLIO_CATALOG : [];
  const market = window.FOLIO_MARKET || {stocks:{}, indices:{}, fx:null, fear_greed:null};
  const STORE_KEY = 'folio_portfolio_v1';
  const colors = ['#37ad89','#416d9c','#a6b9df','#ebbd73','#8ab7ad','#d68ba4','#b89cc9','#a3afb7'];
  const $ = id => document.getElementById(id);
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const text = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const koInt = new Intl.NumberFormat('ko-KR', {maximumFractionDigits:0});
  const koNum = new Intl.NumberFormat('ko-KR', {maximumFractionDigits:2});
  const usdNum = new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  let holdings = [];
  let filter = 'ALL';
  let query = '';
  let editing = null;
  let chosen = null;
  let toastTimer = null;
  const known = new Map(catalog.map(c => [c.symbol, c]));

  function safeRead() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter(validHolding).map(normalizeHolding) : [];
    } catch(e) { console.warn('Storage unavailable', e); return []; }
  }
  function validHolding(v) {
    return v && typeof v === 'object' && typeof v.symbol === 'string' && v.symbol.length <= 28 &&
      typeof v.name === 'string' && Number(v.avg) > 0 && Number(v.qty) > 0 &&
      ['KRW','USD'].includes(v.currency);
  }
  function normalizeHolding(h) { return {
    symbol: String(h.symbol).trim().toUpperCase(), name: String(h.name).slice(0,65),
    sector: String(h.sector || '기타').slice(0,60),
    display: String(h.display || h.symbol).slice(0,40),
    market: h.market === 'US' ? 'US' : 'KR', currency: h.currency,
    avg: Number(h.avg), qty: Number(h.qty),
    purchaseFx: Number(h.purchaseFx) > 0 ? Number(h.purchaseFx) : null,
    kind: h.kind === 'ETF' ? 'ETF' : 'STOCK'
  }; }
  function save() {
    try {localStorage.setItem(STORE_KEY, JSON.stringify(holdings));return true;}
    catch(e){toast('브라우저에 저장하지 못했습니다. 저장 공간을 확인해 주세요.');return false;}
  }
  function toast(message) {
    const node = $('toast');node.textContent=message;node.classList.add('visible');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('visible'),3300);
  }
  const won = x => num(x) ? `${koInt.format(Math.round(x))}원` : '—';
  const wonSigned = x => num(x) ? `${x>0?'+':x<0?'−':''}${koInt.format(Math.round(Math.abs(x)))}원` : '—';
  const money = (x,c) => num(x) ? (c==='USD' ? '$'+usdNum.format(x) : koInt.format(Math.round(x))+'원') : '—';
  const pct = (x,signed=false) => num(x) ? `${signed&&x>0?'+':''}${x.toFixed(2)}%` : '—';
  const fmtPrice = (x, c) => num(x) ? (c==='USD' ? '$'+usdNum.format(x) : koInt.format(Math.round(x))+'원') : '—';
  const normalDate = s => s ? String(s).slice(0,10).replace(/-/g,'.') : '—';
  function kstDate() {return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date());}
  function shortN(x, curr='KRW') {
    if(!num(x))return '—';
    const sign=x<0?'−':'';let n=Math.abs(x);
    if(curr==='USD')return sign+'$'+(n>=1e12?(n/1e12).toFixed(2)+'T':n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':usdNum.format(n));
    return sign+(n>=1e12? (n/1e12).toFixed(2)+'조원':n>=1e8?(n/1e8).toFixed(2)+'억원':n>=1e4?(n/1e4).toFixed(1)+'만원':koInt.format(n)+'원');
  }
  const quote = symbol => (market.stocks || {})[symbol] || null;
  const fxRate = () => num(market.fx?.rate) && market.fx.rate > 0 ? market.fx.rate : null;
  function calc() {
    const rate=fxRate();
    const rows=holdings.map(h=>{
      const q=quote(h.symbol), price=q && num(q.price) && q.price>0?q.price:null;
      const fxNow=h.currency==='USD'?rate:1;
      const estimatedFx=h.currency==='USD' && !h.purchaseFx;
      const fxBuy=h.currency==='USD'?(h.purchaseFx||rate):1;
      const costNative=h.avg*h.qty;
      const currentNative=price===null?null:price*h.qty;
      const cost=num(fxBuy)?costNative*fxBuy:null;
      const value=currentNative!==null&&num(fxNow)?currentNative*fxNow:null;
      const pnl=value!==null&&cost!==null?value-cost:null;
      const ret=pnl!==null&&cost>0?pnl/cost*100:null;
      return {h,q,price,costNative,currentNative,cost,value,pnl,ret,estimatedFx};
    });
    const validCosts=rows.filter(r=>r.cost!==null);
    const validValues=rows.filter(r=>r.value!==null);
    const paired=rows.filter(r=>r.pnl!==null);
    const totalCost=validCosts.reduce((a,r)=>a+r.cost,0);
    const pairedCost=paired.reduce((a,r)=>a+r.cost,0);
    const totalValue=validValues.reduce((a,r)=>a+r.value,0);
    const totalPnl=paired.reduce((a,r)=>a+r.pnl,0);
    const totalRet=pairedCost>0?totalPnl/pairedCost*100:null;
    return {rows,totalCost,totalValue,totalPnl,totalRet,pairedCost,
      costMissing:rows.length-validCosts.length,priceMissing:rows.length-validValues.length,
      estimatedFx:rows.some(r=>r.estimatedFx), pricedRows:validValues.length};
  }
  function sparkline(history,width=86,height=29,detail=false) {
    const vals=(history||[]).map(p=>Number(p.close)).filter(v=>num(v)&&v>0);
    if(vals.length<2) return '<span style="color:#b6c3ca;font-size:11px">—</span>';
    const lo=Math.min(...vals),hi=Math.max(...vals),span=hi-lo||1;
    const inset=detail?9:3;
    const points=vals.map((v,i)=>`${inset+(i/(vals.length-1))*(width-inset*2)},${inset+((hi-v)/span)*(height-inset*2)}`);
    const increasing=vals.at(-1)>=vals[0];
    const col=increasing?'#29b78c':'#df8394';
    return `<svg viewBox="0 0 ${width} ${height}" aria-label="${vals.length}거래일 주가 추이" role="img"><polyline points="${points.join(' ')}" fill="none" stroke="${col}" stroke-width="${detail?2.5:1.9}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="${points.at(-1).split(',')[0]}" cy="${points.at(-1).split(',')[1]}" r="${detail?4:2.3}" fill="${col}"/></svg>`;
  }

  function renderMarket() {
    $('todayKST').textContent=kstDate();
    const currentYear = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date());
    $('calendarYear').textContent=currentYear; $('footerYear').textContent=currentYear;
    const update=market.updated_at;
    $('headerUpdated').textContent=update?`자료 갱신 ${new Date(update).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`:'시세 업데이트 전';
    $('sidebarDataStatus').textContent=update?'시세 데이터 수집 기록 있음':'최초 자동 갱신 필요';
    const f=market.fear_greed;
    if(f && num(f.score)) {
      $('fearScore').textContent=f.score.toFixed(0);
      const rating=f.rating||'';
      const labels={'extreme fear':'극도의 공포','fear':'공포','neutral':'중립','greed':'탐욕','extreme greed':'극도의 탐욕'};
      $('fearRating').textContent=labels[rating]||'지수 확인';
      $('fearRating').style.color=f.score<25?'#ff9dac':f.score<45?'#efb382':f.score<55?'#f0d47c':'#83e6bd';
      $('fearTimestamp').textContent=`CNN 발표: ${f.timestamp ? new Date(f.timestamp).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '날짜 미제공'} 기준`;
      $('fearYesterday').textContent=num(f.previous_close)?f.previous_close.toFixed(1):'—';
      $('fearLastWeek').textContent=num(f.previous_1_week)?f.previous_1_week.toFixed(1):'—';
      $('fearLastMonth').textContent=num(f.previous_1_month)?f.previous_1_month.toFixed(1):'—';
      const rad=(180-f.score*1.8)*Math.PI/180;
      $('fearNeedle').setAttribute('x2',(180+111*Math.cos(rad)).toFixed(2));
      $('fearNeedle').setAttribute('y2',(186-111*Math.sin(rad)).toFixed(2));
      ['fearNeedle','fearNeedleDot','fearNeedleInset'].forEach(id=>$(id).setAttribute('opacity','1'));
    }
    const names=['KOSPI','KOSDAQ','S&P 500','NASDAQ'];
    $('marketIndices').innerHTML=names.map(name=>{
      const v=(market.indices||{})[name];const dir=v?.change_pct;
      return `<div class="index-item"><span>${text(name)}</span><strong>${num(v?.price)?koNum.format(v.price):'—'}</strong><small class="${num(dir)?dir>=0?'positive':'negative':''}">${pct(dir,true)}</small></div>`;
    }).join('');
    $('fxRate').textContent=fxRate()?koNum.format(fxRate())+'원':'—';
    const quotes=Object.keys(market.stocks||{}).length;
    $('syncSummary').textContent=update?`최근 자료 갱신 ${normalDate(update)} · ${quotes}개 종목 데이터 보유`:'아직 첫 번째 데이터 갱신이 실행되지 않았습니다.';
    if(Array.isArray(market.warnings)&&market.warnings.length&&update){
      $('syncSummary').textContent += ` · 수집 경고 ${market.warnings.length}건`;
    }
  }
  function renderSummary(a) {
    const has=a.rows.length>0;
    $('totalCost').textContent=has&&a.costMissing<a.rows.length?won(a.totalCost):'—';
    $('totalValue').textContent=has&&a.pricedRows?won(a.totalValue):'—';
    $('totalPnl').textContent=has&&a.pricedRows?wonSigned(a.totalPnl):'—';
    $('totalPnl').className=a.totalPnl<0?'negative':a.totalPnl>0?'positive':'';
    $('totalReturn').textContent=has&&a.pricedRows?pct(a.totalRet,true):'—';
    $('totalReturn').className=a.totalRet<0?'negative':a.totalRet>0?'positive':'';
    $('totalValueHelp').textContent=!has?'종목을 추가해 주세요':a.priceMissing?`종가 미확인 ${a.priceMissing}개 종목 제외`:`최근 확인 종가 · ${a.pricedRows}개 종목`;
    $('totalPnlDetail').textContent=a.priceMissing?'가격 확인된 종목만 손익 합산':'보유 종목의 총 평가 손익';
    $('totalReturnHelp').textContent=a.priceMissing?'가격 확인된 종목 기준 수익률':'평가 손익 / 해당 매수 원금';
    let warnings=[];
    if(a.priceMissing)warnings.push(`종가가 없는 종목 ${a.priceMissing}개는 평가금액·수익률에서 제외되었습니다.`);
    if(a.costMissing)warnings.push(`환산할 수 없는 매수금액 ${a.costMissing}개는 합계에서 제외되었습니다.`);
    if(a.estimatedFx)warnings.push('일부 미국 종목의 매수환율이 비어 있어 현재 환율로 원가를 추정했습니다. 정확한 환차손익을 위해 매수 당시 환율을 입력하세요.');
    $('coverageNote').hidden=!warnings.length;
    $('coverageNote').textContent=warnings.join(' ');
  }
  function renderAllocation(a) {
    $('donutCount').textContent=holdings.length;
    const totals=new Map();
    a.rows.forEach(r=>{if(r.value!==null)totals.set(r.h.sector,(totals.get(r.h.sector)||0)+r.value);});
    const items=Array.from(totals.entries()).sort((p,q)=>q[1]-p[1]);
    const sum=items.reduce((acc,it)=>acc+it[1],0);
    if(!sum) {$('donut').style.background='conic-gradient(#e7edf0 0 100%)';$('sectorLegend').innerHTML='<p class="empty-helper">평가 가능한 종목의<br>섹터 비중이 표시됩니다.</p>';return;}
    const visible=items.length<=5?items:[...items.slice(0,4),['기타',items.slice(4).reduce((s,it)=>s+it[1],0)]];
    let offset=0;const gradients=[];
    visible.forEach(([name,value],i)=>{let next=offset+value/sum*100;gradients.push(`${colors[i]} ${offset.toFixed(3)}% ${next.toFixed(3)}%`);offset=next;});
    $('donut').style.background=`conic-gradient(${gradients.join(',')})`;
    $('sectorLegend').innerHTML=visible.map(([name,value],i)=>`<div class="legend-row"><span class="legend-dot" style="background:${colors[i]}"></span><span class="legend-name" title="${text(name)}">${text(name)}</span><strong>${pct(value/sum*100)}</strong></div>`).join('');
  }
  function renderBars(a) {
    const data=a.rows.filter(r=>r.pnl!==null).sort((x,y)=>Math.abs(y.pnl)-Math.abs(x.pnl)).slice(0,6);
    if(!data.length){$('pnlBars').innerHTML='<div class="empty-helper">종목을 등록하고 종가 데이터를 수집하면<br>수익과 손실을 비교할 수 있어요.</div>';return;}
    const max=Math.max(...data.map(r=>Math.abs(r.pnl)),1);
    $('pnlBars').innerHTML=data.map(r=>`<div class="pnl-bar"><span class="pnl-bar-name" title="${text(r.h.name)}">${text(r.h.name)}</span><div class="bar-track"><div class="bar-fill ${r.pnl<0?'loss':''}" style="width:${Math.max(2,Math.abs(r.pnl)/max*100).toFixed(1)}%"></div></div><strong class="pnl-bar-value ${r.pnl<0?'negative':'positive'}">${pct(r.ret,true)}</strong></div>`).join('');
  }
  function renderHoldings(a) {
    $('holdingsCount').textContent=holdings.length;
    const selected=a.rows.filter(r=>(filter==='ALL'||r.h.market===filter) && (!query||[r.h.name,r.h.sector,r.h.display,r.h.symbol].some(s=>s.toLowerCase().includes(query))));
    const tbody=$('holdingsTbody');
    if(!selected.length){
      tbody.innerHTML=`<tr><td colspan="14" class="empty-table">${holdings.length?'검색 결과가 없습니다.':'등록한 종목이 없습니다. 「+ 종목 추가」를 눌러 시작하세요. <button type="button" data-demo="yes" class="outline-btn" style="margin-left:12px">예시 데이터 넣기</button>'}</td></tr>`;
      $('holdingsFooter').innerHTML='';return;
    }
    tbody.innerHTML=selected.map(r=>{
      const h=r.h;const initial=a.totalCost&&r.cost!==null?r.cost/a.totalCost*100:null;
      const current=a.totalValue&&r.value!==null?r.value/a.totalValue*100:null;
      return `<tr>
        <td><button type="button" class="stock-name-button" data-detail="${text(h.symbol)}">${text(h.name)}</button><span class="stock-minor">${h.market==='KR'?'KOREA':'UNITED STATES'} · ${h.currency}</span></td>
        <td>${text(h.sector)}</td><td><span class="ticker-badge">${text(h.display)}</span></td>
        <td class="num"><strong style="color:#293e50">${fmtPrice(r.price,h.currency)}</strong><span class="stock-minor">${r.q?.quote_date?normalDate(r.q.quote_date)+' 종가':'데이터 없음'}</span></td>
        <td class="num">${fmtPrice(h.avg,h.currency)}</td><td class="table-trend">${sparkline(r.q?.history)}</td>
        <td class="num">${koNum.format(h.qty)}</td><td class="num" title="${r.estimatedFx?'매수환율 미입력 · 현재 환율 적용':''}">${won(r.cost)}${r.estimatedFx?' *':''}</td><td class="num">${pct(initial)}</td>
        <td class="num"><strong style="color:#293e50">${won(r.value)}</strong></td><td class="num">${pct(current)}</td><td class="num ${r.pnl<0?'negative':r.pnl>0?'positive':''}">${wonSigned(r.pnl)}</td>
        <td class="num"><span class="roi-pill ${r.ret<0?'negative':r.ret>0?'positive':''}">${pct(r.ret,true)}</span></td>
        <td><div class="row-actions"><button type="button" data-edit="${text(h.symbol)}" aria-label="${text(h.name)} 수정">✎</button><button type="button" data-delete="${text(h.symbol)}" aria-label="${text(h.name)} 삭제">×</button></div></td>
      </tr>`;
    }).join('');
    const subtotalCost=selected.reduce((v,r)=>v+(r.cost||0),0);
    const subtotalValue=selected.reduce((v,r)=>v+(r.value||0),0);
    const subtotalPnl=selected.reduce((v,r)=>v+(r.pnl||0),0);
    const groupIsPartial=selected.length!==a.rows.length;
    $('holdingsFooter').innerHTML=`<tr><td>선택 합계 <span class="stock-minor">${selected.length}개 종목${groupIsPartial?' · 필터 적용':''}</span></td><td colspan="5"></td><td class="num">${koNum.format(selected.reduce((s,r)=>s+r.h.qty,0))}</td><td class="num">${won(subtotalCost)}</td><td class="num">${pct(a.totalCost?subtotalCost/a.totalCost*100:null)}</td><td class="num">${won(subtotalValue)}</td><td class="num">${pct(a.totalValue?subtotalValue/a.totalValue*100:null)}</td><td class="num ${subtotalPnl<0?'negative':'positive'}">${wonSigned(subtotalPnl)}</td><td colspan="2"></td></tr>`;
  }
  function render() { const a=calc();renderSummary(a);renderAllocation(a);renderBars(a);renderHoldings(a); if (typeof window.dispatchEvent==='function')window.dispatchEvent(new Event('folio:portfolio-updated')); }

  function selectCompany(item) {
    chosen=item;
    $('stockQuery').value=item.name;
    $('stockSector').value=item.sector;
    $('stockCode').value=item.display;
    $('stockSymbol').value=item.symbol;
    $('stockCurrency').value=item.currency;
    $('stockSuggestions').hidden=true;
    updateFxField();updateTrackingWarning();
  }
  function matches(input) {
    const q=input.trim().toLowerCase().replace(/\s+/g,'');
    if(!q)return catalog.slice(0,8);
    return catalog.filter(item=>[item.name,item.symbol,item.display,item.sector].some(v=>v.toLowerCase().replace(/\s+/g,'').includes(q))).slice(0,10);
  }
  function showSuggestions(){
    const res=matches($('stockQuery').value);
    $('stockSuggestions').hidden=!res.length;
    $('stockSuggestions').innerHTML=res.map(item=>`<button class="suggestion" type="button" data-pick="${text(item.symbol)}"><strong>${text(item.name)}</strong><span>${text(item.display)} · ${text(item.sector)}</span></button>`).join('');
  }
  function updateFxField(){$('fxPurchaseField').hidden=$('stockCurrency').value!=='USD';}
  function updateTrackingWarning(){
    const sym=$('stockSymbol').value.trim().toUpperCase();
    $('stockTrackingWarning').hidden=!sym||known.has(sym);
  }
  function openModal(h=null){
    editing=h?.symbol||null;chosen=h?known.get(h.symbol)||null:null;
    $('holdingForm').reset();$('stockSuggestions').hidden=true;
    $('modalTitle').textContent=h?'보유 종목 수정':'새 종목 추가';
    $('saveHolding').textContent=h?'수정 저장':'종목 저장';
    if(h){
      $('stockQuery').value=h.name;$('stockSector').value=h.sector;$('stockCode').value=h.display;
      $('stockSymbol').value=h.symbol;$('stockCurrency').value=h.currency;
      $('stockAverage').value=h.avg;$('stockQuantity').value=h.qty;
      $('stockPurchaseFx').value=h.purchaseFx||'';
    }
    updateFxField();updateTrackingWarning();
    $('holdingModal').classList.add('open');$('holdingModal').setAttribute('aria-hidden','false');
    setTimeout(()=>$('stockQuery').focus(),30);
  }
  function closeModal(){$('holdingModal').classList.remove('open');$('holdingModal').setAttribute('aria-hidden','true');$('stockSuggestions').hidden=true;}
  function submitHolding(e){
    e.preventDefault();
    const symbol=$('stockSymbol').value.trim().toUpperCase();
    const name=$('stockQuery').value.trim();
    const avg=Number($('stockAverage').value),qty=Number($('stockQuantity').value);
    const currency=$('stockCurrency').value;
    if(!/^[A-Z0-9.^=\-]{1,28}$/.test(symbol)){toast('자동 조회 코드를 확인해 주세요. 예: 005930.KS / AAPL');return;}
    if(!name||name.length>65||!num(avg)||avg<=0||!num(qty)||qty<=0||!['KRW','USD'].includes(currency)){toast('입력한 수량·평단·종목명을 확인해 주세요.');return;}
    if(holdings.some(h=>h.symbol===symbol && h.symbol!==editing)){toast('이미 보유 목록에 있는 종목입니다. 기존 종목에서 수정해 주세요.');return;}
    const purchaseFx=$('stockPurchaseFx').value.trim()?Number($('stockPurchaseFx').value):null;
    if(purchaseFx!==null&&(!num(purchaseFx)||purchaseFx<=0)){toast('매수환율을 확인해 주세요.');return;}
    const record=normalizeHolding({symbol,name,sector:$('stockSector').value||'기타',display:$('stockCode').value||symbol,
      market:symbol.endsWith('.KS')||symbol.endsWith('.KQ')?'KR':'US',currency,
      avg,qty,purchaseFx,kind:known.get(symbol)?.kind||'STOCK'});
    if(editing){const index=holdings.findIndex(h=>h.symbol===editing);if(index!==-1)holdings[index]=record;}
    else holdings.push(record);
    save();closeModal();render();toast(editing?'종목 정보를 수정했습니다.':'포트폴리오에 종목을 추가했습니다.');
  }
  function removeHolding(symbol){
    const item=holdings.find(h=>h.symbol===symbol);
    if(!item||!confirm(`${item.name} 종목을 포트폴리오에서 삭제할까요?`))return;
    holdings=holdings.filter(h=>h.symbol!==symbol);save();render();toast('종목을 삭제했습니다.');
  }
  function csvCell(v){let s=String(v??'');if(typeof v==='string' && /^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  function download(name, content, mime){
    const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportCsv(){
    if(!holdings.length){toast('내보낼 보유 종목이 없습니다.');return;}
    const a=calc();const columns=['종목명','섹터','코드','Yahoo Symbol','통화','현재종가','종가일','매수평단','수량','매수당시환율','매수금액합계(원)','초기비중(%)','현재잔고(원)','현재비중(%)','수익금(원)','수익률(%)'];
    const rows=a.rows.map(r=>[r.h.name,r.h.sector,r.h.display,r.h.symbol,r.h.currency,r.price??'',r.q?.quote_date||'',r.h.avg,r.h.qty,r.h.purchaseFx??'',r.cost??'',a.totalCost&&r.cost!==null?r.cost/a.totalCost*100:'',r.value??'',a.totalValue&&r.value!==null?r.value/a.totalValue*100:'',r.pnl??'',r.ret??'']);
    download(`folio_positions_${new Date().toISOString().slice(0,10)}.csv`, '\uFEFF'+[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }
  function exportBackup(){
    const content={app:'folio-portfolio',version:5,exportedAt:new Date().toISOString(),holdings,projects:window.FOLIO_PROJECTS?.exportRecords?.()||[],dividends:window.FOLIO_DIVIDENDS?.exportData?.()||{plans:[],receipts:[],gains:{}},macro:window.FOLIO_MACRO_UI?.exportData?.()||{reports:[],forecasts:[]}};
    download(`folio_portfolio_backup_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(content,null,2),'application/json');toast('백업 파일을 저장했습니다.');
  }
  async function importBackup(evt){
    const file=evt.target.files?.[0];evt.target.value='';if(!file)return;
    try{
      if(file.size>8*1024*1024)throw new Error('2MB 이하의 백업 파일만 지원합니다.');
      const backup=JSON.parse(await file.text());
      if(backup.app!=='folio-portfolio'||!Array.isArray(backup.holdings)||backup.holdings.length>400||!backup.holdings.every(validHolding))throw new Error('FOLIO 백업 형식이 올바르지 않습니다.');
      const normalized=backup.holdings.map(normalizeHolding);
      if(new Set(normalized.map(h=>h.symbol)).size!==normalized.length)throw new Error('같은 종목 코드가 중복되어 있습니다.');
      if('projects' in backup && !window.FOLIO_PROJECTS?.validateRecords?.(backup.projects))throw new Error('장기 프로젝트 기록의 형식이 올바르지 않습니다.');
      if('dividends' in backup && !window.FOLIO_DIVIDENDS?.validateData?.(backup.dividends))throw new Error('배당 기록의 형식이 올바르지 않습니다.');
      if('macro' in backup && !window.FOLIO_MACRO_UI?.validateData?.(backup.macro))throw new Error('경제보고서 기록의 형식이 올바르지 않습니다.');
      if(!confirm(`백업에 있는 ${normalized.length}개 종목으로 현재 목록 ${holdings.length}개를 교체할까요? 먼저 현재 포트폴리오를 백업하는 것을 권장합니다.`))return;
      holdings=normalized;save(); if('projects' in backup)window.FOLIO_PROJECTS.importRecords(backup.projects);if('dividends' in backup)window.FOLIO_DIVIDENDS.importData(backup.dividends);if('macro' in backup)window.FOLIO_MACRO_UI.importData(backup.macro);render();toast('백업을 복원했습니다.');
    }catch(e){toast('가져오기 실패: '+(e?.message||'알 수 없는 오류'));}
  }
  const ratios=[['PER (주가수익비율)','pe','x'],['PBR (주가순자산비율)','pb','x'],['ROE (자기자본이익률)','roe','percent'],['EPS (주당순이익)','eps','price'],['순이익 · 최근자료','net_income','large'],['매출액 · 최근자료','revenue','large'],['영업이익률','operating_margin','percent'],['순이익률','profit_margin','percent'],['시가총액','market_cap','large'],['배당수익률','dividend_yield','percent'],['현금 보유액','total_cash','large'],['총차입금','total_debt','large']];
  function metricFormat(value,format,currency){
    if(!num(value))return '—';
    if(format==='percent')return (value*100).toFixed(2)+'%';
    if(format==='x')return value.toFixed(2)+'배';
    if(format==='price')return money(value,currency);
    return shortN(value,currency);
  }
  function openDetail(symbol){
    const h=holdings.find(x=>x.symbol===symbol)||known.get(symbol);
    if(!h)return;
    const q=quote(symbol), financials=q?.fundamentals, metrics=financials?.metrics||{};
    $('detailTitle').textContent=h.name;$('detailSymbol').textContent=h.display+' · '+h.sector;
    const history=q?.history||[];
    let html=`<div class="detail-price-head"><div><strong class="detail-price-big">${fmtPrice(q?.price,h.currency)}</strong><span class="detail-quote-date">${normalDate(q?.quote_date)} 종가 · ${text(h.currency)}</span></div><div class="${q?.change_pct<0?'negative':'positive'}" style="font-weight:800;font-size:14px">${pct(q?.change_pct,true)}</div></div>`;
    html+=`<div class="detail-chart">${history.length>1?sparkline(history,430,152,true):'<div class="empty-helper">차트 데이터가 아직 없습니다.</div>'}</div>`;
    html+=`<div class="detail-label">기업 재무지표 <span style="font-size:9px;font-weight:500;letter-spacing:0;color:#a0aeb9">지표 기준 기간은 제공처별 상이</span></div>`;
    if(!financials){html+=`<div class="drawer-empty">${h.kind==='ETF'?'ETF는 기업 PER·PBR·당기순이익 등 지표가 적용되지 않거나 제공되지 않을 수 있습니다.':'재무정보가 아직 수집되지 않았습니다. Actions 실행 후 순차적으로 재무지표가 채워집니다. 자료 제공처에 따라 일부 항목은 계속 공란일 수 있습니다.'}</div>`;}
    html+='<div class="finance-grid">'+ratios.map(([label,key,format])=>`<div class="finance-metric ${['pe','pb'].includes(key)?'big':''}"><span>${text(label)}</span><strong>${metricFormat(metrics[key],format,h.currency)}</strong>${['pe','pb'].includes(key)?'<small>최근 제공된 재무자료 기준</small>':''}</div>`).join('')+'</div>';
    html+='<div class="detail-label">연간 손익계산서</div>';
    const annual=financials?.annual_income||[];
    if(annual.length){html+='<table class="annual-table"><thead><tr><th>연도</th><th>매출</th><th>영업이익</th><th>순이익</th></tr></thead><tbody>'+annual.map(y=>`<tr><td>${text(y.year)}</td><td>${shortN(y.revenue,h.currency)}</td><td>${shortN(y.operating_income,h.currency)}</td><td>${shortN(y.net_income,h.currency)}</td></tr>`).join('')+'</tbody></table>';}
    else html+='<div class="drawer-empty">연간 손익계산서 수집 자료가 없습니다.</div>';
    html+=`<div class="finance-disclaimer">종가 기준일 ${normalDate(q?.quote_date)} · 재무정보 갱신 ${financials?.updated_at?normalDate(financials.updated_at):'—'}<br>출처: ${text(financials?.source || '재무정보 미수집')}. 일부 지표는 최근 결산연도·최근 분기 기준으로 서로 시점이 다르며, 업데이트 지연 및 회계기준 차이가 있을 수 있습니다. 투자 판단 전 원자료를 확인하세요.</div>`;
    const sourceUrl=h.currency==='KRW'&&/^\d{6}\.(KS|KQ)$/.test(symbol)?'https://m.stock.naver.com/domestic/stock/'+symbol.slice(0,6)+'/finance':'https://finance.yahoo.com/quote/'+encodeURIComponent(symbol)+'/financials/';
    html+=`<a class="finance-link" href="${sourceUrl}" target="_blank" rel="noopener noreferrer">재무정보 원문 확인 ↗</a>`;
    $('detailBody').innerHTML=html;
    $('detailDrawer').classList.add('open');$('detailBackdrop').classList.add('open');
    $('detailDrawer').setAttribute('aria-hidden','false');$('detailBackdrop').setAttribute('aria-hidden','false');
  }
  function closeDetail(){$('detailDrawer').classList.remove('open');$('detailBackdrop').classList.remove('open');$('detailDrawer').setAttribute('aria-hidden','true');$('detailBackdrop').setAttribute('aria-hidden','true');}
  function addDemo(){
    if(holdings.length && !confirm('예시 종목 2개를 추가할까요? 기존 보유 종목은 유지됩니다.'))return;
    const data=[{symbol:'005930.KS',avg:80000,qty:2},{symbol:'NVDA',avg:145,qty:2,purchaseFx:null}];
    data.forEach(d=>{const k=known.get(d.symbol);if(k&&!holdings.some(h=>h.symbol===d.symbol))holdings.push(normalizeHolding({...k,...d}));});
    save();render();toast('예시 보유 종목 2개를 추가했습니다. 가격은 데이터 수집 후 표시됩니다.');
  }
  function initEvents(){
    document.querySelectorAll('[data-target]').forEach(btn=>btn.addEventListener('click',()=>{
      const dest=btn.dataset.target;$(dest)?.scrollIntoView({behavior:'smooth',block:'start'});
      document.querySelectorAll('[data-target]').forEach(x=>x.classList.toggle('active',x===btn));
      $('sidebar').classList.remove('mobile-open');
    }));
    $('mobileMenu').addEventListener('click',()=>$('sidebar').classList.toggle('mobile-open'));
    [$('addHolding'),$('headerAdd')].forEach(x=>x.addEventListener('click',()=>openModal()));
    $('holdingForm').addEventListener('submit',submitHolding);
    document.querySelectorAll('[data-close="modal"]').forEach(x=>x.addEventListener('click',closeModal));
    $('holdingModal').addEventListener('click',e=>{if(e.target===$('holdingModal'))closeModal();});
    $('stockQuery').addEventListener('input',()=>{chosen=null;showSuggestions();});
    $('stockQuery').addEventListener('focus',showSuggestions);
    $('stockQuery').addEventListener('blur',()=>setTimeout(()=>$('stockSuggestions').hidden=true,160));
    $('stockSuggestions').addEventListener('mousedown',e=>e.preventDefault());
    $('stockSuggestions').addEventListener('click',e=>{const b=e.target.closest('[data-pick]');if(b){const c=known.get(b.dataset.pick);if(c)selectCompany(c);}});
    $('stockSymbol').addEventListener('input',updateTrackingWarning);
    $('stockCurrency').addEventListener('change',updateFxField);
    $('regionFilter').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;document.querySelectorAll('#regionFilter button').forEach(x=>x.classList.toggle('on',x===b));renderHoldings(calc());});
    $('holdingsSearch').addEventListener('input',e=>{query=e.target.value.trim().toLowerCase();renderHoldings(calc());});
    $('holdingsTbody').addEventListener('click',e=>{
      const detail=e.target.closest('[data-detail]');const edit=e.target.closest('[data-edit]');const del=e.target.closest('[data-delete]');
      if(detail)openDetail(detail.dataset.detail);
      if(edit)openModal(holdings.find(h=>h.symbol===edit.dataset.edit));
      if(del)removeHolding(del.dataset.delete);
      if(e.target.closest('[data-demo]'))addDemo();
    });
    $('downloadCsv').addEventListener('click',exportCsv);
    $('backupExport').addEventListener('click',exportBackup);
    $('backupImportBtn').addEventListener('click',()=>$('backupImport').click());
    $('backupImport').addEventListener('change',importBackup);
    $('closeDetail').addEventListener('click',closeDetail);
    $('detailBackdrop').addEventListener('click',closeDetail);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();closeDetail();}});
  }
  holdings=safeRead();initEvents();renderMarket();render();
  // Expose a tiny, read-only debug snapshot for QA (never exports private state to a server).
  window.FOLIO_APP = {openDetail, getHoldings:()=>holdings.map(h=>({...h})),calc};
  window.FOLIO_QA = {summary:()=>{const a=calc();return {totalCost:a.totalCost,totalValue:a.totalValue,totalPnl:a.totalPnl,totalRet:a.totalRet,priceMissing:a.priceMissing};},catalogCount:catalog.length};
})();
