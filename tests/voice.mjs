// Voice selection contract. The ranking in src/voice.js is a guess about taste, so it is only
// checkable against a real list: tests/fixtures/voices-macos.json is the 180 voices a macOS
// Chromium actually reported, captured rather than written by hand. A hand-written list of
// pleasant voices would have passed every test while sharing nothing with the machine it runs on.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const read=p=>readFile(new URL(p,root),'utf8');

// speechSynthesis is installed before the import so src/voice.js finds a real one at module load
// and takes its voiceschanged path. Without this the wrapper - the only impure part - is untested.
const spoken=[],cancels=[];
let fakeVoices=[],onChanged=null;
const mem=new Map();
globalThis.localStorage={getItem:k=>mem.has(k)?mem.get(k):null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};
let lastUtterance=null;
let inflight=[];   // what cancel() has to deal with: the browser ends the speaking one with an
                    // event and drops a queued one with none, and a counter cannot express that.
// How the fake engine ends an utterance. It has to be able to FINISH one, or nothing is ever marked
// read and the once-per-line rule cannot be exercised at all - which is how the earlier version of
// this file ended up pinning source text instead of behaviour.
let ending='none';
globalThis.speechSynthesis={getVoices:()=>fakeVoices,
 addEventListener:(k,fn)=>{if(k==='voiceschanged')onChanged=fn;},
 cancel:()=>{cancels.push(1);const q=inflight;inflight=[];
  if(q.length)q[0].h?.error?.();},            // speaking: reports. queued: silently gone.
  // Note the ?. on every callback below: an utterance handed to speak() with no done() has no
  // handlers at all, and a fake that threw on them would crash instead of failing an assertion.
 speak:u=>{lastUtterance=u;inflight.push(u);spoken.push({text:u.text,voice:u.voice?.name,lang:u.lang});
  if(ending==='end')u.h?.end?.();else if(ending==='error')u.h?.error?.();}};
globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}addEventListener(ev,fn){(this.h||(this.h={}))[ev]=fn;}};

const {voiceFor,voiceList,voiceLabel,speak,sayLine,hush,onVoices,voicesReady,voiceListNow,voiceOn,setVoiceOn,readVoice,writeVoice}=await import('../src/voice.js');
const REAL=JSON.parse(await read('tests/fixtures/voices-macos.json'));
const html=await read('index.html'),css=await read('src/style.css'),app=await read('src/app.js');
const story=await read('src/ai-story.js');
const family=(l,code)=>REAL.filter(v=>v.lang.toLowerCase().startsWith(code));

// --- The two rules that look right and are not, pinned against the real list.
assert.equal(REAL.length,180,`the fixture should be the machine's real list, got ${REAL.length}`);
// The picker may offer any voice in the family - that is the reader's call and the reason the
// picker exists. The RANKING may not: the card holds Mandarin prose, and a Cantonese voice reading
// it is worse than a Taiwanese-accent Mandarin voice reading it correctly. 善怡 (yue-HK) is
// reachable from the pool now that base() parses the language subtag, so it takes one name in GOOD
// to put a non-Mandarin voice on top - which would invert what the gate is for.
for(const [label,list] of [['full',REAL],['without 婷婷',REAL.filter(v=>v.name!=='婷婷')]])
 assert.ok(/^zh/.test(voiceFor('zh',list)?.lang||''),
  `${label}: the Chinese ranking landed on ${voiceFor('zh',list)?.name} (${voiceFor('zh',list)?.lang}), which is not Mandarin`);
assert.ok(voiceList(REAL,'zh').some(v=>v.lang==='yue-HK'),'while the picker still offers one, deliberately');
assert.equal(voiceFor('zh',REAL)?.name,'婷婷','Chinese should land on the one voice that reads prose');
assert.equal(voiceFor('en',REAL)?.name,'Samantha','English has no default flag at all, so the ranking has to carry it');

// Neither shortcut works, and the fixture is what shows it. Keep these two assertions: they are the
// reason voiceFor() exists, and a future rewrite that restores either shortcut fails here.
assert.equal(REAL.filter(v=>v.default).length,1,'macOS marks exactly one voice as default');
assert.equal(REAL.find(v=>v.default).lang,'zh-CN','and it is the Chinese one, so "the default" is not an answer in English');
assert.equal(family('','en-us')[0].name,'Albert','the first English match is a novelty voice, which is why it is not the answer');
assert.notEqual(voiceFor('en',REAL)?.name,family('','en-us')[0].name,'...unless the ranking was removed entirely');

