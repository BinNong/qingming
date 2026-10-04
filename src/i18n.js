// Bilingual UI. Three sources feed the screen and each needs a different resolver:
//   1. Chinese-authored JSON (landmark/room/door/dock names, boat & convoy states): the source
//      string IS the Chinese, and english() is the English view. -> T()
//   2. English-authored enums (district ids, vessel types, citizen roles/modes, animation clips,
//      rig clearance policies): a flat zh lookup, raw in English. -> E()
//   3. Hard-coded chrome (page header, panel labels, toasts, instructions, capture strings):
//      the S table below. -> t()
// Every S entry is a [zh, en] pair so a language can never be missing for a key that the other has.
// t() also takes a pair directly, which is how the views array carries its own metadata.
import {english} from './english.js';

const S={
// —— 载入与错误 ——
loadOverline:['宋代汴京 · 一座活着的城','A LIVING SONG DYNASTY CITY'],
loadTitle:['走入一幅活着的长卷','Step into a living scroll.'],
loadText:['正在生成城市','Preparing the city'],
loadInstances:['正在读取城例与材质','Reading city instances and materials'],
loadGeometry:['正在载入几何体 · {0} MB','Loading geometry · {0} MB'],
loadUnpack:['正在解包瓦陇、木构与市集','Unpacking roofs, timber and market geometry'],
loadUpload:['正在上传贴图与实例','Uploading textures and instances to the GPU'],
loadReady:['城市已就绪','The city is ready'],
loadPrograms:['正在编译材质程序','Preparing material programs'],
loadView:['正在准备视角 {0} / {1}','Preparing view {0} / {1}'],
loadLighting:['正在布置光照与倒影','Preparing lighting and reflections'],
errorTitle:['场景加载失败','The scene could not load'],
errorReload:['重新加载','Reload'],
// —— 页头 ——
brandOverline:['汴京 · 一座活着的城','BIANJING · A LIVING CITY'],
brandTitle:['清明上河图','Qingming Riverside'],
brandSub:['一河烟水，满城生机','A river of stories. A city alive.'],
enginePrefix:['汴京 · ','Bianjing · '],
btnTools:['场景设置','Scene settings'],
btnMap:['江河舟车','River traffic'],
btnFull:['全屏','Fullscreen'],
btnLang:['切换语言','Switch language'],
closePanel:['关闭','Close'],
closeMap:['关闭舟车面板','Close traffic panel'],
// —— 场景工坊 ——
toolsOverline:['场 景 工 坊','SCENE WORKSHOP'],
toolsTitle:['场景设置','Scene settings'],
lblDetail:['细节','Detail'],
lblResolution:['分辨率','Resolution'],
optAuto:['自动 · 流畅','Auto · Performance'],
optCinema:['影院 · 高细节','Cinema · Rich detail'],
optNative:['原生','Native'],
lblWave:['波浪强度','Wave strength'],
lblFlow:['水流速度','Current speed'],
lblSun:['时辰','Time of day'],
lblStyle:['画卷风格','Scroll style'],
optColor:['淡彩','Light Color'],
optSilk:['古绢','Antique Silk'],
optOff:['原材质','Original Materials'],
lblInk:['画卷浓度','Scroll strength'],
lblLine:['墨线','Ink outlines'],
lblPaper:['绢纹','Silk texture'],
lblWalk:['步行起点','Walking location'],
btnWalk:['从此处步行','Start walking here'],
toolsNote:['门、楼梯与家具皆为实心。按 E 开关门，按 R 回到起点。','Doors, stairs and furniture are solid. E opens doors; R returns to your starting point.'],
tglMotion:['城市活动','Animate the city'],
tglPeople:['行人','People'],
tglTrees:['树木花草','Trees and plants'],
tglBoats:['舟船','Boats'],
tglAnimals:['牲口与车','Animals and carts'],
tglWake:['显示尾流场','Show wake field'],
btnCapture:['截取 4K 静图','Capture 4K still'],
lnkDownload:['下载细部模型 ↗','Download detail assets ↗'],
btnSuite:['导出全部视角 · 画卷与原件','Export all views · Styled and original'],
btnRecord:['录制十秒漫游','Record 10-second walkthrough'],
// —— 舟车面板 ——
ecoOverline:['江 河 与 市 衢','RIVER AND ROAD TRAFFIC'],
ecoTitle:['满城皆动','A city in motion.'],
ecoTime:['推演时刻','Simulation time'],
ecoPreparing:['正在备算江河与市衢','Preparing river and road traffic'],
mapLabel:['行人、舟船与车队的实时路径','Live routes for people, boats and carts'],
ecoLegend:['青：舟船 · 棕：车队 · 绿：行人','Teal: boats · Brown: carts · Green: people'],
lblFollow:['跟随舟船','Follow a boat'],
btnFollowBoat:['跟随此船','Follow boat'],
btnFollowCart:['跟随车队','Follow carts'],
btnStopFollow:['自由视角','Free view'],
lblRate:['推演速度','Simulation speed'],
optSlow:['0.5× 缓','0.5× Slow'],
optNatural:['1× 常','1× Natural'],
optFast:['2× 疾','2× Fast'],
tglRoutes:['在场景中显示路径','Show routes in the scene'],
followBoat:['跟随舟中 · 拖动即接管','Following a boat · Drag to take control'],
followCart:['跟随车队中 · 拖动即接管','Following a convoy · Drag to take control'],
followDone:['路径与行止实时更新。','Routes and activity update live.'],
boatStatus:['{0} 号船 · {1} · {2} 米/秒','Boat {0} · {1} · {2} m/s'],
lifeSummary:['{0}/12 舟在行 · {1}/9 车队在走 · {2} 人步行','{0}/12 boats under way · {1}/9 convoys moving · {2} people walking'],
lifeLedger:['卸货 {0} · 入仓 {1} · 送达 {2}','Unloaded: {0} · Warehoused: {1} · Delivered: {2}'],
dockLoad:['装卸中','Loading'],
dockReserved:['已预留','Reserved'],
dockFree:['空泊','Available'],
dockCargo:['存货 {0}','Cargo: {0}'],
trafficEmpty:['靠泊、入仓与抵市，皆记于此。','Berthing, warehouse deliveries and market arrivals appear here.'],
mapBridge:['虹桥','Hongqiao'],
// —— 检视卡 ——
inspectOverline:['所 指 之 物','POINTED AT'],
// —— 视角导航 ——
viewNavOrbit:['环绕','Orbit'],
viewNavFly:['飞行','Fly'],
viewNavWalk:['行走','Walk'],
viewNavTour:['巡游 ▷','Tour ▷'],
tipOrbit:['环绕镜头','Orbit camera'],
tipFly:['WASD 移动 · Q/E 升降 · 拖动转向','WASD move · Q/E up/down · Drag to look'],
tipWalk:['穿行街市、屋舍与阶梯','Walk through streets, buildings and stairs'],
tipTour:['自动巡游','Automatic camera tour'],
// —— 十景 ——
v1Name:['全景','Overview'],v1Title:['虹桥 · 一座活着的城','Hongqiao · A City Alive'],v1Line:['沿 河 而 生','THE CITY ALONG THE RIVER'],v1Desc:['一河相通，千家烟火。','One river connects a thousand lives.'],
v2Name:['虹桥','Bridge'],v2Title:['虹桥 · 舟楫交汇','Hongqiao · Crossing Paths'],v2Line:['桥 上 人 声','ON THE RAINBOW BRIDGE'],v2Desc:['木栏与板桥之间，汴京众生穿行。','Bianjing passes by, between timber rails and wooden planks.'],
v3Name:['汴河','River'],v3Title:['汴河 · 帆影往来','Bian River · Passing Sails'],v3Line:['拱 影 之 下','BENEATH THE TIMBER ARCH'],v3Desc:['漕船满载，自桥拱下缓过。','Rice-laden boats glide beneath the bridge.'],
v4Name:['埠头','Docks'],v4Title:['埠头 · 货殖荷担','The Quays · Cargo and Commerce'],v4Line:['劳 作 河 岸','THE WORKING QUAYS'],v4Desc:['筐篓、陶器与麻绳，织成劳作的河岸。','Baskets, pottery and hemp rope connect a working waterfront.'],
v5Name:['市街','Market'],v5Title:['市街 · 百业争喧','Market Street · A Hundred Trades'],v5Line:['喧 阗 市 街','THE MERCHANT STREET'],v5Desc:['茶楼酒肆与行商，共拥一条街。','Teahouses, taverns and traders share the street.'],
v6Name:['巷院','Courtyard'],v6Title:['深巷 · 寻常人家','Quiet Lanes · Everyday Homes'],v6Line:['庭 院 深 巷','COURTYARDS & ALLEYWAYS'],v6Desc:['瓦檐围出一方安静的院子。','Tiled eaves frame a quiet courtyard.'],
v7Name:['城门','City Gate'],v7Title:['汴京 · 城门外','Bianjing · Beyond the City Gate'],v7Line:['城 门','THE GATE OF BIANJING'],v7Desc:['出了城门，城还在继续。','Beyond the gate, the city continues.'],
v8Name:['众生','People'],v8Title:['市井 · 汴京众生','Street Life · People of Bianjing'],v8Line:['汴 京 众 生','PEOPLE OF BIANJING'],v8Desc:['每一步、每一担，都有去处。','Every step and every load has a destination.'],
v9Name:['舟船','Boats'],v9Title:['水面 · 逐流而下','On the River · Following the Current'],v9Line:['舟 楫 与 余 波','VESSELS AND THEIR WAKE'],v9Desc:['舟随水起伏，尾波迟退。','Boats rise with the water; their wakes linger behind.'],
v10Name:['木作','Joinery'],v10Title:['檐下 · 木石之工','Under the Eaves · Timber and Stone'],v10Line:['营 造 与 日 用','JOINERY & EVERYDAY CRAFT'],v10Desc:['斗拱承檐，格窗筛光。','Brackets carry the eaves; lattice windows catch the light.'],
// —— 页脚与行走 ——
instrOrbit:['拖动环绕 · 点击查看 · 滚轮缩放 · 右键平移 · 1–0 切换视角 · H 隐藏界面','Drag to orbit · Click to inspect · Scroll to zoom · Right-drag to pan · 1–0 views · H hide UI'],
instrFly:['WASD 飞行 · Q/E 升降 · 拖动转向 · Shift 加速','WASD fly · Q/E up/down · Drag to look · Shift faster'],
instrWalk:['WASD 行走 · 拖动转向 · 点击查看 · E 开关门 · Shift 疾走 · R 归位 · F 锁定指针','WASD walk · Drag to look · Click to inspect · E doors · Shift run · R reset · F lock pointer'],
footerLoading:['加载城市中','Loading the city'],
walkStreets:['汴京街市','Streets of Bianjing'],
walkBianjing:['汴京 · 街市步行','Bianjing · Street walk'],
walkUp:['楼上','Upper floor'],
walkDown:['一层','Ground floor'],
doorHint:['E {0}{1}','E {0}{1}'],
verbOpen:['推开 ','Open '],verbClose:['合上 ','Close '],
walkToast:['{0} · WASD 移动，E 开门','{0} · WASD move, E opens doors'],
// —— 浮字提示 ——
toastFull:['此浏览器不支持全屏。','Fullscreen is unavailable in this browser.'],
toastFree:['自由镜头：WASD 移动，Q/E 升降，拖动转向','Free camera: WASD move, Q/E up/down, drag to look'],
toastLock:['无法锁定指针，请拖动转向。','Pointer lock is unavailable. Drag to look instead.'],
toastReset:['已回到起点。','Returned to your starting point.'],
// —— 状态行与截屏 ——
stats:['{0} 座可入屋舍 · {1} 位活动生人 · 江河与市衢奔流','{0} enterable buildings · {1} animated people · River and road traffic'],
perfFmt:['{0} 帧/秒 · {1} 绘制 · {2}M 三角面 / 全通道','{0} fps · {1} draws · {2}M tris / all passes'],
perfPaused:['静止 · 有变化才渲染','Paused · Rendering on change'],
capEncode:['浏览器无法编码该图像','The browser could not encode the image'],
capSaveFail:['图像保存失败：{0}','Could not save the image: {0}'],
capNote:['3840 × 2160 · {0} · 已存：{1}','3840 × 2160 · {0} · Saved: {1}'],
capSuiteDone:['已存 20 张 4K 截图至 evidence','20 captures saved to evidence at 4K'],
capSuiteFail:['导出失败：{0}','Export failed: {0}'],
capExporting:['正在导出{0} · {1}/10','Exporting {0} · {1}/10'],
capRecorded:['漫游已录制 · 保存视频','Walkthrough recorded · Save video'],
capRecording:['录制中 · 拖动或切换视角','Recording · Drag or switch views'],
capRecFail:['录制失败：{0}','Recording failed: {0}'],
capBack:['回到场景','Back to the scene'],
capSave:['保存文件','Save file'],
capAlt:['场景截图','Your scene capture'],
btnVerify:['运行场景校验','Run scene verification'],
// —— 检视卡 · 栏目 ——
olRiver:['江 河 之 水','THE RIVER'],olTraffic:['舟 船 往 来','RIVER TRAFFIC'],olFreight:['陆 路 货 运','ROAD FREIGHT'],olCrew:['舟 上 营 生','RIVER CREW'],olStreet:['市 井 众 生','STREET LIFE'],olDoor:['门 户','DOOR'],olLand:['城 内 地 标','LANDMARK'],olTerrain:['地 貌','TERRAIN'],olBuilding:['屋 宇','BUILDING'],
waterTitle:['汴河之水','Bianjing Water'],
convoyTitle:['第 {0} 队','Convoy {0}'],
inspectMiss:['此处空无所有——请点街道、水面、舟船或生人。','Nothing there — click the street, the water, a boat or a person.'],
// —— 检视卡 · 行标签 ——
rSurface:['水面','Surface level'],rCurrent:['流速','Current'],rSwell:['浪势','Swell'],rWake:['余波存留','Wake memory'],rUnderway:['在行舟船','Vessels under way'],
rSurfaceKind:['地表','Surface'],
rVessel:['船名','Vessel'],rState:['状态','State'],rSpeed:['航速','Speed'],rCargo:['载货','Cargo'],rQuay:['泊岸','Quay'],rMast:['桅高限值','Mast clearance'],rClearance:['通限校验','Clearance checks'],
rCart:['车辆','Cart'],rAnimal:['牲口','Animal'],rDepot:['仓棚','Depot'],rDistance:['行程','Distance'],
warehouse:['{0} 号仓棚','Warehouse {0}'],
rOccupation:['行业','Occupation'],rPosition:['身份','Role'],rActivity:['正在','Activity'],rGesture:['身段','Gesture'],rNameField:['名字','Name'],
rBuilding:['建筑','Building'],rPrecinct:['片区','Precinct'],rStoreys:['层数','Storeys'],rFloor:['楼层','Floor'],rDistrict:['地段','District'],
rGround:['地坪','Ground level'],rHandle:['启闭','Handle'],rEnterable:['可否入内','Enterable'],pressKey:['按键','Key'],
// —— 检视卡 · 取值 ——
suffixM:[' 米',' m'],suffixMS:[' 米/秒',' m/s'],suffixUnit:[' 份',' units'],suffixFrames:[' 帧',' frames'],suffixKm:[' 公里',' km'],
suffixOf:[' / ',' of '],suffixPct:['满浪 {0}%','{0}% of full'],
passingThrough:['过境不停','Passing through'],
mastSamples:['已测 {0} 次 · 失手 {1} 次','{0} sampled · {1} failed'],
standing:['伫立','Standing'],idle:['闲立','Idle'],citizen:['城中人','Citizen'],
surfBridge:['虹桥','Hongqiao bridge'],surfStairs:['阶梯','Stairs'],surfStreet:['街面','Street'],surfFloor:['屋内地面','Building floor'],surfThreshold:['门限','Threshold'],surfPlain:['街面','Street level'],
surfBridgeDeck:['桥面','Bridge deck'],surfStairRun:['梯级','Stair flight'],
vesselNo:['{0} 号船','Vessel {0}'],
enterYes:['可——自街头而入','Yes — walk in from the street'],enterNo:['仅供眺望','Viewpoint only'],
walkHere:['前往此处','Walk here'],walkHereSec:['场景工坊 ▸ 从此处步行','Scene workshop ▸ Enter location'],
doorOpen:['开','Open'],doorClosed:['合','Closed'],
// —— 生成 · 人物白描 ——
// Chrome only. The generated prose itself never passes through t()/T()/E() - see ai-story.js.
aiOverline:['其 人','THE PERSON'],aiThinking:['正在看他……','Watching him……'],
aiAgain:['换一句','Another line'],aiNoKey:['尚未设置 API 密钥','No API key yet'],
aiFailed:['写不出来','Could not write'],aiRetry:['再试一次','Try again'],
aiKeyBad:['密钥被拒，请检查。','Key rejected — check it.'],
aiNoReach:['连不上服务商，可能是网络或跨域限制。','Could not reach the service — network, or a cross-origin limit.'],
aiByline:['由模型依数据写成','Written from the scene data'],
lblApiKey:['API 密钥','API key'],
lblProvider:['模型服务','Model service'],
aiKeyNote:['密钥只存在本机浏览器，直连所选服务商，不经任何服务器。','The key stays in this browser and goes straight to the service you pick. No server of ours sees it.'],
aiCost:['每次约 ¥0.02','About ¥0.02 each'],
};

