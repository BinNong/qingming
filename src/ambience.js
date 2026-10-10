// The city behind the voice. Water, wind, oars, cart wheels, hoofbeats and hawker cries, synthesised
// from noise at load: no network, no key, no money, and a buffer this app can test by asserting on
// samples rather than by opening a browser.
//
// The reason it is noise and not a generated music track: minimax music-2.6 takes 30-90s, has no
// duration parameter, has no loop or ambience mode (is_instrumental only removes vocals), prices its
// paid tier nowhere in the vendor's own material, and lives on api.minimaxi.com rather than the .cn
// host src/tts.js uses. A bed that cannot be looped and costs a minute to make is not a bed.
//
// The reason the bed does not win every argument: the line of dialogue is the payload and this has to
// stay under it. Hence BED below 1, a duck while anything is being read, and a floor on the water
// gain that is low enough to hear but never silent.
//
// Three buses, not one dimmer - that is the whole of the second pass. Water, wind and street each
// carry their own weight and the mix between them is what says which part of the city you are in.

import {lifeRiver} from './simulation.js';
import {voiceBusy,ttsReady,readTtsVoice} from './voice.js';
import {synthesize,pickVoice,ttsBusy} from './tts.js';
import {getLang} from './i18n.js';

// Restated from simulation.js:351 rather than imported, exactly as advanced-river.js:217 does - the
// shared half-width of the river, used here only to turn a position into "how far from the bank".
const CHANNEL=14.25;
// Away from the water means quieter, never gone. The floor is load-bearing: the default view's eye
// sits 57m off the centreline, so a falloff that reaches zero opens on a silent city.
const FLOOR=.3,SPAN=40;
// ecology.json's own seed. Determinism is the point - the river should sound like this river, not
// like a different one each reload - and it is also what makes the sample assertions reproducible.
const SEED=4812;
// three-water.js:37's own test for "the oar tip is in the water". Reused rather than reinvented so the
// splash lands exactly where the spray the reader can already see is being drawn.
const SUBMERGE=.36;
// Ducking takes 6dB off while a line is being read.
const DUCK=.5;
const BED_SECONDS=10,LOOP_AT=0.043,WIND_AT=0.11;

// --- The three bus weights, and the bed level derived from them.
// Adding buses must not make the city louder, so BED is not a number anyone tunes: it is the loudest
// the bed was before this split, divided by what the buses now sum to at their busiest. Retune a
// weight and the peak follows it. tests/ambience.mjs asserts BED*BUS === 0.1 for exactly this reason.
//
// Measured across the ten real views afterwards, every place lands within about 3dB of where it was -
// this is a change of MIX, not of loudness. The water-over-street ratio is what swings: +14dB of water
// from the opening panorama, -3dB of street at the city gate.
const WIND=.30,STREET=.50;
const BUS=1+WIND+STREET;
const BED=.1/BUS;
// Exported so tests/ambience.mjs can assert the invariant BED*BUS === 0.1 rather than retyping 0.1
// next to the code it is protecting.
export {BUS,BED,WIND,STREET,CROWD_LO,CROWD_HI,WHEEL,HOOF,CART_RANGE,SPLASH_RANGE};

// --- How busy the street is. CROWD_LO and CROWD_HI are the extremes actually measured over the ten
// named views and every walk landmark in ecology.json (19 at view 6, which looks down on the south
// courtyards; 107 on the main street at view 5), NOT round numbers. The real spread is 15dB and this
// maps it to 15dB of gain; widening the span would amplify the data into more range than it has, which
// is the same kind of lie as a hand-tuned curve.
const CROWD_R=30,CROWD_LO=19,CROWD_HI=107;
// Wind rises with height. Height is the one scene signal genuinely independent of the river - it is
// why this is not just riverGain again - and it is what separates the 43m-high opening panorama from
// the 4m-deep canyon of the main street.
const WIND_LO=.55,WIND_HI=1,WIND_SPAN=40;
// Wheel and hoof strides, in metres of travel. Deliberately incommensurate: at the same length they
// would fire on the same frame forever and the cart would sound like a metronome.
const WHEEL=.7,HOOF=1.2;
// Two hearing distances, not one visibility distance. A splash is a broadband wash that carries; an
// iron rim striking stone is a sharp transient that does not. Measured in the browser with all seven
// convoys in earshot on the main street, a shared 90m gave 17 strikes a second including two carts
// 50m and 80m away - the near ones were not audible over their own neighbours. A strike carries about
// 55m in a busy street.
const CART_RANGE=55,SPLASH_RANGE=90;
// A hawker in a courtyard or over open water is wrong. Below this the market has nothing to say here.
const CRY_STREET=.25;

