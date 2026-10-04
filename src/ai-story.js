import {getLang,t} from './i18n.js';

/** A person you can point at, described in the language the reader is already reading in.
 *
 *  Everything here is deliberately DOM-and-fetch only. The module never receives the engine and
 *  never touches shadowDirty or the render signature - a panel that could perturb either would
 *  break `?opttest=1`'s exactly-one-frame assertion with no other symptom. tests/ai-story.mjs pins
 *  that as a source-level assertion, because it is invisible until it is already broken.
 *
 *  Two rules are load-bearing and both are enforced by tests:
 *  - Generated prose NEVER goes through t()/T()/E(). `english()` is an unanchored substring table,
 *    so it turns 「八份货物」 into 「八units of cargo」 mid-sentence. Only getLang crosses that line.
 *  - The prose lives in a sibling of #inspect-body, not inside it. show() rebuilds that node
 *    wholesale every 350ms, which would destroy async text three times a second. */

const KEY_STORE='qm-key';
const ENDPOINT='https://api.anthropic.com/v1/messages';
const MODEL='claude-opus-5-5';
// Opus 5.5's thinking cannot be turned off, and it bills against max_tokens, so this has to cover
// reasoning plus the ~200 visible tokens. A 200-token budget truncates the reply mid-JSON.
const MAX_TOKENS=2048;
// An Opus call with thinking runs 20-60s and browser fetch has no timeout of its own, so without
// this a dropped connection leaves the panel spinning forever.
const TIMEOUT_MS=45000;

const ROLE={merchant:'商人',laborer:'劳力',porter:'挑夫',boatman:'舟子',vendor:'摊贩',woman:'妇人',scholar:'学子',guard:'巡城',farmer:'农夫',child:'孩童'};
const MODE={crew:'舟员',traveller:'行旅',resident:'居家',seated:'闲坐',shopkeeper:'看店',porter:'脚夫'};
const CLIP={Work:'劳作',Idle:'静立',Sit:'闲坐',Talk:'攀谈',Walk:'行走',Carry:'负重'};
const STATE={'停留':'停留','搬货':'搬货','返回货埠':'返回货埠','步行':'步行','往来':'往来'};

const HAN=/\p{Script=Han}/u;
// The cards once printed `Handcart__0912` and `Person_merchant_0__0674` verbatim, so this is a
// defect class this repo has actually shipped, not a hypothetical.
const MESH_ID=/[A-Za-z]__\d+$|^(Person|Main_street|Courtyard|South_approach|North_approach)_\S*__?\d+$/;
const INSTANCE_SUFFIX=/__\d{3,}/;

/** A closed schema, so the model answers with the two fields the panel renders and cannot invent
 *  keys nothing reads. Sentence length is prompt-only: json_schema takes no min/maxLength. */
export const STORY_SCHEMA={type:'object',properties:{
 description:{type:'string',description:'两到三句白描，第三人称，现在时。'},
 line:{type:'string',description:'他此刻会说的一句话，加引号，不加解释。'}},
 required:['description','line'],additionalProperties:false};

/** The cacheable prefix. These two strings must stay byte-identical across every request or the
 *  prompt cache misses on every click - any interpolation here, including a language toggle, is a
 *  silent billing regression. They sit well over the 512-token minimum so caching actually engages. */
export const SYSTEM={
zh:`你为一座可交互的《清明上河图》三维城市场景撰写人物白描。读者正站在北宋汴京的街头，点了一个市中人，想知道这个人此刻是什么样子。

写作要求：
- 第三人称、现在时，像《清明上河图》本身的笔法：白描，不加评论，不作解释，不写"他似乎""仿佛"这类揣度。
- 只写"这个人会做的事"。绝不编造姓名、家世、亲属、店铺名、具体钱数、日期或地名——你没有这些信息，编出来就是假的。
- 可以写：他在做什么、身子怎么使、手上有什么、周围是什么声音与气味、这个时辰的光。
- 不可以写：他的名字（数据里没有）、他的来历、他想什么、任何画面上看不出的事。
- 身段与动作要与给定的"身段"一致；行旅与脚夫要写出正在赶往何处的那股劲头。
- 第二句台词要符合这个身份此刻会说的话，口语、短、不文绉绉，不超过二十字。

格式：description 两到三句；line 是他此刻会说的那一句，用「」包住。全部中文。`,
en:`You write character portraits for an interactive 3D reconstruction of the Qingming Riverside scroll. The reader is standing in a Northern Song street in Bianjing, has clicked one figure, and wants to know what this person looks like right now.

Writing rules:
- Third person, present tense, in the plain brushwork of the scroll itself: describe, never editorialise, no "seems to" or "as if".
- Write only what this person would be doing. Never invent a name, a family, a shop's name, a price, a date or a place - you have none of that, and inventing it makes it false.
- You may write: what they are doing, how the body works, what is in the hands, the sounds and smells nearby, the light at this hour.
- You may not write: their name, their history, what they think, or anything not visible in the scene.
- Match the given posture. A traveller or porter should carry the urgency of going somewhere.
- The one line of dialogue must be something this person would say now: spoken, short, unliterary, under twenty words.

Format: description is two to three sentences; line is what they say now, in double quotes. All English.`,
};

