const canvas=document.getElementById('battlefield');
const status=document.createElement('div');status.id='unity-loading';status.setAttribute('role','status');
status.style.cssText='position:fixed;inset:0;z-index:10000;display:grid;place-content:center;background:#151814;color:#dcc58b;font:20px Georgia;text-align:center';
status.textContent='AURELIA · Starting Unity';document.body.append(status);
try {
  const manifest=await fetch('./unity-build.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('Unity build manifest unavailable');return r.json();});
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=manifest.loaderUrl;script.onload=resolve;script.onerror=()=>reject(new Error('Unity loader unavailable'));document.head.append(script);});
  window.aureliaUnity=await createUnityInstance(canvas,{...manifest,companyName:'Automationation',productName:'AURELIA: Empires of the Sun',productVersion:'1.0.0',devicePixelRatio:Math.min(1.5,devicePixelRatio),matchWebGLToCanvasSize:true},progress=>{status.textContent=`AURELIA · Loading Unity ${Math.round(progress*100)}%`;});
  document.documentElement.dataset.engine='unity';
  await import('./main.js');status.remove();
} catch(error){status.textContent=`Unity could not start: ${error.message}. Reload to retry.`;console.error(error);}
