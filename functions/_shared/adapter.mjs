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

const isOwnOrigin=(request,origin)=>{
 const url=new URL(request.url);
 return origin===url.origin;};

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
 *  No origin check here, deliberately: server.mjs binds 127.0.0.1 and is a dev server, so every
 *  caller is already on the machine. The Worker path is the strict one, and duplicating the rule
 *  here would only create a second thing to keep in step.
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
 const out=await handler(web,env);
 return{status:out.status,body:out.body,headers:out.headers};};