/** mulberry32. Four lines, and it buys the one assertion that matters most: this city's noise is the
 *  same noise on every load, so a failing sample assertion is a real change and not a different draw. */
const rng=seed=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);
 t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};

/** White noise, uniform in [-1,1). Length is clamped at one sample: a zero-length AudioBuffer throws
 *  on start(), and "seconds" here comes out of arithmetic that can reach zero. */
export function noiseBuffer(rate,seconds,seed){
 const n=Math.max(1,Math.round(rate*seconds)),out=new Float32Array(n),r=rng(seed);
 for(let i=0;i<n;i++)out[i]=r()*2-1;
 return out;}

/** Turn white noise into something with weight, and make it safe to loop.
 *
 *  The loop seam is the whole reason for the second pass, and it only exists at all because the noise
 *  gets lowpassed: measured as the wrap step against the *median* interior one-sample step, over twelve
 *  seeds, white noise is 0.16x (there was never a seam to fix), a single filtering pass ranges from
 *  0.16x to 5.59x depending on the seed, and this stays inside 0.39x-1.59x. Crossfading the end
 *  instead is not the answer either - it reaches 5.4x, because a blend leaves the broadband step
 *  sitting at the fold rather than removing it.
 *
 *  Filtering the signal twice and keeping the second half makes sample 0 the output of a filter state
 *  that has already consumed the whole buffer, so wrapping costs one ordinary step and no more. */
export function brownFilter(buf,cut,rate){
 const n=buf.length,a=1-Math.exp(-2*Math.PI*cut/rate),d=new Float32Array(n*2),out=new Float32Array(n);
 d.set(buf,0);d.set(buf,n);
 let s=0;
 for(let i=0;i<n;i++)s+=a*(d[i]-s);
 for(let i=n;i<n*2;i++){s+=a*(d[i]-s);out[i-n]=s;}
 let peak=0;
 for(let i=0;i<n;i++)peak=Math.max(peak,Math.abs(out[i]));
 if(peak>0)for(let i=0;i<n;i++)out[i]=out[i]/peak*.9;
 return out;}

/** One splash, reused for every stroke. A short lowpassed burst with a fast attack and a longer tail
 *  so it reads as a dip rather than a click; the variation between strokes comes from the playback
 *  rate and start offset, not from generating 12 boats' worth of one-shots. */
export function splashBuffer(rate,seed){
 const n=Math.max(1,Math.round(rate*.32)),out=new Float32Array(n),r=rng(seed),
  a=1-Math.exp(-2*Math.PI*1500/rate);
 let lp=0,peak=0;
 for(let i=0;i<n;i++){const t=n<2?1:i/(n-1);lp+=a*(r()*2-1-lp);
  out[i]=lp*Math.min(1,i/(rate*.008))*Math.pow(1-t,3.5);peak=Math.max(peak,Math.abs(out[i]));}
 if(peak>0)for(let i=0;i<n;i++)out[i]/=peak;
 return out;}

/** The market: one AudioBuffer holding two summed bands, because the point is that it is a bed and
 *  not a set of voices. Two layers because a single band of noise is not a crowd - the low one is the
 *  hum of many people at once, the high one the edge on the consonants. Summed here rather than run as
 *  two sources so the flutter below has one node to modulate.
 *
 *  The flutter is what actually separates "a market" from "wind", and it is not a spectral choice:
 *  brownFilter is a single-pole lowpass and peak-normalises to 0.9, so measured RMS at 260Hz, 420Hz
 *  and 600Hz is 0.2004 / 0.1993 / 0.1998 - one number, and the cutoff buys nothing after
 *  normalisation. A dense 2-6Hz shimmer and a slow swell are audibly different things; a cutoff
 *  between 260 and 420 is not. Both buffers here are circular by construction, so summing them keeps
 *  the loop clean - tests/ambience.mjs asserts the seam on this as well as on brownFilter itself. */
