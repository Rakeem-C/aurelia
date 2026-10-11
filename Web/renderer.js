import { Renderer as ArtRenderer } from './art-renderer.js';
import { UNITS, BUILDINGS } from './catalog.js';

// Retain the original art baker, minimap and projection/input contract.
// The visible battlefield is exclusively rendered by Unity, never a Canvas frame upload.
export class Renderer extends ArtRenderer {
  constructor(canvas, minimap, options={}) {
    const baker=document.createElement('canvas');
    baker.getBoundingClientRect=()=>canvas.getBoundingClientRect();
    super(baker,minimap,options);
    this.realCanvas=canvas;this.canvas=canvas;
    this.spriteKeys=new Set();this.spriteCanvas=document.createElement('canvas');
    this.nativeState=null;this.nativeAtlasCount=-1;this.nativeMatch='';this.resetNumber=0;
    this.resize();
  }
  resize() {
    if(!this.realCanvas)return super.resize();
    const r=this.realCanvas.getBoundingClientRect();this.width=Math.max(1,r.width);this.height=Math.max(1,r.height);this.dpr=1;
    if(this.minimapCanvas){const m=this.minimapCanvas.getBoundingClientRect();this.mw=Math.max(1,m.width);this.mh=Math.max(1,m.height);this.minimapCanvas.width=this.mw;this.minimapCanvas.height=this.mh;}
    this.lastMinimap=-Infinity;this.clampCamera();
  }
  setState(state) {if(this.state&&state.time<this.state.time)this.resetNumber++;super.setState(state);}
  send(method,payload) {window.aureliaUnity.SendMessage('AureliaClient',method,typeof payload==='string'?payload:JSON.stringify(payload));}
  spriteKey(e) {
    const age=this.state.players?.find(p=>p.id===e.owner)?.age||0;
    const face=Math.round((e.facing||0)*4/Math.PI);
    return `${this.atlases.size}:${e.kind}:${e.type}:${e.owner}:${age}:${e.kind==='unit'?face:0}:${e.resource||''}:${e.source||''}:${e.hunted?1:0}`;
  }
  bake(e) {
    const key=this.spriteKey(e);if(this.spriteKeys.has(key))return key;
    const canvas=this.spriteCanvas;const building=e.kind==='building';canvas.width=building?320:160;canvas.height=building?320:160;
    const x=canvas.width/2,y=canvas.height-(building?48:24);const c=canvas.getContext('2d');
    const art={...e,progress:1,stale:false};
    if(building)this.drawBuilding(c,art,x,y);else if(e.kind==='resource')this.drawResource(c,art,x,y);else this.drawUnit(c,art,x,y,0);
    this.send('LoadSprite',{key,png:canvas.toDataURL('image/png').split(',')[1],anchorX:x/canvas.width,anchorY:y/canvas.height});
    this.spriteKeys.add(key);return key;
  }
  render(timestamp, selectedIds=[]) {
    if(!this.state||!window.aureliaUnity)return;
    if(this.lastFrame&&timestamp>this.lastFrame)this.fps+=(1000/(timestamp-this.lastFrame)-this.fps)*.04;this.lastFrame=timestamp;
    const match=`${this.mapKey}:${this.resetNumber}`;
    if(match!==this.nativeMatch){
      this.send('ResetMatch',match);this.nativeMatch=match;this.nativeState=null;
      const count=Math.ceil(this.state.map.size/512);
      for(let y=0;y<count;y++)for(let x=0;x<count;x++)this.send('LoadGround',{key:`ground-${x}-${y}`,x:x*512,y:y*512,size:512,png:this.terrainChunk(x,y).toDataURL('image/png').split(',')[1]});
    }
    if(this.nativeState!==this.state||this.nativeAtlasCount!==this.atlases.size){
      const entities=this.state.entities.filter(e=>e.alive!==false&&(e.owner===0||this.isVisible(e.x,e.y)||(e.owner===-1&&this.isExplored(e.x,e.y))));
      for(const e of this.knownBuildings.values())if(!this.isVisible(e.x,e.y)&&!entities.some(a=>a.id===e.id))entities.push({...e,stale:true});
      const actors=entities.map(e=>{const bounds=this.getEntityScreenBounds(e),anchor=this.worldToScreen(e.x,e.y);return {id:e.id,sprite:this.bake(e),x:e.x,y:e.y,hp:e.hp||1,maxHp:e.maxHp||1,size:e.size||10,height:(anchor.y-bounds.top)/this.camera.zoom,owner:e.owner,opacity:e.stale?.6:e.kind==='building'&&e.progress<1?.3+e.progress*.7:1};});
      const visuals=[...(this.state.projectiles||[]).filter(p=>this.isVisible(p.x,p.y)).map(p=>({id:p.id,type:'projectile',x:p.x,y:p.y,dx:p.targetX-p.startX,dy:p.targetY-p.startY,opacity:1,size:2})),...(this.state.effects||[]).filter(e=>this.isVisible(e.x,e.y)).map(e=>({id:e.id,type:e.type,x:e.x,y:e.y,size:(e.size||8)*(.4+1-(e.time||0)/(e.duration||1)),opacity:Math.max(0,(e.time||0)/(e.duration||1))}))];
      const m=this.state.map;this.send('ApplySnapshot',{match,actors,visuals,map:{width:m.width,height:m.height,cellSize:m.cellSize,visible:this.state.fog.visible,explored:this.state.fog.explored,fog:this.state.config.fog!==false}});
      this.nativeState=this.state;this.nativeAtlasCount=this.atlases.size;
    }
    let placement=null;
    if(this.placement){const p=this.placement;placement={...p,sprite:this.bake({kind:'building',type:p.type,owner:0,size:BUILDINGS[p.type]?.size||30,progress:1})};}
    this.send('ApplyView',{...this.camera,width:this.width,height:this.height,selected:selectedIds,placement,selectionBox:this.selectionBox});
    if(timestamp-this.lastMinimap>100){this.drawMinimap(new Set(selectedIds));this.lastMinimap=timestamp;}
  }
}
