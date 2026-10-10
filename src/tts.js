// Synthesising the line instead of borrowing the operating system's voice.
//
// The request goes to this origin's /api/tts, and the MiniMax key lives on the server. It used to
// be the reader's own key, sent straight to api.minimax.cn - a path that worked precisely because
// the request carried only `authorization` and `content-type` and MiniMax's preflight allowlist
// permits exactly those two while refusing both anthropic-* headers (probed 2026-10-09, a
// byte-identical allowlist across api.minimax.{cn,chat,com} for /v1/t2a_v2 and
// /v1/text/chatcompletion_v2). That constraint is now history: there is no vendor URL in this file
// and no header to get wrong. What survives of it is the reason this module has no provider switch
// - the endpoint was always a constant, and now it is our own.
//
// The clip cache, the voice table and parseTts() are unchanged, because none of them ever had
// anything to do with the credential. Only the URL and the headers moved.

// speech-2.8-hd, measured live on this account: 19 characters came back in 0.94s as 57012 bytes of
// 128kbps mp3. The model name is now the server's to choose; this constant stays because the clip
// cache is keyed on it and a rename would silently orphan every cached clip in a live session.
export const MODEL='speech-2.8-hd';
const ENDPOINT='/api/tts';
// A line is under twenty words and the whole synthesis measured under a second, so this only ever
// fires on a network that has stopped delivering. Long enough not to give up on a cold connection.
const TIMEOUT_MS=15000;
// 24 lines is more than a reader will hear in one sitting, and 4 MB of Blob URLs is nothing next to
// the 117 MB of geometry already in memory. Both caps matter: an unbounded cache of object URLs is
// a leak that only shows up after the tab has been open for an hour.
const MAX_CLIPS=24,MAX_BYTES=4*1024*1024;

/** The system voices this can ask for, in picker order. `en` marks the two that are for an English
 *  line: the Chinese ids would read English prose with a Chinese accent, and `tests/english.mjs`
 *  exists because the OS voice list once leaked Han into the English interface by exactly this route.
 *  Labels live in i18n.js under these slugs so the picker is bilingual like everything else. */
export const VOICES=[
 {id:'Chinese (Mandarin)_Reliable_Executive',key:'vReliable'},
 {id:'male-qn-qingse',key:'vQingse'},
 {id:'Chinese (Mandarin)_Southern_Young_Man',key:'vSouthern'},
 {id:'Chinese (Mandarin)_Gentleman',key:'vGentleman'},
 {id:'Chinese (Mandarin)_Sincere_Adult',key:'vSincere'},
 {id:'Chinese (Mandarin)_Male_Announcer',key:'vAnnouncer'},
 {id:'Chinese (Mandarin)_Radio_Host',key:'vRadio'},
 {id:'female-chengshu',key:'vMature'},
 {id:'Chinese (Mandarin)_Warm_Girl',key:'vWarm'},
 {id:'clever_boy',key:'vBoy'},
 {id:'Chinese (Mandarin)_Kind-hearted_Elder',key:'vElder'},
 {id:'English_Graceful_Lady',key:'vElegant',en:true},
];
export const ttsVoices=lang=>VOICES.filter(v=>lang==='en'?v.en:!v.en);
/** Slug to vendor id. Not called voiceLabel: voice.js already exports that name for an OS voice's
 *  display name, and app.js imports both. */
export const idOf=slug=>VOICES.find(v=>v.key===slug)?.id||'';

/** Which voice reads which trade. The keys are the `role` values the life plans already carry
 *  (ai-story.js), so nothing new is authored per figure - a porter's line is read by the porter's
 *  voice because the data says he is one, and a reader who never opens the data still hears ten
 *  different people. The bridge is the one deliberate liberty: an old voice narrating the one
 *  subject that is always the same is the whole scroll talking, and Hongqiao is where it is read. */
const VOICE_FOR={merchant:'vReliable',porter:'vQingse',laborer:'vSouthern',farmer:'vGentleman',
 boatman:'vSincere',guard:'vAnnouncer',scholar:'vRadio',woman:'vMature',vendor:'vWarm',child:'vBoy'};
const DEFAULT_ZH='vReliable',DEFAULT_EN='vElegant';
export function pickVoice(lang,role,kind){
 // One English id, not ten. It is the only voice in this table that has not been called live, and
 // ten unverified ids would be ten ways for the English interface to go quiet; one is a single
 // failure that falls back to the OS voice. The Chinese ids come from the vendor's own system-voice
 // table and Reliable_Executive was confirmed against this account.
 if(lang==='en')return idOf(DEFAULT_EN);
 const slug=role?VOICE_FOR[role]:kind==='boat'?'vSincere':kind==='surface'?'vElder':'';
 return idOf(slug||DEFAULT_ZH);}

