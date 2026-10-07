import {getLang,t} from './i18n.js';
import {sayLine} from './voice.js';

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
const PROVIDER_STORE='qm-provider';
const URL_STORE='qm-url';
// Anthropic 5.5's thinking cannot be turned off and it bills against max_tokens, so this has to
// cover reasoning plus the ~200 visible tokens. A 200-token budget truncates the reply mid-JSON.
const MAX_TOKENS=2048;
// An Opus call with thinking runs 20-60s and browser fetch has no timeout of its own, so without
// this a dropped connection leaves the panel spinning forever.
const TIMEOUT_MS=45000;

/** Provider capabilities, from each vendor's own compatibility table rather than from what happens
 *  to work. They differ on exactly the two features this feature depends on:
 *
 *  - Anthropic supports `output_config.format` (structured outputs) and prompt caching.
 *  - MiniMax's documented table supports `output_config.effort` but lists neither
 *    `output_config.format` nor `cache_control`. A live call confirmed it: the schema was silently
 *    dropped and the model answered with 16 invented keys, including a name and a twelve-year
 *    history for a porter who has neither in the data.
 *  - MiniMax fully supports `tools` and `tool_choice`, so that is the fallback that actually forces
 *    a shape - a prompt instruction alone is what produced the invention above.
 *
 *  `structured` therefore picks the mechanism, not whether the output is checked. The response is
 *  validated locally either way; a provider that ignores the constraint gets rejected, not trusted. */
const PROVIDERS={
 anthropic:{id:'anthropic',label:'Anthropic',endpoint:'https://api.anthropic.com/v1/messages',model:'claude-opus-5-5',
  auth:'x-api-key',structured:'output_config',cache:true,browser:true},
 // Kept, but not offered: MiniMax's CORS allowlist (probed 2026-10-04) permits Authorization and
 // Content-Type yet refuses both `anthropic-version` and `anthropic-dangerous-direct-browser-access`,
 // so the preflight fails and the browser never sends the request. There is no workaround - a
 // request carrying a key as application/json is never a "simple request", so the preflight cannot
 // be skipped. It is reachable only through a same-origin proxy. Registering it as an option the
 // reader can pick would only produce a raw CORS message in the panel.
 minimax:{id:'minimax',label:'MiniMax',endpoint:'https://api.minimax.cn/anthropic/v1/messages',model:'MiniMax-M3',
  auth:'bearer',structured:'tool',cache:false,browser:false},
};
// The CORS verdict behind `browser:false` applies to the vendor's own endpoint only. A visitor who
// sets a custom URL has a proxy in between, and a proxy answers its own preflight - so every
// provider becomes reachable and the picker may offer all of them.
export const providerList=(url=readUrl())=>Object.values(PROVIDERS).filter(p=>p.browser||url);
export const getProvider=id=>PROVIDERS[id]||PROVIDERS.anthropic;
export const readProvider=(url=readUrl())=>{try{
  const p=PROVIDERS[localStorage.getItem(PROVIDER_STORE)];
  // A provider saved before it was withdrawn must not keep being selected, or the reader is stuck
  // on a CORS failure with no way back except clearing storage by hand.
  return p&&(p.browser||url)?p:PROVIDERS.anthropic;
 }catch(_){return PROVIDERS.anthropic;}};
export const writeProvider=id=>{const p=getProvider(id);try{localStorage.setItem(PROVIDER_STORE,p.id);}catch(_){}};

const ROLE={merchant:'商人',laborer:'劳力',porter:'挑夫',boatman:'舟子',vendor:'摊贩',woman:'妇人',scholar:'学子',guard:'巡城',farmer:'农夫',child:'孩童'};
const MODE={crew:'舟员',traveller:'行旅',resident:'居家',seated:'闲坐',shopkeeper:'看店',porter:'脚夫'};
const CLIP={Work:'劳作',Idle:'静立',Sit:'闲坐',Talk:'攀谈',Walk:'行走',Carry:'负重'};
const STATE={'停留':'停留','搬货':'搬货','返回货埠':'返回货埠','步行':'步行','往来':'往来'};
// --- Boats and the bridge. Same discipline as above: a lookup from a raw data value to the Chinese
// the fact is written in, never english() output. The vessel name (`Vessel_00_Cargo_barge`) is a
// mesh id and is never read; the route name is auto-generated ("Cargo_barge 0 水路") and is not
// worth telling the model either - the type and the quay say everything a 白描 can use. The words
// below are the same ones ENUM already uses for the card, so one vessel is not called 漕船 on the
// card and 商帆船 in the prompt. E() is unreachable from here - it runs model prose through
// english() - so the mapping is duplicated rather than shared, and pinned by tests/i18n.mjs.
const VESSEL={Cargo_barge:'漕船',Trading_sailboat:'商帆',Fishing_rowboat:'渔船',Ferry:'渡船',
 Covered_passenger_boat:'乌篷客船',Courier_skiff:'快脚小船'};