// --- Every voice the picker offers is offered, including the ones the ranking rejects. The reader
// is the only authority on whether they want a cartoon reading the prose, and the ranking is a
// default rather than a policy - so the picker has to be able to reach past it.
// 9 zh-CN + 9 zh-TW + 1 yue-HK. The Cantonese tag is here on purpose: it is the near-miss that
// made base() worth checking, since 'yue-HK'.slice(0,2) is 'yu' and matches nothing.
assert.equal(voiceList(REAL,'zh').length,19,'both zh regions plus the yue tag');
assert.ok(voiceList(REAL,'zh').some(v=>v.lang==='yue-HK'),'a yue tag is still Chinese to a reader');
// The near-misses that would empty the pool outright on other platforms.
assert.equal(voiceFor('zh',[{name:'Mandarin',lang:'cmn-Hans-CN',localService:true,default:true}])?.name,
 'Mandarin','Chromium and Safari report Mandarin as cmn-Hans-CN; taking [0,2] of that gives cm and the pool comes back empty');
assert.equal(voiceFor('zh',[{name:'Cantonese',lang:'yue-Hant-HK',localService:true,default:true}])?.name,
 'Cantonese','and Cantonese as yue-Hant-HK, whose first two characters are yu');
assert.equal(voiceFor('en',[{name:'E',lang:'en-GB',localService:true}])?.name,'E','the ordinary path is unaffected');
assert.equal(voiceList(REAL,'zh')[0].name,'婷婷','the exact region is offered before the rest of the family');
assert.ok(voiceList(REAL,'en').some(v=>v.name==='Albert'),'the picker still offers the voice the ranking refuses to pick');
assert.deepEqual(voiceList(REAL,'xx'),[],'an unknown language offers nothing rather than everything');

// --- A language the prose is never written in gets no voice. This is the gate that stops an
// English sentence being read aloud in a Chinese voice when getLang() reports something else.
for(const l of ['xx','','zh-CN','en-US'])assert.equal(voiceFor(l,REAL),null,`${JSON.stringify(l)} must not borrow a voice`);
assert.equal(voiceFor('ja',REAL),null,'the model writes zh and en only, so Japanese has no voice to borrow');
// The picker may offer any voice in the family - that is the reader's call and the reason the
// picker exists. The RANKING may not: the card holds Mandarin prose, and a Cantonese voice reading
// it is worse than a Taiwanese-accent Mandarin voice reading it correctly. 善怡 (yue-HK) is
// reachable from the pool now that base() parses the language subtag, so it takes one deleted voice
// to put a non-Mandarin voice at the top of GOOD - which would invert what the gate is for.
for(const [label,list] of [['full',REAL],['without 婷婷',REAL.filter(v=>v.name!=='婷婷')]])
 assert.ok(/^zh/.test(voiceFor('zh',list)?.lang||''),
  `${label}: the Chinese ranking landed on ${voiceFor('zh',list)?.name} (${voiceFor('zh',list)?.lang}), which is not Mandarin`);
assert.ok(voiceList(REAL,'zh').some(v=>v.lang==='yue-HK'),'while the picker still offers one, deliberately');

// --- A saved choice outranks the ranking, and a saved name the machine does not have is ignored
// rather than fatal: a machine that synced nothing has no way to know its list changed.
assert.equal(voiceFor('en',REAL,'Kathy').name,'Kathy','an explicit choice wins');
assert.equal(voiceFor('en',REAL,'Samantha').name,'Samantha');
assert.equal(voiceFor('en',REAL,'Ting-Ting').name,'Samantha','a voice from another language is not a match');
assert.equal(voiceFor('en',REAL,'Nonexistent').name,'Samantha','an unknown saved name falls back instead of failing');
const bare=[{name:'Only',lang:'en-US',localService:false,default:false}];
assert.equal(voiceFor('en',bare).name,'Only','with no known voice left, any voice beats silence');
assert.equal(voiceFor('en',[{name:'D',lang:'en-GB',localService:true,default:true}]).name,'D','a sibling region still counts');
assert.equal(voiceFor('en',[]),null,'an empty list has no answer - which is not the same as an absent one');

