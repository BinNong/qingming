// The one place this backend talks to a model vendor. Both upstreams are pinned constants and the
// auth header is added here from an environment secret - the browser never sees either, which is
// the entire point of the migration.
//
// The capability flags come from each vendor's own compatibility table, not from what happens to
// work. They differ on exactly the two features this depends on:
//   - Anthropic supports `output_config.format` (structured outputs) and prompt caching.
//   - MiniMax's documented table supports neither, but fully supports `tools` / `tool_choice`. A live
//     call confirmed the first half of that: the schema was silently dropped and the model answered
//     with 16 invented keys, including a name and a twelve-year history for a porter who has neither.
//     A prompt instruction alone is what produced the invention, so the shape is forced with a tool.
//
// `browser:false` is gone with it. That flag was about the vendor's own CORS allowlist refusing the
// browser headers (probed 2026-10-04); from inside a Worker there is no browser and no preflight.
// The probe is why this endpoint exists at all - keep the record, drop the constraint.

import {STORY_TOOL} from './prompt.mjs';

export const PROVIDERS={
 anthropic:{id:'anthropic',label:'Anthropic',endpoint:'https://api.anthropic.com/v1/messages',
  model:'claude-opus-5-5',envKey:'ANTHROPIC_KEY',auth:'x-api-key',structured:'output_config',cache:true},
 // M3.1-Flash-Preview, NOT the "MiniMax-M3.1-Flash-Preview[1m]" that appears in a Claude Code
 // settings.json. The `[1m]` suffix is a Claude Code-side flag that opts into the 1M-token window; the
 // wire model id has no suffix, and sending one earns a 400 instead of a portrait.
 minimax:{id:'minimax',label:'MiniMax',endpoint:'https://api.minimax.cn/anthropic/v1/messages',
  model:'MiniMax-M3.1-Flash-Preview',envKey:'MINIMAX_KEY',auth:'bearer',structured:'tool',cache:false},
};

/** Speech is MiniMax-only and a different API surface (t2a_v2, not /v1/messages), so it is not a
 *  PROVIDERS entry - there is no second voice vendor to switch to, and a table row implying one
 *  would be a lie. speech-2.8-hd measured live on this account: 19 characters came back in 0.94s as
 *  57012 bytes of 128kbps mp3. */
export const TTS_ENDPOINT='https://api.minimax.cn/v1/t2a_v2';
export const TTS_MODEL='speech-2.8-hd';

/** Which provider this deployment is configured for, and whether it actually has a key. Falls back
 *  to MiniMax because it is the cheaper of the two and the one this project ships against; a
 *  deployment with neither key set reports nothing configured rather than throwing, because
 *  /api/config has to stay answerable on an unconfigured instance. */
export const pickProvider=env=>PROVIDERS[env?.QM_PROVIDER]||PROVIDERS.minimax;

/** The key for a provider, or ''. Read from the environment and nowhere else - it is never a
 *  parameter of anything the caller controls, and never appears in a response. */
export const keyOf=(provider,env)=>String(env?.[provider.envKey]||'').trim();
export const isConfigured=(provider,env)=>!!keyOf(provider,env);

/** The envelope for a provider. `body` comes from prompt.mjs, so the message content is identical
 *  whichever vendor is chosen and only the envelope differs - that is what lets a cached prompt be
 *  reused when the deployment switches provider.
 *
 *  The env is a REQUIRED argument, not an optional convenience. An earlier version read it from a
 *  closure that never had it and sent an empty credential, which fails as a 401 from the vendor and
 *  reads as a bad key rather than as a bug - and the 503 guard upstream had already short-circuited,
 *  so nothing local ever saw it. */
export function buildRequest(provider,body,env){
 const key=keyOf(provider,env);
 const headers={'content-type':'application/json','anthropic-version':'2023-06-01'};
 headers[provider.auth==='bearer'?'authorization':'x-api-key']=provider.auth==='bearer'?'Bearer '+key:key;
 const system=[{type:'text',text:body.system}];
 // Only where prompt caching is actually supported. Sending cache_control to a provider that
 // documents it as ignored is noise; sending it to one that errors on it would break the call.
 if(provider.cache)system[0].cache_control={type:'ephemeral'};
 const payload={model:provider.model,max_tokens:body.max_tokens,system,
  messages:[{role:'user',content:body.user}],output_config:{effort:'low'}};
 if(provider.structured==='output_config')payload.output_config.format={type:'json_schema',schema:body.schema};
 else{payload.tools=[STORY_TOOL];payload.tool_choice={type:'tool',name:STORY_TOOL.name};}
 return{url:provider.endpoint,headers,body:JSON.stringify(payload)};}

/** One request to the vendor. Returns the parsed JSON body, or throws with the status attached so
 *  the caller can tell a 401 (a misconfigured secret, our problem) from a 429 (a rate limit). */
export async function callVendor(url,headers,body,signal){
 const res=await fetch(url,{method:'POST',headers,body,signal});
 const text=await res.text();
 let json=null;try{json=JSON.parse(text);}catch(_){}
 if(!res.ok){const e=new Error('HTTP '+res.status);e.status=res.status;e.detail=json;throw e;}
 // A 200 whose body is not JSON is still a failure, and saying "unusable response" is the honest
 // version: the vendor can answer 200 with an HTML error page from an edge in front of it.
 if(!json)throw new Error('unusable response');
 return json;}

/** The speech request. Kept as a builder for the same reason buildRequest is: the shape is what a
 *  test asserts without a network. `output_format:'hex'` because the response is a hex string, not a
 *  URL - see parseTts on the client, which is where the bytes become audio. */
export function buildTts(text,{voiceId,lang='zh'}={}){
 return{url:TTS_ENDPOINT,headers:{'content-type':'application/json'},
  body:JSON.stringify({model:TTS_MODEL,text,stream:false,output_format:'hex',
   language_boost:lang==='en'?'English':'Chinese',
   voice_setting:{voice_id:voiceId||'',speed:1,vol:1,pitch:0},
   audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}})};}

export async function callTts(env,text,{voiceId,lang}={},signal){
 // No "not configured" check here: the handler answers that before it gets here, and throwing a
 // third status code nobody catches is how a 503 turns into a confusing 502.
 const key=keyOf(PROVIDERS.minimax,env);
 const req=buildTts(text,{voiceId,lang});
 // The auth header is the only difference from buildTts's output, and it is added here rather than
 // in the builder so a test can assert the body without an env in scope.
 return await callVendor(req.url,{...req.headers,authorization:'Bearer '+key},req.body,signal);}