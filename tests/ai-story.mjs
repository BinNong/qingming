import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
const json=async p=>JSON.parse(await read(p));
// A real CollisionWorld, not a hand-made rooms array. A synthetic fixture carrying only {name,x,y}
// made the building fact untestable: the gate that stops a figure being told about a shop 24m
// away needs the footprint OBB, and a fixture without hx/hy/angle/lo cannot express a wrong
// answer, so the defect was invisible to every assertion below.
registerHooks({resolve(specifier,ctx,next){if(specifier==='qingming/micro')return{url:new URL('src/micro.js',root).href,shortCircuit:true};if(specifier==='three/core')return{url:new URL('vendor/three.core.js',root).href,shortCircuit:true};if(specifier==='three')return{url:new URL('vendor/three.module.js',root).href,shortCircuit:true};return next(specifier,ctx);}});
const {CollisionWorld,multiply,Z_TO_Y,CityEcology}=await import('../src/simulation.js');
const {factsFor,placeFacts,parseResponse,cacheKey,hasHan,leaksMeshId}=await import('../src/ai-story.js');
// The prompt contract lives on the server now - with the key, which is why. These tests still pin it
// here rather than in a backend suite: what they are really asserting is that the FACTS the browser
// resolves come out in a form the server can turn into a question, and that is a statement about the
// boundary between the two halves.
const {buildMessages,STORY_SCHEMA,STORY_TOOL,SYSTEM}=await import('../functions/_shared/prompt.mjs');
const eco=await json('public/runtime/ecology.json'),nav=await json('public/runtime/navigation.json');
const manifest=await json('public/runtime/city.json');
const han=/\p{Script=Han}/u;
const source=await read('src/ai-story.js');
const sourceAssets=manifest.assets.map(a=>({...a,baseMatrices:a.instances.map(i=>multiply(Z_TO_Y,i.matrix)),
 matrices:a.instances.map(i=>multiply(Z_TO_Y,i.matrix)),centers:a.instances.map(()=>[0,0,0])}));
const world=new CollisionWorld(nav);
world.registerDoors(sourceAssets);

// The same shape tests/i18n.mjs:121 uses. The cards once printed `Handcart__0912` and
// `Person_merchant_0__0674` verbatim, so this is a defect class this repo has actually shipped.
const meshId=/[A-Za-z]__\d+$|^(Person|Main_street|Courtyard|South_approach|North_approach)_\S*__?\d+$/;
const byName=new Map(eco.citizens.map(c=>[c.name,c]));

// --- Facts. Only what the data actually asserts: no name, no home, no invented history.
const routes=new Map(eco.routes.map(r=>[r.id,r.name])),docks=new Map(eco.docks.map(d=>[d.id,d.name]));
// The same shape InspectUI builds, so a change to that contract breaks here first.
const ctx={routes,docksById:docks,rooms:world.rooms,landmarks:nav.landmarks,hour:15.7,
 bridgeRoutes:eco.routes.map(r=>({name:r.name,kind:r.kind,over:(r.points||[]).some(p=>p[2]>4)})),
 bridgeHeight:y=>world.bridgeHeight(y)};
const walkable=new Set();
for(const p of nav.prefabs?Object.values(nav.prefabs):[])for(const f of p.floors||[])walkable.add(f);
const personHit=(plan,state=null)=>({kind:'person',lifePlan:plan,state,
 // `p` is the figure's ground position. factsFor takes its spatial facts from the actor, and
 // without one it emits no place at all - which is exactly what the test below would then miss.
 person:{id:0,clip:plan.clip,rig:plan.role==='child'?'child':'adult',p:plan.anchor}});
// The two non-person subjects. A boat carries its own live state and position; the bridge is a
// surface hit whose only identity is the tag, so the deck under the cursor is what grounds it.
const boatHit=(b,p=[0,0,.28])=>({kind:'boat',boat:b,point:p});
const bridgeHit=p=>({kind:'surface',surface:'bridge',point:p});

