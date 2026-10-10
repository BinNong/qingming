import http from 'node:http';
import {createReadStream} from 'node:fs';
import {createGzip} from 'node:zlib';
import {stat,realpath,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {handleStory,handleTts,handleConfig} from './functions/_shared/routes.mjs';
import {asNode} from './functions/_shared/adapter.mjs';
const root=fileURLToPath(new URL('./',import.meta.url));
const port=Number(process.env.PORT||4193);
// The same handlers Cloudflare runs, so `npm start` behaves like the deployed site and
// tests/package.mjs can exercise the real routing offline. Keys come from the environment here
// exactly as they do in the Worker - never from the page.
const story=asNode(handleStory),tts=asNode(handleTts);
const env={MINIMAX_KEY:process.env.MINIMAX_KEY||'',ANTHROPIC_KEY:process.env.ANTHROPIC_KEY||'',
 QM_PROVIDER:process.env.QM_PROVIDER||'minimax',ORIGIN:`http://127.0.0.1:${port}`};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webm':'video/webm','.glb':'model/gltf-binary','.gz':'application/gzip','.md':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
 try{
  const capture=/^\/capture\/(view-\d{2}-(?:color|silk|off)-4k\.png|walkthrough\.webm|perfreview-(?:report\.json|before-4k\.png|after-4k\.png)|msaatest-report\.json|quality\/[A-Za-z0-9._-]+\.(?:json|png))$/.exec(new URL(req.url,'http://localhost').pathname);
  if(req.method==='POST'&&capture){
   if(req.headers.origin!==`http://127.0.0.1:${server.address().port}`){res.writeHead(403);res.end();return;}
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>48*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
   const data=Buffer.concat(chunks),name=capture[1];
   if(name.endsWith('.json')){
    // Perf-review reports must be well-formed UTF-8 JSON before they are kept.
    try{JSON.parse(data.toString('utf8'));}catch{res.writeHead(400);res.end('Invalid capture');return;}
   }else if(data.length<8||(name.endsWith('.png')?!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):data.readUInt32BE(0)!==0x1a45dfa3)){res.writeHead(400);res.end('Invalid capture');return;}
   await mkdir(path.dirname(path.join(root,'evidence',capture[1])),{recursive:true});
   await writeFile(path.join(root,'evidence',capture[1]),data);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({path:'evidence/'+capture[1],bytes}));return;
  }
  // The model endpoints. These are the same handlers the Cloudflare Functions run (functions/api/),
  // imported rather than reimplemented so local dev and production cannot drift. They used to be a
  // dev-only /proxy/minimax that forwarded the VISITOR's key; the key now lives here, in the
  // environment, and never crosses the wire to the page.
  const api=new URL(req.url,'http://localhost').pathname;
  if(api==='/api/config'&&req.method==='GET'){
   const out=await handleConfig(req,env);
   res.writeHead(out.status,out.headers);res.end(out.body);return;
  }
  if(api==='/api/story'&&req.method==='POST'){
   const out=await story(req,env);
   res.writeHead(out.status,out.headers);res.end(out.body);return;
  }
  if(api==='/api/tts'&&req.method==='POST'){
   const out=await tts(req,env);
   res.writeHead(out.status,out.headers);res.end(out.body);return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name.endsWith('/'))name+='index.html';
  let target=path.resolve(root,'.'+name);
  if(!target.startsWith(root)){res.writeHead(403);res.end('Forbidden');return;}
  target=await realpath(target);
  if(!target.startsWith(root)){res.writeHead(403);res.end('Forbidden');return;}
  const s=await stat(target);if(!s.isFile())throw new Error('Not a file');
  // Revalidation keeps every reload from re-transferring the ~280 MB payload:
  // unchanged files answer 304, and the large runtime JSONs stream gzipped.
  const etag=`"${s.size.toString(16)}-${BigInt(Math.trunc(s.mtimeMs)).toString(16)}"`;
  if(req.headers['if-none-match']===etag){res.writeHead(304,{'ETag':etag,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end();return;}
  const base={'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','ETag':etag,'X-Content-Type-Options':'nosniff'};
  const gz=/gzip/.test(String(req.headers['accept-encoding']||''))&&path.extname(target)==='.json';
  if(req.method==='HEAD'){res.writeHead(200,{...base,'Content-Length':s.size});res.end();return;}
  if(gz){res.writeHead(200,{...base,'Content-Encoding':'gzip','Vary':'Accept-Encoding'});createReadStream(target).on('error',()=>res.destroy()).pipe(createGzip()).pipe(res);}
  else{res.writeHead(200,{...base,'Content-Length':s.size});createReadStream(target).on('error',()=>res.destroy()).pipe(res);}
 }catch(e){
  if(res.headersSent){console.error('server error after headers:',e);res.destroy();return;}
  if(process.env.QM_DEBUG)console.error('server error:',e);
  res.writeHead(e.code==='ENOENT'?404:400);res.end('File not found or invalid path');}
}).listen(port,'127.0.0.1',()=>{
 console.log(`Three.js: http://127.0.0.1:${server.address().port}/`);

}).on('error',e=>{console.error('Server failed:',e.message);process.exitCode=1;});