const BOAT_STATE={航行:'航行',靠泊装卸:'靠泊装卸',离泊:'离泊',候航避让:'候航避让',减速靠泊:'减速靠泊'};
// rigClearancePolicy is the only authored prose on a boat, and it is the one line that ties the
// traffic to the architecture: three trading sailboats stand 8.45m of mast, the navigable aperture
// under the bridge peaks at 6.63m, so they take the east reach and never the middle. Keyed on the
// authored string rather than on a height threshold, so the fact stays true if the hulls change.
const MAST={'low-clearance cross-city lane':'低桅穿城专用道',
 'east reach only — 8.45m standing mast never enters 6m bridge aperture':'只走东段——八米四五高桅不入六米桥门'};
// The bridge prefab is keyed "Hongqiao | 37m timber rainbow bridge", and that key is the ONLY
// prose about its structure that exists as data - the span, the arch profile, the parapet and the
// 94 rail boxes are all derived in simulation.js, and there is no name field, no description and
// no shop at either end. So the fact is exactly what the key asserts and no more: it is tempting
// to write 木拱无柱 here, and there is nothing in the data that says the span is unsupported.
const BRIDGE={name:'虹桥',form:'三十七米木拱桥'};
// The kinds of traffic the authored routes are made of. There is no count - that changes every few
// seconds - but "who crosses here" is stable and is what the data actually asserts.
const CROWD={pedestrian:'行人',porter:'挑夫',caravan:'车队'};
// How close a named landmark has to be to be worth calling true. 40m is about one street block;
// past that the model is being handed a place this figure has nothing to do with.
const PLACE_R=40;
// The same discipline for the building, and it needs both numbers. A nearest-by-centre search
// alone put a cloth shop 24m away and across the river from someone standing 7.8m up on the
// Hongqiao arch, and the model writes 近旁 into prose as a statement. 12m is about one street
// width; 3m of height keeps a figure on the bridge or a storey up from being "at" a shop he is
// merely passing. Cost of the gate: 7 of 355 distinct fact sets, because a name 24m off was
// mostly duplicating a nearer one's anyway.
const BUILD_R=12,BUILD_Z=3;
// The scene's sunHour slider runs 9..18.5, and the system prompt invites the model to write the
// light at this hour without ever saying which hour it is. Five narrative buckets rather than the
// raw value: a bucket is something prose can use, "15.7" is not.
const HOUR=[[11,'上午'],[13,'正午'],[15.5,'午后'],[17,'向晚'],[Infinity,'薄暮']];
export const hourBucket=h=>{for(const[at,name]of HOUR)if(h<at)return name;return HOUR[HOUR.length-1][1];};

/** Whether a figure can honestly be said to be standing at this building: outside its footprint by
 *  no more than BUILD_R, and at its own storey rather than above it or a storey below it. rooms[]
 *  carries the OBB (hx/hy/angle) and the storey band (lo) for exactly this. The height test is
 *  symmetric because one-sided it is not a storey test: everything on the ground floor sits inside
 *  the first-floor room in plan, and a door in the street under a balcony is credited to the balcony.
 *  It changes nothing today - all 475 runtime rooms have lo between 2.43 and 2.58, so there is no
 *  second storey to confuse - and it is here because a synthetic room in tests/inspect-card.mjs
 *  does have one, and the rule should not depend on the data happening to be flat. */
function standsAt(r,p){
 if(Math.abs(p[2]-r.lo)>BUILD_Z)return false;
 const cs=Math.cos(r.angle||0),sn=Math.sin(r.angle||0),dx=p[0]-r.x,dy=p[1]-r.y;
 const lx=Math.abs(dx*cs+dy*sn)-(r.hx||0),ly=Math.abs(-dx*sn+dy*cs)-(r.hy||0);
 return Math.hypot(Math.max(0,lx),Math.max(0,ly))<=BUILD_R;}

/** The two place facts, UNRESOLVED - the raw authored names, with no Chinese label attached.
 *  Two consumers need this and they need different halves of it. factsFor() wants the values as
 *  prompt material and labels them itself; the cursor readout in inspect.js wants to put them
 *  through T() and cannot, because a string that has been through this module's tables is
 *  deliberately untranslatable - generated prose and Chinese prompt facts must not share a path
 *  with the English UI. So the spatial decision lives here once and each caller labels it. */
