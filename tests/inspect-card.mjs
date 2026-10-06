// Card-text contract. describe() is a pure function of (hit, ctx) - it was exported for exactly
// this, the same reason simulation.js exports pick() - so the strings a reader sees can be pinned
// without a DOM or a GPU.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
registerHooks({resolve(specifier,ctx,next){if(specifier==='qingming/micro')return{url:new URL('src/micro.js',root).href,shortCircuit:true};if(specifier==='three/core')return{url:new URL('vendor/three.core.js',root).href,shortCircuit:true};if(specifier==='three')return{url:new URL('vendor/three.module.js',root).href,shortCircuit:true};return next(specifier,ctx);}});
const {describe,hoverLine,followable}=await import('../src/inspect.js');
const {followForward}=await import('../src/simulation.js');
const {t,T,E,setLang,getLang}=await import('../src/i18n.js');
const nav=JSON.parse(await readFile(new URL('public/runtime/navigation.json',root),'utf8'));
const eco=JSON.parse(await readFile(new URL('public/runtime/ecology.json',root),'utf8'));
const han=/\p{Script=Han}/u;
const meshId=/[A-Za-z]__\d+$|^(Person|Main_street|Courtyard|South_approach|North_approach)_\S*__?\d+$/;

const ctx={instances:new Map(nav.instances.map(i=>[i.name,i])),prefabs:nav.prefabs,boats:eco.boats,docks:eco.docks,
 water:eco.water,landmarks:nav.landmarks,
 rooms:nav.instances.filter(i=>nav.prefabs[i.prefab]?.kind)
  .map(i=>({name:nav.prefabs[i.prefab].kind,x:i.matrix[12],y:i.matrix[13]}))};
const rowOf=(card,label)=>card.rows.find(([k])=>k===label)?.[1];
const porter=(over={})=>({kind:'person',lifePlan:{role:'porter',mode:'porter',clip:'Idle'},state:'搬货',
 person:{clip:'Idle',rig:'adult',p:[0,0,2.26]},...over});
// The gesture row is found by its key, never by position: a row added above it must not silently
// repoint this test at the wrong field.
const gestureOf=hit=>rowOf(describe(hit,ctx),t('rGesture'));

// --- The gesture row must read the LIVE clip. `plan.clip` is the authored placement default, so
// every card used to say 静立 about anyone who was moving. The live value was on the hit the whole
// time; personHit() has always carried the actor. Walk is the one this actually puts on screen -
// measured over 100 simulated seconds the live clips are Idle, Sit, Talk, Walk and Work, and Carry
// never occurs (porter cargo never leaves 0), so a Carry case here is a unit test of the mapping,
// not evidence that a citizen ever shows it.
for(const [clip,label] of [['Carry','负重'],['Walk','行走'],['Talk','攀谈'],['Sit','闲坐'],['Work','劳作'],['Idle','静立']]){
 setLang('zh');
 assert.equal(gestureOf(porter({person:{clip,rig:'adult',p:[0,0,2.26]}})),label,
  `the live clip ${clip} must reach the card as ${label}, not the authored Idle`);
}
// The authored default is still the fallback: a hit with no actor must not print undefined.
setLang('zh');
assert.equal(gestureOf(porter({person:undefined})),E('Idle'),'no actor falls back to the authored clip');
assert(gestureOf(porter({person:undefined}))!==undefined,'the fallback must render, not disappear');
// ...and an unknown live clip must not blank the row either.
assert.equal(gestureOf(porter({person:{clip:'Dancing',rig:'adult',p:[0,0,2.26]}})),'Dancing',
 'an unmapped clip falls through E() rather than vanishing');

