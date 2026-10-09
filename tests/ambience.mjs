// The city bed contract. Everything here is about a sound nobody can photograph, so the file exists to
// pin it in numbers: that the noise is deterministic, that its loop has no seam, that the river does
// not fall silent in the view the app opens on, that a boat with no oar rigged stays silent, and that
// the duck reads a getter that cannot get stuck. The DSP half is a pure function of a seed, which is
// what makes it assertable at all - and the seam assertion is deliberately run against a second,
// worse implementation, so a test that could not fail on the wrong code would not be here.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
// ambience.js reaches for lifeRiver in simulation.js, which imports three at the top even though its
// core is not supposed to need it. Same shim the other Three-touching tests install.
registerHooks({resolve(s,c,next){const file={'three':'vendor/three.module.js','three/core':'vendor/three.core.js'}[s];
 return file?{url:new URL(file,root).href,shortCircuit:true}:next(s,c);}});
const read=p=>readFile(new URL(p,root),'utf8');

// Installed before the import for the same reason tests/voice.mjs does it: voice.js reads the engine
// at module load, and the duck it exposes is one of the things under test.
const spoken=[],utterances=[];
let ending='none';
globalThis.speechSynthesis={getVoices:()=>[],addEventListener(){},cancel(){utterances.forEach(u=>u.h?.error?.());},
 speak:u=>{utterances.push(u);if(ending==='end')u.h?.end?.();else if(ending==='error')u.h?.error?.();}};
globalThis.SpeechSynthesisUtterance=class{constructor(t){this.text=t;}addEventListener(k,f){(this.h||(this.h={}))[k]=f;}};

const {noiseBuffer,brownFilter,splashBuffer,clackBuffer,hoofBuffer,murmurBuffer,riverGain,strokeEdges,
 cartStrikes,streetGain,windShape,crowdNear,startAmbience,stopAmbience,CRIES,updateAmbience,
 ambienceOn,setAmbienceOn,ambienceVol,setAmbienceVol,ambienceRunning,classify,sceneDistrict,resetScene,
 BUS,BED,WIND,STREET,CROWD_LO,CROWD_HI,WHEEL,HOOF,CART_RANGE,SPLASH_RANGE}=await import('../src/ambience.js');
const {voiceBusy,speak,hush}=await import('../src/voice.js');
const {lifeRiver}=await import('../src/simulation.js');
const eco=JSON.parse(await readFile(new URL('public/runtime/ecology.json',root),'utf8'));
const nav=JSON.parse(await readFile(new URL('public/runtime/navigation.json',root),'utf8'));
const app=await read('src/app.js'),html=await read('index.html'),voice=await read('src/voice.js'),
 amb=await read('src/ambience.js'),i18n=await read('src/i18n.js');
// The bed runs at the context's own sample rate, 48000 on the machine this was measured on. Testing at
// 8000 measures a filter that never ships, and it gives a different answer - the oversampling ratio is
// what decides how well the second pass settles.
const RATE=48000,SECS=1,CUT=420;

// --- The loop seam. The bed runs for as long as the tab is open, so the wrap from the last sample back
// to the first happens thousands of times and a step there is a tick, every time.
//
// Measured against the *median* interior one-sample step, not p99.9: a seam is one isolated step, and
// holding a single sample against the 99.9th percentile of 48000 interior steps is a comparison the
// statistic was never meant to make. It is not even stable - a naive filter passes it on some seeds.
const median=buf=>{const d=new Float64Array(buf.length-1);
 for(let i=0;i<d.length;i++)d[i]=Math.abs(buf[i+1]-buf[i]);
 d.sort();return d[d.length>>1];};
const ratio=b=>Math.abs(b[0]-b[b.length-1])/median(b);
const med=a=>a.slice().sort((x,y)=>x-y)[a.length>>1],worst=a=>Math.max(...a);
const tick=()=>new Promise(r=>setTimeout(r,0));

const once=(buf,cut,rate)=>{const n=buf.length,a=1-Math.exp(-2*Math.PI*cut/rate),o=new Float32Array(n);
 let s=0;for(let i=0;i<n;i++){s+=a*(buf[i]-s);o[i]=s;}return o;};
// Twelve seeds, because the single-pass seam moves by more than an order of magnitude between them.
// One sample would have pinned whichever side it happened to land on.
const spread=fn=>{const r=[];for(let seed=0;seed<12;seed++)r.push(ratio(fn(noiseBuffer(RATE,SECS,seed))));return r;};
const circ=spread(x=>brownFilter(x,CUT,RATE)),sing=spread(x=>once(x,CUT,RATE));

