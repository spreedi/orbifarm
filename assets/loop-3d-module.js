// OrbiPlant® Module — 3D visualisation (open serpentine)
// ---------------------------------------------------------------------
// Correct topology (per user clarification April 2026):
//   - A single continuous belt enters at the LEFT (intake / seedlings)
//     and exits at the RIGHT (harvest / outlet). It is NOT a closed loop.
//   - The belt serpentines through 6 loops left → right, each loop
//     consisting of an up-run, a top wrap (180°) around a big pulley, and
//     a down-run. Between adjacent loops, a short transfer at the bottom
//     moves the belt from one loop's down-run to the next loop's up-run
//     (180° wrap around a small bottom pulley).
//   - Belt segments are discrete pods/trays; at the outlet they are
//     removed, cleaned, replanted, and re-inserted at the intake.
//
// Per-loop architecture (inside view):
//   - Aeroponic spray chamber INSIDE each loop (between up-run and down-run)
//     — nozzles spray the roots which hang inward.
//   - Plants face OUTWARD from each run (leaves away from belt centre,
//     roots into the spray chamber).
//   - LED panels are mounted BETWEEN loops (in the gap between down-run of
//     loop N and up-run of loop N+1), illuminating the plants on both
//     adjacent runs from the outside.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

RectAreaLightUniformsLib.init();

// ---------------------------------------------------------------------------
// Public API — mount the 3D loop module into a container element.
//   const handle = initLoop3D(document.getElementById('loop3d'), {
//     autoRotate: true,     // default true — slow auto-orbit until user drags
//     pauseWhenHidden: true, // default true — stop animating when out of viewport
//   });
//   handle.dispose();  // call to tear down (optional)
// ---------------------------------------------------------------------------
export function initLoop3D(container, opts = {}) {
  if (!container) throw new Error('initLoop3D: container element required');
  const autoRotate      = opts.autoRotate      !== false;
  const pauseWhenHidden = opts.pauseWhenHidden !== false;

  // Ensure container has positioning + size context
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.style.overflow = 'hidden';

  const getW = () => Math.max(1, container.clientWidth);
  const getH = () => Math.max(1, container.clientHeight);

// ---------------------------------------------------------------------------
// Module geometry (metres)
// ---------------------------------------------------------------------------
const NUM_LOOPS       = 6;
const MODULE_HEIGHT   = 2.7;
const MODULE_DEPTH    = 1.25;       // along Z (belt width)
const PULLEY_RADIUS   = 0.255;      // R255 top pulleys
const LOOP_WIDTH      = 0.92;       // per-loop horizontal footprint (along X) — wider gap for LED panels + plants
const RUN_OFFSET      = PULLEY_RADIUS;                              // up/down runs sit ±R from loop centre
const LOOP_GAP        = LOOP_WIDTH - 2 * RUN_OFFSET;                // gap between adjacent loops (along X)
const BOTTOM_PULLEY_R = Math.min(0.16, LOOP_GAP / 2);               // small idler between loops

const MODULE_WIDTH    = NUM_LOOPS * LOOP_WIDTH;

// centre of loop i (0..NUM_LOOPS-1) along X
function loopCX(i) {
  return (i + 0.5) * LOOP_WIDTH - MODULE_WIDTH / 2;
}

// ---------------------------------------------------------------------------
// Renderer + scene
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(getW(), getH());
renderer.setClearColor(0x05030a, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.style.display = 'block';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0514, 0.025);

const camera = new THREE.PerspectiveCamera(38, getW() / getH(), 0.05, 100);
camera.position.set(3.5, 2.2, 5.0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, MODULE_HEIGHT / 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2;
controls.maxDistance = 15;
controls.autoRotate = false;  // We drive camera manually for a cinematic flyover

// ---------------------------------------------------------------------------
// CINEMATIC CAMERA FLYOVER
// When idle, the camera smoothly tours key angles around the installation:
// wide shot → seed intake closeup → high side view → near top-down → harvest
// closeup → back wide → repeat. Pauses instantly on user interaction and
// resumes after IDLE_RESUME_DELAY seconds, smoothly blending from the user's
// last viewpoint into the cinematic path.
// ---------------------------------------------------------------------------
const cinematicKeyframes = [
  // Wide front-right (default entry shot)
  { pos: new THREE.Vector3( 3.8,  2.4,  5.2), target: new THREE.Vector3( 0.0,  MODULE_HEIGHT * 0.5, 0) },
  // Close intake — seeds/seedlings in focus
  { pos: new THREE.Vector3(-3.2,  1.3,  3.8), target: new THREE.Vector3(-MODULE_WIDTH / 2 - 0.3, 0.4, 0) },
  // High front-left overview
  { pos: new THREE.Vector3(-4.5,  3.4,  2.0), target: new THREE.Vector3(-1.5, 1.4, 0) },
  // Near top-down (bird's-eye sweep)
  { pos: new THREE.Vector3( 0.3,  5.2,  1.2), target: new THREE.Vector3( 0.0, 1.0, 0) },
  // Harvest closeup — robot + outlet
  { pos: new THREE.Vector3( 5.0,  2.0,  2.5), target: new THREE.Vector3( MODULE_WIDTH / 2 + 0.2, 1.6, 0) },
  // Back high — reverse-angle wide
  { pos: new THREE.Vector3( 0.8,  3.2, -5.0), target: new THREE.Vector3( 0.0, 1.4, 0) },
  // Back low — low reverse angle
  { pos: new THREE.Vector3(-2.5,  1.6, -4.2), target: new THREE.Vector3(-0.5, 1.1, 0) },
];

const CINE_SEGMENT_DURATION  = 5.5;   // seconds per segment (~38 s full cycle)
const CINE_IDLE_RESUME_DELAY = 12;    // seconds of idle before resuming
const CINE_RESUME_BLEND      = 2.5;   // seconds to blend back into cinematic

let cinematicActive   = autoRotate;
let cinematicElapsed  = 0;
let idleSinceT        = -1;
let resumeBlendT      = 1;            // 1 = fully cinematic
let currentSceneTime  = 0;            // updated each animate() frame
const _resumeFromPos    = new THREE.Vector3();
const _resumeFromTarget = new THREE.Vector3();
const _posInterp        = new THREE.Vector3();
const _tgtInterp        = new THREE.Vector3();
const _blendVec         = new THREE.Vector3();

function cineEaseInOut(x) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function updateCinematic(dt, t) {
  // Auto-resume after idle
  if (!cinematicActive && idleSinceT > 0 && (t - idleSinceT) >= CINE_IDLE_RESUME_DELAY) {
    cinematicActive = true;
    _resumeFromPos.copy(camera.position);
    _resumeFromTarget.copy(controls.target);
    resumeBlendT = 0;
    cinematicElapsed = 0;
  }

  if (!cinematicActive) return;

  cinematicElapsed += dt;
  if (resumeBlendT < 1) {
    resumeBlendT = Math.min(1, resumeBlendT + dt / CINE_RESUME_BLEND);
  }

  const cycle  = cinematicKeyframes.length * CINE_SEGMENT_DURATION;
  const cT     = cinematicElapsed % cycle;
  const segIdx = Math.floor(cT / CINE_SEGMENT_DURATION);
  const localT = (cT % CINE_SEGMENT_DURATION) / CINE_SEGMENT_DURATION;
  const eased  = cineEaseInOut(localT);

  const kfA = cinematicKeyframes[segIdx];
  const kfB = cinematicKeyframes[(segIdx + 1) % cinematicKeyframes.length];

  _posInterp.lerpVectors(kfA.pos,    kfB.pos,    eased);
  _tgtInterp.lerpVectors(kfA.target, kfB.target, eased);

  if (resumeBlendT < 1) {
    const be = cineEaseInOut(resumeBlendT);
    camera.position.lerpVectors(_resumeFromPos, _posInterp, be);
    _blendVec.lerpVectors(_resumeFromTarget, _tgtInterp, be);
    controls.target.copy(_blendVec);
  } else {
    camera.position.copy(_posInterp);
    controls.target.copy(_tgtInterp);
  }
}

// Track interaction — pause cinematic instantly, resume after idle.
let userHasInteracted = false;
controls.addEventListener('start', () => {
  userHasInteracted = true;
  cinematicActive = false;
  idleSinceT = -1;
});
controls.addEventListener('end', () => {
  idleSinceT = currentSceneTime;
});

// ---------------------------------------------------------------------------
// Lighting — neutral studio
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xc9b3ff, 0x0a0514, 0.5));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
keyLight.position.set(5, 6, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left   = -3;
keyLight.shadow.camera.right  =  3;
keyLight.shadow.camera.top    =  3.5;
keyLight.shadow.camera.bottom = -0.5;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 20;
keyLight.shadow.bias = -0.0005;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xa896ff, 0.4);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x120a20, metalness: 0.25, roughness: 0.85 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.02;
floor.receiveShadow = true;
scene.add(floor);

