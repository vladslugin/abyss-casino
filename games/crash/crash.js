const $ = s => document.querySelector(s);
const F = window.Fair;

let state = {serverSeed:null, commit:null, nonce:0, balance:1000,
  roundActive:false, bet:0, autoX:2, crashAt:0, startT:0, cashedAt:null,
  rounds:[], raf:null};

const cv = $("#cv"), ctx = cv.getContext("2d");
let W=0, H=0;
function resize(){
  const r=cv.getBoundingClientRect();
  cv.width=r.width*devicePixelRatio; cv.height=r.height*devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); W=r.width; H=r.height;
}
addEventListener("resize", resize);

const K = 0.00023;
const multAt = ms => Math.max(1, Math.exp(K*ms));

let AC=null, master=null, masterLP=null, hum=null, humGain=null, humLP=null, soundOn=false;
let noiseBuf=null;
function makeNoise(){
  const n=AC.sampleRate*2, b=AC.createBuffer(1,n,AC.sampleRate), d=b.getChannelData(0);
  for(let i=0;i<n;i++) d[i]=Math.random()*2-1; return b;
}
function initAudio(){
  if(AC) return;
  AC=new (window.AudioContext||window.webkitAudioContext)();
  master=AC.createGain(); master.gain.value=0.0;
  masterLP=AC.createBiquadFilter(); masterLP.type="lowpass"; masterLP.frequency.value=1700; masterLP.Q.value=0.3;
  master.connect(masterLP); masterLP.connect(AC.destination);
  noiseBuf=makeNoise();
  humLP=AC.createBiquadFilter(); humLP.type="lowpass"; humLP.frequency.value=180;
  humGain=AC.createGain(); humGain.gain.value=0.0;
  const o1=AC.createOscillator(); o1.type="sine"; o1.frequency.value=42;
  const o2=AC.createOscillator(); o2.type="sine"; o2.frequency.value=57;
  o1.connect(humGain); o2.connect(humGain); humGain.connect(humLP); humLP.connect(master);
  o1.start(); o2.start(); hum={o1,o2};
}
function setSound(on){
  soundOn=on;
  const _sb=$("#sndBtn"); _sb.textContent = on ? "sound on" : "sound off"; _sb.dataset.on = on ? "1":"0";
  if(on){ initAudio(); if(AC.state==="suspended") AC.resume();
          master.gain.linearRampToValueAtTime(0.5, AC.currentTime+0.25); }
  else if(master){ master.gain.linearRampToValueAtTime(0.0, AC.currentTime+0.15); }
}
function humSet(mult, active){
  if(!AC) return;
  const d=Math.min(Math.log(mult)/Math.log(60),1);
  humGain.gain.setTargetAtTime(active?(0.05+0.22*d):0.02, AC.currentTime, 0.3);
  humLP.frequency.setTargetAtTime(active?(120+d*260):160, AC.currentTime, 0.3);
}
function tone(freq, t0, dur, type="sine", vol=0.3){
  if(!AC||!soundOn) return;
  const o=AC.createOscillator(), g=AC.createGain();
  o.type=type; o.frequency.value=freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0+0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0+dur+0.03);
}
function sweep(f0,f1,dur,vol,type="sine"){
  if(!AC||!soundOn) return;
  const t0=AC.currentTime, o=AC.createOscillator(), g=AC.createGain();
  o.type=type; o.frequency.setValueAtTime(f0,t0);
  o.frequency.exponentialRampToValueAtTime(f1,t0+dur);
  g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(vol,t0+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0+dur+0.02);
}
function noise(dur,vol,lp=900){
  if(!AC||!soundOn) return;
  const t0=AC.currentTime, s=AC.createBufferSource(); s.buffer=noiseBuf;
  const f=AC.createBiquadFilter(); f.type="lowpass"; f.frequency.value=lp; f.Q.value=0.4;
  const g=AC.createGain();
  g.gain.setValueAtTime(0.0001,t0);
  g.gain.linearRampToValueAtTime(vol,t0+0.04);
  g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0+dur);
}
const sndSplash = ()=>{ noise(0.5,0.22,700); sweep(180,70,0.5,0.14,"sine"); };
const sndBubble = ()=> tone(460+Math.random()*420, AC.currentTime, 0.11, "sine", 0.045);
const sndTick   = (m)=> tone(360+Math.min(m,30)*14, AC.currentTime, 0.09, "sine", 0.05);
function sndCrash(){ if(!AC||!soundOn)return; noise(0.9,0.35,420); sweep(110,24,0.9,0.3,"sine"); sweep(70,18,1.2,0.22,"sine"); }
function sndCash(){ const t=AC?AC.currentTime:0; [0,0.11,0.22].forEach((d,i)=>tone([587,784,988][i],t+d,0.22,"sine",0.16)); }

