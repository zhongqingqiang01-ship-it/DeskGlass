import * as THREE from 'three';
import {additive, clamp, damp, glowSprite, group, rod, window01} from './parts.js';

// ZGMF-X10A Freedom, converted from a 3ds Max model the user supplied: one 50k-triangle mesh, 0.95 units tall, facing +Z,
// beam rifle in the right hand (−X), wings folded behind the back. The file has no skeleton, so it is skinned here.
// The mesh is ~1700 pieces (vertices joined by its index buffer, i.e. the UV islands of the armour) that touch or
// interpenetrate without sharing vertices. Armour is rigid, so every piece is bound wholly to one bone: a moving part
// opens a joint gap instead of tearing a panel in two or stretching triangles across the joint.
const HEIGHT = 3.8, NATIVE = 0.948, K = HEIGHT / NATIVE;
// The head sits slightly to the suit's left (+X); it turns about the top of the neck, behind the face. The right arm
// swings at the shoulder joint under the shoulder block (which stays on the body). Each wing swings at the top of its
// root on the backpack, so the whole wing hangs below its hinge and spreads sideways without crossing the other.
const NECK = [0.007, 0.8, 0.05], SHOULDER = [-0.165, 0.765, 0.02];
const WING_L = [0.1, 0.87, -0.09], WING_R = [-0.1, 0.87, -0.09];
const WING_SPREAD = {x: -0.2, y: 0.25, z: 1.0};
const MUZZLE = new THREE.Vector3(-0.262, 0.222, 0.19), RIFLE_DIR = new THREE.Vector3(-0.2, -0.88, 0.41).normalize();
// Bones: 0 body, 1 head, 2 right arm with the rifle, 3/4 left/right wing (blades and plasma cannon).
export const PART = {BODY: 0, HEAD: 1, ARM: 2, WING_L: 3, WING_R: 4};

// Whether a piece belongs to the head, from its bounds and centre. The head is about 50 pieces (face, helmet, crest,
// cheeks, eyes): they start above the collar (y 0.793) in front of the wing roots (z ≥ 0) within the head's width; the
// V-fin blades reach out sideways but sit in front (z ≥ 0.06) and above the cheeks. The collar and throat plates around
// the neck start lower and stay on the body.
export function headPiece(min, max, centre) {
  const core = min.y >= 0.793 && min.z >= 0 && centre.x > -0.045 && centre.x < 0.06;
  const fin = min.z >= 0.06 && min.y >= 0.83 && Math.abs(centre.x) < 0.13;
  return core || fin;
}

// Wing by position of a triangle's centre: the wing box behind the back plus the wing roots beside the head.
export function region(x, y, z) {
  const wingRoot = y > 0.78 && Math.abs(x) > 0.075 && z < -0.035;
  if ((z < -0.078 && y > 0.17 && !(Math.abs(x) < 0.07 && y < 0.86)) || wingRoot) return x > 0 ? PART.WING_L : PART.WING_R;
  return PART.BODY;
}

// The source's pieces: for each triangle its piece; for each piece its bounds, centre, size and how strongly it touches
// the others (number of corner positions they share). Triangle order matches toNonIndexed().
function pieceGraph(source) {
  const index = source.index, position = source.attributes.position, corners = index ? index.count : position.count;
  const at = i => index ? index.getX(i) : i, parent = Int32Array.from({length: position.count}, (_, i) => i);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let i = 0; i < corners; i += 3) { const a = find(at(i)); parent[find(at(i + 1))] = a; parent[find(at(i + 2))] = a; }
  const ids = new Map(), of = new Int32Array(corners / 3), pieces = [], point = new THREE.Vector3();
  for (let t = 0; t < corners / 3; t++) {
    const root = find(at(t * 3));
    if (!ids.has(root)) {
      ids.set(root, pieces.length);
      pieces.push({min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity), centre: new THREE.Vector3(), count: 0, links: new Map()});
    }
    const piece = pieces[of[t] = ids.get(root)];
    for (let k = 0; k < 3; k++) { point.fromBufferAttribute(position, at(t * 3 + k)); piece.min.min(point); piece.max.max(point); piece.centre.addScaledVector(point, 1 / 3); }
    piece.count++;
  }
  for (const piece of pieces) piece.centre.divideScalar(piece.count);
  const byCorner = new Map();
  for (let v = 0; v < position.count; v++) {
    const id = ids.get(find(v));
    if (id === undefined) continue;
    const key = `${Math.round(position.getX(v) * 1e4)},${Math.round(position.getY(v) * 1e4)},${Math.round(position.getZ(v) * 1e4)}`;
    if (!byCorner.has(key)) byCorner.set(key, new Set());
    byCorner.get(key).add(id);
  }
  for (const shared of byCorner.values()) {
    if (shared.size < 2) continue;
    for (const a of shared) for (const b of shared) if (a !== b) pieces[a].links.set(b, (pieces[a].links.get(b) ?? 0) + 1);
  }
  return {of, pieces};
}