/** Assemble the wire request. Kept separate from synthesize() because the shape is what a test can
 *  assert without a network - and it no longer carries a credential, which is the whole point: what
 *  the browser knows about a synthesis is the text and the voice, and nothing that could be
 *  replayed elsewhere. `model` is not sent either; the server decides that now, and sending one
 *  would let a client ask for a different price. */
export function buildTts(text,{voiceId,lang='zh'}={}){
 return{url:ENDPOINT,headers:{'content-type':'application/json'},
  body:JSON.stringify({text,voiceId:voiceId||'',lang:lang==='en'?'en':'zh'})};}

/** The audio, or null. The shape is checked here rather than trusted even though the reply came from
 *  our own backend: a transparent proxy is still a hop, and a 200 carrying something else is exactly
 *  what a misconfigured upstream does. base_resp.status_code is the only success (1004/2049 bad
 *  key, 1002 rate limited, 2013 bad parameter - a wrong voice_id is the last of those), and the
 *  audio is a hex string of even length, ~114000 characters for a five-second line. */
export function parseTts(json){
 const code=json&&json.base_resp&&json.base_resp.status_code;
 if(code!==0)return null;
 const hex=json&&json.data&&json.data.audio;
 if(typeof hex!=='string'||!hex.length||hex.length%2||!/^[0-9a-f]+$/i.test(hex))return null;
 const out=new Uint8Array(hex.length/2);
 // Lowercase after the check above, so 'a'-'f' is arithmetic and nothing else. parseInt per byte
 // over 95000 bytes is a wasted millisecond or two; this is the same answer without the parser.
 for(let i=0;i<out.length;i++){const h=hex.charCodeAt(i*2),l=hex.charCodeAt(i*2+1);
  out[i]=((h<58?h-48:h-87)<<4)|(l<58?l-48:l-87);}
 return out;}

const clipKey=(text,voiceId)=>MODEL+'|'+voiceId+'|'+text;
// Keyed on the line's text and not on a portrait's cache key, for the reason the spoken-line guard
// is: 换一句 reuses one key for a different line, so a key-based clip cache would answer the second
// request with the first one's audio.
const clips=new Map();
let clipBytes=0;
const evict=()=>{for(const [k,c] of clips){if(clips.size<=MAX_CLIPS&&clipBytes<=MAX_BYTES)break;
 clips.delete(k);clipBytes-=c.bytes;try{URL.revokeObjectURL(c.url);}catch(_){}}};
let inflight=null;
/** One synthesis at a time, and a new one cancels the old - the same "never two queued" rule the OS
 *  path keeps. Without it a reader clicking through five figures in two seconds fires five
 *  requests for audio they will all but never hear, and pays for all five. */
export async function synthesize(text,{voiceId,lang}={}){
 const ck=clipKey(text,voiceId),hit=clips.get(ck);
 if(hit){clips.delete(ck);clips.set(ck,hit);return{...hit,cached:true};}
 if(inflight){const was=inflight;inflight=null;was.abort();}
 const ctl=new AbortController();inflight=ctl;
 const timer=setTimeout(()=>ctl.abort(new Error('timeout')),TIMEOUT_MS);
 try{
  const req=buildTts(text,{voiceId,lang});
  const res=await fetch(req.url,{method:'POST',signal:ctl.signal,headers:req.headers,body:req.body});
  if(!res.ok)throw new Error('HTTP '+res.status);
  const bytes=parseTts(await res.json());
  if(!bytes)throw new Error('unusable response');
  // `data` is the bytes themselves, not a count: the ambience bed decodes a clip with decodeAudioData,
  // which wants an ArrayBuffer, and fetching the blob URL back would be a second uncached round trip
  // racing evict()'s revokeObjectURL. It costs 24 clips' worth of memory, which is nothing.
  const entry={url:URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'})),bytes:bytes.length,data:bytes};
  clips.set(ck,entry);clipBytes+=entry.bytes;evict();
  return{...entry,cached:false};
 }finally{clearTimeout(timer);if(inflight===ctl)inflight=null;}}
export const cachedClips=()=>clips.size;
/** Whether a synthesis is in flight. A caller that is not the portrait - a hawker cry, say - has to
 *  ask before starting: one synthesis at a time is the rule above, and a second one aborts the first,
 *  so an unguarded cry would cut off the line of dialogue that is already on its way. */
export const ttsBusy=()=>!!inflight;