export function placeFacts(p,ctx){
 const out={};
 // rooms[] is built with room.name = the prefab kind (simulation.js:67), so the building's
 // trade needs no prefab lookup. Nearest by centre, then gated by standsAt(): a search result on
 // its own is not a fact, it is a guess. room.owner is an instance name and must never be read
 // here - the mesh-id guard in tests/ai-story.mjs exists because one of those once reached the
 // model.
 let room=null,rd=Infinity;
 for(const r of ctx?.rooms||[]){const d=(r.x-p[0])*(r.x-p[0])+(r.y-p[1])*(r.y-p[1]);if(d<rd){rd=d;room=r;}}
 if(room?.name&&standsAt(room,p))out.building=room.name;
 // A landmark is a named place, so it is only true within a plausible walk of one, and only at
 // the same height - the bridge is 7.8m over the water and nothing at street level is 近处 from
 // up there. 16 of them are spread across the whole city; out of range the fact is omitted
 // rather than guessed, because the prompt forbids inventing a place.
 const near=nearPlace(p,ctx,'',out.building);if(near)out.place=near;
 return out;}

const HAN=/\p{Script=Han}/u;
// The cards once printed `Handcart__0912` and `Person_merchant_0__0674` verbatim, so this is a
// defect class this repo has actually shipped, not a hypothetical.
const MESH_ID=/[A-Za-z]__\d+$|^(Person|Main_street|Courtyard|South_approach|North_approach)_\S*__?\d+$/;
const INSTANCE_SUFFIX=/__\d{3,}/;

/** A closed schema, so the model answers with the two fields the panel renders and cannot invent
 *  keys nothing reads. Sentence length is prompt-only: json_schema takes no min/maxLength.
 *  `line` covers a spoken line AND a sound, because the reader can point at a bridge and a bridge
 *  has nobody to speak. One schema for all three subjects rather than one per kind. */
export const STORY_SCHEMA={type:'object',properties:{
 description:{type:'string',description:'两到三句白描，第三人称，现在时。'},
 line:{type:'string',description:'此刻的一句或一声，加引号，不加解释。'}},
 required:['description','line'],additionalProperties:false};

/** The cacheable prefix. These two strings must stay byte-identical across every request or the
 *  prompt cache misses on every click - any interpolation here, including a language toggle, is a
 *  silent billing regression. They sit well over the 512-token minimum so caching actually engages. */
export const SYSTEM={
zh:`你为一座可交互的《清明上河图》三维城市场景撰写白描。读者站在北宋汴京的街上，点了一个市中人、一条船或一座桥，想知道它此刻是什么样子。

写作要求：
- 第三人称、现在时，像《清明上河图》本身的笔法：白描，不加评论，不作解释，不写"他似乎""仿佛"这类揣度。
- 只写"这件事会做的事"。绝不编造姓名、家世、亲属、店铺名、具体钱数、日期或地名——你没有这些信息，编出来就是假的。
- 可以写：它/他在做什么、身子或船身怎么使、手上有什么、周围是什么声音与气味、这个时辰的光。
- 不可以写：名字（数据里没有）、来历、想法、任何画面上看不出的事。
- 身段与动作要与给定的"身段"一致；行旅与脚夫要写出正在赶往何处的那股劲头。
- 只写事实里出现过的东西。事实没提到的船、人、店铺、声音，就算此刻真的可能有，也不要写。
- 第二句看主体：人会说话、舟子会吆喝，就写他此刻会说的那一句；若是桥这样无人的地方，就写此刻那里的一声响。都要短，不文绉绉，不超过二十字。

格式：description 两到三句；line 是此刻的一句或一声，用「」包住。全部中文。`,
en:`You write character portraits for an interactive 3D reconstruction of the Qingming Riverside scroll. The reader is standing in a Northern Song street in Bianjing, has clicked one figure, and wants to know what this person looks like right now.

Writing rules:
- Third person, present tense, in the plain brushwork of the scroll itself: describe, never editorialise, no "seems to" or "as if".
- Write only what this thing would be doing. Never invent a name, a family, a shop's name, a price, a date or a place - you have none of that, and inventing it makes it false.
- You may write: what it is doing, how the body or hull works, what is in the hands or the hold, the sounds and smells nearby, the light at this hour.
- You may not write: a name, a history, what it thinks, or anything not visible in the scene.
- Match the given posture. A traveller or porter should carry the urgency of going somewhere.
- The second line depends on the subject: a person speaks and a boatman calls out, so write the line they would say now; a bridge has nobody to speak, so write the sound there right now. Either way: short, unliterary, under twenty words.

Format: description is two to three sentences; line is the one line or the one sound, in double quotes. All English.`,
};

