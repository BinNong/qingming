// Cloudflare Pages Functions want a Response; routes.mjs returns a plain {status,body,headers} so
// server.mjs can write it onto a node:http response without a second adapter. This is the glue.
//
// It also answers every preflight and every cross-origin POST. A cross-origin POST reaches the
// function and spends money before the browser discovers it cannot read the reply, which is the
// expensive way to be rejected. Refusing it here costs nothing.
//
// What changed is WHO may ask. The endpoint used to be same-origin and nothing else, because the
// page and the functions were always deployed together. A static host cannot run the functions at
// all - GitHub Pages has no server - so the page can now live on one origin and the model
// endpoints on another. That is a real deployment, and it is also the one shape in which an
// endpoint holding a paid credential is reachable from a page the operator did not write. So the
// allowance is an ALLOWLIST, off by default, and the origins on it are named in the environment
// rather than inferred from anything the caller controls.

const denied=()=>new Response(JSON.stringify({error:'forbidden'}),{status:403,
 headers:{'content-type':'application/json','cache-control':'no-store'}});

/** The origins this deployment answers. A comma-separated string on Cloudflare (an environment
 *  variable) and an array on the node path - the same name in both spellings, because both read
 *  the same operator's environment. Empty is the default and means same-origin only. */
export const allowedOrigins=env=>{const raw=env?.ALLOWED_ORIGINS;
 const list=Array.isArray(raw)?raw:String(raw||'').split(',');
 return list.map(s=>String(s).trim()).filter(Boolean);};

/** The CORS headers for an origin that has been allowed. `vary: Origin` is not decoration: the
 *  reply differs by origin, and a shared cache that did not know that would hand one site's
 *  allowance to another. */
const corsHeaders=origin=>({'access-control-allow-origin':origin,
 'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type, accept',
 'access-control-max-age':'86400','vary':'Origin'});

/** Whether this request comes from a page served by this deployment.
 *
 *  Two shapes count, and the difference between them is a browser fact rather than a guess. A page
 *  on this origin sends `Origin: <this origin>` on every POST and on every cross-origin request. A
 *  same-origin GET sends NO Origin header at all - the header is added for every method except
 *  GET/HEAD - and that is the ordinary `/api/config` probe, which a browser sends once at load.
 *  `Sec-Fetch-Site` is what separates that from a script: the browser sends `same-origin`, curl
 *  sends nothing at all.
 *
 *  GET and HEAD only, and that restriction is the point. A POST always carries Origin, so no
 *  browser request ever needs the second path - and allowing one would let a script claim to be a
 *  browser by sending a header that browsers forbid scripts from setting, which is the difference
 *  between refusing a stranger and letting one in. */
export const sameOrigin=request=>{
 const origin=request.headers.get('origin');
 if(origin)return isOwnOrigin(request,origin);
 if(request.method!=='GET'&&request.method!=='HEAD')return false;
 const site=request.headers.get('sec-fetch-site');
 return site==='same-origin'||site==='none';};

/** What counts as "the same origin" once the bind address is not loopback. Comparing against the
 *  request's own URL is not enough: with a reverse proxy in front, the Host header is the public
 *  name while the server thinks it is serving 127.0.0.1, so an attacker who can point a Host at
 *  their own domain would satisfy a self-comparison.
 *
 *  ALLOWED_ORIGINS is therefore an allowlist, and it defaults to REFUSING when it is unset and the
 *  bind address is not loopback. A server exposed to a network with no configured origins answers
 *  403 to everything rather than serving a paid credential to the first caller that asks - the
 *  failure mode of a default that assumes the network is friendly is an open wallet.
 *
 *  `exposed` is passed in by the caller and is the BIND ADDRESS, never the request's Host header.
 *  Deriving it from the Host is the bug this comment exists to prevent: a server on 0.0.0.0 reached
 *  through 127.0.0.1 has a loopback Host and a public bind, and treating that as loopback let a
 *  request through to the vendor while the startup banner said REFUSED. The banner and the check
 *  have to read the same fact, and only the caller knows it. */
export const originAllowed=(request,allowed=[],exposed=false)=>{
 // ALLOW_ANY_ORIGIN is the "this is a throwaway server" switch. An allowlist of every origin is
 // exactly this check disabled, so it is spelled as a disable rather than dressed up as a
 // configuration - a reader who sees ALLOWED_ORIGINS=* in a config file should know it means "no
 // check", not "a very permissive list". It still does not help against a curl, which sends any
 // Origin it likes; nothing here ever has.
 if(allowed.includes('*'))return true;
 const origin=request.headers.get('origin');
 if(!origin)return false;
 const host=request.headers.get('host')||new URL(request.url).host;
 // Not exposed: the page and the server are one process on one machine.
 if(!exposed)return origin==='http://'+host||origin==='https://'+host;
 if(!allowed.length)return false;
 return allowed.includes(origin);};

