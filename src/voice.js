// Speaking the generated line. Two backends behind one `sayLine()`.
//
// The operating system's voices stay, and they stay the default: they cost nothing, they need no
// key, and they are the only thing that works for a reader who has not configured one. When the
// reader IS on a MiniMax key, the line is synthesised instead (tts.js) - still straight from the
// browser to the vendor, never through a server of ours, so `dist/` stays static - and the OS
// voice becomes the fallback for when that call fails.
//
// Everything a test can reach is a pure function of the voice list, so voiceFor(), voiceList() and
// voiceLabel() all take the array as an argument instead of reaching for the global. The wrapper
// below is the only impure part.
import {getLang} from './i18n.js';
import {synthesize,pickVoice} from './tts.js';

const NAME='qm-voice',ON='qm-speech';
// try-wrapped on both sides, because a browser in private mode throws on localStorage rather than
// returning null. A memory copy backs the write: without it a blocked store would leave the picker
// showing the chosen voice and every portrait line speaking a different one, with nothing on screen
// to say so - the audition reads the select, sayLine() reads storage, and only one of them would
// have been right.
let lastVoice='';
export const readVoice=()=>{try{return localStorage.getItem(NAME)||lastVoice;}catch(_){return lastVoice;}};
export const writeVoice=v=>{lastVoice=String(v||'');try{lastVoice?localStorage.setItem(NAME,lastVoice):localStorage.removeItem(NAME);}catch(_){}};
let lastOn=false;
export const voiceOn=()=>{try{lastOn=localStorage.getItem(ON)==='1';}catch(_){}return lastOn;};
export const setVoiceOn=v=>{lastOn=!!v;try{lastOn?localStorage.setItem(ON,'1'):localStorage.removeItem(ON);}catch(_){}};
// A separate key from NAME, deliberately: one holds a vendor voice_id and the other an operating
// system voice's display name, so a reader who tries both keeps both choices instead of finding the
// picker reset every time they switch provider. Empty means "let the trade decide" (pickVoice).
const TTS_STORE='qm-tts-voice';
let lastTts='';
export const readTtsVoice=()=>{try{return localStorage.getItem(TTS_STORE)||lastTts;}catch(_){return lastTts;}};
export const writeTtsVoice=v=>{lastTts=String(v||'');try{lastTts?localStorage.setItem(TTS_STORE,lastTts):localStorage.removeItem(TTS_STORE);}catch(_){}};
/** Whether the network backend can be used at all. The provider is passed in rather than read
 *  here: ai-story.js already imports this module, so reaching back for its key would make the two
 *  import each other. */
export const ttsReady=(opts={})=>opts.provider?.id==='minimax'&&!!opts.key;

/** zh and en, because those are the two languages the prose is ever written in. Anything else has
 *  to answer null rather than fall back: a sentence generated for the Chinese card is Chinese, and
 *  handing it to an English voice is worse than not speaking it. Mapping an unknown language onto
 *  zh-CN instead would quietly do exactly that, which is the whole failure this gate prevents. */
const wantOf=lang=>lang==='en'?'en':lang==='zh'?'zh':null;
const tagOf=want=>want==='en'?'en-US':'zh-CN';
// The language subtag is what precedes the first '-', not the first two characters: Chromium and
// Safari report Mandarin as cmn-Hans-CN and Cantonese as yue-HK, and taking [0,2] of those gives
// 'cm' and 'yu', which match nothing - the pool comes back empty and the whole feature disappears
// with nothing logged. The fixture here already contains a yue tag, so this is not hypothetical.
const ALIAS={cmn:'zh',yue:'zh'};
const base=tag=>{const s=String(tag||'').toLowerCase().split('-')[0];return ALIAS[s]||s;};
/** Exact region first, then the rest of the family. voiceFor and voiceList share this so the
 *  ranking and the picker cannot disagree about which region the card is in. */
const poolFor=(voices,lang)=>{const want=wantOf(lang);if(!want)return[];const tag=tagOf(want);
 return voices.filter(v=>v.lang===tag).concat(voices.filter(v=>v.lang!==tag&&base(v.lang)===want));};