/** English-authored enums. Keyed by the raw runtime value; English is the raw value itself. */
const ENUM={
'03_Hongqiao':'虹桥','04_Riverside_commerce':'河畔商贸','05_Main_street':'主街','06_North_residential_blocks':'北坊民居','07_South_courtyards':'南院','08_Temple_precinct':'庙署','09_City_gate_and_wall':'城门城墙','10_Distant_city':'远城','13_Docks_and_loading':'码埠装卸','19_Edge_neighborhoods':'边街坊巷',
Cargo_barge:'漕船',Trading_sailboat:'商帆',Fishing_rowboat:'渔船',Ferry:'渡船',Covered_passenger_boat:'乌篷客船',Courier_skiff:'快脚小船',
merchant:'商人',laborer:'劳力',porter:'挑夫',boatman:'舟子',vendor:'摊贩',woman:'妇人',scholar:'学子',guard:'巡城',farmer:'农夫',child:'孩童',
crew:'舟员',traveller:'行旅',resident:'居家',seated:'闲坐',shopkeeper:'看店',
Work:'劳作',Idle:'静立',Sit:'闲坐',Talk:'攀谈',Walk:'行走',Carry:'负重',
'low-clearance cross-city lane':'低桅穿城专用道',
'east reach only — 8.45m standing mast never enters 6m bridge aperture':'只走东段——八米四五高桅不入六米桥门',
};