const isOwnOrigin=request=>{const url=new URL(request.url);return request.headers.get('origin')===url.origin;};

/** Wrap a routes.mjs handler as a Pages Function. */
export const asFunction=handler=>async({request,env})=>{
 const origin=request.headers.get('origin'),allowed=allowedOrigins(env);
 // ALLOW_ANY_ORIGIN, spelled as a disable: `*` on the allowlist is this check OFF, not a very
 // permissive list, and a reader who sees it in a config file should know which one they have.
 const anyOrigin=allowed.includes('*');
 // A preflight exists only for a cross-origin caller, so it is answered only for one. A same-origin
 // caller never sends one.
 if(request.method==='OPTIONS'){
  if(!origin||(!anyOrigin&&!allowed.includes(origin)))return denied();
  return new Response(null,{status:204,headers:corsHeaders(origin)});}
 // The gate. Same-origin, or an origin on the allowlist. Everything else - another site's page, a
 // script, a curl - is refused before the handler runs, and therefore before the vendor is touched.
 if(!sameOrigin(request)&&!anyOrigin&&!allowed.includes(origin||''))return denied();
 let out;
 try{out=await handler(request,env);}catch(_){
  // Nothing below should throw - every handler answers - and if one does the reader is better served
  // by "unavailable" than by a stack trace that says more about us than the failure.
  out={status:500,body:JSON.stringify({error:'unavailable'}),headers:{'content-type':'application/json','cache-control':'no-store'}};}
 // The allowance is echoed only when the caller really is cross-origin: a same-origin caller does
 // not need it, and sending it to one would only widen what a shared cache may keep.
 const headers={...out.headers};
 if(origin&&!isOwnOrigin(request,origin))Object.assign(headers,corsHeaders(origin));
 return new Response(out.body,{status:out.status,headers});};

/** The same handler behind node:http, for server.mjs.
 *
 *  The Origin check is here too, and it was NOT here while server.mjs bound 127.0.0.1 - every caller
 *  was already on the machine, so the rule would have been untestable theatre. That stopped being
 *  true the moment the bind address became 0.0.0.0: an endpoint holding a paid credential is now
 *  reachable from anywhere, and CORS is the only thing standing between a browser on another site
 *  and the operator's bill. A server-side script ignores CORS entirely, so this is a real control
 *  against a drive-by from a web page, and NOT one against curl - the WAF-shaped limits below and a
 *  reverse proxy are what cover that.
 *
 *  The body is buffered rather than streamed. The guard caps it at 8 KB, so this cannot grow, and a
 *  node:http stream is not a Web ReadableStream - handing one to Request() would throw. */
export const asNode=handler=>async(request,env)=>{
 const chunks=[];let bytes=0;
 for await(const chunk of request){bytes+=chunk.length;if(bytes>64*1024)break;chunks.push(chunk);}
 // node's req.headers is a plain object; Web Headers is iterable. Object.entries works on both.
 const headers={};for(const [k,v] of Object.entries(request.headers||{})){
  if(typeof v==='string')headers[k.toLowerCase()]=v;}
 let web;
 try{
  web=new Request(new URL(request.url,`http://${request.headers?.host||'127.0.0.1'}`),
   {method:request.method,headers,body:chunks.length?Buffer.concat(chunks):undefined});
 }catch(_){
  return{status:400,body:JSON.stringify({error:'malformed'}),headers:{'content-type':'application/json'}};}
 // Checked here, not inside the handler: a refusal must cost nothing, and a handler that has to
 // decide whether to check cannot forget to.
 const allowed=originAllowed(web,env.ALLOWED_ORIGINS||[],env.EXPOSED);
 if(request.method==='POST'&&!allowed)
  return{status:403,body:JSON.stringify({error:'forbidden'}),headers:{'content-type':'application/json','cache-control':'no-store'}};
 const out=await handler(web,env);
 // The same cross-origin allowance the Pages path grants, so a node-hosted backend can serve a page
 // on another origin exactly as the Cloudflare one does. The echoed headers are what a browser
 // needs in order to read the reply at all: without them the POST still happens and the answer is
 // thrown away, which is the worst of both.
 const origin=web.headers.get('origin');
 const outHeaders={...out.headers};
 if(origin&&allowed&&!isOwnOrigin(web,origin))Object.assign(outHeaders,corsHeaders(origin));
 return{status:out.status,body:out.body,headers:outHeaders};};