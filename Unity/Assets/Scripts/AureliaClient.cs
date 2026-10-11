using System;
using System.Collections.Generic;
using UnityEngine;
using System.Runtime.InteropServices;

// Unity owns the battlefield, camera, meshes, sprite instances and interpolation.
// The original deterministic Worker supplies simulation snapshots through the Web bridge.
public sealed class AureliaClient : MonoBehaviour
{
    [Serializable] public class Point { public float x, y; }
    [Serializable] public class SpritePacket { public string key, png; public float anchorX, anchorY; }
    [Serializable] public class GroundPacket { public string key, png; public float x, y, size; }
    [Serializable] public class Actor { public string id, sprite; public float x,y,hp,maxHp,size,height; public bool selected; public int owner; public float opacity=1; }
    [Serializable] public class Map { public int width,height; public float cellSize; public int[] visible,explored; public bool fog; }
    [Serializable] public class Visual { public string id,type; public float x,y,dx,dy,size,opacity; }
    [Serializable] public class Snapshot { public string match; public Actor[] actors; public Visual[] visuals; public Map map; }
    [Serializable] public class View { public float x,y,zoom,width,height; public string[] selected; public Ghost placement; public Box selectionBox; }
    [Serializable] public class Ghost { public string sprite; public float x,y; public bool valid; }
    [Serializable] public class Box { public float x1,y1,x2,y2; }
    sealed class Instance { public SpriteRenderer sprite; public Vector3 target; public float height; public LineRenderer ring,bar; public bool initialized; }
    readonly Dictionary<string,Sprite> sprites=new Dictionary<string,Sprite>();
    readonly Dictionary<string,Instance> actors=new Dictionary<string,Instance>();
    readonly Dictionary<string,LineRenderer> visuals=new Dictionary<string,LineRenderer>();
    readonly List<GameObject> grounds=new List<GameObject>();
    Material material; Camera viewCamera; Mesh fogMesh; GameObject fogObject; string match; View view;
    readonly HashSet<string> selected=new HashSet<string>(); LineRenderer drag; SpriteRenderer ghost;
    #if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] static extern void ReportUnityState(int frame,int count);
    #endif
    public static Vector3 Project(float x,float y) => new Vector3(x-y,-(x+y)*.5f,0);