assert.ok(med(circ)<1.5,`the typical seam has to sit inside the noise, and it is ${med(circ).toFixed(2)}x an interior step`);
assert.ok(worst(circ)<3,`and no seed may blow up - the worst of twelve is ${worst(circ).toFixed(2)}x`);
assert.ok(med(sing)>3,
 `a single filtering pass has to be demonstrably worse, or the two bounds above mean nothing: its median of twelve is ${med(sing).toFixed(2)}x against this one's ${med(circ).toFixed(2)}x`);
assert.ok(ratio(noiseBuffer(RATE,SECS,1))<1,
 'and white noise has no seam at all - it is only after lowpassing that one exists');

const water=brownFilter(noiseBuffer(RATE,SECS,4812),CUT,RATE);

// --- The noise itself. Determinism is not a nicety here: it is what makes the sample assertions
// above mean anything, and it is the difference between this river and a different one each reload.
assert.equal(water.length,RATE*SECS,'the bed must be exactly as long as asked for, or its loop period drifts');
assert.ok(water.every(Number.isFinite),'a NaN in here is a click every loop');
let peak=0,rms=0;
for(const v of water){peak=Math.max(peak,Math.abs(v));rms+=v*v;}
assert.ok(peak>.5&&peak<=1,'normalised to a usable headroom, not silence and not clipping');
assert.ok(Math.sqrt(rms/water.length)>.05,'and loud enough that a -20dB bed is audible at all');
assert.deepEqual(noiseBuffer(RATE,SECS,7),noiseBuffer(RATE,SECS,7),'the same seed must give the same noise');
assert.notDeepEqual(noiseBuffer(RATE,SECS,7),noiseBuffer(RATE,SECS,8),'and a different seed a different one');
assert.equal(noiseBuffer(RATE,0,7).length,1,'seconds can reach zero from the arithmetic, and a zero-length AudioBuffer throws on start');

const splash=splashBuffer(RATE,4812);
assert.ok(splash.every(Number.isFinite)&&splash.length>0,'a splash is a short filtered burst, not a click');
let head=0;for(let i=0;i<splash.length>>2;i++)head+=splash[i]*splash[i];
let tail=0;for(let i=splash.length-(splash.length>>2);i<splash.length;i++)tail+=splash[i]*splash[i];
assert.ok(head>tail*20,'the burst has to decay: a splash that rings for its whole length is a beep');

// The market is a SUM of two circular buffers, so it is circular too - but "obviously still circular" is
// the kind of reasoning that has already gone wrong once in this file, so it gets measured like the
// single filter does.
const murmur=murmurBuffer(RATE,4812);
assert.ok(Math.abs(ratio(murmur)-ratio(water))<.5,
 `summing two loopable buffers has to leave the loop loopable: seam ${ratio(murmur).toFixed(2)}x against the single filter's ${ratio(water).toFixed(2)}x`);
assert.ok(murmur.every(Number.isFinite)&&murmur.length===RATE*10,
 'and it is exactly the loop length it was asked for, or its seam drifts out of phase with the river');

// A struck wheel and a hoof, both of which are one-shots and so have no loop to protect - but which
// still must not be silence, a click or a clipped spike.
for(const [name,buf,len] of [['clack',clackBuffer(RATE,4812),.045],['hoof',hoofBuffer(RATE,4812),.09]]){
 assert.ok(buf.every(Number.isFinite),`${name} must be finite`);
 assert.equal(buf.length,Math.round(RATE*len),`${name} is a fixed-length one-shot`);
 let pk=0,en=0;for(let i=0;i<buf.length;i++){pk=Math.max(pk,Math.abs(buf[i]));en+=buf[i]*buf[i];}
 assert.ok(pk>.9&&pk<=1,`${name} normalised to usable headroom, not silence and not clipping`);
 assert.ok(Math.sqrt(en/buf.length)>.03,`${name} carries enough energy to be heard over the bed`);}
let chead=0,ctail=0;const cl=clackBuffer(RATE,4812);
for(let i=0;i<cl.length>>2;i++)chead+=cl[i]*cl[i];
for(let i=cl.length-(cl.length>>2);i<cl.length;i++)ctail+=cl[i]*cl[i];
assert.ok(chead>ctail*20,'a wheel strike decays: one that rings for its whole length is a bell');