export function murmurBuffer(rate,seed){
 const lo=brownFilter(noiseBuffer(rate,BED_SECONDS,seed),600,rate),
  hi=brownFilter(noiseBuffer(rate,BED_SECONDS,seed^0x9e37),1800,rate),
  out=new Float32Array(lo.length);
 for(let i=0;i<out.length;i++)out[i]=lo[i]+hi[i]*.5;
 let peak=0;
 for(let i=0;i<out.length;i++)peak=Math.max(peak,Math.abs(out[i]));
 if(peak>0)for(let i=0;i<out.length;i++)out[i]=out[i]/peak*.9;
 return out;}

/** An iron-rimmed wheel on stone: bright, very short, and gone almost immediately. Two one-pole taps
 *  for the ring and the body under it - a single band here is a click, not a struck wheel. */
export function clackBuffer(rate,seed){
 const n=Math.max(1,Math.round(rate*.045)),out=new Float32Array(n),r=rng(seed),
  a=1-Math.exp(-2*Math.PI*2600/rate),b=1-Math.exp(-2*Math.PI*900/rate);
 let ring=0,body=0,peak=0;
 for(let i=0;i<n;i++){const w=r()*2-1;
  ring+=a*(w-ring);body+=b*(w-body);
  const t=n<2?1:i/(n-1);
  out[i]=(ring*.75+body*.6)*Math.exp(-t*9)*Math.min(1,i/(rate*.0012));
  peak=Math.max(peak,Math.abs(out[i]));}
 if(peak>0)for(let i=0;i<n;i++)out[i]/=peak;
 return out;}

/** A hoof on packed earth: duller and longer than the wheel, and it is the repetition of the two
 *  together that reads as "cart" rather than "two noises". */
export function hoofBuffer(rate,seed){
 const n=Math.max(1,Math.round(rate*.09)),out=new Float32Array(n),r=rng(seed),
  a=1-Math.exp(-2*Math.PI*320/rate);
 let lp=0,peak=0;
 for(let i=0;i<n;i++){const t=n<2?1:i/(n-1);lp+=a*(r()*2-1-lp);
  out[i]=lp*(Math.exp(-t*6)+.35*Math.exp(-t*22))*Math.min(1,i/(rate*.004));
  peak=Math.max(peak,Math.abs(out[i]));}
 if(peak>0)for(let i=0;i<n;i++)out[i]/=peak;
 return out;}

/** How much river to hear from a point in model space (Z-up: x east, y along the scroll). */
export function riverGain(mx,my){
 const d=Math.abs(my-lifeRiver(mx))-CHANNEL;
 return d<=0?1:Math.max(FLOOR,1-d/SPAN);}

/** How busy this place is, from how many of the city's own people are standing in it.
 *
 *  `n` is counted over ecology.json's `citizens[].anchor`, which does not move: a place has a
 *  character, and the bed should not flicker every time one individual walks past. The things that DO
 *  move - oars, wheels, cries - are separate one-shots on top of this. */
export function streetGain(n){
 const u=(n-CROWD_LO)/(CROWD_HI-CROWD_LO);
 return u<0?0:u>1?1:u;}

/** Wind with altitude. 55% in a street canyon, full on the opening panorama's 43m eyeline. */
export function windShape(h){
 const u=h/WIND_SPAN;
 return WIND_LO+(WIND_HI-WIND_LO)*(u<0?0:u>1?1:u);}

/** How many of the city's people are within `r` of a plan-space point.
 *
 *  Returns **-1 when there is no data**, which is not zero. An absent ecology means this module
 *  cannot tell a market from a courtyard, and guessing "empty street" would silence the hawkers over
 *  a city that is in fact full of them. The caller turns -1 into full weight. */
export function crowdNear(citizens,mx,my,r=CROWD_R){
 if(!citizens||!citizens.length)return -1;
 let n=0;const r2=r*r;
 for(const c of citizens){
  if(c.mode==='crew')continue;
  const a=c.anchor,dx=a[0]-mx,dy=a[1]-my;
  if(dx*dx+dy*dy<r2)n++;}
 return n;}

