import {t,T,E,onLang} from './i18n.js';
import {followForward} from './simulation.js';
/** How many distinct paths the authored routes collapse onto. Five vessels share one channel and
 *  three share another, so 25 records draw as 19 lines: 8 pedestrian, 4 porter, 1 convoy and 6
 *  river channels carrying all 12 vessels. The key is x and y only, never z: the map is a plan
 *  projection, so two channels at different heights would be the same line to the reader and
 *  counting them apart would invent a channel that is not on screen. */
const chainKey=r=>JSON.stringify(r.points.map(p=>[+p[0].toFixed(2),+p[1].toFixed(2)]));
const chainsOf=routes=>{const seen=new Map();
 for(const r of routes){const k=chainKey(r);if(!seen.has(k))seen.set(k,[]);seen.get(k).push(r);}
 return [...seen.values()];};

/** The map's stroke colours, shared by the canvas and the key so the two cannot drift apart. */
export const TINT={boat:'#2b7d85',caravan:'#a46533',porter:'#aa774d',pedestrian:'#707b60'};

/** The map key, as rows ready to render. Grouped by kind because the names within a group repeat -
 *  four porters are all "货埠N装卸路线", twelve vessels are five channels - and listing the records
 *  one by one would say the same thing nine times. `chains` and `records` differ for vessels and
 *  agree for everything else, so both are returned rather than one number standing in for both.
 *  Exported so the grouping is asserted against the real ecology.json rather than eyeballed. */
export function legendRows(routes){
 const chains=chainsOf(routes),rows=[];
 for(const [kind,label] of [['pedestrian','legendPeople'],['porter','legendPorters'],['caravan','legendConvoy'],['boat','legendBoats']]){
  const group=chains.filter(c=>c[0].kind===kind);if(!group.length)continue;
  const records=group.flat(),names=[...new Set(records.map(r=>T(r.name)))];
  // The six river channels are 16 world-units tall, about 17px on a 320px map, so they cannot be
  // told apart on screen and one of their names apiece would be noise. Their vessel types are the
  // useful part, and E() is right here: the leading token of a boat route is an authored enum.
  if(kind==='boat'){const types={};for(const r of records){const ty=E(r.name.split(' ')[0]);types[ty]=(types[ty]||0)+1;}
   names.length=0;names.push(Object.entries(types).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .map(([k,v])=>`${k} ${t('legendCount',v).trim()}`).join(' · '));}
  rows.push({kind,head:t(label),records:records.length,chains:group.length,names});}
 return rows;}

/** The ledger's measured counters, as rows ready to render. Only counters that were observed to
 *  move, and only the ones #life-ledger does not already show: it prints 卸货 (transferred), 入仓
 *  (the sum of dock.delivered - what porters bring in) and 送达 (stats.delivered - what convoys
 *  hand to the shops). Listing those again put two numbers on one panel under the same word with
 *  different meanings, and measured live that is exactly what happened: 入仓 0 in the ledger and
 *  入仓 16 here, 250px apart, because stats.delivered and sum(dock.delivered) are different
 *  quantities. So this adds only berthVisits, consumed, the two distances and the population split.
 *  Over 1200 simulated seconds boatNearMisses, groundBlocks and personReplans never fired once and
 *  boatOverlaps has no increment site at all, so showing them would print a 0 that reads as "no
 *  collisions ever happened" when it means "that branch is unreachable" - a safety conclusion the
 *  code cannot support. `steps` is excluded for the opposite reason: it is seconds times 30. */
export function statRows(life){
 const s=life.stats||{},metres=v=>v>=1000?(v/1000).toFixed(1)+t('suffixKm'):Math.round(v)+t('suffixM');
 return [
  {head:t('stFreight'),rows:[[t('stBerths'),String(s.berthVisits??0)],[t('stConsumed'),(s.consumed??0)+t('suffixUnit')]]},
  {head:t('stJourney'),rows:[[t('stRiver'),metres(s.boatDistance??0)],[t('stLand'),metres(s.landDistance??0)]]},
  {head:t('stPeople'),rows:[[t('stMoving'),`${s.mobilePeople??0} · ${t('stStanding')} ${s.anchoredPeople??0}`]]}];
}