// --- How loud the river is from where the reader is standing. The floor is the whole point of this
// section: away from the water means quieter, never gone.
const bank=lifeRiver(45);
assert.equal(riverGain(45,bank),1,'standing in the channel is full volume');
assert.equal(riverGain(45,bank+14.25),1,'and the bank itself is still full - the falloff starts past it');
assert.equal(riverGain(45,bank+14.25+1000),.3,'far inland settles on the floor, not on silence');
let mono=true;
for(let d=15;d<200;d+=5)if(riverGain(45,bank+d+5)>riverGain(45,bank+d)+1e-9)mono=false;
assert.ok(mono,'and it may only ever fall, or walking inland would bring the river up');

// Read the default view's eye out of the source rather than writing it here: if the opening shot moves,
// this assertion should follow it and say so, not quietly pass against a stale coordinate.
// views[].eye is the model-space triple itself, not the world camera - app.js passes it through
// world() only when it builds camera.eye - so it is already in the space the river is authored in.
const eye0=JSON.parse(app.match(/v1Name'[^}]*eye:(\[[^\]]*\])/)[1].replace(/\s+/g,''));
assert.ok(riverGain(eye0[0],eye0[1])>0,
 `the app opens on view 1, whose eye is ${eye0.join(',')} - ${(Math.abs(eye0[1]-lifeRiver(eye0[0]))).toFixed(1)}m off the centreline, `+
 'so a falloff that reached zero would open on a city with no river in it');

// --- The mix. Three buses, and the one number that keeps that honest.
//
// BED is not tuned, it is derived: the loudest the bed was before the split, divided by what the buses
// now sum to at their busiest. Without that, adding two buses is a free +3dB nobody would notice until
// a line of dialogue stopped being audible over them. Retune a weight and the peak follows it.
assert.ok(Math.abs(BED*BUS-.1)<1e-12,
 `adding buses must not make the city louder: BED*BUS is ${(BED*BUS).toFixed(6)}, and it has to stay 0.1`);
assert.equal(BUS,1+WIND+STREET,'and the sum is the weights, not a number written twice');

// How busy a place is, read out of ecology.json's own citizen anchors rather than out of a constant.
// Both counts are measured here so the constants in the source are checked against the city as it is
// actually authored - if the city is re-authored this test follows it and says what it found.
const land=eco.citizens.filter(c=>c.mode!=='crew');
const crowdAt=(p,r=30)=>land.filter(c=>Math.hypot(c.anchor[0]-p[0],c.anchor[1]-p[1])<r).length;
// The ten named views, read out of app.js the way the river section reads view 1's eye. The pattern
// insists on three numeric literals because a looser one also matches `eye:[...camera.eye]` in the
// view transition, and a test that parses its own garbage is worse than no test.
const eyes=[...app.matchAll(/eye:\[(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\]/g)].map(m=>m.slice(1,4).map(Number));
assert.equal(eyes.length,10,`the ten named views, found ${eyes.length}`);
const busy=crowdAt(eyes[4]),quiet=crowdAt(eyes[5]);
assert.equal(busy,CROWD_HI,`${busy} people on the main street is CROWD_HI; the city was re-authored`);
assert.equal(quiet,CROWD_LO,`${quiet} people at view 6 is CROWD_LO; the city was re-authored`);
assert.ok(busy/quiet>4,`and the two have to actually differ, or the gain curve is tuning a constant: ${busy} against ${quiet}`);
assert.equal(streetGain(quiet),0,'a place with no crowd is not a market');
assert.equal(streetGain(busy),1,'the main street is');
assert.equal(streetGain(CROWD_LO-1),0,'and it clamps at both ends rather than going negative or past one');
assert.equal(streetGain(CROWD_HI+50),1);
let smono=true;
for(let n=0;n<140;n+=3)if(streetGain(n+3)<streetGain(n)-1e-9)smono=false;
assert.ok(smono,'people can only ever make a place louder, or walking into a crowd would quieten the city');
assert.equal(crowdNear(null,0,0),-1,'and no data is -1, NOT zero: silence would be a claim about the city that this module cannot support');
assert.equal(crowdNear([],0,0),-1,'including an empty list, which is the same absence');

// This is the request itself, stated as a number. Water has to dominate on the opening panorama and
// stop dominating on the main street - not "the panorama is a bit louder" but the ratio inverting.
const mix=e=>{const n=crowdAt(e);
 return {water:riverGain(e[0],e[1]),street:STREET*(n<0?1:streetGain(n)),n};};
const open=mix(eyes[0]),main=mix(eyes[4]),over=e=>e.water/e.street;
assert.ok(over(open)>over(main)*10,
 `water over street has to invert between the two: ${over(open).toFixed(1)} at the opening panorama against ${over(main).toFixed(2)} on the main street`);
assert.ok(over(open)>4,
 `and the panorama has to be plainly river-dominant: ${over(open).toFixed(1)}`);
assert.ok(main.street>main.water*.8,
 `while the main street must not still be river-dominant: street ${main.street.toFixed(3)} against water ${main.water.toFixed(3)}`);
// Wind is the one scene signal that is genuinely its own thing: it rises with height, and riverGain is
// a plan-space distance with no altitude in it at all.
assert.ok(windShape(43)>windShape(4)*1.5,
 `the opening panorama's eyeline is 43m up and the main street 4m: ${windShape(43).toFixed(2)} against ${windShape(4).toFixed(2)}`);
assert.ok(windShape(-5)===.55,'and it clamps below ground rather than going negative');

// --- Who is rowing. three-water.js finds each hull's oar tip by scanning its own mesh for region-301
// vertices, so an empty oarContacts means the boat has no oar rigged at all - whether something is
// rowing is read out of the art assets, not guessed from a velocity.
const boat=(index,y,has)=>({index,oarContacts:has?[{position:[0,y,0],strength:1}]:[]});
const rec=new Map();
// A stroke is the *crossing*, so the sequence has to actually cross: out of the water, then under,
// then out again. Watching a submerged tip does nothing.
assert.deepEqual(strokeEdges([boat(0,.60,true)],rec),[],'first sight only primes the record');
assert.equal(strokeEdges([boat(0,.60,true)],rec).length,0,'and a tip that stays clear is not a stroke');
assert.equal(strokeEdges([boat(0,.20,true)],rec).length,1,'the stroke is the dip');
assert.equal(strokeEdges([boat(0,.20,true)],rec).length,0,'a tip still under does not keep stroking');
assert.equal(strokeEdges([boat(0,.20,true)],rec).length,0,'nor does holding it under');
assert.equal(strokeEdges([boat(0,.60,true)],rec).length,0,'and coming back up is not a stroke either');
assert.equal(strokeEdges([boat(0,.20,true)],rec).length,1,'only the next dip is');

// Switching the bed on beside a boat that is already mid-dip must not fire: that dip started before
// there was any audio, and firing would hand the reader a splash for a stroke they never saw.
const rec2=new Map();
assert.deepEqual(strokeEdges([boat(3,.20,true)],rec2),[],'first sight under water is still only a first sight');
assert.equal(strokeEdges([boat(3,.60,true)],rec2).length,0,'lifting out fires nothing');
assert.equal(strokeEdges([boat(3,.20,true)],rec2).length,1,'and the second dip is heard');

// The tip height three-water.js compares against is its own, so a boat whose mesh has no oar in it
// never has a tip to submerge and never strokes - which is the whole reason nothing here guesses at
// speed or hull length.
assert.equal(strokeEdges([boat(1,.20,false)],rec).length,0,'a hull with no oar rigged never strokes');
assert.equal(strokeEdges([boat(1,.20,true)],rec).length,1,'give it an oar and the first crossing is heard');
assert.equal(rec.size,2,'state is per boat, so one dipping does not arm another');

// --- Cart wheels. The same contract as the oars, on a different field.
//
// v.distance is cumulative metres and simulation.js advances it in exactly one place: inside the
// branch where the convoy actually moves. A convoy that is loading, waiting to be let past, or blocked
// rolls its pose back and never touches it. So "is this cart moving" needs no separate test - and this
// file asserts the fact that makes it true.
const convoySpec=eco.convoys.find(c=>c.route==='caravan-main');
assert.ok(convoySpec,'there is a cart road to have carts on');
assert.equal(eco.routes.find(r=>r.id==='caravan-main').closed,true,
 'the cart road must be closed: on an open route ArcPath.at() would clamp at the end while distance kept growing, and a stopped cart would clack forever');
assert.ok(eco.citizens.some(c=>c.mode==='crew'),'and the crew exclusion crowdNear relies on has members');

const cart=(id,d,speed=.8,x=0)=>({id,cartP:[x,0,0],distance:d,speedNow:speed});
const crec=new Map();
assert.ok(CART_RANGE<SPLASH_RANGE,
 'a strike carries less far than a splash - one visibility distance for both put cart wheels 80m away '
 +'at audible volume in a measured 17-strikes-a-second street');
assert.deepEqual(cartStrikes([cart(0,0)],crec,[0,0,0]),[],
 'a cart already rolling when the bed comes on only primes the record - its first stride started before there was audio');
assert.equal(cartStrikes([cart(0,WHEEL)],crec,[0,0,0]).length,1,'rolling a wheel stride is one strike');
assert.equal(cartStrikes([cart(0,WHEEL)],crec,[0,0,0]).length,0,
 'and a cart standing still is silent, which is what simulation.js:275 gives for free');
const resumed=cartStrikes([cart(0,WHEEL*4)],crec,[0,0,0]);
assert.deepEqual(resumed.map(h=>h.kind).sort(),['hoof','wheel'],
 'a stop-and-go convoy resumes on the next whole stride of each - and one strike per kind however '
 +'many strides it missed, or a stall would come back as a burst');
assert.deepEqual(cartStrikes([cart(0,0,0,200)],crec,[0,0,0]),[],'out of earshot is silent too');
assert.deepEqual(cartStrikes([cart(0,WHEEL*9,0,200)],crec,[0,0,0]),[],
 'and a cart rolling out of earshot drops its record, so coming back only re-primes rather than '
 +'announcing itself with one stray wheel for a stride nobody heard');
assert.deepEqual(cartStrikes([cart(0,WHEEL*10,.8)],crec,[0,0,0]),[],'back within earshot is a first sight again');
assert.deepEqual(cartStrikes([cart(0,WHEEL*11,.8)],crec,[0,0,0]).map(h=>h.kind).sort(),['hoof','wheel'],
 'and the strides after that are heard');
assert.equal(crec.size,1,'state is per cart');

// Level follows speedNow, because distance keeps advancing through the deceleration ramp: a cart
// pulling away from a stand would otherwise clack at full volume for its first metre.
const fast=cartStrikes([cart(0,WHEEL,0)],new Map(),[0,0,0]);   // 0m travelled: primed only
const lvl=(d,speed)=>{const r=new Map();cartStrikes([cart(0,0,speed)],r,[0,0,0]);return cartStrikes([cart(0,d,speed)],r,[0,0,0]);};
assert.ok(lvl(WHEEL,.8)[0].level>lvl(WHEEL,.05)[0].level,
 'and a cart easing away from a stand is quieter than one at speed');

// Two strides that were the same length would fire on the same frame forever and the cart would sound
// like a metronome. This is the property that says they are not.
let together=0,frames=0;
{const r=new Map();let d=0;cartStrikes([cart(0,0)],r,[0,0,0]);
 while(d<200){d+=.05;const hit=cartStrikes([cart(0,d)],r,[0,0,0]);frames++;
  if(hit.length===2)together++;}}
assert.ok(together/frames<.25,
 `wheel and hoof must not stay locked together; they coincide on ${(together/frames*100).toFixed(0)}% of samples, which is what a shared stride would give`);
assert.notEqual(WHEEL,HOOF,'the two strides are deliberately different lengths');

// --- The duck signal. A getter with a watchdog, not an event: every path that starts a sound has
// exactly one matching end because they all funnel through active/clip already, and an event channel
// here had five ways to latch on - an audition passes no done callback, a clip's ended can never fire,
// and a synthesis that fails over to the OS voice starts a second time.
ending='none';
assert.equal(voiceBusy(),false,'nothing is being read to begin with');
spoken.length=0;
speak('这担子沉得很。',{name:'Ting-Ting',lang:'zh-CN'});  // no done callback: this is the audition path
assert.ok(voiceBusy(),'an utterance with nobody listening still has to duck the bed, or 试听 talks over the river');
speak('换一句。',{name:'Ting-Ting',lang:'zh-CN'});
assert.ok(voiceBusy(),'and being replaced does not clear it');
hush();
assert.equal(voiceBusy(),false,'hush silences it');
speak('再念一次。',{name:'Ting-Ting',lang:'zh-CN'},()=>{});
assert.ok(voiceBusy(),'a tracked utterance sounds too');
ending='end';speak('念完了。',{name:'Ting-Ting',lang:'zh-CN'},()=>{});
assert.equal(voiceBusy(),false,'and an utterance that reports its own end releases the bed');
ending='error';speak('念崩了。',{name:'Ting-Ting',lang:'zh-CN'},()=>{});
assert.equal(voiceBusy(),false,'as does one that reports an error');
assert.match(voice,/performance\.now\(\)-busySince<20000/,
 'the watchdog is what makes getting stuck true impossible - an <audio> never hushed and never ended would hold the bed down for the session');

// --- Storage. The memory mirror is not decoration: localStorage throws in a private window, and an
// ambience switch that forgets itself on every reload is worse than one that never had a slider.
const mem=new Map();
globalThis.localStorage={getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};
setAmbienceOn(true);
assert.equal(mem.get('qm-ambience'),'1','and it removes the key rather than storing a false, like voice.js');
assert.equal(ambienceOn(),true);
setAmbienceOn(false);
assert.ok(!mem.has('qm-ambience'),'turning it off clears the record');
assert.equal(ambienceOn(),false);
assert.equal(ambienceVol(),.6,'the bed opens quiet: it is a background, not a second narrator');
setAmbienceVol(2);assert.equal(ambienceVol(),1,'and the slider cannot be pushed past full');
setAmbienceVol(-1);assert.equal(ambienceVol(),0,'or below silence');
setAmbienceVol(.35);assert.equal(mem.get('qm-ambience-vol'),'0.35','and it persists');

// --- The graph, against a fake context. The one ordering that actually matters is that resume() has
// settled before the first start(): a source scheduled against a suspended context's currentTime is
// scheduled at a point the clock has not reached.
//
// `ramped` records [value, node] rather than the value alone. With three buses in the graph a bare
// "something called setTargetAtTime" assertion would now be satisfied by any of them, and the duck
// regression this section exists to catch - the bed staying loud under a line of dialogue - would go
// undetected while the test still passed.
const started=[],ramped=[],listeners={};
class FakeNode{
 constructor(kind){this.kind=kind;this.gain={value:0,setTargetAtTime:(v,t,c)=>ramped.push([v,this])};
  this.playbackRate={value:1};this.out=[];}
 connect(n){this.out.push(n);return n;}
 start(){started.push(this);}stop(){this.stopped=true;}}
let resumes=0;const ctxs=[];
globalThis.AudioContext=class{
 constructor(){this.state='suspended';this.sampleRate=RATE;this.currentTime=0;
  this.destination=new FakeNode('destination');ctxs.push(this);}
 createGain(){return new FakeNode('gain');}
 createBufferSource(){return new FakeNode('bufferSource');}
 createBuffer(ch,len){return{length:len,copyToChannel(){}};}
 resume(){resumes++;this.state='running';return Promise.resolve();}
 close(){this.state='closed';}};
globalThis.document={addEventListener:(k,f)=>{listeners[k]=f;},removeEventListener:(k)=>{delete listeners[k];}};

const reachesDest=s=>{let node=s,got=false;
 while(node&&!got){got=node.kind==='destination'||node.out.some(n=>n.kind==='destination');
  if(!got)node=node.out[0];}
 return got;};
// Reachability alone is too weak: a source wired straight to the speakers still reaches them, and
// would still pass the check above while escaping the duck and the volume slider entirely. Every bed
// has to arrive as source -> its own mix node -> a bus -> master -> destination, four hops.
const hopsToDest=s=>{let node=s,n=0,got=false;
 while(node&&!got&&n<12){got=node.kind==='destination'||node.out.some(x=>x.kind==='destination');
  if(got)break;node=node.out[0];n++;}
 return n+1;};

assert.equal(ambienceRunning(),false,'nothing is running until the reader asks for it');
assert.equal(await startAmbience(),true,'a browser with Web Audio can start');
assert.ok(resumes>0,'which must resume first - an unresumed context schedules the bed at a time the clock has not reached');
assert.equal(started.length,4,'two water beds, one wind and one market, and nothing else');
for(const s of started){
 assert.ok(reachesDest(s),'a source started before it reaches the destination plays nothing at all');
 assert.equal(hopsToDest(s),4,
  'and it has to arrive through a bus and the master, not straight to the speakers - a source wired '
  +'directly to destination plays at full volume through a line of dialogue and a slider turned to zero');}
assert.ok(listeners.visibilitychange,'a context suspended in a background tab comes back muted without this');
ramped.length=0;
updateAmbience({river:{boats:[boat(0,.2,true)]}},[0,0,0],{now:0});
assert.ok(ramped.some(([,n])=>n.kind==='gain'),
 'the duck has to write a gain every frame, and read it from voiceBusy');
assert.ok(ramped.length>=4,'the duck plus the three bus trims, or the mix is not being driven at all');
stopAmbience();
assert.equal(ambienceRunning(),false,'and turning it off tears the context down rather than leaving it suspended');
assert.equal(listeners.visibilitychange,undefined,'unlistening too, or a stopped bed is woken by the next tab switch');

// --- Hawker cries: the only part of the bed that costs money. Two contracts matter here and neither
// is audible - a reader without a key must spend nothing at all, and a reader with one must not be
// charged for all eight cries the moment they switch it on.
assert.ok(CRIES.length>=6,'a market with one cry in it is a beep');
for(const c of CRIES){
 assert.ok(c.length<=6,`a cry is short or it is a sentence: ${c}`);
 assert.doesNotMatch(c,/[A-Za-z]/,`${c} carries Latin - the English set waits on the unverified English voice id`);}

await startAmbience();
let requests=0;
globalThis.fetch=async(url,init)=>{requests++;return{ok:true,status:200,
 json:async()=>({base_resp:{status_code:0,status_msg:'success'},data:{audio:'4944330400000000'}})}};
// The frames have to yield. Driving simulated time in a tight synchronous loop leaves no chance for the
// fetch to resolve, so ttsBusy() stays true and the scheduler is gated after its very first cry - which
// would make every bound below pass without ever testing anything.
const run=async(seconds,opts)=>{const c=ctxs[ctxs.length-1];
 for(let i=0;i<seconds*10;i++){c.currentTime+=0.1;updateAmbience({river:{boats:[]}},[0,0,0],opts);
  if(i%4===3)await tick();}
 await tick();await tick();};

await run(600,{});
assert.equal(requests,0,'no key means no cries and - the point of the assertion - no request either');
await run(600,{key:'k',provider:{id:'anthropic'}});
assert.equal(requests,0,'and a provider the TTS endpoint is not behind spends nothing either');

await run(90,{key:'k',provider:{id:'minimax'}});
assert.ok(requests>0,'a MiniMax key does buy hawkers');
assert.ok(requests<=2,
 `cries are synthesised the first time one is about to be heard, not all up front: ${requests} requests in the first 90 seconds of a market holding ${CRIES.length}`);
await run(900,{key:'k',provider:{id:'minimax'}});
assert.ok(requests<=CRIES.length,
 `and each is then reused rather than re-bought: ${requests} requests over fifteen minutes of cries for ${CRIES.length} cries`);

// An abort is the dialogue winning a race it should have won, not a broken key: retrying it is free
// and re-spending it is not. The distinction is the whole reason this set exists rather than a retry.
await run(600,{});
stopAmbience();

// --- The wiring. These read the source the way tests/voice.mjs does, because a control that is
// present in the markup but unreachable from a handler is a control nobody has.
assert.ok(html.includes('id="ambience"')&&html.includes('id="ambience-vol"'),'the switch and the slider each need a real id');
assert.match(html,/<label class="amb-row"><input id="ambience" type="checkbox"> <span data-i18n="tglAmbience">/,
 'data-i18n belongs on the caption span, never on the label that also holds the input - applyStatic assigns textContent and would delete the control');
assert.match(html,/class="range-label" for="ambience-vol"/,'the slider follows the panel\'s existing range pattern rather than inventing one');
assert.ok(html.includes('id="ambience-scene"'),'and the place the reader is standing has a node of its own');
assert.doesNotMatch(html,/id="ambience-scene"[^>]*data-i18n/,
 'which must NOT carry data-i18n: applyStatic would overwrite the district name with the chrome label on every language toggle, and only a hook could put it back');
for(const key of ['tglAmbience','lblAmbVol']){
 assert.match(i18n,new RegExp(key+`:\\['[^']+','[^']+'\\]`),`${key} needs both languages or tests/i18n.mjs fails`);
 assert.ok(html.includes(`data-i18n="${key}"`),`and ${key} is what the markup asks for`);}
assert.match(app,/\$?\(?'?#ambience'\)\.onchange=async e=>\{[\s\S]*?await startAmbience\(\);else stopAmbience\(\);/,
 'the context is built inside the click, because one made without a user gesture never leaves suspended');
// The one way to start the bed was the switch itself, which meant reloading with 市声 already stored as
// on gave a ticked box over a silent city and no way out but to find that switch and cycle it. The
// first gesture anywhere has to build the context instead.
assert.ok(app.includes("document.addEventListener('pointerdown',arm)")&&app.includes("document.addEventListener('keydown',arm)"),
 'a stored-on preference has to be honoured by the first gesture anywhere in the page, not only by unticking and reticking this one switch');
assert.match(app,/const arm=\(\)=>\{[\s\S]*?startAmbience\(\)/,'and that gesture is what builds the context');
assert.ok(app.includes("if(ambienceOn()&&!ambienceRunning())"),'and only when there is something to honour');
assert.match(i18n,/ambPending:\['[^']+','[^']+'\]/,
 'and the row has to say so while it is waiting, or it is the same checked box over silence by another name');
assert.ok(app.includes("t('ambPending')"),'which means resolving it from JS - applyStatic would wipe a data-i18n on this node');
assert.match(amb,/voiceBusy\(\)\?DUCK:1/,'the bed ducks against the getter');
assert.doesNotMatch(amb,/onVoice|addEventListener\('voice/,'and not through a second event channel that could latch on');
assert.ok(app.includes('updateAmbience(engine,camera.eye,{key:readKey(),provider:readProvider()'),
 'driven from the frame that already exists rather than a second rAF that could drift - a prefix match, because opts legitimately grew a timestamp for the scene classifier');
assert.ok(app.includes('showScene()'),'and the place name is written from that same frame, not from setView, which returns while the camera is still flying');
assert.match(app,/onLang\(\(\)=>\{[^}]*resetScene\(\)/,
 'a language switch has to drop the cached label, or the readout keeps the old language until the reader happens to walk somewhere new');
assert.match(amb,/lifeRiver/,'against the river curve simulation.js already exports, not a copy of it');

// --- The classifier, through the engine it is given rather than through arrays it was handed.
resetScene();
const bare=classify({life:{config:{citizens:eco.citizens}},navigation:{data:nav}},[0,4,0],0);
assert.ok(bare.street>STREET*.4,
 `the bridge at model origin really is a busy street, and the classifier has to find that from the data alone: ${bare.street.toFixed(3)}`);
assert.ok(bare.district,'and it names where it is');
assert.equal(resetScene()||sceneDistrict(),null,'reset clears it, so a language switch re-resolves from scratch');
const missing=classify({},[0,4,0],1);
assert.equal(missing.street,STREET,
 'an engine with no life is FULL street weight, not silence - absence of data is not evidence of an '
 +'empty street, and this is the same default the hawker gate depends on');

// The label has to follow the reader across the city, and the mix has to move with it. classify takes
// the camera the way updateAmbience does - WORLD space, which is model [x,y,z] as [x,z,-y] - so the
// conversion is not optional: feeding it the model triple puts the river distance and the altitude in
// each other's places, and every assertion below then passes or fails for the wrong reason.
resetScene();
const full={life:{config:{citizens:eco.citizens}},navigation:{data:nav}};
const labels=eyes.map((e,i)=>{
 const s=classify(full,[e[0],e[2],-e[1]],i*1000);
 return {v:i+1,d:s.district,w:s.water,st:s.street};});
assert.ok(new Set(labels.map(l=>l.d)).size>=5,
 `the label has to change as the reader moves; ten views produced only ${new Set(labels.map(l=>l.d)).size} places: ${labels.map(l=>l.d).join(' ')}`);
assert.equal(labels[4].d,'05_Main_street','view 5 is the main street');
assert.equal(labels[1].d,'03_Hongqiao','view 2 is the bridge');
assert.ok(labels[1].w>=labels[1].st,'where the river is loudest it must not be drowned by the street');
assert.ok(labels[4].st>labels[4].w,'and on the main street the reverse');

console.log(`ambience: ok — loop seam over twelve seeds: median ${med(circ).toFixed(2)}x, worst ${worst(circ).toFixed(2)}x an interior step `
 +`(single filtering pass: median ${med(sing).toFixed(2)}x, worst ${worst(sing).toFixed(2)}x); `
 +`three buses summing to ${BUS} at BED ${BED.toFixed(4)}, so the loudest the bed can be is the ${(BED*BUS).toFixed(2)} it was; `
 +`view 1 is ${open.n} people and ${(open.water/open.street).toFixed(1)}x water over street, view 5 is ${main.n} and street wins; `
 +`duck is a getter with a 20s watchdog.`);