/** Boats whose oar tip went under since the last call.
 *
 *  Not a heuristic on speed: three-water.js finds each hull's oar tip by scanning its own mesh for
 *  region-301 vertices, so `oarContacts` is empty for a boat that has no oar rigged at all. Whether
 *  something is rowing is read out of the art assets, not guessed from a velocity.
 *
 *  The trigger is the tip crossing SUBMERGE downward - the same test the water's own spray uses - so
 *  the sound lands where the spray already is. A boat only strokes once it has been seen once: on
 *  first sight `was` is undefined, which is deliberately not `false`, so switching the ambience on
 *  beside a boat already mid-stroke does not fire one splash for a dip that started before there was
 *  any audio. Pure apart from `rec`, so the cadence is assertable with no AudioContext. */
export function strokeEdges(boats,rec){
 const hits=[];
 for(const b of boats){
  const tip=b.oarContacts&&b.oarContacts[0];
  const now=!!tip&&tip.position[1]<SUBMERGE,was=rec.get(b.index);
  rec.set(b.index,now);
  if(now&&was===false)hits.push({index:b.index,position:tip.position,strength:tip.strength});}
 return hits;}

/** Carts whose wheel or hoof has turned over a whole stride since the last call.
 *
 *  `v.distance` is cumulative metres and advances in exactly one place - simulation.js:275, inside
 *  the branch where the convoy actually moves. A convoy that loads, waits to be let past, or is
 *  blocked rolls its pose back and never touches it, so a stopped cart is silent for free, with no
 *  separate "is it moving" test to keep in sync with the simulation. It is also the same field the
 *  renderer writes into the wheel rotation (simulation.js:340), so the sound is in phase with the
 *  animation by construction rather than by coincidence.
 *
 *  Level scales with speedNow, because distance keeps advancing through the deceleration ramp: a cart
 *  pulling away from a stand would otherwise clack at full volume for its first metre.
 *
 *  `first sight only primes the record` for the same reason as strokeEdges above - a cart already
 *  rolling when the bed is switched on must not be handed a clack for a stride that started before
 *  there was any audio. Leaving the radius does the same thing to the record, so a cart walking into
 *  earshot primes rather than announcing itself with one stray wheel. */
export function cartStrikes(convoys,rec,eye){
 const hits=[];
 for(const v of convoys||[]){
  const d=Math.hypot(v.cartP[0]-eye[0],v.cartP[1]+eye[2]);
  if(d>CART_RANGE){rec.delete(v.id);continue;}
  const w=Math.floor(v.distance/WHEEL),h=Math.floor(v.distance/HOOF),was=rec.get(v.id);
  if(was&&was.w===w&&was.h===h)continue;
  rec.set(v.id,{w,h});
  if(!was)continue;
  const level=Math.min(1,(v.speedNow||0)/.3);
  if(w>was.w)hits.push({id:v.id,d,kind:'wheel',level});
  if(h>was.h)hits.push({id:v.id,d,kind:'hoof',level});}
 return hits;}

// --- Where the reader is, by name. navigation.json gives every building a district, and the nearest
// one is a good answer every time it is asked: view 1 lands on 07_South_courtyards 6m away, the
// bridge on 03_Hongqiao at 11m, the main street on 05_Main_street at 12m.
//
// Plan distance, not 3D - the same reason riverGain takes a plan-space pair. View 1's eye is 43m up
// and 41m from anything in 3D, which would name the empty air above the city.
//
// The 212 instances with no district are skipped here rather than resolved at the call site: `district()`
// returns the raw id for anything it does not know, which on screen is a blank row.
let siteX=null,siteY=null,siteD=null;
function prepareSites(nav){
 const list=nav&&nav.data&&nav.data.instances;
 if(!list)return false;
 const xs=[],ys=[],ds=[];
 for(const i of list){if(!i.district)continue;xs.push(i.matrix[12]);ys.push(i.matrix[13]);ds.push(i.district);}
 siteX=Float32Array.from(xs);siteY=Float32Array.from(ys);siteD=ds;return true;}