// ---------------------------------------------------------------------------
// BELT PATH — open serpentine from left to right.
// Entry: bottom-left, slightly below floor, horizontal stub going into loop 0.
// Exit:  bottom-right, horizontal stub going out of last loop.
// Segments array: each segment is a line or arc; together they form the path
// parameterised by distance from intake.
// ---------------------------------------------------------------------------
function buildBeltSegments() {
  const segs = [];
  const yBot = BOTTOM_PULLEY_R;                 // bottom pulley centre height
  const yTop = MODULE_HEIGHT - PULLEY_RADIUS;   // top pulley centre height
  const intakeX = -MODULE_WIDTH / 2 - 0.85;      // longer intake stub \u2014 seedling area
  const outletX =  MODULE_WIDTH / 2 + 0.3;      // outlet stub ends 30 cm right

  // --- intake stub: horizontal line from intakeX to first up-run X, at y = yBot
  const firstUpX = loopCX(0) - RUN_OFFSET;
  segs.push({
    kind: 'line',
    p0: new THREE.Vector3(intakeX, yBot, 0),
    p1: new THREE.Vector3(firstUpX, yBot, 0),
    outward: new THREE.Vector3(0, 1, 0),   // plants on top (horizontal belt)
  });

  for (let i = 0; i < NUM_LOOPS; i++) {
    const cx = loopCX(i);
    const xUp = cx - RUN_OFFSET;
    const xDn = cx + RUN_OFFSET;

    // up-run (straight, yBot → yTop) — plants face outward = -X (away from loop centre)
    segs.push({
      kind: 'line',
      p0: new THREE.Vector3(xUp, yBot, 0),
      p1: new THREE.Vector3(xUp, yTop, 0),
      outward: new THREE.Vector3(-1, 0, 0),
    });

    // top wrap: semicircle around (cx, yTop) from angle π to 0 (over the top)
    segs.push({
      kind: 'arc',
      centre: new THREE.Vector3(cx, yTop, 0),
      radius: RUN_OFFSET,
      aStart: Math.PI,
      aEnd: 0,
      // plants on this arc face outward = radial outward (+Y at top)
      wrapSide: 'top',
    });

    // down-run (straight, yTop → yBot) — plants face outward = +X
    segs.push({
      kind: 'line',
      p0: new THREE.Vector3(xDn, yTop, 0),
      p1: new THREE.Vector3(xDn, yBot, 0),
      outward: new THREE.Vector3(1, 0, 0),
    });

    // transfer to next loop (if not last): 180° wrap under the next bottom pulley
    if (i < NUM_LOOPS - 1) {
      const nextCx = loopCX(i + 1);
      const xNextUp = nextCx - RUN_OFFSET;
      const midCX  = (xDn + xNextUp) / 2;
      const rArc   = (xNextUp - xDn) / 2;
      segs.push({
        kind: 'arc',
        centre: new THREE.Vector3(midCX, yBot, 0),
        radius: rArc,
        aStart: Math.PI,    // (midCX - r, yBot) = (xDn, yBot)
        aEnd: 2 * Math.PI,  // (midCX + r, yBot) = (xNextUp, yBot) — via bottom (dips under floor? no, under = +y negative)
        wrapSide: 'bottom',
      });
    }
  }

  // outlet stub: horizontal from last down-run bottom to outletX
  const lastDnX = loopCX(NUM_LOOPS - 1) + RUN_OFFSET;
  segs.push({
    kind: 'line',
    p0: new THREE.Vector3(lastDnX, yBot, 0),
    p1: new THREE.Vector3(outletX, yBot, 0),
    outward: new THREE.Vector3(0, 1, 0),   // horizontal run → plants on top
  });

  // Compute lengths + cumulative t coordinates
  let total = 0;
  for (const s of segs) {
    if (s.kind === 'line') s.length = s.p0.distanceTo(s.p1);
    else                   s.length = Math.PI * s.radius;
    s.t0 = total;
    total += s.length;
    s.t1 = total;
  }
  for (const s of segs) { s.t0 /= total; s.t1 /= total; }
  return { segs, totalLength: total };
}

const { segs: BELT_SEGS, totalLength: BELT_LENGTH } = buildBeltSegments();

// Sample position, tangent, outward at parameter t ∈ [0,1]
function sampleBelt(t) {
  t = Math.max(0, Math.min(1, t));
  for (const s of BELT_SEGS) {
    if (t >= s.t0 && t <= s.t1 + 1e-9) {
      const u = (t - s.t0) / Math.max(1e-9, s.t1 - s.t0);
      if (s.kind === 'line') {
        const pos = new THREE.Vector3().lerpVectors(s.p0, s.p1, u);
        const tan = new THREE.Vector3().subVectors(s.p1, s.p0).normalize();
        return { pos, tangent: tan, outward: s.outward.clone() };
      } else {
        // arc: angle interpolated from aStart → aEnd
        const ang = s.aStart + (s.aEnd - s.aStart) * u;
        const x = s.centre.x + s.radius * Math.cos(ang);
        const y = s.centre.y + s.radius * Math.sin(ang);
        const pos = new THREE.Vector3(x, y, 0);
        const tanSign = s.aEnd > s.aStart ? +1 : -1;
        const tan = new THREE.Vector3(-Math.sin(ang) * tanSign, Math.cos(ang) * tanSign, 0).normalize();
        // outward = radial direction from arc centre
        const outward = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0);
        return { pos, tangent: tan, outward };
      }
    }
  }
  // fallback
  return { pos: new THREE.Vector3(), tangent: new THREE.Vector3(1,0,0), outward: new THREE.Vector3(0,1,0) };
}