/** A voice's name as the picker shows it. macOS localises the language inside the name — 16 of the
 *  41 English voices are called "Eddy (英语（美国）)" — so the parenthetical is both a duplicate of
 *  the · en-US that follows it and a source of Han characters in the English interface. Drop it. */
export const voiceLabel=v=>String(v.name||'').replace(/\s*\(.*\)\s*$/,'').trim()||String(v.name||'');

export function voiceList(voices,lang){return poolFor(voices,lang).sort((a,b)=>(b.localService?1:0)-(a.localService?1:0));}

/** Pick a voice. Both obvious rules are wrong here, and the fixture in tests/fixtures is the
 *  reason: on macOS the 180 voices the browser reports include exactly ONE flagged default
 *  (婷婷, zh-CN), so "the default" is not an answer in English at all; and the en-US voices arrive
 *  in platform order with Albert — a novelty voice — first and Samantha twenty-first, so "the
 *  first match" reads the prose in a joke. Past the known-good names the localService tier is
 *  degenerate: all 41 English voices on that machine are local, so it selects the first of whatever
 *  is left, which is why the list below is the only real defence. That list is per-platform and a
 *  miss is harmless — `say -v` and getVoices() do not even agree (the CLI lists Sinji, no browser
 *  here reports it) — so it is kept short rather than exhaustive, and the picker exists because a
 *  name list can never be right everywhere. */
const GOOD={zh:['婷婷','美嘉'],en:['Samantha','Kathy','Ralph','Fred','Alex','Daniel','Karen','Moira','Zira']};
export function voiceFor(lang,voices,saved=''){
 const pool=poolFor(voices,lang);
 if(!pool.length)return null;
 if(saved){const hit=pool.find(v=>v.name===saved);if(hit)return hit;}
 for(const n of GOOD[wantOf(lang)]||[]){const hit=pool.find(v=>v.name===n);if(hit)return hit;}
 return pool.find(v=>v.default)||pool.find(v=>v.localService)||pool[0];}

/** The voice list is delivered asynchronously: on a fresh page getVoices() returns [] for the first
 *  ~2.8s (10.3s on a cold load of this app — the event queues behind 117 MB of unpacking) and one
 *  voiceschanged carries the whole list. An empty array therefore means "not loaded yet" as often
 *  as "this machine has no voice for the language", and the two have to stay distinct — treating
 *  the first as the second hides the control for the first few seconds of every page load.
 *  voicesReady() is the flag that tells them apart, and the retry is there because a single missed
 *  event would otherwise retire the control for the life of the page. */
let loaded=null,subs=new Set(),tries=0;
const same=(a,b)=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>v.name===b[i].name);
const collect=()=>{if(typeof speechSynthesis==='undefined')return;const v=speechSynthesis.getVoices();
 if(!v.length)return;
 if(same(loaded,v))return;
 loaded=v;
 for(const f of subs)f(v);};
if(typeof speechSynthesis!=='undefined'){
 speechSynthesis.addEventListener?.('voiceschanged',collect);
 collect();
 // A voice list that arrives in batches, or an event that is missed entirely while the thread is
 // busy, must not be the end of it. Bounded, so a machine with genuinely no voices is not polled.
 const retry=()=>{if(loaded||++tries>6)return;collect();setTimeout(retry,1000+tries*1500);};
 setTimeout(retry,1200);
}
/** Fires when the list changes, and immediately if it has already arrived. The subscription is
 *  kept either way: registering after the first delivery and only being called once is how a
 *  picker stops noticing a second, larger list. Idempotent per call, so a subscriber that runs
 *  twice on one delivery (applyLang fires every onLang hook twice) must not double-fill a select. */
export function onVoices(cb){subs.add(cb);if(loaded)cb(loaded);return()=>subs.delete(cb);}
/** Whether the list has actually been delivered. Kept separate from the list itself because the
 *  two empty states mean opposite things and the control is retired by only one of them. */
export const voicesReady=()=>!!loaded;

