import {getLang,t} from './i18n.js';
import {sayLine} from './voice.js';

/** A person you can point at, described in the language the reader is already reading in.
 *
 *  Everything here is deliberately DOM-and-fetch only. The module never receives the engine and
 *  never touches shadowDirty or the render signature - a panel that could perturb either would
 *  break `?opttest=1`'s exactly-one-frame assertion with no other symptom. tests/ai-story.mjs pins
 *  that as a source-level assertion, because it is invisible until it is already broken.
 *
 *  Two rules are load-bearing and both are enforced by tests:
 *  - Generated prose NEVER goes through t()/T()/E(). `english()` is an unanchored substring table,
 *    so it turns 「八份货物」 into 「八units of cargo」 mid-sentence. Only getLang crosses that line.
 *  - The prose lives in a sibling of #inspect-body, not inside it. show() rebuilds that node
 *    wholesale every 350ms, which would destroy async text three times a second. */

// The model, its key, its prompt and its vendor all live in functions/_shared/ on the server. The
// reader configures nothing: there is no key to type, no endpoint to point at, and no provider to
// choose. What crosses the wire is this module's whole contribution - a fact set resolved against
// the live scene - and the backend decides how to turn that into a question.
//
// The three rules below are what make that safe, and none of them is optional:
//  - The page sends FACTS, never a prompt. A client that could compose its own question would be
//    spending the operator's key on arbitrary text, so the prompt moved to the server with the key.
//  - The reply is still parsed and vetted HERE, not trusted because it came from our own backend.
//    A schema is a request, not a guarantee - the live call that ignored json_schema and invented a
//    porter's name and twelve-year history is why - and now the check has a second reason: it also
//    catches a compromised or misconfigured upstream.
//  - Spending is still an explicit click. offer() runs on a 350ms tick and on every language toggle,
//    so anything that fires a request from it would spend money on readers who only wanted the facts.

// An Opus call with thinking runs 20-60s and browser fetch has no timeout of its own, so without
// this a dropped connection leaves the panel spinning forever. Kept at the original figure: the
// request now has a Function cold start in front of it as well as the model.
const TIMEOUT_MS=45000;

/** The same origin that served the page, and the only thing it talks to. Absolute vendor URLs are
 *  gone from this file entirely: a reader-supplied endpoint was how a browser-held key became an
 *  open relay, and there is nothing left for one to be. */
const API='/api';

/** What this deployment can do. Asked once, at load, because the synthesised voice picker only
 *  means anything when the backend holds a TTS key - a list of vendor voice ids over an instance
 *  with no key is a control that cannot work.
 *
 *  Optimistic on failure: if /api/config itself is unreachable we assume the features are on and
 *  let the request discover otherwise. That is deliberate. The alternative is a page that hides its
 *  best features because a config probe timed out, and every feature here already has a working
 *  fallback - the system voice, the cached portrait, the plain facts. */
let config={prose:true,tts:true};
export const serverConfig=()=>config;
export async function loadConfig(){
 try{const r=await fetch(API+'/config',{headers:{accept:'application/json'}});
  if(r.ok){const j=await r.json();if(j&&typeof j.tts==='boolean')config={prose:!!j.prose,tts:!!j.tts};}}catch(_){}
 return config;}


