import {RESOURCES,AGES,UNITS,BUILDINGS,TECHNOLOGIES,AGE_COSTS,UPGRADE_CHAINS,unitForAge} from './catalog.js';
import {Navigation} from './pathfinding.js';

const clone=o=>JSON.parse(JSON.stringify(o));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clock=()=>globalThis.performance?.now?.()??0;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export class Simulation {
  constructor(config={}) {
    const cfg={seed:12345,map:'plains',size:2048,difficulty:'normal',population:300,startingResources:600,fog:true,cheats:false,startingAge:0,endingAge:3,...config};
    cfg.size=clamp(Number(cfg.size)||2048,1024,4096);cfg.population=clamp(Number(cfg.population)||300,20,1000);
    cfg.startingAge=clamp(Number(cfg.startingAge)||0,0,3);cfg.endingAge=clamp(Number(cfg.endingAge) || (cfg.endingAge===0?0:3),cfg.startingAge,3);
    cfg.seed=Number(cfg.seed)||12345;cfg.difficulty=String(cfg.difficulty).toLowerCase();
    this.rng=cfg.seed>>>0;this.nextId=1;this.paths=new Map();this.byId=new Map();this.grid=new Map();this.pathBudget=0;
    const width=Math.ceil(cfg.size/32),terrain=new Array(width*width).fill(0);
    this.state={version:1,tick:0,time:0,seed:cfg.seed,map:{size:cfg.size,width,height:width,cellSize:32,terrain},config:cfg,
      players:[0,1].map(id=>({id,name:id?'The Obsidian Senate':'Aurelia',age:cfg.startingAge,resources:Object.fromEntries(RESOURCES.map(r=>[r,Math.max(0,Number(typeof cfg.startingResources==='object'?cfg.startingResources[r]:cfg.startingResources)||0)])),population:0,popCap:0,maxPop:cfg.population,techs:[],researchQueue:[],score:0,kills:0})),
      entities:[],projectiles:[],effects:[],fog:{explored:new Array(width*width).fill(0),visible:new Array(width*width).fill(0)},winner:null,notifications:[],ai:{objective:'Establish an economy',priorities:{},buildOrder:[],target:null},stats:{tickMs:0,pathMs:0,aiMs:0,pathRequests:0}};
    this.spawns=[{x:cfg.size*.2,y:cfg.size*.25},{x:cfg.size*.8,y:cfg.size*.75}];
    this.generate();this.nav=new Navigation(this.state.map);this.nav.rebuild(this.state.entities);this.index();for(const e of this.state.entities)if(e.kind==='unit')this.upgradeUnit(e);this.population();this.fog();
    this.notify('Build an economy, advance your civilization, and destroy the opposing civic heart and army.');
  }
  random(){this.rng=(Math.imul(this.rng,1664525)+1013904223)>>>0;return this.rng/4294967296;}
  id(prefix='e'){return `${prefix}${this.nextId++}`;}
  notify(text){this.state.notifications.push({id:this.id('n'),text,time:this.state.time});if(this.state.notifications.length>50)this.state.notifications.shift();}
  generate(){
    const m=this.state.map;
    // Tiny rocky outcrops leave a wide central travel corridor and clear settlement starts.
    for(let y=2;y<m.height-2;y++)for(let x=2;x<m.width-2;x++){
      const wx=(x+.5)*32,wy=(y+.5)*32;
      if(this.spawns.some(s=>Math.hypot(wx-s.x,wy-s.y)<300)||Math.abs(wy-(wx*.833+m.size*.083))<180)continue;
      if(this.random()<.012)m.terrain[y*m.width+x]=1;
    }
    const heart=this.heartType();
    for(let owner=0;owner<2;owner++){
      const s=this.spawns[owner];this.create('building',heart,owner,s.x,s.y,{progress:1});
      for(let i=0;i<6;i++)this.create('unit','worker',owner,s.x-100+i*28,s.y+95);
      this.create('unit',UNITS.scout?'scout':Object.keys(UNITS).find(k=>UNITS[k].category==='cavalry')||'worker',owner,s.x+115,s.y+80);
      for(const [ri,r] of RESOURCES.entries())for(let i=0;i<(r==='wood'?16:r==='food'?5:3);i++){
        const a=(ri+.5)*Math.PI/3+(i%4)*.15,rad=155+Math.floor(i/4)*42;
        const x=s.x+Math.cos(a)*rad,y=s.y+Math.sin(a)*rad;
        this.clearTerrain(x,y,55);this.resource(r,x,y,r==='wood'?500:r==='food'?650:1400,r==='food'&&i<2?'animal':undefined);
      }
    }
    for(let i=0;i<(this.state.config.map==='woodlands'?190:105);i++){
      const x=70+this.random()*(m.size-140),y=70+this.random()*(m.size-140);
      if(this.spawns.some(s=>Math.hypot(s.x-x,s.y-y)<310)||m.terrain[Math.floor(y/32)*m.width+Math.floor(x/32)])continue;
      const r=i%11<7?'wood':i%11===7?'food':i%11===8?'gold':i%11===9?'iron':'stone';this.resource(r,x,y,r==='wood'?450:1800,r==='food'&&i%22===7?'animal':undefined);
    }
  }
  clearTerrain(x,y,r){const m=this.state.map;for(let cy=Math.max(0,Math.floor((y-r)/32));cy<=Math.min(m.height-1,Math.floor((y+r)/32));cy++)for(let cx=Math.max(0,Math.floor((x-r)/32));cx<=Math.min(m.width-1,Math.floor((x+r)/32));cx++)m.terrain[cy*m.width+cx]=0;}
  heartType(){return BUILDINGS.civicHeart?'civicHeart':BUILDINGS.civic?'civic':Object.keys(BUILDINGS).find(k=>BUILDINGS[k].produces?.includes('worker'))||Object.keys(BUILDINGS)[0];}
  resource(r,x,y,amount,source){
    const extra={resource:r,amount,size:r==='wood'?12:19,hp:1,maxHp:1,vision:0};
    if(r==='food')extra.source=source||'berries';
    if(extra.source==='animal'){extra.size=14;extra.animalHp=30;extra.maxAnimalHp=30;extra.hunted=false;}
    return this.create('resource',r,-1,x,y,extra);
  }
  create(kind,type,owner,x,y,extra={}){
    const d=(kind==='unit'?UNITS:BUILDINGS)[type]||{};
    const e={id:this.id(),kind,type,owner,x,y,hp:d.hp||100,maxHp:d.hp||100,size:d.size||(kind==='unit'?10:34),vision:d.vision||0,alive:true,order:{type:'idle'},orderQueue:[],queue:[],...extra};
    if(kind==='unit'){e.carry=null;e.cooldown=0;e.facing=0;e.pathTimer=0;}
    if(kind==='building'){e.progress=extra.progress??0;e.rally=null;if(e.progress<1)e.hp=Math.max(1,e.maxHp*.1);if(type==='farm'){e.resource='food';e.amount=d.amount||1400;}}
    this.state.entities.push(e);this.byId.set(e.id,e);return e;
  }
  descriptor(e){return (e.kind==='unit'?UNITS:BUILDINGS)[e.type]||{};}
  index(){this.byId.clear();this.grid.clear();for(const e of this.state.entities){if(!e.alive)continue;this.byId.set(e.id,e);if(e.kind==='resource')continue;const k=`${Math.floor(e.x/128)},${Math.floor(e.y/128)}`;if(!this.grid.has(k))this.grid.set(k,[]);this.grid.get(k).push(e);}}
  nearby(x,y,r){const out=[];for(let cy=Math.floor((y-r)/128);cy<=Math.floor((y+r)/128);cy++)for(let cx=Math.floor((x-r)/128);cx<=Math.floor((x+r)/128);cx++)for(const e of this.grid.get(`${cx},${cy}`)||[])if(Math.abs(e.x-x)<=r+e.size&&Math.abs(e.y-y)<=r+e.size)out.push(e);return out;}
  owned(player,id,kind){const e=this.byId.get(id);return e?.alive&&e.owner===player&&(!kind||e.kind===kind)?e:null;}
  has(player,type){return this.state.entities.some(e=>e.alive&&e.owner===player&&e.kind==='building'&&e.type===type&&e.progress>=1);}
  affordable(player,cost={}){return Object.entries(cost).every(([r,n])=>(player.resources[r]||0)>=n);}
  pay(player,cost={},mult=1){for(const [r,n] of Object.entries(cost))player.resources[r]=(player.resources[r]||0)-n*mult;}
  prerequisites(player,d){return (d.prerequisites||d.requires||[]).every(k=>player.techs.includes(k)||this.has(player.id,k));}
  fail(message){return {ok:false,message};}
  setOrder(e,order,queue=false){if(queue&&e.order.type!=='idle')e.orderQueue.push(clone(order));else {e.order=clone(order);if(!queue)e.orderQueue=[];this.paths.delete(e.id);e.pathTimer=0;delete e.dropoffId;delete e.combatTarget;}}
  command(c={}){
    if(this.state.winner!==null)return this.fail('The match has ended.');
    const pid=c.player??0,p=this.state.players[pid];if(!p)return this.fail('Unknown player.');
    if(c.type==='resign'){this.state.winner=1-pid;this.notify(`${p.name} has surrendered.`);return {ok:true};}
    if(c.type==='cheat')return this.cheat(p,c.code);
    if(c.type==='order'){
      const order=c.order||{},allowed=['idle','stop','move','gather','build','attack','attackMove','patrol','guard','repair'];
      if(!allowed.includes(order.type))return this.fail('Unknown order.');
      const selected=(c.ids||[]).map(id=>this.owned(pid,id,'unit')).filter(Boolean);if(!selected.length)return this.fail('Select your units first.');
      const t=order.targetId?this.byId.get(order.targetId):null;
      if(['gather','build','attack','guard','repair'].includes(order.type)&&(!t?.alive))return this.fail('Target no longer exists.');
      if(order.type==='attack'&&(t.owner===pid||t.owner<0))return this.fail('Choose an enemy target.');
      if(['move','attackMove','patrol'].includes(order.type)&&(!Number.isFinite(order.x)||!Number.isFinite(order.y)))return this.fail('Choose a destination on the map.');
      if(t&&t.owner!==pid&&t.owner>=0&&pid===0&&this.state.config.fog&&!this.visible(t))return this.fail('That target is outside your current vision.');
      let count=0;
      for(const e of selected){
        if(['gather','build','repair'].includes(order.type)&&e.type!=='worker')continue;
        if(order.type==='gather'&&(!(t.kind==='resource'||t.type==='farm')||(t.owner>=0&&t.owner!==pid)||(t.resource==='oil'&&p.age<3)))continue;
        if(['build','repair','guard'].includes(order.type)&&t.owner!==pid)continue;
        this.setOrder(e,{...order,type:order.type==='stop'?'idle':order.type},!!c.queue);count++;
      }
      return count?{ok:true}:this.fail('Selected units cannot perform that action.');
    }
    if(c.type==='build'){
      const d=BUILDINGS[c.building],workers=(c.ids||[]).map(id=>this.owned(pid,id,'unit')).filter(e=>e?.type==='worker');
      if(!d||!workers.length)return this.fail('Select workers and a valid building.');
      if(p.age<(d.age||0)||!this.prerequisites(p,d))return this.fail('Required age or structures are missing.');
      if(!this.affordable(p,d.cost))return this.fail('Not enough resources.');
      if(!this.placement(c.building,c.x,c.y))return this.fail('Placement blocked: choose clear, reachable ground.');
      // A builder must reach the footprint; prevents foundations behind sealed terrain.
      const edge=this.nav.nearest(c.x,c.y,(d.size||34)+18,pid);
      if(!edge||!this.nav.path(workers[0].x,workers[0].y,edge.x,edge.y,workers[0].size,pid).length)return this.fail('Workers cannot reach that location.');
      this.pay(p,d.cost);const b=this.create('building',c.building,pid,c.x,c.y);this.nav.rebuild(this.state.entities);
      // Foundations cannot entomb their builders or units standing on the footprint.
      for(const u of this.state.entities)if(u.alive&&u.kind==='unit'&&distance(u,b)<u.size+b.size+2){const edge=this.nav.nearest(u.x,u.y,u.size+2,u.owner);if(edge){u.x=edge.x;u.y=edge.y;this.paths.delete(u.id);}}
      for(const w of workers)this.setOrder(w,{type:'build',targetId:b.id},!!c.queue);this.population();return {ok:true,entityId:b.id};
    }
    const b=this.owned(pid,c.buildingId,'building');if(!b)return this.fail('Select one of your buildings.');
    if(c.type==='cancel'){
      const i=c.index??0,q=b.queue[i];if(!q)return this.fail('Queue item no longer exists.');this.pay(p,q.cost||{},-1);b.queue.splice(i,1);this.researchQueues();return {ok:true};
    }
    if(c.type==='rally'){
      if(!Number.isFinite(c.x)||!Number.isFinite(c.y))return this.fail('Choose a rally point.');b.rally={x:clamp(c.x,0,this.state.map.size),y:clamp(c.y,0,this.state.map.size),targetId:c.targetId};return {ok:true};
    }
    if(b.progress<1)return this.fail('Construction must finish first.');
    if(b.queue.length>=12)return this.fail('Production queue is full.');
    if(c.type==='train'){
      const available=unitForAge(c.unit,p.age),d=UNITS[available];if(!d||!(BUILDINGS[b.type]?.produces||[]).includes(available)||d.producer&&d.producer!==b.type)return this.fail('This building cannot train that unit.');
      if(p.age<(d.age||0)||!this.prerequisites(p,d))return this.fail('Required age or technology is missing.');
      const reserved=this.state.entities.filter(e=>e.owner===pid).reduce((n,e)=>n+e.queue.filter(q=>q.type==='train').length,0);
      if(p.population+reserved>=p.popCap)return this.fail('Population limit reached. Build houses.');
      if(!this.affordable(p,d.cost))return this.fail('Not enough resources.');this.pay(p,d.cost);b.queue.push({type:'train',id:available,progress:0,duration:d.time||15,cost:clone(d.cost||{})});return {ok:true};
    }
    if(c.type==='research'){
      const d=TECHNOLOGIES[c.technology];if(!d||!(BUILDINGS[b.type]?.research||[]).includes(c.technology))return this.fail('Technology is unavailable here.');
      if(p.age<(d.age||0)||!this.prerequisites(p,d))return this.fail('Required age or prerequisite is missing.');
      if(p.techs.includes(c.technology)||this.state.entities.some(e=>e.owner===pid&&e.queue.some(q=>q.id===c.technology)))return this.fail('Technology is already researched or queued.');
      if(!this.affordable(p,d.cost))return this.fail('Not enough resources.');this.pay(p,d.cost);b.queue.push({type:'research',id:c.technology,progress:0,duration:d.time||30,cost:clone(d.cost||{})});this.researchQueues();return {ok:true};
    }
    if(c.type==='advance'){
      if(b.type!==this.heartType())return this.fail('Advance ages at the civic heart.');
      if(p.age>=this.state.config.endingAge)return this.fail('Maximum configured age reached.');
      if(this.state.entities.some(e=>e.owner===pid&&e.queue.some(q=>q.type==='advance')))return this.fail('Age advancement is already queued.');
      const target=p.age+1,a=AGE_COSTS[target]||{},cost=a.cost||a;
      if(!this.prerequisites(p,a))return this.fail(`Required structures: ${(a.prerequisites||a.requires||[]).join(', ')}.`);
      if(!this.affordable(p,cost))return this.fail('Not enough resources to advance.');this.pay(p,cost);b.queue.push({type:'advance',id:target,progress:0,duration:a.time||a.duration||55,cost:clone(cost)});this.researchQueues();return {ok:true};
    }
    return this.fail('Unknown command.');
  }
  placement(type,x,y){
    const d=BUILDINGS[type];if(!d||!Number.isFinite(x)||!Number.isFinite(y))return false;
    const r=d.size||34,m=this.state.map;if(x<r+12||y<r+12||x>m.size-r-12||y>m.size-r-12)return false;
    for(let a=0;a<Math.PI*2;a+=Math.PI/8)if(!this.nav.free(x+Math.cos(a)*r,y+Math.sin(a)*r,6))return false;
    if(!this.nav.free(x,y,6))return false;
    return !this.state.entities.some(e=>e.alive&&(e.kind==='building'||e.kind==='resource')&&distance(e,{x,y})<e.size+r+12);
  }
  researchQueues(){for(const p of this.state.players)p.researchQueue=this.state.entities.filter(e=>e.owner===p.id).flatMap(e=>e.queue.filter(q=>q.type!=='train').map(q=>({...q,buildingId:e.id})));}
  population(){for(const p of this.state.players){p.population=this.state.entities.filter(e=>e.alive&&e.kind==='unit'&&e.owner===p.id).length;p.popCap=p.unbound?p.maxPop:Math.min(p.maxPop,this.state.entities.filter(e=>e.alive&&e.kind==='building'&&e.owner===p.id&&e.progress>=1).reduce((n,e)=>n+(BUILDINGS[e.type]?.population||0),0));}}
  finish(e){e.order=e.orderQueue.shift()||{type:'idle'};this.paths.delete(e.id);delete e.dropoffId;delete e.combatTarget;e.pathTimer=0;}
  move(e,x,y,dt,stop=2){
    const dist=Math.hypot(x-e.x,y-e.y);if(dist<=stop){this.paths.delete(e.id);return true;}
    e.pathTimer=(e.pathTimer||0)-dt;
    let path=this.paths.get(e.id);
    const key=`${Math.round(x/24)},${Math.round(y/24)}:${this.nav.revision}`;
    if(!path||path.key!==key||(!path.points.length&&e.pathTimer<=0)){
      if(this.pathBudget<=0)return false;
      this.pathBudget--;const t=clock();const points=this.nav.path(e.x,e.y,x,y,e.size,e.owner);this.state.stats.pathMs+=clock()-t;this.state.stats.pathRequests++;
      path={key,points,index:0};this.paths.set(e.id,path);e.pathTimer=1.2+(Number(e.id.slice(1))%7)*.08;
    }
    if(!path.points.length)return false;
    let goal=path.points[Math.min(path.index,path.points.length-1)],dx=goal.x-e.x,dy=goal.y-e.y,len=Math.hypot(dx,dy);
    if(len<8&&path.index<path.points.length-1){path.index++;goal=path.points[path.index];dx=goal.x-e.x;dy=goal.y-e.y;len=Math.hypot(dx,dy);}
    if(len<.1)return path.index>=path.points.length-1;
    const speed=(this.descriptor(e).speed||42)*this.modifier(e.owner,'speed',e),step=Math.min(len,speed*dt);dx=dx/len*step;dy=dy/len*step;e.facing=Math.atan2(dy,dx);
    // Soft local separation keeps moving ranks readable without crowd-wide path searches.
    let sx=0,sy=0,contacts=0;
    for(const other of this.nearby(e.x,e.y,e.size*2+8)){if(other.id===e.id||other.kind!=='unit')continue;const ox=e.x-other.x,oy=e.y-other.y,d=Math.hypot(ox,oy),radius=e.size+other.size;
      if(d<radius&&d>.01){const weight=(radius-d)/radius;sx+=ox/d*weight;sy+=oy/d*weight;if(++contacts>=6)break;}}
    if(contacts){dx+=clamp(sx,-1,1)*step*.25;dy+=clamp(sy,-1,1)*step*.25;}
    if(this.nav.free(e.x+dx,e.y+dy,e.size,e.owner)){e.x+=dx;e.y+=dy;}
    else if(this.nav.free(e.x+dx,e.y,e.size,e.owner)){e.x+=dx;e.pathTimer=0;}
    else if(this.nav.free(e.x,e.y+dy,e.size,e.owner)){e.y+=dy;e.pathTimer=0;}
    else {e.pathTimer=0;path.points=[];}
    return Math.hypot(x-e.x,y-e.y)<=stop||(path.index>=path.points.length-1&&Math.hypot(goal.x-e.x,goal.y-e.y)<=Math.min(stop,8));
  }
  approach(e,t,range,dt){
    const desired=e.size+t.size+range;if(distance(e,t)<=desired+2)return true;
    const angle=Math.atan2(e.y-t.y,e.x-t.x),r=desired-1;
    let dest={x:t.x+Math.cos(angle)*r,y:t.y+Math.sin(angle)*r};
    if(!this.nav.free(dest.x,dest.y,e.size,e.owner)){
      let best=null,score=Infinity;
      for(let i=0;i<16;i++){const a=angle+i*Math.PI/8,p={x:t.x+Math.cos(a)*r,y:t.y+Math.sin(a)*r};if(this.nav.free(p.x,p.y,e.size,e.owner)&&distance(e,p)<score){best=p;score=distance(e,p);}}
      if(!best)return false;dest=best;
    }
    this.move(e,dest.x,dest.y,dt,3);return distance(e,t)<=desired+3;
  }
  modifier(owner,key,entity=null,resource=null){
    let factor=key==='armor'?0:1;for(const id of this.state.players[owner]?.techs||[]){const d=TECHNOLOGIES[id],effects=d?.effects||d?.effect||{};
      if(effects.categories&&(!entity||!effects.categories.includes(this.descriptor(entity).category)))continue;
      if(effects.resource&&effects.resource!==resource)continue;if(effects.resources&&!effects.resources.includes(resource))continue;
      if(typeof effects[key]==='number'){if(key==='armor')factor+=effects[key];else factor*=effects[key];}}
    return factor;
  }
  gather(e,dt){
    let t=this.byId.get(e.order.targetId),p=this.state.players[e.owner];const capacity=(UNITS[e.type].carryCapacity||12)*this.modifier(e.owner,'carryCapacity',e);
    if(e.carry?.amount>=capacity-.001||e.dropoffId||(!t?.alive&&e.carry?.amount>0)||t?.amount<=0&&e.carry?.amount>0||e.carry&&t&&e.carry.resource!==t.resource){
      let drop=this.byId.get(e.dropoffId);
      if(!drop?.alive||drop.progress<1){drop=this.state.entities.filter(b=>b.alive&&b.kind==='building'&&b.owner===e.owner&&b.progress>=1&&(BUILDINGS[b.type]?.dropoff||[]).includes(e.carry?.resource)).sort((a,b)=>distance(e,a)-distance(e,b))[0];e.dropoffId=drop?.id;}
      if(!drop){e.dropoffId=null;return;}
      if(this.approach(e,drop,4,dt)){p.resources[e.carry.resource]+=e.carry.amount;p.score+=e.carry.amount;e.carry=null;delete e.dropoffId;}return;
    }
    if(!t?.alive||t.amount<=0){
      const resource=t?.resource||e.carry?.resource||e.gatherResource;
      t=this.state.entities.filter(r=>r.alive&&(r.kind==='resource'||r.type==='farm')&&r.amount>0&&r.resource===resource&&(r.owner<0||r.owner===e.owner)).sort((a,b)=>distance(e,a)-distance(e,b))[0];
      if(!t){this.finish(e);return;}e.order.targetId=t.id;
    }
    e.gatherResource=t.resource;
    if(t.type==='farm'&&t.progress<1){this.approach(e,t,5,dt);return;}
    if(t.resource==='oil'&&p.age<3){this.finish(e);return;}
    if(!this.approach(e,t,4,dt))return;
    // Hunting is an explicit finite-health phase, never abstract food income.
    // A killed animal remains as a carcass until workers physically exhaust its food.
    if(t.source==='animal'&&!t.hunted){
      if(e.cooldown>0)return;
      e.cooldown=UNITS[e.type].cooldown||1.1;e.facing=Math.atan2(t.y-e.y,t.x-e.x);e.attackTime=this.state.time;
      t.animalHp=Math.max(0,t.animalHp-(UNITS[e.type].damage||3));
      this.state.effects.push({id:this.id('v'),type:'hit',x:t.x,y:t.y,owner:e.owner,time:.2,duration:.2});
      if(t.animalHp<=0){t.hunted=true;this.state.effects.push({id:this.id('v'),type:'death',x:t.x,y:t.y,size:t.size,owner:-1,time:.7,duration:.7});}
      return;
    }
    const amount=Math.min(t.amount,capacity-(e.carry?.amount||0),dt*(UNITS[e.type].gatherRate||3.2)*this.modifier(e.owner,'gatherRate',e,t.resource));
    e.carry={resource:t.resource,amount:(e.carry?.amount||0)+amount};t.amount=Math.max(0,t.amount-amount);
    if(t.amount<=.001&&t.kind==='resource')t.alive=false;
  }
  construct(e,t,dt,repair=false){
    if(!t?.alive||t.owner!==e.owner){this.finish(e);return;}
    if(!this.approach(e,t,7,dt))return;
    if(!repair&&t.progress<1){const d=BUILDINGS[t.type];t.progress=Math.min(1,t.progress+dt/(d.buildTime||d.time||30));t.hp=Math.min(t.maxHp,t.hp+dt*t.maxHp*.9/(d.buildTime||d.time||30));
      if(t.progress>=1){t.hp=t.maxHp;this.population();if(t.owner===0)this.notify(`${d.name||t.type} completed.`);}
    }else if(repair&&t.hp<t.maxHp){const p=this.state.players[e.owner],rate=dt*18;if(p.resources.wood>=dt*.7){p.resources.wood-=dt*.7;t.hp=Math.min(t.maxHp,t.hp+rate);}}
    else this.finish(e);
  }
  target(e,r=240){
    let best=null,score=Infinity;
    for(const t of this.nearby(e.x,e.y,r)){if(t.owner<0||t.owner===e.owner||!t.alive)continue;const dist=distance(e,t);if(dist>r+t.size)continue;const value=dist+(t.kind==='building'?80:0);if(value<score){best=t;score=value;}}
    return best;
  }
  attack(e,t,dt){
    if(!t?.alive||t.owner<0||t.owner===e.owner)return false;
    const d=this.descriptor(e),range=(d.range||5)*this.modifier(e.owner,'range',e);
    if(e.kind==='building'){if(distance(e,t)>range+t.size+e.size)return false;}
    else if(!this.approach(e,t,range,dt))return true;
    if(e.cooldown>0)return true;
    e.facing=Math.atan2(t.y-e.y,t.x-e.x);e.cooldown=d.cooldown||1.2;
    let damage=(d.damage||3)*this.modifier(e.owner,'damage',e),td=this.descriptor(t);
    damage*=d.counters?.[t.kind==='building'?'building':td.category]||1;
    if(t.kind==='building'&&d.category!=='siege')damage*=.8;
    damage=Math.max(1,damage-(td.armor||0)-this.modifier(t.owner,'armor',t));
    if(range>40){const duration=Math.max(.09,distance(e,t)/450);this.state.projectiles.push({id:this.id('p'),owner:e.owner,x:e.x,y:e.y,startX:e.x,startY:e.y,targetX:t.x,targetY:t.y,targetId:t.id,damage,duration,remaining:duration,splash:d.splash||0,type:d.category==='siege'?'shell':'arrow'});}
    else this.hit(t,damage,e.owner);
    e.attackTime=this.state.time;return true;
  }
  hit(t,damage,owner){
    if(!t.alive||this.state.players[t.owner]?.invulnerable)return;t.hp-=damage;this.state.effects.push({id:this.id('v'),type:'hit',x:t.x,y:t.y,owner,time:.2,duration:.2});
    if(t.hp<=0){t.alive=false;this.state.players[owner].kills++;this.state.players[owner].score+=t.kind==='building'?120:30;this.state.effects.push({id:this.id('v'),type:'death',x:t.x,y:t.y,size:t.size,owner:t.owner,time:1,duration:1});if(t.kind==='building'){this.nav.rebuild(this.state.entities);if(t.type===this.heartType())this.notify(`${this.state.players[t.owner].name}'s civic heart has fallen!`);}}
  }
  unitTick(e,dt){
    e.cooldown=Math.max(0,e.cooldown-dt);const o=e.order,t=this.byId.get(o.targetId);
    if(o.type==='gather'){this.gather(e,dt);return;}
    if(o.type==='build'||o.type==='repair'){this.construct(e,t,dt,o.type==='repair');return;}
    if(o.type==='attack'){if(!t?.alive){this.finish(e);return;}this.attack(e,t,dt);return;}
    if(o.type==='move'){if(this.move(e,o.x,o.y,dt,8))this.finish(e);return;}
    if(o.type==='guard'){
      if(!t?.alive){this.finish(e);return;}const enemy=this.target(e,160);if(enemy)this.attack(e,enemy,dt);else if(distance(e,t)>t.size+e.size+65)this.approach(e,t,45,dt);return;
    }
    if(o.type==='attackMove'||o.type==='patrol'){
      let enemy=this.byId.get(e.combatTarget);if(!enemy?.alive||distance(e,enemy)>320){enemy=this.target(e,220);e.combatTarget=enemy?.id;}
      if(enemy){this.attack(e,enemy,dt);return;}
      if(o.type==='patrol'){if(o.originX===undefined){o.originX=e.x;o.originY=e.y;}if(this.move(e,o.x,o.y,dt,12)){const x=o.x,y=o.y;o.x=o.originX;o.y=o.originY;o.originX=x;o.originY=y;this.paths.delete(e.id);}}
      else if(this.move(e,o.x,o.y,dt,12))this.finish(e);return;
    }
    // Workers defend themselves only against close attackers. Armies acquire threats locally.
    const enemy=this.target(e,e.type==='worker'?45:160);if(enemy)this.attack(e,enemy,dt);
  }
  buildingTick(b,dt){
    if(b.progress<1)return;
    const d=BUILDINGS[b.type];b.cooldown=Math.max(0,(b.cooldown||0)-dt);
    if(d.damage){const t=this.target(b,(d.range||220)+b.size);if(t)this.attack(b,t,dt);}
    const q=b.queue[0];if(!q)return;
    if(q.type==='train'&&this.state.players[b.owner].population>=this.state.players[b.owner].popCap)return;
    q.progress=Math.min(1,q.progress+dt/q.duration);if(q.progress<1)return;
    const p=this.state.players[b.owner];
    if(q.type==='train'){
      const d=UNITS[q.id];let pos=null;
      for(let i=0;i<96;i++){const a=(i+this.nextId%24)*Math.PI/12,r=b.size+(d.size||10)+25+Math.floor(i/24)*24,point={x:b.x+Math.cos(a)*r,y:b.y+Math.sin(a)*r};if(this.nav.free(point.x,point.y,d.size||10,b.owner)&&!this.nearby(point.x,point.y,24).some(e=>e.kind==='unit'&&distance(e,point)<e.size+(d.size||10)+3)){pos=point;break;}}
      if(!pos)return;
      const u=this.create('unit',q.id,b.owner,pos.x,pos.y);this.upgradeUnit(u);
      if(b.rally){const target=this.byId.get(b.rally.targetId);this.setOrder(u,target?.alive&&u.type==='worker'&&(target.kind==='resource'||target.type==='farm')?{type:'gather',targetId:target.id}:{type:u.type==='worker'?'move':'attackMove',x:b.rally.x,y:b.rally.y});}
      p.population++;
    }else if(q.type==='research'){p.techs.push(q.id);for(const u of this.state.entities)if(u.owner===p.id&&u.kind==='unit')this.upgradeUnit(u);if(p.id===0)this.notify(`${TECHNOLOGIES[q.id]?.name||q.id} researched.`);}
    else if(q.type==='advance'){p.age=q.id;for(const u of this.state.entities)if(u.owner===p.id&&u.kind==='unit')this.upgradeUnit(u);this.notify(`${p.name} has entered the ${AGES[p.age]} Age.`);this.state.ageChangedAt=this.state.time;}
    b.queue.shift();this.researchQueues();
  }
  upgradeUnit(u){
    const p=this.state.players[u.owner];let next;
    for(let attempts=0;attempts<8;attempts++){
      next=UNITS[u.type]?.upgrade;
      if(!next&&UPGRADE_CHAINS){if(typeof UPGRADE_CHAINS[u.type]==='string')next=UPGRADE_CHAINS[u.type];else if(Array.isArray(UPGRADE_CHAINS[u.type]))next=UPGRADE_CHAINS[u.type].find(k=>k!==u.type&&UNITS[k]?.age<=p.age);else for(const chain of Object.values(UPGRADE_CHAINS)){if(Array.isArray(chain)){const i=chain.indexOf(u.type);if(i>=0)next=chain[i+1];}}}
      const d=UNITS[next];if(!d||d.age>p.age||!this.prerequisites(p,d))break;
      const ratio=u.hp/u.maxHp;u.type=next;u.maxHp=d.hp;u.hp=Math.max(1,ratio*d.hp);u.size=d.size||u.size;u.vision=d.vision||u.vision;
    }
  }
  tick(dt=.05){
    if(this.state.winner!==null)return;
    dt=clamp(Number(dt)||.05,.001,.25);const start=clock();this.state.tick++;this.state.time+=dt;this.pathBudget=18;this.state.stats.pathMs=0;this.state.stats.pathRequests=0;this.index();
    if(this.state.tick%20===1){const t=clock();this.aiTick();this.state.stats.aiMs=clock()-t;}
    for(const e of [...this.state.entities]){if(!e.alive)continue;if(e.kind==='unit')this.unitTick(e,dt);else if(e.kind==='building')this.buildingTick(e,dt);}
    for(const p of this.state.projectiles){p.remaining-=dt;const f=clamp(1-p.remaining/p.duration,0,1);p.x=p.startX+(p.targetX-p.startX)*f;p.y=p.startY+(p.targetY-p.startY)*f;if(p.remaining<=0){const target=this.byId.get(p.targetId);if(target?.alive)this.hit(target,p.damage,p.owner);if(p.splash)for(const t of this.nearby(p.targetX,p.targetY,p.splash))if(t.alive&&t.owner>=0&&t.owner!==p.owner&&t.id!==p.targetId&&distance(t,{x:p.targetX,y:p.targetY})<=p.splash)this.hit(t,p.damage*.45,p.owner);}}
    this.state.projectiles=this.state.projectiles.filter(p=>p.remaining>0);
    for(const e of this.state.effects)e.time-=dt;this.state.effects=this.state.effects.filter(e=>e.time>0);
    const before=this.state.entities.length;this.state.entities=this.state.entities.filter(e=>e.alive);if(before!==this.state.entities.length){this.population();this.researchQueues();}
    if(this.state.tick%4===0)this.fog();
    if(this.state.tick%20===0){this.population();this.conquest();}
    this.state.stats.entityCount=this.state.entities.length;this.state.stats.tickMs=clock()-start;
  }
  visible(e){if(!this.state.config.fog)return true;const m=this.state.map;return !!this.state.fog.visible[Math.floor(e.y/32)*m.width+Math.floor(e.x/32)];}
  fog(){
    const {visible,explored}=this.state.fog,m=this.state.map;
    if(!this.state.config.fog){visible.fill(1);explored.fill(1);return;}visible.fill(0);
    for(const e of this.state.entities){if(!e.alive||e.owner!==0||e.kind==='resource')continue;const r=(e.vision||150)*(e.kind==='building'&&e.progress<1?.6:1),cx=Math.floor(e.x/32),cy=Math.floor(e.y/32),cells=Math.ceil(r/32);
      for(let y=Math.max(0,cy-cells);y<=Math.min(m.height-1,cy+cells);y++)for(let x=Math.max(0,cx-cells);x<=Math.min(m.width-1,cx+cells);x++)if(Math.hypot((x+.5)*32-e.x,(y+.5)*32-e.y)<=r){visible[y*m.width+x]=1;explored[y*m.width+x]=1;}}
  }
  conquest(){
    for(const p of this.state.players){const remaining=this.state.entities.filter(e=>e.alive&&e.owner===p.id);const heart=remaining.some(e=>e.kind==='building'&&e.type===this.heartType());const resistance=remaining.some(e=>e.kind==='unit'&&e.type!=='worker'||e.kind==='building'&&BUILDINGS[e.type]?.damage);if(!heart&&!resistance){this.state.winner=1-p.id;this.notify(`${this.state.players[1-p.id].name} wins by conquest!`);break;}}
  }
  aiBuild(type,workers){
    const s=this.spawns[1];
    for(let ring=0;ring<5;ring++)for(let i=0;i<16;i++){
      const a=i*Math.PI/8+(ring%2)*.13,r=145+ring*100,x=s.x+Math.cos(a)*r,y=s.y+Math.sin(a)*r;
      if(this.placement(type,x,y)){const result=this.command({type:'build',player:1,ids:workers.slice(0,2).map(w=>w.id),building:type,x,y});if(result.ok)return true;}}
    return false;
  }
  aiTick(){
    const p=this.state.players[1],cfg=this.state.config,difficulty=cfg.difficulty,owned=this.state.entities.filter(e=>e.alive&&e.owner===1),workers=owned.filter(e=>e.type==='worker'),hearts=owned.filter(e=>e.type===this.heartType()),heart=hearts[0];
    const level=difficulty==='hard'?2:difficulty==='easy'?0:1,workerGoal=[16,28,42][level],armyGoal=[14,26,45][level],attackAt=[330,220,150][level];
    const military=owned.filter(e=>e.kind==='unit'&&e.type!=='worker'&&e.type!=='scout');
    this.state.ai.priorities={food:workers.filter(w=>w.gatherResource==='food').length,wood:workers.filter(w=>w.gatherResource==='wood').length,gold:workers.filter(w=>w.gatherResource==='gold').length,workers:workers.length,army:military.length,age:p.age};
    const builder=workers.filter(w=>w.order.type!=='build'&&w.order.type!=='repair');
    const threatened=heart&&this.nearby(heart.x,heart.y,420).filter(e=>e.owner===0&&e.kind==='unit'&&e.type!=='worker');
    // Reserve no more than two builders; all other income is spatial worker gathering.
    const needs={food:5,wood:4,gold:2,stone:1,iron:p.age>=2?2:0,oil:p.age>=3?1:0};
    for(const w of workers){if(w.order.type==='build'||w.order.type==='repair')continue;
      if(w.order.type==='gather'&&this.byId.get(w.order.targetId)?.alive)continue;
      const assignment=Object.keys(needs).filter(r=>needs[r]>0).sort((a,b)=>(p.resources[a]/needs[a])-(p.resources[b]/needs[b]));
      const r=assignment[0]||'food',targets=this.state.entities.filter(e=>e.alive&&(e.kind==='resource'||e.type==='farm')&&e.amount>0&&e.resource===r&&(e.owner<0||e.owner===1)&&distance(w,e)<this.state.map.size*.7).sort((a,b)=>distance(w,a)-distance(w,b));
      if(targets[0])this.command({type:'order',player:1,ids:[w.id],order:{type:'gather',targetId:targets[0].id}});
    }
    const queued=owned.reduce((n,e)=>n+e.queue.filter(q=>q.type==='train').length,0);
    if(builder.length&&p.population+queued>=p.popCap-3&&p.popCap<p.maxPop&&!owned.some(e=>e.type==='house'&&e.progress<1))this.aiBuild('house',builder);
    if(heart&&workers.length<workerGoal&&heart.queue.length<2)this.command({type:'train',player:1,buildingId:heart.id,unit:'worker'});
    const productionTypes=Object.keys(BUILDINGS).filter(k=>BUILDINGS[k].age<=p.age&&(BUILDINGS[k].produces||[]).some(u=>u!=='worker'&&u!=='scout'));
    const age=p.age+1,a=AGE_COSTS[age]||{},prereqs=a.prerequisites||a.requires||[];
    const desired=[...prereqs,...productionTypes.slice(0,Math.max(1,p.age+1))];
    this.state.ai.buildOrder=desired;
    if(builder.length&&heart){const missing=desired.find(k=>BUILDINGS[k]&&BUILDINGS[k].age<=p.age&&!owned.some(e=>e.type===k));if(missing)this.aiBuild(missing,builder);}
    if(heart&&p.age<cfg.endingAge&&this.state.time>[70,55,40][level]*(p.age+1)&&!heart.queue.some(q=>q.type==='advance'))this.command({type:'advance',player:1,buildingId:heart.id});
    for(const b of owned){if(b.kind!=='building'||b.progress<1||b.queue.length>=2)continue;
      const types=(BUILDINGS[b.type]?.produces||[]).filter(k=>UNITS[k]?.age<=p.age&&k!=='worker'&&k!=='scout');
      if(types.length&&military.length<armyGoal){const affordable=types.filter(k=>this.affordable(p,UNITS[k].cost));const type=affordable[Math.floor(this.state.time/13)%Math.max(1,affordable.length)];if(type)this.command({type:'train',player:1,buildingId:b.id,unit:type});}
      if(!types.length&&p.resources.food>250&&p.resources.wood>200){const tech=(BUILDINGS[b.type]?.research||[]).find(k=>TECHNOLOGIES[k]?.age<=p.age&&!p.techs.includes(k));if(tech)this.command({type:'research',player:1,buildingId:b.id,technology:tech});}
    }
    if(!heart){this.state.ai.objective='Last stand';const enemy=this.state.entities.find(e=>e.owner===0&&e.kind==='building');if(enemy)for(const u of military)this.command({type:'order',player:1,ids:[u.id],order:{type:'attackMove',x:enemy.x,y:enemy.y}});return;}
    const enemyHeart=this.state.entities.find(e=>e.owner===0&&e.type===this.heartType());
    const enemy=enemyHeart||this.state.entities.find(e=>e.owner===0&&e.kind==='unit'&&e.type!=='worker')||this.state.entities.find(e=>e.owner===0);
    if(threatened?.length){this.state.ai.objective='Defend the civic heart';const t=threatened[0];for(const u of military)this.command({type:'order',player:1,ids:[u.id],order:{type:'attack',targetId:t.id}});}
    else if(enemy&&this.state.time>=attackAt&&(military.length>=[5,8,12][level]||this.state.ai.attacking)){
      this.state.ai.objective='Assault the opposing settlement';this.state.ai.attacking=true;this.state.ai.target={x:enemy.x,y:enemy.y};
      if(military.length<3&&distance(enemy,heart)>350){this.state.ai.attacking=false;this.state.ai.objective='Retreat and rebuild';for(const u of military)this.command({type:'order',player:1,ids:[u.id],order:{type:'move',x:heart.x-90,y:heart.y+90}});}
      else for(const u of military)if(u.order.type!=='attackMove'&&u.order.type!=='attack')this.command({type:'order',player:1,ids:[u.id],order:{type:'attackMove',x:enemy.x,y:enemy.y}});
    }else {this.state.ai.objective='Gather resources and muster an army';for(const u of military)if(u.order.type==='idle'&&distance(u,heart)>250)this.command({type:'order',player:1,ids:[u.id],order:{type:'move',x:heart.x-120,y:heart.y-90}});}
    const scout=owned.find(e=>e.type==='scout');if(scout&&scout.order.type==='idle'&&this.state.time>45)this.command({type:'order',player:1,ids:[scout.id],order:{type:'patrol',x:this.state.map.size*.5,y:this.state.map.size*.5}});
  }
  cheat(p,code){
    if(!this.state.config.cheats)return this.fail('Cheats are disabled for this match.');code=String(code||'').trim().toUpperCase();
    if(code==='SUN TREASURY'||code==='RESOURCES'){for(const r of RESOURCES)p.resources[r]+=10000;}
    else if(code==='CLEAR SKIES'||code==='REVEAL'){this.state.config.fog=false;this.fog();}
    else if(code==='TIME IS BRONZE'||code==='INSTANT'){for(const b of this.state.entities.filter(e=>e.owner===p.id&&e.kind==='building')){b.progress=1;b.hp=b.maxHp;for(const q of b.queue)q.progress=.99999;}this.population();}
    else if(code==='AGES OF SUN'||code==='AGE'){p.age=this.state.config.endingAge;for(const e of this.state.entities)if(e.owner===p.id&&e.kind==='unit')this.upgradeUnit(e);}
    else if(code==='LEGION UNBOUND'||code==='POPULATION'){p.maxPop=1000;this.state.config.population=1000;p.unbound=true;this.population();}
    else if(code==='SUN SHIELD'||code==='INVULNERABILITY'){p.invulnerable=!p.invulnerable;}
    else if(code.startsWith('DESTROY ')){const id=String(code.slice(8)).toLowerCase(),e=this.byId.get(id);if(!e?.alive||e.kind==='resource')return this.fail('Use DESTROY followed by an existing unit or building id.');const invulnerable=this.state.players[e.owner].invulnerable;this.state.players[e.owner].invulnerable=false;this.hit(e,e.hp+1,p.id);this.state.players[e.owner].invulnerable=invulnerable;this.population();}
    else if(code.startsWith('SPAWN ')){const type=code.slice(6).toLowerCase(),d=UNITS[type],h=this.state.entities.find(e=>e.owner===p.id&&e.type===this.heartType());if(!d||!h)return this.fail('Use SPAWN followed by a valid unit id.');const pos=this.nav.nearest(h.x+h.size+30,h.y+70,d.size);if(pos)this.create('unit',type,p.id,pos.x,pos.y);this.population();}
    else return this.fail('Unknown code. Try SUN TREASURY, CLEAR SKIES, TIME IS BRONZE, AGES OF SUN, LEGION UNBOUND, or SPAWN worker.');
    this.notify(`Cheat activated: ${code}`);return {ok:true};
  }
  snapshot(){return clone(this.state);}
  serialize(){return {version:1,state:clone(this.state),engine:{rng:this.rng,nextId:this.nextId,spawns:clone(this.spawns),paths:clone([...this.paths.entries()]),navRevision:this.nav.revision,navCache:clone([...this.nav.cache.entries()])}};}
  static restore(save){
    if(!save||save.version!==1||!save.state?.map||!Array.isArray(save.state.entities)||!Array.isArray(save.state.players)||save.state.players.length!==2)throw new Error('Unsupported or invalid save.');
    const s=Object.create(Simulation.prototype);s.state=clone(save.state);s.rng=save.engine?.rng??s.state.seed;s.nextId=save.engine?.nextId??100000;s.spawns=save.engine?.spawns||[{x:s.state.map.size*.2,y:s.state.map.size*.25},{x:s.state.map.size*.8,y:s.state.map.size*.75}];s.paths=new Map(clone(save.engine?.paths||[]));s.byId=new Map();s.grid=new Map();s.pathBudget=0;s.nav=new Navigation(s.state.map);s.nav.rebuild(s.state.entities);s.nav.revision=save.engine?.navRevision??s.nav.revision;s.nav.cache=new Map(clone(save.engine?.navCache||[]));s.index();s.population();s.fog();return s;
  }
}
