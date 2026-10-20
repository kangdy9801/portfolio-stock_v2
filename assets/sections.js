/* FOLIO v2: peer-group valuation research and browser-only long-term goal tracking */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const catalog = Array.isArray(window.FOLIO_CATALOG) ? window.FOLIO_CATALOG : [];
  const market = window.FOLIO_MARKET || {stocks:{},fx:null};
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const intf = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
  const onef = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:1});
  const decimalf = new Intl.NumberFormat('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pricef = (n,c) => !finite(n)?'—':c==='USD'?'$'+decimalf.format(n):intf.format(n)+'원';
  const won = n => finite(n)?intf.format(Math.round(n))+'원':'—';
  const percent = n => finite(n)?(n*100).toFixed(1)+'%':'—';
  const numeric = n => finite(n)?Number(n).toFixed(2):'—';
  const date = n => n?String(n).slice(0,10).replace(/-/g,'.'):'—';
  const fundamentals = c => (market.stocks || {})[c.symbol]?.fundamentals || null;
  const values = c => fundamentals(c)?.metrics || {};
  const metricLabels = {
    pe:{name:'PER', long:'주가수익비율', expl:'주가가 한 해 순이익의 몇 배인지 보는 지표입니다. 적자기업의 PER은 비교에 적합하지 않습니다.',unit:'배'},
    pb:{name:'PBR', long:'주가순자산비율', expl:'순자산 대비 주가 수준입니다. 산업별 자산구조와 회계상 장부가의 차이를 고려해야 합니다.',unit:'배'},
    roe:{name:'ROE', long:'자기자본이익률', expl:'주주 자기자본으로 얼마나 순이익을 냈는지 나타냅니다. 부채비율과 일회성 손익도 함께 확인해야 합니다.',unit:'%'},
    profit_margin:{name:'순이익률', long:'매출 대비 순이익', expl:'매출에서 최종적으로 남은 이익의 비중입니다. 적자 기업은 음수로 표시합니다.',unit:'%'}
  };
  const metricValid = (key,v) => finite(v) && (['pe','pb'].includes(key) ? v>0 : true);
  const valFormat = (key,v) => !metricValid(key,v)?'—':['roe','profit_margin'].includes(key) ? (v*100).toFixed(1)+'%' : v.toFixed(2)+'배';
  function shortMoney(n,c='KRW') {
    if(!finite(n))return '—';
    const sign=n<0?'−':'';const v=Math.abs(n);
    if(c==='USD')return sign+'$'+(v>=1e12?(v/1e12).toFixed(2)+'T':v>=1e9?(v/1e9).toFixed(2)+'B':v>=1e6?(v/1e6).toFixed(1)+'M':intf.format(v));
    return sign+(v>=1e12?(v/1e12).toFixed(2)+'조':v>=1e8?(v/1e8).toFixed(2)+'억':v>=1e4?(v/1e4).toFixed(1)+'만':intf.format(v))+'원';
  }
  function median(arr) {
    const x=arr.slice().sort((a,b)=>a-b);if(!x.length)return null;
    const k=Math.floor(x.length/2);return x.length%2?x[k]:(x[k-1]+x[k])/2;
  }
  function myToast(msg) {
    const el=$('toast');if(!el)return;
    el.textContent=msg;el.classList.add('visible');
    clearTimeout(myToast.timer);myToast.timer=setTimeout(()=>el.classList.remove('visible'),3400);
  }

  // -------- 3-tab navigation --------
  const pages=['portfolio','sector','projects','reports'];
  function pageFromHash(){
    const hash=(location.hash||'').replace(/^#/,'');
    if(pages.includes(hash))return hash;
    return 'portfolio';
  }
  function navigate(page,fromHash=false){
    if(!pages.includes(page))page='portfolio';
    pages.forEach(p=>{const el=$('page-'+p);el.hidden=p!==page;el.classList.toggle('active',p===page);});
    document.querySelectorAll('.nav [data-page]').forEach(node=>{
      const active=node.dataset.page===page;
      node.classList.toggle('active',active);
      if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
    });
    const names={portfolio:'나의 포트폴리오',sector:'섹터 비교 · 재무제표',projects:'장기 프로젝트',reports:'수출입 · 산업 분석'};
    $('activePageName').textContent=names[page];
    $('headerAdd').hidden=page!=='portfolio';
    $('sidebar').classList.remove('mobile-open');
    if(!fromHash&&location.hash!=='#'+page){location.hash=page;}
    if(page==='sector')renderSector();
    if(page==='projects')renderProjects();
    if(page==='reports')window.FOLIO_MACRO_UI?.renderReports?.();
    window.scrollTo({top:0,behavior:'instant'});
  }

  // -------- Sector research --------
  const companies=catalog.filter(c=>c.kind==='STOCK' && ['KR','US'].includes(c.market));
  let sectorMarket='KR';let sectorName='반도체';let sectorMetric='pe';let sectorSort='name';
  function sectorCompanies(){return companies.filter(c=>c.market===sectorMarket && c.sector===sectorName);}
  function setSectors(){
    const sectors=[...new Set(companies.filter(c=>c.market===sectorMarket).map(c=>c.sector))].sort((a,b)=>a.localeCompare(b,'ko'));
    if(!sectors.includes(sectorName))sectorName=sectors.includes('반도체')?'반도체':sectors[0]||'';
    $('sectorSelect').innerHTML=sectors.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    $('sectorSelect').value=sectorName;
  }
  function sortCompanies(a,b){
    const data=key=>c=>metricValid(key,values(c)[key])?values(c)[key]:null;
    let sortKey=null,direction=1;
    if(sectorSort==='pe_asc'){sortKey='pe';}
    if(sectorSort==='pb_asc'){sortKey='pb';}
    if(sectorSort==='roe_desc'){sortKey='roe';direction=-1;}
    if(sectorSort==='revenue_desc'){sortKey='revenue';direction=-1;}
    if(sectorSort==='profit_desc'){sortKey='net_income';direction=-1;}
    if(!sortKey)return a.name.localeCompare(b.name,'ko');
    const get=sortKey==='net_income'||sortKey==='revenue'?c=>(finite(values(c)[sortKey])?values(c)[sortKey]:null):data(sortKey);
    const va=get(a),vb=get(b);
    if(va===null)return vb===null?a.name.localeCompare(b.name,'ko'):1;
    if(vb===null)return -1;
    return (va-vb)*direction || a.name.localeCompare(b.name,'ko');
  }
  function renderSectorOverview(){
    const grouped=new Map();
    companies.filter(c=>c.market===sectorMarket).forEach(c=>{
      if(!grouped.has(c.sector))grouped.set(c.sector,[]);
      grouped.get(c.sector).push(c);
    });
    const rows=[...grouped.entries()].map(([sector,cs])=>{
      const med={};const count={};
      for(const key of Object.keys(metricLabels)){
        const observations=cs.map(c=>values(c)[key]).filter(v=>metricValid(key,v));
        med[key]=median(observations);count[key]=observations.length;
      }
      return {sector,total:cs.length,med,count};
    });
    $('sectorMapMetricLabel').textContent=metricLabels[sectorMetric].name+' MEDIAN';
    const metric=sectorMetric;
    const eligible=rows.filter(r=>r.count[metric]>=2);
    // Only a single company in a sector is not a meaningful peer median.
    const sorted=eligible.sort((a,b)=> ['pe','pb'].includes(metric) ? a.med[metric]-b.med[metric] : b.med[metric]-a.med[metric]).slice(0,7);
    const max=Math.max(...sorted.map(r=>Math.abs(r.med[metric])),.0001);
    $('sectorOverviewBars').innerHTML=sorted.length?sorted.map(row=>`<div class="sector-map-bar"><button type="button" class="sector-map-name" data-sector-choose="${esc(row.sector)}" title="${esc(row.sector)} 섹터 비교하기">${esc(row.sector)}</button><div class="sector-map-track"><div class="sector-map-fill ${row.sector===sectorName?'selected':''} ${row.med[metric]<0?'negative':''}" style="width:${Math.max(3,Math.abs(row.med[metric])/max*100).toFixed(2)}%"></div></div><span class="sector-map-value ${row.med[metric]<0?'negative':''}">${valFormat(metric,row.med[metric])}</span></div>`).join(''):'<div class="empty-helper">유효한 데이터가 2개 이상인 섹터가 아직 없습니다.<br>재무정보가 순차 수집되면 비교할 수 있습니다.</div>';
    const ranked=rows.sort((a,b)=>b.count[metric]-a.count[metric] || a.sector.localeCompare(b.sector,'ko'));
    $('sectorOverviewTbody').innerHTML=ranked.map(row=>`<tr class="${row.sector===sectorName?'selected':''}"><td><button type="button" data-sector-choose="${esc(row.sector)}">${esc(row.sector)}</button></td><td class="num">${row.total}</td><td class="num">${valFormat('pe',row.med.pe)}</td><td class="num">${valFormat('pb',row.med.pb)}</td><td class="num">${valFormat('roe',row.med.roe)}</td><td class="num ${row.count[metric]<2?'thin-data':''}">${row.count[metric]}${row.count[metric]===1?' · 참고':''}</td></tr>`).join('');
  }
  function renderSector(){
    const all=sectorCompanies();
    const filled=all.filter(c=>Object.entries(values(c)).some(([k,v])=>['pe','pb','roe','net_income','revenue'].includes(k)&&finite(v)));
    $('sectorPeerCount').textContent=intf.format(all.length)+'개';
    $('peerTableCount').textContent=all.length;
    const dates=filled.map(c=>fundamentals(c)?.updated_at).filter(Boolean).sort();
    $('sectorAsOf').textContent=dates.length?date(dates.at(-1)):'미수집';
    $('sectorCoveragePct').textContent=all.length?(filled.length/all.length*100).toFixed(0)+'%':'—';
    $('sectorCoverageCount').textContent=`${all.length}개 기업 중 ${filled.length}개 수집`;
    $('sectorCoverage').textContent=all.length?
      `${sectorMarket==='KR'?'한국':'미국'} · ${sectorName} 기업 ${all.length}개 중 재무정보 ${filled.length}개 수집. 최신 데이터가 없으면 —로 표시됩니다. ETF는 제외됩니다.` : '비교 가능한 기업이 없습니다.';
    for(const [metric,id,countid] of [['pe','medianPe','medianPeCount'],['pb','medianPb','medianPbCount'],['roe','medianRoe','medianRoeCount']]){
      const data=all.map(c=>values(c)[metric]).filter(v=>metricValid(metric,v));
      $(id).textContent=valFormat(metric,median(data));
      $(countid).textContent=`유효 데이터 ${data.length}개 기준 · 단순 중앙값`;
    }
    const selected=metricLabels[sectorMetric];
    $('metricChartTitle').textContent=selected.name+' · 기업별 비교';
    $('metricChartSubtitle').textContent=`${sectorMarket==='KR'?'한국':'미국'} / ${sectorName} · ${selected.long}`;
    $('sectorMetricGuide').innerHTML=`<span>KEY METRIC</span><strong>${esc(selected.name)}</strong><p>${esc(selected.expl)}</p>`;
    const points=all.map(c=>({c,value:values(c)[sectorMetric]})).filter(x=>metricValid(sectorMetric,x.value));
    const chartPoints=points.sort((a,b)=>['pe','pb'].includes(sectorMetric)?a.value-b.value:b.value-a.value).slice(0,8);
    const maxAbs=Math.max(...chartPoints.map(x=>Math.abs(x.value)),.00001);
    $('sectorBars').innerHTML=chartPoints.length?chartPoints.map(({c,value})=>{
      const w=Math.max(2,Math.abs(value)/maxAbs*100);
      return `<div class="sector-bar-row"><button class="sector-bar-label" type="button" data-sector-detail="${esc(c.symbol)}" title="${esc(c.name)} 재무제표 열기">${esc(c.name)}</button><div class="sector-bar-track"><span class="sector-bar-fill ${value<0?'negative':''}" style="width:${w.toFixed(2)}%"></span></div><strong class="sector-bar-value ${value<0?'negative':''}">${esc(valFormat(sectorMetric,value))}</strong></div>`;
    }).join(''):'<div class="empty-helper">이 섹터의 '+esc(selected.name)+' 데이터가 아직 없습니다.<br>GitHub Actions에서 재무정보를 수집하면 자동 표시됩니다.</div>';
    $('sectorBarNote').textContent=`유효 데이터 ${points.length}/${all.length}개 기업${points.length>8?' · 그래프는 8개만 표시':''} · 유효한 PER/PBR은 양수만 포함 · 기업명을 누르면 상세 분석`;
    const count=points.length;
    const midpoint=median(points.map(p=>p.value));
    $('sectorInsight').textContent=count>=2 ?
      `${sectorName} 업종의 ${selected.name} 중앙값은 ${valFormat(sectorMetric,midpoint)}입니다. 동일 업종 ${count}개 유효 기업의 단순 중앙값으로, 시가총액 가중 평균은 아닙니다.`:
      `${sectorName} 업종의 ${selected.name} 지표가 ${count? '1개뿐이어서 동종업계 통계를 해석하기 어렵습니다.':'아직 없어 상대가치 분석을 제공할 수 없습니다.'}`;
    renderSectorOverview();
    const ordered=all.slice().sort(sortCompanies);
    $('sectorTbody').innerHTML=ordered.length?ordered.map(c=>{
      const q=(market.stocks||{})[c.symbol]||{};const m=values(c),fi=fundamentals(c);
      const t=(key,opts={})=>metricValid(key,m[key])?`<span class="${opts.tone&&m[key]<0?'negative-value':''}">${esc(valFormat(key,m[key]))}</span>`:'<span class="muted-value">—</span>';
      return `<tr><td><button type="button" class="stock-name-button" data-sector-detail="${esc(c.symbol)}">${esc(c.name)}</button><span class="stock-minor">${esc(c.sector)}</span><span class="ticker-badge">${esc(c.display)}</span></td><td class="num">${pricef(q.price,c.currency)}</td><td class="num">${t('pe')}</td><td class="num">${t('pb')}</td><td class="num">${t('roe',{tone:true})}</td><td class="num">${pricef(m.eps,c.currency)}</td><td class="num">${shortMoney(m.revenue,c.currency)}</td><td class="num ${finite(m.net_income)&&m.net_income<0?'negative-value':''}">${shortMoney(m.net_income,c.currency)}</td><td class="num date-value">${date(fi?.updated_at)}</td></tr>`;
    }).join(''):'<tr><td colspan="9" class="empty-table">이 시장에 등록된 비교 기업이 없습니다.</td></tr>';
  }

  // -------- Long-term projects --------
  const STORE='folio_longterm_projects_v1';
  function currentMonth(){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(new Date());
    const year=parts.find(p=>p.type==='year')?.value;
    const month=parts.find(p=>p.type==='month')?.value;
    return `${year}-${month}`;
  }
  function monthOk(s){return typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(s);}
  function monthShift(s,delta){const [y,m]=s.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');}
  function monthsUntil(s){if(!monthOk(s))return 0;const [y,m]=s.split('-').map(Number),[cy,cm]=currentMonth().split('-').map(Number);return (y-cy)*12+(m-cm)+1;}
  const validAmount=n=>finite(Number(n))&&Number(n)>=0&&Number(n)<=1e16;
  const validEntry=e=>e&&typeof e.id==='string'&&e.id.length<100&&monthOk(e.month)&&validAmount(e.amount)&&Number(e.amount)>0&&typeof e.note==='string';
  function validProject(p){
    return p&&typeof p.id==='string'&&p.id.length<100&&typeof p.name==='string'&&p.name.trim().length>0&&p.name.length<=65&&
      validAmount(p.target)&&Number(p.target)>0&&validAmount(p.monthly||0)&&monthOk(p.deadline)&&monthOk(p.start)&&
      typeof (p.note||'')==='string'&&Array.isArray(p.entries)&&p.entries.length<=1200&&p.entries.every(validEntry)&&
      Array.isArray(p.symbols||[])&&(p.symbols||[]).every(s=>typeof s==='string'&&/^[A-Z0-9.^=\-]{1,28}$/.test(s));
  }
  const normalizeProject=p=>({id:p.id,name:p.name.trim().slice(0,65),target:Number(p.target),monthly:Number(p.monthly||0),deadline:p.deadline,start:p.start,note:String(p.note||'').slice(0,250),symbols:(p.symbols||[]).slice(0,25),entries:p.entries.map(e=>({id:e.id,month:e.month,amount:Number(e.amount),note:e.note.slice(0,100)}))});
  let projects=[];let selectedProject=null;let editingProject=null;
  function getProjects(){try{const data=JSON.parse(localStorage.getItem(STORE)||'[]');return Array.isArray(data)?data.filter(validProject).map(normalizeProject):[];}catch(e){console.warn('Projects storage unavailable',e);return [];}}
  function saveProjects(){try{localStorage.setItem(STORE,JSON.stringify(projects));return true;}catch(e){myToast('브라우저 저장에 실패했습니다. 저장공간을 확인하세요.');return false;}}
  const safeCopy=records=>JSON.parse(JSON.stringify(records));
  const exportProjects=()=>safeCopy(projects);
  const validProjectsExport=data=>Array.isArray(data)&&data.length<=100&&data.every(validProject)&&new Set(data.map(p=>p.id)).size===data.length;
  function importProjects(records){if(!validProjectsExport(records))throw new Error('장기 프로젝트 백업 형식에 오류가 있습니다.');projects=records.map(normalizeProject);selectedProject=null;saveProjects();renderProjects();}
  const sums=p=>p.entries.reduce((sum,e)=>sum+e.amount,0);
  const projectById=id=>projects.find(p=>p.id===id);
  const keyId=()=>typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function'?crypto.randomUUID():'goal-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  function linkedValue(p){
    if(!p.symbols.length)return null;
    const holdingList=window.FOLIO_APP?.getHoldings?.()||[];
    let value=0,matched=0,priced=0;
    for(const symbol of p.symbols){
      const holding=holdingList.find(h=>h.symbol===symbol);if(!holding)continue;
      matched++;const q=(market.stocks||{})[symbol];const rate=holding.currency==='USD'?market.fx?.rate:1;
      if(!finite(q?.price)||q.price<=0||!finite(rate)||rate<=0)continue;
      priced++;value+=q.price*holding.qty*rate;
    }
    return {value,matched,priced};
  }
  function renderProjects(){
    const target=projects.reduce((a,p)=>a+p.target,0);
    const invested=projects.reduce((a,p)=>a+sums(p),0);
    $('projectTotalTarget').textContent=projects.length?won(target):'—';
    $('projectTotalInvested').textContent=projects.length?won(invested):'—';
    $('projectTotalRemaining').textContent=projects.length?won(projects.reduce((a,p)=>a+Math.max(0,p.target-sums(p)),0)):'—';
    $('projectTotalCount').textContent=projects.length+'개';
    const grid=$('projectGrid');
    if(!projects.length){
      grid.innerHTML='<div class="projects-empty"><div class="empty-icon">◎</div><h3>첫 번째 장기 프로젝트를 만들어보세요.</h3><p>10년 투자, 목돈 마련, 배당금 목표 등<br>프로젝트별 목표와 투자 내역을 기록할 수 있습니다.</p><button id="emptyCreateProject" class="primary-btn" type="button">+ 장기 목표 만들기</button></div>';
      $('projectDetailPanel').hidden=true;return;
    }
    if(!projectById(selectedProject))selectedProject=projects[0].id;
    grid.innerHTML=projects.map(p=>{
      const invested=sums(p),ratio=Math.min(100,invested/p.target*100),left=Math.max(0,p.target-invested),fx=linkedValue(p);
      const linked = !fx?'연결 종목 없음':!fx.matched?'연결된 보유 종목 없음':!fx.priced?'연결 종목 시세 미수집':
        `연결 종목 평가액 ${won(fx.value)}${fx.priced<fx.matched?' (일부)':''}`;
      const months=monthsUntil(p.deadline);
      return `<article class="project-card ${selectedProject===p.id?'selected':''}"><div class="project-card-top"><div class="project-card-head"><div class="project-icon">◎</div><div><strong title="${esc(p.name)}">${esc(p.name)}</strong><small>${esc(p.start)} 시작 · ${esc(p.deadline)} 목표</small></div></div><span class="project-card-tag">${invested>=p.target?'원금 목표 도달':months<=0?'목표 시점 경과':months+'개월 남음'}</span></div>
      <div class="project-money-row"><div><strong>${won(invested)}</strong><span>누적 납입 원금 / 목표 ${won(p.target)}</span></div><strong>${ratio.toFixed(1)}%</strong></div>
      <div class="project-progress-track" role="progressbar" aria-label="${esc(p.name)} 납입 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ratio.toFixed(1)}"><div class="project-progress-fill" style="width:${ratio.toFixed(2)}%"></div></div>
      <div class="project-mini-stats"><div><span>목표까지 남은 원금</span><strong>${won(left)}</strong></div><div><span>매월 목표 납입액</span><strong>${won(p.monthly)}</strong></div><div><span>보유 종목 연계</span><strong style="font-size:10px;max-width:190px">${esc(linked)}</strong></div></div>
      ${p.note?`<p class="project-card-note">${esc(p.note)}</p>`:''}
      <div class="project-card-actions"><button class="project-link" type="button" data-project-select="${esc(p.id)}">${selectedProject===p.id?'투자 기록 보고 있는 중':'투자 기록 · 월별 현황 보기'} ↗</button><div class="project-action-group"><button type="button" data-project-edit="${esc(p.id)}" title="목표 수정">수정</button><button type="button" data-project-delete="${esc(p.id)}" title="프로젝트 삭제">삭제</button></div></div></article>`;
    }).join('');
    showProjectDetails();
  }
  function showProjectDetails(){
    const p=projectById(selectedProject), panel=$('projectDetailPanel');panel.hidden=!p;if(!p)return;
    $('projectDetailName').textContent=p.name+' · 월별 투자 기록';
    $('projectDetailSubtitle').textContent=`목표 ${won(p.target)} · ${p.deadline}까지 · 월 납입 목표 ${won(p.monthly)}`;
    const months=Array.from({length:12},(_,i)=>monthShift(currentMonth(),i-11));
    const amountByMonth=new Map(months.map(m=>[m,0]));
    p.entries.forEach(e=>{if(amountByMonth.has(e.month))amountByMonth.set(e.month,amountByMonth.get(e.month)+e.amount);});
    const max=Math.max(p.monthly,...amountByMonth.values(),1);
    $('projectMonthlyChart').innerHTML=months.map(month=>{
      const v=amountByMonth.get(month),height=v?Math.max(3,v/max*100):1;
      return `<div class="monthly-col" title="${month} · ${won(v)}"><div class="bar-area"><span class="bar-shape" style="height:${Math.min(100,height).toFixed(1)}%;background:${v>=p.monthly&&p.monthly>0?'#238f74':'#8acbb5'}"></span></div><span>${Number(month.slice(5))}월</span></div>`;
    }).join('');
    const rem=Math.max(0,p.target-sums(p)),monthsLeft=monthsUntil(p.deadline);
    let msg=rem===0?'납입 원금 기준 목표에 도달했습니다. 실제 자산 평가금액과는 별개입니다.':
      monthsLeft<=0?'목표 시점이 경과했습니다. 목표 시점이나 투자 계획을 수정해 주세요.':
      `목표 원금까지 ${won(rem)} 남았습니다. 마감 월을 포함한 ${monthsLeft}개월 동안 매월 약 ${won(Math.ceil(rem/monthsLeft))}씩 납입해야 합니다 (수익률 0% 가정).`;
    if(rem>0&&monthsLeft>0&&p.monthly>0){const needed=Math.ceil(rem/monthsLeft);msg+=p.monthly<needed?' 현재 월별 계획보다 더 많은 납입이 필요합니다.':' 현재 월별 납입 계획으로 원금 기준 목표 달성을 기대할 수 있습니다.';}
    $('projectRequired').textContent=msg;
    const entries=p.entries.slice().sort((a,b)=>b.month.localeCompare(a.month));
    $('projectEntries').innerHTML=entries.length?entries.map(e=>`<tr><td>${esc(e.month)}</td><td class="num"><strong>${won(e.amount)}</strong></td><td title="${esc(e.note)}">${esc(e.note||'—')}</td><td><button type="button" data-entry-delete="${esc(e.id)}" aria-label="투자 기록 삭제">×</button></td></tr>`).join(''):'<tr><td colspan="4" class="empty-helper">아직 투자 기록이 없습니다. + 투자액 기록을 눌러 시작하세요.</td></tr>';
  }
  function closePopup(id){$(id).classList.remove('open');$(id).setAttribute('aria-hidden','true');}
  function openProject(p=null){
    editingProject=p?.id||null;
    $('projectForm').reset();$('projectModalTitle').textContent=p?'장기 프로젝트 수정':'장기 프로젝트 만들기';
    if(p){$('projectName').value=p.name;$('projectTarget').value=p.target;$('projectMonthly').value=p.monthly;
      $('projectDeadline').value=p.deadline;$('projectStart').value=p.start;$('projectSymbols').value=p.symbols.join(', ');$('projectMemo').value=p.note;}
    else{$('projectStart').value=currentMonth();$('projectDeadline').value=monthShift(currentMonth(),120);}
    $('projectModal').classList.add('open');$('projectModal').setAttribute('aria-hidden','false');$('projectName').focus();
  }
  function saveProject(ev){
    ev.preventDefault();const name=$('projectName').value.trim();const target=Number($('projectTarget').value);
    const monthly=Number($('projectMonthly').value||0),deadline=$('projectDeadline').value,start=$('projectStart').value||currentMonth();
    if(!name||name.length>65||!validAmount(target)||target<=0||!validAmount(monthly)||!monthOk(deadline)||!monthOk(start)||deadline<start){myToast('프로젝트 이름·금액·목표 시점을 확인하세요.');return;}
    const symbols=[...new Set($('projectSymbols').value.split(/[,;\n]+/).map(s=>s.trim().toUpperCase()).filter(Boolean))];
    if(symbols.length>25||symbols.some(s=>!/^[A-Z0-9.^=\-]{1,28}$/.test(s))){myToast('연결 종목은 티커 코드 25개 이하로 입력하세요.');return;}
    if(!editingProject&&projects.length>=100){myToast('프로젝트는 최대 100개까지 지원합니다.');return;}
    const old=projectById(editingProject);
    const p={id:old?.id||keyId(),name,target,monthly,deadline,start,note:$('projectMemo').value.trim().slice(0,250),symbols,entries:old?.entries||[]};
    if(old)projects=projects.map(x=>x.id===old.id?p:x);else projects.push(p);
    selectedProject=p.id;saveProjects();closePopup('projectModal');renderProjects();myToast(old?'프로젝트를 수정했습니다.':'장기 프로젝트를 만들었습니다.');
  }
  function openEntry(){
    if(!projectById(selectedProject))return;
    $('entryForm').reset();$('entryMonth').value=currentMonth();
    $('entryModal').classList.add('open');$('entryModal').setAttribute('aria-hidden','false');$('entryAmount').focus();
  }
  function saveEntry(ev){
    ev.preventDefault();const p=projectById(selectedProject);if(!p)return;
    const month=$('entryMonth').value,amount=Number($('entryAmount').value),note=$('entryMemo').value.trim().slice(0,100);
    if(!monthOk(month)||month>currentMonth()||month<p.start||!validAmount(amount)||amount<=0){myToast('프로젝트 시작 이후, 현재 월까지의 실제 납입 금액만 기록할 수 있습니다.');return;}
    if(p.entries.length>=1200){myToast('한 프로젝트에서 등록 가능한 투자 기록 수를 초과했습니다.');return;}
    p.entries.push({id:keyId(),month,amount,note});saveProjects();closePopup('entryModal');renderProjects();myToast('투자 원금을 기록했습니다.');
  }
  function deleteEntry(id){
    const p=projectById(selectedProject);if(!p)return;
    if(!confirm('이 납입 기록을 삭제할까요?'))return;
    p.entries=p.entries.filter(e=>e.id!==id);saveProjects();renderProjects();myToast('투자 기록을 삭제했습니다.');
  }
  function deleteProject(id){
    const p=projectById(id);if(!p)return;
    if(!confirm(`${p.name} 프로젝트와 기록 ${p.entries.length}건을 삭제할까요? 삭제 후에는 JSON 백업 없이 복구할 수 없습니다.`))return;
    projects=projects.filter(x=>x.id!==id);selectedProject=projects[0]?.id||null;saveProjects();renderProjects();myToast('장기 프로젝트를 삭제했습니다.');
  }
  function init(){
    document.querySelectorAll('.nav [data-page]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.page)));
    $('sectorMarket').addEventListener('change',e=>{sectorMarket=e.target.value;setSectors();renderSector();});
    $('sectorSelect').addEventListener('change',e=>{sectorName=e.target.value;renderSector();});
    $('sectorMetric').addEventListener('change',e=>{sectorMetric=e.target.value;renderSector();});
    $('sectorSort').addEventListener('change',e=>{sectorSort=e.target.value;renderSector();});
    for(const id of ['sectorOverviewBars','sectorOverviewTbody'])$(id).addEventListener('click',e=>{
      const el=e.target.closest('[data-sector-choose]');if(!el)return;
      sectorName=el.dataset.sectorChoose;$('sectorSelect').value=sectorName;renderSector();
      $('page-sector').scrollIntoView({behavior:'smooth',block:'start'});
    });
    for(const id of ['sectorBars','sectorTbody'])$(id).addEventListener('click',e=>{
      const el=e.target.closest('[data-sector-detail]');if(el)window.FOLIO_APP?.openDetail?.(el.dataset.sectorDetail);
    });
    for(const id of ['addProject','addProjectInline'])$(id).addEventListener('click',()=>openProject());
    $('projectGrid').addEventListener('click',e=>{
      if(e.target.closest('#emptyCreateProject')){openProject();return;}
      const edit=e.target.closest('[data-project-edit]'),del=e.target.closest('[data-project-delete]'),sel=e.target.closest('[data-project-select]');
      if(edit){openProject(projectById(edit.dataset.projectEdit));return;}
      if(del){deleteProject(del.dataset.projectDelete);return;}
      if(sel){selectedProject=sel.dataset.projectSelect;renderProjects();$('projectDetailPanel').scrollIntoView({behavior:'smooth',block:'start'});}
    });
    $('editSelectedProject').addEventListener('click',()=>openProject(projectById(selectedProject)));
    $('addContribution').addEventListener('click',openEntry);
    $('projectForm').addEventListener('submit',saveProject);
    $('entryForm').addEventListener('submit',saveEntry);
    $('projectEntries').addEventListener('click',e=>{const el=e.target.closest('[data-entry-delete]');if(el)deleteEntry(el.dataset.entryDelete);});
    document.querySelectorAll('[data-project-close]').forEach(el=>el.addEventListener('click',()=>closePopup('projectModal')));
    document.querySelectorAll('[data-entry-close]').forEach(el=>el.addEventListener('click',()=>closePopup('entryModal')));
    for(const id of ['projectModal','entryModal'])$(id).addEventListener('click',e=>{if(e.target===$(id))closePopup(id);});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePopup('projectModal');closePopup('entryModal');}});
    window.addEventListener('hashchange',()=>navigate(pageFromHash(),true));
    window.addEventListener('folio:portfolio-updated',()=>{if(!$('.tab-page.active')||!$('page-projects').hidden)renderProjects();});
    sectorMarket=$('sectorMarket').value;
    setSectors();projects=getProjects();
    navigate(pageFromHash(),true);
  }
  window.FOLIO_PROJECTS={exportRecords:exportProjects,validateRecords:validProjectsExport,importRecords:importProjects,stats:()=>({count:projects.length,target:projects.reduce((a,p)=>a+p.target,0),invested:projects.reduce((a,p)=>a+sums(p),0)}),sectorMedian:median};
  init();
})();