const ROLE={merchant:'商人',laborer:'劳力',porter:'挑夫',boatman:'舟子',vendor:'摊贩',woman:'妇人',scholar:'学子',guard:'巡城',farmer:'农夫',child:'孩童'};
const MODE={crew:'舟员',traveller:'行旅',resident:'居家',seated:'闲坐',shopkeeper:'看店',porter:'脚夫'};
const CLIP={Work:'劳作',Idle:'静立',Sit:'闲坐',Talk:'攀谈',Walk:'行走',Carry:'负重'};
const STATE={'停留':'停留','搬货':'搬货','返回货埠':'返回货埠','步行':'步行','往来':'往来'};
// --- Boats and the bridge. Same discipline as above: a lookup from a raw data value to the Chinese
// the fact is written in, never english() output. The vessel name (`Vessel_00_Cargo_barge`) is a
// mesh id and is never read; the route name is auto-generated ("Cargo_barge 0 水路") and is not
// worth telling the model either - the type and the quay say everything a 白描 can use. The words
// below are the same ones ENUM already uses for the card, so one vessel is not called 漕船 on the
// card and 商帆船 in the prompt. E() is unreachable from here - it runs model prose through
// english() - so the mapping is duplicated rather than shared, and pinned by tests/i18n.mjs.
const VESSEL={Cargo_barge:'漕船',Trading_sailboat:'商帆',Fishing_rowboat:'渔船',Ferry:'渡船',
 Covered_passenger_boat:'乌篷客船',Courier_skiff:'快脚小船'};
const BOAT_STATE={航行:'航行',靠泊装卸:'靠泊装卸',离泊:'离泊',候航避让:'候航避让',减速靠泊:'减速靠泊'};
// rigClearancePolicy is the only authored prose on a boat, and it is the one line that ties the
// traffic to the architecture: three trading sailboats stand 8.45m of mast, the navigable aperture
// under the bridge peaks at 6.63m, so they take the east reach and never the middle. Keyed on the
// authored string rather than on a height threshold, so the fact stays true if the hulls change.
const MAST={'low-clearance cross-city lane':'低桅穿城专用道',
 'east reach only — 8.45m standing mast never enters 6m bridge aperture':'只走东段——八米四五高桅不入六米桥门'};
// The bridge prefab is keyed "Hongqiao | 37m timber rainbow bridge", and that key is the ONLY
// prose about its structure that exists as data - the span, the arch profile, the parapet and the
// 94 rail boxes are all derived in simulation.js, and there is no name field, no description and
// no shop at either end. So the fact is exactly what the key asserts and no more: it is tempting
// to write 木拱无柱 here, and there is nothing in the data that says the span is unsupported.
const BRIDGE={name:'虹桥',form:'三十七米木拱桥'};
// The kinds of traffic the authored routes are made of. There is no count - that changes every few
// seconds - but "who crosses here" is stable and is what the data actually asserts.
const CROWD={pedestrian:'行人',porter:'挑夫',caravan:'车队'};
// How close a named landmark has to be to be worth calling true. 40m is about one street block;
// past that the model is being handed a place this figure has nothing to do with.
const PLACE_R=40;
// The same discipline for the building, and it needs both numbers. A nearest-by-centre search
// alone put a cloth shop 24m away and across the river from someone standing 7.8m up on the
// Hongqiao arch, and the model writes 近旁 into prose as a statement. 12m is about one street
// width; 3m of height keeps a figure on the bridge or a storey up from being "at" a shop he is
// merely passing. Cost of the gate: 7 of 355 distinct fact sets, because a name 24m off was
// mostly duplicating a nearer one's anyway.
const BUILD_R=12,BUILD_Z=3;
// The scene's sunHour slider runs 9..18.5, and the system prompt invites the model to write the
// light at this hour without ever saying which hour it is. Five narrative buckets rather than the
// raw value: a bucket is something prose can use, "15.7" is not.
const HOUR=[[11,'上午'],[13,'正午'],[15.5,'午后'],[17,'向晚'],[Infinity,'薄暮']];
export const hourBucket=h=>{for(const[at,name]of HOUR)if(h<at)return name;return HOUR[HOUR.length-1][1];};

/** Whether a figure can honestly be said to be standing at this building: outside its footprint by
 *  no more than BUILD_R, and at its own storey rather than above it or a storey below it. rooms[]
 *  carries the OBB (hx/hy/angle) and the storey band (lo) for exactly this. The height test is
 *  symmetric because one-sided it is not a storey test: everything on the ground floor sits inside
 *  the first-floor room in plan, and a door in the street under a balcony is credited to the balcony.
 *  It changes nothing today - all 475 runtime rooms have lo between 2.43 and 2.58, so there is no
 *  second storey to confuse - and it is here because a synthetic room in tests/inspect-card.mjs
 *  does have one, and the rule should not depend on the data happening to be flat. */