// --- The list arrives about three seconds after load, so "empty" has two meanings and only one of
// them retires the control. Measured: voiceschanged fired once at 2834ms, carrying all 180.
assert.equal(voicesReady(),false,'nothing has been delivered yet, so the control must stay hidden');
assert.equal(voiceListNow().length,0);
let seen=null;onVoices(v=>seen=v.length);
assert.equal(seen,null,'no subscriber runs before the list exists');
// Before the list exists, sayLine() must report that it did not speak. This is the case the story
// panel's guard is built on: a card can render while the sound is off, or before the OS has
// answered, and marking it read then would retire it for the session with no way back.
setVoiceOn(true);
const before=spoken.length;
assert.equal(sayLine('before the list arrives'),false,'and it must not claim to have spoken');
assert.equal(spoken.length,before,'nor make a sound with no voice chosen');
fakeVoices=REAL;onChanged();
assert.equal(voicesReady(),true);
assert.equal(seen,180,'the subscriber runs once the list lands');
assert.deepEqual(voiceListNow().map(v=>v.name),REAL.map(v=>v.name),'and the list is kept for the story panel to read from');
let twice=0;onVoices(()=>twice++);
assert.equal(twice,1,'a late subscriber runs at once rather than waiting for an event that already fired');
assert.equal(voiceFor('zh',voiceListNow()).name,'婷婷','which is what makes the header control appear');

// --- One line at a time. Consecutive speak() calls queue, and a cancel then discards everything
// still queued without firing an event on it, so a second portrait would vanish undetectably.
spoken.length=0;cancels.length=0;
speak('first',voiceFor('en',voiceListNow()));speak('second',voiceFor('en',voiceListNow()));
assert.equal(cancels.length,2,'each line cancels what is already in flight');
assert.equal(spoken.length,2,'and both are handed over - the queue is the browser’s, and we never leave two live');
assert.equal(spoken[1].voice,'Samantha');
assert.equal(spoken[1].lang,'en-US','the utterance carries the voice it was given, not the interface language');
spoken.length=0;cancels.length=0;
speak('orphan',null);
assert.deepEqual([spoken.length,cancels.length],[0,0],'no voice means silence, and it must not even cancel the line already being read');

// --- Starting is not finishing. A 6.4s line cut off by a 试听 click or the mute switch was never
// read, so done() has to distinguish the two endings or the tail is lost for the session.
const fakeUtterances=[];
speak('long line',voiceFor('zh',voiceListNow()),ok=>fakeUtterances.push('end:'+ok));
lastUtterance.h.end();
assert.deepEqual(fakeUtterances,['end:true'],'a line that finished is finished');
speak('cut short',voiceFor('zh',voiceListNow()),ok=>fakeUtterances.push('end:'+ok));
lastUtterance.h.error();
assert.deepEqual(fakeUtterances,['end:true','end:false'],'one cut off reports not-finished, which is the whole reason it is passed back');
speak('no callback',voiceFor('zh',voiceListNow()));
assert.equal(fakeUtterances.length,2,'a caller that does not want to know still gets an utterance');

// A second speak cancels the first, and the caller that owned that line must be told it was cut
// off. The module releases it before cancelling rather than trusting the browser to report it,
// because a QUEUED utterance is dropped with no event at all - measured, and the only kind this
// module ever leaves behind if the timing is ever wrong.
const a=[],b=[];
speak('first line',voiceFor('zh',voiceListNow()),ok=>a.push(ok));
speak('second line',voiceFor('zh',voiceListNow()),ok=>b.push(ok));
assert.deepEqual(a,[false],'the line the new utterance cut off is released exactly once, as not-read');
assert.deepEqual(b,[],'and the new one has not been told anything yet');
lastUtterance.h.end();
assert.deepEqual(a,[false],'the first is not reported a second time when its utterance later errors');
assert.deepEqual(b,[true],'the second reports its own ending');
const c=[];speak('cut by the mute',voiceFor('zh',voiceListNow()),ok=>c.push(ok));
hush();
assert.deepEqual(c,[false],'the mute releases the line it stops, the same way');
speak('nothing to stop',voiceFor('zh',voiceListNow()));
hush();
assert.deepEqual(c,[false],'and is safe with nothing in flight');

// --- The once-per-line rule, driven for real. paint() only ever touches textContent and hidden on
// the seven nodes it looked up, so a fake document is enough to run the actual panel - which is the
// whole point: the previous version asserted the guard's source text, so a reformat failed a green
// feature and a behaviour change could not fail a red one. A rule that decides whether a card
// speaks needs a test that puts a card in front of it.
const nodes=new Map();
globalThis.document={querySelector:sel=>{if(!nodes.has(sel))nodes.set(sel,{textContent:'',hidden:false,onclick:null});
 return nodes.get(sel);}};
