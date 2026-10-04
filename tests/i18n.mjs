// Bilingual UI contract. tests/english.mjs proves the English view has no Han left; this proves
// the Chinese view is actually reachable, that no table row lost a language, and that every value
// the cards can display survives both resolvers. Run headless, so i18n.js must not touch document
// outside setLang's guarded write.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
registerHooks({resolve(specifier,ctx,next){if(specifier==='qingming/micro')return{url:new URL('src/micro.js',root).href,shortCircuit:true};if(specifier==='three/core')return{url:new URL('vendor/three.core.js',root).href,shortCircuit:true};if(specifier==='three')return{url:new URL('vendor/three.module.js',root).href,shortCircuit:true};return next(specifier,ctx);}});
const i18n=await import('../src/i18n.js');
const {t,T,E,district,setLang,getLang,_diagnose}=i18n;
const {english}=await import('../src/english.js');
const json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const [nav,eco]=await Promise.all(['navigation','ecology'].map(x=>json(`public/runtime/${x}.json`)));

// --- Parse every browser module. None of the headless tests import app.js/inspect.js/ecology-ui.js
// - they need a DOM and a GPU - so a brace typo in the UI only surfaced as a blank page in Chrome.
// `node --check` reads the package's "type":"module" and parses them as ESM without executing.
const sources=(await readdir(new URL('src/',root))).filter(f=>f.endsWith('.js'));
for(const file of sources){
 try{execFileSync(process.execPath,['--check',new URL(`src/${file}`,root).pathname],{stdio:'pipe'});}
 catch(e){assert.fail(`src/${file} does not parse:\n${String(e.stderr||e.message).slice(0,400)}`);}
}

// --- Every table row must carry both languages, and no row may be blank. A pair that only exists
// in one language renders as a raw key in the other, which is exactly the leak this test exists for.
const {keys,keyList,enums,unpaired}=_diagnose();
assert.deepEqual(unpaired,[],`unpaired or blank i18n rows: ${unpaired.join(', ')}`);
assert(keys>200,`the chrome table should be large, got ${keys} keys`);

// --- Chinese is the default, and it is the language the source data is already written in.
setLang('zh');
assert.equal(getLang(),'zh','Chinese must be the default language');
assert.equal(t('brandTitle'),'清明上河图');
assert.equal(t('v1Name'),'全景');
assert.equal(T('茶肆营业厅'),'茶肆营业厅','Chinese-authored source is already Chinese');
assert.equal(T('南岸西货埠'),'南岸西货埠');
assert.equal(E('vendor'),'摊贩','English-authored enums need a table entry');
assert.equal(E('Cargo_barge'),'漕船');
assert.equal(district('04_Riverside_commerce'),'河畔商贸');

// --- And English is one click away, with the authored data still translating through english().
setLang('en');
assert.equal(t('brandTitle'),'Qingming Riverside');
assert.equal(t('v1Name'),'Overview');
assert.equal(T('茶肆营业厅'),'Teahouse · Main room');
assert.equal(T('南岸西货埠'),'Southwest Quay');
assert.equal(E('vendor'),'vendor','an unlisted enum falls through to its raw English');
assert.equal(E('Cargo_barge'),'Cargo Barge','vessel ids keep the title case english() gives them');
assert.equal(district('04_Riverside_commerce'),'Riverside commerce');

// --- Positional slots must fill in both scripts; a {0} left in the output is a broken template.
const templates=['loadView','capNote','capSaveFail','lifeSummary','lifeLedger','dockCargo','boatStatus','convoyTitle','warehouse','mastSamples','suffixPct','walkToast','stats','perfFmt','doorHint','capExporting','capSuiteFail','capRecFail','capNote'];
for(const lang of ['zh','en']){
 setLang(lang);
 for(const key of templates)assert(!/\{(\d+)\}/.test(t(key,'甲','乙','丙')),`${key} left an unfilled slot in ${lang}`);
}
// {0} must actually be substituted, not merely absent.
setLang('zh');assert.equal(t('convoyTitle',3),'第 3 队');
setLang('en');assert.equal(t('convoyTitle',3),'Convoy 3');

