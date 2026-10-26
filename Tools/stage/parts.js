import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

// Small modelling kit shared by the procedural exhibits: every helper creates, places and parents one mesh.
export const damp = THREE.MathUtils.damp;
export const clamp = THREE.MathUtils.clamp;
export const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
export const window01 = (t, start, end) => smooth((t - start) / (end - start));

export function plastic(color, options = {}) {
  return new THREE.MeshPhysicalMaterial({color, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3, ...options});
}
export function glow(color, intensity = 2.4) {
  return new THREE.MeshStandardMaterial({color: 0x050505, emissive: color, emissiveIntensity: intensity, roughness: 0.35});
}
export function additive(color, opacity = 0.8) {
  return new THREE.MeshBasicMaterial({color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false});
}
export function group(parent, x = 0, y = 0, z = 0, name) {
  const node = new THREE.Group();
  node.position.set(x, y, z);
  if (name) node.name = name;
  parent?.add(node);
  return node;
}
function place(parent, mesh, x, y, z) {
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function block(parent, w, h, d, material, x = 0, y = 0, z = 0, radius = Math.min(w, h, d) * 0.16) {
  return place(parent, new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material), x, y, z);
}
// Extruded 2D outline (XY plane, centred on Z) with a soft bevel: V-fins, shields, vents.
export function slab(parent, points, depth, material, x = 0, y = 0, z = 0, bevel = 0.012) {
  const shape = new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b)));
  const geometry = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6});
  geometry.translate(0, 0, -depth / 2);
  return place(parent, new THREE.Mesh(geometry, material), x, y, z);
}
export function rod(parent, top, bottom, height, material, x = 0, y = 0, z = 0, segments = 24) {
  return place(parent, new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), material), x, y, z);
}
export function orb(parent, radius, material, x = 0, y = 0, z = 0) {
  return place(parent, new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 18), material), x, y, z);
}
export function capsule(parent, radius, length, material, x = 0, y = 0, z = 0) {
  return place(parent, new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 8, 20), material), x, y, z);
}
export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.redraw = (...args) => { const context = canvas.getContext('2d'); context.clearRect(0, 0, width, height); draw(context, ...args); texture.needsUpdate = true; };
  texture.redraw();
  return texture;
}
export function glowSprite(color, size) {
  const map = canvasTexture(128, 128, context => {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false}));
  sprite.scale.setScalar(size);
  return sprite;
}
