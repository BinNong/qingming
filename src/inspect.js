import {V,pick,personHit} from './simulation.js';
import {t,T,E,district,asset,onLang} from './i18n.js';
import {portraitable,placeFacts} from './ai-story.js';

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
   // The generated portrait reads these two name tables - the model is told what the data asserts
   // and nothing else, so it cannot invent a shop the scene does not contain. rooms[] gives it the
   // trade of the building a figure is standing by; each record's name is already the authored
   // kind, and its owner is an instance name that must stay out of the prompt.
   rooms:engine.navigation.rooms,
   routes:new Map((eco.routes||[]).map(r=>[r.id,r.name])),
   docksById:new Map((eco.docks||[]).map(d=>[d.id,d.name])),
   // Which named routes run over the bridge deck, and what kind of traffic each is. A control
   // point above z=4 is on the arch and nowhere else in the city, so this is the whole crossing
   // list without hard-coding a single route id: a new one added to ecology.json is picked up for
   // free. The kinds matter as much as the names - a bridge with no fact about who uses it is a
   // gap the model fills with whatever it expects to be on a bridge.
   bridgeRoutes:(eco.routes||[]).map(r=>({name:r.name,kind:r.kind,over:(r.points||[]).some(p=>p[2]>4)})),
   // The arch profile, so a bridge portrait can say whether the reader is at the crown or on the
   // slope. This is derived geometry rather than authored, but it is the deck under the cursor.
   bridgeHeight:y=>engine.navigation.bridgeHeight(y)};
  document.querySelector('#inspect-close').onclick=()=>this.close();
  // The cursor readout. It answers "what is under the cursor" without a click, which is the only
  // way this scroll is browsable - 584 figures are spread along it, and the location facts that
  // make a person legible (nearby shop, landmark) are otherwise visible only after paying for a
  // portrait. `seen` is set by a pointermove and only records coordinates; all the work is in
  // probe(), which is rate-limited because pick() is not cheap (see there).
  this.hover={node:document.querySelector('#hover-readout'),x:0,y:0,seen:false,last:-1e9,text:'',
   lastX:-1,lastY:-1,w:0,h2:0,cam:null};
  this.canvas.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse')return;this.hover.x=e.clientX;this.hover.y=e.clientY;this.hover.seen=true;});
  this.canvas.addEventListener('pointerleave',()=>{this.hover.seen=false;this.hideHover();});
  // Following one figure. The button is a SIBLING of #inspect-body, not a row inside it, because
  // show() rewrites that node wholesale every 350ms. this.followActor is the live subject: while it
  // is set, update() rebuilds the hit from the actor each tick instead of reusing the clicked one,
  // so the facts track the figure as he walks. It is null for a figure CityEcology does not move.
  this.followActor=null;
  this.followRow=document.querySelector('#inspect-follow');
  this.followBtn=document.querySelector('#follow-person');
  if(this.followBtn)this.followBtn.onclick=()=>{
   if(this.followActor?.life&&this.hooks.isFollowing?.()){this.unfollow();this.show(this.hit);return;}
   if(!followable(this.hit))return;
   this.followActor=this.hit.person;this.hooks.onFollowPerson?.(this.hit.person.id);
   this.show(this.hit);};
  // An open card is described in whatever language is current, so a switch has to re-render it.
  // applyLang fires this twice per toggle, and the generated portrait must not spend money on a
  // language switch either - offer() never calls the API on its own, so switching just re-renders
  // the cached state or the 写照 prompt under the other language's key. The readout's own text is
  // cleared so the next probe rewrites it: a cached string would keep the old language on screen.
  onLang(()=>{this.hover.text='';this.hover.w=0;this.show(this.hit);});
  this.down=null;
  // A tap, not a drag: app.js owns the orbit/fly gesture on the same canvas, so a click is only a
  // click if the pointer barely moved and was never a second finger.
  this.canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.down={id:e.pointerId,x:e.clientX,y:e.clientY,moved:0};});
  this.canvas.addEventListener('pointermove',e=>{if(this.down&&this.down.id===e.pointerId)this.down.moved=Math.max(this.down.moved,Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y));});
  this.canvas.addEventListener('pointerup',e=>{const d=this.down;this.down=null;if(!d||d.id!==e.pointerId||d.moved>6)return;this.openAt(e.clientX,e.clientY);});
  this.canvas.addEventListener('pointercancel',()=>{this.down=null;});
 }
 /** Where the reader actually pointed. The cursor stops reporting a position only while the
  *  pointer is locked, so that - not walk mode - is what decides: a walk-mode reader who has not
  *  pressed F is clicking a figure under a visible cursor, and honouring the crosshair there put
  *  the ray through the middle of the screen instead of the thing they clicked. */
 aim(x,y){return document.pointerLockElement?[window.innerWidth/2,window.innerHeight/2]:[x,y];}
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
  // Convoy hulls move every step, so the OBBs are rebuilt per click rather than cached. The hour
  // is stamped here too, and deliberately NOT on the 350ms tick: the portrait describes the moment
  // the reader clicked, so it should not drift under them, and AIStoryUI freezes this.current.facts
  // on the same click anyway - re-stamping later would let the hour and the place come from
  // different instants. Moving the slider and clicking again gets a new hour, and a new cache key.
  this.ctx.boxes=this.engine.life.convoys.flatMap(v=>this.engine.life.convoyBoxes(v));
  this.ctx.hour=this.engine.sunHour;
  // Pointing at anything new ends a follow. Leaving the camera locked to one figure while the card
  // describes another is a state nobody asked for, and the reader has no way back to it.
  this.unfollow();
  const hit=pick(this.engine.navigation,ray.origin,ray.dir,this.ctx);
  // A click on empty sky would otherwise be indistinguishable from a click that did nothing.
  if(!hit){this.close();this.hooks.toast(t('inspectMiss'));return;}
  this.show(hit);
 }
 show(hit,hold){
  this.hit=hit;
  if(!hit){this.close();return;}
  const d=describe(hit,this.ctx);
  document.querySelector('#inspect-overline').textContent=d.overline;
  document.querySelector('#inspect-title').textContent=d.title;
  this.body.innerHTML=d.rows.map(([k,v])=>`<div class="inspect-row"><span>${k}</span><b>${v}</b></div>`).join('');
  this.panel.classList.add('open');
  // The follow button is offered only to a figure CityEcology actually moves - 219 of the 584, the
  // travellers and porters. The other 365 are residents, shopkeepers, seated figures and boat
  // crew; a follow button on a figure that never moves reads as a broken button, not an absent one.
  // actor.life is the test, NOT actor.walk: attachPeople clears walk on every planned actor, so
  // walk is false for all 584 and would make this button never appear.
  // The lit state reads the ecology panel's own follow rather than this.followActor. Those two can
  // disagree - 自由视角 in that panel stops the camera without ever touching this object - and a
  // button claiming to stop a follow that has already stopped is worse than no button.
  const on=!!(this.followActor?.life&&this.hooks.isFollowing?.());
  if(this.followRow){this.followRow.hidden=!followable(hit);
   this.followRow.classList.toggle('on',on);
   this.followBtn.textContent=t(on?'btnUnfollow':'btnFollowPerson');}
  // Fired and forgotten: show() is on the 350ms render tick, so awaiting here would stall the card
  // behind a 20-60s model call. offer() is idempotent and never spends on its own - the reader's
  // 写照 button is the only path that fires a request, so a tick or a language switch is safe.
  // portraitable() is the same list ai-story.js writes facts for; a card whose kind is not on it
  // gets no AI block rather than one built from defaults.
  // `hold` skips it while following. offer()'s key carries the figure's state, so a porter walking
  // would re-key on every 取货/往来/搬货 change and wipe a portrait the reader already paid for.
  if(hold)return;
  if(this.story&&portraitable(hit))this.story.offer(hit,this.ctx).catch(()=>{});else this.story?.clear();
 }
 close(){this.hit=null;this.unfollow();this.story?.clear();this.panel?.classList.remove('open');}
 /** Drop the follow. Any new click also does this, via openAt: following one figure while the
  *  card shows another is a state nobody asked for. */
 unfollow(){if(!this.followActor)return;this.followActor=null;this.hooks.onStopFollow?.();}
 hideHover(){const h=this.hover;if(!h?.node)return;if(h.text){h.text='';h.node.textContent='';}if(!h.node.hidden)h.node.hidden=true;}
 /** Where the readout sits: beside the cursor, flipped in rather than pushed off the viewport when
  *  either edge would clip it. Measured only when the text changes, because a hidden element
  *  measures 0 and the first placement has to happen after the unhide - both happen in one task,
  *  so the browser paints it once, already in the right place. */
 placeHover(x,y){
  const h=this.hover;if(!h.w){const r=h.node.getBoundingClientRect();h.w=r.width;h.h2=r.height;}
  h.node.style.left=(x+18+h.w>innerWidth?x-18-h.w:x+18)+'px';
  h.node.style.top=(y+14+h.h2>innerHeight?y-14-h.h2:y+14)+'px';}
 /** Ask what is under the cursor. Rate-limited rather than optimised, because pick() has no cheap
  *  version: measured against the real world the default costs 3.6ms on average and 11ms on a ray
  *  that hits nothing, and 98% of that is the march - 0.0124ms per step over up to 680 steps of
  *  discrete volume samples against 475 rooms and 584 people. Coarsening `step` to halve it drops
  *  agreement with a normal click from 100% to 21%, so the only safe knob is `max`. Capped to 70m
  *  and gated at 12Hz this measures median 2.1ms, p95 4-9ms, plus a GC tail from pick() rebuilding
  *  its 475-entry solids array every call; a still cursor costs nothing at all. The real fix is a
  *  spatial index over rooms[] and that touches shared collision, so it has not been done.
  *  Never probed under pointer lock: a locked pointer is a crosshair, not a cursor, and its own
  *  click already resolves through aim(). Re-probed on camera movement as well as cursor movement,
  *  or a flight with a still cursor would keep naming whatever it passed over. */
 probe(){
  const h=this.hover;if(!h?.node)return;
  if(!h.seen||document.pointerLockElement){this.hideHover();return;}
  const now=performance.now(),c=this.hooks.camera();
  if(!c?.eye||!c.target)return;
  if(now-h.last<83)return;
  const cam=[c.eye[0],c.eye[1],c.eye[2],c.target[0],c.target[1],c.target[2]];
  if(h.x===h.lastX&&h.y===h.lastY&&h.cam&&h.cam.every((v,i)=>v===cam[i]))return;
  h.last=now;h.lastX=h.x;h.lastY=h.y;h.cam=cam;
  const ray=this.rayAt(h.x,h.y);if(!ray){this.hideHover();return;}
  // this.ctx, not a copy with a tighter max. The cap was 70m to halve the cost, and it made the
  // readout dead in the default view: the overview camera sits 116-152m from the whole cast, so
  // every figure was past the cap and nothing ever appeared. A ray that finds something stops at
  // the hit, so range only costs on a MISS - 3.5ms against 1.7ms - and 12Hz of that is ~4% of a
  // frame, which is the honest number.
  // The copy carries fresh convoy boxes. ctx.boxes is stamped in openAt() and deliberately frozen
  // there, so the portrait describes the moment of the click; the carts themselves keep moving every
  // 1/30s, so probing against that stamp reports where a cart was when you last clicked. Nine
  // convoys at 12Hz is not a cost worth trading a correct answer for.
  const live={...this.ctx,boxes:this.engine.life.convoys.flatMap(v=>this.engine.life.convoyBoxes(v))};
  const hit=pick(this.engine.navigation,ray.origin,ray.dir,live);
  const seg=hoverLine(hit,this.ctx);
  if(!seg||!seg.length){this.hideHover();return;}
  const text=seg.join(' · ');
  // textContent, not innerHTML: these are already-resolved values, so no markup is needed, and
  // the only value that must never reach innerHTML in this file is model output.
  if(text!==h.text){h.node.textContent=text;h.text=text;h.w=0;}
  h.node.hidden=false;this.placeHover(h.x,h.y);}
 /** Re-render the open card from the same hit so a boat's speed and a porter's activity stay
  *  current. Pure DOM on the 350ms cadence the traffic panel already uses. The cursor readout runs
  *  on the same call because app.js already invokes update() once per frame, ahead of the render,
  *  so a probe costs nothing to schedule and its result lands in the frame it was taken in. */
 update(){
  this.probe();
  if(!this.hit||!this.panel.classList.contains('open'))return;
  const now=performance.now();if(now-this.last<350)return;this.last=now;
  // While following, the hit is rebuilt from the actor rather than reused, so the facts describe
  // where he is now: placeFacts() re-runs against his new position, which is the whole point - a
  // porter walking from the cloth shop to the teahouse sees 近旁 change under the reader's eyes.
  // personHit() is the same constructor pick() uses, exported for this. hold=true keeps the
  // portrait the reader already paid for; the rows above it keep moving.
  if(this.followActor?.life&&this.hooks.isFollowing?.()){this.hit=personHit(this.followActor,[...this.followActor.p],0);this.show(this.hit,true);return;}
  this.show(this.hit);
 }
}