const cache=()=>{try{return JSON.parse(localStorage.getItem('qm-stories')||'{}');}catch(_){return {};}};
const writeCache=c=>{try{localStorage.setItem('qm-stories',JSON.stringify(c));}catch(_){}};

/** Which subjects the reader can point at and get a portrait of. Anything not listed here is
 *  offered no AI block at all, rather than a card whose facts are all defaults. */
export const portraitable=hit=>hit?.kind==='person'&&!!hit.lifePlan||hit?.kind==='boat'&&!!hit.boat
 ||hit?.kind==='surface'&&hit.surface==='bridge'||null;

/** The identity a portrait is cached and written under. A person already carries a unique authored
 *  name; a boat and the bridge need one synthesised, and it must not be the mesh id. */
const subjectOf=hit=>hit?.kind==='person'?hit.lifePlan:hit?.kind==='boat'?{name:`boat-${hit.boat.id}`}
 :hit?.kind==='surface'&&hit.surface==='bridge'?{name:'bridge'}:null;

/** The live state the cache must separate on. A porter cycles 取货 → 搬货 → 返回货埠 and a boat
 *  cycles 航行 → 减速靠泊 → 靠泊装卸 → 离泊, so a frozen "he is carrying" would outlive its moment. */
const stateOf=hit=>hit?.kind==='boat'?hit.boat?.state:hit?.state;

/** A boat. The type carries most of the white-description on its own - a 乌篷客船 has a canopy
 *  because that is what one is - so the facts stay to what the simulation asserts: where it is
 *  going, what it is carrying, and the one constraint that makes three of the twelve take the
 *  long way round. */
function boatFacts(hit,ctx){
 const b=hit.boat,f={vessel:VESSEL[b.type]||'船'};
 const doing=BOAT_STATE[b.state];if(doing)f.doing=doing;
 if(b.cargo>0)f.cargo=`${b.cargo}份`;
 // 8 of the 12 hulls are authored with dock:null and never berth at all, so this is absent for
 // them rather than invented.
 const quay=b.dock&&ctx?.docksById?.get(b.dock);if(quay)f.quay=quay;
 const mast=MAST[b.rigClearancePolicy];if(mast)f.mast=mast;
 const near=nearPlace(hit.point,ctx,'',f.vessel);if(near)f.place=near;
 if(typeof ctx?.hour==='number'){const h=hourBucket(ctx.hour);if(h)f.hour=h;}
 return f;}

/** Hongqiao. One subject, so this is the cheapest portrait in the app to cache - a handful of
 *  entries for the whole city. What is on it right now is deliberately left out: a count changes
 *  every few seconds and the cache key would have to follow it, which is the same trade already
 *  refused for a traveller's street. The named routes across it are stable and say who uses it. */
function bridgeFacts(hit,ctx){
 const f={span:BRIDGE.name,form:BRIDGE.form};
 const on=(ctx?.bridgeRoutes||[]).filter(r=>r.over);
 if(on.length)f.routes=on.map(r=>r.name).join('、');
 // Who actually uses it. A live call on a fact set with no people in it had the model inventing a
 // barge under the arch, and once denying one was there - and 9 of the 12 hulls really do run
 // cross-city routes under this bridge, so the denial was checkably false. Naming the traffic that
 // the authored routes already assert gives it something true to work with instead of a gap.
 const folk=[...new Set(on.map(r=>CROWD[r.kind]).filter(Boolean))];
 if(folk.length)f.crowd=folk.join('、');
 // Where on the arch the reader is standing, as a position and not a height. A live MiniMax call
 // turned "7.8米" into 「七步八寸」 and "2.3米" into 「二丈」 - the model converts to a Chinese unit
 // and gets it wrong by up to 3x, which is a fabricated dimension in the one fact that was meant
 // to be read back from the geometry. The word still says what the number was for, and arithmetic
 // is the thing that has to go.
 const y=hit.point?.[1];
 if(Number.isFinite(y))f.deck=Math.abs(y)<6?'拱顶':Math.abs(y)<14?'坡上':'桥堍';
 const near=nearPlace(hit.point,ctx,f.span);if(near)f.place=near;
 if(typeof ctx?.hour==='number'){const h=hourBucket(ctx.hour);if(h)f.hour=h;}
 return f;}