/** The nearest districted building, in plan space.
 *
 *  There is deliberately no distance hysteresis here, though there was. It was added to stop the readout
 *  flickering - view 3's nearest building is 1.3m away, so a centimetre of camera motion swaps the
 *  winner - but the classifier only runs when the eye has moved more than half a metre, so a reader
 *  standing still was never going to see a flicker anyway. The hysteresis bought nothing and cost a
 *  real latch: districts interleave in plan, so the incumbent's own distance often sits just far enough
 *  away to block a legitimate switch, and one bad comparison pinned the label for the session. */
export function nearestDistrict(mx,my){
 if(!siteX||!siteX.length)return null;
 let best=1e9,id=null;
 for(let i=0;i<siteX.length;i++){
  const dx=siteX[i]-mx,dy=siteY[i]-my,d=dx*dx+dy*dy;
  if(d<best){best=d;id=siteD[i];}}
 return {id,d:Math.sqrt(best)};}

const ON='qm-ambience',VOL='qm-ambience-vol';// The memory mirror is not optional: localStorage throws in a private window, and an ambience switch
// that silently resets on every reload is worse than one that remembers. Same reason as voice.js:21-26.
let lastOn=false,lastVol=.6;
export const ambienceOn=()=>{try{lastOn=localStorage.getItem(ON)==='1';}catch(_){}return lastOn;};
export const setAmbienceOn=v=>{lastOn=!!v;try{lastOn?localStorage.setItem(ON,'1'):localStorage.removeItem(ON);}catch(_){}};
export const ambienceVol=()=>{try{const v=parseFloat(localStorage.getItem(VOL));if(!Number.isNaN(v))lastVol=v;}catch(_){}return lastVol;};
export const setAmbienceVol=v=>{lastVol=Math.min(1,Math.max(0,v));
 try{localStorage.setItem(VOL,String(lastVol));}catch(_){}};

let actx=null,master=null,splash=null,clack=null,hoof=null,beds=[],buses=[],live=new Set(),
 submerged=new Map(),rolled=new Map();
const jitter=rng(SEED^0x51ed);
/** Two slow incommensurable sines so the bed never settles into a pulse a listener can lock onto. */
const breathe=t=>1+.18*Math.sin(t*WIND_AT)+.09*Math.sin(t*LOOP_AT+1.7);
/** The market's own flutter: dense and fast, so it shimmers the way a crowd does instead of swelling
 *  the way wind does. It multiplies the murmur's own node, never the street bus - the bus also carries
 *  the cries and the cart one-shots, and pumping those at 4Hz would wobble a spoken word.
 *  Normalised to peak at 1 so the bus trim stays the only level control: these four terms otherwise sum
 *  to 1.14 at their extreme, and a bed that quietly overdrives its own trim is not a bed anyone can
 *  reason about. */
const flutter=t=>(.72+.20*Math.sin(t*3.9)+.13*Math.sin(t*6.1+2.2)+.09*Math.sin(t*2.3+.8))/1.14;
export const ambienceRunning=()=>!!actx;

const audioBuffer=(c,samples)=>{const b=c.createBuffer(1,samples.length,c.sampleRate);
 b.copyToChannel(samples,0);return b;};

/** Build the graph. Called from the toggle's click, never earlier: a context created without a user
 *  gesture starts suspended and stays there, and an ambience switch that shows a checked box over a
 *  silent city is the bug this placement exists to prevent.
 *
 *  Two nodes per bed, and the split is load-bearing. The bus carries the scene trim and is only ever
 *  written with setTargetAtTime; the bed's own mix level sits on a node below it and keeps the plain
 *  `.value=` the existing code uses. Writing `.value` inserts a setValueAtTime at currentTime, which
 *  cancels a pending ramp on that same node - so a per-frame `.value=` on the bus would silently kill
 *  every scene transition, and it would look like the mix working. */