// --- The mirror of tests/english.mjs: in English mode NOTHING may leak Han, and in Chinese mode
// every value the cards can show must be non-empty. The Chinese pass would otherwise accept a key
// that silently failed to resolve, which is the failure mode a table typo produces.
const han=/\p{Script=Han}/u;
const shown=[
 ...nav.landmarks.map(l=>l.name),
 ...Object.values(nav.prefabs).flatMap(p=>(p.rooms??[]).map(r=>r.name)),
 ...Object.values(nav.prefabs).map(p=>p.kind),
 ...[...new Set(nav.instances.map(i=>i.district))],
 ...eco.boats.map(b=>b.type),...eco.boats.map(b=>b.name),...eco.boats.map(b=>b.state),
 ...eco.boats.map(b=>b.rigClearancePolicy),
 ...[...new Set(eco.convoys.map(v=>v.state))],...eco.docks.map(d=>d.name),
 ...[...new Set(eco.citizens.map(c=>c.role))],[...new Set(eco.citizens.map(c=>c.mode))],
];
setLang('en');
for(const value of shown){if(!value)continue;assert(!han.test(T(value)),`English view leaks Han: ${value}`);assert(!han.test(E(value)),`English enum leaks Han: ${value}`);}
setLang('zh');
for(const value of shown){if(!value)continue;assert(T(value),`Chinese view is empty for ${value}`);assert(E(value),`Chinese enum is empty for ${value}`);}
// The English view of an enum that has no zh entry is still the raw id, never a key name.
assert.equal(E('__not_in_the_table'),'__not_in_the_table');

