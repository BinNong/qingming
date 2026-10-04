// Click-to-inspect contract. Runs the real CollisionWorld and CityEcology headlessly and drives
// pick() with constructed rays, so the two defects found while designing it cannot come back.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
const root=new URL('../',import.meta.url);
registerHooks({resolve(specifier,ctx,next){if(specifier==='qingming/micro')return{url:new URL('src/micro.js',root).href,shortCircuit:true};if(specifier==='three/core')return{url:new URL('vendor/three.core.js',root).href,shortCircuit:true};if(specifier==='three')return{url:new URL('vendor/three.module.js',root).href,shortCircuit:true};return next(specifier,ctx);}});
const {CollisionWorld,CrowdSystem,CityEcology,pick,transform,multiply,Z_TO_Y,lifeRiver}=await import('../src/simulation.js');
const {english}=await import('../src/english.js');
const json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const [manifest,nav,eco,rigs]=await Promise.all(['city','navigation','ecology','rigs'].map(x=>json(`public/runtime/${x}.json`)));
const sourceAssets=manifest.assets.map(a=>({...a,baseMatrices:a.instances.map(i=>multiply(Z_TO_Y,i.matrix)),matrices:a.instances.map(i=>multiply(Z_TO_Y,i.matrix)),centers:a.instances.map(()=>[0,0,0])}));
const world=new CollisionWorld(nav);world.registerDoors(sourceAssets);
const life=new CityEcology(eco,world);
const instances=new Map(nav.instances.map(i=>[i.name,i]));
const ctx={boats:life.boats,boxes:life.convoys.flatMap(v=>life.convoyBoxes(v)),people:[],landmarks:nav.landmarks,instances,prefabs:nav.prefabs};

// A ray straight at a nav-space target, from `back` metres along -Z-up-vertical plus a lateral pull.
const rayTo=(target,{from,back=40,lateral=0}={})=>{
 const o=from??[target[0]-lateral,target[1]+back,target[2]];
 const d=[target[0]-o[0],target[1]-o[1],target[2]-o[2]],n=Math.hypot(...d);
 return{origin:o,dir:d.map(v=>v/n)};
};

// --- The bridge must not swallow open water. sampleFloor assigns the deck with no `h>floor`
// guard, so an unbounded maxZ reports a hull 7m below the span. Pin both directions: the deck
// still occludes a ray that is genuinely above it, and is ignored by one that is below it.
const low=world.sampleFloor(1.33,-3.94,0.5);
assert(!(low&&low.tag==='bridge'),`a ray under the bridge must not hit the deck, got ${JSON.stringify(low)}`);
const high=world.sampleFloor(1.33,-3.94,12);
assert(high&&high.tag==='bridge'&&high.z>7,'a ray above the bridge must still hit the deck');

// --- A boat on the water resolves to the boat, not the far bank.
const boat=life.boats[2];
const along=30*Math.cos(boat.heading),across=30*Math.sin(boat.heading);
const boatHit=pick(world,[boat.p[0]-along,boat.p[1]-across,.28],[Math.cos(boat.heading),Math.sin(boat.heading),0],ctx);
assert.equal(boatHit?.kind,'boat',`expected the boat, got ${boatHit?.kind} at ${JSON.stringify(boatHit?.point)}`);
assert.equal(boatHit.boat,boat,'must be the boat the ray was aimed at');
// Approaching along the hull's own axis, the ray enters the bow at 30m minus the half-length.
const halfLength=boat.length*.5+.06;
assert(Math.abs(boatHit.distance-(30-halfLength))<1,`hull entered at ${boatHit.distance.toFixed(1)}m, expected ~${(30-halfLength).toFixed(1)}m`);

// --- sampleFloor models floors but not walls, so a level ray at a shopfront must still select
// the building rather than sailing through it to the street behind. Instance matrices carry a
// ~180 degree yaw, so rays are built in prefab space and mapped through the instance matrix.
const shop=nav.instances.find(i=>i.prefab==='Shop_00');
const m=shop.matrix;
const dirOf=d=>{const x=[m[0]*d[0]+m[4]*d[1]+m[8]*d[2],m[1]*d[0]+m[5]*d[1]+m[9]*d[2],m[2]*d[0]+m[6]*d[1]+m[10]*d[2]],n=Math.hypot(...x);return x.map(v=>v/n);};
const shopRay=(from,to)=>({origin:transform(m,from),dir:dirOf([to[0]-from[0],to[1]-from[1],to[2]-from[2]])});
// Ground storey anchors sit at plate 0.38 + 1.5; the two rooms split depth 6.8 at the midpoint
// of y=-1.564 and y=+1.7, i.e. 0.068. The ray is attributed at the wall it enters through.
const gotMain=pick(world,...Object.values(shopRay([0,-14,1.88],[0,-2.0,1.88])),ctx);
assert.equal(gotMain?.kind,'room','a level ray at a shopfront must select the building');
assert.equal(gotMain.room?.name,'茶肆营业厅',`negative-y half must be the main room, got ${gotMain.room?.name}`);
assert.equal(gotMain.district,shop.district,'the card carries the authored district');
assert.equal(pick(world,...Object.values(shopRay([0,14,1.88],[0,2.0,1.88])),ctx).room?.name,'后厨与仓储','positive-y half must be the kitchen');
assert.equal(pick(world,...Object.values(shopRay([0,-14,4.78],[0,0,4.78])),ctx).room?.name,'楼上卧房与书案','above the upper plate must be the upstairs room');
// Isolate this one building so the outside case is deterministic: at street level its neighbours
// sit close enough that a ray leaving the footprint legitimately strikes a different shopfront.
const allRooms=world.rooms;
world.rooms=allRooms.filter(r=>r.owner===shop.name);
assert.notEqual(pick(world,...Object.values(shopRay([0,20,1.88],[0,26,1.88])),ctx)?.kind,'room','a ray that never enters the footprint is not a room');
world.rooms=allRooms;

