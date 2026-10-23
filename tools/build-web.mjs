import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {rewriteHtml} from './build-html.mjs';
const root=new URL('../',import.meta.url),out=new URL('dist/',root);
const pages=process.argv.includes('--pages'),assetBase='https://qingming-assets.bubucn.com/f628c4e/';
const city=JSON.parse(await readFile(new URL('public/runtime/city.json',root)));
assert.equal(city.geometry.format,'soa-v1');
const geometry=await readFile(new URL('public/runtime/'+city.geometry.file,root));
const assets=JSON.parse(await readFile(new URL('production/asset-manifest.json',root)));
const provenance=JSON.parse(await readFile(new URL('production/soa-manifest.json',root)));
assert.equal(createHash('sha256').update(geometry).digest('hex'),provenance.derivedGzSha256,'Run git lfs pull: geometry must match the asset manifest');
await rm(out,{recursive:true,force:true});
await mkdir(new URL('public/runtime/',out),{recursive:true});
await cp(new URL('LICENSE',root),new URL('LICENSE',out));
for(const folder of ['src','vendor'])await cp(new URL(folder,root),new URL(folder,out),{recursive:true});
for(const file of [...city.images,'navigation.json','rigs.json','ecology.json']){
 const from=new URL('public/runtime/'+file,root),to=new URL('public/runtime/'+file,out);
 await mkdir(new URL('.',to),{recursive:true});await cp(from,to);
}
await mkdir(new URL('assets/',out));
for(const name of ['Details','Vessels','LOD','Auto_Details']){
 const file='assets/Qingming_'+name+'.glb',bytes=await readFile(new URL(file,root));
 assert.equal(bytes.subarray(0,4).toString(),'glTF',file+': run git lfs pull');
 // The hash of every asset the site ships, checked here rather than only in a test. A build that
 // publishes is a build that verified what it published: the manifest is the record of what these
 // files are supposed to be, and the deployment is the one moment that record has to hold.
 assert.equal(createHash('sha256').update(bytes).digest('hex'),assets.outputs['Qingming_'+name+'.glb'],
  file+': integrity against the asset manifest');
 assert(bytes.length<100*1024*1024,file+': exceeds deployment file limit');
 await writeFile(new URL(file,out),bytes);
}
city.geometry.parts=[];city.geometry.compressedByteLength=geometry.length;
for(let offset=0;offset<geometry.length;offset+=32*1024*1024){
 const file='city.soa.'+city.geometry.parts.length+'.part';city.geometry.parts.push(file);
 await writeFile(new URL('public/runtime/'+file,out),geometry.subarray(offset,offset+32*1024*1024));
}
await writeFile(new URL('public/runtime/city.json',out),JSON.stringify(city));
let html=await readFile(new URL('index.html',root),'utf8');
// Where the model endpoints are, when the page is not served by the host that runs them. GitHub
// Pages has no server, so a build published there has to name the host that does - and that host's
// allowlist decides who may ask. Unset, the page asks its own origin, which is the case for every
// deployment that serves both halves together. The reader still configures nothing: this is
// written by the build, and the only thing it carries is a base URL.
html=rewriteHtml(html,{api:process.env.QM_API||''});
// The in-browser harnesses. src/app.js loads them for ?verify=1 and the A/B flags, and they live
// outside src/ - so without this the published site answers 404 for every harness URL, and the one
// thing a public deployment cannot do is check itself. They are ~90 KB and import nothing the page
// does not already load.
await mkdir(new URL('tests/',out),{recursive:true});
for(const file of ['quality-browser.js','optimization-browser.js','previous-QingmingPass.js','perfreview-browser.js',
 'perfreview-baseline.js','lod-browser.js','msaa-restore-browser.js','pass-profile.js','pixelratio-probe.js','performance.js'])
 await cp(new URL('tests/'+file,root),new URL('tests/'+file,out));
if(pages){
 for(const file of ['src/loader.js','src/scene-details.js']){
  const path=new URL(file,out);let replacements=0;
  const source=(await readFile(path,'utf8')).replace(/(['"])\.\/(public\/runtime\/|assets\/)([^'"]*)\1/g,(_,quote,folder,name)=>{replacements++;return JSON.stringify(assetBase+folder+name);});
  assert.equal(replacements,4,file+': asset URLs changed; review the Pages rewrite');
  await writeFile(path,source);
 }
 html=html.replace('href="./assets/','href="'+assetBase+'assets/');
 for(const folder of ['assets/','public/runtime/'])await rm(new URL(folder,out),{recursive:true});
}
await writeFile(new URL('index.html',out),html);
console.log(pages?'Pages build: scene assets served from '+assetBase:'Web build: 4 GLBs, '+city.geometry.parts.length+' geometry parts; original production assets excluded.');
