import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');
const json=async p=>JSON.parse(await read(p));
const {factsFor,buildMessages,parseResponse,cacheKey,hasHan,leaksMeshId,STORY_SCHEMA,SYSTEM}=await import('../src/ai-story.js');
const eco=await json('public/runtime/ecology.json'),nav=await json('public/runtime/navigation.json');
const han=/\p{Script=Han}/u;
// The same shape tests/i18n.mjs:121 uses. The cards once printed `Handcart__0912` and
// `Person_merchant_0__0674` verbatim, so this is a defect class this repo has actually shipped.
const meshId=/[A-Za-z]__\d+$|^(Person|Main_street|Courtyard|South_approach|North_approach)_\S*__?\d+$/;
const byName=new Map(eco.citizens.map(c=>[c.name,c]));
const source=await read('src/ai-story.js');

// --- Facts. Only what the data actually asserts: no name, no home, no invented history.
const routes=new Map(eco.routes.map(r=>[r.id,r.name])),docks=new Map(eco.docks.map(d=>[d.id,d.name]));
// The same shape InspectUI builds, so a change to that contract breaks here first.
const ctx={routes,docksById:docks};
const walkable=new Set();
for(const p of nav.prefabs?Object.values(nav.prefabs):[])for(const f of p.floors||[])walkable.add(f);
const personHit=(plan,state=null)=>({kind:'person',lifePlan:plan,state,person:{id:0,clip:plan.clip,rig:plan.role==='child'?'child':'adult'}});

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

// 3. The cache key is plan.name + lang, and it must separate languages - a Chinese description shown
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
assert(/cache_control/.test(source),'the system prefix must carry cache_control');

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

// 8. parseResponse must never throw and never half-render. Opus 5.5 runs thinking by default, so
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
assert(/id="qm-key"/.test(html),'the key input exists');
assert(!/data-i18n="[^"]*"[^>]*>[^<]{0,20}<input[^>]*qm-key/.test(html),'the key input is not inside a data-i18n element');

// 12. Every selector the panel queries must exist, or the whole block silently no-ops - a null
// root just returns from paint() and the reader sees an empty card with no error anywhere.
for(const sel of new Set([...source.matchAll(/querySelector\('(#[a-z-]+)'\)/g)].map(m=>m[1])))
 assert(html.includes(`id="${sel.slice(1)}"`),`ai-story.js queries ${sel} but index.html does not define it`);
// Every chrome string the new markup introduces has a pair in S, or the language toggle leaves
// the previous language on screen and reads as broken.
const {keyList}=await import('../src/i18n.js').then(m=>({keyList:m._diagnose().keyList}));
for(const key of [...html.matchAll(/data-i18n="([^"]+)"/g)].map(m=>m[1]))
 assert(keyList.includes(key),`index.html references an i18n key that does not exist: ${key}`);
const aiKeys=['aiOverline','aiThinking','aiAgain','aiNoKey','aiFailed','aiRetry','aiByline','lblApiKey','aiKeyNote','aiCost'];
for(const k of aiKeys)assert(keyList.includes(k),`missing i18n key: ${k}`);

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

// What this file cannot prove, stated rather than implied: there are no API credentials on this
// machine, so nothing here touches the network. Prose quality, the Han guard's real false-positive
// rate across 559 people, and live cache behaviour are all unverified here. A single manual click
// proves nothing either - the honest check is a script over sampled citizens in both languages.
console.log(JSON.stringify({status:'passed',citizens:eco.citizens.length,factsChecked:'all',withRoute,
 namedExcluded:named.length,guards:['han','meshId'],parseNeverThrows:true,cacheKey:'plan.name+lang+state',
 prefixStable:true,checksInBrowser:'not asserted - derived 39 vs documented 42, needs a browser',network:'not exercised - no credentials in this environment'},null,2));
