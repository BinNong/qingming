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

const {voiceFor,voiceList,voiceLabel,speak,sayLine,hush,onVoices,voicesReady,voiceListNow,voiceOn,setVoiceOn,readVoice,writeVoice,audition,ttsReady,setTtsReady,readTtsVoice,writeTtsVoice,forgetTts}=await import('../src/voice.js');
const {buildTts,parseTts,pickVoice,ttsVoices,MODEL}=await import('../src/tts.js');
// The backend is what answers "can this instance speak", and there is no key on this machine to
// stand in for it. Standing one up is what /api/config does at runtime; doing it here is what lets
// every network-path assertion below run. It starts FALSE, because the first block of tests is
// about the window a real page lives in between load and the probe answering - a window that must
// behave as though the synthesised voices do not exist yet - and it is switched on where the
// network path starts being exercised.
setTtsReady(false);
const {setLang}=await import('../src/i18n.js');
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
assert.match(guard,/sayLine\(state\.line,finished=>\{this\.reading=null;if\(finished\)this\.spoken\.add\(state\.line\);\}/,
 'and committed only once the utterance finishes - an interrupted line was never read');
// The synthesised voice needs the trade it is picked from, and asking for it the other way round
// would make ai-story.js and voice.js import each other. So the card hands it over at the call site,
// every paint. The key and the provider used to travel this way too; they do not any more, and the
// assertion that they must not is the point - if either reappears at this call site, the migration
// has been half-undone and the browser is carrying a credential again.
assert.match(guard,/sayLine\(state\.line,finished=>\{[^]*?\}\s*,\s*\{plan:this\.current\?\.plan,kind:this\.current\?\.hit\?\.kind\}\)/,
 'the network path is chosen from the plan, passed in rather than imported - a circular import between the card and the voice module would put one of them in its temporal dead zone');
assert.doesNotMatch(guard,/sayLine\([^)]*readKey|readProvider/,
 'no credential may reach the voice path: the card would be handing a key to a module that would '
 +'put it on the wire');
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

// --- The synthesised backend. Everything above it is the fallback, and none of it changed; what is
// new is that a line can cost a request and a second of waiting, which brings three failure modes a
// local voice does not have: a request that never leaves, a line re-asked on every 350ms repaint,
// and audio that arrives after the reader has walked away.
const clips=[],calls=[];
let blobs=0,hold=null;
globalThis.Audio=class{constructor(src){this.src=src;this.stops=0;this.h={};clips.push(this);}
 addEventListener(k,fn){(this.h||(this.h={}))[k]=fn;}
 pause(){this.stops++;}
 play(){return Promise.resolve();}};
URL.createObjectURL=()=>'blob:fake/'+(++blobs);
URL.revokeObjectURL=()=>{};
// 'mp3' in the first four bytes, which is what a browser sniffs before it will play anything.
const MP3='4944330400000000';
const reply=()=>({base_resp:{status_code:0,status_msg:'success'},data:{audio:MP3,status:2}});
const goodFetch=async(url,init)=>{calls.push({url,init});if(hold)return hold;return{ok:true,status:200,json:async()=>reply()};};
globalThis.fetch=goodFetch;
const tick=()=>new Promise(r=>setTimeout(r,0));
const MINIMAX={plan:{role:'porter'},kind:'person'};

// The request. It used to be asserted for its header set rather than its content, because the whole
// reason this backend reached the vendor directly was that it carried exactly two headers and
// MiniMax's preflight allowlist permits those two while refusing both anthropic-* ones (probed
// 2026-10-09, byte-identical across api.minimax.{cn,chat,com} for both /v1/t2a_v2 and
// /v1/text/chatcompletion_v2). That constraint is history - the request is same-origin to our own
// /api now, and the key is on the server - so what is asserted instead is the thing that replaced
// it: the browser knows the text and the voice and nothing that could be replayed elsewhere.
const req=buildTts('一句台词',{voiceId:'clever_boy',lang:'zh'});
assert.equal(req.url,'/api/tts','same-origin: the page never addresses a vendor host');
assert.deepEqual(Object.keys(req.headers).sort(),['content-type'],
 'one header, and it is not a credential');
assert(!Object.values(req.headers).some(v=>/bearer|sk-|api[_-]?key/i.test(String(v))),
 'no authorization header may be built in the browser - that is the whole migration');
const payload=JSON.parse(req.body);
assert.deepEqual(Object.keys(payload).sort(),['lang','text','voiceId'],
 'the page sends a line and a voice and nothing else: not the model, not the audio format, not a price');
assert.equal(payload.text,'一句台词');
assert.equal(payload.voiceId,'clever_boy');
assert.equal(buildTts('x',{voiceId:'clever_boy'}).body.includes('model'),false,
 'the model is the server\'s choice; a client that could pick it could pick a different price');
// The vendor-side shape still has to be right, and it is the server\'s job now - asserted there in
// tests/package.mjs. What matters here is that the two agree on the one field that crosses.
assert.equal(JSON.parse(buildTts('x',{voiceId:'v',lang:'en'}).body).lang,'en',
 'the language still crosses, so the server can pick language_boost without guessing');

// A 200 that is not the answer is the failure this file exists to prevent. An invalid voice_id comes
// back as status_code 2013 inside a perfectly good HTTP response, so res.ok is not the check.
assert.deepEqual([...parseTts(reply())],[0x49,0x44,0x33,0x04,0,0,0,0]);
assert.equal(parseTts({base_resp:{status_code:2013,status_msg:'invalid parameter'},data:{audio:MP3}}),null,
 'a voice id the vendor does not serve is a 200 with an error in it');
assert.equal(parseTts({base_resp:{status_code:0},data:{}}),null);
assert.equal(parseTts({base_resp:{status_code:0},data:{audio:'abc'}}),null,'an odd-length hex is a truncated body, not audio');
assert.equal(parseTts({base_resp:{status_code:0},data:{audio:'zzzz'}}),null,'and non-hex is a body that is not this API');
assert.equal(parseTts(null),null);

// The trade picks the voice, from data that already exists - no per-figure authoring, and no reader
// who has opened a data file needs to notice. The bridge is the one deliberate liberty.
assert.equal(pickVoice('zh','porter'),'male-qn-qingse');
assert.equal(pickVoice('zh','woman'),'female-chengshu');
assert.equal(pickVoice('zh','child'),'clever_boy');
assert.equal(pickVoice('zh','merchant'),'Chinese (Mandarin)_Reliable_Executive');
assert.equal(pickVoice('zh',null,'boat'),'Chinese (Mandarin)_Sincere_Adult','a boat has no role of its own');
assert.equal(pickVoice('zh',null,'surface'),'Chinese (Mandarin)_Kind-hearted_Elder','Hongqiao is the one subject that never changes, so it gets the voice that reads a whole scroll');
assert.equal(pickVoice('zh','nosuchtrade'),'Chinese (Mandarin)_Reliable_Executive','an unknown trade falls back rather than going quiet');
assert.equal(pickVoice('en','porter'),'English_Graceful_Lady');
assert.deepEqual(ttsVoices('en').map(v=>v.key),['vElegant'],'a Chinese id reads English prose in a Chinese accent');
assert.ok(ttsVoices('zh').length>=10,'and the Chinese card gets a choice of voices');

// Availability is now the BACKEND's answer and nothing else. It used to be the provider and the
// key; both moved to the server with the credential, so there is nothing left for a reader to
// configure and nothing new that can fail on their side.
//
// The three states are all real. Unset is what a page renders in the window between load and
// /api/config answering, and it is deliberately FALSE: before the probe lands the synthesised voice
// list does not exist, so a line routed to the network then would be billed for a voice the page
// has not been told it can pick. That window is where the once-per-line guard is most fragile - a
// card rendering early must fall back to the OS voice, not silently retire the line.
// The file starts with the backend unanswered, which is the state the first block above exercised.
assert.equal(ttsReady(),false,'before /api/config answers, the synthesised voices do not exist yet');
setTtsReady(true);
assert.equal(ttsReady(),true,'a configured backend means the synthesised voices exist');
setTtsReady(false);
assert.equal(ttsReady(),false,'an instance with no TTS key keeps the OS voices, unchanged');
setTtsReady(true);
// A reader cannot influence this any more, so nothing that used to configure it may come back.
for(const gone of [{provider:{id:'anthropic'}},{key:'k'},{provider:{id:'minimax'},key:'k'}])
 assert.equal(ttsReady(gone),true,'the opts bag is ignored - the backend decides, not the reader');

// One line, one request, and the card's repaint cannot start a second.
// Everything below runs against a backend that has answered: this is the state after /api/config
// reports a TTS key, and it is the only state in which a line goes to the network at all.
setTtsReady(true);
setVoiceOn(true);ending='end';spoken.length=0;clips.length=0;calls.length=0;
const finished=[];
assert.equal(sayLine('第一句',v=>finished.push(v),MINIMAX),true,'a committed line reports true synchronously, or the card would clear its in-flight mark');
assert.equal(calls.length,1);
assert.equal(JSON.parse(calls[0].init.body).voiceId,'male-qn-qingse',
 'the trade chose the voice and the id crossed to the server, which whitelists it');
await tick();
assert.equal(clips.length,1,'and one clip when it lands');
assert.equal(spoken.length,0,'the OS voice does not also read it');
clips[0].h.ended();
assert.deepEqual(finished,[true],'a clip that ran to its end is a line that was read');

// 换一句 reuses one cache key for a different sentence, which is why the clip cache is keyed on the
// text. Keyed on the portrait instead, this would answer the second request with the first's audio.
assert.equal(sayLine('第二句',null,MINIMAX),true);
await tick();
assert.equal(calls.length,2,'a different line is a different request, whatever the card calls it');
// Same line, same voice, already synthesised: free to replay, and the reader pressing ♪ twice is not
// charged twice for it.
const cacheAt=calls.length,clipsAt=clips.length;
assert.equal(sayLine('第一句',null,MINIMAX),true);
await tick();
assert.equal(calls.length,cacheAt,'a line already in the clip cache does not go to the network again');
assert.equal(clips.length,clipsAt+1,'but it still plays - the cache is audio, not a once-only');

// The picker stores a vendor id under its own key, so a reader who tries both backends keeps both
// choices instead of finding the picker reset every time they switch provider.
mem.delete('qm-voice');
assert.equal(readTtsVoice(),'','an unset voice means the trade decides');
writeTtsVoice('clever_boy');
assert.equal(readTtsVoice(),'clever_boy');
assert.equal(mem.get('qm-tts-voice'),'clever_boy');
assert.equal(mem.has('qm-voice'),false,'and the operating system voice is untouched, not overwritten');
calls.length=0;
sayLine('第三句',null,MINIMAX);
await tick();
assert.equal(JSON.parse(calls[0].init.body).voiceId,'clever_boy','an explicit choice beats the trade');
writeTtsVoice('');mem.clear();assert.equal(readTtsVoice(),'','clearing removes the record rather than storing an empty one');
setVoiceOn(true);   // mem.clear() took the mute switch with it, and voiceOn() reads storage every call

// A failure that is still true 350ms later. This is the assertion the whole `failed` set exists for:
// paint() runs three times a second, and without it every one of those repaints spends a request.
globalThis.fetch=async()=>{calls.push({url:'x'});throw new Error('offline');};
spoken.length=0;clips.length=0;calls.length=0;
const failedDone=[];
assert.equal(sayLine('断网的台词',v=>failedDone.push(v),MINIMAX),true,'the attempt is still reported as started');
await tick();
assert.deepEqual(failedDone,[true],'and reported as read, because the fallback is what read it - the card marks the line done and never asks again');
assert.equal(spoken.length,1,'the operating system voice reads it instead - free, instant, and already there');
assert.equal(spoken[0].voice,'婷婷');
assert.equal(clips.length,0);
// Now the expensive part: the card repaints, and the OS voice is not there to carry it. An empty
// list will not do it - voice.js treats an empty getVoices() as "not delivered yet" and keeps the
// one it has, which is right for a real browser. A machine with no voice for THIS language is the
// case that has to go silent.
fakeVoices=[{name:'Nominal',lang:'ja-JP',localService:true}];onChanged();spoken.length=0;
for(let i=0;i<10;i++)assert.equal(sayLine('断网的台词',null,MINIMAX),false,'a line that failed is not asked for again');
assert.equal(calls.length,1,'ten attempts, one request: this is the bug the never-ask-again list is for');
assert.equal(spoken.length,0,'and silence when there is no OS voice to fall back to, rather than a request storm');
forgetTts();
sayLine('断网的台词',null,MINIMAX);
await tick();
assert.equal(calls.length,2,'turning the voice off and on is how a reader retries a line they have seen fail');
fakeVoices=REAL;onChanged();globalThis.fetch=goodFetch;

// Audio that lands after the reader has moved on. paint() is not the only thing that starts a line -
// the 试听 button and ♪ both do - and a synthesis is a round trip that can outlast all three.
hold={ok:true,status:200,json:async()=>reply()};
clips.length=0;spoken.length=0;
sayLine('迟到的一句',null,MINIMAX);
sayLine('接上的一句',null,MINIMAX);
hold=null;await tick();
assert.equal(clips.length,1,'only the newest line is allowed to play');
assert.equal(clips[0],clips.at(-1));
const heldBack=clips.length;
sayLine('静音前的一句',null,MINIMAX);
hush();await tick();
assert.equal(clips.length,heldBack,'and hush() retires the one still in flight, exactly as it retires a speaking utterance');
globalThis.fetch=async(url,init)=>{calls.push({url,init});return{ok:true,status:200,json:async()=>reply()};};
spoken.length=0;clips.length=0;
assert.equal(audition('试听一句',MINIMAX),true,'the audition is a request the reader made, so it goes around both the mute and the never-ask-again list');
await tick();
assert.equal(clips.length,1,'and it plays even with the sound switched off');
mem.clear();

// The picker has to offer the vendor's voices while that path is live, and the OS list when it is
// not - a picker full of voices the synth path never uses is worse than no picker.
assert.match(app,/const ttsMode=\(\)=>ttsReady\(\)/,'which of the two lists the picker shows is decided in one place');
assert.match(app,/\?writeTtsVoice\(e\.target\.value\):writeVoice\(e\.target\.value\)/,'and the same select writes to the matching key');
// The three change handlers that used to sit here are gone with the controls they belonged to, and
// the refill they did has moved to the one event that can still change the answer: the backend
// reporting in. Checked as an absence, because a test asserting only the survivors would pass
// just as happily if a handler came back.
for(const gone of ['#qm-provider','#qm-url','#qm-key'])
 assert(!app.includes(`$('${gone}').onchange`),`${gone} must not come back: the reader configures nothing`);
assert.match(app,/loadConfig\(\)\.then\(cfg=>\{setTtsReady\(cfg\.tts\);fillVoices\(\);/,
 'the backend\'s answer is what refills the picker now, and it has to refill it - a stale list is a '
 +'control offering voices the synth path will never use');
assert.match(app,/if\(ttsMode\(\)\)audition\(/,'the audition speaks in whichever voice the card is about to use');

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