/** Numbers carry their unit through the same pair table, so "0.28 m" and "0.28 米" both come out
 *  of one call. The English-only sentence-case helper is gone: it had nothing to do in Chinese. */
const unit=(key,v,d=2)=>Number(v).toFixed(d)+t(key);

/** The trade of the building a point stands in. This is placeFacts(), not a nearest-room search:
 *  rooms[] carries name = the authored kind, and standing inside one is a test (standsAt), not a
 *  distance. A centre-distance search puts the nearest shop's trade under 建筑 for a door thirty
 *  metres from anything, and the room it names may be on another storey entirely. Returns '' when
 *  the point is in the open, which drops the row rather than inventing one. */
const tradeNear=(ctx,p)=>p?placeFacts(p,ctx).building||'':'';

/** Whether the follow button is offered for this hit. `actor.life` and not `actor.walk`: the 25
 *  instances authored with motion.kind==='walk' are all travellers or porters, and attachPeople
 *  sets walk=false on every planned actor before handing it to CityEcology - so across all 584
 *  figures actor.walk is false and testing on it would hide the button for everyone. 219 citizens
 *  carry actor.life; the other 365 never move. Exported so the count is pinned against the real
 *  ecology.json rather than against a fixture. */
export const followable=hit=>hit?.kind==='person'&&!!hit.person?.life;