let bubbles=[], motes=[], shakeUntil=0, crackUntil=0, flashUntil=0, cracks=null;
function seedParticles(){
  bubbles=[...Array(50)].map(()=>({x:Math.random(),y:Math.random(),r:1+Math.random()*3.5,s:.12+Math.random()*.55,w:Math.random()*6,beeped:false}));
  motes=[...Array(70)].map(()=>({x:Math.random(),y:Math.random(),r:.5+Math.random()*1.7,s:.02+Math.random()*.1,a:.1+Math.random()*.35}));
}
seedParticles();

initCracks();

function waterColors(mult){
  const d=Math.min(Math.log(mult)/Math.log(60),1);
  const top=[18-8*d,60-42*d,92-58*d], bot=[2,6-4*d,15-11*d];
  return {top:`rgb(${top.map(x=>x|0)})`, bot:`rgb(${bot.map(x=>x|0)})`, d};
}
function hexA(hex,a){const c=hex.replace('#','');const n=parseInt(c,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;}

const AXIS_X=46, PPU=132;
const TICKS=[1,1.25,1.5,2,2.5,3,4,5,7,10,15,20,30,50,75,100,150,200,300,500,1000];
const BAT_Y_FRAC=0.30;
function yFor(m,cur){ return H*BAT_Y_FRAC + (Math.log(m)-Math.log(cur))*PPU; }
function drawAxis(cur,color){
  ctx.strokeStyle="rgba(120,150,180,.18)"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(AXIS_X,0); ctx.lineTo(AXIS_X,H); ctx.stroke();
  ctx.font="600 11px "+getComputedStyle(document.body).fontFamily.includes('mono')?'':'';
  ctx.font="700 11px ui-monospace,Consolas,monospace";
  for(const m of TICKS){
    const y=yFor(m,cur); if(y<-6||y>H+6) continue;
    ctx.strokeStyle="rgba(120,150,180,.07)"; ctx.beginPath();
    ctx.moveTo(AXIS_X,y); ctx.lineTo(W,y); ctx.stroke();
    const near=Math.abs(Math.log(m)-Math.log(cur))<0.08;
    ctx.strokeStyle=near?color:"rgba(150,180,210,.4)"; ctx.lineWidth=near?2:1;
    ctx.beginPath(); ctx.moveTo(AXIS_X-6,y); ctx.lineTo(AXIS_X+(near?9:5),y); ctx.stroke();
    ctx.fillStyle=near?color:"rgba(150,175,200,.65)";
    ctx.fillText(m+"×", 6, y+4);
  }
  ctx.fillStyle="rgba(150,175,200,.5)"; ctx.font="700 10px ui-monospace,Consolas,monospace";
  const elapsed = state.roundActive ? (performance.now()-state.startT)/1000 : 0;
  for(let s=0;s<=Math.ceil(elapsed)+3;s++){
    const x=AXIS_X + s*46; if(x>W) break;
    ctx.strokeStyle="rgba(120,150,180,.1)"; ctx.beginPath();
    ctx.moveTo(x,H-16); ctx.lineTo(x,H); ctx.stroke();
    ctx.fillText(s+"s", x+2, H-5);
  }
}

function initCracks(){
  cracks=[];
  const rnd=(seed=>()=>((seed=seed*16807%2147483647)/2147483647))(97);
  for(let i=0;i<9;i++){
    const edge=Math.floor(rnd()*4); let x,y,dx,dy;
    if(edge===0){x=rnd();y=0;dx=(rnd()-.5)*.3;dy=.06+rnd()*.1;}
    else if(edge===1){x=rnd();y=1;dx=(rnd()-.5)*.3;dy=-(.06+rnd()*.1);}
    else if(edge===2){x=0;y=rnd();dx=.06+rnd()*.1;dy=(rnd()-.5)*.3;}
    else {x=1;y=rnd();dx=-(.06+rnd()*.1);dy=(rnd()-.5)*.3;}
    const seg=[[x,y]]; let cx=x,cy=y;
    const n=3+Math.floor(rnd()*3);
    for(let k=0;k<n;k++){ cx+=dx*(0.6+rnd()*0.8); cy+=dy*(0.6+rnd()*0.8);
      dx+=(rnd()-.5)*.05; dy+=(rnd()-.5)*.05; seg.push([cx,cy]); }
    cracks.push(seg);
  }
}
function drawPressure(cur, mode, t){
  let p = Math.min(Math.max((cur-2)/12,0),1);
  if(mode==='crash') p=1;
  if(p<0.015) return;
  const breathe = 1 + 0.03*Math.sin(t/430)*p;
  const cx=W*0.5, cy=H*0.40;

  const rIn  = mode==='crash' ? W*0.06 : W*(0.66-0.36*p)*breathe;
  const rOut = W*0.92;
  const g=ctx.createRadialGradient(cx,cy,Math.max(rIn,1), cx,cy,rOut);
  g.addColorStop(0,"rgba(2,5,9,0)");
  g.addColorStop(0.75,`rgba(1,4,8,${0.28*p})`);
  g.addColorStop(1,`rgba(0,2,5,${0.55+0.4*p})`);
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  if(p>0.46 || mode==='crash'){
    const ca=mode==='crash'?0.7:(p-0.46)*1.1;
    const frac=mode==='crash'?1:Math.min((p-0.46)/0.6,1);
    for(const seg of cracks){
      const upTo=1+Math.floor((seg.length-1)*frac);
      ctx.beginPath();
      for(let k=0;k<upTo;k++){ const[px,py]=seg[k];
        k?ctx.lineTo(px*W,py*H):ctx.moveTo(px*W,py*H); }
      ctx.strokeStyle=`rgba(150,180,205,${Math.min(ca,0.5)*0.5})`; ctx.lineWidth=1.1; ctx.stroke();
      ctx.strokeStyle=`rgba(210,235,255,${Math.min(ca,0.55)})`; ctx.lineWidth=0.5; ctx.stroke();
    }
  }
}

function drawSub(x,y,mode,t){
  const col = mode==='crash'?'#ff4d5e':mode==='safe'?'#22e079':'#dff4ff';
  const light = mode==='crash'?'#ff4d5e':mode==='safe'?'#22e079':'#8fe6ff';
  const gr=ctx.createLinearGradient(0,0,0,190);
  gr.addColorStop(0,hexA(light.replace('#',''),.24)); gr.addColorStop(1,hexA(light.replace('#',''),0));
  ctx.save(); ctx.translate(x,y);
  ctx.fillStyle=gr; ctx.beginPath();
  ctx.moveTo(-10,8); ctx.lineTo(10,8); ctx.lineTo(78,190); ctx.lineTo(-78,190); ctx.closePath(); ctx.fill();
  ctx.fillStyle=col; ctx.strokeStyle="rgba(0,0,0,.45)"; ctx.lineWidth=2;
  ctx.beginPath(); ctx.ellipse(0,0,27,18,0,0,7); ctx.fill(); ctx.stroke();
  ctx.fillStyle=hexA(light.replace('#',''),.92); ctx.beginPath(); ctx.arc(9,-2,7.5,0,7); ctx.fill();
  ctx.strokeStyle="rgba(0,0,0,.5)"; ctx.stroke();
  if(mode==='crash' && t<crackUntil){
    ctx.strokeStyle="rgba(20,30,40,.9)"; ctx.lineWidth=1.2;
    for(let i=0;i<5;i++){ const a=i*1.3;
      ctx.beginPath(); ctx.moveTo(9,-2);
      ctx.lineTo(9+Math.cos(a)*8, -2+Math.sin(a)*8); ctx.stroke(); }
  }
  ctx.strokeStyle=col; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(-27,0); ctx.lineTo(-36,-6); ctx.moveTo(-27,0); ctx.lineTo(-36,6); ctx.stroke();
  ctx.shadowColor=col; ctx.shadowBlur=22;
  ctx.strokeStyle=hexA(col.replace('#',''),.5); ctx.beginPath(); ctx.ellipse(0,0,27,18,0,0,7); ctx.stroke();
  ctx.restore();
}

function drawScene(mult, mode){
  const t=performance.now();
  let ox=0,oy=0;
  if(shakeUntil>t){const k=(shakeUntil-t)/320*7; ox=(Math.random()-.5)*k; oy=(Math.random()-.5)*k;}
  ctx.save(); ctx.translate(ox,oy);

  const {top,bot,d}=waterColors(mult);
  const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,top); g.addColorStop(1,bot);
  ctx.fillStyle=g; ctx.fillRect(-12,-12,W+24,H+24);

  const rayA=(1-d)*0.15;
  if(rayA>0.01) for(let i=0;i<5;i++){
    const x=W*(0.18+i*0.18)+Math.sin(t/2600+i)*22;
    const gr=ctx.createLinearGradient(x,0,x-40,H);
    gr.addColorStop(0,`rgba(120,220,255,${rayA})`); gr.addColorStop(1,"rgba(120,220,255,0)");
    ctx.fillStyle=gr; ctx.beginPath();
    ctx.moveTo(x-18,0); ctx.lineTo(x+18,0); ctx.lineTo(x-40,H); ctx.lineTo(x-90,H); ctx.closePath(); ctx.fill();
  }

  const speed = mode==='dive' ? (0.6+Math.log(mult)*0.5) : 0.15;

  ctx.fillStyle="#cfe8ff";
  for(const m of motes){ m.y-=(m.s*speed)/60; if(m.y<0){m.y=1;m.x=Math.random();}
    ctx.globalAlpha=m.a*(0.5+0.5*(1-d)); ctx.beginPath(); ctx.arc(m.x*W,m.y*H,m.r,0,7); ctx.fill(); }
  ctx.globalAlpha=1;

  drawPressure(mult, mode, t);
  drawAxis(mult, mode==='crash'?'#ff4d5e':mode==='safe'?'#22e079':'#38d6ff');

  for(const b of bubbles){ b.y-=(b.s*speed)/60; b.x+=Math.sin(t/700+b.w)*0.0006;
    if(b.y<-0.02){b.y=1.02;b.x=Math.random(); if(soundOn&&mode==='dive'&&Math.random()<0.25) sndBubble();}
    ctx.strokeStyle=`rgba(180,235,255,${0.16+0.16*(1-d)})`; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(b.x*W,b.y*H,b.r,0,7); ctx.stroke(); }

  drawSub(W*0.5+Math.sin(t/900)*8, H*BAT_Y_FRAC+Math.cos(t/1100)*6, mode, t);

  if(flashUntil>t){ ctx.fillStyle=`rgba(255,70,80,${(flashUntil-t)/260*0.5})`; ctx.fillRect(-12,-12,W+24,H+24); }
  ctx.restore();
}

