// Deterministic navigation: cached strategic A* plus cheap line-of-sight paths.
export class Navigation {
  constructor(map) { this.map=map; this.blocked=new Uint8Array(map.width*map.height); this.ownerBlocked=[new Uint8Array(map.width*map.height),new Uint8Array(map.width*map.height)];this.cache=new Map();this.fields=new Map(); this.revision=0; this.buildings=[];this.buildingGrid=new Map(); }
  rebuild(entities) {
    this.buildings=entities.filter(e=>e.alive&&e.kind==='building'&&e.type!=='farm');
    this.blocked.fill(0);for(const grid of this.ownerBlocked)grid.fill(0);this.buildingGrid.clear();
    const {width,height,cellSize}=this.map;
    for(const b of this.buildings){
      const key=`${Math.floor(b.x/128)},${Math.floor(b.y/128)}`;if(!this.buildingGrid.has(key))this.buildingGrid.set(key,[]);this.buildingGrid.get(key).push(b);
      for(let y=Math.max(0,Math.floor((b.y-b.size-7)/cellSize));y<=Math.min(height-1,Math.floor((b.y+b.size+7)/cellSize));y++)
        for(let x=Math.max(0,Math.floor((b.x-b.size-7)/cellSize));x<=Math.min(width-1,Math.floor((b.x+b.size+7)/cellSize));x++)
          if(Math.hypot((x+.5)*cellSize-b.x,(y+.5)*cellSize-b.y)<b.size+cellSize*.55){const i=y*width+x;this.blocked[i]=1;for(let owner=0;owner<2;owner++)if(b.type!=='gate'||b.owner!==owner)this.ownerBlocked[owner][i]=1;}
    }
    this.cache.clear();this.fields.clear(); this.revision++;
  }
  free(x,y,r=8,owner=-1) {
    const m=this.map; if(x<r||y<r||x>m.size-r||y>m.size-r)return false;
    for(const [dx,dy] of [[0,0],[r,0],[-r,0],[0,r],[0,-r]]){
      const cx=Math.floor((x+dx)/m.cellSize),cy=Math.floor((y+dy)/m.cellSize);
      if(m.terrain[cy*m.width+cx])return false;
    }
    for(let cy=Math.floor((y-r-70)/128);cy<=Math.floor((y+r+70)/128);cy++)for(let cx=Math.floor((x-r-70)/128);cx<=Math.floor((x+r+70)/128);cx++)for(const b of this.buildingGrid.get(`${cx},${cy}`)||[])if((b.type!=='gate'||b.owner!==owner)&&Math.abs(x-b.x)<b.size+r&&Math.abs(y-b.y)<b.size+r&&Math.hypot(x-b.x,y-b.y)<b.size+r)return false;
    return true;
  }
  line(x,y,tx,ty,r=8,owner=-1) {
    const steps=Math.max(1,Math.ceil(Math.hypot(tx-x,ty-y)/14));
    for(let i=1;i<=steps;i++)if(!this.free(x+(tx-x)*i/steps,y+(ty-y)*i/steps,r,owner))return false;
    return true;
  }
  nearest(x,y,r=8,owner=-1) {
    x=Math.max(r,Math.min(this.map.size-r,x));y=Math.max(r,Math.min(this.map.size-r,y));
    if(this.free(x,y,r,owner))return {x,y};
    for(let ring=1;ring<20;ring++)for(let i=0;i<24;i++){
      const a=i*Math.PI/12,px=x+Math.cos(a)*ring*16,py=y+Math.sin(a)*ring*16;
      if(this.free(px,py,r,owner))return {x:px,y:py};
    }
    return null;
  }
  path(x,y,tx,ty,r=8,owner=-1) {
    const goal=this.nearest(tx,ty,r,owner);if(!goal)return [];
    if(this.line(x,y,goal.x,goal.y,r,owner))return [goal];
    const m=this.map,w=m.width,c=m.cellSize;
    const sx=Math.floor(x/c),sy=Math.floor(y/c),gx=Math.floor(goal.x/c),gy=Math.floor(goal.y/c);
    const key=`${sx},${sy}:${gx},${gy}:${Math.ceil(r/8)}:${owner}`;
    if(this.cache.has(key)){const cached=this.cache.get(key).map(p=>({...p}));if(cached.length)cached[cached.length-1]=goal;return cached;}
    const start=sy*w+sx,end=gy*w+gx,n=w*m.height,blocked=this.ownerBlocked[owner]||this.blocked;
    // A reverse cardinal field is shared by every unit seeking the same destination.
    // This turns a group crossing a maze into one grid search, rather than hundreds.
    const fieldKey=`${end}:${owner}`,existing=this.fields.get(fieldKey);
    let field=existing;
    if(!field){field=new Int32Array(n);field.fill(-1);const queue=new Int32Array(n);let head=0,tail=1;queue[0]=end;field[end]=end;
      while(head<tail){const cur=queue[head++],cx=cur%w,cy=Math.floor(cur/w);
        for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]]){const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=w||ny>=m.height)continue;const ni=ny*w+nx;if(field[ni]!==-1||m.terrain[ni]||blocked[ni])continue;field[ni]=cur;queue[tail++]=ni;}}
      if(this.fields.size>64)this.fields.clear();this.fields.set(fieldKey,field);}
    if(field[start]!==-1){
      const raw=[];let cur=start;for(let i=0;i<n&&cur!==end;i++){cur=field[cur];if(cur<0)break;raw.push(cur===end?goal:{x:(cur%w+.5)*c,y:(Math.floor(cur/w)+.5)*c});}
      const path=[];let anchor={x,y},i=0;while(i<raw.length){let j=Math.min(raw.length-1,i+12);while(j>i&&!this.line(anchor.x,anchor.y,raw[j].x,raw[j].y,r,owner))j--;path.push(raw[j]);anchor=raw[j];i=j+1;}
      if(this.cache.size>700)this.cache.clear();this.cache.set(key,path);return path.map(p=>({...p}));
    }
    const g=new Float32Array(n);g.fill(Infinity);g[start]=0;
    const parent=new Int32Array(n);parent.fill(-1);
    const closed=new Uint8Array(n),heap=[];
    const push=(id,f)=>{let i=heap.length;heap.push({id,f});while(i){let p=(i-1)>>1;if(heap[p].f<=f)break;heap[i]=heap[p];i=p;}heap[i]={id,f};};
    const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1].f<heap[j].f)j++;if(last.f<=heap[j].f)break;heap[i]=heap[j];i=j;}heap[i]=last;}return top;};
    push(start,0);let reached=false,visits=0;
    while(heap.length&&visits++<7000){const cur=pop().id;if(closed[cur])continue;closed[cur]=1;if(cur===end){reached=true;break;}const cx=cur%w,cy=Math.floor(cur/w);
      for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
        const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=w||ny>=m.height)continue;
        const ni=ny*w+nx;if(closed[ni]||m.terrain[ni]||(blocked[ni]&&ni!==end))continue;
        if(dx&&dy&&(m.terrain[cy*w+nx]||m.terrain[ny*w+cx]||blocked[cy*w+nx]||blocked[ny*w+cx]))continue;
        const ng=g[cur]+(dx&&dy?1.414214:1);if(ng>=g[ni])continue;g[ni]=ng;parent[ni]=cur;push(ni,ng+Math.hypot(nx-gx,ny-gy));
      }
    }
    if(!reached)return [];
    const raw=[];for(let i=end;i!==start&&i!==-1;i=parent[i])raw.push(i===end?goal:{x:(i%w+.5)*c,y:(Math.floor(i/w)+.5)*c});raw.reverse();
    const path=[];let anchor={x,y},i=0;
    while(i<raw.length){let j=Math.min(raw.length-1,i+10);while(j>i&&!this.line(anchor.x,anchor.y,raw[j].x,raw[j].y,r,owner))j--;path.push(raw[j]);anchor=raw[j];i=j+1;}
    if(this.cache.size>700)this.cache.clear();this.cache.set(key,path);return path.map(p=>({...p}));
  }
}