/** Say one line. cancel() first is not politeness: consecutive speak() calls queue, and a cancel
 *  then discards everything still queued without firing an event on it, so a second portrait would
 *  be swallowed with nothing to detect. One line at a time, always.
 *  `done(true)` fires when the line is actually finished and `done(false)` when something cut it
 *  off. That distinction is the point: a 6.4s line that a 试听 click interrupts half-way through was
 *  never read, and a caller that treats "spoken" as "finished" loses the rest of it for good. */
// What is on the line right now, for either backend. `epoch` is a counter rather than a token
// object: every new line and every hush() retires the one before it, so a synthesis that lands late
// can tell it is stale without holding on to anything.
let active=null,clip=null,epoch=0;
// Whether sound is on the line right now, for the ambience to duck against. It is deliberately NOT
// derived from `active`: that is only assigned when a caller passed a done callback, and 试听 passes
// none, so an audition would leave the city at full level under a 6.4-second sentence. `busyId` is a
// token rather than a bare flag for the same reason `active` and `epoch` are - cancel() delivers the
// old utterance's error asynchronously, long after the new one started, and without an identity check
// that late event clears a flag that now belongs to the new line. The watchdog is what makes getting
// stuck true impossible: an <audio> that is never hushed and never fires `ended` would otherwise
// leave the ambience ducked for the rest of the session.
let busyId=null,busySince=0;
const sounding=who=>{busyId=who;busySince=performance.now();};
const quiet=who=>{if(busyId===who){busyId=null;busySince=0;}};
/** True while either backend has sound on the line. A getter, not an event: every path that starts a
 *  sound has exactly one matching end, because they all funnel through `active`/`clip` already. */
export const voiceBusy=()=>!!busyId&&performance.now()-busySince<20000;
export function speak(text,voice,done){
 if(!text||!voice||typeof speechSynthesis==='undefined'||typeof SpeechSynthesisUtterance==='undefined')return false;
 // Release the line we are about to cut off, before cutting it off. The speaking utterance does
 // report error:interrupted, so the callback would usually run anyway - but a queued one is
 // dropped with no event at all, and this module never leaves two queued, so relying on the browser
 // to fire would make "did it finish" depend on which of the two it decided to interrupt.
 if(active){const was=active;active=null;was(false);}
 speechSynthesis.cancel();
 const u=new SpeechSynthesisUtterance(text);
 u.voice=voice;u.lang=voice.lang;
 // The guard is not only bookkeeping: speak() and hush() release the callback themselves before
 // cancelling, and the browser still fires error at the utterance, so without it the caller would
 // be told twice that a line it has already been released for had finished. `mine` is that guard, and
 // it is also what keeps a stale utterance's end from clearing the `active` belonging to a newer one.
 //
 // One listener per event, not two: tests/voice.mjs models an utterance as holding a single handler
 // each way, and a second registration would replace the first rather than join it. settle() folds the
 // ducking flag into the same pair, which is also why 试听 - which passes no done at all - still ducks.
 const settle=ok=>{const mine=!!done&&active===done;if(mine)active=null;quiet(u);if(mine)done(ok);};
 u.addEventListener('end',()=>settle(true));
 u.addEventListener('error',()=>settle(false));
 if(done)active=done;
 sounding(u);
 speechSynthesis.speak(u);return true;}
/** Stop whatever is being read. The mute switch needs this and nothing else: a line runs 6.4s, and
 *  turning the sound off while a card speaks and leaving it to finish is the one behaviour a
 *  button marked "read the line aloud" must not have. It counts as not read, so `done` is told the
 *  line was cut off and the caller can offer it again once the sound is back. */
export const hush=()=>{epoch++;const was=active;active=null;try{speechSynthesis?.cancel();}catch(_){}if(was)was(false);
 const c=clip;clip=null;if(c){try{c.el.pause();}catch(_){}c.done(false);}
 busyId=null;busySince=0;};

/** The synthesised line, played. The same three-state contract as speak(): done(true) only when the
 *  clip really finished, done(false) when something cut it off, and no call at all when it never
 *  started. A second clip releases the first before it plays, because one line at a time is still
 *  the rule - and unlike an utterance, pausing an <audio> fires no event at all, so the release has
 *  to be explicit or the first caller would wait forever for an ending that never arrives. */