/** What the cursor is over, as already-resolved segments, or null when there is nothing to say.
 *  The subject list is deliberately portraitable() - the same one the 为其写照 block uses - so
 *  hovering is how a reader learns that the thing under the cursor can be written about at all.
 *  Until now that button was invisible until you happened to click someone.
 *
 *  The segments are chosen for discrimination, not for completeness. Measured over all 584
 *  citizens, 行当 alone yields 10 distinct readings with 126 people sharing one; adding the
 *  location yields 107, with 33 women all reading 妇人 · 近旁：厢房. Adding the live posture is
 *  what makes it a readout: 359 distinct, largest group 7. Two figures standing at the same shop
 *  are indistinguishable by trade and place, and separated by whether one is standing or walking -
 *  which is also the only one of the three that keeps changing while the city runs. (359 is
 *  counted across a spread of posture states, not at one instant; posture rotates, so any single
 *  instant is one slice of it.)
 *
 *  The bridge gets one word and nothing else. Its remaining facts are prompt-only Chinese by
 *  design - a half-translated line is worse than no line. Everything else returns null rather than
 *  a restatement of the card the reader is about to open by clicking anyway. */
export function hoverLine(hit,ctx){
 if(!portraitable(hit))return null;
 if(hit.kind==='surface')return[t('surfBridge')];
 if(hit.kind==='boat'){const b=hit.boat;return b?[E(b.type),T(b.state)].filter(Boolean):null;}
 const plan=hit.lifePlan??{},seg=[plan.role?E(plan.role):t('citizen')];
 // placeFacts, not a second nearest-building search: the 12m/3m gate is the same one the prompt
 // gets, and two implementations of a spatial rule is how a shop ends up 24m away in one of them.
 const p=hit.person?.p||hit.point;
 if(Array.isArray(p)){const f=placeFacts(p,ctx);
  // Never both. 13 of the 16 landmarks are shop names, so without this a figure standing at a
  // teahouse would be told about the teahouse twice on one line.
  if(f.building)seg.push(t('hNear')+T(f.building));else if(f.place)seg.push(t('hPlace')+T(f.place));}
 const clip=hit.person?.clip||plan.clip;
 if(clip)seg.push(t('hPose')+E(clip));
 return seg;}