    void Awake()
    {
        gameObject.name="AureliaClient";
        Application.runInBackground=true;
        material=new Material(Shader.Find("Sprites/Default"));
        viewCamera=new GameObject("Battlefield Camera").AddComponent<Camera>();
        viewCamera.orthographic=true; viewCamera.clearFlags=CameraClearFlags.SolidColor;
        viewCamera.backgroundColor=new Color(.063f,.094f,.094f); viewCamera.transform.position=new Vector3(0,0,-10);
        viewCamera.nearClipPlane=.1f; viewCamera.farClipPlane=100;
        drag=Line("Drag selection",50000,Color.yellow); drag.loop=true;
        ghost=new GameObject("Building preview").AddComponent<SpriteRenderer>(); ghost.sortingOrder=40000; ghost.sharedMaterial=material;
        #if UNITY_WEBGL && !UNITY_EDITOR
        WebGLInput.captureAllKeyboardInput=false;
        #endif
    }
    public void LoadSprite(string json)
    {
        var p=JsonUtility.FromJson<SpritePacket>(json); if(sprites.ContainsKey(p.key))return;
        var texture=Decode(p.png); sprites[p.key]=Sprite.Create(texture,new Rect(0,0,texture.width,texture.height),new Vector2(p.anchorX,1-p.anchorY),1);
    }
    Texture2D Decode(string png) { var texture=new Texture2D(2,2,TextureFormat.RGBA32,false); texture.LoadImage(Convert.FromBase64String(png)); texture.filterMode=FilterMode.Bilinear; texture.wrapMode=TextureWrapMode.Clamp; return texture; }
    public void ResetMatch(string id)
    {
        if(match==id)return;match=id;
        foreach(var a in actors.Values)Destroy(a.sprite.gameObject); actors.Clear();
        foreach(var v in visuals.Values)Destroy(v.gameObject);visuals.Clear();
        foreach(var g in grounds)Destroy(g); grounds.Clear(); if(fogObject)Destroy(fogObject);fogObject=null;
    }
    public void LoadGround(string json)
    {
        var p=JsonUtility.FromJson<GroundPacket>(json); var g=new GameObject(p.key);grounds.Add(g);
        var mesh=new Mesh(); mesh.vertices=new[]{Project(p.x,p.y),Project(p.x+p.size,p.y),Project(p.x+p.size,p.y+p.size),Project(p.x,p.y+p.size)};
        mesh.uv=new[]{new Vector2(0,1),new Vector2(1,1),new Vector2(1,0),new Vector2(0,0)};mesh.triangles=new[]{0,1,2,0,2,3};mesh.RecalculateBounds();
        g.AddComponent<MeshFilter>().mesh=mesh;var renderer=g.AddComponent<MeshRenderer>();renderer.material=new Material(material){mainTexture=Decode(p.png)};renderer.sortingOrder=-30000;
    }
    public void ApplySnapshot(string json)
    {
        var p=JsonUtility.FromJson<Snapshot>(json);var current=new HashSet<string>();
        foreach(var e in p.actors)
        {
            current.Add(e.id); if(!actors.TryGetValue(e.id,out var a)){
                var g=new GameObject(e.id);var sprite=g.AddComponent<SpriteRenderer>();sprite.sharedMaterial=material;
                a=new Instance{sprite=sprite};a.ring=Line("Selection",0,new Color(.94f,.83f,.43f));a.ring.transform.SetParent(g.transform,false);a.ring.loop=true;
                a.bar=Line("Health",0,Color.green);a.bar.transform.SetParent(g.transform,false);actors[e.id]=a;
            }
            if(sprites.TryGetValue(e.sprite,out var image)){a.sprite.sprite=image;a.height=e.height;}
            a.sprite.color=new Color(1,1,1,e.opacity);a.target=Project(e.x,e.y);
            if(!a.initialized){a.sprite.transform.position=a.target;a.initialized=true;}
            a.sprite.sortingOrder=Mathf.RoundToInt((e.x+e.y)*2);a.ring.sortingOrder=a.sprite.sortingOrder+1;a.bar.sortingOrder=a.sprite.sortingOrder+2;
            a.ring.positionCount=32;for(int i=0;i<32;i++){float angle=i*Mathf.PI*2/32;a.ring.SetPosition(i,new Vector3(Mathf.Cos(angle)*e.size*1.4f,Mathf.Sin(angle)*e.size*.7f,0));}
            a.bar.positionCount=2;a.bar.SetPosition(0,new Vector3(-12,a.height-5,0));a.bar.SetPosition(1,new Vector3(-12+24*Mathf.Clamp01(e.hp/Mathf.Max(1,e.maxHp)),a.height-5,0));
            a.bar.enabled=e.hp<e.maxHp;
        }
        var dead=new List<string>();foreach(var id in actors.Keys)if(!current.Contains(id))dead.Add(id);foreach(var id in dead){Destroy(actors[id].sprite.gameObject);actors.Remove(id);}
        UpdateVisuals(p.visuals);UpdateFog(p.map);
    }
    void UpdateVisuals(Visual[] packets)
    {
        var current=new HashSet<string>();
        foreach(var p in packets??new Visual[0]){
            current.Add(p.id);if(!visuals.TryGetValue(p.id,out var line)){line=Line(p.type,29000,Color.yellow);visuals[p.id]=line;}
            line.transform.position=Project(p.x,p.y);var color=new Color(.94f,.83f,.48f,p.opacity);line.startColor=line.endColor=color;
            if(p.type=="projectile") {line.loop=false;line.positionCount=2;var direction=Project(p.dx,p.dy).normalized;line.SetPosition(0,-direction*10);line.SetPosition(1,direction*2);}
            else {line.loop=true;line.positionCount=16;for(int i=0;i<16;i++){float angle=i*Mathf.PI*2/16;line.SetPosition(i,new Vector3(Mathf.Cos(angle)*p.size,Mathf.Sin(angle)*p.size*.5f,0));}}
        }
        var dead=new List<string>();foreach(var id in visuals.Keys)if(!current.Contains(id))dead.Add(id);foreach(var id in dead){Destroy(visuals[id].gameObject);visuals.Remove(id);}
    }
    void UpdateFog(Map map)
    {
        if(map==null)return;
        if(!fogObject){fogObject=new GameObject("Fog of war");fogMesh=new Mesh();fogMesh.indexFormat=UnityEngine.Rendering.IndexFormat.UInt32;fogObject.AddComponent<MeshFilter>().mesh=fogMesh;var r=fogObject.AddComponent<MeshRenderer>();r.sharedMaterial=material;r.sortingOrder=30000;}
        int count=map.width*map.height;var v=new Vector3[count*4];var c=new Color[count*4];var tri=new int[count*6];
        for(int i=0;i<count;i++) {float x=i%map.width*map.cellSize,y=i/map.width*map.cellSize,s=map.cellSize;v[i*4]=Project(x,y);v[i*4+1]=Project(x+s,y);v[i*4+2]=Project(x+s,y+s);v[i*4+3]=Project(x,y+s);
            float alpha=!map.fog||map.visible[i]!=0?0:map.explored[i]!=0?.58f:1;for(int j=0;j<4;j++)c[i*4+j]=new Color(.035f,.05f,.055f,alpha);
            int b=i*4,t=i*6;tri[t]=b;tri[t+1]=b+1;tri[t+2]=b+2;tri[t+3]=b;tri[t+4]=b+2;tri[t+5]=b+3;}
        fogMesh.Clear();fogMesh.vertices=v;fogMesh.colors=c;fogMesh.triangles=tri;fogMesh.RecalculateBounds();
    }
    public void ApplyView(string json) { view=JsonUtility.FromJson<View>(json);selected.Clear();if(view.selected!=null)foreach(var id in view.selected)selected.Add(id); }
    LineRenderer Line(string name,int order,Color color) {var line=new GameObject(name).AddComponent<LineRenderer>();line.sharedMaterial=material;line.useWorldSpace=false;line.startWidth=line.endWidth=1.5f;line.startColor=line.endColor=color;line.sortingOrder=order;return line;}
    void Update()
    {
        #if UNITY_WEBGL && !UNITY_EDITOR
        if(Time.frameCount%30==0)ReportUnityState(Time.frameCount,actors.Count);
        #endif
        if(view==null)return;var center=Project(view.x,view.y);viewCamera.transform.position=new Vector3(center.x,center.y,-10);viewCamera.orthographicSize=Mathf.Max(1,view.height/2/Mathf.Max(.1f,view.zoom));
        foreach(var pair in actors){var a=pair.Value;a.sprite.transform.position=Vector3.Lerp(a.sprite.transform.position,a.target,1-Mathf.Exp(-Time.unscaledDeltaTime*22));a.ring.enabled=selected.Contains(pair.Key);}
        ghost.enabled=view.placement!=null&&view.placement.sprite!=null;
        if(ghost.enabled){var p=view.placement;if(sprites.TryGetValue(p.sprite,out var image))ghost.sprite=image;ghost.transform.position=Project(p.x,p.y);ghost.color=p.valid?new Color(.8f,1,.7f,.55f):new Color(1,.4f,.4f,.55f);}
        drag.enabled=view.selectionBox!=null;
        if(drag.enabled){var b=view.selectionBox;drag.positionCount=4;var corners=new[]{new Vector2(b.x1,b.y1),new Vector2(b.x2,b.y1),new Vector2(b.x2,b.y2),new Vector2(b.x1,b.y2)};for(int i=0;i<4;i++)drag.SetPosition(i,new Vector3(center.x+(corners[i].x-view.width/2)/view.zoom,center.y-(corners[i].y-view.height/2)/view.zoom,0));}
    }
}