// ---------------------------------------------------------------------------
// Belt visualisation: twin tubes along ±Z edges + perpendicular slats
// ---------------------------------------------------------------------------
function buildBelt() {
  const group = new THREE.Group();

  const SAMPLES = 800;
  // Belt body — solid dark grey, no transparency
  const beltMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a22, metalness: 0.55, roughness: 0.55,
    side: THREE.DoubleSide,
  });

  // Build the belt as a solid strip with rectangular cross-section spanning
  // the module depth. Approach: generate a TubeGeometry along the belt path
  // but with an elliptical cross-section (wide × thin) so it looks like a
  // flat solid belt.
  //
  // Easier: for each sample step, build two triangles connecting the belt
  // surface across the depth. We construct a ribbon mesh.
  const topVerts = [];
  const botVerts = [];
  const beltThickness = 0.012;   // 12 mm
  const beltHalfW = MODULE_DEPTH * 0.48;

  for (let i = 0; i <= SAMPLES; i++) {
    const { pos, tangent, outward } = sampleBelt(i / SAMPLES);
    // normal to belt surface: use `outward` (the 'top' face points outward
    // where plants are). opposite face points inward.
    const n = outward.clone().normalize();
    // Top surface position (pushed outward by half thickness)
    const topCentre = pos.clone().addScaledVector(n, beltThickness / 2);
    const botCentre = pos.clone().addScaledVector(n, -beltThickness / 2);
    // Edges in ±Z direction (belt width)
    const edge = new THREE.Vector3(0, 0, 1);
    topVerts.push(topCentre.clone().addScaledVector(edge, -beltHalfW));
    topVerts.push(topCentre.clone().addScaledVector(edge, +beltHalfW));
    botVerts.push(botCentre.clone().addScaledVector(edge, -beltHalfW));
    botVerts.push(botCentre.clone().addScaledVector(edge, +beltHalfW));
  }

  // Build a BufferGeometry: two strips (top + bottom) + two side strips
  function buildStrip(verts) {
    const positions = [];
    const normals = [];
    for (let i = 0; i < verts.length - 2; i += 2) {
      const a = verts[i];
      const b = verts[i + 1];
      const c = verts[i + 2];
      const d = verts[i + 3];
      // Two triangles (a,b,d) and (a,d,c)
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
      positions.push(a.x, a.y, a.z, d.x, d.y, d.z, c.x, c.y, c.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  const topGeo = buildStrip(topVerts);
  const botGeo = buildStrip(botVerts);
  const topMesh = new THREE.Mesh(topGeo, beltMat);
  const botMesh = new THREE.Mesh(botGeo, beltMat);
  topMesh.castShadow = true; topMesh.receiveShadow = true;
  botMesh.castShadow = true; botMesh.receiveShadow = true;
  group.add(topMesh);
  group.add(botMesh);

  // Side strips (connecting top and bottom edges) — left (-z) and right (+z)
  const sideVertsL = [];
  const sideVertsR = [];
  for (let i = 0; i <= SAMPLES; i++) {
    sideVertsL.push(topVerts[i * 2].clone());      // -z top
    sideVertsL.push(botVerts[i * 2].clone());      // -z bot
    sideVertsR.push(topVerts[i * 2 + 1].clone()); // +z top
    sideVertsR.push(botVerts[i * 2 + 1].clone()); // +z bot
  }
  const leftGeo = buildStrip(sideVertsL);
  const rightGeo = buildStrip(sideVertsR);
  const leftMesh = new THREE.Mesh(leftGeo, beltMat);
  const rightMesh = new THREE.Mesh(rightGeo, beltMat);
  leftMesh.castShadow = true; leftMesh.receiveShadow = true;
  rightMesh.castShadow = true; rightMesh.receiveShadow = true;
  group.add(leftMesh);
  group.add(rightMesh);

  // Subtle slat ridges on the belt top surface (every 8 cm) — visual detail
  const slatMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a35, metalness: 0.6, roughness: 0.4,
  });
  const SLAT_SPACING = 0.08;
  const numSlats = Math.round(BELT_LENGTH / SLAT_SPACING);
  for (let i = 0; i < numSlats; i++) {
    const t = i / numSlats;
    const { pos, tangent, outward } = sampleBelt(t);
    const slatGeo = new THREE.BoxGeometry(0.008, 0.004, MODULE_DEPTH * 0.92);
    const slat = new THREE.Mesh(slatGeo, slatMat);
    // push slightly outside the top surface
    const p = pos.clone().addScaledVector(outward.clone().normalize(), beltThickness / 2 + 0.002);
    slat.position.copy(p);
    slat.rotation.z = Math.atan2(tangent.y, tangent.x);
    group.add(slat);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Pulleys — top (R255) and bottom (small) cylinders along Z
// ---------------------------------------------------------------------------
function buildPulleys() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1220, metalness: 0.85, roughness: 0.35 });
  const depth = MODULE_DEPTH * 0.88;

  // Only top pulleys (R255). No bottom idlers — belt does a bare 180° transfer.
  for (let i = 0; i < NUM_LOOPS; i++) {
    const cx = loopCX(i);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(RUN_OFFSET * 0.92, RUN_OFFSET * 0.92, depth, 32),
      mat,
    );
    top.position.set(cx, MODULE_HEIGHT - PULLEY_RADIUS, 0);
    top.rotation.x = Math.PI / 2;
    top.castShadow = true;
    group.add(top);
  }
  return group;
}

