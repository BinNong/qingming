// The three routes, written once against a Web-standard Request so the Cloudflare Functions in
// functions/api/ and the dev server in server.mjs are both thin adapters over this file. That is
// what lets tests/package.mjs exercise the real routing with no network and no key.
//
// Every handler answers JSON and never leaks an upstream body to the client: a vendor error can
// carry the key back in an echo, and an error page is not something a reader can act on anyway.

import {buildMessages} from './prompt.mjs';
import {pickProvider,buildRequest,callVendor,callTts,isConfigured,keyOf,PROVIDERS} from './vendor.mjs';
import {cacheGet,cachePut,rateLimited,burstLimited,clientIp,readJson,validFacts,validLang,validVoice,validText} from './guard.mjs';

// The single exit for every handler. Serialises here so a caller on either side - a Web Response or
// a node response - is handed a string and never has to know that. Nothing here is a credential
// and nothing should be cached by the browser or a shared proxy: the reply is another visitor's
// paid call, and the page has its own localStorage cache for exactly that.
const json=(body,status=200,extra={})=>({status,body:JSON.stringify(body),
 headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...extra}});

// The variant is "write another one" - a user turn in the prompt, deliberately, so the cached
// prefix survives. Bounded because it only ever increments per portrait.
const MAX_VARIANT=8;

/** GET /api/config - what this deployment can actually do. The page needs this before it can show
 *  the right voice list: the synthesised voices only exist if the backend holds a TTS key. */
export function handleConfig(request,env){
 const p=pickProvider(env),ok=isConfigured(p,env);
 return json({prose:ok,tts:!!keyOf(PROVIDERS.minimax,env),provider:ok?p.id:''});}

/** POST /api/story - one portrait. The page sends facts about a figure it already resolved against
 *  the live scene; everything about HOW the question is asked lives in prompt.mjs. */
export async function handleStory(request,env,now=Date.now()){
 const p=pickProvider(env);
 if(!isConfigured(p,env))return json({error:'not configured'},503);

 let body;
 try{body=await readJson(request);}catch(e){return json({error:e.message},e.status||400);}
 // The trust boundary. Facts in, prompt built here: a client that could choose its own prompt would
 // be spending the operator's key on whatever it liked.
 if(!validFacts(body.facts))return json({error:'facts'},400);
 if(!validLang(body.lang))return json({error:'lang'},400);
 // Counted only past this point, and deliberately: a malformed request costs nothing, so letting it
 // consume the caller's quota would let anyone lock a real reader out of the feature by sending
 // them junk. What is limited is spending.
 const ip=clientIp(request);
 if(burstLimited(ip,now)||rateLimited(ip,now))return json({error:'slow down'},429,{'retry-after':'60'});
 const variant=Math.min(Math.max(0,Number(body.variant)||0),MAX_VARIANT);

 const cacheKey=JSON.stringify({f:body.facts,l:body.lang,v:variant});
 const cached=await cacheGet(env,cacheKey);
 if(cached)return json({...cached,cached:true});

 const req=buildRequest(p,buildMessages(body.facts,body.lang,variant),env);
 try{
  const payload=await callVendor(req.url,req.headers,req.body,request.signal);
  // Passed through verbatim, not re-shaped. parseResponse() and vet() stay on the client (a schema
  // is a request, not a guarantee) and usage is read there for the cache-hit note, so the backend
  // has no opinion about what a valid portrait looks like. It only checks the vendor did not fail.
  await cachePut(env,cacheKey,payload);
  return json(payload);
 }catch(e){
  // 401/403 here means OUR secret is wrong. Telling the client "key rejected, check it" would point
  // a reader at a key they no longer have, so it is reported as a service problem.
  const status=e.status>=500?502:e.status;
  return json({error:status===502?'upstream':'service'},status);}}

/** POST /api/tts - one spoken line. The audio is returned as the vendor's JSON (hex-encoded mp3)
 *  rather than as bytes: the client already parses hex in parseTts(), and re-encoding would move a
 *  57 KB blob through this function for no gain. */
export async function handleTts(request,env,now=Date.now()){
 if(!keyOf(PROVIDERS.minimax,env))return json({error:'not configured'},503);

 let body;
 try{body=await readJson(request);}catch(e){return json({error:e.message},e.status||400);}
 // The voice id is whitelisted, not merely length-checked: it reaches the vendor's billing path.
 // Empty is allowed and means "whatever the page's pickVoice() decided".
 if(!validText(body.text))return json({error:'text'},400);
 if(!validLang(body.lang))return json({error:'lang'},400);
 if(!validVoice(body.voiceId))return json({error:'voice'},400);
 const voiceId=String(body.voiceId||'');
 // Past validation, same as above: only a request that would actually be synthesised is counted.
 const ip=clientIp(request);
 if(burstLimited(ip,now)||rateLimited(ip,now))return json({error:'slow down'},429,{'retry-after':'60'});

 // Speech is not cached: the client holds the clip (text+voice keyed, 24 clips / 4 MB LRU) and a
 // cache entry would pin a hex string nobody reads twice.
 try{
  const payload=await callTts(env,body.text,{voiceId,lang:body.lang},request.signal);
  // A vendor that ignored a field answers 200 with something else in the body. base_resp.status_code
  // is the only success (1004/2049 bad key, 1002 rate limited, 2013 bad voice_id) and it arrives as
  // HTTP 200, so res.ok is not the check.
  if(payload?.base_resp?.status_code!==0)return json({error:'tts'},502);
  return json(payload);
 }catch(e){
  // Everything reaching here is an upstream failure. The not-configured case was answered at the
  // top of this handler and can never arrive as a throw, so there is no second branch for it.
  return json({error:'upstream'},502);}}