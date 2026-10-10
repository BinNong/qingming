// The prompt contract, and the only place it lives. It used to sit in src/ai-story.js and ship to
// the browser; it is here now because the backend is the trust boundary (functions/_shared/routes.mjs
// builds the request, not the page). Moving it is not cosmetic: a browser-side payload handed to a
// key-holding endpoint is an open proxy with the operator's bill attached.
//
// The two SYSTEM strings must stay byte-identical across every request or the vendor's prompt cache
// misses on every click - any interpolation here, including a language toggle, is a silent billing
// regression. They sit well over the 512-token minimum so caching actually engages.

/** A closed schema, so the model answers with the two fields the card renders and cannot invent
 *  keys nothing reads. Sentence length is prompt-only: json_schema takes no min/maxLength.
 *  `line` covers a spoken line AND a sound, because the reader can point at a bridge and a bridge
 *  has nobody to speak. One schema for all three subjects rather than one per kind. */
export const STORY_SCHEMA={type:'object',properties:{
 description:{type:'string',description:'两到三句白描，第三人称，现在时。'},
 line:{type:'string',description:'此刻的一句或一声，加引号，不加解释。'}},
 required:['description','line'],additionalProperties:false};

/** The tool the schema-less path forces. MiniMax documents `tools` and `tool_choice` as fully
 *  supported, so this is the mechanism that actually constrains the shape there - a prompt
 *  instruction is what let the model answer with sixteen invented keys. */
export const STORY_TOOL={name:'write_portrait',description:'写出这个人的白描与一句话。',
 input_schema:STORY_SCHEMA};

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

// Chinese fact labels, so the model reads one coherent language. English keys here are a small
// thing that measurably invites an English word or two into Chinese prose.
const LABEL={role:'行当',mode:'身份',age:'年纪',posture:'身段',doing:'正在',route:'往来路线',dock:'货埠',
 // 近旁 not 所在: a teahouse 9m off is 所在 for nobody but the one standing in it, and only 8 of
 // 584 figures are inside a footprint at all. The label must not claim more than the data does.
 building:'近旁',place:'近处',hour:'时辰',
 vessel:'船型',cargo:'载货',quay:'货埠',mast:'桅高限',span:'桥',form:'形制',routes:'桥上的路',deck:'桥面',crowd:'桥上的人'};

const lines=f=>Object.entries(f).map(([k,v])=>`${LABEL[k]||k}：${v}`).join('\n');

// Anthropic 5.5's thinking cannot be turned off and it bills against max_tokens, so this has to
// cover reasoning plus the ~200 visible tokens. A 200-token budget truncates the reply mid-JSON.
const MAX_TOKENS=2048;
export const maxTokens=()=>MAX_TOKENS;

/** The user turn. `facts` arrives as a plain object of Chinese source values - the page resolves
 *  them against the live scene and sends only what is true; this side never sees the geometry.
 *  `variant` is the "another line" nudge. It rides in the USER turn rather than the system prompt
 *  on purpose: that is what keeps the cached prefix intact, so a repeat still hits the cache and
 *  still returns a different picture. */
export function buildMessages(facts,lang,variant=0){
 const ask=variant>1?`\n\n（第 ${variant} 次：请换一个完全不同的画面或说法。）`:'';
 return{lang,system:SYSTEM[lang==='en'?'en':'zh'],user:lines(facts)+ask,
  schema:STORY_SCHEMA,max_tokens:MAX_TOKENS};}