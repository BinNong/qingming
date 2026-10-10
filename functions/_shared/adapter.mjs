// Cloudflare Pages Functions want a Response; routes.mjs returns a plain {status,body,headers} so
// server.mjs can write it onto a node:http response without a second adapter. This is the glue.
//
// It also answers every preflight and every cross-origin POST. The endpoint is same-origin by
// design and has no CORS headers, so a browser on another site cannot read a reply - but a
// cross-origin POST would still reach the function and spend money before failing, which is the
// expensive way to be rejected. Refusing it here costs nothing.

const denied=()=>new Response(JSON.stringify({error:'forbidden'}),{status:403,
 headers:{'content-type':'application/json','cache-control':'no-store'}});

/** Same-origin only. Cloudflare sets Origin for every browser request; its absence means curl, a
 *  server-side script, or a non-browser client - none of which this endpoint is for. */
export const sameOrigin=request=>{
 const origin=request.headers.get('origin');
 // No Origin header at all is a non-browser caller. Those are refused too, and deliberately: this
 // endpoint exists for the page, and the page always sends one.
 return!!origin&&isOwnOrigin(request,origin);};

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
 if(request.method==='OPTIONS')return denied();
 if(!sameOrigin(request))return denied();
 let out;
 try{out=await handler(request,env);}catch(_){
  // Nothing below should throw - every handler answers - and if one does the reader is better served
  // by "unavailable" than by a stack trace that says more about us than the failure.
  out={status:500,body:JSON.stringify({error:'unavailable'}),headers:{'content-type':'application/json','cache-control':'no-store'}};}
 return new Response(out.body,out);};

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
 if(request.method==='POST'&&!originAllowed(web,env.ALLOWED_ORIGINS||[],env.EXPOSED))
  return{status:403,body:JSON.stringify({error:'forbidden'}),headers:{'content-type':'application/json','cache-control':'no-store'}};
 const out=await handler(web,env);
 return{status:out.status,body:out.body,headers:out.headers};};