import {V,pick} from './simulation.js';
import {t,T,E,district,asset,onLang} from './i18n.js';

/** Navigation space is Z-up; the scene is Y-up. This is the inverse of world() in simulation.js. */
const toNav=w=>[w[0],-w[2],w[1]];

/** Point at the city. Marches a screen ray through the navigation world rather than the render
 * scene, so the answer is whatever the walker could actually reach, and re-renders only the card -
 * it never touches the engine, the render signature or shadowDirty. */
export class InspectUI {
 constructor(engine,hooks){
  this.engine=engine;this.hooks=hooks;this.hit=null;this.last=0;
  this.canvas=document.querySelector('#world');
  this.panel=document.querySelector('#inspect-panel');
  this.body=document.querySelector('#inspect-body');
  this.story=hooks.story??null;
  if(!this.panel)return;
  const nav=engine.data.navigation,eco=engine.data.ecology;
  this.ctx={boats:engine.life.boats,people:engine.life.crowdActors??[],landmarks:nav.landmarks,docks:eco.docks,
   water:engine.life.config.water,instances:new Map(nav.instances.map(i=>[i.name,i])),prefabs:nav.prefabs,
   // The generated portrait reads these two name tables, and only these - the model is told what
   // the data asserts and nothing else, so it cannot invent a shop the scene does not contain.
   routes:new Map((eco.routes||[]).map(r=>[r.id,r.name])),
   docksById:new Map((eco.docks||[]).map(d=>[d.id,d.name]))};
  document.querySelector('#inspect-close').onclick=()=>this.close();
  // An open card is described in whatever language is current, so a switch has to re-render it.
  // applyLang fires this twice per toggle, and the generated portrait must not spend money on a
  // language switch either - offer() only calls the API on a cache miss, and zh/en are separate
  // keys, so switching shows the "no key" or cached state rather than auto-generating.
  onLang(()=>this.show(this.hit));
  this.down=null;
  // A tap, not a drag: app.js owns the orbit/fly gesture on the same canvas, so a click is only a
  // click if the pointer barely moved and was never a second finger.
  this.canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.down={id:e.pointerId,x:e.clientX,y:e.clientY,moved:0};});
  this.canvas.addEventListener('pointermove',e=>{if(this.down&&this.down.id===e.pointerId)this.down.moved=Math.max(this.down.moved,Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y));});
  this.canvas.addEventListener('pointerup',e=>{const d=this.down;this.down=null;if(!d||d.id!==e.pointerId||d.moved>6)return;this.openAt(e.clientX,e.clientY);});
  this.canvas.addEventListener('pointercancel',()=>{this.down=null;});
 }
 // Walk mode aims down the crosshair: under pointer lock the cursor has no position to read, and
 // "what I am looking at" is the question being asked either way.
 aim(x,y){const locked=this.hooks.mode()==='walk';return locked?[window.innerWidth/2,window.innerHeight/2]:[x,y];}
 rayAt(x,y){
  const c=this.hooks.camera(),w=c&&c.eye&&c.target;
  if(!w)return null;
  const f=V.norm(V.sub(c.target,c.eye));
  if(!f[0]&&!f[1]&&!f[2])return null;
  const r=V.norm(V.cross(f,Math.abs(f[1])>.99?[0,0,1]:[0,1,0])),u=V.cross(r,f);
  const rect=this.canvas.getBoundingClientRect(),t=Math.tan((c.fov??49)*Math.PI/360);
  const nx=((x-rect.left)/rect.width)*2-1,ny=-(((y-rect.top)/rect.height)*2-1);
  return{origin:toNav(c.eye),dir:toNav(V.norm(V.add(f,V.add(V.scale(r,nx*t*rect.width/rect.height),V.scale(u,ny*t)))))};
 }
 openAt(x,y){
  const [ax,ay]=this.aim(x,y),ray=this.rayAt(ax,ay);
  if(!ray)return;
  // Convoy hulls move every step, so the OBBs are rebuilt per click rather than cached.
  this.ctx.boxes=this.engine.life.convoys.flatMap(v=>this.engine.life.convoyBoxes(v));
  const hit=pick(this.engine.navigation,ray.origin,ray.dir,this.ctx);
  // A click on empty sky would otherwise be indistinguishable from a click that did nothing.
  if(!hit){this.close();this.hooks.toast(t('inspectMiss'));return;}
  // A click is the only thing that may spend money. show() also runs from the 350ms tick and from
  // the language toggle, and neither of those should fire a request for a person already read.
  this.fresh=true;
  this.show(hit);
 }
 show(hit){
  this.hit=hit;
  if(!hit){this.close();return;}
  const d=describe(hit,this.ctx);
  document.querySelector('#inspect-overline').textContent=d.overline;
  document.querySelector('#inspect-title').textContent=d.title;
  this.body.innerHTML=d.rows.map(([k,v])=>`<div class="inspect-row"><span>${k}</span><b>${v}</b></div>`).join('');
  this.panel.classList.add('open');
  // Fired and forgotten: show() is on the 350ms render tick, so awaiting here would stall the card
  // behind a 20-60s model call. offer() is idempotent, which is what makes calling it here safe.
  // `fresh` is consumed here, so only the click that opened the card can reach the API - a later
  // language switch or 350ms tick re-renders from cache or shows the prompt instead.
  const fresh=this.fresh;this.fresh=false;
  if(this.story&&hit.kind==='person')this.story.offer(hit,this.ctx,fresh).catch(()=>{});else this.story?.clear();
 }
 close(){this.hit=null;this.fresh=false;this.story?.clear();this.panel?.classList.remove('open');}
 /** Re-render the open card from the same hit so a boat's speed and a porter's activity stay
  *  current. Pure DOM on the 350ms cadence the traffic panel already uses. */
 update(){
  if(!this.hit||!this.panel.classList.contains('open'))return;
  const now=performance.now();if(now-this.last<350)return;this.last=now;
  this.show(this.hit);
 }
}