function standsAt(r,p){
 if(Math.abs(p[2]-r.lo)>BUILD_Z)return false;
 const cs=Math.cos(r.angle||0),sn=Math.sin(r.angle||0),dx=p[0]-r.x,dy=p[1]-r.y;
 const lx=Math.abs(dx*cs+dy*sn)-(r.hx||0),ly=Math.abs(-dx*sn+dy*cs)-(r.hy||0);
 return Math.hypot(Math.max(0,lx),Math.max(0,ly))<=BUILD_R;}

/** The two place facts, UNRESOLVED - the raw authored names, with no Chinese label attached.
 *  Two consumers need this and they need different halves of it. factsFor() wants the values as
 *  prompt material and labels them itself; the cursor readout in inspect.js wants to put them
 *  through T() and cannot, because a string that has been through this module's tables is
 *  deliberately untranslatable - generated prose and Chinese prompt facts must not share a path
 *  with the English UI. So the spatial decision lives here once and each caller labels it. */
export function placeFacts(p,ctx){
 const out={};
 // rooms[] is built with room.name = the prefab kind (simulation.js:67), so the building's
 // trade needs no prefab lookup. Nearest by centre, then gated by standsAt(): a search result on
 // its own is not a fact, it is a guess. room.owner is an instance name and must never be read
 // here - the mesh-id guard in tests/ai-story.mjs exists because one of those once reached the
 // model.
 let room=null,rd=Infinity;
 for(const r of ctx?.rooms||[]){const d=(r.x-p[0])*(r.x-p[0])+(r.y-p[1])*(r.y-p[1]);if(d<rd){rd=d;room=r;}}
 if(room?.name&&standsAt(room,p))out.building=room.name;
 // A landmark is a named place, so it is only true within a plausible walk of one, and only at
 // the same height - the bridge is 7.8m over the water and nothing at street level is 近处 from
 // up there. 16 of them are spread across the whole city; out of range the fact is omitted
 // rather than guessed, because the prompt forbids inventing a place.
 const near=nearPlace(p,ctx,'',out.building);if(near)out.place=near;
 return out;}

const HAN=/\p{Script=Han}/u;
// The cards once printed `Handcart__0912` and `Person_merchant_0__0674` verbatim, so this is a
// defect class this repo has actually shipped, not a hypothetical.
const MESH_ID=/[A-Za-z]__\d+$|^(Person|Main_street|Courtyard|South_approach|North_approach)_\S*__?\d+$/;
const INSTANCE_SUFFIX=/__\d{3,}/;


const cache=()=>{try{return JSON.parse(localStorage.getItem('qm-stories')||'{}');}catch(_){return {};}};
const writeCache=c=>{try{localStorage.setItem('qm-stories',JSON.stringify(c));}catch(_){}};

/** Which subjects the reader can point at and get a portrait of. Anything not listed here is
 *  offered no AI block at all, rather than a card whose facts are all defaults. */
export const portraitable=hit=>hit?.kind==='person'&&!!hit.lifePlan||hit?.kind==='boat'&&!!hit.boat
 ||hit?.kind==='surface'&&hit.surface==='bridge'||null;

/** The identity a portrait is cached and written under. A person already carries a unique authored
 *  name; a boat and the bridge need one synthesised, and it must not be the mesh id. */
const subjectOf=hit=>hit?.kind==='person'?hit.lifePlan:hit?.kind==='boat'?{name:`boat-${hit.boat.id}`}
 :hit?.kind==='surface'&&hit.surface==='bridge'?{name:'bridge'}:null;

/** The live state the cache must separate on. A porter cycles 取货 → 搬货 → 返回货埠 and a boat
 *  cycles 航行 → 减速靠泊 → 靠泊装卸 → 离泊, so a frozen "he is carrying" would outlive its moment. */