/** The nearest named landmark, stripped of its UI instruction and only within a plausible reach
 *  and at the same height. Shared by all three subjects; `own` is the subject's own name, so the
 *  bridge is not also described as being 40m from 虹桥南. */
function nearPlace(p,ctx,own='',also=''){
 if(!Array.isArray(p))return '';
 let mark=null,md=PLACE_R*PLACE_R;
 for(const m of ctx?.landmarks||[]){const q=m.position;if(!q||Math.abs(q[2]-p[2])>BUILD_Z)continue;
  const d=(q[0]-p[0])*(q[0]-p[0])+(q[1]-p[1])*(q[1]-p[1]);if(d<md){md=d;mark=m;}}
 if(!mark)return '';
 const name=String(mark.name||'').split('·')[0].trim();
 // Most landmarks are the shop names again ("茶肆 · 入内"), and the suffix is a UI instruction
 // the model has no business seeing. Emitting one that repeats the subject says it twice.
 return name&&name!==own&&name!==also?name:'';}

/** Facts are the Chinese source values, never english() output - see the module header. */
export function factsFor(hit,ctx){
 if(hit?.kind==='boat')return boatFacts(hit,ctx);
 if(hit?.kind==='surface'&&hit.surface==='bridge')return bridgeFacts(hit,ctx);
 const plan=hit?.lifePlan||{},rig=hit?.person?.rig==='child'||plan.role==='child';
 const f={role:ROLE[plan.role]||'市中人',mode:MODE[plan.mode]||'市井人',age:rig?'孩童':'成人'};
 const clip=CLIP[hit?.person?.clip||plan.clip];if(clip)f.posture=clip;
 if(hit?.state&&STATE[hit.state])f.doing=STATE[hit.state];
 const route=plan.route&&ctx?.routes?.get(plan.route);if(route)f.route=route;
 if(plan.dock&&ctx?.docksById?.get(plan.dock))f.dock=ctx.docksById.get(plan.dock);
 // --- Where he is standing. The seven fields above describe a trade, not a person: across the
 // 584 citizens only 66 distinct fact sets existed, and two labourers 0.14m apart produced
 // byte-identical prompts. The system prompt forbids inventing a place, so the only way to write
 // a person rather than a category was to hand the model the place the data already asserts.
 const p=hit?.person?.p||hit?.point;
 if(Array.isArray(p))Object.assign(f,placeFacts(p,ctx));
 if(typeof ctx?.hour==='number'){const h=hourBucket(ctx.hour);if(h)f.hour=h;}
 return f;
}

// Chinese fact labels, so the model reads one coherent language. English keys here are a small
// thing that measurably invites an English word or two into Chinese prose.
const LABEL={role:'行当',mode:'身份',age:'年纪',posture:'身段',doing:'正在',route:'往来路线',dock:'货埠',
 // 近旁 not 所在: a teahouse 9m off is 所在 for nobody but the one standing in it, and only 8 of
 // 584 figures are inside a footprint at all. The label must not claim more than the data does.
 building:'近旁',place:'近处',hour:'时辰',
 vessel:'船型',cargo:'载货',quay:'货埠',mast:'桅高限',span:'桥',form:'形制',routes:'桥上的路',deck:'桥面',crowd:'桥上的人'};
const lines=f=>Object.entries(f).map(([k,v])=>`${LABEL[k]||k}：${v}`).join('\n');

/** The tool the schema-less path forces. MiniMax documents `tools` and `tool_choice` as fully
 *  supported, so this is the mechanism that actually constrains the shape there - a prompt
 *  instruction is what let the model answer with sixteen invented keys. */
export const STORY_TOOL={name:'write_portrait',description:'写出这个人的白描与一句话。',
 input_schema:STORY_SCHEMA};

export function buildMessages(facts,lang){
 return{lang,system:SYSTEM[lang==='en'?'en':'zh'],user:lines(facts),
  schema:STORY_SCHEMA,max_tokens:MAX_TOKENS};
}

/** Assemble the wire request for a provider. Kept separate from buildMessages so the message
 *  content is identical across providers and only the envelope differs - that is what lets a
 *  cached prompt be reused when the visitor switches. */