/** Live route inspection: the map reads the same paths/positions that drive geometry. */
export class EcologyUI {
 constructor(engine,hooks){this.engine=engine;this.hooks=hooks;this.follow=null;this.last=0;this.canvas=document.querySelector('#traffic-map');this.ctx=this.canvas.getContext('2d');const by=id=>document.getElementById(id);
  this.fillVessels=()=>{const sel=by('follow-vessel');sel.textContent='';for(const b of engine.life.boats){const op=document.createElement('option');op.value=b.id;op.textContent=`${String(b.id+1).padStart(2,'0')} · ${E(b.type)}`;sel.appendChild(op);}sel.value='11';};this.fillVessels();
  by('follow-boat').onclick=()=>this.startFollow('boat',+by('follow-vessel').value);by('follow-cart').onclick=()=>this.startFollow('cart',1);by('stop-follow').onclick=()=>this.stopFollow();by('map-button').onclick=()=>by('ecosystem-panel').classList.toggle('open');by('map-close').onclick=()=>by('ecosystem-panel').classList.remove('open');by('world-rate').onchange=e=>engine.life.rate=+e.target.value;by('water-strength').oninput=e=>{engine.river.strength=+e.target.value;by('water-strength-value').textContent=(+e.target.value).toFixed(1);};by('water-flow').oninput=e=>{engine.river.flow=+e.target.value;by('water-flow-value').textContent=(+e.target.value).toFixed(2)+t('suffixMS');};by('wake-debug').onchange=e=>engine.river.debug=e.target.checked?1:0;by('routes-3d').onchange=e=>engine.showRoutes=e.target.checked;
  // The vessel picker and the status line are both built here, so a switch has to refill them.
  onLang(()=>{this.fillVessels();document.getElementById('follow-status').textContent=this.statusText();this.renderLegend();this.last=0;});
  this.renderMap();this.renderLegend();
 }
 startFollow(type,id){this.follow={type,id};this.hooks.onFollow();document.getElementById('follow-status').textContent=this.statusText();this.updateCamera(1,true);}
 /** The status line, in one place: onLang re-renders it and startFollow sets it, and a second
  *  copy of this ternary is how the person case ends up missing from the language toggle. */
 statusText(){if(!this.follow)return t('followDone');
  return this.follow.type==='boat'?t('followBoat'):this.follow.type==='person'?t('followPerson',this.followName()||''):t('followCart');}
 /** Who the follow status line names. A citizen's `name` is a placement id (Person_porter_3__0907),
  *  so the role is the only thing on that actor fit to put on screen. */
 followName(){const a=this.follow?.type==='person'?this.engine.life.crowdActors.find(x=>x.id===this.follow.id):null;return a?.lifePlan?.role?E(a.lifePlan.role):'';}
 stopFollow(){this.follow=null;document.getElementById('follow-status').textContent=t('followDone');}
 updateCamera(dt,snap=false){if(!this.follow)return;const f=this.follow,life=this.engine.life,obj=f.type==='boat'?life.boats.find(b=>b.id===f.id):f.type==='person'?life.crowdActors.find(a=>a.id===f.id):life.convoys.find(c=>c.id===f.id);if(!obj)return;let forward=followForward(f.type,obj.heading),p=obj.p;
  const isBoat=f.type==='boat',isPerson=f.type==='person',dist=isBoat?Math.max(8.5,obj.length*1.18):isPerson?2.9:8.5;
  // Keep the follower inside the river/road corridor. A fixed "right side"
  // camera used to pass straight through dock cranes and shop awnings.
  let side=isBoat?5.0:isPerson?0.95:2.4;
  if(isBoat){const candidates=[-side,side].map(s=>{const x=p[0]-forward[0]*dist+forward[1]*s,y=p[1]-forward[1]*dist-forward[0]*s;return {s,d:Math.abs(y-3.4*Math.sin(x/72.))};});side=candidates.sort((a,b)=>a.d-b.d)[0].s;}
  const eye=[p[0]-forward[0]*dist+forward[1]*side,p[1]-forward[1]*dist-forward[0]*side,p[2]+(isBoat?4.3:isPerson?1.62:4.5)];
  if(isBoat){const centre=3.4*Math.sin(eye[0]/72.);eye[1]=Math.max(centre-9.0,Math.min(centre+9.0,eye[1]));}
  // The corridor clamp belongs to the convoy and to nothing else. Convoys run one loop whose x
  // never leaves -3..3, so clamping there is free insurance. A person does not: the quay routes
  // span x -109..76, and clamping one put the camera 97m from a subject at x=-100, pinned at the
  // boundary while the figure walked 1.3m in plain sight. A camera that sometimes clips a wall is
  // better than one that is never near its subject. Boats keep the river-centreline dodge above.
  else if(!isPerson&&eye[1]>-42&&eye[1]<96){eye[0]=Math.max(-3.4,Math.min(3.4,eye[0]));}
  const target=[p[0]+forward[0]*1.0,p[1]+forward[1]*1.0,p[2]+(isPerson?1.5:.8)];this.hooks.followCamera(eye,target,snap?1:1-Math.exp(-dt*2.7),isPerson?46:54);
 }
 update(dt){this.updateCamera(dt);const now=performance.now();if(now-this.last<350)return;this.last=now;const l=this.engine.life,active=l.boats.filter(b=>b.speedNow>.04).length,carts=l.convoys.filter(c=>c.speedNow>.03).length,moving=l.people.filter(p=>p.speedNow>.05).length,sec=Math.floor(l.time),min=Math.floor(sec/60);document.getElementById('life-clock').textContent=`${String(min).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;document.getElementById('life-summary').textContent=t('lifeSummary',active,carts,moving);
  document.getElementById('life-ledger').textContent=t('lifeLedger',l.stats.transferred,l.docks.reduce((s,d)=>s+d.delivered,0),l.stats.delivered);
  document.getElementById('life-stats').innerHTML=statRows(l).map(g=>`<div class="stat-group"><p class="stat-head">${g.head}</p>${g.rows.map(([k,v])=>`<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>`).join('');
  document.getElementById('dock-status').innerHTML=l.docks.map(d=>`<div><span>${T(d.name)}</span><span>${t(d.occupant!==null?'dockLoad':d.reserved!==null?'dockReserved':'dockFree')} · ${t('dockCargo',d.inventory)}</span></div>`).join('');document.getElementById('traffic-events').innerHTML=l.events.slice(0,4).map(e=>`<div><time>${Math.floor(e.time/60)}:${String(Math.floor(e.time%60)).padStart(2,'0')}</time> ${T(e.text)}</div>`).join('')||`<div>${t('trafficEmpty')}</div>`;
  if(this.follow?.type==='boat'){const b=l.boats.find(b=>b.id===this.follow.id);document.getElementById('follow-status').textContent=t('boatStatus',b.id+1,T(b.state),b.speedNow.toFixed(2));}if(document.getElementById('ecosystem-panel').classList.contains('open'))this.renderMap();
 }
 /** The key under the map. Rebuilt on a language toggle, not on the 350ms tick: the route config
  *  never changes while the page is open, so re-rendering it three times a second would be pure
  *  DOM churn for a static list. */
 renderLegend(){const el=document.getElementById('route-legend');if(!el)return;
  el.innerHTML=legendRows(this.engine.life.config.routes).map(g=>
   `<div class="legend-group"><p class="legend-head"><i style="background:${TINT[g.kind]}"></i>${g.head}`+
   `<em>${g.records}${g.chains!==g.records?' / '+g.chains+t('legendChains'):''}</em></p>`+
   `<div class="legend-names">`+g.names.map(n=>`<p class="legend-name">${n}</p>`).join('')+`</div></div>`).join('');}
 renderMap(){const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height,l=this.engine.life;const xy=p=>[(p[0]+148)/296*w,h-(p[1]+70)/194*h];ctx.fillStyle='#e9e1cc';ctx.fillRect(0,0,w,h);ctx.fillStyle='#a9c3bb';ctx.beginPath();for(let x=-150;x<=150;x+=2){let p=xy([x,3.4*Math.sin(x/72)+14.5]);if(x===-150)ctx.moveTo(...p);else ctx.lineTo(...p);}for(let x=150;x>=-150;x-=2)ctx.lineTo(...xy([x,3.4*Math.sin(x/72)-14.5]));ctx.closePath();ctx.fill();
  ctx.fillStyle='#b1a58a';for(const r of this.engine.navigation.rooms){if(r.y<-70||r.y>125)continue;const p=xy([r.x,r.y]);ctx.fillRect(p[0]-r.hx/296*w,p[1]-r.hy/194*h,r.hx*2/296*w,r.hy*2/194*h);}
  // One stroke per distinct path, not one per record and not one per hand-picked vessel id. The
  // old key drew only vessel-0 and vessel-1, so the map showed 2 of the river's 6 channels while
  // 10 of the 12 vessels ran on lines that were not there; a key that then counts the channels
  // would have reported 6 over a map holding 2. Boats are thinner because all six channels lie in
  // a 15px band and at the old 1.4px they merged into one stroke.
  for(const chain of chainsOf(l.config.routes)){const route=chain[0];
   ctx.strokeStyle=TINT[route.kind]??'#ad9259';ctx.lineWidth=route.kind==='boat'?.9:.8;ctx.beginPath();
   route.points.forEach((p,i)=>i?ctx.lineTo(...xy(p)):ctx.moveTo(...xy(p)));if(route.closed)ctx.closePath();ctx.stroke();}
  for(const d of l.docks){const p=xy(d.depot);ctx.fillStyle=d.occupant===null?'#765d40':'#c77638';ctx.fillRect(p[0]-3,p[1]-3,6,6);}
  ctx.fillStyle='#6b7653';for(const p of l.people){const q=xy(p.actor.p);ctx.fillRect(q[0]-.75,q[1]-.75,1.5,1.5);}
  for(const b of l.boats){const p=xy(b.p);ctx.save();ctx.translate(...p);ctx.rotate(-b.heading);ctx.fillStyle=this.follow?.type==='boat'&&this.follow.id===b.id?'#bc4b2d':'#1f6670';ctx.beginPath();ctx.moveTo(4,0);ctx.lineTo(-3,-2);ctx.lineTo(-2,2);ctx.closePath();ctx.fill();ctx.restore();}
  for(const v of l.convoys){const p=xy(v.p);ctx.fillStyle='#9f5730';ctx.fillRect(p[0]-2,p[1]-2,4,4);}ctx.fillStyle='#544b39';ctx.font='12px sans-serif';ctx.fillText('N ↑',w-45,17);ctx.fillText(t('mapBridge'),w/2+5,h-(0+70)/194*h-7);
 }
}