function playClip(url,done){
 const was=clip;clip=null;if(was){try{was.el.pause();}catch(_){}quiet(was.el);was.done(false);}
 const el=new Audio(url),live=()=>clip&&clip.el===el;
 clip={el,done};
 el.addEventListener('ended',()=>{if(!live())return;clip=null;quiet(el);if(done)done(true);});
 el.addEventListener('error',()=>{if(!live())return;clip=null;quiet(el);if(done)done(false);});
 // Autoplay policy is the reason this branch exists: the clip lands a second or two after the click
 // that opened the card, and a browser that wants a fresh gesture refuses. A refusal is terminal -
 // see `failed` - because the reader has already had their click and will not get another. Sounding
 // starts on the resolve, not on the call: play() can be refused, and ducking a line that never plays
 // would leave the city quiet until the watchdog caught it.
 el.play()?.then(()=>{if(live())sounding(el);},()=>{if(!live())return;clip=null;quiet(el);if(done)done(false);});
 return true;}

/** Lines whose synthesis terminally failed: a dead key, a rate limit, a voice id the vendor no
 *  longer serves, a refused play(). All of them are still true 350ms later, and paint() repaints
 *  about three times a second - so without this set a failure re-spends a request on every
 *  repaint, forever, which is the exact bug the "never auto-fire a request" rule was written
 *  against. An interruption is not a failure and is deliberately not recorded: hush(), the 试听
 *  button and moving to another figure must all leave the line offerable again. */
const failed=new Set();
export const forgetTts=()=>failed.clear();

/** Bumped by every new line and by hush(). A synthesis is a round trip that can land after the
 *  reader has walked away, and audio for a card that is no longer open is worse than no audio. */
function sayNetwork(text,done,opts){
 const mine=++epoch,lang=getLang();
 // `voiceId` here is whatever the picker is showing, which is a vendor id on the network path and
 // an OS voice's name on the other; an empty value means "let the trade decide".
 const voiceId=opts.voiceId||readTtsVoice()||pickVoice(lang,opts.plan?.role,opts.kind);
 synthesize(text,{key:opts.key,voiceId,lang}).then(audio=>{
  if(mine!==epoch)return;
  playClip(audio.url,ok=>{if(ok){if(done)done(true);}else giveUp(text,done);});
 },()=>{if(mine!==epoch)return;giveUp(text,done);});
 return true;}
/** Synthesis failed, so the line goes on the never-ask-again list and is read by the operating
 *  system instead - now, not on the next repaint, because the fallback is free and instant and the
 *  reader has already waited a second for audio that is not coming. A machine with no OS voice for
 *  the language stays silent for this line rather than asking again three times a second. */
const giveUp=(text,done)=>{failed.add(text);
 const voice=voiceFor(getLang(),voiceListNow(),readVoice());
 if(voice&&speak(text,voice,done))return;
 if(done)done(false);};

/** The whole path from "a line just landed" to "it is being read". It reports whether it started at
 *  all, because the caller has to know: marking a line read that was never spoken - because the
 *  sound was off, or because the list had not arrived - retires it for the session with no way back,
 *  and the reader is left looking at a card that stays silent until they toggle ♪.
 *  Completion, though, is `done`'s job: starting is not finishing.
 *  With `opts` the answer becomes "committed to being read": the network path returns true the
 *  moment the request is sent and settles a second later. That widening is safe because the caller
 *  only ever asks the boolean to clear `reading` when it is false. */
export function sayLine(text,done,opts={}){
 if(!text||!voiceOn())return false;
 if(ttsReady(opts)&&!failed.has(text))return sayNetwork(text,done,opts);
 const voice=voiceFor(getLang(),voiceListNow(),readVoice());
 if(!voice)return false;
 return speak(text,voice,done);}
/** The 试听 button asks for the voice the picker is showing, so it goes around both the mute switch
 *  and the never-ask-again list: a reader who picked a voice and pressed play has not been refused. */
export function audition(text,opts={}){
 if(ttsReady(opts))return sayNetwork(text,null,opts);
 return speak(text,voiceFor(getLang(),voiceListNow(),opts.voiceId||readVoice()));}
export const voiceListNow=()=>loaded||[];