const {AIStoryUI}=await import('../src/ai-story.js');
const card=new AIStoryUI();
ending='end';
setVoiceOn(true);
const reads=()=>spoken.filter((_,i)=>true).length;
spoken.length=0;
for(let i=0;i<10;i++)card.paint({description:'d',line:'一次'});
assert.equal(spoken.length,1,'ten repaints of one card read it once');
card.paint({description:'d',line:'二次'});
assert.equal(spoken.length,2,'a different line reads');
card.paint({description:'d',line:'一次'});
assert.equal(spoken.length,2,'going back to the first is still silent - a Set, not the last line');
card.clear();card.paint({description:'d',line:'一次'});
assert.equal(spoken.length,2,'a close and a reopen are silent too');
card.forget();
card.paint({description:'d',line:'一次'});
assert.equal(spoken.length,3,'and the voice switch taking it back is the way to hear it again');
// A line rendered while the sound is off was never read, so it must still be readable later.
spoken.length=0;card.forget();setVoiceOn(false);
card.paint({description:'d',line:'静音时写的'});
assert.equal(spoken.length,0,'nothing is read while muted');
assert.equal(card.reading,null,'and nothing is left marked as in flight');
setVoiceOn(true);
card.paint({description:'d',line:'静音时写的'});
assert.equal(spoken.length,1,'which is still offered once the sound is back');
// A line cut off mid-sentence is offered again too.
spoken.length=0;card.forget();
ending='none';                                   // this one never finishes
card.paint({description:'d',line:'被打断的'});
assert.equal(spoken.length,1,'the interrupted line starts');
hush();
card.paint({description:'d',line:'被打断的'});
assert.equal(spoken.length,2,'and is re-offered rather than lost');
assert.equal(card.spoken.has('被打断的'),false,'and never recorded as read, because it never finished');

// --- sayLine reports whether it spoke, and that report is what the guard is built on. Marking a
// line read that was never spoken retires it for the session: the card stays silent until the
// reader toggles ♪, with no indication that anything went wrong.
const rt=()=>({spoken:spoken.length,cancels:cancels.length});
setVoiceOn(false);
assert.equal(sayLine('muted'),false,'muted speech must not claim to have spoken either');
setVoiceOn(true);
fakeVoices=REAL;onChanged();
let mark=rt();
assert.equal(sayLine('heard'),true,'now it speaks, and says so');
assert.deepEqual(rt(),{spoken:mark.spoken+1,cancels:mark.cancels+1},'one line, one cancel, one utterance');
assert.equal(sayLine(''),false,'an empty line is not a line');

// --- paint() reaches the prose branch about three times a second, so the guard is the feature.
// These read the source, and are deliberately whitespace-tolerant: a stricter pattern would pass
// while a reformatted brace turned the guard into a no-op and every card started re-speaking.
const guard=story.replace(/\s+/g,' ');
// Starting is not finishing. A line runs 6.4s and a 试听 click or the mute switch cuts it off, so
// the mark is committed from done() and `reading` is what covers the gap - otherwise the tail of an
// interrupted sentence is unreachable for the rest of the session.
assert.match(guard,/if\(!this\.spoken\.has\(state\.line\)&&this\.reading!==state\.line\)/,
 'the mark must be keyed on the text and skip a line already in flight; keyed on the cache key, 换一句 reuses one key for a different line and is swallowed');
assert.match(guard,/sayLine\(state\.line,finished=>\{this\.reading=null;if\(finished\)this\.spoken\.add\(state\.line\);\}\)/,
 'and committed only once the utterance finishes - an interrupted line was never read');
assert.match(guard,/if\(!started\)this\.reading=null;/,
 'sayLine does not call done when it declines to speak, so the marker must come back off here - '+
 'otherwise one line rendered while muted stays "reading" for the session and is never offered again');
assert.match(guard,/this\.spoken=new Set\(\)/,'the last line is not enough: A→B→A would read A twice');
assert.doesNotMatch(guard,/clear\(\)\s*\{[^}]*this\.spoken\./,
 'the mark is deliberately not cleared, so a close and a cache hit stay silent');
assert.match(guard,/forget\(\)\s*\{this\.spoken\.clear\(\);\}/,'turning the voice off and on again is the only way to hear a line twice');
assert.doesNotMatch(story,/once and only once[^]*?language switch all leave it alone/,
 'a language switch re-speaks: the cache key is language-scoped, so the same person arrives with a different sentence');

