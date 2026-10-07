// Speaking the generated line. No audio assets ship with this: the voices belong to the operating
// system, so the same "the visitor's key never touches a server of ours" line holds here — the
// prose the model wrote is read by a local voice, and never leaves the machine by this path.
//
// Everything a test can reach is a pure function of the voice list, so voiceFor(), voiceList() and
// voiceLabel() all take the array as an argument instead of reaching for the global. The wrapper
// below is the only impure part.
import {getLang} from './i18n.js';

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
let active=null;
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
 // be told twice that a line it has already been released for had finished.
 if(done){active=done;
  u.addEventListener('end',()=>{if(active!==done)return;active=null;done(true);});
  u.addEventListener('error',()=>{if(active!==done)return;active=null;done(false);});}
 speechSynthesis.speak(u);return true;}
/** Stop whatever is being read. The mute switch needs this and nothing else: a line runs 6.4s, and
 *  turning the sound off while a card speaks and leaving it to finish is the one behaviour a
 *  button marked "read the line aloud" must not have. It counts as not read, so `done` is told the
 *  line was cut off and the caller can offer it again once the sound is back. */
export const hush=()=>{const was=active;active=null;try{speechSynthesis?.cancel();}catch(_){}if(was)was(false);};

/** The whole path from "a line just landed" to "it is being read". It reports whether it started
 *  speaking at all, because the caller has to know: marking a line read that was never spoken -
 *  because the sound was off, or because the list had not arrived - retires it for the session
 *  with no way back, and the reader is left looking at a card that stays silent until they toggle ♪.
 *  Completion, though, is `done`'s job: starting is not finishing. */
export function sayLine(text,done){
 if(!text||!voiceOn())return false;
 const voice=voiceFor(getLang(),voiceListNow(),readVoice());
 if(!voice)return false;
 return speak(text,voice,done);}
export const voiceListNow=()=>loaded||[];
