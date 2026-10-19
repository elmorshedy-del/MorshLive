/* KoraZero Match Intelligence — sourced data only. No player/stream calls. */
(function () {
  "use strict";
  const root = document.getElementById("kz-match-intelligence");
  if (!root) return;
  const strings = {
    ar: { title:"نبض المباراة", lead:"اكتشف ما وراء النتيجة: تغيّر الأهداف، الإحصائيات، والزخم الحقيقي إن كان متاحاً.", pick:"اختر المباراة", live:"مباشر", ended:"منتهية", flow:"تطور النتيجة", stats:"إحصائيات المباراة", momentum:"زخم المباراة", unavailable:"غير متاح حتى يتم تفعيل مصدر Sportradar Extended وربط المباراة", prob:"احتمالات الفوز", probNote:"تحتاج هذه الميزة إلى حزمة Sportradar Probabilities. لا نعرض أرقاماً تقديرية.", hint:"حرّك الدقيقة لاستعراض الأهداف المسجلة. الإحصائيات أحدث إجماليات متاحة، وليست تاريخاً عند الدقيقة المحددة.", pos:"الاستحواذ", shots:"التسديدات", target:"على المرمى", corners:"الركنيات", missing:"لا تتوفر إحصائيات", events:"الأحداث المؤكدة", empty:"لا أحداث متاحة عند هذه الدقيقة", source:"المصدر: ESPN", coverage:"زخم Sportradar موثّق", current:"حتى الدقيقة" },
    en: { title:"Inside the match", lead:"Beyond the scoreboard: real score progression, team stats, and provider momentum when available.", pick:"Choose a match", live:"Live", ended:"Final", flow:"Score progression", stats:"Match statistics", momentum:"Match momentum", unavailable:"Requires authorized Sportradar Extended access and an event match ID", prob:"Win probabilities", probNote:"Requires Sportradar Probabilities. No estimated numbers are displayed.", hint:"Scrub the minute to replay confirmed goals. Match statistics show latest cumulative totals, NOT historical values at that minute.", pos:"Possession", shots:"Shots", target:"On target", corners:"Corners", missing:"Detailed stats unavailable", events:"Verified events", empty:"No recorded events through this minute", source:"Source: ESPN", coverage:"Sportradar reported momentum", current:"Through minute" }
  };
  const state={matches:[],id:"",minute:90,provider:null,providerKey:"",providerAt:0};
  const E=(tag,cls,content)=>{
    const e=document.createElement(tag);
    if(cls)e.className=cls;
    if(content!=null)e.textContent=content;
    return e;
  };
  const l=()=>window.I18N?.lang==="en"||document.documentElement.lang==="en"?"en":"ar";
  const t=(k)=>strings[l()][k]||k;
  const name=(s)=>window.TeamNames?.localize?.(s)||String(s||"");
  const min=(s)=>{const m=/^(\d{1,3})(?:\+(\d{1,2}))?/.exec(String(s||""));return m?Number(m[1])+Number(m[2]||0):null;};
  const goals=(m)=>(Array.isArray(m.goals)?m.goals:[]).map(g=>({minute:min(g.minute),side:g.side,scorer:g.scorer||""}))
    .filter(g=>g.minute!==null&&(g.side==="home"||g.side==="away")).sort((a,b)=>a.minute-b.minute);
  const N=(v)=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))?Number(v):null;
  const node={
    kicker:E("div","mi-kicker","KORAZERO / MATCH INTELLIGENCE"),
    title:E("h2","mi-title"),lead:E("p","mi-lead"),select:E("select","mi-select"),
    home:E("div","mi-team"),score:E("div","mi-score","—"),away:E("div","mi-team"),
    flowTitle:E("h3","mi-heading"),flow:E("svg","mi-flow"),minute:E("input","mi-slider"),
    minuteText:E("span","mi-minute"),eventsTitle:E("h4","mi-subtitle"),events:E("div","mi-events"),
    statsTitle:E("h3","mi-heading"),stats:E("div","mi-stats"),hint:E("p","mi-hint"),
    momentumTitle:E("h3","mi-heading"),momentum:E("div","mi-momentum"),
    probTitle:E("h3","mi-heading"),prob:E("p","mi-hint"),source:E("span","mi-source"),
  };
  node.flow.setAttribute("viewBox","0 0 600 150");
  node.flow.setAttribute("preserveAspectRatio","none");
  node.flow.setAttribute("role","img");
  node.minute.type="range";node.minute.min="0";node.minute.max="90";node.minute.step="1";node.minute.dir="ltr";
  node.select.setAttribute("aria-label","Choose a match");
  const header=E("div","mi-header"),label=E("div","mi-brand");
  const intro=E("div","mi-intro");intro.append(node.kicker,node.title,node.lead);
  header.append(intro,node.source);
  const chooser=E("div","mi-chooser");chooser.append(node.select);
  const scoreboard=E("div","mi-scoreboard");scoreboard.append(node.home,node.score,node.away);
  const timelineBox=E("div","mi-panel mi-timeline"),timelineHead=E("div","mi-panel-head");
  timelineHead.append(node.flowTitle,node.minuteText);
  const scale=E("div","mi-scale");["0′","45′","90′"].forEach(x=>scale.append(E("span",null,x)));
  timelineBox.append(timelineHead,node.flow,scale,node.minute,node.eventsTitle,node.events);
  const statBox=E("div","mi-panel");statBox.append(node.statsTitle,node.stats,node.hint);
  const panels=E("div","mi-columns");panels.append(timelineBox,statBox);
  const momentumBox=E("div","mi-panel");momentumBox.append(node.momentumTitle,node.momentum);
  const probBox=E("div","mi-panel");probBox.append(node.probTitle,node.prob);
  const bottom=E("div","mi-bottom");bottom.append(momentumBox,probBox);
  const shell=E("div","mi-shell");shell.append(header,chooser,scoreboard,panels,bottom);
  root.append(shell);

  function selected(){return state.matches.find(x=>x.id===state.id)||null;}
  function graph(m){
    const g=goals(m),max=Math.max(90,...g.map(x=>x.minute)),maxGoals=Math.max(1,g.filter(x=>x.side==="home").length,g.filter(x=>x.side==="away").length);
    node.minute.max=String(max);state.minute=Math.min(state.minute,max);node.minute.value=String(state.minute);
    node.minuteText.textContent=t("current")+" "+state.minute+"′";
    node.flow.replaceChildren();
    const svgNs="http://www.w3.org/2000/svg";
    const line=(tag,attrs)=>{const el=document.createElementNS(svgNs,tag);for(const k of Object.keys(attrs))el.setAttribute(k,attrs[k]);node.flow.append(el);};
    for(const tick of [0,1,2])line("line",{x1:24,y1:133-54*tick,x2:576,y2:133-54*tick,stroke:"#668096","stroke-opacity":".25"});
    for(const side of ["home","away"]){
      let tally=0,points=[[24,133]];
      for(const goal of g){if(goal.side!==side)continue;tally++;points.push([24+552*goal.minute/max,133-108*tally/maxGoals]);}
      points.push([576,133-108*tally/maxGoals]);
      line("polyline",{points:points.map(p=>p.join(",")).join(" "),fill:"none",stroke:side==="home"?"#61ddc1":"#f4ad6b","stroke-width":4,"stroke-linejoin":"round"});
    }
    line("line",{x1:24+552*state.minute/max,y1:12,x2:24+552*state.minute/max,y2:138,stroke:"#eaf4ff","stroke-dasharray":"5 5"});
    g.forEach(goal=>line("circle",{cx:24+552*goal.minute/max,cy:goal.side==="home"?17:33,r:5,fill:goal.side==="home"?"#61ddc1":"#f4ad6b"}));
    const h=g.filter(x=>x.minute<=state.minute&&x.side==="home").length,a=g.filter(x=>x.minute<=state.minute&&x.side==="away").length;
    const liveAt=m.status==="live"?min(m.minute):null;
    node.score.textContent=g.length?h+" : "+a:(m.status==="ended"||(liveAt!==null&&state.minute>=liveAt))?String(m.score||"—"):"—";
    node.events.replaceChildren();
    const list=(state.provider?.events?.length?state.provider.events:g.map(x=>({...x,type:"goal"})))
      .filter(x=>x.minute<=state.minute).slice(-7).reverse();
    if(!list.length)node.events.append(E("p","mi-hint",t("empty")));
    for(const e of list){
      const row=E("div","mi-event"),ico=E("span","mi-event-icon",/goal|score_change/.test(e.type)?"⚽":/card/.test(e.type)?"🟨":/shot/.test(e.type)?"↗":"•");
      row.append(ico,E("span",null,e.scorer||e.player||e.description||String(e.type||"Event").replace(/_/g," ")),E("b",null,e.minute+"′"));node.events.append(row);
    }
  }
  function stats(m){
    node.stats.replaceChildren();
    let count=0;
    for(const [key,label,unit] of [["possessionPct","pos","%"],["totalShots","shots",""],["shotsOnTarget","target",""],["wonCorners","corners",""]]){
      const h=N(m.stats?.home?.[key]),a=N(m.stats?.away?.[key]);if(h===null||a===null)continue;count++;
      const block=E("div","mi-stat"),head=E("div","mi-stat-head"),bar=E("div","mi-stat-track"),fill=E("div","mi-stat-fill");
      head.append(E("b",null,h+unit),E("span",null,t(label)),E("b",null,a+unit));
      fill.style.width=(h+a?100*h/(h+a):50)+"%";bar.append(fill);block.append(head,bar);node.stats.append(block);
    }
    if(!count)node.stats.append(E("p","mi-hint",t("missing")));
  }
  function momentum(){
    node.momentum.replaceChildren();
    const readings=state.provider?.momentum||[];
    if(readings.length<2){node.momentum.append(E("p","mi-hint",t("unavailable")));return;}
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 600 145");svg.setAttribute("preserveAspectRatio","none");svg.classList.add("mi-momentum-graph");
    const max=Math.max(90,...readings.map(x=>x.minute));
    const baseline=document.createElementNS(svg.namespaceURI,"line");for(const [k,v] of Object.entries({x1:20,x2:580,y1:72.5,y2:72.5,stroke:"#6e829b","stroke-dasharray":"5 6"}))baseline.setAttribute(k,v);
    const path=document.createElementNS(svg.namespaceURI,"polyline");
    const points=readings.map(x=>(20+560*x.minute/max)+","+(72.5+x.value*1.13)).join(" ");
    for(const [k,v] of Object.entries({points,fill:"none",stroke:"#61ddc1","stroke-width":3.3}))path.setAttribute(k,v);
    svg.append(baseline,path);node.momentum.append(svg,E("div","mi-momentum-label",t("coverage")));
  }
  function render(){
    const m=selected();root.hidden=!m;if(!m)return;
    root.dir=l()==="ar"?"rtl":"ltr";
    for(const [n,k] of [["title","title"],["lead","lead"],["flowTitle","flow"],["statsTitle","stats"],["momentumTitle","momentum"],["probTitle","prob"],["hint","hint"]])node[n].textContent=t(k);
    node.prob.textContent=t("probNote");node.source.textContent=t("source")+(state.provider?.available?" + Sportradar":"");
    node.select.replaceChildren();
    for(const x of state.matches){const o=E("option",null,name(x.home)+" – "+name(x.away)+" · "+t(x.status==="live"?"live":"ended"));o.value=x.id;node.select.append(o);}
    node.select.value=m.id;node.home.textContent=name(m.home);node.away.textContent=name(m.away);
    graph(m);stats(m);momentum();
  }
  async function loadProvider(m){
    const srid=m.sportradarId||m.srId||"";
    if(!/^sr:sport_event:\d{1,15}$/.test(srid))return;
    const key=m.id+":"+srid;if(state.providerKey===key&&Date.now()-state.providerAt<90000)return;
    state.providerKey=key;state.providerAt=Date.now();
    try{const r=await fetch("/api/match-intelligence?srid="+encodeURIComponent(srid));if(!r.ok)return;
      const data=await r.json();if(state.id===m.id){state.provider=data.available?data:null;render();}
    }catch(_){/* external provider must never interfere with match playback */}
  }
  function update(matches){
    state.matches=(Array.isArray(matches)?matches:[]).filter(m=>m&&(m.status==="live"||m.status==="ended")&&(m.stats||m.goals?.length))
      .sort((a,b)=>(a.status==="live"?0:1)-(b.status==="live"?0:1)).slice(0,10);
    if(!state.matches.some(m=>m.id===state.id)){state.id=state.matches[0]?.id||"";const current=state.matches[0];state.minute=current?.status==="live"?(min(current.minute)??45):90;state.provider=null;state.providerKey="";}
    render();const m=selected();if(m)loadProvider(m);
  }
  node.select.addEventListener("change",()=>{state.id=node.select.value;const m=selected();state.minute=m?.status==="live"?(min(m.minute)??45):90;state.provider=null;state.providerKey="";render();if(m)loadProvider(m);});
  node.minute.addEventListener("input",()=>{state.minute=Number(node.minute.value);const m=selected();if(m)graph(m);});
  window.KZMatchIntelligence={update};
  if(typeof MutationObserver!=="undefined")new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
})();