// Which bone each piece follows.
function rigPieces(pieceOf, pieces, position) {
  const triangles = pieceOf.length, labels = new Uint8Array(triangles), centre = new Float32Array(triangles * 3);
  for (const piece of pieces) piece.part = headPiece(piece.min, piece.max, piece.centre) ? PART.HEAD : PART.BODY;
  // Wings first, triangle by triangle: the wing box, then whatever touches it in the space behind the shoulders. The
  // outermost blade and the plasma cannon hang close against the back and arm, partly outside the box; the cannon is a
  // thick plate whose inner face nearly touches the body: below the hands nothing else hangs at the sides, beside the
  // forearms only its edge does, and next to the upper arms only clearly-behind geometry is wing.
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) { centre[t * 3] += position.getX(t * 3 + k) / 3; centre[t * 3 + 1] += position.getY(t * 3 + k) / 3; centre[t * 3 + 2] += position.getZ(t * 3 + k) / 3; }
    labels[t] = pieces[pieceOf[t]].part === PART.HEAD ? PART.HEAD : region(centre[t * 3], centre[t * 3 + 1], centre[t * 3 + 2]);
  }
  const corner = i => `${Math.round(position.getX(i) * 1e4)},${Math.round(position.getY(i) * 1e4)},${Math.round(position.getZ(i) * 1e4)}`;
  const keys = Array.from({length: triangles * 3}, (_, i) => corner(i)), touching = new Map();
  keys.forEach((key, i) => { if (!touching.has(key)) touching.set(key, []); touching.get(key).push(i / 3 | 0); });
  const wing = label => label === PART.WING_L || label === PART.WING_R;
  const behind = t => {
    const x = Math.abs(centre[t * 3]), y = centre[t * 3 + 1], z = centre[t * 3 + 2];
    return x > 0.12 && y > 0.17 && y < 0.82 && z < (y < 0.46 ? 0 : y < 0.62 ? -0.01 : -0.035);
  };
  const queue = [];
  for (let t = 0; t < triangles; t++) if (wing(labels[t])) queue.push(t);
  while (queue.length) {
    const t = queue.pop();
    for (const k of [0, 1, 2]) for (const n of touching.get(keys[t * 3 + k])) {
      if (!wing(labels[n]) && labels[n] !== PART.HEAD && behind(n)) { labels[n] = labels[t]; queue.push(n); }
    }
  }
  // Then whole pieces: each follows the wing most of its triangles fell in.
  const votes = pieces.map(() => [0, 0, 0, 0, 0]);
  for (let t = 0; t < triangles; t++) votes[pieceOf[t]][labels[t]]++;
  pieces.forEach((piece, i) => {
    if (piece.part === PART.HEAD) return;
    const [body, , , left, right] = votes[i];
    if (Math.max(left, right) > body) piece.part = left >= right ? PART.WING_L : PART.WING_R;
  });
  // Body pieces outside the torso that touch a wing more than the body are part of it (the inner faces of the plasma
  // cannons); behind the shoulders beside the backpack, where the wing roots sit on the back, touching it nearly as much
  // is enough (the tall wing root beside the head and the small plates around it).
  for (let changed = true; changed;) {
    changed = false;
    for (const piece of pieces) {
      const {x, y, z} = piece.centre, root = Math.abs(x) > 0.085 && z < -0.015 && y > 0.55;
      if (piece.part !== PART.BODY || !(root || Math.abs(x) > 0.11)) continue;
      const weight = [0, 0, 0, 0, 0];
      for (const [other, shared] of piece.links) weight[pieces[other].part] += shared;
      const side = weight[PART.WING_L] > weight[PART.WING_R] ? PART.WING_L : PART.WING_R;
      if (weight[side] > weight[PART.BODY] || (root && weight[side] > 0 && weight[side] >= 0.8 * weight[PART.BODY])) { piece.part = side; changed = true; }
    }
  }
  // The right arm with its rifle: the pieces connected to the upper arm, forearm, hand and rifle that lie outside the
  // torso and hips and below the shoulder block (in front of the cannon, which is already wing).
  const armRegion = piece => {
    const {centre: c, min, max} = piece;
    if (piece.part !== PART.BODY || max.y > 0.81) return false;
    const rifle = c.z > 0.06 && c.x < -0.15;
    return c.x < -0.128 && min.y > 0.2 && (c.y > 0.43 || rifle);
  };
  const seeds = [[-0.197, 0.413, 0.149], [-0.211, 0.44, 0.146], [-0.179, 0.498, 0.069], [-0.193, 0.601, 0.038], [-0.159, 0.733, 0.025]];
  const grow = seeds.map(([x, y, z]) => {
    const at = new THREE.Vector3(x, y, z);
    return pieces.reduce((best, piece) => armRegion(piece) && (!best || piece.centre.distanceTo(at) < best.centre.distanceTo(at)) ? piece : best, null);
  }).filter(Boolean);
  for (const piece of grow) piece.part = PART.ARM;
  while (grow.length) {
    for (const other of grow.pop().links.keys()) if (armRegion(pieces[other])) { pieces[other].part = PART.ARM; grow.push(pieces[other]); }
  }
  for (let t = 0; t < triangles; t++) labels[t] = pieces[pieceOf[t]].part;
  return labels;
}