// --- Every card the reader can open must be free of the two leak classes this repo has shipped.
setLang('en');
const surfaces=[
 {kind:'water',point:[20,0,.28]},
 // The eco.boats records are the authored config; the live ones gain speedNow/state in the
 // CityEcology constructor, and the card reads those, so the fixture has to carry them too.
 {kind:'boat',boat:{...eco.boats[0],speedNow:.78,state:'航行'},point:[0,0,1]},
 {kind:'convoy',convoy:{id:0,cart:'Handcart__0906',animal:'Horse_saddled__0907',state:'运送',speedNow:.7,cargo:4,station:0,distance:120}},
 {kind:'person',lifePlan:{role:'merchant',mode:'shopkeeper',clip:'Talk'},state:'停留',person:{clip:'Talk',rig:'adult',p:[0,0,2.26]}},
 {kind:'room',building:{name:'Shop_00',stories:2},room:{name:'茶肆营业厅',storey:1.9},district:'05_Main_street',point:[0,0,2.26]},
 {kind:'door',door:{a:{name:'Door_Shop_00_1'},mo:{label:'楼台门'},box:{x:0,y:0}},open:false,point:[0,0,2.26]},
 {kind:'landmark',landmark:{name:'虹桥南 · 开始步行',inside:false},point:[0,0,2.26]},
 {kind:'surface',surface:'bridge',point:[0,0,6.8]}];
