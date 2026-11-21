/* Design analysis of M2's baseline, tension score and send gate (Section 6 of the technical report).
   Run from the repository folder:  node docs/analysis/design-analysis.js
   It drives the real code in renderer/baseline.js and renderer/gate.js with controlled inputs.
   Simulations use a seeded random generator and ASSUME independent Gaussian noise around a calm level of 14 breaths and 78 beats a minute.
   Nothing here is data from people. */
const path = require('path');
const R = path.join(__dirname, '..', '..', 'renderer') + path.sep;
const B=require(R+'baseline.js'), G=require(R+'gate.js');
function rng(seed){let a=seed>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function gauss(r){let u=0,v=0;while(!u)u=r();v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
const out={};
// A. surface
const base={breathing:14,pulse:78,breathingScale:1.5,pulseScale:3};
const bs=[14,16,18,20,22,24], ps=[78,84,90,96,102,108];
out.A=bs.map(b=>ps.map(p=>Math.round(B.rawTension({breathing:b,pulse:p},base))));
// B. floors: steady calm sample set
const calm=[...Array(25)].map((_,i)=>({breathing:14+(i%3===0?0.3:i%3===1?-0.2:0),pulse:78+(i%4===0?0.8:i%4===1?-0.6:0)}));
const bb=B.makeBaseline(calm);
const rawScaleB=B.mad(calm.map(s=>s.breathing))*1.4826, rawScaleP=B.mad(calm.map(s=>s.pulse))*1.4826;
const noFloor={...bb,breathingScale:Math.max(rawScaleB,1e-6),pulseScale:Math.max(rawScaleP,1e-6)};
out.B={rawScaleB,rawScaleP,floorB:bb.breathingScale,floorP:bb.pulseScale,
 tWith:B.rawTension({breathing:16,pulse:82},bb), tWithout:B.rawTension({breathing:16,pulse:82},noFloor)};
// C. contaminated baseline
const trueCalm={breathing:14,pulse:78,breathingScale:1.5,pulseScale:3};
const taint={breathing:17,pulse:88,breathingScale:1.5,pulseScale:3};
out.C=[[14,78],[17,84],[19,90],[21,96],[23,102]].map(([b,p])=>({b,p,true:Math.round(B.rawTension({breathing:b,pulse:p},trueCalm)),tainted:Math.round(B.rawTension({breathing:b,pulse:p},taint))}));
// D. false lock Monte Carlo: person stays calm, reading noise sigma
function sim(sigB,sigP,nBase,seed,minutes){const r=rng(seed);const calmDraw=()=>({breathing:14+sigB*gauss(r),pulse:78+sigP*gauss(r)});
 const learn=[...Array(nBase)].map(calmDraw);const base=B.makeBaseline(learn);const sm=new B.Smoother(0.3);const g=new G.Gate();let locks=0,prev='open',secs=0;
 for(let t=0;t<minutes*60;t++){const s=calmDraw();const T=sm.push(Math.min(100,B.rawTension(s,base)));g.update(T,1,0.9);if(g.state==='locked'&&prev!=='locked')locks++;prev=g.state;if(g.state==='review'){g.confirmReview();prev='open'}}
 return locks}
out.D=[];
for(const [sb,sp] of [[0.5,1.5],[1.0,2.5],[1.5,3.5],[2.0,5.0]]){let tot=0,runs=300,withLock=0;for(let k=0;k<runs;k++){const l=sim(sb,sp,25,1000+k,10);tot+=l;if(l>0)withLock++}
 out.D.push({sigB:sb,sigP:sp,runs,lockedRunsPct:+(100*withLock/runs).toFixed(1),locksPer10min:+(tot/runs).toFixed(3)})}
// E. gate timing on scripted trace
function trace(){const g=new G.Gate();const log=[];let t=0;const T=(x,secs)=>{for(let i=0;i<secs;i++){t++;const before=g.state;g.update(x,1,0.9);if(g.state!==before)log.push([t,before+'>'+g.state])}};
 T(10,5);T(70,10);T(70,5);T(20,12);g.confirmReview();T(20,3);return log}
out.E=trace();
function flicker(opts){const g=new G.Gate(opts);let ch=0,prev=g.state;for(let t=0;t<300;t++){const x=t%2? 58:52;g.update(x,1,0.9);if(g.state!==prev){ch++;prev=g.state}}return ch}
out.Eflick={withHysteresis:flicker(),};
// F. smoother step response
let v=0,n=0;const sm=new B.Smoother(0.3);sm.push(0);const steps=[];for(let i=1;i<=12;i++){v=sm.push(100);steps.push(+v.toFixed(1))}
out.F=steps;
// G. calm pool ratchet: person calm distribution fixed, baseline refreshed from samples with T<30 only
function ratchet(sigB,sigP,seed){const r=rng(seed);const draw=()=>({breathing:14+sigB*gauss(r),pulse:78+sigP*gauss(r)});
 let base=B.makeBaseline([...Array(25)].map(draw));const pool=[];const sm=new B.Smoother(0.3);const g=new G.Gate();const hist=[];
 for(let t=1;t<=3600;t++){const s=draw();const T=sm.push(Math.min(100,B.rawTension(s,base)));g.update(T,1,0.9);if(g.state==='review')g.confirmReview();
  if(T<30&&g.state==='open'){pool.push(s);if(pool.length>120)pool.shift()}
  if(t%30===0&&pool.length>=60){const nb=B.makeBaseline(pool);if(nb)base=nb}
  if(t%600===0)hist.push({min:t/60,b:+base.breathing.toFixed(2),p:+base.pulse.toFixed(2),sb:+base.breathingScale.toFixed(2),sp:+base.pulseScale.toFixed(2)})}
 return hist}
out.G={mid:ratchet(1.0,2.5,7),noisy:ratchet(2.0,5.0,7)};
// H. baseline estimate error vs n
out.H=[10,25,60].map(n=>{const errs=[];for(let k=0;k<400;k++){const r=rng(5000+k);const s=[...Array(n)].map(()=>({breathing:14+1.0*gauss(r),pulse:78+2.5*gauss(r)}));const b=B.makeBaseline(s);errs.push([Math.abs(b.breathing-14),Math.abs(b.pulse-78)])}
 const med=a=>a.sort((x,y)=>x-y)[a.length>>1];return {n,medAbsErrB:+med(errs.map(e=>e[0])).toFixed(2),medAbsErrP:+med(errs.map(e=>e[1])).toFixed(2)}});
console.log('--- Sections 6.1 to 6.8: raw results as JSON');console.log(JSON.stringify(out));

{
console.log('--- Gate timing with the smoother, weight sensitivity, expression nudge');
// smoothed timing
function run(rawSeq){const sm=new B.Smoother(0.3);const g=new G.Gate();const log=[];let t=0;for(const [x,secs] of rawSeq){for(let i=0;i<secs;i++){t++;const T=sm.push(x);const b=g.state;g.update(T,1,0.9);if(g.state!==b)log.push([t,b+'>'+g.state,+T.toFixed(1)])}}return log}
console.log('smoothed, raw step 0->70 at t=6, back to 20 at t=31:',JSON.stringify(run([[0,5],[70,25],[20,30]])));
console.log('smoothed, raw step 0->100 :',JSON.stringify(run([[0,5],[100,25],[20,30]])));
console.log('smoothed, raw step 0->60 :',JSON.stringify(run([[0,5],[60,25],[20,30]])));
console.log('smoothed, raw 0->50 (below lock):',JSON.stringify(run([[0,5],[50,60]])));
// single threshold no hold flicker
let ch=0,prev=false;for(let t=0;t<300;t++){const x=t%2?58:52;const s=x>=55;if(s!==prev){ch++;prev=s}}console.log('single threshold changes',ch);
// weights and divisor sensitivity
const base={breathing:14,pulse:78,breathingScale:1.5,pulseScale:3};
const samples=[[17,84],[18,80],[16,90],[19,82]];
const f=(s,wb,wp,d)=>{const zb=(s[0]-14)/1.5,zp=(s[1]-78)/3;return Math.min(100,Math.max(0,100*(wb*Math.max(0,zb)+wp*Math.max(0,zp))/d))};
for(const s of samples){console.log(JSON.stringify(s),'zb',((s[0]-14)/1.5).toFixed(2),'zp',((s[1]-78)/3).toFixed(2),
 'default',f(s,.6,.4,4).toFixed(1),'w.5/.5',f(s,.5,.5,4).toFixed(1),'w.7/.3',f(s,.7,.3,4).toFixed(1),'d3',f(s,.6,.4,3).toFixed(1),'d5',f(s,.6,.4,5).toFixed(1))}
// face nudge values
const R2=require(R+'read.js');for(const c of [55,60,70,80,100])console.log('nudge conf',c,R2.faceNudge({type:'angry',conf:c,stable:true}).toFixed(1));

}