/** Exported for tests/inspect-card.mjs. It is already a pure function of (hit, ctx) - the same
 *  reason simulation.js exports pick() and ai-story.js exports factsFor() - so the card text can
 *  be asserted in Node without a DOM. */
export function describe(hit,ctx){
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
    // The live clip, not the authored one: `plan.clip` is the placement default, so a porter
    // hauling cargo across a quay read 静立 forever, and Walk/Carry - the only two clips that
    // carry any motion in the city - were unreachable from a card. personHit() already carries
    // the actor, so the live value was there and unread.
    [t('rGesture'),E(hit.person?.clip||plan.clip||'Idle')]]};}
  case 'room':{const b=hit.building,room=hit.room;
   return{overline:(hit.district?district(hit.district):t('olBuilding')).toUpperCase(),
    title:room?T(room.name):T(b.name),rows:[
    [room?t('rBuilding'):t('rPrecinct'),T(b.name)],[t('rStoreys'),String(b.stories)],
    [t('rFloor'),room?t(room.storey>4?'walkUp':'walkDown'):'—'],
    [t('rDistrict'),district(hit.district)||'—']]};}
  case 'door':{const d=hit.door;
   // The building row used to print d.a.name, which is the door's own asset id - `Door_Shop_00_1`
   // under a 建筑 heading, in both languages, because english() has no row for it. That is the same
   // defect class as the Handcart__0912 leak, so the trade comes from the building the door stands
   // in - tested by standsAt, so a door out on the street reports nothing instead of a neighbour.
   // hit.point, not d.box: the march's z is the height the reader actually hit the door at, which
   // is what the storey test needs, and a box with no `lo` in it makes that test pass on NaN.
   const near=tradeNear(ctx,hit.point??(d.box?[d.box.x,d.box.y,d.box.lo]:null));
   return{overline:t('olDoor'),title:T(d.mo.label),rows:[
    [t('rState'),t(hit.open?'doorOpen':'doorClosed')],...(near?[[t('rBuilding'),T(near)]]:[]),
    [t('pressKey'),'E']]};}
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
