import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rewriteHtml} from '../tools/build-html.mjs';

// What the built page carries that the source page does not.
//
// These are edits to one file, and they are the difference between a public deployment that works
// and one that looks like it works: the capture controls need server.mjs, and the model endpoints
// live on a host that a static one cannot be. Both are checked here rather than by opening a
// browser, because a 343 MB build is not something a test suite should have to run to learn
// whether the page was edited correctly.

const root=new URL('../',import.meta.url);
const read=async p=>readFile(new URL(p,root),'utf8');
const html=await read('index.html');

// The capture and export controls need server.mjs, which a public host does not have. They are
// hidden rather than removed, because npm start still serves the same page.
const built=rewriteHtml(html);
assert(built.includes('#capture-suite')&&built.includes('display:none!important'),
 'the capture controls are hidden on a public host');
assert(!built.includes('globalThis.QM_API'),'with no backend named, the page asks its own origin');

// The base URL, when the page is served from a host that cannot run the functions.
const elsewhere=rewriteHtml(html,{api:'https://qingming-riverside.pages.dev/api'});
assert(elsewhere.includes('globalThis.QM_API="https://qingming-riverside.pages.dev/api"'),
 'the build names the host that runs /api');
// It has to be set before the module that reads it runs, or the page asks its own origin and every
// request goes to a path that answers 404.
assert(elsewhere.indexOf('globalThis.QM_API')<elsewhere.indexOf('type="module"'),
 'the base URL is written before the module that reads it');
// A trailing slash would double up into /api//config.
assert(rewriteHtml(html,{api:'https://h.example/api/'}).includes('"https://h.example/api"'),
 'a trailing slash is trimmed rather than doubled');
// A relative URL would resolve against the page's own origin, which is the thing this edit exists
// to leave behind.
assert.throws(()=>rewriteHtml(html,{api:'/api'}),/absolute URL/,'a relative base URL is refused');

// The in-browser harnesses. src/app.js loads them from ../tests/, and the build has to copy them
// there or the published site answers 404 for every harness URL - and the one thing a public
// deployment cannot do is check itself.
const app=await read('src/app.js'),build=await read('tools/build-web.mjs');
const needed=new Set([...app.matchAll(/'\.\.\/(tests\/[^']+\.js)'/g)].map(m=>m[1].replace('tests/','')));
for(const file of [...needed])for(const m of (await read('tests/'+file)).matchAll(/from '\.\/([^']+\.js)'/g))needed.add(m[1]);
assert(needed.size>=8,`the harnesses app.js loads: ${[...needed].join(', ')}`);
for(const file of needed)assert(build.includes("'"+file+"'"),`${file} is loaded by the page and must be copied into the build`);
console.log(`Build output: the page is edited for a public host, and ${needed.size} browser harnesses travel with it.`);
