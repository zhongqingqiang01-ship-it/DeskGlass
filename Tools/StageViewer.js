import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HorizontalBlurShader} from 'three/addons/shaders/HorizontalBlurShader.js';
import {VerticalBlurShader} from 'three/addons/shaders/VerticalBlurShader.js';
import {buildGundam} from './stage/gundam.js';
import {buildPet} from './stage/pet.js';

const catalog = {
  ferrari: {label:'Ferrari 458 Italia',author:'vicent091036 · CC BY 4.0'},
  gundam: {label:'自由高达',author:'3d66 模型 · DeskGlass 绑定',build:buildGundam,model:true},
  pet: {label:'电子小狗',author:'DeskGlass 程序化建模',build:buildPet}
};
const canvas = document.querySelector('canvas');
// The public edition enables only redistributable assets. A private local GLB can enable the animation adapter.
if (!window.DeskGlassStageAssets?.includes('gundam')) delete catalog.gundam;
const status = document.getElementById('status');
let renderer, scene, camera, controls, content, mixer, clips = [], shadows = [];
let selected = null, requested = null, generation = 0, paint = '#b3111f';
let autoRotate = false, visible = true, framePending = false, lastTime = 0;
let wheels = [], wheelUntil = 0, actionUntil = 0, actor = null, petSaved = null, lastRender = 0, press = null;
let studioKey, studioRim, sunRig = null, fitted = 0, pull = null, frameWidth = 1;
const pending = new Map();
const report = (message, extra={}) => {
  status.textContent = message;
  window.webkit?.messageHandlers?.stage?.postMessage({message,model:selected,...extra});
};
window.addEventListener('error', event => report('展示区发生错误，请点击复位重试',{error:String(event.message)}));
window.addEventListener('unhandledrejection', event => report('模型暂时无法显示，请重新选择',{error:String(event.reason)}));