// --- What the switch remembers, round-tripped. The first version of these four accessors returned
// a getter from a factory instead of calling it, so voiceOn() compared a function to '1' and the
// header switch did nothing at all - no ranking test could have seen it, only a persisted value.
mem.clear();
assert.equal(voiceOn(),false,'speech is off until the reader asks for it, not merely quiet');
setVoiceOn(true);
assert.equal(voiceOn(),true);
assert.equal(mem.get('qm-speech'),'1');
setVoiceOn(false);
assert.equal(voiceOn(),false);
assert.ok(!mem.has('qm-speech'),'turning it off clears the record rather than storing a false');
assert.equal(readVoice(),'');
writeVoice('Kathy');
assert.equal(readVoice(),'Kathy','an empty save must not become a voice named ""');
assert.equal(voiceFor('en',REAL,readVoice()).name,'Kathy','which is what the picker hands back on the next portrait');
writeVoice('');
assert.equal(readVoice(),'','and clearing it returns to the ranking');

// --- A list delivered in batches is adopted, not latched. Chrome on Linux and Android resolve
// cloud voices in a later event, and a user can install a voice pack with the tab open; a first-
// list-wins cache would leave the picker offering a voice the browser no longer enumerates.
const relisted=[];onVoices(v=>relisted.push(v.length));
fakeVoices=REAL.concat([{name:'Late arrival',lang:'zh-CN',localService:true,default:false}]);
onChanged();
assert.deepEqual(relisted,[180,181],'it runs once on registration, then again when a larger list arrives');
fakeVoices=REAL;onChanged();
assert.deepEqual(relisted,[180,181,180],'and again when it shrinks - a latched cache could see neither');
assert.equal(voiceFor('zh',voiceListNow()).name,'婷婷','and the ranking still answers from the new list');

// --- Muting has to reach the utterance in flight. A line runs 6.4s, so a switch that only silenced
// the future would leave the present talking while the button showed its off state.
spoken.length=0;cancels.length=0;
speak('already playing',voiceFor('zh',voiceListNow()));
assert.deepEqual([spoken.length,cancels.length],[1,1],'one line, one cancel');
hush();
assert.equal(cancels.length,2,'the mute cancels what is playing, not merely what comes next');
hush();
assert.equal(cancels.length,3,'and it is safe to call with nothing in flight');

// --- The control and its styles.
assert.match(app,/onVoices\(fillVoices\)/,'the header control cannot exist before the OS answers');
assert.match(app,/onLang\(fillVoices\)/,'and a language switch changes which voices are offered');
assert.ok(html.includes('id="voice-btn"')&&html.includes('id="voice-pick"')&&html.includes('id="voice-audition"'),
 'the switch, the picker and the audition each need a real id, or app.js queries nothing');
assert.match(html,/id="voice-btn"[^>]*hidden/,'it ships hidden: an unanswered list is not a reason to show a dead control');
assert.match(css,/\.icon-btn\.active\{/,'the switch holds state rather than opening a panel, and no icon button had an on-style to copy');
assert.match(css,/#voice-btn\[hidden\][^}]*display:none/,
 '.panel label sets its own display, so without this the user-agent [hidden] rule loses and the picker never hides');
// The i18n bindings themselves belong to tests/i18n.mjs, which owns that check and runs first in
// the same && chain, so a copy here could never fail. What is this file's business is the two
// things that check cannot see: that the picker's labels are clean, and that the row has an id.
const han=/\p{Script=Han}/u;
// The picker shows the voices for the current language, so the English interface is the one that
// must be clean. macOS localises the language inside the voice name - 16 of the 41 English ones
// are "Eddy (英语（美国）)" - and that parenthetical is the entire leak. Chinese names are Han by
// nature and are correct where they appear.
const enNames=voiceList(REAL,'en');
assert.equal(enNames.filter(v=>han.test(v.name)).length,16,'the raw names do leak, which is why the label drops them');
for(const v of enNames)assert(!han.test(voiceLabel(v)),`the English picker offers a label with Han in it: ${voiceLabel(v)}`);
assert.ok(han.test(voiceLabel(voiceList(REAL,'zh')[0])),'and the Chinese one keeps its own characters');
assert.equal(voiceLabel({name:'Eddy (英语（美国）)',lang:'en-US'}),'Eddy','the localised parenthetical is dropped - it duplicates the · lang that follows it and is where the Han lives');
assert.equal(voiceLabel({name:'婷婷',lang:'zh-CN'}),'婷婷','a name with nothing to strip is left alone');
assert.ok(html.includes('id="voice-row"'),'the caption row is toggled by id, not by walking to an anonymous ancestor that a restyle can remove');

console.log(`voice: ok — ${REAL.length} real voices pinned; zh reads in ${voiceFor('zh',voiceListNow()).name} and en in ${voiceFor('en',voiceListNow()).name}, neither the first match (${family('','en-us')[0].name}) nor the only default`);