export async function startAmbience(){
 if(actx){if(actx.state==='suspended')try{await actx.resume();}catch(_){}return true;}
 const AC=globalThis.AudioContext||globalThis.webkitAudioContext;
 if(!AC)return false;
 const c=actx=new AC();
 // The resume has to settle before the first start(): a source started against a suspended context's
 // currentTime is scheduled at a point the clock has not reached, so it opens late or not at all.
 if(c.state==='suspended')try{await actx.resume();}catch(_){}
 master=c.createGain();master.gain.value=0;master.connect(c.destination);
 // Every source below reaches the speakers through a bus and then master. A one-shot wired straight to
 // destination would escape both the duck and the volume slider, which is exactly the kind of bug that
 // only shows up while someone is trying to hear a line of dialogue.
 buses=[['water',1],['wind',WIND],['street',STREET]].map(([name])=>{
  const g=c.createGain();g.gain.value=0;g.connect(master);
  return {name,g,trim:g.gain.value};});
 const bus=name=>buses.find(b=>b.name===name).g;
 const r=c.sampleRate;
 splash=audioBuffer(c,splashBuffer(r,SEED^7));
 clack=audioBuffer(c,clackBuffer(r,SEED^0x3c));
 hoof=audioBuffer(c,hoofBuffer(r,SEED^0x68));
 const loop=(samples,mix,to,fluttered)=>{
  const src=c.createBufferSource();src.buffer=audioBuffer(c,samples);
  const g=c.createGain();g.gain.value=mix;
  src.loop=true;src.connect(g).connect(to);src.start(0);
  return {src,g,mix,fluttered:!!fluttered};};
 beds=[loop(brownFilter(noiseBuffer(r,BED_SECONDS,SEED+420),420,r),1,bus('water')),
  loop(brownFilter(noiseBuffer(r,BED_SECONDS,SEED+1500),1500,r),.34,bus('water')),
  loop(brownFilter(noiseBuffer(r,BED_SECONDS,SEED^0x2f),300,r),1,bus('wind')),
  loop(murmurBuffer(r,SEED^0xb1),1,bus('street'),1)];
 // Chrome may suspend the context after a few minutes in a background tab. Without this a reader who
 // comes back finds a checked box and no sound, and the only way out is to toggle it twice.
 c.onstatechange=null;
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',wake);
 return true;}

const wake=()=>{if(actx&&actx.state==='suspended'&&!(typeof document!=='undefined'&&document.hidden))
 try{actx.resume();}catch(_){}};

export function stopAmbience(){
 if(typeof document!=='undefined')document.removeEventListener('visibilitychange',wake);
 for(const s of live)try{s.stop();}catch(_){}
 live.clear();
 if(actx)try{actx.close();}catch(_){}
 // `rolled` has to go with `submerged`: after a restart every convoy's stride counter is a large
 // number against no record, and without this every cart in the city clacks exactly once on the
 // first frame back - the same trap strokeEdges' was===false guard exists to close.
 actx=master=splash=clack=hoof=null;beds=[];buses=[];submerged.clear();rolled.clear();
 scene=null;cries.clear();nextCry=0;}

// --- Hawker cries: the only part of this bed that costs anything.
//
// Fixed ritual cries, not generated dialogue. A 卖糖人 calls 糖 and nothing else, and that is what makes
// it a street cry rather than a sentence - eight of them, two to five characters, which is also why
// they are cheap: 3.5 元/万字符 with 1 汉字 = 2 字符 puts one at about 0.002 元.
//
// Chinese only, and that is a decision rather than an omission. The English voice id is still
// unverified, so there is no honest way to ship an English set, and a bed is the last place to find out.
export const CRIES=['糖——','热豆腐——','磨剪子嘞——','烧饼——','冰糖葫芦——','热汤圆——','白——糖——','甜瓜——'];

let cries=new Map(),cryFailed=new Set(),nextCry=0;
// A cry has to carry over the murmur it lands in, and it arrives through the street bus - which is
// trimmed to STREET (0.5) and then master (BED = 0.1/1.8). So its own gain is set against that chain's
// nominal, not against 1, and it was re-derived here rather than carried over: the old CRY=4 was
// calibrated against a flat 0.06, and left alone it would have quietly made the hawkers quieter on the
// street, which is the opposite of what they are for.
const CRY=12;
function shout(buf){
 if(!actx||!master)return;
 const g0=buses.find(b=>b.name==='street');
 if(!g0)return;
 const src=actx.createBufferSource();src.buffer=buf;
 const g=actx.createGain();g.gain.value=CRY;
 src.connect(g).connect(g0.g);src.start();
 live.add(src);src.onended=()=>live.delete(src);}