const stateOf=hit=>hit?.kind==='boat'?hit.boat?.state:hit?.state;

/** A boat. The type carries most of the white-description on its own - a 乌篷客船 has a canopy
 *  because that is what one is - so the facts stay to what the simulation asserts: where it is
 *  going, what it is carrying, and the one constraint that makes three of the twelve take the
 *  long way round. */
function boatFacts(hit,ctx){
 const b=hit.boat,f={vessel:VESSEL[b.type]||'船'};
 const doing=BOAT_STATE[b.state];if(doing)f.doing=doing;
 if(b.cargo>0)f.cargo=`${b.cargo}份`;
 // 8 of the 12 hulls are authored with dock:null and never berth at all, so this is absent for
 // them rather than invented.
 const quay=b.dock&&ctx?.docksById?.get(b.dock);if(quay)f.quay=quay;
 const mast=MAST[b.rigClearancePolicy];if(mast)f.mast=mast;
 const near=nearPlace(hit.point,ctx,'',f.vessel);if(near)f.place=near;
 if(typeof ctx?.hour==='number'){const h=hourBucket(ctx.hour);if(h)f.hour=h;}
 return f;}

/** Hongqiao. One subject, so this is the cheapest portrait in the app to cache - a handful of
 *  entries for the whole city. What is on it right now is deliberately left out: a count changes
 *  every few seconds and the cache key would have to follow it, which is the same trade already
 *  refused for a traveller's street. The named routes across it are stable and say who uses it. */
function bridgeFacts(hit,ctx){
 const f={span:BRIDGE.name,form:BRIDGE.form};
 const on=(ctx?.bridgeRoutes||[]).filter(r=>r.over);
 if(on.length)f.routes=on.map(r=>r.name).join('、');
 // Who actually uses it. A live call on a fact set with no people in it had the model inventing a
 // barge under the arch, and once denying one was there - and 9 of the 12 hulls really do run
 // cross-city routes under this bridge, so the denial was checkably false. Naming the traffic that
 // the authored routes already assert gives it something true to work with instead of a gap.
 const folk=[...new Set(on.map(r=>CROWD[r.kind]).filter(Boolean))];
 if(folk.length)f.crowd=folk.join('、');
 // Where on the arch the reader is standing, as a position and not a height. A live MiniMax call
 // turned "7.8米" into 「七步八寸」 and "2.3米" into 「二丈」 - the model converts to a Chinese unit
 // and gets it wrong by up to 3x, which is a fabricated dimension in the one fact that was meant
 // to be read back from the geometry. The word still says what the number was for, and arithmetic
 // is the thing that has to go.
 const y=hit.point?.[1];
 if(Number.isFinite(y))f.deck=Math.abs(y)<6?'拱顶':Math.abs(y)<14?'坡上':'桥堍';
 const near=nearPlace(hit.point,ctx,f.span);if(near)f.place=near;
 if(typeof ctx?.hour==='number'){const h=hourBucket(ctx.hour);if(h)f.hour=h;}
 return f;}

/** The nearest named landmark, stripped of its UI instruction and only within a plausible reach
 *  and at the same height. Shared by all three subjects; `own` is the subject's own name, so the
 *  bridge is not also described as being 40m from 虹桥南. */
function nearPlace(p,ctx,own='',also=''){
 if(!Array.isArray(p))return '';
 let mark=null,md=PLACE_R*PLACE_R;
 for(const m of ctx?.landmarks||[]){const q=m.position;if(!q||Math.abs(q[2]-p[2])>BUILD_Z)continue;
  const d=(q[0]-p[0])*(q[0]-p[0])+(q[1]-p[1])*(q[1]-p[1]);if(d<md){md=d;mark=m;}}
 if(!mark)return '';
 const name=String(mark.name||'').split('·')[0].trim();
 // Most landmarks are the shop names again ("茶肆 · 入内"), and the suffix is a UI instruction
 // the model has no business seeing. Emitting one that repeats the subject says it twice.
 return name&&name!==own&&name!==also?name:'';}

