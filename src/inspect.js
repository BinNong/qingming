import {V,pick} from './simulation.js';
import {english} from './english.js';

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
  if(!this.panel)return;
  const nav=engine.data.navigation;
  this.ctx={boats:engine.life.boats,people:engine.life.crowdActors??[],landmarks:nav.landmarks,docks:engine.data.ecology.docks,
   water:engine.life.config.water,instances:new Map(nav.instances.map(i=>[i.name,i])),prefabs:nav.prefabs};
  document.querySelector('#inspect-close').onclick=()=>this.close();
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
  if(!hit){this.close();this.hooks.toast('Nothing there — click the street, the water, a boat or a person.');return;}
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
 }
 close(){this.hit=null;this.panel?.classList.remove('open');}
 /** Re-render the open card from the same hit so a boat's speed and a porter's activity stay
  *  current. Pure DOM on the 350ms cadence the traffic panel already uses. */
 update(){
  if(!this.hit||!this.panel.classList.contains('open'))return;
  const now=performance.now();if(now-this.last<350)return;this.last=now;
  this.show(this.hit);
 }
}

const title=s=>s.charAt(0).toUpperCase()+s.slice(1);
const num=(v,d=1)=>Number(v).toFixed(d);
/** District ids are authored as `04_Riverside_commerce`; show the readable half. */
const district=d=>d?d.replace(/^\d+_/,'').replace(/_/g,' '):null;

function describe(hit,ctx){
 switch(hit.kind){
  case 'water':{const w=ctx.water,underway=ctx.boats.filter(b=>b.speedNow>.05).length;
   return{overline:'THE RIVER',title:'Bianjing Water',rows:[
    ['Surface level',`${num(w.level,2)} m`],['Current',`${num(w.current,2)} m/s`],
    ['Swell',`${Math.round(w.waveStrength*100)}% of full`],['Wake memory',`${w.wakeLife} frames`],
    ['Vessels under way',`${underway} of ${ctx.boats.length}`]]};}
  case 'boat':{const b=hit.boat,dock=b.dock&&ctx.docks.find(d=>d.id===b.dock);
   return{overline:'RIVER TRAFFIC',title:english(b.type),rows:[
    ['Vessel',english(b.name)],['State',english(b.state)],['Speed',`${num(b.speedNow,2)} m/s`],
    ['Cargo',`${b.cargo} units`],['Quay',dock?english(dock.name):'Passing through'],
    ['Mast clearance',english(b.rigClearancePolicy||'—')],
    ['Clearance checks',`${b.clearanceSamples} sampled · ${b.clearanceFailures} failed`]]};}
  case 'convoy':{const v=hit.convoy;
   return{overline:'ROAD FREIGHT',title:`Convoy ${v.id+1}`,rows:[
    ['Cart',v.cart],['Animal',v.animal],['State',english(v.state)],['Speed',`${num(v.speedNow,2)} m/s`],
    ['Cargo',`${v.cargo} units`],['Depot',`Warehouse ${v.station}`],['Distance',`${num(v.distance/1000,2)} km`]]};}
  case 'person':{const plan=hit.lifePlan??{},mode=plan.mode==='crew'?'RIVER CREW':'STREET LIFE';
   return{overline:mode,title:title(plan.role||'Citizen'),rows:[
    ['Occupation',title(plan.role||'—')],['Role',title(plan.mode||'—')],
    ['Activity',hit.state?english(hit.state):'Standing'],
    ['Gesture',title(plan.clip||'Idle')],['Name',plan.name||'—']]};}
  case 'room':{const b=hit.building,room=hit.room;
   return{overline:hit.district?district(hit.district).toUpperCase():'BUILDING',
    title:room?english(room.name):english(b.name),rows:[
    [room?'Building':'Precinct',english(b.name)],['Storeys',String(b.stories)],
    ['Floor',room?title(room.storey>4?'upper storey':'ground floor'):'—'],
    ['District',district(hit.district)||'—']]};}
  case 'door':{const d=hit.door;
   return{overline:'DOOR',title:title(english(d.mo.label)),rows:[
    ['State',hit.open?'Open':'Closed'],['Building',english(d.a.name)],['Handle','E']]};}
  case 'landmark':return{overline:'LANDMARK',title:english(hit.landmark.name),rows:[
    ['Enterable',hit.landmark.inside?'Yes — walk in from the street':'Viewpoint only'],
    ['Ground level',`${num(hit.point[2],2)} m`],['Walk here','Scene workshop ▸ Enter location']]};
  default:{const s=hit.surface,plain=s==='bridge'||s==='stairs'||s==='ground';
   // A tag that is neither ground, bridge nor stairs is the instance that owns the floor, so name
   // the building rather than leaking a mesh id into the card.
   const inst=plain?null:ctx.instances.get(s),kind=inst?ctx.prefabs?.[inst.prefab]?.kind:null;
   return{overline:'TERRAIN',title:s==='bridge'?'Hongqiao bridge':s==='stairs'?'Stairs':s==='ground'?'Street':kind?english(kind):'Threshold',
    rows:[['Surface',plain?(s==='ground'?'Street level':s):'Building floor'],['Ground level',`${num(hit.point[2],2)} m`],
     ...(inst?[['District',district(inst.district)||'—']]:[])]};}
 }
}