// ---------------------------------------------------------------------------
// Aeroponic spray chambers — INSIDE each loop, between up-run and down-run.
// Semi-transparent blue cylinder/capsule with nozzles.
// ---------------------------------------------------------------------------
function buildAeroponics() {
  const group = new THREE.Group();

  // Thin, glass-blue "column" inside each loop — subtle chamber outline
  const chamberMat = new THREE.MeshPhysicalMaterial({
    color: 0xa8d8ff, metalness: 0.0, roughness: 0.05,
    transmission: 0.92, thickness: 0.015, ior: 1.33,
    transparent: true, opacity: 0.2, side: THREE.DoubleSide,
    envMapIntensity: 1.5,
  });
  const manifoldMat = new THREE.MeshStandardMaterial({
    color: 0xd0d8e0, metalness: 0.85, roughness: 0.3,
  });
  const nozzleMat = new THREE.MeshStandardMaterial({
    color: 0x8099b0, metalness: 0.7, roughness: 0.35,
  });

  // Layered spray cone for each nozzle — inner bright cone + outer soft cone
  const sprayInnerMat = new THREE.MeshBasicMaterial({
    color: 0xc8e8ff, transparent: true, opacity: 0.75,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const sprayOuterMat = new THREE.MeshBasicMaterial({
    color: 0xe8f3ff, transparent: true, opacity: 0.4,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  for (let i = 0; i < NUM_LOOPS; i++) {
    const cx = loopCX(i);

    // Subtle chamber envelope — slim & mostly transparent
    const chamberW = RUN_OFFSET * 1.3;
    const chamber = new THREE.Mesh(
      new THREE.BoxGeometry(chamberW, MODULE_HEIGHT * 0.82, MODULE_DEPTH * 0.85),
      chamberMat,
    );
    chamber.position.set(cx, MODULE_HEIGHT / 2, 0);
    group.add(chamber);

    // Central vertical manifold (water supply pipe)
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, MODULE_HEIGHT * 0.82, 16),
      manifoldMat,
    );
    pipe.position.set(cx, MODULE_HEIGHT / 2, 0);
    pipe.castShadow = true;
    group.add(pipe);

    // Nozzles: 3 columns along Z × several heights, spraying left and right
    // BUT only in directions where there's an adjacent loop (plants) —
    // don't spray outward from the module's outer edges.
    const nozzleHeights = [0.35, 0.75, 1.15, 1.55, 1.95, 2.35];
    const zCols = [-MODULE_DEPTH * 0.3, 0, MODULE_DEPTH * 0.3];
    const sprayDirs = [];
    if (i > 0) sprayDirs.push(-1);              // spray left only if neighbour left
    if (i < NUM_LOOPS - 1) sprayDirs.push(+1);  // spray right only if neighbour right

    for (const y of nozzleHeights) {
      for (const z of zCols) {
        for (const dir of sprayDirs) {
          // Nozzle body — small cone
          const nozzle = new THREE.Mesh(
            new THREE.ConeGeometry(0.015, 0.04, 12),
            nozzleMat,
          );
          nozzle.position.set(cx + dir * 0.025, y, z);
          nozzle.rotation.z = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
          group.add(nozzle);

          // Nozzle tip (bright emissive dot)
          const tip = new THREE.Mesh(
            new THREE.SphereGeometry(0.005, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xdff0ff }),
          );
          tip.position.set(cx + dir * 0.048, y, z);
          group.add(tip);

          // Outer soft spray cone
          const coneLen = RUN_OFFSET * 0.85;
          const coneR = RUN_OFFSET * 0.55;
          const outerSpray = new THREE.Mesh(
            new THREE.ConeGeometry(coneR, coneLen, 20, 1, true),
            sprayOuterMat.clone(),
          );
          outerSpray.position.set(cx + dir * (0.05 + coneLen / 2), y, z);
          outerSpray.rotation.z = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
          outerSpray.userData.baseOpacity = 0.4;
          group.add(outerSpray);
          (group.userData.sprayCones ||= []).push(outerSpray);

          // Inner bright spray cone
          const innerSpray = new THREE.Mesh(
            new THREE.ConeGeometry(coneR * 0.6, coneLen * 0.85, 16, 1, true),
            sprayInnerMat.clone(),
          );
          innerSpray.position.set(cx + dir * (0.05 + coneLen * 0.42), y, z);
          innerSpray.rotation.z = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
          innerSpray.userData.baseOpacity = 0.75;
          group.add(innerSpray);
          (group.userData.sprayCones ||= []).push(innerSpray);
        }
      }
    }

    // Extra: animated mist particles drifting outward from each nozzle column.
    // Each particle travels along ±X (outward from manifold), fades, then respawns.
    const mistParticleMat = new THREE.MeshBasicMaterial({
      color: 0xe8f3ff, transparent: true, opacity: 0.85,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mistParticles = [];
    for (const y of nozzleHeights) {
      for (const z of zCols) {
        for (const dir of sprayDirs) {
          // 14 particles per nozzle, staggered — dense mist cloud
          for (let p = 0; p < 14; p++) {
            const particle = new THREE.Mesh(
              new THREE.SphereGeometry(0.014 + Math.random() * 0.01, 6, 5),
              mistParticleMat.clone(),
            );
            // Initial random offset along travel path
            const travel = RUN_OFFSET * 0.85;
            const u = Math.random();                       // initial progress 0..1
            particle.position.set(
              cx + dir * (0.05 + u * travel),
              y + (Math.random() - 0.5) * 0.02,
              z + (Math.random() - 0.5) * 0.02,
            );
            particle.userData.cx = cx;
            particle.userData.y0 = y;
            particle.userData.z0 = z;
            particle.userData.dir = dir;
            particle.userData.u = u;
            particle.userData.speed = 0.35 + Math.random() * 0.35;  // u/s
            particle.userData.travel = travel;
            particle.userData.jitter = Math.random() * Math.PI * 2;
            group.add(particle);
            mistParticles.push(particle);
          }
        }
      }
    }
    // Stash particles on the group so animate() can update them
    group.userData.mistParticles = (group.userData.mistParticles || []).concat(mistParticles);
  }

  return group;
}

// ---------------------------------------------------------------------------
// LED panels — BETWEEN loops (and at the two outer edges), illuminating the
// adjacent belt runs from the outside.
// Panel positions along X: at every gap between loops, i.e. at x = loopEdge.
// Outer panels at the far left and far right edges too.
// ---------------------------------------------------------------------------
function buildLEDs() {
  const group = new THREE.Group();

  const housingMat = new THREE.MeshStandardMaterial({
    color: 0x1a0f22, metalness: 0.8, roughness: 0.35,
  });

  // Horticulture spectrum — subtle magenta mix instead of distinct stripes.
  // Just two close magenta tones for a faint vertical variation.
  const stripeColors = [
    0xff2a9c,
    0xd63fb0,
    0xff2a9c,
    0xd63fb0,
    0xff2a9c,
    0xd63fb0,
  ];

  // Panel positions along X \u2014 outer LEFT panel omitted so the seedling intake
  // stays visible in this view.
  const positions = [];
  for (let i = 0; i < NUM_LOOPS - 1; i++) {
    const xMid = (loopCX(i) + loopCX(i + 1)) / 2;
    positions.push({ x: xMid, faces: 'both' });
  }
  positions.push({ x: loopCX(NUM_LOOPS - 1) + RUN_OFFSET + 0.06, faces: 'left' });

  const panelH = MODULE_HEIGHT * 0.88;
  const panelD = MODULE_DEPTH * 0.88;
  const panelThick = 0.04;

  // Area-light colour: magenta-pink (equal red + blue, pulls toward violet)
  const hortiLight = 0xff3fc8;

  // Helper: build striped emissive surface on one side of the housing
  function buildStripedFace(sign) {
    // sign = +1 for right face, -1 for left face
    // Build panelH tall, panelD wide, split into horizontal stripes along H
    const faceGroup = new THREE.Group();
    const stripeCount = stripeColors.length;
    const stripeH = panelH / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: stripeColors[i] });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(panelD, stripeH), mat);
      // Position along Y (local) — at local centre so the group pivot is at panel centre
      strip.position.set(0, -panelH / 2 + stripeH / 2 + i * stripeH, 0);
      faceGroup.add(strip);
    }
    faceGroup.rotation.y = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    faceGroup.rotation.z = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
    // Hmm, with rotation.y = ±π/2, we're rotating the XY plane around Y.
    // After this the plane faces ±X. The stripe-Y translation above becomes
    // translation in local Y which after rotation maps to world Z. We actually
    // want stripes along Y (world). Simpler: build stripes differently.
    return faceGroup;
  }

  for (const pos of positions) {
    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(panelThick, panelH, panelD),
      housingMat,
    );
    housing.position.set(pos.x, MODULE_HEIGHT / 2, 0);
    housing.castShadow = true;
    group.add(housing);

    // Build striped emissive face directly in world coordinates
    function addFace(sign) {
      const stripeCount = stripeColors.length;
      const stripeH = panelH / stripeCount;
      for (let i = 0; i < stripeCount; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: stripeColors[i] });
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(panelD, stripeH), mat);
        // Face points ±X, so plane normal is ±X.
        // Orient: rotate plane so its normal is along X. Default plane normal is +Z.
        // Rotate around Y by ±π/2.
        strip.rotation.y = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
        // Now plane spans ±Y (height) × ±Z (width). Position stripe along Y.
        const yCentre = MODULE_HEIGHT / 2 - panelH / 2 + stripeH / 2 + i * stripeH;
        strip.position.set(
          pos.x + sign * (panelThick / 2 + 0.001),
          yCentre,
          0,
        );
        group.add(strip);
      }
      // Single magenta area light per face (cheaper than one per stripe)
      const light = new THREE.RectAreaLight(hortiLight, 6.0, panelD, panelH);
      light.position.set(pos.x + sign * (panelThick / 2 + 0.005), MODULE_HEIGHT / 2, 0);
      light.rotation.y = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
      light.rotation.z = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(light);
    }

    if (pos.faces === 'right' || pos.faces === 'both') addFace(+1);
    if (pos.faces === 'left'  || pos.faces === 'both') addFace(-1);
  }

  return group;
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------
function buildFrame() {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x3a3042, metalness: 0.75, roughness: 0.45,
  });

  const w = MODULE_WIDTH / 2 + 0.08;
  const d = MODULE_DEPTH / 2 + 0.08;
  const h = MODULE_HEIGHT + 0.15;

  const colGeo = new THREE.BoxGeometry(0.06, h, 0.06);
  for (const [x, z] of [[-w,-d],[w,-d],[-w,d],[w,d]]) {
    const c = new THREE.Mesh(colGeo, frameMat);
    c.position.set(x, h / 2 - 0.08, z);
    c.castShadow = true;
    group.add(c);
  }

  for (const y of [h - 0.08, -0.05]) {
    for (const z of [-d, d]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(MODULE_WIDTH + 0.16, 0.06, 0.06), frameMat);
      r.position.set(0, y, z);
      r.castShadow = true;
      group.add(r);
    }
    for (const x of [-w, w]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, MODULE_DEPTH + 0.16), frameMat);
      r.position.set(x, y, 0);
      r.castShadow = true;
      group.add(r);
    }
  }

  return group;
}

