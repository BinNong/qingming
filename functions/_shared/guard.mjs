// What stands between a public endpoint and the operator's bill. Three layers, and they are not
// equally real - the honest accounting matters more than the feature list here.
//
//  1. Cache API (see below) - this is the one that actually saves money. 584 figures and 12 hulls
//     exist in the scene, but the answers do not change, so the second visitor to a given portrait
//     costs nothing, and neither does the hundredth.
//  2. A Cloudflare WAF rate-limiting rule on /api/* - ZERO CODE, and the only layer that stops one
//     person running a loop from one IP. It is a deploy-time step and it is NOT in this file; if it
//     is not configured the endpoint is an open wallet. See DEVELOPMENT.md.
//  3. The per-isolate counter below - cheap, and close to worthless against anyone deliberate.
//     Isolates do not share state across PoPs and are recycled constantly, so this reduces accidents
//     and buys nothing against an attacker. It is here because it costs ten lines, not because it
//     is a security boundary.
//
// A botnet is out of scope for v1. It would need a Durable Object or a KV-backed daily budget, and
// layer 1 already collapses normal traffic's cost to near zero, which makes that complexity hard to
// justify yet. If this endpoint ever takes real money, that is the first thing to add.

// --- 1. Cache -----------------------------------------------------------------------------------
// Keyed on the request body, so two visitors asking about the same porter share an entry. The key is
// a hash rather than the body itself because a cache key has length limits the fact set can exceed,
// and because hashing keeps Chinese text out of anything that logs keys.
const enc=new TextEncoder();