/** Per frame, from app.js's existing animate() rather than a second rAF loop that could drift against
 *  it. `eye` is the camera in world space; the river is authored Z-up, so its y is the negated world z. */
export function updateAmbience(engine,eye,opts={}){
 if(!actx||!master)return;
 const t=actx.currentTime;
 // The duck is the reason the bed is safe to leave on: a line is the payload, and this is the only
 // thing standing between two voices and noise. voiceBusy() is a getter with a watchdog, so a line
 // that somehow never ends costs 20 seconds of quiet rather than the session.
 // Nothing here may throw: app.js calls this inside the try that also re-arms requestAnimationFrame,
 // so one unguarded property read is a frozen city and a permanent error banner.
 const s=classify(engine,eye,opts.now);
 master.gain.setTargetAtTime(BED*ambienceVol()*(voiceBusy()?DUCK:1)*breathe(t),t,.18);
 // Trims go on the bus with a ramp; the bed's own mix level goes on its node below with `.value=`.
 // Both write to the same AudioParam in the spec's eyes if they are the same node, and the mix would
 // snap instead of gliding - see startAmbience.
 for(const b of buses)b.g.gain.setTargetAtTime(s[b.name],t,.18);
 for(const {g,mix,fluttered} of beds)g.gain.value=fluttered?flutter(t):mix;
 // Oars and carts read their state off the engine; the hawkers have none of it, so they are called
 // before those early returns on purpose - hanging them off engine.river would mean a day when the
 // river is missing is also a day the market is silent.
 const boats=engine&&engine.river&&engine.river.boats;
 const carts=engine&&engine.life&&engine.life.convoys;
 hawkers(t,opts,s.street);
 // A splash now plays through the water bus, which is trimmed by how far the reader is from the river.
 // So it is attenuated twice over - once by distance to the boat, once by distance to the bank. That is
 // deliberate and not a double-counting bug: a stroke heard 50m inland is genuinely a smaller sound than
 // the same stroke at the bank, and the alternative is a river that follows its own boats up the street.
 for(const hit of boats?strokeEdges(boats,submerged):[]){
  const dx=hit.position[0]-eye[0],dy=hit.position[1]-eye[1],dz=hit.position[2]-eye[2],
   d=Math.sqrt(dx*dx+dy*dy+dz*dz);
  if(d>SPLASH_RANGE)continue;
  const src=actx.createBufferSource();src.buffer=splash;
  const g=actx.createGain();g.gain.value=Math.pow(1-d/SPLASH_RANGE,2)*.7*(hit.strength||1);
  src.playbackRate.value=.85+jitter()*.4;
  const w=buses.find(x=>x.name==='water');
  src.connect(g).connect(w.g);src.start(0,jitter()*.2);
  live.add(src);src.onended=()=>live.delete(src);}
 for(const hit of carts?cartStrikes(carts,rolled,eye):[]){
  const src=actx.createBufferSource();src.buffer=hit.kind==='wheel'?clack:hoof;
  const g=actx.createGain();g.gain.value=Math.pow(1-hit.d/CART_RANGE,2)*.5*hit.level;
  src.playbackRate.value=.9+jitter()*.25;
  const st=buses.find(x=>x.name==='street');
  src.connect(g).connect(st.g);src.start(0,jitter()*.2);
  live.add(src);src.onended=()=>live.delete(src);}}

/** What the reader is standing in right now, as three bus weights and a place name.
 *
 *  The expensive half - counting the city's own people, and finding the nearest districted building -
 *  is not run every frame. It costs about 6 microseconds (measured: 2.0 for the 559 citizen anchors,
 *  5.0 for the 552 building matrices), which is not a CPU argument; the arguments are that a per-frame
 *  scan allocates in a callback the optimization harnesses A/B for GC jitter, and that the answer does
 *  not change 60 times a second. So it is gated on the eye having actually moved, or 100ms - the same
 *  motion-gating tests/CLAUDE.md describes for InspectUI.probe. A parked camera costs nothing, and a
 *  1600ms setView transition still gets about sixteen samples on the way.
 *
 *  `now` is animate()'s timestamp rather than actx.currentTime, which freezes in a hidden tab and would
 *  hold the classification stale until the reader came back. */