// ---------------------------------------------------------------------------
// Plants — discrete pods on the belt. Pod is removed at outlet, travels back
// conceptually (not visualised) and is re-added at intake. We fake this by
// respawning a plant at t=0 each time it passes t=1, with a fresh seedling.
// ---------------------------------------------------------------------------
const LEAF_COLORS = [0xb8d945, 0x9dd25c, 0x7fc24a, 0x6fc24a, 0x55963a, 0x4fa839];

function buildPod(stage) {
  const group = new THREE.Group();

  // Pod / tray — grey box, mounted on belt. Local axes: +X = outward (plant),
  // -X = roots into spray chamber, Z = along belt width.
  const podMat = new THREE.MeshStandardMaterial({
    color: 0x3a3040, metalness: 0.55, roughness: 0.4,
  });
  const pod = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.028, 0.14), podMat);
  pod.castShadow = true;
  group.add(pod);

  // --- Leaves ---------------------------------------------------------------
  // Build a rosette of leaves emanating outward (+X) from pod face, with
  // natural variation. Leaf count and size scale with growth stage.
  const leafColor = new THREE.Color().lerpColors(
    new THREE.Color(0xb8d945),   // young lime
    new THREE.Color(0x3f8f2a),   // mature deep green
    Math.min(1, stage * 1.15),
  );
  const leafMat = new THREE.MeshStandardMaterial({
    color: leafColor,
    roughness: 0.6, metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const leafSize = 0.026 + Math.pow(stage, 0.7) * 0.14;   // cm — larger plants
  const leafCount = 8 + Math.floor(Math.pow(stage, 0.6) * 18);

  for (let i = 0; i < leafCount; i++) {
    // Use a simple leaf shape built from a Shape
    const leafShape = new THREE.Shape();
    const L = leafSize * (0.8 + Math.random() * 0.4);
    const W = L * (0.45 + Math.random() * 0.15);
    leafShape.moveTo(0, 0);
    leafShape.bezierCurveTo(W * 0.5, W * 0.25, W, W * 0.45, L * 0.6, W * 0.1);
    leafShape.bezierCurveTo(L * 0.9, W * 0.05, L, 0, L, 0);
    leafShape.bezierCurveTo(L * 0.9, -W * 0.05, L * 0.6, -W * 0.1, L * 0.4, -W * 0.1);
    leafShape.bezierCurveTo(W * 0.2, -W * 0.25, 0, -W * 0.1, 0, 0);
    const leafGeo = new THREE.ShapeGeometry(leafShape, 6);
    const leaf = new THREE.Mesh(leafGeo, leafMat);

    // Distribute around +X hemisphere: azimuth around X-axis, tilt outward
    const azimuth = (i / leafCount) * Math.PI * 2 + Math.random() * 0.4;
    const tiltOut = Math.PI * 0.15 + Math.random() * Math.PI * 0.3;   // leaves point mostly outward with slight spread

    // Position leaf base on pod face (at +X)
    const baseR = 0.022;
    leaf.position.set(
      baseR + Math.random() * 0.005,
      Math.sin(azimuth) * baseR * 0.5,
      Math.cos(azimuth) * baseR * 0.5,
    );

    // Build leaf orientation: leaf's local X axis points outward from pod,
    // rotated around pod's X axis by azimuth, then tilted outward by tiltOut.
    leaf.rotation.order = 'YXZ';
    leaf.rotation.x = azimuth;                                     // rotate leaf plane around X to spread around
    leaf.rotation.z = -Math.PI / 2 + tiltOut;                      // tilt from X toward Y
    leaf.rotation.y = (Math.random() - 0.5) * 0.5;                 // slight twist

    leaf.castShadow = true;
    leaf.receiveShadow = true;
    group.add(leaf);
  }

  // Central bud/stem
  if (stage < 0.25) {
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.004, 0.015, 6),
      leafMat,
    );
    stem.position.set(0.022, 0, 0);
    stem.rotation.z = -Math.PI / 2;
    group.add(stem);
  }

  // --- Roots (-X into spray chamber) ---------------------------------------
  const rootMat = new THREE.MeshStandardMaterial({ color: 0xf0e2c0, roughness: 0.95 });
  const rootCount = 5 + Math.floor(Math.pow(stage, 0.8) * 12);
  const rootMaxLen = 0.04 + stage * 0.11;
  for (let i = 0; i < rootCount; i++) {
    const len = rootMaxLen * (0.5 + Math.random() * 0.5);
    const rg = new THREE.CylinderGeometry(0.0008, 0.0018, len, 4);
    const root = new THREE.Mesh(rg, rootMat);
    // Orient along -X
    root.rotation.z = Math.PI / 2;
    root.position.set(
      -len / 2 - 0.014,
      (Math.random() - 0.5) * 0.018,
      (Math.random() - 0.5) * 0.06,
    );
    // Slight random splay
    root.rotation.y = (Math.random() - 0.5) * 0.7;
    root.rotation.x = (Math.random() - 0.5) * 0.5;
    group.add(root);
  }

  return group;
}