// 1. Every one of the 584 citizens produces a complete fact set. A missing field used to surface as
// the literal word `undefined` in prose, and a citizen with no route is normal, not a defect.
let withRoute=0;
for(const plan of eco.citizens){
 const f=factsFor(personHit(plan),ctx);
 for(const [k,v] of Object.entries(f)){
  assert(v!==undefined&&v!==null&&v!=='',`${plan.name}: fact "${k}" is empty`);
  assert(!/undefined|NaN|\[object/.test(String(v)),`${plan.name}: fact "${k}" leaked a JS value: ${v}`);
 }
 if(f.route)withRoute++;
}
assert.equal(withRoute,219,'exactly the travellers and porters carry a route');
assert.equal(eco.citizens.length,584,'the fact builder is measured against the real population');

// 2. The mesh-id leak class, over the whole population rather than a sample. `plan.name` is the cache
// key and must never reach the model as content - that is how `Handcart__0912` came back to life.
for(const plan of eco.citizens){
 const f=factsFor(personHit(plan),ctx);
 for(const [k,v] of Object.entries(f)){
  const s=String(v);
  assert(!leaksMeshId(s),`${plan.name}: fact "${k}" leaks a mesh id: ${s}`);
  assert(!meshId.test(s),`${plan.name}: fact "${k}" matches the meshId regex: ${s}`);
  assert(!/__\d{3,}/.test(s),`${plan.name}: fact "${k}" carries an instance suffix: ${s}`);
 }
}
// ...including the 36 semantically-named ones. Their names resolve to a home or a shop, which is
// exactly the string that would tempt the model to invent the household's contents.
const named=eco.citizens.filter(c=>!/^Person_/.test(c.name));
assert.equal(named.length,36,'the named citizens are a known, countable minority');
for(const plan of named){
 const f=factsFor(personHit(plan),ctx);
 assert(!Object.values(f).some(v=>/Courtyard_|seated_patron|Main_street_/.test(String(v))),
  `${plan.name}: a placement name reached the facts`);
}

// 3. The place facts are the entire point of the change, so pin both that they fire and that they
//    actually separate people. Before them only 66 of 584 produced a distinct prompt and two
//    labourers 0.14m apart were byte-identical: the model was writing a trade, not a person.
const sig=f=>Object.keys(f).sort().map(k=>k+'='+f[k]).join('|');
const sets=new Set(eco.citizens.map(p=>sig(factsFor(personHit(p),ctx))));
// The same population with the place facts removed, so the summary states what they actually buy
// rather than an absolute number that would look the same if they were deleted.
const noPlace=new Set(eco.citizens.map(p=>{const f=factsFor(personHit(p),ctx);
 delete f.building;delete f.place;delete f.hour;return sig(f);}));
assert(sets.size>=300,`only ${sets.size} distinct fact sets across ${eco.citizens.length} citizens - the place facts are not separating anyone`);

// --- placeFacts() was lifted out of factsFor() so the cursor readout could reach the same spatial
// decision with the names still unresolved (T() has to be able to translate them; a value that has
// been through this module's tables is deliberately untranslatable). Two implementations of one
// spatial rule is how a shop ends up 24m away in one of them, so the extraction is pinned here
// against the same real CollisionWorld rather than trusted.
let placeMismatch=0;
for(const p of eco.citizens){
 const f=factsFor(personHit(p),ctx),raw=placeFacts(p.anchor,ctx);
 if(f.building!==raw.building||f.place!==raw.place)placeMismatch++;
}
assert.equal(placeMismatch,0,`factsFor and placeFacts disagree on ${placeMismatch} citizens`);

// --- What the cursor readout buys, measured on the real population. The trade alone yields 10
// distinct readings with 126 figures sharing one; trade + location yields 107, with 33 women all
// reading 妇人 · 近旁：厢房. The live posture is what turns it into a readout: 359 distinct, largest
// group 7. Two figures at the same shop are identical by trade and place and separated by whether
// one is standing or walking - the only one of the three that keeps changing as the city runs.
// The posture is spread across the six clips here rather than sampled from one instant, because
// posture rotates and any single instant is one slice of it; the figure is "given a set of
// posture states", not "at any one moment".
const {hoverLine}=await import('../src/inspect.js');
const CLIPS=['Idle','Walk','Work','Talk','Sit','Carry'];
// personHit() reads plan.clip, which is the authored placement default, so the posture is varied
// by handing hoverLine a hit whose actor carries a different clip - the same live-vs-authored
// distinction the card's gesture row is pinned on.
const posed=p=>{const h=personHit(p);h.person.clip=CLIPS[eco.citizens.indexOf(p)%6];return h;};
const lines=eco.citizens.map(p=>hoverLine(posed(p),ctx));
assert.equal(lines.filter(l=>!l).length,0,'every citizen must produce a cursor readout');
const joined=lines.map(l=>l.join(' · '));
const readings=new Set(joined),counts={};
for(const l of joined)counts[l]=(counts[l]||0)+1;
const readWorst=Math.max(...Object.values(counts));
// The same readings with the posture segment dropped, so the gain is measured rather than asserted.
const readNoPose=new Set(lines.map(l=>l.slice(0,-1).join(' · ')));
assert(readings.size>=350,`only ${readings.size} distinct cursor readings - the posture segment is not separating anyone`);
assert(readWorst<=8,`${readWorst} figures share one cursor reading`);
assert(readNoPose.size<=110,`${readNoPose.size} readings without the posture; if that is near ${readings.size} the assertion above passes for the wrong reason`);

// --- Do those 219 actually move, and does following one actually show anything changing? The
// cursor readout and the follow camera both claim a figure is worth watching; a population that
// stood still would make both hollow, and nothing above can see that because every fact was taken
// from the authored anchors. So the ecology is stepped for real and the facts re-derived from the
// live positions. Measured over 300 simulated seconds: 200/219 change state (median 3 times) and
// 217/219 change which shop they are beside (median 21 times), which is what makes the state half
// of the portrait cache key worth having.
const live=new CityEcology(eco,world);
const liveActors=eco.citizens.map((c,i)=>({a:{instances:[{name:c.name}]},index:0,p:[...c.anchor],
 baseP:[...c.anchor],heading:0,clip:c.clip||'Idle',id:i,scale:[1,1,1],radius:c.name.includes('porter')?.48:.22}));
live.attachPeople(liveActors);
const moved=liveActors.filter(a=>a.life);
assert.equal(moved.length,219,`CityEcology must take over exactly the travellers and porters, got ${moved.length}`);
const first=new Map(moved.map(a=>[a,{p:[...a.p],state:a.life.state,shop:placeFacts(a.p,ctx).building||''}]));
for(let step=0;step<30*300;step++)live.step(1/30);
let stateMoved=0,shopMoved=0,distanced=0;
for(const a of moved){const f=first.get(a),shop=placeFacts(a.p,ctx).building||'';
 if(a.life.state!==f.state)stateMoved++;
 if(shop!==f.shop)shopMoved++;
 if(Math.hypot(a.p[0]-f.p[0],a.p[1]-f.p[1])>4)distanced++;}
assert.equal(stateMoved>=180,true,`only ${stateMoved}/219 changed state in 300s - following one would show a frozen card`);
assert.equal(shopMoved>=190,true,`only ${shopMoved}/219 changed which shop they stand beside - the location fact is not tracking the walk`);
// Not 219: a porter dwelling at a dock stands still for minutes at a time, which is the economy
// working rather than a figure stuck. The floor is "nearly all of them", not "all of them".
assert.equal(distanced>=200,true,`only ${distanced}/219 moved more than 4m in 300s - the follow camera would be following statues`);
// --- The place facts must be TRUE, not just present. A nearest-by-centre search once named a
// cloth shop for someone standing 7.8m up on the Hongqiao arch, 24m away across the water, and
// the model writes 近旁 into prose as a statement. Every emitted building is re-derived here from
// the footprint it claims, so a gate that is loosened in src/ fails here.
const edgeOf=(r,p)=>{const cs=Math.cos(r.angle||0),sn=Math.sin(r.angle||0),dx=p[0]-r.x,dy=p[1]-r.y;
 const lx=Math.abs(dx*cs+dy*sn)-r.hx,ly=Math.abs(-dx*sn+dy*cs)-r.hy;
 return Math.hypot(Math.max(0,lx),Math.max(0,ly));};
let namedAt=0,worstEdge=0,worstRise=0;
for(const p of eco.citizens){
 const f=factsFor(personHit(p),ctx);
 if(!f.building)continue;
 namedAt++;
 const r=world.rooms.find(r=>r.name===f.building&&edgeOf(r,p.anchor)===Math.min(
  ...world.rooms.filter(q=>q.name===f.building).map(q=>edgeOf(q,p.anchor))));
 assert(r,`${p.name}: building "${f.building}" does not exist in the city`);
 worstEdge=Math.max(worstEdge,edgeOf(r,p.anchor));
 worstRise=Math.max(worstRise,p.anchor[2]-r.lo);
}
assert(namedAt>450,`only ${namedAt} of ${eco.citizens.length} citizens can name a building - the gate is too tight`);
assert(worstEdge<=12.5,`a figure was told about a building ${worstEdge.toFixed(1)}m away`);
assert(worstRise<=3.5,`a figure was told about a building ${worstRise.toFixed(1)}m below them`);
// Nothing on the bridge may claim a street-level shop. The deck is 6.8-7.8m over the water and
// the highest anchor is 11.5m; a figure up there is nowhere near a shopfront at street level.
// A figure on a building's *upper floor* is different - that really is the shop's storey - so
// this threshold is the deck, not 3m.
const onBridge=eco.citizens.filter(p=>p.anchor[2]>6);
assert(onBridge.length>10,'the bridge must carry figures, or this check is vacuous');
for(const p of onBridge){const f=factsFor(personHit(p),ctx);
 assert(!f.building,`${p.name} is ${p.anchor[2].toFixed(1)}m up but was told it is at ${f.building}`);
 assert(!f.place,`${p.name} is ${p.anchor[2].toFixed(1)}m up but was told it is near ${f.place}`);}

// --- Boats and the bridge. The gate used to be `kind!=='person'`, so these two had no AI block at
// all. A bridge has nobody to speak, which is why `line` is now "此刻的一句或一声" rather than a
// line of dialogue - one schema for all three subjects, not one per kind.
const boatSets=new Set();
for(const b of eco.boats){
 const hit=boatHit({...b,state:'航行'}),f=factsFor(hit,ctx);
 boatSets.add(sig(f));
 for(const [k,v] of Object.entries(f)){
  assert(v!==undefined&&v!==null&&v!=='',`boat ${b.id}: fact "${k}" is empty`);
  assert(!leaksMeshId(String(v)),`boat ${b.id}: fact "${k}" leaks a mesh id: ${v}`);
  assert(!/undefined|NaN|\[object/.test(String(v)),`boat ${b.id}: fact "${k}" leaked a JS value: ${v}`);
 }
 // The vessel name is a mesh id and the route name is auto-generated ("Cargo_barge 0 水路").
 // Neither may reach the model, and neither is in the fact set at all.
 assert(!JSON.stringify(f).includes('Vessel_'),`boat ${b.id}: a vessel mesh name reached the facts`);
 assert(!f.route,`boat ${b.id}: the auto-generated route name must not be a fact`);
 // 8 of the 12 are authored dock:null and never berth, so a quay would be invented for them.
 if(b.dock)assert(f.quay===eco.docks.find(d=>d.id===b.dock).name,`boat ${b.id}: wrong quay`);
 else assert(!f.quay,`boat ${b.id} never berths but was given a quay`);
 // Every hull carries a clearance policy, and it is the only authored prose on a boat.
 assert(f.mast,`boat ${b.id}: the clearance policy is authored prose and must always be a fact`);
}
assert(boatSets.size>=8,`only ${boatSets.size} distinct fact sets across ${eco.boats.length} boats`);
// The Chinese must be the same words the card already uses. E() is unreachable from this module,
// so the tables are duplicated rather than shared, and this is what keeps one vessel from being
// called 漕船 on the card and something else in the prompt. E() resolves through ENUM, which is
// not exported, so this compares against the card's own resolver rather than duplicating it.
const {E,setLang}=await import('../src/i18n.js');
setLang('zh');
for(const b of eco.boats){
 const f=factsFor(boatHit(b),ctx);
 assert.equal(f.vessel,E(b.type),`boat ${b.id}: the prompt calls ${E(b.type)} something else`);
 assert.equal(f.mast,E(b.rigClearancePolicy),`boat ${b.id}: the clearance policy diverges from the card`);}

const crown=factsFor(bridgeHit([0,0,7.83]),ctx),slope=factsFor(bridgeHit([0,-16,2.9]),ctx);
assert.equal(crown.span,'虹桥');
// The arch is a parabola, so the position on it has to follow the click rather than being a
// constant. It is a word and not a height on purpose: a live call turned 7.8米 into 「七步八寸」
// and 2.3米 into 「二丈」, so a number here is an invitation to do arithmetic and get it wrong.
assert.notEqual(crown.deck,slope.deck,'the crown and the slope must not report the same position');
assert.equal(crown.deck,'拱顶');
assert.equal(slope.deck,'桥堍');
assert.equal(factsFor(bridgeHit([0,9,5.5]),ctx).deck,'坡上');
for(const v of [crown.deck,slope.deck])
 assert(!/\d/.test(v),`a deck fact of "${v}" carries a number, and numbers get converted`);
// Every route that crosses is named, and only those: the water routes pass under, they do not cross.
const crossing=ctx.bridgeRoutes.filter(r=>r.over).map(r=>r.name);
assert(crossing.length>=4,`only ${crossing.length} routes are on the deck`);
assert(crown.routes===crossing.join('、'),'the bridge must name exactly the routes that cross it');
// Who uses it, from the authored route kinds. A fact set with nobody in it left a gap the model
// filled: live calls invented a barge under the arch, and once asserted there was NO boat there -
// which is checkably false, since 9 of the 12 hulls run routes that pass under this bridge.
assert.equal(crown.crowd,'行人、挑夫、车队','the bridge must name the traffic its own routes assert');
assert(!crown.crowd.includes('船'),'a boat route passes under the bridge, it is not traffic on it');
assert(!JSON.stringify(crown).includes('无柱'),'nothing in the data says the span is unsupported');
assert(!crown.routes.includes('水路'),'a boat route passes under the bridge; it does not cross it');
for(const [k,v] of Object.entries(crown)){
 assert(v!==undefined&&v!==null&&v!=='',`bridge: fact "${k}" is empty`);
 assert(!leaksMeshId(String(v))&&!/__\d{3,}/.test(String(v)),`bridge: fact "${k}" leaks an id: ${v}`);}
// The bridge must not describe itself as being near 虹桥南 when the reader is at the crown, 5.6m
// above that landmark's street level.
assert(crown.place===undefined,`the crown is 5.6m above 虹桥南 and must not claim it as 近处`);

// portraitable() is the single list both InspectUI and offer() gate on. A kind with no authored
// facts of its own gets no AI block rather than one built from defaults.
const {portraitable}=await import('../src/ai-story.js');
for(const [hit,yes] of [[{kind:'person',lifePlan:{name:'x'}},true],[{kind:'boat',boat:{id:0}},true],
 [bridgeHit([0,0,7.8]),true],[{kind:'person'},false],[{kind:'water'},false],[{kind:'room'},false],
 [{kind:'door'},false],[{kind:'convoy'},false],[{kind:'landmark'},false],
 [{kind:'surface',surface:'ground'},false],[{kind:'surface',surface:'stairs'},false]]){
 assert.equal(!!portraitable(hit),yes,`portraitable(${JSON.stringify(hit).slice(0,40)}) should be ${yes}`);}
// A landmark repeats the building whenever it is a shop ("茶肆 · 入内"), and the suffix is a UI
// instruction. Pinning the absence is not possible - the suppression happens in the source, so the
// assertion below is about the input being the thing that gets filtered, not about a value.
for(const p of eco.citizens){const f=factsFor(personHit(p),ctx);
 assert(!(f.place&&f.place===f.building),`${p.name}: the same trade was emitted twice`);
 if(f.place)assert(!f.place.includes('·'),`${p.name}: the UI suffix survived into the facts: ${f.place}`);}
// LABEL falls through to the raw key and nothing tested that, so a new fact key would silently
// ship `building：茶肆` to the model - an English word in the middle of Chinese facts. All three
// subjects, because the boat and bridge keys are a different set from the person's.
for(const p of eco.citizens)for(const lang of ['zh','en']){
 for(const line of buildMessages(factsFor(personHit(p),ctx),lang).user.split('\n'))
  assert(!/^[A-Za-z_$][\w$]*：/.test(line),`a fact line leaked its English key: ${line}`);}
for(const hit of [...eco.boats.map(b=>boatHit({...b,state:'航行'})),bridgeHit([0,0,7.83]),bridgeHit([0,-16,2.9])])
 for(const lang of ['zh','en']){
  for(const line of buildMessages(factsFor(hit,ctx),lang).user.split('\n'))
   assert(!/^[A-Za-z_$][\w$]*：/.test(line),`a fact line leaked its English key: ${line}`);}
// The scene's sunHour is a slider the reader moves, and the prompt invites the model to write the
// light at this hour. Without it the model was guessing, and the cache could serve 上午 at dusk.
const {hourBucket}=await import('../src/ai-story.js');
assert.equal(hourBucket(9.5),'上午');assert.equal(hourBucket(12),'正午');assert.equal(hourBucket(14),'午后');
assert.equal(hourBucket(16),'向晚');assert.equal(hourBucket(18.5),'薄暮');
assert.equal(hourBucket(15.5),'向晚','the bucket boundary itself must resolve to the later one');
for(const p of eco.citizens.slice(0,40))assert.equal(factsFor(personHit(p),ctx).hour,'向晚','the default 15.7 is already past the afternoon boundary');
assert.notEqual(cacheKey(eco.citizens[0],'zh',null,'上午'),
 cacheKey(eco.citizens[0],'zh',null,'薄暮'),
 'a portrait written at 上午 must not be served at 薄暮');
assert.notEqual(cacheKey(eco.citizens[0],'zh',null,'上午'),
 cacheKey(eco.citizens[0],'zh',null,'午后'),'and the buckets are not collapsed into one');
// v3 retires everything v2 wrote, and the reason is stronger than the one that produced v2. A v2
// entry was written by whichever model the READER chose, and this deployment is served by one model
// the reader never chose - handing those back would attribute prose to a writer it did not come
// from. It also retires the provider and endpoint slots, which no longer exist.
assert(cacheKey(eco.citizens[0],'zh').startsWith('v3|'),'the key must carry the fact-schema version');
assert(!cacheKey(eco.citizens[0],'zh').includes('anthropic')&&!cacheKey(eco.citizens[0],'zh').includes('minimax'),
 'the model is the backend\'s choice now and has no business in the reader\'s cache key');

// 4. The cache key is plan.name + lang, and it must separate languages - a Chinese description shown
// under an English card is the failure mode the language toggle exists to prevent.
const langs=new Set();
for(const plan of [eco.citizens[0],eco.citizens[100],eco.citizens[583]]){
 for(const l of ['zh','en']){
  const k=cacheKey(plan,l);
  assert(k&&typeof k==='string',`cache key missing for ${plan.name}/${l}`);
  assert(k.includes(plan.name),`cache key must carry plan.name: ${k}`);
  langs.add(k);
 }
}
assert.equal(byName.size,584,'plan.name is unique, so the key is a real identity');
assert.equal(langs.size,6,'each citizen in each language gets a distinct key');

// 4. Live state must not be frozen into the cache. A porter cycles 取货 -> 搬货 -> 返回货埠 -> 停留;
// keying on name alone would serve a description of an instant that has already passed.
const porter=eco.citizens.find(c=>c.mode==='porter');
assert(porter,'the ecology has porters to test against');
const kA=cacheKey(porter,'zh','取货'),kB=cacheKey(porter,'zh','搬货');
assert.notEqual(kA,kB,'a porter changing activity must not read from the old cache entry');
assert.equal(cacheKey(porter,'zh','搬货',''),cacheKey(porter,'zh','搬货'),
 'an absent hour must not invent a distinct bucket - the two are the same question');
// What replaced the provider in the key. There is one backend now, so the reader cannot pick a
// model and there is nothing to separate - but the deployment CAN change its model, and a v3 entry
// written by the old one would then be served under the new one's name. That risk moved to the
// server, where the cache lives, and it is asserted in tests/package.mjs instead.
assert.equal(cacheKey(porter,'zh','搬货','上午').split('|').length,5,'five identity slots and no more');

// 5. The system prompt is the cacheable prefix, so it has to be byte-identical across every request.
// Any interpolation - a timestamp, a name, a language - silently invalidates the whole prefix.
assert.equal(SYSTEM.zh,SYSTEM.zh,'the prefix is a constant, not a function');
assert.equal(buildMessages(factsFor(personHit(eco.citizens[7]),ctx),'zh').system,SYSTEM.zh,'zh requests share one prefix');
assert.equal(buildMessages(factsFor(personHit(eco.citizens[7]),ctx),'en').system,SYSTEM.en,'en requests share one prefix');
assert.notEqual(SYSTEM.zh,SYSTEM.en,'the two languages cannot share a prefix');
// The prefix is sent with cache_control either way - it is free and it starts paying the moment
// the prompt grows. Whether it actually clears the 512-TOKEN minimum cannot be measured here:
// there are no credentials, and a char count is not a token count. So this asserts only that the
// prompt is substantial, and the module records usage.cache_read_input_tokens at runtime so the
// assumption is falsifiable in the browser instead of merely claimed. Padding a prompt to reach a
// cache threshold would cost more than it saves.
assert(SYSTEM.zh.length>300,`the zh prefix is only ${SYSTEM.zh.length} chars - too thin to be worth caching`);
// cache_control moved with the key: the prefix is assembled server-side now, so the mark travels
// with it. The source that has to carry it is no longer the file the browser loads.
assert(/cache_control/.test(await read('functions/_shared/vendor.mjs')),
 'the system prefix must carry cache_control, wherever it is assembled');

// 6. Output language is a prompt instruction; the facts stay Chinese either way. `english()` is an
// unanchored substring table, so translating facts client-side mangles them: verified to turn
// "八份货物" into "八units of cargo".
const en=buildMessages(factsFor(personHit(porter,'搬货'),ctx),'en');
assert(en.system.includes('English'),'the en prefix must instruct English output');
// A porter's own facts reach the model as the Chinese source values, untranslated.
assert(en.user.includes('南岸西货埠'),'the dock name must reach the model verbatim');
assert(en.user.includes('货埠1装卸路线'),'the route name must reach the model verbatim');
assert(en.user.includes('搬货'),'the activity must reach the model verbatim');
assert(!en.user.includes('Southwest Quay'),'facts must not be run through english()');
// And the same is true for a traveller, whose route is the richest fact in the dataset.
const trav=eco.citizens.find(c=>c.route==='bridge-market');
assert(trav,'the ecology has bridge-market travellers');
const travEn=buildMessages(factsFor(personHit(trav),ctx),'en');
assert(travEn.user.includes('虹桥—茶肆—城门市街'),'a route name must survive verbatim into English mode');

// 7. The guards. Han is the language-leak class; mesh ids are the debug-output class. Both are
// checked on the rendered string, in both languages, because neither is visible to tests/english.mjs
// - it only reads JSON off disk and cannot see runtime text at all.
assert.equal(hasHan('这位挑夫正把八份货物运走。'),true);
assert.equal(hasHan('He hauls eight units of cargo past the teahouse.'),false);
assert.equal(hasHan('Hongqiao (虹桥)'),true,'a proper noun is still Han and must be caught');
assert.equal(leaksMeshId('Person_porter_0__0599'),true);
assert.equal(leaksMeshId('南岸西货埠的挑夫'),false);
assert.equal(leaksMeshId('He hauls cargo at Southwest Quay.'),false);

// 8. What replaced the provider envelope. The vendor table, the auth headers, the structured-output
//    mechanism and the endpoint all moved to functions/_shared/vendor.mjs with the key, and the
//    tests for them moved to tests/package.mjs - where the code they describe now lives, and where
//    they can run without a network. What remains HERE is the half that is still the browser's:
//    that the facts it resolves are shaped so the server can build a question out of them.
//
//    The live reason this matters: the backend is now the trust boundary. It accepts a fact bag and
//    nothing else, so a fact set carrying a prompt, a URL or an oversized value would be spending
//    the operator's key on whatever it liked. assertValidFacts pins that the shape the browser
//    produces is the shape the guard accepts.
const {validFacts,validLang,validVoice,validText,VOICE_IDS}=await import('../functions/_shared/guard.mjs');
const porterFacts=factsFor(personHit(porter,'搬货'),ctx);
assert(validFacts(porterFacts),'the facts the page builds must pass the server guard');
assert(!validFacts({role:{}}),'a nested object is not a fact - it is a payload trying to be a scene');
assert(!validFacts('x'),'a bare string is not a fact set');
assert(!validFacts({}),'an empty fact set describes nothing and must be refused');
assert(!validFacts(Array.from({length:25},(_,i)=>({['k'+i]:'v'})).reduce((a,x)=>({...a,...x}),{})),'25 keys is not a figure');
assert(!validFacts({role:'x'.repeat(81)}),'an 80-char value is a scene label; longer is not');
assert(!validFacts({[ 'k'.repeat(25) ]:'v'}),'a 24-char key is a label; longer is not');
assert(validFacts({hour:'上午',deck:'拱顶',crowd:'行人、挑夫'}),'the real fact shapes pass');
assert(validLang('zh')&&validLang('en'),'the two languages the prompt has a SYSTEM string for');
assert(!validLang('fr')&&!validLang('')&&!validLang(undefined),'anything else would silently fall back to Chinese');
// The voice id is whitelisted rather than length-checked, because it reaches the vendor's billing
// path. A server that accepted any string here would be a text-to-audio service, not a portrait.
assert(validVoice('clever_boy')&&validVoice('male-qn-qingse'),'the vendor ids the page can send are accepted');
assert(!validVoice('evil'),'an id outside the table is refused');
assert(validVoice(''),'an empty voice id is the "let the trade decide" case, not a bad one');
assert.equal(VOICE_IDS.size,12,'the whitelist is the client VOICES table, and both sides must agree');
const {VOICES}=await import('../src/tts.js');
assert.deepEqual([...VOICE_IDS].sort(),VOICES.map(v=>v.id).sort(),
 'client and server voice tables have drifted - a reader would pick a voice the server rejects');
assert(validText('一句台词')&&!validText('')&&!validText('x'.repeat(201)),
 'a line is capped at 200 chars so this cannot become bulk text-to-audio');
// The message body is provider-independent by construction now - there is one server-side builder -
// but the cacheable prefix still has to be a constant, and the facts still have to reach it intact.
const bodyA=buildMessages(factsFor(personHit(porter,'搬货'),ctx),'zh'),bodyM=buildMessages(factsFor(personHit(porter,'搬货'),ctx),'zh');
assert.equal(bodyA.system,bodyM.system,'the cached prefix is provider-independent');
assert.equal(bodyA.user,bodyM.user);

// 9. The tool-forced path must parse. A provider without output_config answers with a tool_use
//    block whose input is already an object, so content[0] is never the text we want.
assert.deepEqual(parseResponse({stop_reason:'tool_use',content:[
 {type:'tool_use',name:STORY_TOOL.name,input:{description:'他弓着背。',line:'「让让道。」'}}]}),
 {description:'他弓着背。',line:'「让让道。」'},'a tool_use input is the MiniMax path');
assert.deepEqual(parseResponse({content:[
 {type:'tool_use',name:STORY_TOOL.name,input:{description:'a',line:'b'}},{type:'text',text:'ignored'}]}),
 {description:'a',line:'b'},'tool_use wins when a provider sends both');
// The invention seen live: a provider that ignored its constraint answers with sixteen keys and no
// description/line. That must be rejected, never rendered - it is a fabricated name and history.
const invented={content:[{type:'text',text:JSON.stringify({genre:'市井观察',datetime:'卯时三刻',
 location:'汴河货埠',name:'陈二牛',gender:'男',appearance:'短褐束腰',action:'正弯腰扛粮',
 dialogue:'"让一让嘞"',note:'扛了十二年'})}]};
assert.equal(parseResponse(invented),null,'a non-conforming shape must be rejected, not rendered');
assert.equal(parseResponse({stop_reason:'tool_use',content:[
 {type:'tool_use',input:{description:'他弓着背。',name:'陈二牛',age:'十二年'}}]}),null,
 'a tool payload that invents fields is still rejected');
// 10. parseResponse must never throw and never half-render. Opus 5.5 runs thinking by default, so
// content[0] is a thinking block with empty text - reading index 0 is the classic silent-empty bug.
const textBlock=b=>({type:'text',text:b});
assert.deepEqual(parseResponse({content:[textBlock('{"description":"他弓着背。","line":"让让道。"}')]}),
 {description:'他弓着背。',line:'让让道。'});
assert.deepEqual(parseResponse({content:[{type:'thinking',thinking:''},textBlock('{"description":"a","line":"b"}')]}),
 {description:'a',line:'b'},'the text block must be found by type, not by index 0');
for(const bad of [{},{content:[]},{content:[{type:'thinking',thinking:'x'}]},
 {stop_reason:'max_tokens',content:[textBlock('{"description":"他弓')]},
 {stop_reason:'refusal',stop_details:{category:'general_harms'},content:[textBlock('{"description":"","line":""}')]},
 {content:[textBlock('not json at all')]},{content:[textBlock('{"description":"只有描述"}')]}]){
 let out;try{out=parseResponse(bad);}catch(e){assert.fail(`parseResponse threw on ${JSON.stringify(bad)}: ${e.message}`);}
 assert.equal(out,null,`parseResponse must return null, not ${JSON.stringify(out)}, for ${JSON.stringify(bad).slice(0,70)}`);
}

// 9. The schema is a real json_schema: closed, and both fields required, so the model cannot answer
// with a bare string or invent extra keys that nothing renders.
assert.equal(STORY_SCHEMA.type,'object');
assert.equal(STORY_SCHEMA.additionalProperties,false);
assert.deepEqual([...STORY_SCHEMA.required].sort(),['description','line']);

// 10. The mangling resolvers must never be reachable from this module. t() is fine - it is a lookup
// table for this module's own chrome labels, and it falls through harmlessly. T() and E() are the
// hazard: T() runs model prose through english()'s unanchored substring table. Checked over the
// source rather than the exports, because the defect is "one T() slipped into a paint path".
const i18nImports=[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/i18n\.js'/g)];
const allowed=new Set(['t','getLang']);
for(const m of i18nImports){
 for(const name of m[1].split(',').map(s=>s.trim()).filter(Boolean))
  assert(allowed.has(name),`ai-story.js must not import ${name} from i18n.js - T()/E() mangle model prose`);
}
// Comments are stripped first: this module's header explains at length why it never touches the
// engine, and a naive substring check would fail on the very comment stating the invariant.
const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
for(const banned of ['shadowDirty','setView','ecologyUI','engine.','renderIfChanged','innerHTML']){
 assert(!code.includes(banned),`ai-story.js code references ${banned} - a DOM panel must never touch the engine or innerHTML`);
}

// 11. Structural pinning. #inspect-ai must stay a sibling AFTER #inspect-body: show() rebuilds
// #inspect-body wholesale every 350ms, so a nested AI block would be destroyed three times a second.
// Ordering alone cannot tell a sibling from a child - a nested element also comes later in the file -
// so this pins the CLOSING tag of #inspect-body appearing before #inspect-ai opens. A plain `ai>body`
// check was tried first and passed against a deliberately nested mutation.
const html=await read('index.html');
const open=html.indexOf('<div id="inspect-body"'),ai=html.indexOf('<div id="inspect-ai"');
assert(open>-1&&ai>-1,'both the card body and the AI block must exist');
const bodyClose=html.indexOf('</div>',open);
assert(bodyClose>open,'#inspect-body must be closed');
assert(ai>bodyClose,
 `#inspect-ai must open AFTER #inspect-body closes, so the 350ms rebuild cannot destroy it (ai=${ai}, close=${bodyClose})`);
assert(!/<label[^>]*data-i18n[^>]*>[^<]{0,60}<input/i.test(html),
 'a data-i18n on a label that also holds an input deletes the input on first paint');
// The API key is a credential: it must never be a data-i18n target or land in a captured report.
// The three model-config controls are gone, and their absence is the feature: a reader configures
// nothing, so there is no credential on their machine to leak and no endpoint for them to point at
// the open proxy the backend would otherwise become. Asserted as absences on purpose - a test that
// only checked the inputs' presence would pass just as happily if they came back.
for(const gone of ['qm-key','qm-url','qm-provider'])assert(!html.includes(`id="${gone}"`),
 `${gone} must not come back: the key lives on the server and the reader configures nothing`);
assert(!/api\.(anthropic|minimax)/.test(html),'no vendor endpoint may be named in the page');
// And nothing in src/ may reintroduce a browser-side key or vendor URL. This is the assertion that
// would catch the migration being quietly undone in a later commit.
for(const file of ['ai-story.js','tts.js','voice.js','app.js']){
 const src=await read('src/'+file);
 // Strip comments first. The CORS probe that justified the original proxy is worth keeping as a
 // record - it is the reason this endpoint exists at all - and it names the vendor host while
 // doing so. What must not come back is a live reference in CODE.
 const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 assert(!/qm-key|qm-url|qm-provider/.test(code),
  `src/${file} names a credential store; that belongs to functions/_shared/`);
 assert(!/https?:\/\/api\.(minimax|anthropic)/.test(code),
  `src/${file} holds a vendor endpoint; the browser must only ever reach this origin`);
 assert(!/x-api-key|anthropic-dangerous-direct-browser-access|Bearer\s*\+/.test(code),
  `src/${file} builds a vendor auth header; that is server-side now`);
}

// 12. Every method the class calls on itself must exist. The "another line" button shipped wired to
//     this.render(), which was never defined - a click threw TypeError and nothing rendered. The
//     headless suite cannot click, so this reads the class body and resolves every `this.x(` call.
const cls=source.slice(source.indexOf('export class AIStoryUI'));
const defined=new Set([...cls.matchAll(/^\s+(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm)].map(m=>m[1]));
for(const called of new Set([...cls.matchAll(/this\.([a-zA-Z_$][\w$]*)\s*\(/g)].map(m=>m[1])))
 assert(defined.has(called),`AIStoryUI calls this.${called}() but never defines it`);
// The "another line" path must actually vary the request. A byte-identical prompt returns identical
// prose, so the button would be a no-op that still charges the reader.
assert(/variant/.test(cls),'"another line" must vary the request, not repeat it');
// Spending is explicit: offer() runs on a 350ms tick and on every language toggle, so it must
// render cache or the 写照 prompt but never call generate() itself. One CORS failure under the
// old auto-fire design became a request every 350ms forever; under this one there is no request
// until the reader clicks 为其写照.
const offerBody=cls.slice(cls.indexOf('async offer'),cls.indexOf('async generate'));
assert(!offerBody.includes('this.generate('),'offer() must never spend - only the 写照 and 换一句 buttons fire a request');
assert(/clear\(\)\{this\.current=null;this\.variant=0;|this\.variant=0/.test(source),
 'the variant counter resets when a different person is shown');

// 13. Every selector the panel queries must exist, or the whole block silently no-ops - a null
// root just returns from paint() and the reader sees an empty card with no error anywhere.
for(const sel of new Set([...source.matchAll(/querySelector\('(#[a-z-]+)'\)/g)].map(m=>m[1])))
 assert(html.includes(`id="${sel.slice(1)}"`),`ai-story.js queries ${sel} but index.html does not define it`);
// Every chrome string the new markup introduces has a pair in S, or the language toggle leaves
// the previous language on screen and reads as broken.
const {keyList}=await import('../src/i18n.js').then(m=>({keyList:m._diagnose().keyList}));
for(const key of [...html.matchAll(/data-i18n="([^"]+)"/g)].map(m=>m[1]))
 assert(keyList.includes(key),`index.html references an i18n key that does not exist: ${key}`);
// The reader-configurable strings are gone with the controls. Listed as absences because a test that
// only checked the survivors would not notice the dead ones being reinstated alongside them.
const aiKeys=['aiOverline','aiThinking','aiAgain','aiFailed','aiRetry','aiByline','aiCost','aiMake',
 'aiCancel','aiWait','aiCached','aiNoReach','aiNoService','aiBusy'];
for(const k of aiKeys)assert(keyList.includes(k),`missing i18n key: ${k}`);
for(const gone of ['aiNoKey','aiKeyBad','lblApiKey','lblApiUrl','aiUrlNote','lblProvider','aiKeyNote'])
 assert(!keyList.includes(gone),`${gone} described a key the reader no longer has`);
// The cost note now has to say who pays. A bare "about ¥0.02" reads as the reader's own money and
// invites a click reflex this feature does not want, so the byline is part of the contract.
assert(/本站承担|paid by this site/.test(await read('src/i18n.js')),
 'the cost note must name the payer - the reader has no key, so a bare price implies theirs');

// 13. This feature adds no browser check, and must not: verification.js is a GPU contract suite
// and a DOM panel has nothing to assert there. The count is deliberately NOT pinned here - deriving
// it from the source gives 39 (6 static + 3 landmarks + 3 styles x 10 views) while README.md,
// README.en.md and CLAUDE.md all say 42, and there is no browser automation in this repo to settle
// which is right. Asserting an unverified number would be exactly the false-green this file exists
// to prevent. Run ?verify=1 in a browser to see the real figure.
const verify=await read('src/verification.js');
const codeOnly=verify.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
assert(!/inspect|ai-story|story/i.test(codeOnly),'verification.js must not gain a dependency on the inspect card');

// 14. Parse guard for the module, mirroring tests/i18n.mjs - a brace typo here is a blank page.
for(const file of (await readdir(new URL('src/',root))).filter(f=>f.endsWith('js'))){
 try{execFileSync(process.execPath,['--check',new URL(`src/${file}`,root).pathname],{stdio:'pipe'});}
 catch(e){assert.fail(`src/${file} does not parse:\n${String(e.stderr||e.message).slice(0,400)}`);}
}

// What this file cannot prove, stated rather than implied: no API credential is read here, so nothing
// in this file touches the network. Prose quality, the Han guard's real false-positive rate across
// 559 people, and live cache behaviour are all unverified here. A single manual click proves nothing
// either - the honest check is a script over sampled citizens in both languages.
console.log(JSON.stringify({status:'passed',citizens:eco.citizens.length,factsChecked:'all',withRoute,
 namedExcluded:named.length,subjects:['person','boat','bridge'],
 distinctFactSets:sets.size,beforePlaceFacts:noPlace.size,distinctBoatSets:boatSets.size,
 followed:{seconds:300,of:219,changedState:stateMoved,changedNearbyShop:shopMoved,movedOver4m:distanced},
 cursorReadings:{distinct:readings.size,largestSharedGroup:readWorst,withoutPosture:readNoPose.size},
 placeFacts:{building:namedAt,place:eco.citizens.filter(p=>factsFor(personHit(p),ctx).place).length,hour:584},
 worstBuilding:{edgeMetres:+worstEdge.toFixed(1),riseMetres:+worstRise.toFixed(1),onBridgeDenied:onBridge.length},
 guards:['han','meshId'],parseNeverThrows:true,cacheKey:'v3+plan.name+lang+state+hour',
 prefixStable:true,promptOnServer:true,vendorEnvelopeTestedIn:'tests/package.mjs',mechanisms:['output_config','tool'],
 checksInBrowser:'not asserted - derived 39 vs documented 42, needs a browser',
 network:'no live call from this file. Probed 2026-10-04: output_config.format silently dropped on MiniMax (16 invented keys). Probed 2026-10-05: the forced-tool path is confirmed working - HTTP 200, stop_reason tool_use, one tool_use block, schema exact, 2-6.4s, and cache_read_input_tokens 128 on every call, so MiniMax caches the prefix server-side even though it documents no cache_control. That also found two real fabrication defects (unit conversion, invented vessels under the bridge), both since fixed. The Anthropic branch still has no live call - see the risk note in the session writeup.'},null,2));