export function buildRequest(provider,body,key,url){
 const headers={'content-type':'application/json','anthropic-version':'2023-06-01',
  // Required on any browser-originated call; without it the API answers 401.
  'anthropic-dangerous-direct-browser-access':'true'};
 headers[provider.auth==='bearer'?'authorization':'x-api-key']=provider.auth==='bearer'?'Bearer '+key:key;
 const system=[{type:'text',text:body.system}];
 // Only where prompt caching is actually supported. Sending cache_control to a provider that
 // documents it as ignored is noise; sending it to one that errors on it would break the call.
 if(provider.cache)system[0].cache_control={type:'ephemeral'};
 const payload={model:provider.model,max_tokens:body.max_tokens,system,
  messages:[{role:'user',content:body.user}],output_config:{effort:'low'}};
 if(provider.structured==='output_config')payload.output_config.format={type:'json_schema',schema:body.schema};
 else{payload.tools=[STORY_TOOL];payload.tool_choice={type:'tool',name:STORY_TOOL.name};}
 return{url:url||provider.endpoint,headers,body:JSON.stringify(payload)};
}

/** plan.name is the identity - unique across all 584 and authored in the data, unlike actor.id,
 *  which is a construction counter that any asset reordering would silently re-point. The live
 *  state rides along because a porter cycles 取货 -> 搬货 -> 返回货埠 and a frozen "he is carrying"
 *  outlives the moment it described. The URL joins the provider in the key: a custom endpoint can
 *  front a different model entirely, and serving one backend's prose under another's name
 *  misrepresents where the words came from.
 *
 *  `v2` is the fact schema. Prose written before the place facts existed described a trade rather
 *  than a person, and without a version marker the key would keep handing it back forever - the
 *  change would look like it had done nothing. The hour rides along for the same reason: it is a
 *  slider the reader controls, and a portrait written at 上午 must not be served at 薄暮.
 *
 *  Position deliberately does NOT. It would multiply the key space on figures who are walking,
 *  so they would miss the cache on every approach and pay again. The accepted cost is that a
 *  traveller's portrait can name a street he has since left; a portrait is a snapshot, and the
 *  card already says 早前写成 when it is a cache hit. */
export function cacheKey(plan,lang,state,provider,url=readUrl(),hour=''){
 return['v2',plan?.name,lang,state||'',provider?.id||'anthropic',url||'',hour||''].join('|');}

export const hasHan=s=>HAN.test(String(s??''));
export const leaksMeshId=s=>MESH_ID.test(String(s??''))||INSTANCE_SUFFIX.test(String(s??''));

/** Returns null for anything it cannot fully trust, so the caller renders a retry rather than a
 *  half-answered card. Never throws.
 *
 *  Two shapes are read. A provider with `output_config.format` answers with a text block holding
 *  JSON; a provider forced through `tools` answers with a tool_use block whose input is already an
 *  object. Both are then held to the same two-field contract, because a provider that ignored its
 *  constraint has to be rejected rather than rendered - that is exactly the case where the model
 *  invents a name and a twelve-year history for a porter who has neither in the data.
 *
 *  The text block is found by type, never by index: with thinking on, content[0] is a thinking
 *  block whose text is empty by default. */
export function parseResponse(json){
 try{
  if(!json||json.stop_reason==='refusal'||json.stop_reason==='max_tokens')return null;
  const blocks=json.content||[];
  const tool=blocks.find(b=>b?.type==='tool_use');
  let parsed=null;
  if(tool?.input&&typeof tool.input==='object')parsed=tool.input;
  else{
   const block=blocks.find(b=>b?.type==='text');
   if(!block?.text)return null;
   parsed=JSON.parse(block.text);
  }
  if(typeof parsed?.description!=='string'||typeof parsed?.line!=='string')return null;
  if(!parsed.description.trim()||!parsed.line.trim())return null;
  return{description:parsed.description.trim(),line:parsed.line.trim()};
 }catch(_){return null;}
}