// Per belt position we place a ROW of pods across the belt width (Z axis).
// PODS_PER_ROW = number of individual plant positions across the belt.
const PODS_PER_ROW = 7;

function buildPodRow(stage) {
  const group = new THREE.Group();
  const zSpacing = MODULE_DEPTH * 0.88 / PODS_PER_ROW;
  const z0 = -MODULE_DEPTH * 0.88 / 2 + zSpacing / 2;
  for (let i = 0; i < PODS_PER_ROW; i++) {
    // tiny stagger in stage for organic look
    const localStage = Math.max(0.02, Math.min(1, stage + (Math.random() - 0.5) * 0.04));
    const pod = buildPod(localStage);
    pod.position.z = z0 + i * zSpacing;
    group.add(pod);
  }
  return group;
}

class Pod {
  constructor(offset) {
    this.offset = offset;
    this.prevWrap = -1;
    this.group  = new THREE.Group();
    this.inner  = null;
    this._rebuild(offset);
  }
  _rebuild(stage) {
    if (this.inner) {
      this.group.remove(this.inner);
      this.inner.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
    }
    this.inner = buildPodRow(stage);
    this.group.add(this.inner);
    this.stage = stage;
  }
  update(baseT) {
    const raw = baseT + this.offset;
    const wrap = Math.floor(raw);
    const t = raw - wrap;
    if (wrap !== this.prevWrap) {
      this.prevWrap = wrap;
      this._rebuild(Math.max(0.02, t));
    } else if (Math.abs(t - this.stage) > 0.1) {
      this._rebuild(t);
    }

    const { pos, outward } = sampleBelt(t);
    this.group.position.copy(pos);

    const x = outward.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    let y = up.clone().sub(x.clone().multiplyScalar(x.dot(up)));
    if (y.lengthSq() < 1e-6) y = new THREE.Vector3(0, 0, 1);
    y.normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    this.group.quaternion.setFromRotationMatrix(m);
  }
}

// ---------------------------------------------------------------------------
// Intake / outlet indicators (floor-level markers + labels)
// ---------------------------------------------------------------------------
function buildEndMarkers() {
  const group = new THREE.Group();
  const greenMat = new THREE.MeshBasicMaterial({ color: 0xb8d945 });
  const orangeMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d });

  // Intake marker (left)
  const intake = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.008, 8, 24), greenMat);
  intake.position.set(-MODULE_WIDTH / 2 - 0.3, 0.01, 0);
  intake.rotation.x = Math.PI / 2;
  group.add(intake);

  // Outlet marker (right)
  const outlet = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.008, 8, 24), orangeMat);
  outlet.position.set(MODULE_WIDTH / 2 + 0.3, 0.01, 0);
  outlet.rotation.x = Math.PI / 2;
  group.add(outlet);

  return group;
}

// ---------------------------------------------------------------------------
// Harvest robot — a pick-and-place delta-style arm at the right end.
// Suggests automated harvesting of pods as they exit the module.
// ---------------------------------------------------------------------------
let harvestArmJoint1, harvestArmJoint2, harvestGripper, harvestBase;

function buildHarvestRobot() {
  const group = new THREE.Group();
  const baseX = MODULE_WIDTH / 2 + 0.55;   // just right of outlet

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x9aa0b0, metalness: 0.9, roughness: 0.3,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x221a2c, metalness: 0.8, roughness: 0.35,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0xff8a3d, metalness: 0.4, roughness: 0.5,
    emissive: 0x3a1a05, emissiveIntensity: 0.3,
  });

  // Pedestal base (floor-mounted column)
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.15, 0.9, 16),
    darkMat,
  );
  pedestal.position.set(baseX, 0.45, 0);
  pedestal.castShadow = true;
  group.add(pedestal);

  // Top cap with rotary joint
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16),
    steelMat,
  );
  cap.position.set(baseX, 0.93, 0);
  cap.castShadow = true;
  group.add(cap);

  // Shoulder (rotates horizontally) — base pivot
  harvestBase = new THREE.Group();
  harvestBase.position.set(baseX, 1.0, 0);
  group.add(harvestBase);

  // Upper arm (horizontal segment) — pivots at base, extends toward belt
  harvestArmJoint1 = new THREE.Group();
  harvestBase.add(harvestArmJoint1);
  const upperArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.08, 0.09),
    steelMat,
  );
  upperArm.position.set(-0.275, 0, 0);
  upperArm.castShadow = true;
  harvestArmJoint1.add(upperArm);
  // Elbow marker
  const elbow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.1, 12),
    accentMat,
  );
  elbow.position.set(-0.55, 0, 0);
  elbow.rotation.x = Math.PI / 2;
  harvestArmJoint1.add(elbow);

  // Lower arm — pivots at elbow
  harvestArmJoint2 = new THREE.Group();
  harvestArmJoint2.position.set(-0.55, 0, 0);
  harvestArmJoint1.add(harvestArmJoint2);
  const lowerArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.06, 0.07),
    steelMat,
  );
  lowerArm.position.set(-0.225, 0, 0);
  lowerArm.castShadow = true;
  harvestArmJoint2.add(lowerArm);

  // Gripper — end effector with two claws
  harvestGripper = new THREE.Group();
  harvestGripper.position.set(-0.45, 0, 0);
  harvestArmJoint2.add(harvestGripper);

  const gripperHousing = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.12, 0.12),
    darkMat,
  );
  harvestGripper.add(gripperHousing);
  // Accent LED on gripper
  const gripperLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8a3d }),
  );
  gripperLed.position.set(0, 0.075, 0);
  harvestGripper.add(gripperLed);
  // Two claws (thin boxes pointing down)
  for (const zSide of [-1, +1]) {
    const claw = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.08, 0.012),
      steelMat,
    );
    claw.position.set(0, -0.09, zSide * 0.035);
    harvestGripper.add(claw);
  }

  // Collection bin (floor-level, right of robot)
  const bin = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.3, 0.7),
    darkMat,
  );
  bin.position.set(baseX + 0.4, 0.15, 0);
  bin.castShadow = true;
  bin.receiveShadow = true;
  group.add(bin);
  // Accent strip on bin
  const binAccent = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.02, 0.72),
    accentMat,
  );
  binAccent.position.set(baseX + 0.4, 0.31, 0);
  group.add(binAccent);

  return group;
}