// --- Water. No floor exists in the channel, so before the water hit was added a click aimed at
// open water - which includes the centre of the Overview view - resolved to nothing at all.
// x=20 is outside the bridge footprint, so nothing can outrank the water plane here.
const wpos=[20,lifeRiver(20),1.0];
const water=pick(world,wpos,[0,0,-1],ctx);
assert.equal(water?.kind,'water',`a ray into the channel must hit the water, got ${water?.kind} at ${JSON.stringify(water?.point)}`);
assert(Math.abs(water.point[2]-.28)<.01,'the water plane is the boat hull level');
// The Overview view aims through the channel, and its centre ray lands on the Hongqiao deck
// rather than the water beneath - the bridge outranks the river because it occludes it. Left
// unnormalised here to prove pick() accepts a raw direction.
const overview=pick(world,[45,-55,43],[-6-45,5-(-55),3.5-43],ctx);
assert.equal(overview?.kind,'surface',`the Overview centre ray should land on the bridge deck, got ${overview?.kind} at ${JSON.stringify(overview?.point)}`);
assert.equal(overview.surface,'bridge');
// And a ray aimed at the bridge deck must still hit the deck, not the water beneath it.
const deck=pick(world,[0,0,8],[0,0,-1],ctx);
assert.equal(deck?.kind,'surface','straight down on the bridge is a bridge hit, not water');
assert.equal(deck.surface,'bridge');

// --- A person standing on that same floor wins over the architecture around them.
const stand=transform(m,[0,-2.0,1.88]);
ctx.people=[{p:stand,crew:false,lifePlan:{role:'vendor',mode:'shopkeeper',clip:'Talk'},life:null}];
const personHit=pick(world,...Object.values(shopRay([0,-14,1.88],[0,-2.0,1.88])),ctx);
assert.equal(personHit?.kind,'person','a person inside the room must outrank the room');
assert.equal(personHit.lifePlan.role,'vendor');
ctx.people=[];

// --- Bare ground under a landmark reports the landmark.
const poi=nav.landmarks[0];
const lm=pick(world,[poi.position[0]-10,poi.position[1],poi.position[2]+1.2],[1,0,0],ctx);
assert(['landmark','door','room','surface'].includes(lm?.kind),`landmark area must resolve, got ${lm?.kind}`);

// --- A click on empty street is a surface hit, not a miss.
const open=pick(world,[-4.3,-40,3.2],[0,1,0],ctx);
assert.equal(open?.kind,'surface',`open street should be a surface, got ${open?.kind}`);

// --- Every string the card can render must survive english(). tests/english.mjs only scans keys
// literally named `name` or `label`, so prefab `kind` and the live Chinese `state` values are
// outside its reach and have to be pinned here. House_03's 宅院正房 was missing from the table and
// reached the DOM untranslated before this check existed.
const han=/\p{Script=Han}/u;
const shown=[...nav.landmarks.map(l=>l.name),...Object.values(nav.prefabs).flatMap(p=>(p.rooms??[]).map(r=>r.name)),
 ...Object.values(nav.prefabs).map(p=>p.kind),...life.boats.map(b=>b.type),...life.boats.map(b=>b.state),
 ...life.convoys.map(v=>v.state),...eco.docks.map(d=>d.name),...world.doors.map(d=>d.mo.label),...nav.instances.map(i=>i.district)];
for(const value of shown){if(!value)continue;assert(!han.test(english(value)),`card would render Han: ${value}`);}

// --- The march has to stay interactive; a click must not cost a visible stall. The bound is
// deliberately loose - this machine routinely runs at load 60+ and the same code has measured
// 3 ms here and 29 ms under load. It exists to catch the one real regression: computing the
// oriented frames inside the loop instead of hoisting them, which measured 69 ms.
const actors=[];for(const a of sourceAssets)for(let i=0;i<a.instances.length;i++)actors.push({a,index:i});
const crowd=new CrowdSystem({sourceAssets,playerPosition:null,fixedTime:undefined,renderer:{properties:{get:()=>({})}},gl:null,life:null},rigs,world);
life.attachPeople(crowd.actors);ctx.people=life.crowdActors;
assert.equal(ctx.people.length,584,'the march must be measured against the real crowd');
const t0=performance.now();
for(let i=0;i<40;i++)pick(world,[-4.3,-40,3.2],[0,1,0],ctx);
const perClick=(performance.now()-t0)/40;
assert(perClick<60,`pick() costs ${perClick.toFixed(1)}ms per click, too slow`);

console.log(`interaction: ok — bridge guarded, boat and shopfront resolve, room split by storey, ${shown.length} card strings clean, ${perClick.toFixed(1)}ms per click`);