let lastTickInt=0;
async function newSession(){
  state.serverSeed=F.randomHex(32); state.commit=await F.commitment(state.serverSeed);
  state.nonce=0; state.rounds=[];
  $("#commit").textContent=state.commit; $("#nonce").textContent=0;
  $("#revealBox").style.display="none"; renderHistory();
}
function renderHistory(){
  $("#history").innerHTML=state.rounds.slice(-14).reverse().map(r=>{
    const c=r.crash>=10?"hi":r.crash>=2?"mid":"lo";
    return `<span class="h ${c}">${r.crash.toFixed(2)}×</span>`;}).join("");
}
function setPhase(txt,cls){ $("#phase").innerHTML=`<span class="${cls||'dim'}">${txt}</span>`; }
async function startRound(){
  const bet=Math.max(1,+$("#bet").value||0);
  if(bet>state.balance){ setPhase("insufficient balance","crashed"); return; }
  state.autoX=Math.max(1.01,+$("#auto").value||2);
  state.bet=bet; state.balance-=bet; updateBal();
  state.crashAt=await F.crashPoint(state.serverSeed,$("#clientSeed").value,state.nonce);
  state.cashedAt=null; state.roundActive=true; state.startT=performance.now(); lastTickInt=1;
  $("#betBtn").textContent="Cash out"; $("#betBtn").className="cash";
  $("#multVal").className="flying";
  if(soundOn) sndSplash();
  loop();
}
function loop(){
  const ms=performance.now()-state.startT; let m=multAt(ms);
  humSet(m, !state.cashedAt);
  if(m>=state.crashAt){
    m=state.crashAt;
    $("#multVal").textContent=m.toFixed(2)+"×"; $("#multVal").className="crashed";
    $("#depth").textContent="DEPTH "+(m*10|0)+" M";
    setPhase(state.cashedAt?`cashed out @ ${state.cashedAt.toFixed(2)}×`:"crushed — bet lost to the deep",
             state.cashedAt?"safe":"crashed");
    shakeUntil=performance.now()+340; crackUntil=performance.now()+700; flashUntil=performance.now()+260;
    if(soundOn && !state.cashedAt) sndCrash();
    humSet(1,false);
    const end=performance.now()+700;
    (function crashAnim(){ drawScene(m,'crash');
      if(performance.now()<end) requestAnimationFrame(crashAnim); else drawScene(m,'crash'); })();
    endRound(); return;
  }
  if(!state.cashedAt && m>=state.autoX) cashOut(state.autoX);
  const fl=Math.floor(m);
  if(soundOn && !state.cashedAt && fl!==lastTickInt && [2,3,5,7,10,15,20,30,50].includes(fl)){ lastTickInt=fl; sndTick(fl); }
  const mode=state.cashedAt?'safe':'dive';
  $("#multVal").textContent=m.toFixed(2)+"×"; $("#multVal").className=state.cashedAt?'safe':'flying';
  $("#depth").textContent="DEPTH "+(m*10|0)+" M";
  if(!state.cashedAt) setPhase("descending — cash out before it crushes","flying");
  drawScene(m,mode);
  state.raf=requestAnimationFrame(loop);
}
function cashOut(atX){
  if(state.cashedAt||!state.roundActive) return;
  const x=atX||multAt(performance.now()-state.startT);
  if(x>=state.crashAt) return;
  state.cashedAt=x; const win=state.bet*x; state.balance+=win; updateBal();
  $("#betBtn").textContent="Dive"; $("#betBtn").className="bet"; $("#betBtn").disabled=true;
  setPhase(`+${win.toFixed(2)} @ ${x.toFixed(2)}×`,"safe");
  if(soundOn) sndCash();
}
function endRound(){
  cancelAnimationFrame(state.raf); state.roundActive=false;
  state.rounds.push({nonce:state.nonce,crash:state.crashAt,bet:state.bet,cashed:state.cashedAt});
  state.nonce++; $("#nonce").textContent=state.nonce; renderHistory();
  $("#betBtn").textContent="Dive"; $("#betBtn").className="bet"; $("#betBtn").disabled=false;
}
function updateBal(){ $("#bal").textContent=state.balance.toFixed(2); }