function animateHarvestRobot(t) {
  if (!harvestBase) return;
  // Simple pick-and-place cycle: 4s period
  const cycle = (t * 0.25) % 1;   // 0..1 every 4s

  // Phase 1 (0.0 - 0.35): move over belt to pick
  // Phase 2 (0.35 - 0.5):  descend & close
  // Phase 3 (0.5 - 0.85):  move to bin
  // Phase 4 (0.85 - 1.0):  release & return

  let shoulderRot, elbowRot, baseRot;
  if (cycle < 0.35) {
    // Over belt: shoulder ~0, elbow ~0 (arm extended left toward belt)
    const u = cycle / 0.35;
    baseRot = 0;             // face belt
    shoulderRot = 0;         // horizontal
    elbowRot = 0;            // straight
  } else if (cycle < 0.5) {
    // Descend: tilt lower arm down to touch belt
    const u = (cycle - 0.35) / 0.15;
    baseRot = 0;
    shoulderRot = -0.2 * u;
    elbowRot = 0.4 * u;
  } else if (cycle < 0.85) {
    // Move to bin: rotate base to point right, lift up
    const u = (cycle - 0.5) / 0.35;
    baseRot = Math.PI * u * 0.5;   // rotate to +X side (bin)
    shoulderRot = -0.2 + 0.2 * u;
    elbowRot = 0.4 - 0.4 * u;
  } else {
    // Return to belt side
    const u = (cycle - 0.85) / 0.15;
    baseRot = Math.PI * 0.5 * (1 - u);
    shoulderRot = 0;
    elbowRot = 0;
  }

  harvestBase.rotation.y = baseRot;
  harvestArmJoint1.rotation.z = shoulderRot;
  harvestArmJoint2.rotation.z = elbowRot;
}

// ---------------------------------------------------------------------------
// Water sump / reservoir — sealed enclosure under the module catches spray
// runoff and cycles it back to the manifolds. Shown with return pipes.
// ---------------------------------------------------------------------------
function buildSump() {
  const group = new THREE.Group();

  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x2a2433, metalness: 0.55, roughness: 0.5,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x1f1a28, metalness: 0.7, roughness: 0.4,
  });
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0xc8ccd2, metalness: 0.9, roughness: 0.25,
  });
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x5ba8d6, metalness: 0.0, roughness: 0.1,
    transmission: 0.7, thickness: 0.05, ior: 1.33,
    transparent: true, opacity: 0.7,
  });

  const sumpW = MODULE_WIDTH + 0.24;
  const sumpD = MODULE_DEPTH + 0.24;
  const sumpH = 0.45;
  const sumpTop = -0.02;
  const sumpY = sumpTop - sumpH / 2;

  // Main shell (closed box)
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(sumpW, sumpH, sumpD),
    shellMat,
  );
  shell.position.set(0, sumpY, 0);
  shell.castShadow = true;
  shell.receiveShadow = true;
  group.add(shell);

  // Top accent strip (seam)
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(sumpW + 0.01, 0.025, sumpD + 0.01),
    accentMat,
  );
  strip.position.set(0, sumpTop - 0.012, 0);
  group.add(strip);

  // Water level visible through a thin strip of transparent window on front face
  const window = new THREE.Mesh(
    new THREE.BoxGeometry(sumpW * 0.5, 0.1, 0.005),
    waterMat,
  );
  window.position.set(0, sumpY + 0.02, sumpD / 2 + 0.001);
  group.add(window);

  // Pump/filter unit — front-mounted box
  const pump = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.22, 0.15),
    accentMat,
  );
  pump.position.set(-MODULE_WIDTH / 2 + 0.2, sumpY + 0.05, sumpD / 2 + 0.07);
  pump.castShadow = true;
  group.add(pump);
  // Pump status LED
  const pumpLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3fc8 }),
  );
  pumpLed.position.set(-MODULE_WIDTH / 2 + 0.32, sumpY + 0.12, sumpD / 2 + 0.15);
  group.add(pumpLed);

  // Return pipes — one per loop, going from the sump up through the frame to
  // each manifold's top. Run along -Z side so the front view stays clean.
  const zSide = -MODULE_DEPTH / 2 - 0.06;
  for (let i = 0; i < NUM_LOOPS; i++) {
    const cx = loopCX(i);
    // Vertical riser
    const riser = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, MODULE_HEIGHT + 0.2, 12),
      pipeMat,
    );
    riser.position.set(cx, MODULE_HEIGHT / 2 + 0.05, zSide);
    riser.castShadow = true;
    group.add(riser);

    // Small T-fitting at top where it enters the manifold
    const fitting = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.05, 12),
      pipeMat,
    );
    fitting.position.set(cx, MODULE_HEIGHT + 0.12, zSide);
    group.add(fitting);

    // Horizontal connector going from riser to manifold (along Z)
    const connector = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, Math.abs(zSide), 12),
      pipeMat,
    );
    connector.rotation.x = Math.PI / 2;
    connector.position.set(cx, MODULE_HEIGHT + 0.08, zSide / 2);
    group.add(connector);

    // Small drip return at bottom (connecting sump top to floor of loop area)
    const drip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.08, 10),
      pipeMat,
    );
    drip.position.set(cx, sumpTop + 0.04, 0);
    group.add(drip);
  }

  return group;
}


const root = new THREE.Group();
scene.add(root);

root.add(buildFrame());
root.add(buildSump());
root.add(buildPulleys());
root.add(buildBelt());
const aeroGroup = buildAeroponics();
root.add(aeroGroup);
root.add(buildLEDs());
root.add(buildEndMarkers());
const harvestRobot = buildHarvestRobot();
root.add(harvestRobot);