// --- index.html: every data-i18n key must exist, and the static markup must already be Chinese.
// A typo'd key leaves the previous language's text on screen, which reads as a broken toggle.
const html=await readFile(new URL('index.html',root),'utf8');
// applyStatic assigns textContent, which REPLACES an element's children. A data-i18n on a <label>
// that also holds a <select> therefore deletes the select on the first paint and the app dies with
// "Cannot set properties of null". The caption has to live in its own <span> - this pins that.
const destructive=[...html.matchAll(/data-i18n="[^"]+"[^>]*>[^<]{0,60}<(select|input|button|a|textarea)\b/g)];
assert.deepEqual(destructive.map(m=>m[1]),[],`data-i18n on an element that also contains a control: ${destructive.map(m=>m[0].slice(0,60)).join(' | ')}`);
const keysInHtml=[...html.matchAll(/data-i18n="([^"]+)"/g)].map(m=>m[1]);
const attrKeys=[...html.matchAll(/data-i18n-a="([^"]+)"/g)].flatMap(m=>m[1].split(',').map(pair=>pair.slice(pair.indexOf(':')+1)));
for(const key of [...keysInHtml,...attrKeys]){
 assert(keyList.includes(key),`index.html references i18n key that does not exist: ${key}`);
}
assert(keysInHtml.length>60,`expected the whole chrome to be marked up, found ${keysInHtml.length} keys`);
// The authored static text has to agree with what the zh table says, or the first paint contradicts
// the language the app then switches to.
assert(html.includes('>清明上河图<'),'the static header must ship in Chinese');
assert(html.includes('lang="zh"'),'the document must default to Chinese so the CJK font applies at first paint');
assert(html.includes("localStorage.getItem('qm-lang')"),'the head script must set lang before CSS applies, or the font flashes');
const inlineLang=/<script>try\{document\.documentElement\.lang=localStorage\.getItem\('qm-lang'\)\|\|'zh';/.test(html);
assert(inlineLang,'the inline head script must be the first thing in <head> after <meta>');

// --- app.js view metadata resolves in both languages without a rebuild.
for(const i of [1,2,3,4,5,6,7,8,9,10]){
 setLang('zh');const zhName=t(`v${i}Name`),zhTitle=t(`v${i}Title`),zhLine=t(`v${i}Line`),zhDesc=t(`v${i}Desc`);
 setLang('en');const enName=t(`v${i}Name`),enTitle=t(`v${i}Title`),enLine=t(`v${i}Line`),enDesc=t(`v${i}Desc`);
 for(const [label,zh,en] of [['name',zhName,enName],['title',zhTitle,enTitle],['line',zhLine,enLine],['desc',zhDesc,enDesc]]){
  assert(zh&&zh!==`v${i}${label}`,`view ${i} ${label} missing Chinese`);
  assert(en&&!han.test(en),`view ${i} ${label} missing English`);
  assert(zh!==en,`view ${i} ${label} is identical in both languages`);
 }
}

// --- No card value may be a mesh instance name. The cards used to print `Handcart__0912` and
// `Person_merchant_0__0674` verbatim, which reads as debug output rather than a description.
// asset() strips the __NNNN suffix and names the base; the card must never show the raw field.
const {asset}=i18n;
const meshId=/[A-Za-z]__\d+$|^(Person|Main_street|Courtyard|South_approach|North_approach)_\S*__?\d+$/;
setLang('zh');
for(const v of eco.convoys.flatMap(v=>[v.cart,v.animal])){
 assert(!meshId.test(asset(v)),`Chinese asset name still shows a mesh id: ${v} -> ${asset(v)}`);
}
setLang('en');
for(const v of eco.convoys.flatMap(v=>[v.cart,v.animal])){
 assert(!meshId.test(asset(v)),`English asset name still shows a mesh id: ${v} -> ${asset(v)}`);
}
assert.equal(asset('Handcart__0912'),'Handcart');
assert.equal(asset(''),'');
assert.equal(asset(null),'');
setLang('zh');
assert.equal(asset('Ox_saddled__0905'),'驾犊牛');
assert.equal(asset('Handcart__0912'),'手推车');
// Every convoy animal in the manifest must resolve, or a new asset silently reappears as raw text.
const assetBases=[...new Set(eco.convoys.flatMap(v=>[v.cart,v.animal]).map(v=>v.split('__')[0]))];
for(const base of assetBases){
 setLang('en');const en=asset(base);
 setLang('zh');const zh=asset(base);
 assert(en&&!en.includes('_'),`untranslated asset base in English: ${base} -> ${en}`);
 assert(zh&&!zh.includes('_'),`untranslated asset base in Chinese: ${base} -> ${zh}`);
}

// --- t() falls through to its raw argument when a key is missing, so a mistyped key is invisible
// in English (the word is already English) and only shows up as raw Chinese or an id elsewhere.
// Pin the surface tags the terrain card interpolates, and every value the cards can substitute.
const surfaceTags=['ground','bridge','stairs'];
const surfaceKeys={ground:'surfPlain',bridge:'surfBridgeDeck',stairs:'surfStairRun'};
for(const lang of ['zh','en']){
 setLang(lang);
 for(const tag of surfaceTags){
  const value=t(surfaceKeys[tag]);
  assert(value!==surfaceKeys[tag],`t('${surfaceKeys[tag]}') fell through to the key itself`);
  assert(value&&value!==tag,`the '${tag}' surface tag would print raw: ${value}`);
 }
 // A boat's name field is an asset instance id; the card must show the vessel number instead.
 assert(!/Vessel_\d+_/.test(t('vesselNo',2)),`vessel number still shows an instance id: ${t('vesselNo',2)}`);
}
setLang('zh');assert.equal(t('surfBridgeDeck'),'桥面');
setLang('en');assert.equal(t('surfBridgeDeck'),'Bridge deck');

setLang('zh');
console.log(`i18n: ok — ${keys} chrome keys, ${enums} enum entries, ${keysInHtml.length}+${attrKeys.length} markup bindings, ${shown.length} data values and ${assetBases.length} asset names clean in both languages`);