$("#betBtn").onclick=()=>{ if(state.roundActive&&!state.cashedAt){cashOut();return;} if(!state.roundActive)startRound(); };
$("#rerollBtn").onclick=()=>{ $("#clientSeed").value=F.randomHex(8); };
$("#sndBtn").onclick=()=>setSound(!soundOn);
$("#revealBtn").onclick=async()=>{
  if(!state.rounds.length){ setPhase("play a round first","idle"); return; }
  $("#revealBox").style.display="block"; $("#serverSeed").textContent=state.serverSeed;
  const okC=(await F.commitment(state.serverSeed))===state.commit;
  $("#revStatus").textContent=okC?"verified":"mismatch"; $("#revStatus").className="badge "+(okC?"ok":"bad-b");
  const tb=$("#verifyTbl").querySelector("tbody"); tb.innerHTML="";
  for(const r of state.rounds){
    const re=await F.crashPoint(state.serverSeed,$("#clientSeed").value,r.nonce);
    const ok=Math.abs(re-r.crash)<1e-9;
    tb.innerHTML+=`<tr><td>${r.nonce}</td><td>${r.crash.toFixed(2)}×</td><td>${re.toFixed(2)}×</td><td class="${ok?'g':'r'}">${ok?'✓':'✗'}</td></tr>`;
  }
};

function ambient(){ if(!state.roundActive) drawScene(1,'idle'); requestAnimationFrame(ambient); }
(async function init(){ resize(); $("#clientSeed").value=F.randomHex(8); await newSession(); ambient(); })();