/** Facts are the Chinese source values, never english() output - see the module header. */
export function factsFor(hit,ctx){
 if(hit?.kind==='boat')return boatFacts(hit,ctx);
 if(hit?.kind==='surface'&&hit.surface==='bridge')return bridgeFacts(hit,ctx);
 const plan=hit?.lifePlan||{},rig=hit?.person?.rig==='child'||plan.role==='child';
 const f={role:ROLE[plan.role]||'市中人',mode:MODE[plan.mode]||'市井人',age:rig?'孩童':'成人'};
 const clip=CLIP[hit?.person?.clip||plan.clip];if(clip)f.posture=clip;
 if(hit?.state&&STATE[hit.state])f.doing=STATE[hit.state];
 const route=plan.route&&ctx?.routes?.get(plan.route);if(route)f.route=route;
 if(plan.dock&&ctx?.docksById?.get(plan.dock))f.dock=ctx.docksById.get(plan.dock);
 // --- Where he is standing. The seven fields above describe a trade, not a person: across the
 // 584 citizens only 66 distinct fact sets existed, and two labourers 0.14m apart produced
 // byte-identical prompts. The system prompt forbids inventing a place, so the only way to write
 // a person rather than a category was to hand the model the place the data already asserts.
 const p=hit?.person?.p||hit?.point;
 if(Array.isArray(p))Object.assign(f,placeFacts(p,ctx));
 if(typeof ctx?.hour==='number'){const h=hourBucket(ctx.hour);if(h)f.hour=h;}
 return f;
}


/** plan.name is the identity - unique across all 584 and authored in the data, unlike actor.id,
 *  which is a construction counter that any asset reordering would silently re-point. The live
 *  state rides along because a porter cycles 取货 -> 搬货 -> 返回货埠 and a frozen "he is carrying"
 *  outlives the moment it described.
 *
 *  `v3` is the backend migration. The old key ended in the provider id and the endpoint URL, both of
 *  which are gone: there is one backend, and a reader cannot point it anywhere. The bump matters
 *  anyway, because a v2 entry was written by whichever model the READER chose, and this deployment
 *  is now served by one model the reader never chose - serving those back would attribute prose to
 *  a writer it did not come from. The hour rides along for the same reason it always did: it is a
 *  slider the reader controls, and a portrait written at 上午 must not be served at 薄暮.
 *
 *  Position deliberately does NOT. It would multiply the key space on figures who are walking,
 *  so they would miss the cache on every approach and pay again - and now that the operator pays,
 *  a miss is their money rather than the reader's. The accepted cost is that a traveller's portrait
 *  can name a street he has since left; a portrait is a snapshot, and the card already says
 *  早前写成 when it is a cache hit. */
export function cacheKey(plan,lang,state,hour=''){
 return['v3',plan?.name,lang,state||'',hour||''].join('|');}

export const hasHan=s=>HAN.test(String(s??''));
export const leaksMeshId=s=>MESH_ID.test(String(s??''))||INSTANCE_SUFFIX.test(String(s??''));

/** Returns null for anything it cannot fully trust, so the caller renders a retry rather than a
 *  half-answered card. Never throws.
 *
 *  Two shapes are read. A provider with `output_config.format` answers with a text block holding
 *  JSON; a provider forced through `tools` answers with a tool_use block whose input is already an
 *  object. Both are then held to the same two-field contract, because a provider that ignored its
 *  constraint has to be rejected rather than rendered - that is exactly the case where the model
 *  invents a name and a twelve-year history for a porter who has neither in the data.
 *
 *  The text block is found by type, never by index: with thinking on, content[0] is a thinking
 *  block whose text is empty by default. */