// ---------------------------------------------------------------------------
// 3D LABELS — sprite-based callouts at key module components.
// Labels always face the camera (billboard behaviour) and render on top so they
// stay legible through the mesh geometry.
// ---------------------------------------------------------------------------
function makeLabelSprite(text) {
  const fontSize = 40;
  const padding = 20;
  const dotSize = 8;
  const fontFamily = "600 " + fontSize + "px 'Segoe UI', system-ui, -apple-system, sans-serif";

  // Measure on a scratch context
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = fontFamily;
  const textW = Math.ceil(measure.measureText(text).width);
  const dotSpace = dotSize * 2 + 12;

  const w = textW + dotSpace + padding * 2;
  const h = fontSize + padding;

  // Draw at 2× for crispness
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width  = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // Rounded rect (manual, for broad compatibility)
  const r = 10;
  ctx.fillStyle   = 'rgba(8, 13, 10, 0.88)';
  ctx.strokeStyle = '#00c853';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Accent dot
  ctx.fillStyle = '#00c853';
  ctx.beginPath();
  ctx.arc(padding + dotSize, h / 2, dotSize, 0, Math.PI * 2);
  ctx.fill();

  // Text
  ctx.fillStyle = '#e8f5e9';
  ctx.font = fontFamily;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding + dotSpace, h / 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest:  false,   // always visible over geometry
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 999;

  // World size: aim for ~18 cm label height, aspect-correct width
  const labelHeight = 0.18;
  const aspect = w / h;
  sprite.scale.set(labelHeight * aspect, labelHeight, 1);

  return sprite;
}

const labelsGroup = new THREE.Group();
labelsGroup.name = 'labels';

// Seed Area — above intake stub, left side, low
const seedLabel = makeLabelSprite('Seed Area');
seedLabel.position.set(-MODULE_WIDTH / 2 - 0.55, 0.55, 0);
labelsGroup.add(seedLabel);

// Aeroponics — mid-left, above loop spray chambers
const aeroLabel = makeLabelSprite('Aeroponics');
aeroLabel.position.set(-MODULE_WIDTH / 4, MODULE_HEIGHT / 2 + 0.25, 0);
labelsGroup.add(aeroLabel);

// LED Lighting — above top, between loops
const ledLabel = makeLabelSprite('LED Lighting');
ledLabel.position.set(MODULE_WIDTH / 4, MODULE_HEIGHT + 0.35, 0);
labelsGroup.add(ledLabel);

// Harvest Area — above robot arm, right side
const harvestLabel = makeLabelSprite('Harvest Area');
harvestLabel.position.set(MODULE_WIDTH / 2 + 0.75, 1.85, 0);
labelsGroup.add(harvestLabel);

scene.add(labelsGroup);

// Pods evenly spaced along entire path
const POD_COUNT = 280;
const pods = [];
for (let i = 0; i < POD_COUNT; i++) {
  const p = new Pod(i / POD_COUNT);
  pods.push(p);
  root.add(p.group);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Optional UI hooks — only active if the page provides #btn-auto / #btn-reset
// (Fullscreen demo HTML has them; embedded mode typically doesn't)
// ---------------------------------------------------------------------------
const btnAuto = document.getElementById('btn-auto');
const btnReset = document.getElementById('btn-reset');
if (btnAuto) {
  btnAuto.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    btnAuto.classList.toggle('active', controls.autoRotate);
  });
  btnAuto.classList.toggle('active', controls.autoRotate);
}
if (btnReset) {
  btnReset.addEventListener('click', () => {
    camera.position.set(3.5, 2.2, 5.0);
    controls.target.set(0, MODULE_HEIGHT / 2, 0);
  });
}

// ---------------------------------------------------------------------------
// Post-processing: subtle bloom on LED faces
// ---------------------------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(getW(), getH()),
  0.25,   // strength
  0.5,    // radius
  0.8,    // threshold
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let baseT = 0;
const SPEED = 0.004;    // positive — pods advance left→right along the serpentine belt
let rafId = 0;

function animate() {
  const dt = clock.getDelta();
  const t  = clock.getElapsedTime();
  currentSceneTime = t;
  updateCinematic(dt, t);
  baseT = (baseT + dt * SPEED) % 1;
  for (const p of pods) p.update(baseT);

  // Animate mist particles: drift outward from nozzle along ±X, fade out,
  // then respawn near the nozzle. Interval-based: spray pulses on/off.
  // Cycle: 2.5s ON, 2.0s OFF (4.5s total per cycle).
  const SPRAY_CYCLE = 4.5;
  const SPRAY_ON = 2.5;
  const cycleT = t % SPRAY_CYCLE;
  let sprayLevel = 0;
  if (cycleT < SPRAY_ON) {
    const u = cycleT / SPRAY_ON;                // 0..1 within active window
    sprayLevel = Math.min(1, Math.sin(u * Math.PI) * 1.6);  // ramp up, hold, ramp down
  }

  const mist = aeroGroup.userData.mistParticles;
  if (mist) {
    for (const pt of mist) {
      if (sprayLevel > 0) {
        pt.userData.u += dt * pt.userData.speed;
        if (pt.userData.u > 1) pt.userData.u -= 1;
      }
      const u = pt.userData.u;
      const travel = pt.userData.travel;
      pt.position.x = pt.userData.cx + pt.userData.dir * (0.05 + u * travel);
      pt.position.y = pt.userData.y0 + Math.sin(t * 1.5 + pt.userData.jitter) * 0.008;
      pt.position.z = pt.userData.z0 + Math.cos(t * 1.2 + pt.userData.jitter) * 0.012;
      const fade = Math.sin(u * Math.PI);
      pt.material.opacity = (0.25 + fade * 0.75) * sprayLevel;
      pt.visible = sprayLevel > 0.02;
      const s = (1 + u * 1.2) * (0.6 + 0.4 * sprayLevel);
      pt.scale.setScalar(s);
    }
  }

  // Modulate spray cone opacity in sync with the pulse
  const cones = aeroGroup.userData.sprayCones;
  if (cones) {
    for (const cone of cones) {
      cone.material.opacity = cone.userData.baseOpacity * sprayLevel;
      cone.visible = sprayLevel > 0.02;
    }
  }

  // Animate harvest robot arm
  animateHarvestRobot(t);

  controls.update();
  composer.render();
  rafId = requestAnimationFrame(animate);
}
rafId = requestAnimationFrame(animate);

// ---------------------------------------------------------------------------
// Resize — observe container (not window) so it reflows inside any layout
// ---------------------------------------------------------------------------
const resizeObserver = new ResizeObserver(() => {
  const w = getW(), h = getH();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
});
resizeObserver.observe(container);

// Pause rendering when the container is out of the viewport — saves battery/CPU
// for other sections of the page.
let isPaused = false;
const visObserver = pauseWhenHidden
  ? new IntersectionObserver((entries) => {
      const visible = entries[0].isIntersecting;
      if (visible && isPaused) {
        isPaused = false;
        clock.start();
        rafId = requestAnimationFrame(animate);
      } else if (!visible && !isPaused) {
        isPaused = true;
        cancelAnimationFrame(rafId);
        clock.stop();
      }
    }, { threshold: 0.01 })
  : null;
if (visObserver) visObserver.observe(container);

// ---------------------------------------------------------------------------
// Cleanup handle — call dispose() to fully tear down (optional)
// ---------------------------------------------------------------------------
return {
  renderer,
  scene,
  camera,
  controls,
  dispose() {
    cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
    if (visObserver) visObserver.disconnect();
    controls.dispose();
    renderer.dispose();
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  },
};

} // end initLoop3D