export function buildGundam({gltf}) {
  let original = null;
  gltf.scene.traverse(node => { if (node.isMesh && !original) original = node; });
  const {of: pieceOf, pieces} = pieceGraph(original.geometry);
  const geometry = original.geometry.index ? original.geometry.toNonIndexed() : original.geometry, old = original.material;
  if (geometry !== original.geometry) original.geometry.dispose();
  // Painted metal: colour, occlusion, roughness and metalness come per pixel from the texture set. The source is
  // double-sided (some armour plates are single sheets).
  const material = new THREE.MeshStandardMaterial({
    map: old.map, roughnessMap: old.roughnessMap, metalnessMap: old.metalnessMap, aoMap: old.aoMap, aoMapIntensity: 1,
    emissiveMap: old.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.4, metalness: 1, roughness: 1, side: THREE.DoubleSide
  });
  old.dispose();

  const position = geometry.attributes.position, count = position.count;
  const labels = rigPieces(pieceOf, pieces, position);
  const skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4), parts = new Array(5).fill(0);
  for (let t = 0; t < labels.length; t++) {
    for (let k = 0; k < 3; k++) { skinIndex[(t * 3 + k) * 4] = labels[t]; skinWeight[(t * 3 + k) * 4] = 1; }
    parts[labels[t]]++;
  }
  // Bounds of each wing in its rest pose, to know how far the opened wings reach above the head.
  const wingBounds = [new THREE.Box3(), new THREE.Box3()], corner3 = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const label = labels[i / 3 | 0];
    if (label === PART.WING_L || label === PART.WING_R) wingBounds[label === PART.WING_L ? 0 : 1].expandByPoint(corner3.fromBufferAttribute(position, i));
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const bone = (parent, at) => { const node = new THREE.Bone(); node.position.set(...at); parent?.add(node); return node; };
  const body = bone(null, [0, 0, 0]), head = bone(body, NECK), shoulder = bone(body, SHOULDER);
  const wingL = bone(body, WING_L), wingR = bone(body, WING_R);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.add(body); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([body, head, shoulder, wingL, wingR]));

  const root = group(null, 0, 0, 0, 'gundam'), fx = group(root, 0, 0, 0, 'fx');
  const suit = group(root); suit.scale.setScalar(K); suit.add(mesh);

  // Lit by the viewer's sun rig (see StageViewer); only the muzzle flash adds a local light.
  const flashLight = new THREE.PointLight(0xff7ad0, 0, 2.5, 2);
  root.add(flashLight);

  const rifleFx = group(shoulder);
  rifleFx.position.copy(MUZZLE).sub(new THREE.Vector3(...SHOULDER));
  rifleFx.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), RIFLE_DIR);
  const muzzle = glowSprite('rgba(255,150,220,0.95)', 0.09); rifleFx.add(muzzle);
  const beam = group(rifleFx);
  for (const [radius, color, opacity] of [[0.004, 0xffffff, 1], [0.01, 0xff8ad8, 0.65], [0.022, 0xff3aa6, 0.25]]) {
    const piece = rod(beam, radius, radius, 2.4, additive(color, opacity), 0, 1.2, 0, 12); piece.castShadow = piece.receiveShadow = false;
  }
  muzzle.visible = beam.visible = false;

  const jets = [];
  const jet = (parent, x, y, z, size, tilt = 0) => {
    const anchor = group(parent, x, y, z); anchor.rotation.x = tilt;
    rod(anchor, size * 0.5, size * 0.08, size * 3, additive(0xd6ecff, 0.9), 0, -size * 1.5, 0).castShadow = false;
    rod(anchor, size * 0.85, size * 0.12, size * 5, additive(0x4b86ff, 0.4), 0, -size * 2.5, 0).castShadow = false;
    anchor.add(glowSprite('rgba(120,170,255,0.9)', size * 3.5));
    anchor.visible = false; jets.push(anchor);
  };
  for (const x of [-0.045, 0.045]) jet(suit, x, 0.6, -0.11, 0.025, 0.5);
  for (const x of [-0.12, 0.12]) jet(suit, x, 0.0, 0.0, 0.03);
  const wingGlow = [wingL, wingR].map(wing => { const sprite = glowSprite('rgba(120,190,255,0.85)', 0.12); wing.add(sprite); sprite.visible = false; return sprite; });

  const idle = {lift: 0, lean: 0, sway: 0, headX: 0, headY: 0, shX: 0, shY: 0, shZ: 0, wings: 0, thrust: 0, flash: 0};
  const pose = {...idle};
  const gaze = {x: 0, y: 0, cx: 0, cy: 0, active: false};
  const sequence = ['wings', 'shoot', 'burst'];
  let next = 0, act = null, actT = 0, clock = 0, shot = 0;
  const actions = {
    wings: {duration: 4.2, pose(t) {
      const open = window01(t, 0.1, 0.9) * (1 - window01(t, 3.3, 4.1));
      return {wings: open, headX: -0.08 * open, lean: -0.03 * open, shZ: -0.12 * open, flash: window01(t, 0.6, 0.85) * (1 - window01(t, 1.0, 1.6))};
    }},
    shoot: {duration: 3.0, shots: [1.0, 1.45, 1.9], pose(t) {
      const aim = window01(t, 0.1, 0.7) * (1 - window01(t, 2.4, 3.0));
      return {shX: -1.05 * aim, shZ: 0.12 * aim, headY: -0.2 * aim, headX: -0.05 * aim, sway: -0.03 * aim};
    }},
    burst: {duration: 3.8, pose(t) {
      const air = window01(t, 0.4, 1.3) * (1 - window01(t, 2.6, 3.6));
      return {wings: window01(t, 0, 0.5) * (1 - window01(t, 3.0, 3.8)), lift: 0.075 * air + Math.sin(t * 2.6) * 0.006 * air, lean: 0.07 * air,
        sway: Math.sin(t * 1.7) * 0.025 * air, shX: 0.3 * air, headX: -0.1 * air, thrust: window01(t, 0.25, 0.45) * (1 - window01(t, 3.0, 3.6)), flash: 0.5 * air};
    }}
  };
  const apply = () => {
    suit.position.y = pose.lift * K;
    suit.rotation.set(pose.lean, 0, pose.sway);
    head.rotation.set(pose.headX - gaze.cy * 0.35, pose.headY + gaze.cx * 0.6, 0, 'YXZ');
    shoulder.rotation.set(pose.shX, pose.shY, pose.shZ);
    // Spread: swing each wing out and up around the top of its root, tilted back and turned slightly outward.
    wingL.rotation.set(WING_SPREAD.x * pose.wings, -WING_SPREAD.y * pose.wings, WING_SPREAD.z * pose.wings, 'YXZ');
    wingR.rotation.set(WING_SPREAD.x * pose.wings, WING_SPREAD.y * pose.wings, -WING_SPREAD.z * pose.wings, 'YXZ');
    for (const sprite of wingGlow) { sprite.visible = pose.wings > 0.3; sprite.material.opacity = 0.9 * pose.wings; sprite.scale.setScalar(0.12 + 0.05 * Math.sin(clock * 6)); }
    material.emissiveIntensity = 1.4 + pose.flash * 5;
    for (const anchor of jets) { anchor.visible = pose.thrust > 0.02; anchor.scale.set(1, pose.thrust * (0.85 + Math.random() * 0.3), 1); }
    muzzle.visible = beam.visible = shot > 0.35;
    muzzle.material.opacity = shot; beam.scale.set(1, 0.6 + shot * 0.4, 1);
    flashLight.intensity = shot * 6;
    if (shot > 0) { rifleFx.getWorldPosition(flashLight.position); root.worldToLocal(flashLight.position); }
  };
  apply();

  // How far the suit currently reaches past its framing box (opened wings, hovering): above it, as a fraction of its
  // height, and to the sides, as a multiple of its half-width.
  const frameTop = 0.96, frameSide = 0.28, hinge = [new THREE.Vector3(...WING_L), new THREE.Vector3(...WING_R)], swing = new THREE.Matrix4(), box = new THREE.Box3();
  const reach = () => {
    let top = 0.948 + pose.lift, side = frameSide;
    [wingL, wingR].forEach((wing, s) => {
      swing.makeTranslation(hinge[s].x, hinge[s].y, hinge[s].z).multiply(new THREE.Matrix4().makeRotationFromEuler(wing.rotation)).multiply(new THREE.Matrix4().makeTranslation(-hinge[s].x, -hinge[s].y, -hinge[s].z));
      box.copy(wingBounds[s]).applyMatrix4(swing);
      top = Math.max(top, box.max.y + pose.lift); side = Math.max(side, -box.min.x, box.max.x);
    });
    return {up: Math.max(0, top + 0.01 - frameTop) / frameTop, out: side / frameSide};
  };

  const proxy = new THREE.Mesh(new THREE.BoxGeometry(0.56 * K, HEIGHT, 0.4 * K), new THREE.MeshBasicMaterial({visible: false}));
  proxy.position.y = HEIGHT / 2; root.add(proxy);

  return {
    object: root, fx, glows: [rifleFx, ...jets, ...wingGlow], pickables: proxy, parts, lighting: 'sun', tall: true, fill: 1, aim: 0.47, reach,
    // Framing box: the standing suit, so it fills the view at rest; hovering and opened wings pull the camera back (reach).
    frame: new THREE.Box3(new THREE.Vector3(-frameSide * K, 0, -0.1 * K), new THREE.Vector3(frameSide * K, frameTop * K, 0.1 * K)),
    update(delta) {
      clock += delta;
      let target = idle;
      if (act) {
        actT += delta;
        const spec = actions[act];
        target = {...idle, ...spec.pose(actT)};
        if (spec.shots?.some(at => actT >= at && actT - delta < at)) shot = 1;
        if (actT >= spec.duration) act = null;
      }
      shot = Math.max(0, shot - delta * 4);
      let moving = Boolean(act) || shot > 0;
      for (const k of Object.keys(pose)) {
        const value = damp(pose[k], target[k], act ? 10 : 6, delta);
        if (Math.abs(value - target[k]) > 1e-3) moving = true;
        pose[k] = value;
      }
      const gx = gaze.active ? gaze.x : 0, gy = gaze.active ? gaze.y : 0;
      gaze.cx = damp(gaze.cx, gx, 5, delta); gaze.cy = damp(gaze.cy, gy, 5, delta);
      if (Math.abs(gaze.cx - gx) > 1e-3 || Math.abs(gaze.cy - gy) > 1e-3) moving = true;
      apply();
      return {active: moving, moved: moving && pose.lift > 0.003};
    },
    pointer(type, info) {
      if (type === 'leave') { gaze.active = false; return false; }
      if (type === 'move' || type === 'drag') {
        const headWorld = head.getWorldPosition(new THREE.Vector3());
        const toCam = info.camera.clone().sub(headWorld), right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toCam).normalize();
        const point = info.ray.at(toCam.length(), new THREE.Vector3()).sub(headWorld);
        gaze.x = clamp(-point.dot(right) / toCam.length() * 1.6, -1, 1);
        gaze.y = clamp(-point.y / toCam.length() * 1.6, -0.6, 0.8);
        gaze.active = true;
      }
      if (type === 'click' && info.hit && !act) { act = 'wings'; actT = 0.55; }
      return false;
    },
    action() { act = sequence[next]; next = (next + 1) % sequence.length; actT = 0; },
    // The pose at time t of an action (or at rest), evaluated directly rather than eased in from the current pose, for a
    // timeline that can jump (the promo film); look turns the head like the pointer gaze (x, y in −1…1).
    seek(name, t, look = {x: 0, y: 0}) {
      const spec = actions[name], running = spec && t >= 0 && t <= spec.duration;
      Object.assign(pose, idle, running ? spec.pose(t) : {});
      shot = running && spec.shots ? Math.max(0, ...spec.shots.map(at => t >= at ? 1 - (t - at) * 4 : 0)) : 0;
      gaze.cx = look.x; gaze.cy = look.y; clock = t; act = null;
      apply();
    },
    command(name) { if (actions[name]) { act = name; actT = 0; } },
    get state() { return {action: act, wings: pose.wings, lift: pose.lift, thrust: pose.thrust, shot, parts}; }
  };
}