const cache=()=>{try{return JSON.parse(localStorage.getItem('qm-stories')||'{}');}catch(_){return {};}};
const writeCache=c=>{try{localStorage.setItem('qm-stories',JSON.stringify(c));}catch(_){}};

/** Facts are the Chinese source values, never english() output - see the module header. */
export function factsFor(hit,ctx){
 const plan=hit?.lifePlan||{},rig=hit?.person?.rig==='child'||plan.role==='child';
 const f={role:ROLE[plan.role]||'市中人',mode:MODE[plan.mode]||'市井人',age:rig?'孩童':'成人'};
 const clip=CLIP[hit?.person?.clip||plan.clip];if(clip)f.posture=clip;
 if(hit?.state&&STATE[hit.state])f.doing=STATE[hit.state];
 const route=plan.route&&ctx?.routes?.get(plan.route);if(route)f.route=route;
 if(plan.dock&&ctx?.docksById?.get(plan.dock))f.dock=ctx.docksById.get(plan.dock);
 return f;
}

// Chinese fact labels, so the model reads one coherent language. English keys here are a small
// thing that measurably invites an English word or two into Chinese prose.
const LABEL={role:'行当',mode:'身份',age:'年纪',posture:'身段',doing:'正在',route:'往来路线',dock:'货埠'};
const lines=f=>Object.entries(f).map(([k,v])=>`${LABEL[k]||k}：${v}`).join('\n');

export function buildMessages(facts,lang){
 return{lang,system:SYSTEM[lang==='en'?'en':'zh'],user:lines(facts),
  schema:STORY_SCHEMA,model:MODEL,max_tokens:MAX_TOKENS};
}

/** plan.name is the identity - unique across all 584 and authored in the data, unlike actor.id,
 *  which is a construction counter that any asset reordering would silently re-point. The live
 *  state rides along because a porter cycles 取货 -> 搬货 -> 返回货埠 and a frozen "he is carrying"
 *  outlives the moment it described. */
export function cacheKey(plan,lang,state){return[plan?.name,lang,state||''].join('|');}

export const hasHan=s=>HAN.test(String(s??''));
export const leaksMeshId=s=>MESH_ID.test(String(s??''))||INSTANCE_SUFFIX.test(String(s??''));

/** Returns null for anything it cannot fully trust, so the caller renders a retry rather than a
 *  half-answered card. Never throws. The text block is found by type: with thinking on, content[0]
 *  is a thinking block whose text is empty by default. */
export function parseResponse(json){
 try{
  if(!json||json.stop_reason==='refusal'||json.stop_reason==='max_tokens')return null;
  const block=(json.content||[]).find(b=>b?.type==='text');
  if(!block?.text)return null;
  const parsed=JSON.parse(block.text);
  if(typeof parsed?.description!=='string'||typeof parsed?.line!=='string')return null;
  if(!parsed.description.trim()||!parsed.line.trim())return null;
  return{description:parsed.description.trim(),line:parsed.line.trim()};
 }catch(_){return null;}
}

export const hasKey=()=>{try{return !!localStorage.getItem(KEY_STORE);}catch(_){return false;}};
export const readKey=()=>{try{return localStorage.getItem(KEY_STORE)||'';}catch(_){return '';}};
export const writeKey=k=>{try{k?localStorage.setItem(KEY_STORE,k.trim()):localStorage.removeItem(KEY_STORE);}catch(_){}};

/** Renders generated prose. Guard order matters: a mesh id is always a bug and always rejected; a
 *  stray Han character in English output is merely untidy, and re-asking would spend a second call
 *  to throw away a good answer - so the reader sees it with a note instead. */
export function vet(result,lang){
 if(!result)return null;
 if(leaksMeshId(result.description)||leaksMeshId(result.line))return null;
 return{...result,warn:lang==='en'&&(hasHan(result.description)||hasHan(result.line))};
}