let scene=null,scored=-1e9,seenX=0,seenY=0,seen=false,label='';
// The classifier only runs when the eye has actually moved, so a reader standing still is stable for
// free - that gate is the debounce, and it is why the label needs no hysteresis of its own.
const MOVE=.5,SCENE_MS=100;

export function classify(engine,eye,now=0){
 const life=engine&&engine.life,nav=engine&&engine.navigation,mx=eye[0],my=-eye[2];
 const moved=!seen||Math.hypot(mx-seenX,my-seenY)>MOVE;
 if(!scene||(moved&&now-scored>SCENE_MS)||now<scored){
  scored=now;seen=true;seenX=mx;seenY=my;
  prepareSites(nav);
  const n=crowdNear(life&&life.config&&life.config.citizens,mx,my);
  // -1 is "cannot tell", and it becomes FULL weight rather than silence: absence of ecology data is not
  // evidence of an empty street, and a module that went quiet when its input was missing would be worse
  // than one that guessed busy. Same reasoning as the comment on engine.river below.
  const street=STREET*(n<0?1:streetGain(n));
  const near=nearestDistrict(mx,my);
  if(near)label=near.id;
  scene={water:riverGain(mx,my),wind:WIND*windShape(eye[1]),street,district:label||null};}
 return scene;}

/** The place name for the panel's readout, or null before the first classification. district() resolves
 *  it in both languages, so nothing here needs to know which one is on. */
export const sceneDistrict=()=>scene&&scene.district;

/** Force the next call to classify. Used by a language switch, which has to re-resolve the label from
 *  the same district id - the id is language-independent but the string on screen is not. */
export const resetScene=()=>{scene=null;scored=-1e9;label='';seen=false;};

/** The one part of the bed that spends money, and the only caller of the TTS endpoint that is not the
 *  portrait. Three gates before it costs anything: a key has to be configured at all - no key means no
 *  cries and, just as importantly, no request - there has to be a street here worth shouting in, and
 *  nothing may be speaking or already synthesising, because both would have the next synthesis cancel
 *  each other and take the line of dialogue with it.
 *
 *  Lazy: a cry is synthesised the first time it is about to be heard rather than up front, so a reader
 *  who sits for two minutes may pay for two, not eight. A terminal failure is remembered and never
 *  retried; an abort is not, because an abort is the dialogue winning a race it should have won. */
function hawkers(t,opts,street=1){
 if(!actx||!ttsReady()||getLang()==='en')return;
 // A 卖糖人 does not call out across a courtyard or over open water. `street` is the bus weight, so
 // this also means a cry is quieter on a quiet street than on the main one, without anything else
 // knowing which street it is on.
 if(street<CRY_STREET)return;
 if(voiceBusy()||ttsBusy())return;
 if(!nextCry){nextCry=t+10+jitter()*25;return;}
 if(t<nextCry)return;
 nextCry=t+30+jitter()*40;
 const text=CRIES[(jitter()*CRIES.length)|0];
 if(cryFailed.has(text))return;
 if(cries.has(text)){shout(cries.get(text));return;}
 // The context is captured here rather than read back later: a synthesis takes most of a second, and a
 // reader who switches the bed off in the middle of one must not have that decision - their own, and
 // unrelated to the cry - retire it for the session. That is why every step below checks `c` first.
 const c=actx;
 synthesize(text,{voiceId:readTtsVoice()||pickVoice('zh','vendor'),lang:'zh'})
  // decodeAudioData detaches the ArrayBuffer it is handed, and those bytes are still the clip cache's,
  // so it gets a copy rather than a view.
  .then(clip=>c.decodeAudioData(clip.data.slice().buffer))
  .then(buf=>{if(c!==actx)return;cries.set(text,buf);shout(buf);})
  .catch(err=>{if(c!==actx)return;if(!err||err.name!=='AbortError')cryFailed.add(text);});}