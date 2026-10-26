import * as THREE from 'three';
import {block, canvasTexture, capsule, clamp, damp, glow, group, orb, plastic, rod} from './parts.js';

// Robot puppy with an LED visor face. Built in "pet units" (body ≈ 0.5 long) and scaled up by SCALE;
// legs are solved with two-bone IK onto ground targets, so every pose and gait keeps its paws planted.
const SCALE = 3.1, AREA = 1.2, PAW_Y = 0.021, UPPER = 0.12, LOWER = 0.125;
const LABELS = {idle: '在发呆', wander: '四处闲逛', chase: '在追你的鼠标', fetch: '在追球', bring: '叼着球回来', eat: '在吃能量骨头', trick: '在表演才艺',
  petted: '被摸得很开心', boop: '在跟你打招呼', sleep: '在睡觉', sniff: '在闻闻地面', sit: '乖乖坐着', curious: '歪头看你', tired: '没电了，想吃东西'};
const TRICKS = [['sit', '坐下'], ['shake', '握手'], ['spin', '转圈'], ['jump', '跳一下'], ['beg', '作揖'], ['bow', '伸懒腰']];

export function buildPet({camera, saved, report}) {
  const shell = plastic(0xf1f2f4, {roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12}), graphite = plastic(0x2b2f36, {roughness: 0.45, metalness: 0.2});
  const joint = plastic(0x8a9099, {metalness: 0.6, roughness: 0.35}), collarMat = plastic(0xd83a3a, {roughness: 0.5}), tagMat = plastic(0xe0b04a, {metalness: 1, roughness: 0.25});
  const led = glow(0x55e6ff, 2.2), tailLed = glow(0x55e6ff, 2.6);
  const world = group(null, 0, 0, 0, 'pet-world'), fx = group(world, 0, 0, 0, 'fx');
  const root = group(world, 0, 0, 0.3, 'pet'); root.scale.setScalar(SCALE);
  const torso = group(root, 0, 0.31, 0);
  const body = capsule(torso, 0.12, 0.25, shell, 0, 0, 0); body.rotation.x = Math.PI / 2; body.scale.set(1, 1, 0.92);
  const belly = capsule(torso, 0.1, 0.22, graphite, 0, -0.035, 0); belly.rotation.x = Math.PI / 2; belly.scale.set(0.96, 1, 0.8);
  const strip = capsule(torso, 0.011, 0.15, led, 0, 0.108, -0.02); strip.rotation.x = Math.PI / 2;
  const neck = group(torso, 0, 0.06, 0.19);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.014, 12, 32), collarMat); collar.rotation.x = Math.PI / 2 - 0.5; collar.position.set(0, 0.02, 0.01); neck.add(collar);
  const tag = rod(neck, 0.018, 0.018, 0.006, tagMat, 0, -0.045, 0.06); tag.rotation.x = Math.PI / 2 - 0.3;
  rod(neck, 0.05, 0.06, 0.1, joint, 0, 0.04, 0);
  const head = group(neck, 0, 0.11, 0.035);
  const skull = orb(head, 0.12, shell, 0, 0.02, 0); skull.scale.set(1.06, 0.95, 1);
  const face = canvasTexture(256, 128, drawFace);
  face.wrapS = THREE.RepeatWrapping; face.repeat.x = -1;
  const visorMat = new THREE.MeshPhysicalMaterial({color: 0x05070b, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 1.5});
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.1225, 48, 24, Math.PI / 2 - 0.78, 1.56, Math.PI / 2 - 0.62, 0.78), visorMat);
  visor.position.set(0, 0.02, 0); visor.scale.set(1.06, 0.95, 1); head.add(visor);
  block(head, 0.095, 0.062, 0.085, shell, 0, -0.06, 0.095, 0.028);
  orb(head, 0.017, graphite, 0, -0.045, 0.14).scale.set(1.3, 0.9, 1);
  const ears = [-1, 1].map(side => {
    const pivot = group(head, side * 0.085, 0.1, -0.01);
    const flap = capsule(pivot, 0.032, 0.06, graphite, side * 0.012, -0.045, 0); flap.scale.set(0.42, 1, 1);
    return {pivot, side};
  });
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([side, front]) => {
    const hip = group(torso, side * 0.075, -0.045, front * 0.145);
    orb(hip, 0.056, shell, side * 0.01, 0.005, 0);
    capsule(hip, 0.04, 0.06, shell, 0, -UPPER / 2, 0);
    const knee = group(hip, 0, -UPPER, 0);
    orb(knee, 0.027, joint);
    capsule(knee, 0.03, 0.075, shell, 0, -LOWER / 2, 0);
    const paw = group(knee, 0, -LOWER, 0);
    orb(paw, 0.033, graphite, 0, 0, 0.01).scale.set(1, 0.62, 1.3);
    return {hip, knee, paw, side, front, base: new THREE.Vector3(side * 0.075, PAW_Y, front * 0.15), target: new THREE.Vector3(), lift: 0};
  });
  const tail = group(torso, 0, 0.06, -0.235);
  rod(tail, 0.012, 0.014, 0.1, graphite, 0, 0.05, 0);
  orb(tail, 0.022, tailLed, 0, 0.105, 0);

  // Props live in world space beside the dog: a tennis ball and a food bowl with a glowing energy bone.
  const ballMat = plastic(0xd7f04a, {roughness: 0.8, clearcoat: 0}), ball = orb(world, 0.11, ballMat, 0, 0.11, 0); ball.visible = false;
  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 40), plastic(0xffffff, {roughness: 0.7, clearcoat: 0})); ball.add(seam); seam.rotation.y = 0.6;
  const bowl = group(world, 0, 0, 0); bowl.visible = false;
  const bowlShape = new THREE.LatheGeometry([[0.0, 0.0], [0.24, 0.0], [0.28, 0.03], [0.3, 0.14], [0.27, 0.15], [0.25, 0.05], [0.0, 0.05]].map(([x, y]) => new THREE.Vector2(x, y)), 40);
  const bowlMesh = new THREE.Mesh(bowlShape, plastic(0xe8744f, {roughness: 0.35, clearcoat: 0.6})); bowlMesh.castShadow = bowlMesh.receiveShadow = true; bowl.add(bowlMesh);
  const bone = group(bowl, 0, 0.12, 0);
  const boneGlow = glow(0x6ef3ff, 1.8);
  rod(bone, 0.03, 0.03, 0.26, boneGlow, 0, 0, 0).rotation.z = Math.PI / 2;
  for (const x of [-0.13, 0.13]) for (const z of [-0.035, 0.035]) orb(bone, 0.042, boneGlow, x, 0, z);

  const sprites = [];
  const textSprite = (text, {bubble = true, color = '#1b1f27', size = 0.55} = {}) => {
    const map = canvasTexture(256, 128, context => {
      if (bubble) {
        context.fillStyle = 'rgba(255,255,255,0.94)'; context.beginPath(); context.roundRect(18, 14, 220, 84, 38); context.fill();
        context.beginPath(); context.moveTo(110, 96); context.lineTo(128, 120); context.lineTo(146, 96); context.fill();
      }
      context.fillStyle = color; context.font = `600 ${bubble ? 46 : 80}px -apple-system, "PingFang SC", sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(text, 128, bubble ? 58 : 64);
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map, transparent: true, depthWrite: false, depthTest: false}));
    sprite.scale.set(size * 2, size, 1); sprite.renderOrder = 10;
    return sprite;
  };
  const heartTexture = canvasTexture(128, 128, context => {
    context.fillStyle = '#ff5f8f'; context.beginPath(); context.moveTo(64, 112);
    context.bezierCurveTo(8, 72, 12, 18, 64, 40); context.bezierCurveTo(116, 18, 120, 72, 64, 112); context.fill();
  });
  const emit = (kind, text) => {
    const anchor = head.getWorldPosition(new THREE.Vector3()); world.worldToLocal(anchor);
    let sprite;
    if (kind === 'heart') { sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: heartTexture, transparent: true, depthWrite: false})); sprite.scale.setScalar(0.16 + Math.random() * 0.08); anchor.x += (Math.random() - 0.5) * 0.4; }
    else if (kind === 'z') { sprite = textSprite('Z', {bubble: false, color: '#dff4ff', size: 0.36}); anchor.x += 0.2; }
    else {
      for (const old of sprites) if (old.userData.kind === 'say') old.userData.life = Math.min(old.userData.life, 0.15);
      sprite = textSprite(text);
    }
    sprite.position.copy(anchor).add(new THREE.Vector3(0, kind === 'say' ? 0.62 : 0.4, 0));
    sprite.userData = {kind, life: kind === 'say' ? 1.8 : 1.6, age: 0, vx: (Math.random() - 0.5) * 0.15};
    fx.add(sprite); sprites.push(sprite);
  };

  // Needs persist through the app (Swift stores them); time away counts as resting.
  const now = Date.now();
  const away = saved?.saved ? clamp((now - saved.saved) / 3600000, 0, 72) : 0;
  const needs = {mood: clamp((saved?.mood ?? 72) - away * 4, 25, 100), energy: clamp((saved?.energy ?? 82) + away * 30, 0, 100)};
  const stats = {fetches: 0, meals: 0, tricks: 0, boops: 0};

  const pose = {bodyY: 0.29, pitch: 0, headX: 0, headY: 0, headZ: 0, ear: 0, earBack: 0, tailUp: 0.6, wag: 0.2, wagSpeed: 6, crouch: 0, sit: 0, lie: 0, shake: 0, beg: 0, bow: 0, hop: 0, tuck: 0};
  const goal = {...pose};
  const look = {x: 0, y: 0, cx: 0, cy: 0, until: 0, pointer: null, pointerTime: 0, pointerTravel: 0};
  let expression = 'normal', exprUntil = 0, blink = 0, nextBlink = 2, open = 1, faceKey = '';
  let mode = 'idle', modeT = 0, idleT = 0, heading = 0.35, speed = 0, gait = 0, moveTo = null, wagPhase = 0;
  let idleWait = 3, trickIndex = 0, trick = null, ballState = null, pettedStroke = 0, lastPointerAt = -10, clock = 0, boopTimer = null, lastReport = '', reportT = 0;
  root.rotation.y = heading;

  function drawFace(context, state = {expr: 'normal', open: 1, gx: 0, gy: 0}) {
    const {expr, open, gx, gy} = state;
    context.fillStyle = '#000'; context.fillRect(0, 0, 256, 128);
    const cyan = '#62ecff', pink = '#ff6f9f';
    for (const side of [-1, 1]) {
      const x = 128 + side * 46 + gx * 14, y = 66 + gy * 10;
      context.save(); context.shadowColor = expr === 'love' ? pink : cyan; context.shadowBlur = 14;
      context.fillStyle = context.strokeStyle = expr === 'love' ? pink : cyan; context.lineWidth = 9; context.lineCap = 'round';
      if (expr === 'happy') { context.beginPath(); context.arc(x, y + 10, 18, Math.PI * 1.1, Math.PI * 1.9); context.stroke(); }
      else if (expr === 'sleep') { context.beginPath(); context.arc(x, y - 8, 18, Math.PI * 0.15, Math.PI * 0.85); context.stroke(); }
      else if (expr === 'love') { context.beginPath(); context.moveTo(x, y + 20); context.bezierCurveTo(x - 30, y, x - 22, y - 26, x, y - 10); context.bezierCurveTo(x + 22, y - 26, x + 30, y, x, y + 20); context.fill(); }
      else if (expr === 'surprise') { context.beginPath(); context.arc(x, y, 20, 0, Math.PI * 2); context.stroke(); context.beginPath(); context.arc(x, y, 6, 0, Math.PI * 2); context.fill(); }
      else {
        const h = Math.max(4, 44 * open * (expr === 'sad' ? 0.6 : 1)), w = expr === 'excited' ? 40 : 32;
        context.beginPath(); context.roundRect(x - w / 2, y - h / 2 + (expr === 'sad' ? 8 : 0), w, h, Math.min(14, h / 2)); context.fill();
        if (expr === 'sad') { context.fillStyle = '#000'; context.beginPath(); context.moveTo(x - 24, y - 20 + side * 8); context.lineTo(x + 24, y - 20 - side * 8); context.lineTo(x + 24, y - 30); context.lineTo(x - 24, y - 30); context.fill(); }
        if (expr === 'excited' && open > 0.5) { context.fillStyle = '#e8fdff'; context.beginPath(); context.arc(x - 7, y - 9, 6, 0, Math.PI * 2); context.fill(); }
      }
      context.restore();
    }
  }
  const feel = (expr, seconds) => { expression = expr; exprUntil = clock + seconds; };
  const setMode = (next, label) => { mode = next; modeT = 0; moveTo = null; idleWait = 2.5 + Math.random() * 4; if (label) emit('say', label); };
  const turnToward = (angle, rate, dt) => { const turn = Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading)); heading += clamp(turn, -rate * dt, rate * dt); };
  const awake = () => mode !== 'sleep';
  const wake = () => { if (mode === 'sleep') { setMode('idle'); feel('surprise', 0.6); idleT = 0; } };
  const inArea = point => { const v = new THREE.Vector2(point.x, point.z); if (v.length() > AREA) v.setLength(AREA); return new THREE.Vector3(v.x, 0, v.y); };
  const cameraSpot = () => { const dir = camera.position.clone().setY(0); if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); return dir.normalize().multiplyScalar(AREA * 0.45); };
  const randomSpot = () => { const a = Math.random() * Math.PI * 2, r = AREA * (0.3 + Math.random() * 0.65); return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r); };
  const mouthWorld = () => { const point = new THREE.Vector3(0, -0.075, 0.17); head.localToWorld(point); return world.worldToLocal(point); };
  const lookAtWorld = point => {
    const local = root.worldToLocal(point.clone().applyMatrix4(world.matrixWorld));
    const headPos = new THREE.Vector3(0, 0.45, 0.22), d = local.sub(headPos);
    look.x = clamp(Math.atan2(d.x, d.z), -1.1, 1.1); look.y = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.7);
  };

  function throwBall(target) {
    wake();
    if (needs.energy < 12) { setMode('tired', '电量低…'); feel('sad', 2.5); return; }
    const to = inArea(target ?? randomSpot());
    const from = cameraSpot().multiplyScalar(1.6).setY(1.4);
    const flight = 0.9;
    ballState = {pos: from.clone(), vel: to.clone().sub(from).divideScalar(flight).setY(0), held: false, rest: false, age: 0};
    ballState.vel.y = (0.11 - from.y + 0.5 * 9.8 * flight * flight) / flight;
    ball.visible = true; ball.position.copy(from);
    setMode('fetch'); feel('excited', 1.5); emit('say', '汪!');
  }
  function feed() {
    wake();
    bowl.position.copy(inArea(randomSpot().multiplyScalar(0.7))); bowl.visible = true; bowl.scale.setScalar(0.01); bone.scale.setScalar(1);
    setMode('eat'); feel('excited', 1.2); emit('say', '开饭啦!');
  }
  function doTrick(name) {
    wake();
    if (needs.energy < 15) { setMode('tired', '没电了…'); feel('sad', 2.5); return; }
    trick = name ?? TRICKS[trickIndex++ % TRICKS.length][0];
    setMode('trick', TRICKS.find(([key]) => key === trick)[1]);
  }
  function boop() {
    if (mode === 'sleep') { wake(); emit('say', '醒啦!'); return; }
    setMode('boop'); feel('surprise', 0.35); stats.boops++; needs.mood = clamp(needs.mood + 3, 0, 100);
  }

  // ---- Behaviour: each mode writes the goal pose, a movement target and an expression. ----
  function behave(dt) {
    modeT += dt; idleT += dt;
    Object.assign(goal, {bodyY: 0.29, pitch: 0, headX: 0, headY: 0, headZ: 0, ear: 0.2, earBack: 0, tailUp: 0.6, wag: 0.25, wagSpeed: 6, crouch: 0});
    let lookAt = null, run = false;
    const pointerFresh = look.pointer && clock - look.pointerTime < 2.5;
    if (mode !== 'sleep') needs.energy = clamp(needs.energy - dt * (speed > 0.6 ? 0.06 : 0.008), 0, 100);
    needs.mood = clamp(needs.mood - dt * 0.006, 0, 100);
    switch (mode) {
      case 'idle': {
        if (pointerFresh) lookAt = look.pointer;
        else if (Math.sin(clock * 0.7) > 0.6) lookAt = camera.position.clone();
        goal.wag = needs.mood > 60 ? 0.35 : 0.12;
        if (look.pointerTravel > 1.2 && pointerFresh && needs.energy > 20) { setMode('chase'); feel('excited', 1); look.pointerTravel = 0; break; }
        if (modeT > idleWait) {
          const roll = Math.random();
          if (needs.energy < 12 || (idleT > 75 && roll < 0.6)) { setMode('sleep'); break; }
          if (needs.energy < 30 && roll < 0.3) { setMode('tired', '有点饿…'); feel('sad', 2); break; }
          if (roll < 0.45) { setMode('wander'); moveTo = randomSpot(); }
          else if (roll < 0.65) { setMode('sniff'); moveTo = randomSpot().multiplyScalar(0.6); }
          else if (roll < 0.85) setMode('sit');
          else setMode('curious');
        }
        break;
      }
      case 'curious':
        lookAt = pointerFresh ? look.pointer : camera.position.clone(); goal.headZ = 0.38; goal.ear = 0.6; feel('excited', 0.3);
        if (modeT > 1.8) setMode('idle');
        break;
      case 'wander': if (!moveTo || modeT > 8) setMode('idle'); else lookAt = null; break;
      case 'sniff':
        if (!moveTo) { goal.headX = 0.55; goal.bodyY = 0.29; goal.pitch = 0.12; goal.ear = -0.2; if (Math.floor(clock * 6) % 2) goal.headY = 0.12; if (modeT > 2.5) setMode('idle'); }
        else if (modeT > 8) setMode('idle');
        break;
      case 'sit':
        sitPose(); if (pointerFresh) lookAt = look.pointer; else lookAt = camera.position.clone();
        if (modeT > 5) setMode('idle');
        break;
      case 'chase': {
        if (!pointerFresh) { setMode('idle'); break; }
        const target = inArea(look.pointer);
        const dist = target.distanceTo(root.position);
        moveTo = dist > 0.45 ? target : null; run = dist > 0.9; lookAt = look.pointer;
        goal.wag = 0.8; goal.wagSpeed = 14; goal.ear = 0.7; feel('excited', 0.3);
        if (!moveTo) { goal.pitch = 0.25; goal.bodyY = 0.24; goal.crouch = 1; }
        needs.mood = clamp(needs.mood + dt * 0.6, 0, 100);
        if (modeT > 12) setMode('idle');
        break;
      }
      case 'fetch': {
        goal.wag = 0.9; goal.wagSpeed = 15; goal.ear = 0.8; feel('excited', 0.3);
        if (!ballState) { setMode('idle'); break; }
        lookAt = ballState.pos;
        // Steer the body so the mouth, not the body centre, arrives at the ball.
        const target = ballState.pos.clone().setY(0), away = target.clone().sub(root.position).setY(0);
        const spot = away.length() > 1e-3 ? target.clone().sub(away.clone().normalize().multiplyScalar(mouthWorld().setY(0).distanceTo(root.position.clone().setY(0)))) : target;
        moveTo = spot.distanceTo(root.position) > 0.12 ? spot : null; run = true;
        if (!moveTo) turnToward(Math.atan2(away.x, away.z), 5, dt);
        const gap = mouthWorld().setY(0).distanceTo(target);
        if (gap < 0.7) { goal.headX = 0.9; goal.pitch = 0.32; goal.bodyY = 0.25; }
        if (ballState.pos.y < 0.35 && gap < 0.3) { ballState.held = true; setMode('bring'); }
        if (modeT > 14) { ball.visible = false; ballState = null; setMode('idle'); }
        break;
      }
      case 'bring': {
        goal.wag = 0.9; goal.wagSpeed = 15; goal.headX = -0.1;
        const spot = cameraSpot();
        moveTo = spot.distanceTo(root.position) > 0.15 ? spot : null;
        if (!moveTo) {
          lookAt = camera.position.clone(); sitPose();
          if (modeT > 0.3 && ballState?.held) {
            ballState.held = false; ballState.rest = true; ballState.vel.set(0, 0.6, 0); ballState.age = 0; ballState.dropped = true;
            stats.fetches++; needs.mood = clamp(needs.mood + 8, 0, 100); needs.energy = clamp(needs.energy - 2, 0, 100);
            feel('happy', 2); emit('say', '再来!'); emit('heart');
          }
          if (modeT > 2.5) setMode('idle');
        } else modeT = 0;
        break;
      }
      case 'eat': {
        bowl.scale.setScalar(damp(bowl.scale.x, 1, 8, dt));
        const spot = bowl.position.clone().add(root.position.clone().sub(bowl.position).setY(0).normalize().multiplyScalar(1.05));
        if (!look.eating) { moveTo = spot.distanceTo(root.position) > 0.12 ? spot : null; lookAt = bowl.position; }
        if (!moveTo && !look.eating) { look.eating = clock; }
        if (look.eating) {
          turnToward(Math.atan2(bowl.position.x - root.position.x, bowl.position.z - root.position.z), 3, dt);
          goal.headX = 0.75 + Math.sin(clock * 9) * 0.12; goal.pitch = 0.2; goal.bodyY = 0.28; goal.wag = 0.6; goal.wagSpeed = 10; feel('happy', 0.3);
          const eaten = clamp((clock - look.eating) / 3, 0, 1); bone.scale.setScalar(Math.max(0.01, 1 - eaten));
          if (eaten >= 1) {
            look.eating = 0; stats.meals++; needs.energy = clamp(needs.energy + 40, 0, 100); needs.mood = clamp(needs.mood + 5, 0, 100);
            setMode('idle', '好饱~'); feel('happy', 2); bowl.userData.fade = 1;
          }
        }
        if (modeT > 15) { look.eating = 0; setMode('idle'); bowl.userData.fade = 1; }
        break;
      }
      case 'trick': trickPose(dt); break;
      case 'petted':
        goal.ear = -0.4; goal.earBack = 1; goal.wag = 1; goal.wagSpeed = 16; goal.headX = -0.15; goal.headZ = Math.sin(clock * 2) * 0.15; goal.bodyY = 0.3;
        feel(needs.mood > 85 ? 'love' : 'happy', 0.3);
        if (look.pointer) lookAt = look.pointer;
        if (modeT > 1.2 && clock - lastPointerAt > 0.8) setMode('idle');
        break;
      case 'boop':
        lookAt = camera.position.clone(); goal.ear = 0.9;
        goal.bodyY = 0.29 + (modeT > 0.35 && modeT < 0.75 ? Math.sin((modeT - 0.35) / 0.4 * Math.PI) * 0.06 : 0);
        if (modeT > 0.35 && modeT - dt <= 0.35) { feel('happy', 1.2); emit('say', ['汪!', '汪汪!', '嗨~', '找我呀?'][stats.boops % 4]); }
        goal.wag = 0.8; goal.wagSpeed = 14;
        if (modeT > 1.6) setMode('idle');
        break;
      case 'tired':
        liePose(); feel('sad', 0.3); goal.wag = 0; goal.ear = -0.5;
        if (modeT > 4) setMode(needs.energy < 12 ? 'sleep' : 'idle');
        break;
      case 'sleep':
        liePose(); goal.headX = 0.45; goal.headY = 0.35; goal.headZ = 0.25; goal.ear = -0.6; goal.wag = 0; goal.tailUp = -0.2;
        goal.bodyY = 0.15 + Math.sin(clock * 1.4) * 0.004; feel('sleep', 0.5);
        needs.energy = clamp(needs.energy + dt * 0.07, 0, 100);
        if (Math.floor(clock / 1.6) !== Math.floor((clock - dt) / 1.6)) emit('z');
        break;
    }
    if (mode === 'idle' && Math.random() < dt * 0.15) feel(needs.mood > 75 ? 'happy' : 'normal', 1.2);
    if (lookAt) lookAtWorld(lookAt); else { look.x = 0; look.y = 0; }
    return run;
  }
  function sitPose() { goal.pitch = -0.58; goal.bodyY = 0.27; goal.crouch = 0; goal.sit = 1; }
  function liePose() { goal.bodyY = 0.15; goal.pitch = 0.02; goal.lie = 1; }
  function trickPose(dt) {
    const t = modeT;
    goal.wag = 0.7; goal.wagSpeed = 12; feel('excited', 0.3);
    if (trick === 'sit' || trick === 'shake' || trick === 'beg') {
      sitPose(); lookAtWorld(camera.position.clone());
      if (trick === 'shake' && t > 0.6 && t < 2.4) goal.shake = 1;
      if (trick === 'beg' && t > 0.6 && t < 2.4) { goal.pitch = -1.0; goal.bodyY = 0.3; goal.beg = 1; }
      if (t > 3) finishTrick();
    } else if (trick === 'spin') {
      if (t < 1.6) heading += dt * Math.PI * 2 / 1.6;
      if (t > 2) finishTrick();
    } else if (trick === 'jump') {
      const air = t > 0.35 && t < 0.95 ? Math.sin((t - 0.35) / 0.6 * Math.PI) : 0;
      goal.crouch = t < 0.35 ? 1 : 0; goal.bodyY = t < 0.35 ? 0.24 : 0.29; goal.hop = air * 0.22; goal.tuck = air;
      if (t > 1.4) finishTrick();
    } else if (trick === 'bow') {
      goal.pitch = 0.42; goal.bodyY = 0.24; goal.bow = 1; goal.tailUp = 1; goal.headX = -0.35;
      if (t > 2.2) finishTrick();
    }
  }
  function finishTrick() {
    stats.tricks++; needs.mood = clamp(needs.mood + 5, 0, 100); needs.energy = clamp(needs.energy - 3, 0, 100);
    feel('happy', 1.8); emit('heart'); setMode('idle'); trick = null; idleT = 0;
  }

  // ---- Locomotion and IK rig ----
  const solveLeg = (leg, torsoPitch) => {
    const hipLocal = leg.hip.position.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), torsoPitch).add(torso.position);
    const d = leg.target.clone().sub(hipLocal);
    const dz = d.z, dy = d.y;
    const dist = clamp(Math.hypot(dy, dz), 0.04, UPPER + LOWER - 0.002);
    const toward = Math.atan2(-dz, -dy) - torsoPitch;
    const interior = Math.acos(clamp((UPPER * UPPER + LOWER * LOWER - dist * dist) / (2 * UPPER * LOWER), -1, 1));
    const atHip = Math.acos(clamp((UPPER * UPPER + dist * dist - LOWER * LOWER) / (2 * UPPER * dist), -1, 1));
    const s = leg.front > 0 ? 1 : -1;
    leg.hip.rotation.x = toward + s * atHip;
    leg.knee.rotation.x = -s * (Math.PI - interior);
    leg.paw.rotation.x = -(torsoPitch + leg.hip.rotation.x + leg.knee.rotation.x);
  };
  function rig(dt, run) {
    // Steering toward the movement target with a trot gait.
    let targetSpeed = 0;
    if (moveTo) {
      const delta = moveTo.clone().sub(root.position).setY(0);
      const dist = delta.length();
      if (dist < 0.08) moveTo = null;
      else {
        const want = Math.atan2(delta.x, delta.z), turn = Math.atan2(Math.sin(want - heading), Math.cos(want - heading));
        turnToward(want, 5, dt);
        targetSpeed = (run ? 1.6 : 0.7) * clamp(dist / 0.4, 0.3, 1) * (Math.abs(turn) > 1.2 ? 0.3 : 1);
      }
    }
    speed = damp(speed, targetSpeed, 6, dt);
    root.position.addScaledVector(new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)), speed * dt);
    const flat = new THREE.Vector2(root.position.x, root.position.z); if (flat.length() > AREA + 0.1) { flat.setLength(AREA + 0.1); root.position.x = flat.x; root.position.z = flat.y; }
    root.rotation.y = heading;
    gait += dt * (speed / SCALE) / 0.11 * Math.PI;
    for (const key of Object.keys(pose)) { pose[key] = damp(pose[key], goal[key] ?? 0, key === 'hop' || key === 'tuck' ? 18 : 7, dt); }
    for (const key of ['sit', 'lie', 'shake', 'beg', 'bow', 'hop', 'tuck']) delete goal[key];

    const moving = clamp(speed / 0.5, 0, 1), stride = 0.055 * clamp(speed / 1.2, 0.35, 1.2) * moving;
    torso.position.set(0, pose.bodyY + Math.sin(gait * 2) * 0.006 * moving - pose.crouch * 0.04 + pose.hop, -0.03 * pose.sit);
    torso.rotation.set(pose.pitch, 0, Math.sin(gait) * 0.03 * moving);
    for (const leg of legs) {
      const phase = gait + (leg.side * leg.front > 0 ? 0 : Math.PI);
      const swing = Math.sin(phase), lift = Math.max(0, Math.cos(phase)) * 0.045 * moving;
      leg.target.copy(leg.base);
      leg.target.z += swing * stride;
      leg.target.y += lift + pose.hop;
      if (leg.front < 0) leg.target.z += -0.07 * pose.sit + 0.02 * pose.bow + 0.06 * pose.lie;
      else leg.target.z += 0.08 * pose.lie - 0.03 * pose.bow + 0.05 * pose.beg;
      if (leg.front > 0) leg.target.y += 0.09 * pose.beg;
      if (leg.front > 0 && leg.side < 0) { leg.target.y += 0.12 * pose.shake + Math.sin(clock * 9) * 0.02 * pose.shake; leg.target.z += 0.1 * pose.shake; }
      leg.target.y += pose.tuck * 0.05; leg.target.z -= pose.tuck * 0.03 * leg.front;
      solveLeg(leg, pose.pitch);
    }
    neck.rotation.set(-0.15 - pose.pitch * 0.6, 0, 0);
    look.cx = damp(look.cx, look.x, 6, dt); look.cy = damp(look.cy, look.y, 6, dt);
    head.rotation.set(pose.headX - look.cy * 0.8, pose.headY + look.cx * 0.75, pose.headZ, 'YXZ');
    for (const ear of ears) ear.pivot.rotation.set(-0.9 * pose.earBack + Math.sin(clock * 3 + ear.side) * 0.03, 0, ear.side * (0.45 + 1.1 * clamp(pose.ear, -1, 1)) + (mode === 'boop' && modeT < 0.4 ? ear.side * 0.4 : 0));
    wagPhase += dt * pose.wagSpeed;
    tail.rotation.set(-0.5 - pose.tailUp * 0.6, Math.sin(wagPhase) * pose.wag * 0.9, 0);
  }

  function updateProps(dt) {
    if (ballState) {
      const s = ballState; s.age += dt;
      if (s.held) { s.pos.copy(mouthWorld()); ball.rotation.set(0, 0, 0); }
      else if (!s.rest || s.dropped) {
        s.vel.y -= 9.8 * dt; s.pos.addScaledVector(s.vel, dt);
        if (s.pos.y < 0.11) { s.pos.y = 0.11; s.vel.y = Math.abs(s.vel.y) * 0.45; s.vel.x *= 0.7; s.vel.z *= 0.7; if (Math.abs(s.vel.y) < 0.5) { s.vel.y = 0; s.rest = true; } }
        const flat = new THREE.Vector2(s.pos.x, s.pos.z); if (s.age > 0.6 && flat.length() > AREA + 0.2) { flat.setLength(AREA + 0.2); s.pos.x = flat.x; s.pos.z = flat.y; s.vel.x *= -0.4; s.vel.z *= -0.4; }
        if (s.rest) { s.vel.x *= Math.exp(-dt * 2.5); s.vel.z *= Math.exp(-dt * 2.5); }
        ball.rotation.x += s.vel.z * dt * 6; ball.rotation.z -= s.vel.x * dt * 6;
      }
      ball.position.copy(s.pos);
      if (s.dropped && s.age > 3.5) { ball.scale.setScalar(Math.max(0.01, ball.scale.x - dt * 2)); if (ball.scale.x <= 0.02) { ball.visible = false; ball.scale.setScalar(1); ballState = null; } }
    }
    if (bowl.userData.fade) { bowl.scale.setScalar(Math.max(0.01, bowl.scale.x - dt * 1.5)); if (bowl.scale.x <= 0.02) { bowl.visible = false; bowl.userData.fade = 0; } }
    for (let i = sprites.length - 1; i >= 0; i--) {
      const sprite = sprites[i], data = sprite.userData; data.age += dt;
      sprite.position.y += dt * (data.kind === 'say' ? 0.08 : 0.35); sprite.position.x += data.vx * dt;
      sprite.material.opacity = clamp(Math.min(data.age / 0.15, (data.life - data.age) / 0.4), 0, 1);
      if (data.kind === 'say') sprite.scale.set(1.1 * Math.min(1, 0.7 + data.age * 3), 0.55 * Math.min(1, 0.7 + data.age * 3), 1);
      if (data.age >= data.life) { sprite.removeFromParent(); if (sprite.material.map !== heartTexture) sprite.material.map.dispose(); sprite.material.dispose(); sprites.splice(i, 1); }
    }
  }
  function updateFace(dt) {
    if (clock > exprUntil) expression = mode === 'sleep' ? 'sleep' : needs.energy < 15 ? 'sad' : 'normal';
    nextBlink -= dt;
    if (nextBlink < 0) { blink = 0.16; nextBlink = 2 + Math.random() * 4; }
    blink = Math.max(0, blink - dt); open = blink > 0 ? Math.abs(blink - 0.08) / 0.08 : 1;
    const gx = clamp(look.cx * 0.9, -1, 1), gy = clamp(-look.cy * 0.9, -1, 1);
    const key = `${expression}|${open.toFixed(2)}|${gx.toFixed(2)}|${gy.toFixed(2)}`;
    if (key !== faceKey) { faceKey = key; face.redraw({expr: expression, open, gx, gy}); }
    const hue = needs.mood > 70 ? 0x55e6ff : needs.mood > 40 ? 0x9be27a : 0xffb347;
    led.emissive.setHex(hue); tailLed.emissive.setHex(hue);
    led.emissiveIntensity = mode === 'sleep' ? 0.6 + Math.sin(clock * 1.4) * 0.4 : 2.2;
  }
  function publish(dt) {
    reportT -= dt;
    const label = LABELS[mode] ?? '';
    const key = `${label}|${Math.round(needs.mood)}|${Math.round(needs.energy)}`;
    if (key !== lastReport && reportT <= 0) { lastReport = key; reportT = 1; report?.({mood: Math.round(needs.mood), energy: Math.round(needs.energy), activity: label, saved: Date.now()}); }
  }

  const step = dt => {
    clock += dt;
    const run = behave(dt);
    rig(dt, run);
    world.updateMatrixWorld(true);
    updateProps(dt);
    updateFace(dt);
    publish(dt);
  };
  world.updateMatrixWorld(true); step(0.016);

  return {
    object: world, fx, pickables: root, frame: new THREE.Box3(new THREE.Vector3(-AREA - 0.1, 0, -AREA - 0.1), new THREE.Vector3(AREA + 0.1, 1.5, AREA + 0.1)),
    shadowResolution: 256, frameRate: () => (mode === 'sleep' ? 12 : 30),
    update(delta) { step(Math.min(delta, 0.05)); return {active: true, moved: true}; },
    pointer(type, info) {
      if (info?.ground) {
        const point = world.worldToLocal(info.ground.clone());
        if (look.pointer) look.pointerTravel += point.distanceTo(look.pointer);
        if (clock - look.pointerTime > 1) look.pointerTravel = 0;
        look.pointer = point; look.pointerTime = clock;
      }
      if (type === 'leave') { look.pointer = null; return false; }
      if (type === 'down' && info.hit) { lastPointerAt = clock; pettedStroke = 0; return true; }
      if (type === 'drag') {
        lastPointerAt = clock;
        if (info.delta) pettedStroke += info.delta;
        if (pettedStroke > 40 && mode !== 'petted') { wake(); setMode('petted'); emit('heart'); }
        if (mode === 'petted') { needs.mood = clamp(needs.mood + (info.delta ?? 0) * 0.02, 0, 100); if (Math.random() < (info.delta ?? 0) * 0.01) emit('heart'); }
        return true;
      }
      if (type === 'click') {
        if (info.hit) { clearTimeout(boopTimer); boopTimer = setTimeout(boop, 240); }
        else if (info.ground && new THREE.Vector2(info.ground.x, info.ground.z).length() < AREA + 0.6 && mode !== 'fetch' && mode !== 'bring') throwBall(world.worldToLocal(info.ground.clone()));
      }
      return false;
    },
    dblclick(info) { clearTimeout(boopTimer); if (info.hit) doTrick(); },
    action() { doTrick(); },
    command(name) {
      idleT = 0;
      if (name === 'ball') throwBall();
      else if (name === 'feed') feed();
      else if (name === 'trick') doTrick();
      else if (name === 'sleep') { if (mode === 'sleep') { wake(); emit('say', '早上好!'); } else setMode('sleep'); }
    },
    simulate(seconds) { for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30); world.updateMatrixWorld(true); },
    get state() { return {mode, ...needs, ...stats, sleeping: mode === 'sleep', ball: Boolean(ballState), position: root.position.toArray()}; },
    dispose() { clearTimeout(boopTimer); heartTexture.dispose(); }
  };
}