export class AIStoryUI{
 constructor(){
  this.root=document.querySelector('#inspect-ai');
  this.desc=document.querySelector('#ai-desc');
  this.line=document.querySelector('#ai-line');
  this.note=document.querySelector('#ai-note');
  this.again=document.querySelector('#ai-again');
  this.key='';this.current=null;this.busy=null;
  if(this.again)this.again.onclick=()=>this.render(this.current,true);
 }
 /** Called on every show(). The identity guard is what stops A's prose sitting under B's name for
  *  the two seconds before B resolves. */
 /** `fresh` is true only for the click that opened the card. A re-render from the 350ms tick or a
  *  language switch passes false, so it can show a cache hit or the prompt but never spend. */
 async offer(hit,ctx,fresh){
  if(!this.root)return;
  if(hit?.kind!=='person'||!hit.lifePlan){this.clear();return;}
  const lang=getLang()==='en'?'en':'zh',plan=hit.lifePlan;
  const facts=factsFor(hit,ctx),key=cacheKey(plan,lang,hit.state);
  // show() runs on a 350ms tick, so this is called over and over for the same person. Everything
  // below has to be a no-op in that case, or one click becomes a request every 350ms.
  if(this.current?.key!==key){this.clear();this.current={key,lang,plan,hit,facts,fresh};}
  const store=cache();
  if(store[key]){this.paint(vet(store[key],lang));return;}
  if(this.busy===key)return;
  if(!hasKey()||!this.current.fresh){this.paint({empty:true});return;}
  await this.generate(this.current);
 }
 async generate(target){
  const key=target.key,lang=target.lang;
  this.busy=key;this.paint({pending:true});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try{
   const body=buildMessages(target.facts,lang);
   const res=await fetch(ENDPOINT,{method:'POST',signal:controller.signal,headers:{
    'content-type':'application/json','x-api-key':readKey(),
    'anthropic-version':'2023-06-01',
    // Without this header the API answers 401 to any browser-originated request.
    'anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify({model:body.model,max_tokens:body.max_tokens,
     // Byte-stable across every request; any interpolation here silently kills the cache.
     system:[{type:'text',text:body.system,cache_control:{type:'ephemeral'}}],
     messages:[{role:'user',content:body.user}],
     output_config:{effort:'low',format:{type:'json_schema',schema:body.schema}}})});
   if(!res.ok)throw new Error('HTTP '+res.status);
   const payload=await res.json();
   // Whether the prefix actually cleared the cache minimum is an assumption, not a fact, until the
   // API reports it. Exposing it keeps that honest instead of leaving a saving claimed in a comment.
   this.lastUsage={input:payload.usage?.input_tokens,cacheRead:payload.usage?.cache_read_input_tokens,
    cacheWrite:payload.usage?.cache_creation_input_tokens,output:payload.usage?.output_tokens};
   const result=vet(parseResponse(payload),lang);
   if(!result)throw new Error('unusable response');
   // A late reply for a person the reader has already moved on from must not repaint the card.
   if(this.current?.key!==key)return;
   const store=cache();store[key]=result;writeCache(store);
   this.paint(result);
  }catch(_){
   if(this.current?.key!==key)return;
   this.paint({error:true});
  }finally{clearTimeout(timer);if(this.busy===key)this.busy=null;}
 }
 paint(state){
  if(!this.root)return;
  const say=(node,text)=>{if(node)node.textContent=text||'';};
  const show=!!state;
  this.root.hidden=!show;
  if(!show)return;
  if(state.pending){say(this.desc,'…');say(this.line,'');say(this.note,t('aiThinking'));this.again.hidden=true;return;}
  if(state.empty){say(this.desc,'');say(this.line,'');say(this.note,t('aiNoKey'));this.again.hidden=true;return;}
  if(state.error){say(this.desc,'');say(this.line,'');say(this.note,t('aiFailed'));this.again.hidden=false;return;}
  // textContent throughout: the card body is built by innerHTML interpolation, and model output
  // must never share that path.
  say(this.desc,state.description);say(this.line,state.line);
  say(this.note,t('aiByline'));
  this.again.hidden=false;
 }
 /** Bumps the identity so a late reply for a previous person cannot repaint the new card. `busy` is
  *  deliberately left alone: it guards the network, not the display, and dropping it mid-request
  *  would let the next 350ms tick start a second call for a request already in flight. */
 clear(){this.current=null;if(this.root)this.root.hidden=true;}
}