const STORAGE='qm-lang';
let lang='zh';
try{const saved=localStorage.getItem(STORAGE);if(saved==='en'||saved==='zh')lang=saved;}catch(_){}
const idx=()=>lang==='zh'?0:1;
const fill=(s,a)=>s.replace(/\{(\d+)\}/g,(m,i)=>a[+i]??m);
export const getLang=()=>lang;
const cbs=new Set();
export const onLang=cb=>{cbs.add(cb);return()=>cbs.delete(cb);};
export function setLang(next){
 const v=next==='en'?'en':'zh';
 if(v===lang)return;
 lang=v;
 try{localStorage.setItem(STORAGE,lang);}catch(_){}
 // The headless contract tests import this module, so the document write has to be optional.
 if(typeof document!=='undefined')document.documentElement.lang=lang;
 for(const cb of cbs)cb();
}
/** Resolve a table key or a [zh,en] pair; trailing args fill {n} slots. */
export const t=(v,...a)=>{
 const s=typeof v==='string'?(S[v]?.[idx()]??v):Array.isArray(v)?v[idx()]:v?.[lang]??'';
 return a.length?fill(s,a):s;
};
/** Chinese-authored source: raw in Chinese, english() in English. */
export const T=v=>v==null?'':lang==='zh'?String(v):english(String(v));
/** English-authored enum: zh table, and in English prefer english()'s title case when it has one
 *  (vessel types are ids like Cargo_barge but the card has always shown 'Cargo Barge'). */
