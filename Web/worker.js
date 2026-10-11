import {Simulation} from './simulation.js';
let simulation=null, paused=false,speed=1,accumulator=0,last=performance.now(),lastPublish=0;
const publish=()=>{if(simulation) postMessage({type:'state',state:simulation.snapshot()});};
self.onmessage=({data})=>{
 try {
  if(data.type==='init'){simulation=new Simulation(data.config);paused=false;speed=1;accumulator=0;last=performance.now();publish();}
  else if(data.type==='command'&&simulation){const result=simulation.command(data.command);postMessage({type:'result',id:data.id,result});publish();}
  else if(data.type==='pause'){paused=Boolean(data.paused);accumulator=0;last=performance.now();publish();}
  else if(data.type==='speed'){speed=[1,2,4].includes(data.speed)?data.speed:1;}
  else if(data.type==='save'&&simulation){postMessage({type:'save',id:data.id,save:simulation.serialize()});}
  else if(data.type==='load'){simulation=Simulation.restore(data.save);paused=false;accumulator=0;last=performance.now();publish();}
 }catch(error){postMessage({type:'error',message:error.message});}
};
setInterval(()=>{
 const now=performance.now();const elapsed=Math.min((now-last)/1000,.25);last=now;
 if(!simulation||paused||simulation.state.winner!==null) return;
 accumulator+=elapsed*speed;
 try {let steps=0;while(accumulator>=.05&&steps++<20){simulation.tick(.05);accumulator-=.05;}if(now-lastPublish>=100){publish();lastPublish=now;}}
 catch(error){paused=true;postMessage({type:'error',message:`Simulation stopped: ${error.message}`});}
},20);