export function parseResponse(json){
 try{
  if(!json||json.stop_reason==='refusal'||json.stop_reason==='max_tokens')return null;
  const blocks=json.content||[];
  const tool=blocks.find(b=>b?.type==='tool_use');
  let parsed=null;
  if(tool?.input&&typeof tool.input==='object')parsed=tool.input;
  else{
   const block=blocks.find(b=>b?.type==='text');
   if(!block?.text)return null;
   parsed=JSON.parse(block.text);
  }
  if(typeof parsed?.description!=='string'||typeof parsed?.line!=='string')return null;
  if(!parsed.description.trim()||!parsed.line.trim())return null;
  return{description:parsed.description.trim(),line:parsed.line.trim()};
 }catch(_){return null;}
}


/** Renders generated prose. Guard order matters: a mesh id is always a bug and always rejected; a
 *  stray Han character in English output is merely untidy, and re-asking would spend a second call
 *  to throw away a good answer - so the reader sees it with a note instead. */
export function vet(result,lang){
 if(!result)return null;
 if(leaksMeshId(result.description)||leaksMeshId(result.line))return null;
 return{...result,warn:lang==='en'&&(hasHan(result.description)||hasHan(result.line))};
}

export class AIStoryUI{
 constructor(){
  this.root=document.querySelector('#inspect-ai');
  this.desc=document.querySelector('#ai-desc');
  this.line=document.querySelector('#ai-line');
  this.note=document.querySelector('#ai-note');
  this.again=document.querySelector('#ai-again');
  this.make=document.querySelector('#ai-make');
  this.cancel=document.querySelector('#ai-cancel');
  this.current=null;this.busy=null;this.variant=0;this.abort=null;this.tick=null;this.spoken=new Set();this.reading=null;
  // "Another line" has to be a *different* request, not the same one again: the prompt is byte-stable
  // for cache reasons, so a repeat would return the identical prose. The variant rides along as a
  // user turn rather than in the system prompt, which keeps the cached prefix intact.
  if(this.again)this.again.onclick=()=>this.again_();
  // Spending is always an explicit act: opening the card, the 350ms tick and the language toggle
  // all just render. The 写照 button is the only way in for a person not yet written.
  if(this.make)this.make.onclick=()=>this.spend();
  if(this.cancel)this.cancel.onclick=()=>this.abort?.abort();
 }
 /** The only path into generate() for an unwritten person. Guarded like again_(): one flight per key. */
 spend(){if(!this.current||this.busy)return;this.generate(this.current);}
 async again_(){
  const target=this.current;
  if(!target||this.busy===target.key)return;
  this.busy=target.key;this.paint({pending:true});
  const controller=new AbortController();
  this.abort=controller;
  const timer=setTimeout(()=>controller.abort(new Error('timeout')),TIMEOUT_MS);
  try{
   this.variant++;
   const store=cache();delete store[target.key];
   // Facts and a variant counter, nothing else. The prompt, the schema and the model are the
   // backend's business; this call is what the deployment is for.
   const res=await post('/story',{facts:target.facts,lang:target.lang,variant:this.variant},controller.signal);
   if(!res.ok){const e=new Error('HTTP '+res.status);e.status=res.status;throw e;}
   const result=vet(parseResponse(await res.json()),target.lang);
   if(!result)throw new Error('unusable response');
   if(this.current!==target)return;
   store[target.key]=result;writeCache(store);
   this.paint(result);
  }catch(err){
   if(this.current!==target)return;
   // A cancel is not a failure: fall back to what was already written, or to the 写照 prompt.
   if(err?.name==='AbortError'){const kept=vet(cache()[target.key],target.lang);this.paint(kept?{...kept,cached:true}:{ready:true});return;}
   this.paint({error:true,why:err?.message||'network'});
  }finally{clearTimeout(timer);if(this.busy===target.key)this.busy=null;if(this.abort===controller)this.abort=null;}
 }
 /** Called on every show() - a 350ms tick, so everything below must be a no-op for the subject
  *  already shown. It renders the cache or the 写照 prompt and NEVER fires a request: spending
  *  is the reader's explicit click on 为其写照 or 换一句, never the act of opening a card. */
 async offer(hit,ctx){
  if(!this.root)return;
  // A subject with no authored facts of its own - a patch of water, a room, a door - is offered
  // no AI block at all, rather than a card whose facts are all defaults.
  const plan=subjectOf(hit);
  if(!plan){this.clear();return;}
  const lang=getLang()==='en'?'en':'zh';
  // The key takes the hour from the facts rather than from ctx, so the cache bucket and the
  // bucket the model was actually told can never drift apart.
  const facts=factsFor(hit,ctx),key=cacheKey(plan,lang,stateOf(hit),facts.hour);
  if(this.current?.key!==key){this.clear();this.variant=0;this.current={key,lang,plan,hit,facts};}
  const store=cache(),kept=vet(store[key],lang);
  if(kept){this.paint({...kept,cached:true});return;}
  if(this.busy===key)return;
  this.paint({ready:true});
 }
 async generate(target){
  const key=target.key,lang=target.lang;
  this.busy=key;this.paint({pending:true});
  const controller=new AbortController();
  this.abort=controller;
  // A reason, so the 45s timeout lands on the error path while the reader's own cancel
  // (abort() with no reason) lands on the quiet fallback instead.
  const timer=setTimeout(()=>controller.abort(new Error('timeout')),TIMEOUT_MS);
  try{
   const res=await post('/story',{facts:target.facts,lang,variant:this.variant},controller.signal);
   if(!res.ok){const e=new Error('HTTP '+res.status);e.status=res.status;throw e;}
   const payload=await res.json();
   // Whether the prefix actually cleared the cache minimum is an assumption, not a fact, until the
   // API reports it. Exposing it keeps that honest instead of leaving a saving claimed in a comment.
   this.lastUsage={input:payload.usage?.input_tokens,cacheRead:payload.usage?.cache_read_input_tokens,
    cacheWrite:payload.usage?.cache_creation_input_tokens,output:payload.usage?.output_tokens};
   const result=vet(parseResponse(payload),lang);
   if(!result)throw new Error('unusable response');
   // A late reply for a person the reader has already moved on from must not repaint the card.
   if(this.current?.key!==key)return;
   const store=cache();store[key]=result;writeCache(store);
   this.paint(result);
  }catch(err){
   if(this.current?.key!==key)return;
   if(err?.name==='AbortError'){const kept=vet(cache()[key],lang);this.paint(kept?{...kept,cached:true}:{ready:true});return;}
   this.paint({error:true,why:err?.message||'network'});
  }finally{clearTimeout(timer);if(this.busy===key)this.busy=null;if(this.abort===controller)this.abort=null;}
 }
 paint(state){
  if(!this.root)return;
  clearInterval(this.tick);this.tick=null;
  const say=(node,text)=>{if(node)node.textContent=text||'';},vis=(node,on)=>{if(node)node.hidden=!on;};
  this.root.hidden=!state;
  if(!state)return;
  // Every branch re-derives all four toggles: a 350ms cache-hit repaint must not leak the last
  // state's buttons into this one. An empty #ai-line is hidden too - its gold rule and wash
  // would otherwise hang on the card as an empty bar.
  vis(this.line,false);vis(this.make,false);vis(this.cancel,false);vis(this.again,false);
  if(state.pending){say(this.desc,'…');say(this.line,'');say(this.note,t('aiThinking'));vis(this.cancel,true);
   // Opus runs 20-60s and the call is not streamed, so elapsed time is the only honest progress
   // report there is. A bare spinner reads as a hang long before the timeout.
   let s=0;this.tick=setInterval(()=>say(this.note,t('aiWait',++s)),1000);return;}
  if(state.ready){say(this.desc,'');say(this.line,'');
   // The button is always available: there is nothing for a reader to configure and no credential
   // that can be missing on their side. An instance whose backend has no key answers 503, which
   // lands on the error branch below and says so.
   say(this.note,t('aiCost'));vis(this.make,true);return;}
  // A backend that is down, throttling, or not configured looks like one thing to a reader who no
  // longer holds a key, so the message names what they can do - nothing - rather than what they
  // should fix. The one actionable case is being throttled, and that one says so.
  if(state.error){const why=String(state.why||'');
   say(this.desc,'');say(this.line,'');
   // 503 is the one status the reader can interpret, because it is the one that means "this
   // instance is not set up" rather than "something went wrong" - and it is the operator's to fix,
   // not theirs. 429 says the same thing from the other side: the answer exists, this reader just
   // has to wait, and telling them to check a key they never had would be a lie.
   say(this.note,why==='Failed to fetch'?t('aiNoReach'):
    /^HTTP 503/.test(why)?t('aiNoService'):/^HTTP 429/.test(why)?t('aiBusy'):t('aiFailed'));
   say(this.again,t('aiRetry'));vis(this.again,true);return;}
  // textContent throughout: the card body is built by innerHTML interpolation, and model output
  // must never share that path.
  say(this.desc,state.description);say(this.line,state.line);vis(this.line,true);
  // Read it once, and only once. This line is reached roughly three times a second, because
  // offer() repaints from cache on every 350ms tick, so a plain speak() here talks over itself.
  // The guard keys on the text rather than the cache key: again_() reuses one key for a different
  // line - that is the whole point of the button - so a key-based guard would swallow 换一句 too.
  // A set rather than the last line, so that returning to a portrait after hearing someone else
  // is still silent, which is what "once" is supposed to mean. It is not cleared in clear(), so a
  // close and a cache hit stay silent. A language switch does NOT: the cache key is language-scoped,
  // so the same person arrives with a different sentence in the other tongue and that one is read.
  //
  // The mark is committed on completion, not on starting: a line takes 6.4s, and a 试听 click or the
  // mute switch cuts it off mid-sentence. Committing at the start loses that tail for the session,
  // because nothing would ever ask for the line again. `reading` is what stops the 350ms repaint
  // from restarting it in the meantime - and it is set whether or not the mark eventually lands,
  // so a muted or not-yet-loaded card is simply retried rather than retired.
  if(!this.spoken.has(state.line)&&this.reading!==state.line){
   this.reading=state.line;
   // sayLine reports whether it started. It does not, the sound is off or the OS has not
   // delivered its voices, and it will not call done - so the marker has to come back off here or
   // the line is "reading" for the rest of the session and can never be offered again.
   // The last argument decides whether this is spoken by the operating system or synthesised, and it
   // hands over what voice.js cannot read for itself: the trade that picks the voice is in `plan`.
   // There is no key and no provider in it any more - both moved to the backend, so voice.js asks
   // serverConfig() instead. The trade is still read per paint rather than cached, because the
   // reader can change language at any moment and that changes which voices exist.
   const started=sayLine(state.line,finished=>{this.reading=null;if(finished)this.spoken.add(state.line);},
    {plan:this.current?.plan,kind:this.current?.hit?.kind});
   if(!started)this.reading=null;}
  // A cache hit cost nothing this time - the byline says so, rather than implying a fresh write.
  say(this.note,state.cached?t('aiCached'):t('aiByline'));
  say(this.again,t('aiAgain'));vis(this.again,true);
 }
 /** Drops the "already read" mark so the next line is spoken even if the reader has met it before.
  *  The voice switch calls this on the way back up, which is the only way to hear a line twice
  *  without spending another request. */
 forget(){this.spoken.clear();}
 /** Bumps the identity so a late reply for a previous person cannot repaint the new card. `busy` is
  *  deliberately left alone: it guards the network, not the display, and dropping it mid-request
  *  would let the next 350ms tick start a second call for a request already in flight. */
 clear(){this.current=null;clearInterval(this.tick);this.tick=null;if(this.root)this.root.hidden=true;}
}