export const E=v=>v==null?'':lang==='zh'?(ENUM[v]??v):(english(String(v))!==v?english(String(v)):String(v));
/** District ids are authored as `04_Riverside_commerce`; Chinese names the whole id. */
export const district=d=>d==null?null:(lang==='zh'?ENUM[d]??d:String(d).replace(/^\d+_/,'').replace(/_/g,' '));
/** Instance names are an asset base plus a unique mesh suffix - `Handcart__0912`. Only the base
 *  names anything; the suffix is an id that means nothing on screen. */
const ASSET={Handcart:['手推车','Handcart'],Covered_goods_cart:['覆篷货车','Covered Goods Cart'],Horse_saddled:['鞍马','Saddled Horse'],Ox_saddled:['驾犊牛','Saddled Ox']};
export const asset=v=>{if(!v)return'';const base=String(v).split('__')[0];return ASSET[base]?ASSET[base][idx()]:base;};
/** Re-translate the static markup. Text nodes use data-i18n; attributes use data-i18n-a="a:key,b:key". */
export function applyStatic(){
 for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=t(el.dataset.i18n);
 for(const el of document.querySelectorAll('[data-i18n-a]'))for(const pair of el.dataset.i18nA.split(',')){
  const i=pair.indexOf(':');if(i>0)el.setAttribute(pair.slice(0,i),t(pair.slice(i+1)));
 }
}
/** Set the language and translate the whole interface. Re-runs the registered rebuild hooks. */
export function applyLang(next){setLang(next);applyStatic();for(const cb of cbs)cb();}
/** Diagnostic: the tables are built as pairs, so this only catches enum and key typos. */
export function _diagnose(){
 const keyList=Object.keys(S);
 return {keys:keyList.length,keyList,enums:Object.keys(ENUM).length,unpaired:keyList.filter(k=>!Array.isArray(S[k])||S[k].length!==2||S[k].some(v=>!v))};
}