/** Numbers carry their unit through the same pair table, so "0.28 m" and "0.28 米" both come out
 *  of one call. The English-only sentence-case helper is gone: it had nothing to do in Chinese. */
const unit=(key,v,d=2)=>Number(v).toFixed(d)+t(key);

function describe(hit,ctx){
 switch(hit.kind){
  case 'water':{const w=ctx.water,underway=ctx.boats.filter(b=>b.speedNow>.05).length;
   return{overline:t('olRiver'),title:t('waterTitle'),rows:[
    [t('rSurface'),unit('suffixM',w.level)],[t('rCurrent'),unit('suffixMS',w.current)],
    [t('rSwell'),t('suffixPct',Math.round(w.waveStrength*100))],[t('rWake'),w.wakeLife+t('suffixFrames')],
    [t('rUnderway'),underway+t('suffixOf')+ctx.boats.length]]};}
  case 'boat':{const b=hit.boat,dock=b.dock&&ctx.docks.find(d=>d.id===b.dock);
   // b.name is `Vessel_02_Cargo_barge` - an asset instance id, not a vessel name. The number is
   // what the traffic panel already calls this boat, so that is what the card shows.
   return{overline:t('olTraffic'),title:E(b.type),rows:[
    [t('rVessel'),t('vesselNo',b.id+1)],[t('rState'),T(b.state)],[t('rSpeed'),unit('suffixMS',b.speedNow)],
    [t('rCargo'),b.cargo+t('suffixUnit')],[t('rQuay'),dock?T(dock.name):t('passingThrough')],
    [t('rMast'),E(b.rigClearancePolicy||'—')],
    [t('rClearance'),t('mastSamples',b.clearanceSamples,b.clearanceFailures)]]};}
  case 'convoy':{const v=hit.convoy;
   return{overline:t('olFreight'),title:t('convoyTitle',v.id+1),rows:[
    [t('rCart'),asset(v.cart)],[t('rAnimal'),asset(v.animal)],[t('rState'),T(v.state)],[t('rSpeed'),unit('suffixMS',v.speedNow)],
    [t('rCargo'),v.cargo+t('suffixUnit')],[t('rDepot'),t('warehouse',v.station)],[t('rDistance'),unit('suffixKm',v.distance/1000)]]};}
  case 'person':{const plan=hit.lifePlan??{},crew=plan.mode==='crew';
   // No Name row: every citizen's `name` is a placement id (Person_merchant_0__0674), never a
   // personal name, so the field only ever printed a mesh id under a "Name" heading.
   return{overline:t(crew?'olCrew':'olStreet'),title:plan.role?E(plan.role):t('citizen'),rows:[
    [t('rOccupation'),plan.role?E(plan.role):t('citizen')],[t('rPosition'),plan.mode?E(plan.mode):t('citizen')],
    [t('rActivity'),hit.state?T(hit.state):t('standing')],
    [t('rGesture'),E(plan.clip||'Idle')]]};}
  case 'room':{const b=hit.building,room=hit.room;
   return{overline:(hit.district?district(hit.district):t('olBuilding')).toUpperCase(),
    title:room?T(room.name):T(b.name),rows:[
    [room?t('rBuilding'):t('rPrecinct'),T(b.name)],[t('rStoreys'),String(b.stories)],
    [t('rFloor'),room?t(room.storey>4?'walkUp':'walkDown'):'—'],
    [t('rDistrict'),district(hit.district)||'—']]};}
  case 'door':{const d=hit.door;
   return{overline:t('olDoor'),title:T(d.mo.label),rows:[
    [t('rState'),t(hit.open?'doorOpen':'doorClosed')],[t('rBuilding'),T(d.a.name)],[t('pressKey'),'E']]};}
  case 'landmark':return{overline:t('olLand'),title:T(hit.landmark.name),rows:[
    [t('rEnterable'),t(hit.landmark.inside?'enterYes':'enterNo')],[t('rGround'),unit('suffixM',hit.point[2])],
    [t('walkHere'),t('walkHereSec')]]};
  default:{const s=hit.surface,plain=s==='bridge'||s==='stairs'||s==='ground';
   // A tag that is neither ground, bridge nor stairs is the instance that owns the floor, so name
   // the building rather than leaking a mesh id into the card. The three plain tags are ids too -
   // the row printed the raw word 'bridge' before - so each needs its own label.
   const inst=plain?null:ctx.instances.get(s),kind=inst?ctx.prefabs?.[inst.prefab]?.kind:null;
   const SURFACE={ground:'surfPlain',bridge:'surfBridgeDeck',stairs:'surfStairRun'};
   return{overline:t('olTerrain'),title:s==='bridge'?t('surfBridge'):s==='stairs'?t('surfStairs'):s==='ground'?t('surfStreet'):kind?T(kind):t('surfThreshold'),
    rows:[[t('rSurfaceKind'),plain?t(SURFACE[s]||'surfStreet'):t('surfFloor')],[t('rGround'),unit('suffixM',hit.point[2])],
     ...(inst?[[t('rDistrict'),district(inst.district)||'—']]:[])]};}
 }
}