for(const hit of surfaces){
 const card=describe(hit,ctx),text=[card.overline,card.title,...card.rows.flat()].join(' ');
 assert(!han.test(text),`English card leaks Han: ${text}`);
 assert(!meshId.test(text),`card leaks a mesh id: ${text}`);
 assert(!/undefined|NaN|\[object/.test(text),`card leaked a JS value: ${text}`);
}
// And the same seven in Chinese, which is the default language and the one the data is authored in.
setLang('zh');
for(const hit of surfaces){
 const card=describe(hit,ctx),text=[card.overline,card.title,...card.rows.flat()].join(' ');
 assert(text.trim().length>0,'a card must never render empty');
 assert(!meshId.test(text),`zh card leaks a mesh id: ${text}`);
 assert(!/undefined|NaN|\[object/.test(text),`zh card leaked a JS value: ${text}`);
}
// The door card used to print the door's own asset id under 建筑 - `Door_Shop_00_1`, in both
// languages, because english() has no row for it. An asset id with no __NNNN suffix slips past the
// meshId regex, which is why it survived, so it is pinned by value here rather than by pattern.
for(const lang of ['zh','en']){
 setLang(lang);
 const row=rowOf(describe(surfaces[5],ctx),t('rBuilding'));
 assert.notEqual(row,'Door_Shop_00_1','the door card must not print the door asset id as the building');
 assert(!/^Door_/.test(row??''),`the door card leaked an asset id: ${row}`);
}
// A language switch must change the chrome, or the toggle silently leaves the old language up.
setLang('en');
const en=describe(surfaces[4],ctx),enAgain=describe(surfaces[4],ctx);
setLang('zh');
const zh=describe(surfaces[4],ctx);
assert.notEqual(en.title,zh.title,'the room card title must follow the language');
assert.equal(enAgain.title,en.title,'rendering twice in one language must be stable');
setLang(getLang());

// --- The cursor readout. hoverLine() is the same purity contract as describe(): the whole reason
// this can be asserted headlessly is that neither reaches for a DOM or an engine.
const at=(name,x,y,extra={})=>({name,x,y,lo:0,hx:4,hy:4,angle:0,...extra});
// A figure 3m off a cloth shop, with a landmark 10m away whose name is that same shop. 13 of the 16
// authored landmarks are shop names with a " · 入内" suffix, so this collision is the normal case
// and not a contrived one: without the suppression the line would name the cloth shop twice.
const hoverCtx={...ctx,rooms:[at('布庄',3,0)],landmarks:[{name:'布庄 · 入内',position:[10,0,2.26]}]};
const nearShop=porter({person:{clip:'Walk',rig:'adult',p:[0,0,2.26]}});

// A hit with no room and no landmark nearby still names the figure rather than going silent.
for(const lang of ['zh','en']){
 setLang(lang);
 const bare=hoverLine(porter({person:{clip:'Idle',rig:'adult',p:[900,900,2.26]}}),ctx);
 assert(Array.isArray(bare)&&bare.length===2,`${lang}: a figure with no location still reads 行当 + 身段, got ${JSON.stringify(bare)}`);
}
setLang('zh');
const shopLine=hoverLine(nearShop,hoverCtx);
// The dedup is about how many times the shop is named, not how many segments there are.
assert.equal(shopLine.filter(s=>s.includes('布庄')).length,1,`the building must suppress the landmark that repeats it: ${JSON.stringify(shopLine)}`);
assert.equal(shopLine.length,3,`trade + location + posture is the whole readout: ${JSON.stringify(shopLine)}`);
assert.equal(shopLine[0],E('porter'),'the first segment is the trade');
assert(shopLine[1].startsWith(t('hNear')),`the second segment is the nearby building: ${JSON.stringify(shopLine)}`);
// The location fact and the posture fact are the two halves that make this a readout; dropping
// either one is invisible in a smoke test and obvious here: 107 distinct readings without the
// posture against 359 with it, and 33 figures sharing one reading without it.
assert(!shopLine[1].includes('入内'),'the landmark suffix must be stripped, it is a UI instruction');
const placeHit=porter({person:{clip:'Idle',rig:'adult',p:[0,0,2.26]}});
const withPlace=hoverLine(placeHit,{...ctx,rooms:[],landmarks:[{name:'城门 · 穿城',position:[6,0,2.26]}]});
assert.equal(withPlace.length,3,`a landmark and a posture are three segments: ${JSON.stringify(withPlace)}`);
assert(withPlace[1].startsWith(t('hPlace')),`without a room the landmark segment takes its place: ${JSON.stringify(withPlace)}`);

// The gate is portraitable(), so a readout appears exactly where a portrait could. The one-word
// bridge case is deliberate: its remaining facts are prompt-only Chinese and a half-translated
// line is worse than none.
for(const [name,hit] of [['room',surfaces[4]],['door',surfaces[5]],['water',surfaces[0]],['convoy',surfaces[2]],['landmark',surfaces[6]]])
 assert.equal(hoverLine(hit,ctx),null,`${name} must not produce a cursor readout`);
setLang('zh');
assert.deepEqual(hoverLine(surfaces[7],ctx),[t('surfBridge')],'the bridge reads as one word');
setLang('en');
assert.deepEqual(hoverLine(surfaces[7],ctx),[t('surfBridge')],'the bridge word is translated');
assert.equal(t('surfBridge'),'Hongqiao bridge','and it is a name, not the generic deck label');
const boatLine=hoverLine(surfaces[1],ctx);
assert.equal(boatLine.length,2,`a boat reads as type + state: ${JSON.stringify(boatLine)}`);

// The readout is the one place in the UI where a value reaches the screen without a click, and
// its inputs are the same leak classes the card already had.
for(const lang of ['zh','en']){
 setLang(lang);
 for(const hit of [nearShop,surfaces[1],surfaces[7],placeHit]){
  const text=hoverLine(hit,hoverCtx).join(' · ');
  assert(text.trim().length>0,`${lang}: the readout must never render empty`);
  if(lang==='en')assert(!han.test(text),`the English readout leaks Han: ${text}`);
  assert(!meshId.test(text),`the readout leaks a mesh id: ${text}`);
  assert(!/undefined|NaN|\[object/.test(text),`the readout leaked a JS value: ${text}`);
 }
}
setLang(getLang());

// --- The readout's DOM contract, which cannot be checked by calling hoverLine(). It must be a
// sibling of the canvas and NOT inside #inspect-body: show() rebuilds that node wholesale every
// 350ms, and an ordering check cannot tell a sibling from a child - tests/ai-story.mjs pins that
// for #inspect-ai by comparing closing tags, and the same hazard now applies here.
const html=await readFile(new URL('index.html',root),'utf8');
const css=await readFile(new URL('src/style.css',root),'utf8');
assert(/<div id="hover-readout"[^>]*hidden/.test(html),'the readout must ship hidden, or it paints over the loading screen');
const bodyOpen=html.indexOf('id="inspect-body"'),bodyClose=html.indexOf('</div>',bodyOpen);
assert(html.indexOf('id="hover-readout"')>bodyClose,'the readout must not be a child of #inspect-body, which is rebuilt every 350ms');
assert(css.includes('#hover-readout[hidden]{display:none}'),
 'the element sets its own display, so without this the user-agent [hidden] rule loses and it never hides - the same trap as #walk-status and #inspect-ai');
assert(/#hover-readout\{[^}]*z-index:26/.test(css),'the readout is repositioned under the cursor and must sit above #tools (z-index 25)');
assert(/#hover-readout\{[^}]*pointer-events:none/.test(css),'a readout that swallowed clicks would break the card it sits next to');

// --- Following one figure. Three subject kinds, three different heading conventions, and person
// and convoy differ by a quarter turn - copy the wrong one and the camera lands 90 degrees off,
// which still produces a plausible-looking shot and is invisible until someone rides it.
const rot=([x,y],a)=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];
for(const h of [0,0.7,-0.7,Math.PI/2,-Math.PI/2,2.4]){
 const f={boat:followForward('boat',h),person:followForward('person',h),cart:followForward('cart',h)};
 for(const k of ['boat','person','cart'])assert(Math.abs(Math.hypot(...f[k])-1)<1e-9,`the ${k} forward vector must be a unit vector, got ${f[k]}`);
 // A boat heading is atan2(dir[1],dir[0]), so its forward IS that direction. An actor's heading is
 // atan2(dx,-dy) of its own movement, so its forward is the mirror of the boat's across x - which
 // is why person and cart are not a fixed rotation apart and meet again at h=0 and h=PI.
 const mirrored=rot(f.boat,-2*h);
 assert(Math.hypot(f.person[0]-mirrored[0],f.person[1]-mirrored[1])<1e-9,
  `a person forward must be the boat direction reflected across x, got ${f.person} not ${mirrored}`);
 // The convoy convention is the boat one turned a fixed quarter, and that is the one place where a
 // copy-paste produces a plausible shot rotated 90 degrees.
 const turned=rot(f.boat,-Math.PI/2);
 assert(Math.hypot(f.cart[0]-turned[0],f.cart[1]-turned[1])<1e-9,
  `a convoy forward must be the boat direction turned -90 degrees, got ${f.cart} not ${turned}`);
}
// The two that get confused are person and cart, and at a realistic street heading they land in
// genuinely different places.
assert.notDeepEqual(followForward('person',0.7),followForward('cart',0.7),'person and convoy must not resolve to the same vector');
// Reconstructing the movement from the heading is the invariant that actually matters: for a boat
// and an actor alike, the forward vector must be the direction it is travelling.
for(const h of [0.3,1.1,-2.2]){
 assert(Math.abs(followForward('person',h)[0]-Math.cos(h))<1e-12,'cos component');
 assert(Math.abs(followForward('person',h)[1]+Math.sin(h))<1e-12,'an actor heading is atan2(dx,-dy), so -sin recovers dy');
}

// --- Who is followable. actor.life, NOT actor.walk: attachPeople clears walk on every planned
// actor, so all 584 figures have walk=false and testing on it would hide the button for everyone.
// The 25 instances authored with motion.kind==='walk' are all travellers or porters, so they are
// already inside the 219 - counting them again is how this was first miscounted as 244.
const movable=eco.citizens.filter(c=>c.mode==='traveller'||c.mode==='porter');
assert.equal(movable.length,219,`the followable population changed: ${movable.length}`);
const byName=new Map(eco.citizens.map(c=>[c.name,c]));
const man=JSON.parse(await readFile(new URL('public/runtime/city.json',root),'utf8'));
const walked=[];
for(const a of man.assets){if(!a.name.startsWith('Person'))continue;
 for(const inst of a.instances)if((inst.motion||{}).kind==='walk'&&!inst.motion.kind.includes('boat')&&!a.name.includes('child'))walked.push(inst.name);}
assert.equal(walked.length,25,`expected 25 authored walk instances, got ${walked.length}`);
for(const n of walked)assert(['traveller','porter'].includes(byName.get(n)?.mode),
 `${n} is authored to walk but is not a traveller or porter, so attachPeople will not give it actor.life and the follow button will never appear for it`);
const living={role:'traveller'};
assert.equal(followable({kind:'person',lifePlan:living,person:{life:{state:'往来'}}}),true,'a citizen with a life record is followable');
for(const [name,hit] of [['a static resident',{kind:'person',lifePlan:{role:'resident'},person:{life:null}}],
 ['a shopkeeper',{kind:'person',lifePlan:{role:'shopkeeper'},person:{}}],
 ['no actor at all',{kind:'person',lifePlan:{role:'porter'}}],
 ['a boat',surfaces[1]],['a bridge',surfaces[7]],['a room',surfaces[4]]])
 assert.equal(followable(hit),false,`${name} must not be followable`);

// The follow button is a sibling of #inspect-body for the same reason #inspect-ai is: show() wipes
// that node every 350ms, so a button inside it would be destroyed three times a second.
const fo=html.indexOf('<div id="inspect-follow"'),fb=html.indexOf('<div id="inspect-body"'),fc=html.indexOf('</div>',fb),fai=html.indexOf('<div id="inspect-ai"');
assert(fb<fc&&fc<fo,'#inspect-follow must open after #inspect-body closes');
assert(fo<fai,'#inspect-follow must open before #inspect-ai, so the AI sibling contract still holds');
assert(/<div id="inspect-follow" hidden/.test(html),'the follow row must ship hidden');
assert(css.includes('#inspect-follow[hidden]{display:none}'),'the row sets its own display, so it needs the [hidden] override');
// Its data-i18n sits on the button itself and that button holds only text, so the destructive
// check in tests/i18n.mjs - applyStatic() assigning textContent destroys children - cannot fire.
assert(/<button id="follow-person"[^>]*data-i18n="btnFollowPerson"[^>]*>[^<]*<\/button>/.test(html),
 'the follow button carries its own label and no child control');

// --- The map key and the ledger, which live in ecology-ui.js. Both are pure functions of the
// ecology config, exported for the same reason describe() and hoverLine() are: a panel that can
// only be checked by opening it in a browser is a panel nobody opens.
const {legendRows,statRows,TINT}=await import('../src/ecology-ui.js');
const key=legendRows(eco.routes);
const byKind=Object.fromEntries(key.map(g=>[g.kind,g]));
// 25 records collapse onto 19 paths: five vessels share the main channel and three the eastern one.
// The key must report paths, not records - a "25 routes" label over a map that draws fewer is the
// kind of small lie a key exists to prevent.
assert.equal(eco.routes.length,25,`the authored route count changed: ${eco.routes.length}`);
assert.equal(byKind.pedestrian.records,8);
assert.equal(byKind.pedestrian.chains,8,'all eight pedestrian routes are distinct paths');
assert.equal(byKind.porter.records,4);
assert.equal(byKind.caravan.records,1);
assert.equal(byKind.boat.records,12);
assert.equal(byKind.boat.chains,6,`the river must report 6 channels, got ${byKind.boat.chains}`);
assert.equal(key.reduce((n,g)=>n+g.chains,0),19,'19 distinct paths in total');
// The map and the key now call the same chainsOf(), so this is the whole guarantee that the key
// cannot describe a map that draws something else: 19 here is 19 strokes in renderMap.
// Names are authored in Chinese and go through T(); English must come out with no Han, and no
// route name may print its own id.
const han2=/\p{Script=Han}/u;
for(const lang of ['zh','en']){
 setLang(lang);
 for(const g of legendRows(eco.routes)){
  assert(g.names.length>0,`${lang}: the ${g.kind} group has no names`);
  for(const n of g.names){assert(!/undefined|NaN|\[object/.test(n),`${lang}: legend name leaked a JS value: ${n}`);
   assert(!/Vessel_\d+|_loading_route|caravan-|porter-\d|pedestrian/.test(n),`${lang}: legend name leaked a route id: ${n}`);
   if(lang==='en')assert(!han2.test(n),`the English key leaks Han: ${n}`);}
  assert(g.head&&!/legend|Chains/.test(g.head),`${lang}: a group header fell through to a key: ${g.head}`);}}
setLang('en');
assert(byKind.boat.names[0].includes('×')||byKind.boat.names[0].includes('Vessel'),'the vessel breakdown must be present');
// The swatch colours are the map's own stroke colours; a key whose square is a different colour
// from its line is worse than no key.
for(const [k,v] of Object.entries(TINT))assert(/^#[0-9a-f]{6}$/i.test(v),`TINT.${k} is not a colour: ${v}`);

// The ledger shows only counters observed to move. Over 1200 simulated seconds boatNearMisses,
// groundBlocks and personReplans never fired and boatOverlaps has no increment site at all, so a
// row reading 0 for those would assert a safety the code cannot back up.
const stats=statRows({stats:{berthVisits:5,transferred:40,delivered:76,consumed:76,
 boatDistance:10113,landDistance:6007,mobilePeople:219,anchoredPeople:365}});
const flat=stats.flatMap(g=>g.rows.map(([k,v])=>k+' '+v)).join(' | ');
for(const banned of ['险情','Near','受阻','Blocked','改道','Replan','Overlap','steps'])
 assert(!flat.includes(banned),`the ledger shows a counter that never fires: ${banned}`);
assert(flat.includes('5'),'berths must be shown');
for(const lang of ['zh','en']){
 setLang(lang);
 const rows=statRows({stats:{berthVisits:5,transferred:40,delivered:76,consumed:76,boatDistance:10113,landDistance:6007,mobilePeople:219,anchoredPeople:365}});
 const text=rows.flatMap(g=>[g.head,...g.rows.flat()]).join(' ');
 assert(!/undefined|NaN|\[object/.test(text),`${lang}: the ledger leaked a JS value`);
 if(lang==='en')assert(!han2.test(text),`the English ledger leaks Han: ${text}`);}
assert.match(statRows({stats:{boatDistance:10113,landDistance:6007,berthVisits:0,transferred:0,delivered:0,consumed:0,mobilePeople:0,anchoredPeople:0}})
 .flatMap(g=>g.rows).find(([k])=>k===t('stRiver'))[1],/km$/,'distances over a kilometre are reported in km');
// The panel already carries a ledger above this block: 卸货 (stats.transferred), 入仓 (the sum of
// dock.delivered) and 送达 (stats.delivered). Those are three different quantities and the block
// once printed the second and third again under the first's word, which measured live as 入仓 0 in
// the ledger and 入仓 16 in the block, 250px apart. No label may appear in both.
const ledgerLabels=['卸货','入仓','送达','Unloaded','Warehoused','Delivered'];
for(const label of ledgerLabels)
 assert(!flat.includes(label),`the stats block repeats the ledger's "${label}" - the panel would show two different numbers under one word`);
setLang(getLang());
console.log(`inspect-card: ok — card, cursor readout, follow and the map key clean in both languages; key reports 25 records as 19 paths, followable pinned at ${movable.length}`);