window.DeskGlassModelData = (key, encoded) => {
  const waiter = pending.get(key); if (!waiter) return;
  const decoded = atob(encoded), bytes = new Uint8Array(decoded.length);
  for (let i=0;i<decoded.length;i++) bytes[i] = decoded.charCodeAt(i);
  pending.delete(key); waiter.resolve(bytes.buffer);
};
function modelData(key) {
  return new Promise((resolve,reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => {pending.delete(key);script.remove();reject(new Error('Local model timed out'));},25000);
    pending.set(key,{resolve:data=>{clearTimeout(timer);resolve(data);}});
    script.src = `models/${key}.js`;
    script.onerror = () => {clearTimeout(timer);pending.delete(key);script.remove();reject(new Error('Missing bundled model: '+key));};
    script.onload = () => script.remove();
    document.head.appendChild(script);
  });
}
function release(object) {
  if (!object) return;
  const textures = new Set(), materials = new Set();
  object.traverse(node => {
    node.geometry?.dispose();
    if(node.material) for(const material of [].concat(node.material)) {
      materials.add(material);
      for(const value of Object.values(material)) if(value?.isTexture) textures.add(value);
    }
  });
  textures.forEach(texture=>{texture.source?.data?.close?.();texture.dispose();});
  materials.forEach(material=>material.dispose());
  object.removeFromParent();
}
// Photo-studio lighting baked into the reflection map: dark cyclorama, one wide overhead softbox and long strip lights
// so lacquer, chrome and glass pick up clean highlight lines instead of the blown-out room reflections.
function studioEnvironment() {
  const studio = new THREE.Scene();
  const cyclorama = new THREE.Mesh(new THREE.SphereGeometry(30,48,24),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
    vertexShader:'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec3 vDir;void main(){float y=vDir.y;vec3 floorColor=vec3(0.018,0.02,0.026);vec3 horizon=vec3(0.13,0.145,0.17);vec3 top=vec3(0.05,0.056,0.07);vec3 c=y<0.0?mix(horizon,floorColor,smoothstep(0.0,0.35,-y)):mix(horizon,top,smoothstep(0.0,0.6,y));gl_FragColor=vec4(c,1.0);}'}));
  studio.add(cyclorama);
  const panel = (width,height,intensity,tint,position,target) => {
    const material = new THREE.MeshBasicMaterial({color:tint,side:THREE.DoubleSide,toneMapped:false});
    material.color.multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
    mesh.position.set(...position);mesh.lookAt(...target);studio.add(mesh);
  };
  panel(16,7,3.2,0xffffff,[0,11,0],[0,0,0]);
  panel(1.1,22,7,0xf4f7ff,[-10,4.5,0],[0,1.5,0]);
  panel(1.1,22,6,0xf4f7ff,[10,4.5,0],[0,1.5,0]);
  panel(22,0.7,4,0xffffff,[0,2.8,11],[0,1.5,0]);
  panel(22,0.7,3,0xffffff,[0,2.8,-11],[0,1.5,0]);
  panel(3,8,2.2,0xffe6cc,[-8,5,8],[0,1,0]);
  panel(3,8,1.8,0xd2e2ff,[8,5,-8],[0,1,0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(studio,0.02).texture;
  studio.traverse(node=>{node.geometry?.dispose();node.material?.dispose();});
  pmrem.dispose();
  return texture;
}
// Soft contact shadow rendered once from below the object (depth → blur), like a product shot on a seamless floor.
function contactShadow(bounds,{spread,height,blur,darkness,opacity,resolution=512}) {
  const size=bounds.getSize(new THREE.Vector3());
  const width=size.x*spread+size.y*0.6,depth=size.z*spread+size.y*0.6;
  const group=new THREE.Group();group.position.set((bounds.min.x+bounds.max.x)/2,0.002,(bounds.min.z+bounds.max.z)/2);
  const target=new THREE.WebGLRenderTarget(resolution,resolution),blurTarget=new THREE.WebGLRenderTarget(resolution,resolution);
  target.texture.generateMipmaps=blurTarget.texture.generateMipmaps=false;
  const geometry=new THREE.PlaneGeometry(width,depth).rotateX(Math.PI/2);
  const plane=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:target.texture,opacity,transparent:true,depthWrite:false}));
  plane.scale.y=-1;plane.renderOrder=1;group.add(plane);
  const blurPlane=new THREE.Mesh(geometry);blurPlane.visible=false;group.add(blurPlane);
  const camera=new THREE.OrthographicCamera(-width/2,width/2,depth/2,-depth/2,0,height);camera.rotation.x=Math.PI/2;group.add(camera);
  const depthMaterial=new THREE.MeshDepthMaterial({depthTest:false,depthWrite:false,side:THREE.DoubleSide});
  depthMaterial.onBeforeCompile=shader=>{
    shader.uniforms.darkness={value:darkness};
    shader.fragmentShader='uniform float darkness;\n'+shader.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );','gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );');
  };
  const horizontal=new THREE.ShaderMaterial({...HorizontalBlurShader,uniforms:THREE.UniformsUtils.clone(HorizontalBlurShader.uniforms),depthTest:false});
  const vertical=new THREE.ShaderMaterial({...VerticalBlurShader,uniforms:THREE.UniformsUtils.clone(VerticalBlurShader.uniforms),depthTest:false});
  const blurPass=amount=>{
    blurPlane.visible=true;
    blurPlane.material=horizontal;horizontal.uniforms.tDiffuse.value=target.texture;horizontal.uniforms.h.value=amount/256;
    renderer.setRenderTarget(blurTarget);renderer.render(blurPlane,camera);
    blurPlane.material=vertical;vertical.uniforms.tDiffuse.value=blurTarget.texture;vertical.uniforms.v.value=amount/256;
    renderer.setRenderTarget(target);renderer.render(blurPlane,camera);
    blurPlane.visible=false;
  };
  return {group,
    render(){
      const clearAlpha=renderer.getClearAlpha();
      scene.overrideMaterial=depthMaterial;renderer.setClearAlpha(0);
      renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);
      scene.overrideMaterial=null;
      blurPass(blur);blurPass(blur*0.4);
      renderer.setRenderTarget(null);renderer.setClearAlpha(clearAlpha);
    },
    dispose(){group.removeFromParent();target.dispose();blurTarget.dispose();geometry.dispose();plane.material.dispose();depthMaterial.dispose();horizontal.dispose();vertical.dispose();}
  };
}
// The model's yellow badges are untextured flat polygons. Paint them with the prancing horse traced from the model's own
// chrome grille emblem (front view, so it faces left like the real badge), then project UVs per badge so it reads upright.
function ferrariBadges(model) {
  model.updateMatrixWorld(true);
  const horse=[],point=new THREE.Vector3(),grille=model.getObjectByName('chrome');
  if(grille?.geometry){
    const position=grille.geometry.attributes.position,index=grille.geometry.index,count=index?index.count:position.count;
    const inside=p=>p.x>-0.04&&p.x<0.035&&p.y>0.24&&p.y<0.34&&p.z>-2.21&&p.z<-2.19;
    for(let i=0;i<count;i+=3){
      const triangle=[0,1,2].map(k=>point.fromBufferAttribute(position,index?index.getX(i+k):i+k).applyMatrix4(grille.matrixWorld).clone());
      if(triangle.every(inside))horse.push(triangle);
    }
  }
  const drawHorse=(context,cx,cy,height)=>{
    if(!horse.length)return;
    const scale=height/0.091,mx=-0.0015,my=0.2885;
    context.fillStyle=context.strokeStyle='#0b0b0c';context.lineWidth=1;context.lineJoin='round';
    for(const triangle of horse){
      context.beginPath();
      triangle.forEach((p,k)=>context[k?'lineTo':'moveTo'](cx-(p.x-mx)*scale,cy-(p.y-my)*scale));
      context.closePath();context.fill();context.stroke();
    }
  };
  const yellow='#f5c400',flag=['#009246','#f4f4f2','#ce2b37'];
  const badge=kind=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    const context=canvas.getContext('2d');
    context.fillStyle=yellow;context.fillRect(0,0,512,512);
    const band=kind==='shield'?64:44;
    flag.forEach((color,i)=>{context.fillStyle=color;context.fillRect(i*512/3,0,512/3+1,band);});
    context.fillStyle='#0b0b0c';context.fillRect(0,band,512,kind==='shield'?6:4);
    if(kind==='shield'){
      drawHorse(context,262,250,270);
      context.font='bold 72px "Times New Roman", Georgia, serif';context.textAlign='center';context.textBaseline='middle';
      context.fillText('S',160,410);context.fillText('F',352,410);
    } else drawHorse(context,258,290,330);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    return new THREE.MeshPhysicalMaterial({map:texture,metalness:0,roughness:0.55,clearcoat:0.45,clearcoatRoughness:0.08,envMapIntensity:0.55});
  };
  const shield=badge('shield'),disc=badge('disc');
  const centre=new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()),driver=new THREE.Vector3(-0.35,0.95,0.4);
  // Each connected piece gets a planar projection: normal = least-spread axis facing the viewer, up = world up (or rearward on flat parts).
  const project=(mesh,material,viewer)=>{
    mesh.geometry=mesh.geometry.clone();
    const geometry=mesh.geometry,position=geometry.attributes.position,index=geometry.index,count=position.count;
    const parent=Array.from({length:count},(_,i)=>i),find=i=>{while(parent[i]!==i)i=parent[i]=parent[parent[i]];return i;};
    if(index)for(let i=0;i<index.count;i+=3){const a=find(index.getX(i));parent[find(index.getX(i+1))]=a;parent[find(index.getX(i+2))]=a;}
    const seen=new Map();
    for(let i=0;i<count;i++){const key=[position.getX(i),position.getY(i),position.getZ(i)].map(v=>v.toFixed(4)).join();if(seen.has(key))parent[find(i)]=find(seen.get(key));else seen.set(key,i);}
    const groups=new Map(),world=[];
    for(let i=0;i<count;i++){world[i]=point.fromBufferAttribute(position,i).applyMatrix4(mesh.matrixWorld).clone();const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(i);}
    const uv=new Float32Array(count*2);
    for(const ids of groups.values()){
      const middle=new THREE.Box3().setFromPoints(ids.map(i=>world[i])).getCenter(new THREE.Vector3());
      const toViewer=viewer(middle);
      if(toViewer===null){for(const i of ids){uv[i*2]=0.04;uv[i*2+1]=0.5;}continue;}
      // A flat badge's covariance has rank 2, so the cross product of two of its rows is the badge normal.
      const e=new Array(9).fill(0);
      for(const i of ids){const d=world[i].clone().sub(middle);const v=[d.x,d.y,d.z];for(let r=0;r<3;r++)for(let k=0;k<3;k++)e[r*3+k]+=v[r]*v[k];}
      const rows=[0,1,2].map(r=>new THREE.Vector3(e[r*3],e[r*3+1],e[r*3+2]));
      const candidates=[rows[0].clone().cross(rows[1]),rows[1].clone().cross(rows[2]),rows[2].clone().cross(rows[0])];
      const normal=candidates.reduce((a,b)=>b.lengthSq()>a.lengthSq()?b:a).normalize();
      if(normal.dot(toViewer)<0)normal.negate();
      let up=new THREE.Vector3(0,1,0).projectOnPlane(normal);
      if(up.lengthSq()<0.25)up=new THREE.Vector3(0,0,1).projectOnPlane(normal);
      up.normalize();const right=up.clone().cross(normal).normalize();
      let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
      for(const i of ids){const d=world[i].clone().sub(middle),u=d.dot(right),v=d.dot(up);minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v);}
      const span=Math.max(maxU-minU,maxV-minV,1e-6),square=material===disc;
      for(const i of ids){
        const d=world[i].clone().sub(middle),u=d.dot(right),v=d.dot(up);
        uv[i*2]=square?0.5+u/span:(u-minU)/Math.max(maxU-minU,1e-6);
        uv[i*2+1]=square?0.5+v/span:(v-minV)/Math.max(maxV-minV,1e-6);
      }
    }
    geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    mesh.material=material;
  };
  const outward=middle=>middle.clone().sub(centre);
  model.traverse(node=>{
    if(!node.isMesh)return;
    // The dashboard dial in yellow_trim stays plain yellow; only the exterior shields and nose badge get the crest.
    if(node.name==='yellow_trim')project(node,shield,middle=>middle.z>-0.75&&Math.abs(middle.x)<0.6?null:outward(middle));
    else if(/^centre(_\d+)?$/.test(node.name))project(node,disc,outward);
    else if(node.name==='steering_centre')project(node,disc,middle=>driver.clone().sub(middle));
  });
}
function renderShadows() {
  if(!shadows.length)return;
  // Glow effects (flames, blades, speech bubbles) must not darken the floor.
  const glows=[actor?.fx,sunRig,...(actor?.glows??[])].filter(Boolean),states=glows.map(node=>node.visible);
  glows.forEach(node=>node.visible=false);
  for(const shadow of shadows)shadow.group.visible=false;
  for(const shadow of shadows)shadow.render();
  for(const shadow of shadows)shadow.group.visible=true;
  glows.forEach((node,i)=>node.visible=states[i]);
}
function init() {
  renderer = new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2));
  renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(24,1,0.01,200);
  bindPointer();
  controls = new OrbitControls(camera,canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false; controls.minPolarAngle = 0.25; controls.maxPolarAngle = Math.PI * 0.485;
  controls.minDistance = 3; controls.maxDistance = 20; controls.rotateSpeed = 0.6; controls.zoomSpeed = 0.7;
  controls.addEventListener('change',schedule);
  scene.environment = studioEnvironment();
  scene.environmentIntensity = 1.0;
  const key = studioKey = new THREE.DirectionalLight(0xfff4e8,1.1);
  key.position.set(-2.5,8,-3); key.castShadow = true;
  key.shadow.mapSize.set(2048,2048);
  key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=5;key.shadow.camera.bottom=-5;
  key.shadow.bias = -0.0002; key.shadow.normalBias = 0.03; key.shadow.radius = 5;
  scene.add(key);
  const rim = studioRim = new THREE.DirectionalLight(0xbcd2ff,0.55);rim.position.set(6,2.5,7);scene.add(rim);
  new ResizeObserver(resize).observe(document.documentElement);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();report('图形资源已暂停，请点击复位重新加载',{error:'contextlost'});});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());
  canvas.addEventListener('dblclick',event=>{if(actor?.dblclick)actor.dblclick(pointerInfo(event));else action();schedule();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  resize();
}
// The native control bar, and above it the exhibit's title, float over the bottom of the canvas; the projection centre
// is placed so exhibits are framed in the area above them. Tall exhibits use the whole height down to the bar (the
// title may overlap their feet); the others stay clear of the title in a landscape band at the bottom of the canvas.
const TITLE_INSET = 100, BAR_INSET = 56;
function viewArea() {
  const width=Math.max(1,document.documentElement.clientWidth),height=Math.max(1,document.documentElement.clientHeight);
  const bottom=actor?.tall?BAR_INSET:TITLE_INSET;
  if(height<=bottom*2.5)return {width,height,bottom:0,top:0};
  return {width,height,bottom,top:actor?.tall?0:Math.max(0,height-bottom-width*0.5)};
}
function usableShare() { const {height,bottom,top}=viewArea(); return Math.max(0.4,(height-bottom-top)/height); }
// Shifts the projection centre to the middle of the view area: up by half the bottom inset, down by half the top one.
function project() {
  const {width,height,bottom,top}=viewArea(),shift=bottom-top,full=height+Math.abs(shift);
  renderer.setSize(width,height,false);camera.aspect=width/full;
  camera.setViewOffset(width,full,0,Math.max(0,shift),width,height);camera.updateProjectionMatrix();
}
function resize() { if(!renderer)return; project();refit();schedule(); }
// Camera distance at which the box fills ~80% of the width or ~72% of the height from this direction.
function fitDistance(bounds,target,direction) {
  const radius=bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const halfFov=THREE.MathUtils.degToRad(camera.fov/2);
  let distance=radius/Math.sin(Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect)))*1.1;
  const corners=[];
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])corners.push(new THREE.Vector3(x,y,z));
  for(let i=0;i<6;i++){
    camera.position.copy(target).addScaledVector(direction,distance);
    camera.lookAt(target);camera.updateMatrixWorld();
    const projected=corners.map(point=>point.clone().project(camera));
    const spanX=Math.max(...projected.map(p=>p.x))-Math.min(...projected.map(p=>p.x));
    const spanY=Math.max(...projected.map(p=>p.y))-Math.min(...projected.map(p=>p.y));
    const ratio=Math.max(spanX/1.6,spanY/(2*(actor?.fill??0.725)*usableShare()));
    if(Math.abs(ratio-1)<0.025)break;
    distance=Math.max(radius*1.25,distance*THREE.MathUtils.clamp(ratio,0.65,1.45));
  }
  return distance;
}
function home() {
  if(!content)return;
  const bounds=actor?actor.frame.clone():new THREE.Box3().setFromObject(content),size=bounds.getSize(new THREE.Vector3());
  // Orbit pivot as a share of the frame's height (`aim`): lower pivots sit the exhibit higher in the view.
  const target=new THREE.Vector3(0,Math.max(0.3,size.y*(actor?.aim??(actor?.fill?0.5:0.4))),0);
  const radius=bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const direction=(selected==='ferrari'?new THREE.Vector3(5.2,1.55,-5.0):selected==='pet'?new THREE.Vector3(2.2,2.3,5.6):new THREE.Vector3(3.2,1.1,5.6)).normalize();
  const distance=fitDistance(bounds,target,direction);
  camera.position.copy(target).addScaledVector(direction,distance);
  controls.target.copy(target);
  // Exhibits that move (wings, hovering, roaming) open at their largest size that still fits the view; they can only be
  // zoomed out from there.
  fitted=actor?distance:0;pull=null;frameWidth=projectedWidth(bounds);
  controls.minDistance=actor?distance:Math.max(2,radius*1.6);controls.maxDistance=Math.max(14,distance*2.2);
  controls.update();schedule();
}
// After the canvas changes shape, keep the viewer's zoom and angle but never let the exhibit overflow the window.
function refit() {
  if(!actor||!content||!fitted)return;
  const offset=camera.position.clone().sub(controls.target),zoom=offset.length()/fitted,direction=offset.normalize();
  fitted=fitDistance(actor.frame,controls.target,direction);
  controls.minDistance=fitted;
  camera.position.copy(controls.target).addScaledVector(direction,fitted);frameWidth=projectedWidth(actor.frame);
  camera.position.copy(controls.target).addScaledVector(direction,fitted*Math.max(zoom,1));
  controls.update();
}
// Share of the canvas width the box takes from the current camera.
function projectedWidth(bounds) {
  camera.updateMatrixWorld();
  const xs=[];
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])xs.push(new THREE.Vector3(x,y,z).project(camera).x);
  return (Math.max(...xs)-Math.min(...xs))/2;
}
// While an exhibit grows past its framing box (opened wings, hovering) the camera eases back and up by the same factor,
// so nothing leaves the window (its feet stay put on screen); it returns to the viewer's own distance afterwards.
function keepInFrame() {
  if(!actor?.reach||!fitted)return;
  const {up,out}=actor.reach(),grow=Math.max(1+up,out*frameWidth/0.92);
  if(grow<1.0005&&!pull)return;
  if(!pull)pull={distance:camera.position.distanceTo(controls.target),y:controls.target.y};
  const direction=camera.position.clone().sub(controls.target).normalize();
  controls.target.y=pull.y*grow;
  camera.position.copy(controls.target).addScaledVector(direction,pull.distance*grow);
  if(grow<1.0005)pull=null;
}
// Sunlight for exhibits that ask for it: one warm sun from the viewer's upper right that stays there as the camera
// orbits (like turning the model on a turntable under a fixed lamp), a bright sky with warm bounce from the ground, a
// soft fill from the front left so the shaded side keeps its detail, a cool back light and an invisible ground that
// only shows the cast shadow.
function buildSunRig() {
  const rig=new THREE.Group();
  const sun=new THREE.DirectionalLight(0xfff0dc,3.4);
  sun.position.set(6.5,10,5);sun.target.position.set(0,1.8,0);
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-5.5,right:5.5,top:5.5,bottom:-5.5,near:2,far:32});
  sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.025;
  const sky=new THREE.HemisphereLight(0xcfe0ff,0x6a6058,1.6);
  const fill=new THREE.DirectionalLight(0xe8eeff,1.0);fill.position.set(-5,3,7);
  const back=new THREE.DirectionalLight(0x9fbaff,0.7);back.position.set(-6,4,-7);
  // The long sun shadow fades out away from the exhibit instead of ending at the edge of the canvas.
  const shade=new THREE.ShadowMaterial({opacity:0.42,depthWrite:false});
  shade.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vGround;\n'+shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvGround=worldPosition.xyz;');
    shader.fragmentShader='varying vec3 vGround;\n'+shader.fragmentShader.replace('opacity * ( 1.0 - getShadowMask() )','opacity * ( 1.0 - getShadowMask() ) * ( 1.0 - smoothstep( 1.6, 3.2, length( vGround.xz ) ) )');
  };
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(20,20).rotateX(-Math.PI/2),shade);
  ground.position.y=0.003;ground.receiveShadow=true;ground.renderOrder=-1;
  rig.add(sun,sun.target,sky,fill,back,ground);
  return rig;
}
function applyLighting(mode) {
  const sunny=mode==='sun';
  if(sunny&&!sunRig){sunRig=buildSunRig();scene.add(sunRig);}
  if(sunRig)sunRig.visible=sunny;
  studioKey.visible=studioRim.visible=!sunny;
  scene.environmentIntensity=sunny?0.75:1.0;
  renderer.toneMappingExposure=sunny?1.1:1.0;
  renderer.shadowMap.needsUpdate=true;
}
function followSun() {
  if(!sunRig?.visible)return;
  const azimuth=Math.atan2(camera.position.x-controls.target.x,camera.position.z-controls.target.z);
  if(Math.abs(azimuth-sunRig.rotation.y)>1e-4){sunRig.rotation.y=azimuth;renderer.shadowMap.needsUpdate=true;}
}
function updatePaint() {
  if(selected!=='ferrari'||!content)return;
  const body=content.getObjectByName('body');
  if(body?.material?.color) body.material.color.set(paint);
  schedule();
}
async function select(key) {
  if(!catalog[key])throw new Error('Unknown model');
  requested=key;const token=++generation;report('正在准备 '+catalog[key].label+'…',{loading:true});
  try {
    const entry=catalog[key];
    let gltf=null;
    if(!entry.build||entry.model){
      const data=await modelData(key);
      gltf=await new GLTFLoader().parseAsync(data,'');
      if(token!==generation){release(gltf.scene);return;}
    }
    mixer?.stopAllAction(); if(content)mixer?.uncacheRoot(content);actor?.dispose?.();release(content);
    for(const shadow of shadows)shadow.dispose();shadows=[];
    actor=entry.build?entry.build({camera,gltf,saved:petSaved,report:pet=>{petSaved=pet;window.webkit?.messageHandlers?.stage?.postMessage({pet});}}):null;
    content=actor?actor.object:gltf.scene;clips=gltf?.animations??[];mixer=clips.length?new THREE.AnimationMixer(content):null;
    wheels=[];wheelUntil=0;actionUntil=0;selected=key;
    content.traverse(node=>{if(node.isMesh){const glow=node.material?.blending===THREE.AdditiveBlending;node.castShadow=node.receiveShadow=!glow;if(node.material?.map)node.material.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());}});
    applyLighting(actor?.lighting);
    if(key==='ferrari') {
      const finishes={Tires:['#0d0e10',0,0.86,0.25],Leather:['#1c1716',0,0.62,0.5],Leather_red:['#5a1d24',0,0.55,0.5],Interior_dark:['#121418',0,0.7,0.4],Interior_light:['#2a2d31',0,0.6,0.5],plastic_gray:['#1b1e22',0,0.55,0.6],Carpet:['#0f1114',0,1,0.3],Carbon_Fiber:['#14171b',0.4,0.3,1],metal_gray:['#9aa0a8',1,0.32,1],metal_chrome:['#e6e9ee',1,0.08,1.2],Taillight_Glass:['#6e0b12',0.1,0.12,1.2]};
      content.traverse(node=>{if(node.material)for(const material of [].concat(node.material)){const finish=finishes[material.name];if(finish){material.color.set(finish[0]);material.metalness=finish[1];material.roughness=finish[2];material.envMapIntensity=finish[3];}}});
      // Metallic base coat under a mirror-smooth clear coat: the studio strips read as crisp lines along the body.
      const body=content.getObjectByName('body');if(body)body.material=new THREE.MeshPhysicalMaterial({color:paint,metalness:0.62,roughness:0.36,clearcoat:1,clearcoatRoughness:0.015,envMapIntensity:1.15});
      for(const name of ['rim_fl','rim_fr','rim_rr','rim_rl']) {const part=content.getObjectByName(name);if(part)part.material=new THREE.MeshStandardMaterial({color:0xd3d7dd,metalness:1,roughness:0.16,envMapIntensity:1.1});}
      const trim=content.getObjectByName('trim');if(trim)trim.material=new THREE.MeshStandardMaterial({color:0x1a1c20,metalness:0.6,roughness:0.3});
      const glass=content.getObjectByName('glass');if(glass)glass.material=new THREE.MeshPhysicalMaterial({color:0x0b1017,metalness:0,roughness:0,transparent:true,opacity:0.58,depthWrite:false,clearcoat:1,clearcoatRoughness:0,envMapIntensity:1.8});
      ferrariBadges(content);
      wheels=['wheel_fl','wheel_fr','wheel_rl','wheel_rr'].map(name=>content.getObjectByName(name)).filter(Boolean);
    }
    if(!actor){
      const before=new THREE.Box3().setFromObject(content),dimensions=before.getSize(new THREE.Vector3());
      const scale=4.8/Math.max(dimensions.x,dimensions.y,dimensions.z);content.scale.multiplyScalar(scale);
      const box=new THREE.Box3().setFromObject(content),center=box.getCenter(new THREE.Vector3());
      content.position.add(new THREE.Vector3(-center.x,-box.min.y,-center.z));
    }
    scene.add(content);
    // A roaming exhibit gets its shadow over the whole play area and re-renders it while moving.
    const grounded=actor?actor.frame:new THREE.Box3().setFromObject(content),height=actor?Math.min(actor.frame.max.y,3.8):grounded.getSize(new THREE.Vector3()).y;
    const resolution=actor?.shadowResolution??512,spread=actor?1:1.3;
    const sunny=actor?.lighting==='sun';
    shadows=[contactShadow(grounded,{spread,height:height*0.75,blur:3.6,darkness:2.4,opacity:sunny?0.3:0.85,resolution}),contactShadow(grounded,{spread:actor?1:1.1,height:Math.max(0.05,height*0.14),blur:1.3,darkness:3.2,opacity:sunny?0.7:0.92,resolution})];
    for(const shadow of shadows)scene.add(shadow.group);
    renderShadows();
    renderer.shadowMap.needsUpdate=true;project();home();followSun();renderer.render(scene,camera);
    status.textContent='';
    window.webkit?.messageHandlers?.stage?.postMessage({message:'',model:key,ready:true,triangles:renderer.info.render.triangles});
    window.stageDiagnostics={model:key,ready:true,triangles:renderer.info.render.triangles,animations:clips.length};
    schedule();
  }catch(error){if(token===generation)report('加载失败，点击复位重试',{error:String(error),loading:false});throw error;}
}
function action() {
  if(!content)return;
  if(actor){actor.action();schedule();return;}
  if(selected==='ferrari')wheelUntil=performance.now()+2200;
  else if(mixer&&clips.length){const clip=clips.find(clip=>/wave/i.test(clip.name))||clips[0];mixer.stopAllAction();const action=mixer.clipAction(clip);action.reset().setLoop(THREE.LoopOnce,1).play();action.clampWhenFinished=true;actionUntil=performance.now()+(clip.duration+0.1)*1000;}
  else actionUntil=performance.now()+3500;
  renderer.shadowMap.needsUpdate=true;schedule();
}
const raycaster=new THREE.Raycaster(),groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
function pointerInfo(event,extra={}) {
  const rect=canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
  const hit=actor?.pickables?raycaster.intersectObject(actor.pickables,true)[0]??null:null;
  const ground=raycaster.ray.intersectPlane(groundPlane,new THREE.Vector3());
  return {ray:raycaster.ray.clone(),hit,ground,camera:camera.position.clone(),...extra};
}
// Registered before OrbitControls so a press on the exhibit (e.g. petting the dog) can switch orbiting off for that drag.
function bindPointer() {
  canvas.addEventListener('pointerdown',event=>{
    press={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,time:performance.now(),captured:false};
    if(actor?.pointer?.('down',pointerInfo(event))){press.captured=true;controls.enabled=false;}
    schedule();
  });
  canvas.addEventListener('pointermove',event=>{
    if(!actor?.pointer)return;
    let delta=0;
    if(press){delta=Math.hypot(event.clientX-press.lastX,event.clientY-press.lastY);press.lastX=event.clientX;press.lastY=event.clientY;}
    actor.pointer(press?.captured?'drag':'move',pointerInfo(event,{delta}));schedule();
  });
  const finish=event=>{
    if(!press)return;
    const click=Math.hypot(event.clientX-press.x,event.clientY-press.y)<6&&performance.now()-press.time<450;
    if(click&&actor?.pointer)actor.pointer('click',pointerInfo(event));
    actor?.pointer?.('up',pointerInfo(event));
    press=null;controls.enabled=true;schedule();
  };
  canvas.addEventListener('pointerup',finish);
  canvas.addEventListener('pointercancel',finish);
  canvas.addEventListener('pointerleave',()=>{actor?.pointer?.('leave',{});schedule();});
}
function schedule(){if(!framePending&&visible&&!document.hidden){framePending=true;requestAnimationFrame(frame);}}
function frame(time) {
  framePending=false;if(!visible||document.hidden)return;
  const fps=actor?.frameRate?.();
  if(fps&&lastRender&&time-lastRender<1000/fps-2){schedule();return;}
  lastRender=time;
  const delta=Math.min(lastTime?(time-lastTime)/1000:0.016,0.08);lastTime=time;
  const motion=actor?actor.update(delta,time):null;
  if(motion?.active)renderer.shadowMap.needsUpdate=true;
  keepInFrame();
  followSun();
  if(motion?.moved)renderShadows();
  const active=autoRotate||time<actionUntil||time<wheelUntil||Boolean(motion?.active);
  controls.autoRotate=autoRotate||(time<actionUntil&&!mixer);controls.autoRotateSpeed=0.65;
  const changed=controls.update(delta);
  if(time<wheelUntil)for(const wheel of wheels)wheel.rotation.x-=delta*7;
  if(mixer&&time<actionUntil){mixer.update(delta);renderer.shadowMap.needsUpdate=true;renderShadows();}
  renderer.render(scene,camera);
  if(active||changed)schedule();else{lastTime=0;lastRender=0;}
}
try {
  init();
  window.deskStage={
    configure(config){autoRotate=Boolean(config.autoRotate);if(config.pet&&!petSaved)petSaved=config.pet;if(/^#[0-9a-f]{6}$/i.test(config.color||''))paint=config.color;if(config.model!==requested)select(config.model).catch(()=>{});else updatePaint();schedule();},
    home(){if(!selected){select(requested||'ferrari').catch(()=>{});}else home();},
    action,
    command(name){actor?.command?.(name);schedule();},
    setVisible(value){visible=Boolean(value);if(visible)schedule();},
    async selfTest(){
      const results=[];autoRotate=false;
      for(const key of Object.keys(catalog)){
        await select(key);renderer.render(scene,camera);
        if(renderer.info.render.triangles<100)throw new Error('Empty model: '+key);
        results.push({model:key,triangles:renderer.info.render.triangles});
      }
      if (catalog.gundam) {
      await select('gundam');
      if(actor.state.parts.some(count=>count<200))throw new Error('Gundam rig regions look wrong: '+actor.state.parts);
      actor.command('wings');for(let i=0;i<45;i++)actor.update(1/30);
      if(actor.state.wings<0.8)throw new Error('Wings did not spread');
      actor.command('shoot');for(let i=0;i<31;i++)actor.update(1/30);
      if(actor.state.shot<0.5)throw new Error('Beam rifle did not fire');
      actor.command('burst');for(let i=0;i<45;i++)actor.update(1/30);
      if(actor.state.lift<0.05||actor.state.thrust<0.5)throw new Error('Burst did not lift off');
      for(let i=0;i<120;i++)actor.update(1/30);
      if(actor.state.action)throw new Error('Gundam action did not finish');
      }
      await select('pet');
      const pet=actor,before=pet.state.energy;
      pet.command('ball');pet.simulate(16);
      if(pet.state.fetches!==1)throw new Error('Pet did not fetch the ball: '+JSON.stringify(pet.state));
      pet.command('feed');pet.simulate(12);
      if(pet.state.meals!==1)throw new Error('Pet did not eat: '+JSON.stringify(pet.state));
      pet.command('trick');pet.simulate(4);
      if(pet.state.tricks!==1)throw new Error('Pet did not perform: '+JSON.stringify(pet.state));
      pet.command('sleep');pet.simulate(1);
      if(!pet.state.sleeping)throw new Error('Pet did not sleep');
      results.push({model:'pet-behaviour',fetches:1,meals:1,tricks:1,energyBefore:Math.round(before)});
      await select('ferrari');paint='#1749ab';updatePaint();
      if(content.getObjectByName('body').material.color.getHexString()!=='1749ab')throw new Error('Paint did not update');
      const old=camera.position.clone();controls.rotateSpeed=0.7;camera.position.applyAxisAngle(new THREE.Vector3(0,1,0),0.3);controls.update();
      if(camera.position.distanceTo(old)<0.1)throw new Error('Camera did not rotate');
      paint='#b3111f';updatePaint();home();
      renderer.render(scene,camera);
      const result={ok:true,models:results,paint:true,camera:true,offline:true,preview:canvas.toDataURL('image/png')};
      return result;
    }
  };
  window.webkit?.messageHandlers?.stage?.postMessage({booted:true});
}catch(error){report('当前无法启动 3D 显示',{error:String(error)});}