export const hasKey=()=>{try{return !!localStorage.getItem(KEY_STORE);}catch(_){return false;}};
export const readKey=()=>{try{return localStorage.getItem(KEY_STORE)||'';}catch(_){return '';}};
export const writeKey=k=>{try{k?localStorage.setItem(KEY_STORE,k.trim()):localStorage.removeItem(KEY_STORE);}catch(_){}};
// An optional endpoint override, for a same-origin or local proxy (the only way to reach a
// browser:false provider). Anything that is not http(s) is treated as unset rather than saved,
// so a typo degrades to the vendor default instead of a fetch that can never work.
export const readUrl=()=>{try{const u=(localStorage.getItem(URL_STORE)||'').trim();return /^https?:\/\//.test(u)?u:'';}catch(_){return '';}};
export const writeUrl=u=>{try{const v=String(u||'').trim();/^https?:\/\//.test(v)?localStorage.setItem(URL_STORE,v):localStorage.removeItem(URL_STORE);}catch(_){}};

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
  this.make=document.querySelector('#ai-make');
  this.cancel=document.querySelector('#ai-cancel');
  this.current=null;this.busy=null;this.variant=0;this.abort=null;this.tick=null;this.spoken=new Set();this.reading=null;
  // "Another line" has to be a *different* request, not the same one again: the prompt is byte-stable
  // for cache reasons, so a repeat would return the identical prose. The variant rides along as a
  // user turn rather than in the system prompt, which keeps the cached prefix intact.
  if(this.again)this.again.onclick=()=>this.again_();
  // Spending is always an explicit act: opening the card, the 350ms tick and the language toggle
  // all just render. The 写照 button is the only way in for a person not yet written.
  if(this.make)this.make.onclick=()=>this.spend();
  if(this.cancel)this.cancel.onclick=()=>this.abort?.abort();
 }
 /** The only path into generate() for an unwritten person. Guarded like again_(): one flight per key. */
 spend(){if(!this.current||this.busy)return;this.generate(this.current);}
 async again_(){
  const target=this.current;
  if(!target||this.busy===target.key)return;
  this.busy=target.key;this.paint({pending:true});
  const controller=new AbortController();
  this.abort=controller;
  const timer=setTimeout(()=>controller.abort(new Error('timeout')),TIMEOUT_MS);
  try{
   this.variant++;
   const store=cache();delete store[target.key];
   const url=readUrl(),provider=readProvider(url);
   const body=buildMessages(target.facts,target.lang);
   const ask=this.variant>1?`\n\n（第 ${this.variant} 次：请换一个完全不同的画面或说法。）`:'';
   const req=buildRequest(provider,{...body,user:body.user+ask},readKey(),url);
   const res=await fetch(req.url,{method:'POST',signal:controller.signal,headers:req.headers,body:req.body});
   if(!res.ok){const e=new Error('HTTP '+res.status);e.status=res.status;throw e;}
   const result=vet(parseResponse(await res.json()),target.lang);
   if(!result)throw new Error('unusable response');
   if(this.current!==target)return;
   store[target.key]=result;writeCache(store);
   this.paint(result);
  }catch(err){
   if(this.current!==target)return;
   // A cancel is not a failure: fall back to what was already written, or to the 写照 prompt.
   if(err?.name==='AbortError'){const kept=vet(cache()[target.key],target.lang);this.paint(kept?{...kept,cached:true}:{ready:true});return;}
   this.paint({error:true,why:err?.message||'network'});
  }finally{clearTimeout(timer);if(this.busy===target.key)this.busy=null;if(this.abort===controller)this.abort=null;}
 }
 /** Called on every show() - a 350ms tick, so everything below must be a no-op for the subject
  *  already shown. It renders the cache or the 写照 prompt and NEVER fires a request: spending
  *  is the reader's explicit click on 为其写照 or 换一句, never the act of opening a card. */
 async offer(hit,ctx){
  if(!this.root)return;
  // A subject with no authored facts of its own - a patch of water, a room, a door - is offered
  // no AI block at all, rather than a card whose facts are all defaults.
  const plan=subjectOf(hit);
  if(!plan){this.clear();return;}
  const lang=getLang()==='en'?'en':'zh',url=readUrl();
  // The key takes the hour from the facts rather than from ctx, so the cache bucket and the
  // bucket the model was actually told can never drift apart.
  const facts=factsFor(hit,ctx),key=cacheKey(plan,lang,stateOf(hit),readProvider(url),url,facts.hour);
  if(this.current?.key!==key){this.clear();this.variant=0;this.current={key,lang,plan,hit,facts};}
  const store=cache(),kept=vet(store[key],lang);
  if(kept){this.paint({...kept,cached:true});return;}
  if(this.busy===key)return;
  this.paint({ready:true});
 }
 async generate(target){
  const key=target.key,lang=target.lang;
  this.busy=key;this.paint({pending:true});
  const controller=new AbortController();
  this.abort=controller;
  // A reason, so the 45s timeout lands on the error path while the reader's own cancel
  // (abort() with no reason) lands on the quiet fallback instead.
  const timer=setTimeout(()=>controller.abort(new Error('timeout')),TIMEOUT_MS);
  try{
   const url=readUrl(),provider=readProvider(url);
   const body=buildMessages(target.facts,lang);
   const req=buildRequest(provider,body,readKey(),url);
   const res=await fetch(req.url,{method:'POST',signal:controller.signal,headers:req.headers,body:req.body});
   if(!res.ok){const e=new Error('HTTP '+res.status);e.status=res.status;throw e;}
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
  }catch(err){
   if(this.current?.key!==key)return;
   if(err?.name==='AbortError'){const kept=vet(cache()[key],lang);this.paint(kept?{...kept,cached:true}:{ready:true});return;}
   this.paint({error:true,why:err?.message||'network'});
  }finally{clearTimeout(timer);if(this.busy===key)this.busy=null;if(this.abort===controller)this.abort=null;}
 }
 paint(state){
  if(!this.root)return;
  clearInterval(this.tick);this.tick=null;
  const say=(node,text)=>{if(node)node.textContent=text||'';},vis=(node,on)=>{if(node)node.hidden=!on;};
  this.root.hidden=!state;
  if(!state)return;
  // Every branch re-derives all four toggles: a 350ms cache-hit repaint must not leak the last
  // state's buttons into this one. An empty #ai-line is hidden too - its gold rule and wash
  // would otherwise hang on the card as an empty bar.
  vis(this.line,false);vis(this.make,false);vis(this.cancel,false);vis(this.again,false);
  if(state.pending){say(this.desc,'…');say(this.line,'');say(this.note,t('aiThinking'));vis(this.cancel,true);
   // Opus runs 20-60s and the call is not streamed, so elapsed time is the only honest progress
   // report there is. A bare spinner reads as a hang long before the timeout.
   let s=0;this.tick=setInterval(()=>say(this.note,t('aiWait',++s)),1000);return;}
  if(state.ready){say(this.desc,'');say(this.line,'');
   const keyed=hasKey();say(this.note,keyed?t('aiCost'):t('aiNoKey'));vis(this.make,keyed);return;}
  // A network failure and a bad key look identical without a reason. Saying which one it was costs
  // nothing and turns "it does not work" into something the reader can act on.
  if(state.error){const why=String(state.why||'');
   say(this.desc,'');say(this.line,'');
   say(this.note,why==='Failed to fetch'?t('aiNoReach'):/^HTTP 40[13]/.test(why)?t('aiKeyBad'):t('aiFailed'));
   say(this.again,t('aiRetry'));vis(this.again,true);return;}
  // textContent throughout: the card body is built by innerHTML interpolation, and model output
  // must never share that path.
  say(this.desc,state.description);say(this.line,state.line);vis(this.line,true);
  // Read it once, and only once. This line is reached roughly three times a second, because
  // offer() repaints from cache on every 350ms tick, so a plain speak() here talks over itself.
  // The guard keys on the text rather than the cache key: again_() reuses one key for a different
  // line - that is the whole point of the button - so a key-based guard would swallow 换一句 too.
  // A set rather than the last line, so that returning to a portrait after hearing someone else
  // is still silent, which is what "once" is supposed to mean. It is not cleared in clear(), so a
  // close and a cache hit stay silent. A language switch does NOT: the cache key is language-scoped,
  // so the same person arrives with a different sentence in the other tongue and that one is read.
  //
  // The mark is committed on completion, not on starting: a line takes 6.4s, and a 试听 click or the
  // mute switch cuts it off mid-sentence. Committing at the start loses that tail for the session,
  // because nothing would ever ask for the line again. `reading` is what stops the 350ms repaint
  // from restarting it in the meantime - and it is set whether or not the mark eventually lands,
  // so a muted or not-yet-loaded card is simply retried rather than retired.
  if(!this.spoken.has(state.line)&&this.reading!==state.line){
   this.reading=state.line;
   // sayLine reports whether it started. It does not, the sound is off or the OS has not
   // delivered its voices, and it will not call done - so the marker has to come back off here or
   // the line is "reading" for the rest of the session and can never be offered again.
   const started=sayLine(state.line,finished=>{this.reading=null;if(finished)this.spoken.add(state.line);});
   if(!started)this.reading=null;}
  // A cache hit cost nothing this time - the byline says so, rather than implying a fresh write.
  say(this.note,state.cached?t('aiCached'):t('aiByline'));
  say(this.again,t('aiAgain'));vis(this.again,true);
 }
 /** Drops the "already read" mark so the next line is spoken even if the reader has met it before.
  *  The voice switch calls this on the way back up, which is the only way to hear a line twice
  *  without spending another request. */
 forget(){this.spoken.clear();}
 /** Bumps the identity so a late reply for a previous person cannot repaint the new card. `busy` is
  *  deliberately left alone: it guards the network, not the display, and dropping it mid-request
  *  would let the next 350ms tick start a second call for a request already in flight. */
 clear(){this.current=null;clearInterval(this.tick);this.tick=null;if(this.root)this.root.hidden=true;}
}