async function digest(body){
 const buf=await crypto.subtle.digest('SHA-256',enc.encode(body));
 return[...new Uint8Array(buf)].slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');}

/** A cached vendor reply, or null. `caches.default` is a Cloudflare Workers global; on Node (npm
 *  start, tests) it does not exist, and the honest answer there is "no cache", not a crash. */
export async function cacheGet(env,body){
 try{
  const cache=caches?.default;if(!cache)return null;
  const res=await cache.match(new Request(cacheUrl(env,await digest(body))));
  if(!res)return null;
  // Stampede control: a cold key hit by twenty visitors at once would otherwise be twenty paid
  // calls. The winner's own vendor response is cached by cachePut below; this only widens the
  // window in which the others wait rather than pay.
  return await res.json();
 }catch(_){return null;}}

async function cacheUrl(env,hash){
 // Prefixed with the model, because swapping the deployment's provider must not serve the previous
 // model's prose for a day under the new one's name.
 return new URL('/_portrait/'+(env.QM_PROVIDER||'minimax')+'/'+hash,env.ORIGIN||'https://localhost');}

export async function cachePut(env,body,json){
 try{
  const cache=caches?.default;if(!cache)return;
  // One day. A portrait describes a figure whose data does not change between deploys; when it does
  // change, the deployment changes too and a shorter TTL would be the wrong fix.
  await cache.put(new Request(await cacheUrl(env,await digest(body))),
   new Response(JSON.stringify(json),{headers:{'content-type':'application/json',
    'cache-control':'public, max-age=86400'}}));
 }catch(_){/* a failed cache write is a slower day, not a broken one */}}

// --- 3. Per-isolate counter ----------------------------------------------------------------------
// The Map is module-scope, which means it is per-isolate: not shared across PoPs, not durable, and
// gone whenever the isolate recycles. That is exactly why this is labelled a nuisance guard.
const SLIDING=new Map(),WINDOW_MS=60000,MAX_PER_WINDOW=20;

export function rateLimited(ip,now){
 if(!ip)return false;
 const since=now-WINDOW_MS;
 const hits=(SLIDING.get(ip)||[]).filter(t=>t>since);
 hits.push(now);SLIDING.set(ip,hits);
 if(SLIDING.size>5000)for(const [k,v] of SLIDING)if(!v.some(t=>t>since))SLIDING.delete(k);
 return hits.length>MAX_PER_WINDOW;}

// A cheap fixed window, so a burst cannot hide in the gaps of the sliding one above.
const BURST=new Map(),BURST_MAX=5;
export function burstLimited(ip,now){
 const n=(BURST.get(ip)||0)+1;BURST.set(ip,n);
 if(BURST.size>5000)BURST.clear();
 return n>BURST_MAX;}

/** The caller's address. Cloudflare puts it in a header it strips from the request; behind another
 *  proxy the first value is a comma list and only the first entry is the client. */
export const clientIp=request=>String(request.headers.get('cf-connecting-ip')||
 (String(request.headers.get('x-forwarded-for')||'').split(',')[0])||'').trim();

/** The most a client can send. The fact set is a few hundred bytes of scene labels; anything larger
 *  is not a portrait request, and refusing it before parsing is cheaper than refusing it after. */
export const MAX_BODY=8*1024;
export async function readJson(request){
 let bytes=0;const chunks=[];
 for await(const chunk of request.body||[]){
  bytes+=chunk.length;
  if(bytes>MAX_BODY)throw Object.assign(new Error('too large'),{status:413});
  chunks.push(chunk);}
 if(!bytes)throw Object.assign(new Error('empty'),{status:400});
 let json;try{json=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch(_){
  throw Object.assign(new Error('malformed'),{status:400});}
 if(!json||typeof json!=='object'||Array.isArray(json))throw Object.assign(new Error('malformed'),{status:400});
 return json;}

/** The facts must be a flat bag of short scalars. This is the field-level half of the trust
 *  boundary: the page sends scene labels, and anything shaped like a prompt, a URL or a huge
 *  string is refused before it reaches the model. Without it the endpoint is still an open proxy -
 *  just one that costs the operator money while pretending to be a portrait. */
export function validFacts(facts){
 if(!facts||typeof facts!=='object'||Array.isArray(facts))return false;
 const keys=Object.keys(facts);
 if(!keys.length||keys.length>24)return false;
 for(const k of keys){
  if(k.length>24)return false;
  const v=facts[k];
  if(typeof v==='number'){if(!isFinite(v))return false;continue;}
  if(typeof v!=='string'||v.length>80)return false;
 }
 return true;}

/** Only the two languages the prompt has a SYSTEM string for. An unknown one would silently fall
 *  back to Chinese and answer a question in the wrong tongue. */
export const validLang=l=>l==='en'||l==='zh';

/** A voice id is sent straight to the vendor and lands in its billing path, so it is a whitelist
 *  rather than a free string. The list is the client's own VOICES table - it is duplicated here
 *  because the function cannot import from src/ (that would ship the whole browser bundle into the
 *  Worker), and tests/ai-story.mjs asserts the two agree.
 *
 *  An EMPTY id is valid and means "let the trade decide": pickVoice() on the client picks from the
 *  figure's role before it ever sends, and an empty voice_id is what tells the backend to use what
 *  the page already resolved. It is a distinct case from an unknown one, so it is not an error. */
export const VOICE_IDS=new Set(['Chinese (Mandarin)_Reliable_Executive','male-qn-qingse',
 'Chinese (Mandarin)_Southern_Young_Man','Chinese (Mandarin)_Gentleman','Chinese (Mandarin)_Sincere_Adult',
 'Chinese (Mandarin)_Male_Announcer','Chinese (Mandarin)_Radio_Host','female-chengshu',
 'Chinese (Mandarin)_Warm_Girl','clever_boy','Chinese (Mandarin)_Kind-hearted_Elder',
 'English_Graceful_Lady']);
export const validVoice=v=>{const s=String(v??'');return s===''||VOICE_IDS.has(s);};

/** What a line costs to say: the prompt caps it at twenty words, and this caps it at 200
 *  characters so a client cannot turn the speech endpoint into bulk text-to-audio. */
export const validText=s=>typeof s==='string'&&s.length>0&&s.length<=200;