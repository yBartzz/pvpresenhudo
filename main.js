import * as THREE from './lib/three.module.js';
import { RGBELoader } from './lib/loaders/RGBELoader.js';
import { FBXLoader } from './lib/loaders/FBXLoader.js';
import { clone as skClone } from './lib/utils/SkeletonUtils.js';

/* =====================================================================
   PEDRO CITY  -  mini GTA em Three.js
   Convenção: um ângulo h aponta para (-sin h, -cos h) no plano x/z.
   ===================================================================== */

/* ---------------- utilidades ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
let genPhase = true; const _genRng = (() => { let a = 777123; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
const choice = a => a[((genPhase ? _genRng() : Math.random()) * a.length) | 0]; // na geração do mapa usa semente fixa (multijogador vê o mesmo mundo)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const headingTo = (dx, dz) => Math.atan2(-dx, -dz);
const fwdOf = h => ({ x: -Math.sin(h), z: -Math.cos(h) });
const $ = id => document.getElementById(id);
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = mulberry32(20260905); // mundo sempre igual

/* ---------------- constantes do mapa ---------------- */

/* ---------------- assets (texturas, céu) ---------------- */
{ const b = $('goBtn'); if (b) b.textContent = 'CARREGANDO...'; }
let gameReady = false;
const AS = {};
{
  const TL = new THREE.TextureLoader(), jobs = [];
  const add = (k, url, srgb) => jobs.push(TL.loadAsync(url).then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; AS[k] = t; }).catch(() => { console.warn('asset ausente:', url); }));
  for (const [k, f] of [['grass', 'grass_ground'], ['forest', 'forest_ground_06'], ['rock', 'gray_rocks'], ['sand', 'dense_sand'], ['pave', 'brick_pavement_03'], ['asph', 'asphalt_02'], ['brick', 'red_brick']]) { add(k + 'D', `assets/tex/${f}_diff_1k.jpg`, true); add(k + 'N', `assets/tex/${f}_nor_gl_1k.jpg`, false); }
  for (const n of ['PineTree_Leaves', 'NormalTree_Leaves', 'BirchTree_Leaves', 'MapleTree_Leaves', 'PalmTree_Leaves', 'Bush_Leaves']) add(n, `assets/nature/${n}.png`, true);
  for (const n of ['PineTree_Bark', 'NormalTree_Bark', 'BirchTree_Bark', 'MapleTree_Bark', 'PalmTree_Trunk']) { add(n, `assets/nature/${n}.jpg`, true); add(n + '_Normal', `assets/nature/${n}_Normal.jpg`, false); }
  jobs.push(Promise.all([fetch('assets/models.json').then(r => r.json()), fetch('assets/models.bin').then(r => r.arrayBuffer())]).then(([j, b]) => { AS.models = j; AS.mbin = new Float32Array(b); }).catch(() => { console.warn('modelos ausentes'); }));
  jobs.push(new RGBELoader().loadAsync('assets/kloofendal_48d_partly_cloudy_puresky_1k.hdr').then(t => { AS.hdr = t; }).catch(() => { console.warn('céu HDR ausente'); }));
  await Promise.all(jobs);
}
// monta uma geometria (posição, normal, cor por vértice) a partir de um modelo convertido
function modelGeo(name, k, pick, colorOf, xf) { // pick(part, group) -> usa?; colorOf(group, part) -> hex; xf([x,y,z]) -> [x,y,z] opcional
  const M = AS.models[name], pos = [], nor = [], col = [], c = new THREE.Color();
  for (const p of M.parts) for (const g of p.groups) {
    if (!pick(p, g)) continue; c.set(colorOf(g, p));
    for (let i = g.start; i < g.start + g.count; i++) {
      const a = p.off + i * 3, b = p.off + p.n * 3 + i * 3; let v = [AS.mbin[a] * k, AS.mbin[a + 1] * k, AS.mbin[a + 2] * k], n = [AS.mbin[b], AS.mbin[b + 1], AS.mbin[b + 2]];
      if (xf) { v = xf(v, p); n = xf(n, null); }
      pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); col.push(c.r, c.g, c.b);
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeBoundingSphere(); return geo;
}
const hasModel = n => !!(AS.models && AS.models[n] && AS.mbin);
const flatTex = (r, g, b) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
const texOr = (k, r, g, b) => AS[k] || flatTex(r, g, b);
// detalhe em coordenadas do mundo (cor + relevo) aplicado sobre um material já existente
function worldDetail(mat, key, diff, nor, o) {
  if (!diff) return mat;
  mat.onBeforeCompile = sh => {
    sh.uniforms.wdD = { value: diff }; sh.uniforms.wdN = { value: nor || diff };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = position; vWN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D wdD; uniform sampler2D wdN; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 wN = normalize(vWN);
      vec2 wu = ${o.wall ? '(abs(wN.y) > 0.5 ? vWP.xz : vec2(vWP.x * wN.z - vWP.z * wN.x, vWP.y))' : 'vWP.xz'} * ${o.scale.toFixed(3)};
      vec3 wd = texture2D(wdD, wu).rgb;
      ${o.mode === 'replace' ? `diffuseColor.rgb = wd * ${o.gain.toFixed(3)};` : `diffuseColor.rgb *= mix(1.0, clamp(dot(wd, vec3(.3, .59, .11)) * ${o.gain.toFixed(3)}, 0.35, 1.9), ${(o.mix ?? 1).toFixed(2)});`}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      ${nor ? `vec3 wnm = texture2D(wdN, wu).xyz * 2.0 - 1.0;
      vec3 wT = ${o.wall ? '(abs(wN.y) > 0.5 ? vec3(1., 0., 0.) : normalize(vec3(wN.z, 0., -wN.x)))' : 'vec3(1., 0., 0.)'};
      vec3 wB = ${o.wall ? '(abs(wN.y) > 0.5 ? vec3(0., 0., -1.) : vec3(0., 1., 0.))' : 'vec3(0., 0., -1.)'};
      normal = normalize(normal + (viewMatrix * vec4(wT * wnm.x + wB * wnm.y, 0.0)).xyz * ${(o.nk ?? 0.6).toFixed(2)});` : ''}`);
  };
  mat.customProgramCacheKey = () => 'wd_' + key; return mat;
}

/* ---------------- renderer / cena ---------------- */
const canvas = $('game');
let savedQ = null; try { savedQ = localStorage.getItem('pedro_q'); } catch (e) { /* sem armazenamento */ }
const QNAME = /[?&]low/.test(location.search) ? 'baixa' : (['baixa', 'media', 'alta'].includes(savedQ) ? savedQ : 'media');
const QUAL = { baixa: { pr: 1, shadow: 0, soft: false, aa: false, treeNear: 110, npcDist: 110, label: 'BAIXA' }, media: { pr: 1.25, shadow: 1536, soft: false, aa: true, treeNear: 170, npcDist: 150, label: 'MÉDIA' }, alta: { pr: 1.75, shadow: 2560, soft: true, aa: true, treeNear: 250, npcDist: 200, label: 'ALTA' } }[QNAME];
const LOW = QNAME === 'baixa';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUAL.aa, powerPreference: 'high-performance' });
const BASE_PR = Math.min(devicePixelRatio, QUAL.pr); let resScale = 1;
renderer.setPixelRatio(BASE_PR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = QUAL.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfe0ff, 170, 640);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.3, 800);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x8a8a70, 0.8));
const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(QUAL.shadow || 512, QUAL.shadow || 512);
Object.assign(sun.shadow.camera, { left: -62, right: 62, top: 62, bottom: -62, near: 1, far: 320 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const muzzleLight = new THREE.PointLight(0xffc060, 0, 14);
scene.add(muzzleLight);
const intLight = new THREE.PointLight(0xfff0d8, 0, 45, 2);
scene.add(intLight);
let intTarget = 0;

/* ---------------- materiais / geometrias ---------------- */
const _m = {};
const lam = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return _m[k] || (_m[k] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, metalness: 0.0, ...o })); };
const _g = {};
const geoBox = (w, h, d) => { const k = w + 'x' + h + 'x' + d; return _g[k] || (_g[k] = new THREE.BoxGeometry(w, h, d)); };
function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null, cast = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; if (parent) parent.add(m); return m;
}
function plane(w, d, color, x, y, z, opts) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lam(color, opts));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

/* ---------------- listas do mundo ---------------- */
const buildings = [];   // {x0,x1,z0,z1,h}
const statics = [];     // {x,z,r}
const props = [];
const chars = [];
const cars = [];
const bullets = [];
const pickups = [];
const parks = [];

/* ---------------- céu, sol, nuvens ---------------- */
let sky = null, sunDisc = null; const clouds = [];
const SUN_DIR = AS.hdr ? new THREE.Vector3(0.555, 0.743, 0.372) : new THREE.Vector3(0.51, 0.8, 0.33).normalize();
if (AS.hdr) { // céu fotográfico: fundo + reflexos + luz ambiente
  AS.hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = AS.hdr; scene.backgroundIntensity = 0.85;
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromEquirectangular(AS.hdr).texture; pm.dispose();
  scene.fog.color.setRGB(0.44, 0.5, 0.63).multiplyScalar(0.85);
} else {
  sky = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 vP;void main(){float h=normalize(vP).y;vec3 top=vec3(.2,.5,.95);vec3 hor=vec3(.75,.88,1.);vec3 c=mix(hor,top,pow(max(h,0.),.55));if(h<0.)c=mix(hor,vec3(.42,.46,.4),min(1.,-h*4.));gl_FragColor=vec4(c,1.);}'
  }));
  sky.frustumCulled = false; sky.renderOrder = -2; scene.add(sky);
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 24, 12), sky.material));
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(envScene, 0.02).texture; pm.dispose();
  sunDisc = new THREE.Mesh(new THREE.SphereGeometry(26, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfffadc, fog: false })); scene.add(sunDisc);
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.SphereGeometry(rand(10, 18), 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false })); sp.scale.y = 0.45; sp.position.set(k * 14 - 20, rand(-2, 3), rand(-6, 6)); g.add(sp); }
    g.position.set(rand(-650, 650), rand(130, 200), rand(-650, 650)); scene.add(g); clouds.push(g);
  }
}

console.log('[boot] world start', Math.round(performance.now()));
/* ---------------- geometria mesclada (peças com cor por vértice) ---------------- */
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
const T4 = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(_v1.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _v2.set(sx, sy, sz));
const part = (g, c, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => ({ g, c, m: T4(x, y, z, sx, sy, sz, rx, ry, rz) });
function mergeParts(list) {
  const gs = list.map(p => { const g = p.g.index ? p.g.toNonIndexed() : p.g.clone(); if (p.m) g.applyMatrix4(p.m); return g; });
  let n = 0; for (const g of gs) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), tc = new THREE.Color();
  let o = 0;
  gs.forEach((g, i) => {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); tc.set(list[i].c);
    for (let k = 0; k < g.attributes.position.count; k++) { col[(o + k) * 3] = tc.r; col[(o + k) * 3 + 1] = tc.g; col[(o + k) * 3 + 2] = tc.b; }
    o += g.attributes.position.count; g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
function prof(pts, w, bevel = 0.07) { // perfil lateral (x = comprimento, y = altura) extrudado em largura; frente fica em -z
  const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.02, w - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -(w - 2 * bevel) / 2); g.rotateY(Math.PI / 2); return g;
}
const UG = { box: new THREE.BoxGeometry(1, 1, 1), sph: new THREE.SphereGeometry(1, 14, 10), cyl: new THREE.CylinderGeometry(1, 1, 1, 12), cone: new THREE.ConeGeometry(1, 1, 10) };


const START = { x: -252.5, z: -8 };
/* ---------------- constantes do mapa ---------------- */
const CELL = 4, HALF_X = 640, HALF_Z = 720, GW = (HALF_X * 2) / CELL + 1, GH = (HALF_Z * 2) / CELL + 1;
const BOUND_X = 610, BOUND_Z = 700;
const URBAN_H = 1.0, INT_X = -2000;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function hash2(ix, iz) { let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z, o = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, z * f); f *= 2; a *= 0.5; } return s / (1 - Math.pow(0.5, o)) ; }

// ilhas (centro x, z, raio x, raio z)
const BLOBS = [
  [-300, -440, 200, 230], [-300, -30, 215, 260], [-250, 345, 175, 190],
  [275, -420, 160, 190], [290, -40, 195, 265], [255, 355, 175, 200],
  [5, -215, 52, 62], [0, 235, 50, 42], [-120, -655, 90, 50], [130, 560, 100, 70]
];
const HILLS = [[-300, -450, 210, 230, 1], [285, -440, 170, 190, 1], [-340, 330, 120, 140, 0.45], [340, 350, 130, 150, 0.4], [5, -215, 50, 60, 0.35]];
const URB = [[-440, -100, -200, 480], [110, 485, -235, 480]];
function urbanW(x, z) {
  let w = 0;
  for (const r of URB) { const d = Math.min(x - r[0], r[1] - x, z - r[2], r[3] - z); w = Math.max(w, smooth(-60, 0, d)); }
  return w;
}
function landField(x, z) {
  let f = 0;
  for (const b of BLOBS) { const dx = (x - b[0]) / b[2], dz = (z - b[1]) / b[3]; f += Math.exp(-(dx * dx + dz * dz)); }
  return f * (0.8 + 0.42 * fbm(x * 0.0075 + 11, z * 0.0075 + 7, 4));
}
function hillMask(x, z) {
  let m = 0;
  for (const h of HILLS) { const dx = (x - h[0]) / h[2], dz = (z - h[1]) / h[3]; m += h[4] * Math.exp(-(dx * dx + dz * dz) * 1.1); }
  return Math.min(1, m);
}
const CITY_HILLS = [[-430, -120, 24, 80], [-175, 175, 15, 70], [195, -155, 18, 75], [310, 335, 15, 70], [-335, 335, 13, 60], [-120, -20, 10, 45]];
function cityRoll(x, z, u) {
  const core = smooth(85, 190, Math.hypot(x + 260, z + 40));
  if (core <= 0) return 0;
  let h = (fbm(x * 0.0048 + 90, z * 0.0048 + 50, 3) - 0.47) * 16; if (h < 0) h *= 0.08;
  for (const b of CITY_HILLS) { const d2 = (x - b[0]) ** 2 + (z - b[1]) ** 2; h += b[2] * Math.exp(-d2 / (2 * b[3] * b[3])); }
  return h * core * smooth(0.5, 1.0, u) * (1 - smooth(290, 345, x));
}
function rawHeight(x, z) {
  const u = (landField(x, z) - 0.37) / 0.13;
  if (u < 0) return Math.max(-14, u * 16);
  let h = 0.05 + smooth(0, 0.5, u) * (URBAN_H - 0.05);
  const uw = urbanW(x, z), land = smooth(0.2, 0.9, u);
  const hm = hillMask(x, z) * (1 - uw);
  if (hm > 0.003) {
    const n1 = fbm(x * 0.0055 + 3, z * 0.0055 + 9, 5), rid = 1 - Math.abs(2 * fbm(x * 0.0032 + 40, z * 0.0032 + 17, 4) - 1);
    h += hm * land * (n1 * n1 * 34 + rid * rid * 38);
  }
  h += (1 - uw) * land * (fbm(x * 0.014 + 5, z * 0.014 + 3, 3) - 0.45) * 1.7;
  if (uw > 0.02) h += uw * cityRoll(x, z, u);
  return Math.max(h, 0.06);
}

/* ---------------- grade de alturas ---------------- */
const H = new Float32Array(GW * GH);
for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) H[j * GW + i] = rawHeight(i * CELL - HALF_X, j * CELL - HALF_Z);
const H0 = Float32Array.from(H);
function sampleGrid(arr, x, z) {
  if (x < -1500) return 0;
  let fx = (x + HALF_X) / CELL, fz = (z + HALF_Z) / CELL;
  fx = clamp(fx, 0, GW - 1.001); fz = clamp(fz, 0, GH - 1.001);
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, k = iz * GW + ix;
  const a = arr[k], b = arr[k + 1], c = arr[k + GW], d = arr[k + GW + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}
const terrainH = (x, z) => sampleGrid(H, x, z);

/* ---------------- rede de estradas (nós + curvas) ---------------- */
const ROAD_W = { street: 14, main: 16, rural: 10, bridge: 16, beach: 14 };
const ROAD_SPEED = { street: 12, main: 17, rural: 16, bridge: 22, beach: 10 };
const nodes = [], edges = [], decks = [];
function addNode(x, z, tag) { const n = { id: nodes.length, x, z, y: 0, edges: [], tag }; nodes.push(n); return n; }
function catmull(P, step = 6) {
  const out = [], n = P.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), k = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s < k; s++) {
      const t = s / k, t2 = t * t, t3 = t2 * t, f = q => 0.5 * ((2 * p1[q]) + (-p0[q] + p2[q]) * t + (2 * p0[q] - 5 * p1[q] + 4 * p2[q] - p3[q]) * t2 + (-p0[q] + 3 * p1[q] - 3 * p2[q] + p3[q]) * t3);
      out.push({ x: f(0), z: f(1) });
    }
  }
  out.push({ x: P[n - 1][0], z: P[n - 1][1] });
  return out;
}
function link(a, b, type, via = [], opt = {}) {
  const pts = catmull([[a.x, a.z], ...via, [b.x, b.z]]), cl = [0];
  for (let i = 1; i < pts.length; i++) cl.push(cl[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const e = { id: edges.length, a, b, type, W: ROAD_W[type], speed: ROAD_SPEED[type], pts, cl, L: cl[cl.length - 1], ...opt };
  a.edges.push(e); b.edges.push(e); edges.push(e); return e;
}
function gridNodes(xs, zs, tag, core) { // grade deformada: ruas curvas, exceto no núcleo central (lojas)
  const warp = (x, z, w) => [x + w * 30 * (fbm(x * 0.0065 + 31, z * 0.0065 + 17, 3) - 0.47) * 2, z + w * 30 * (fbm(x * 0.0065 + 77, z * 0.0065 + 41, 3) - 0.47) * 2];
  const g = xs.map((x, i) => zs.map((z, j) => {
    let w = 1;
    if (core) { const d = Math.max(core.i0 - i, i - core.i1, core.j0 - j, j - core.j1, 0); w = d === 0 ? 0 : Math.min(1, 0.3 + 0.35 * d); }
    let p = warp(x, z, w); for (let t = 0; t < 5 && sampleGrid(H0, p[0], p[1]) < 0.9; t++) { w *= 0.5; p = warp(x, z, w); }
    const n = addNode(p[0], p[1], tag); n.w = w; return n;
  }));
  const bow = (a, b, k) => { if (a.w === 0 && b.w === 0) return []; const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, o = (hash2(k, 7) - 0.5) * 18 * Math.max(a.w, b.w); return [[(a.x + b.x) / 2 - dz / L * o, (a.z + b.z) / 2 + dx / L * o]]; };
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < zs.length; j++) {
    if (i + 1 < xs.length) link(g[i][j], g[i + 1][j], 'street', bow(g[i][j], g[i + 1][j], i * 131 + j), { grid: tag });
    if (j + 1 < zs.length) link(g[i][j], g[i][j + 1], 'street', bow(g[i][j], g[i][j + 1], i * 97 + j * 53 + 11), { grid: tag });
  }
  // avenidas diagonais (variedade): no máximo uma por quarteirão, fora do núcleo
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    if (core && i >= core.i0 - 1 && i <= core.i1 && j >= core.j0 - 1 && j <= core.j1) continue;
    if (hash2(i * 17 + 3, j * 29 + 5) > 0.3) continue;
    const flip = hash2(i * 5 + 1, j * 7 + 2) < 0.5, a = flip ? g[i][j] : g[i + 1][j], b = flip ? g[i + 1][j + 1] : g[i][j + 1];
    link(a, b, 'street', bow(a, b, i * 41 + j * 67 + 5), { grid: tag });
  }
  return g;
}
const ZS_ALL = [-160, -100, -40, 20, 80, 140, 200, 260, 320, 380, 440];
const XSD = [-380, -320, -260, -200, -140], ZSD = ZS_ALL;
const XSE = [150, 210, 270, 330], ZSE = ZS_ALL;
const GD = gridNodes(XSD, ZSD, 'D', { i0: 1, i1: 3, j0: 1, j1: 3 }), GE = gridNodes(XSE, ZSE, 'E', null);
function scanX(z, x, dir, thr) { for (let k = 0; k < 400; k++, x += dir * 2) if (sampleGrid(H0, x, z) < thr) return x; return x; }
const bridgeNodes = [];
for (const j of [1, 3, 5]) {
  const z = ZSD[j], cw = scanX(z, XSD[4], 1, 0.5), ce = scanX(z, XSE[0], -1, 0.5);
  const A = addNode(cw - 26, z, 'bridge'), B = addNode(ce + 26, z, 'bridge');
  link(GD[4][j], A, 'main', [[(GD[4][j].x + A.x) / 2, z + (j === 3 ? 7 : -7)]]);
  link(A, B, 'bridge');
  link(B, GE[0][j], 'main', [[(B.x + GE[0][j].x) / 2, z + (j === 3 ? -7 : 7)]]);
  decks.push({ kind: 'bridge', x0: A.x, x1: B.x, zc: z, hw: 9, yA: sampleGrid(H0, A.x, z) + 0.05, yB: sampleGrid(H0, B.x, z) + 0.05, arch: 7 });
  bridgeNodes.push(A, B);
}
// campo oeste
const RW = [[-400, -250], [-350, -340], [-300, -430], [-225, -505], [-340, -565], [-425, -480], [-215, -345]].map(p => addNode(p[0], p[1], 'rural'));
link(GD[0][0], RW[0], 'rural', [[-395, -205]]);
link(RW[0], RW[1], 'rural', [[-382, -300]]);
link(RW[1], RW[2], 'rural', [[-322, -385]]);
link(RW[2], RW[3], 'rural', [[-255, -470]]);
link(RW[3], RW[4], 'rural', [[-275, -545]]);
link(RW[4], RW[5], 'rural', [[-395, -540]]);
link(RW[5], RW[2], 'rural', [[-375, -440]]);
link(GD[4][0], RW[6], 'rural', [[-180, -255]]);
link(RW[6], RW[2], 'rural', [[-250, -380]]);
link(RW[3], RW[6], 'rural', [[-200, -420]]);
// campo leste
const RE = [[225, -255], [268, -335], [300, -415], [215, -470], [365, -480], [395, -375]].map(p => addNode(p[0], p[1], 'rural'));
link(GE[1][0], RE[0], 'rural', [[212, -208]]);
link(RE[0], RE[1], 'rural', [[250, -295]]);
link(RE[1], RE[2], 'rural', [[290, -378]]);
link(RE[2], RE[3], 'rural', [[255, -455]]);
link(RE[2], RE[4], 'rural', [[335, -455]]);
link(RE[4], RE[5], 'rural', [[395, -430]]);
link(RE[5], RE[1], 'rural', [[345, -340]]);
link(RE[5], GE[3][0], 'rural', [[375, -285], [358, -215]]);
// orla oeste
const WC = [addNode(-447, -30, 'coast'), addNode(-452, 62, 'coast')];
link(GD[0][1], WC[0], 'main', [[-415, -68]]); link(WC[0], WC[1], 'main', [[-456, 16]]); link(WC[1], GD[0][4], 'main', [[-430, 102]]);
const WS = [addNode(-440, 290, 'coast'), addNode(-420, 400, 'coast')];
link(GD[0][7], WS[0], 'main', [[-410, 275]]); link(WS[0], WS[1], 'main', [[-436, 345]]); link(WS[1], GD[0][9], 'main', [[-405, 410]]);
// avenida da praia
const EBZ = ZSE.filter(z => z <= 260), EB = EBZ.map(z => addNode(375, z, 'beach'));
for (let j = 0; j < EB.length; j++) {
  link(GE[3][j], EB[j], 'beach');
  if (j + 1 < EB.length) link(EB[j], EB[j + 1], 'beach', [[375 + (j % 2 ? -6 : 6), (EBZ[j] + EBZ[j + 1]) / 2]]);
}
// validação: nós na água?
for (const n of nodes) { n.y = sampleGrid(H0, n.x, n.z); if (n.y < 0.6 && n.tag !== 'bridge') console.warn('no na agua', n.tag, n.x, n.z, n.y.toFixed(2)); }

// píer da praia leste
{
  const z = ZSE[2], cx = scanX(z, 380, 1, 0.3);
  decks.push({ kind: 'pier', x0: cx - 28, x1: cx + 95, zc: z, hw: 3.4, yA: 1.15, yB: 1.15, arch: 0 });
}
const deckY = (d, x) => { const t = clamp((x - d.x0) / (d.x1 - d.x0), 0, 1); return d.yA + (d.yB - d.yA) * t + d.arch * 4 * t * (1 - t); };
function deckAt(x, z) {
  for (const d of decks) if (x > d.x0 && x < d.x1 && Math.abs(z - d.zc) < d.hw) return deckY(d, x);
  return null;
}

// alturas das estradas (suavizadas) + escavação do terreno
function smoothArr(a, k) { const out = a.slice(); for (let i = 0; i < a.length; i++) { let s = 0, c = 0; for (let q = -k; q <= k; q++) { const j = i + q; if (j >= 0 && j < a.length) { s += a[j]; c++; } } out[i] = s / c; } return out; }
for (const e of edges) {
  if (e.type === 'bridge') { const d = decks.find(d => d.kind === 'bridge' && Math.abs(d.zc - e.pts[0].z) < 1); e.pts.forEach(p => { p.y = deckY(d, p.x); }); continue; }
  let ys = e.pts.map(p => sampleGrid(H0, p.x, p.z));
  ys = smoothArr(smoothArr(ys, 5), 5);
  const n = ys.length;
  const ya = e.a.y, yb = e.b.y, o0 = ys[0], oN = ys[n - 1];
  for (let i = 0; i < n; i++) {
    const da = clamp(1 - e.cl[i] / 40, 0, 1), db = clamp(1 - (e.L - e.cl[i]) / 40, 0, 1);
    ys[i] += (ya - o0) * da + (yb - oN) * db; e.pts[i].y = ys[i];
  }
}
for (const n of nodes) { if (n.edges.length) { const e = n.edges[0]; n.y = (e.a === n ? e.pts[0] : e.pts[e.pts.length - 1]).y; } }
// pistas vizinhas combinam a altura entre si (evita degrau entre ruas próximas em encostas)
{
  const CS = 24, key = (a, b) => (a + 500) * 4096 + (b + 500);
  for (let it = 0; it < 4; it++) {
    const cells = new Map();
    for (const e of edges) if (e.type !== 'bridge') for (const p of e.pts) { const k = key(Math.floor(p.x / CS), Math.floor(p.z / CS)); let a = cells.get(k); if (!a) cells.set(k, a = []); a.push(p); }
    const fixed = new Set(); for (const e of edges) if (e.type === 'bridge') { fixed.add(e.pts[0].x + '_' + e.pts[0].z); const l = e.pts[e.pts.length - 1]; fixed.add(l.x + '_' + l.z); }
    for (const e of edges) if (e.type !== 'bridge') for (const p of e.pts) {
      let sy = p.y * 2, sw = 2; const ix = Math.floor(p.x / CS), iz = Math.floor(p.z / CS);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const arr = cells.get(key(ix + a, iz + b)); if (arr) for (const q of arr) { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < 22) { const w = 1 - d / 22; sy += q.y * w; sw += w; } } }
      p.yn = fixed.has(p.x + '_' + p.z) ? p.y : sy / sw;
    }
    for (const e of edges) if (e.type !== 'bridge') for (const p of e.pts) p.y = p.yn;
  }
  for (const n of nodes) { if (n.edges.length) { const e = n.edges[0]; n.y = (e.a === n ? e.pts[0] : e.pts[e.pts.length - 1]).y; } }
}
// escavação (suaviza o terreno nas estradas)
for (const e of edges) {
  if (e.type === 'bridge') continue;
  const R = e.W / 2 + 24, rc = Math.ceil(R / CELL);
  for (let i = 0; i < e.pts.length - 1; i++) {
    const p = e.pts[i], q = e.pts[i + 1], seg = Math.hypot(q.x - p.x, q.z - p.z), k = Math.max(1, Math.ceil(seg / 2));
    for (let s = 0; s < k; s++) {
      const t = s / k, x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t, y = p.y + (q.y - p.y) * t;
      const gi = Math.round((x + HALF_X) / CELL), gj = Math.round((z + HALF_Z) / CELL);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const ii = gi + di, jj = gj + dj; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
        const d = Math.hypot(ii * CELL - HALF_X - x, jj * CELL - HALF_Z - z), w = 1 - smooth(e.W / 2 + 11, e.W / 2 + 22, d);
        if (w > 0) { const idx = jj * GW + ii; H[idx] = H[idx] * (1 - w) + y * w; }
      }
    }
  }
}

// assentamento final: o terreno sob cada pista e calçada fica exatamente na altura dela, com talude suave nas laterais
{
  const cells = new Map(), CS = 16, key = (a, b) => (a + 500) * 4096 + (b + 500);
  for (const e of edges) {
    if (e.type === 'bridge') continue;
    for (let i = 0; i < e.pts.length - 1; i++) {
      const p = e.pts[i], q = e.pts[i + 1], sg = { p, q, hw: e.W / 2 + 2.4, id: e.id };
      for (let a = Math.floor((Math.min(p.x, q.x) - 24) / CS); a <= Math.floor((Math.max(p.x, q.x) + 24) / CS); a++) for (let b = Math.floor((Math.min(p.z, q.z) - 24) / CS); b <= Math.floor((Math.max(p.z, q.z) + 24) / CS); b++) { const k = key(a, b); let arr = cells.get(k); if (!arr) cells.set(k, arr = []); arr.push(sg); }
    }
  }
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const x = i * CELL - HALF_X, z = j * CELL - HALF_Z, arr = cells.get(key(Math.floor(x / CS), Math.floor(z / CS))); if (!arr) continue;
    let bd = 1e9, by = 0, lowY = 1e9; const per = new Map(); // por rua: trecho mais próximo
    for (const sg of arr) {
      const p = sg.p, q = sg.q, dx = q.x - p.x, dz = q.z - p.z, t = clamp(((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1), 0, 1), ex = x - (p.x + dx * t), ez = z - (p.z + dz * t), m = Math.sqrt(ex * ex + ez * ez) - sg.hw;
      const yy = p.y + (q.y - p.y) * t; if (m < bd) { bd = m; by = yy; }
      if (m < 3) { const o = per.get(sg.id); if (!o || m < o.m) per.set(sg.id, { m, y: yy }); }
    }
    if (per.size > 1) { for (const o of per.values()) if (o.y < lowY) lowY = o.y; by = lowY; } // duas ruas encostadas: fica com a mais baixa
    const w = 1 - smooth(5, 20, bd);
    if (w > 0) { const k = j * GW + i; H[k] = H[k] * (1 - w) + (by - 0.04) * w; }
  }
}

/* ---------------- texturas de detalhe do terreno ---------------- */
function periodicNoise(size, period, oct, contrast, seed) {
  const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, a = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      const P = period << o, fx = x / size * P, fy = y / size * P, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, u = tx * tx * (3 - 2 * tx), w = ty * ty * (3 - 2 * ty);
      const h = (i, j) => hash2(((i % P) + P) % P + seed * 31 + o * 7, ((j % P) + P) % P + seed * 17 + o * 3);
      v += a * (h(ix, iy) * (1 - u) * (1 - w) + h(ix + 1, iy) * u * (1 - w) + h(ix, iy + 1) * (1 - u) * w + h(ix + 1, iy + 1) * u * w); tot += a; a *= 0.5;
    }
    v = clamp(0.5 + (v / tot - 0.5) * contrast, 0, 1); const k = (y * size + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = v * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; return t;
}
const detailTex = periodicNoise(256, 8, 4, 2.2, 1);
const tileTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#d7d7d7'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) { const g = 190 + Math.random() * 50; x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, 128, 2); x.fillRect(0, 0, 2, 128); x.fillRect(0, 63, 128, 2); x.fillRect(63, 0, 2, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; return t;
})();

/* ---------------- terreno (malha com cores + detalhe) ---------------- */
const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
groundMat.onBeforeCompile = sh => {
  const U = sh.uniforms;
  U.dTex = { value: detailTex };
  U.tG = { value: texOr('grassD', 96, 120, 60) }; U.tF = { value: texOr('forestD', 80, 62, 40) }; U.tR = { value: texOr('rockD', 120, 112, 100) }; U.tS = { value: texOr('sandD', 150, 130, 96) }; U.tU = { value: texOr('paveD', 110, 105, 96) };
  U.nG = { value: texOr('grassN', 128, 128, 255) }; U.nF = { value: texOr('forestN', 128, 128, 255) }; U.nR = { value: texOr('rockN', 128, 128, 255) }; U.nS = { value: texOr('sandN', 128, 128, 255) }; U.nU = { value: texOr('paveN', 128, 128, 255) };
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aSp; attribute float aFw;\nvarying vec4 vSp; varying float vFw; varying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSp = aSp; vFw = aFw; vWP = position;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D dTex, tG, tF, tR, tS, tU, nG, nF, nR, nS, nU; varying vec4 vSp; varying float vFw; varying vec3 vWP;')
    .replace('#include <color_fragment>', `
    vec2 w = vWP.xz + vWP.y * 0.35;
    float far = smoothstep(30.0, 140.0, length(vViewPosition));
    float wg = max(0.0, 1.0 - vSp.x - vSp.y - vSp.z - vSp.w);
    vec3 cG = texture2D(tG, w * mix(0.17, 0.06, far)).rgb * vec3(0.62, 1.5, 0.62);
    vec3 cF = texture2D(tF, w * mix(0.15, 0.055, far)).rgb * vec3(1.0, 1.45, 0.9);
    vec3 cR = texture2D(tR, w * 0.11).rgb * 1.15;
    vec3 cS = texture2D(tS, w * 0.2).rgb * vec3(1.75, 1.72, 1.6);
    vec3 cU = texture2D(tU, w * 0.3).rgb * 1.75;
    vec3 alb = cG * wg + cF * vSp.x + cR * vSp.y + cS * vSp.z + cU * vSp.w;
    float mv = texture2D(dTex, w * 0.0085).r, mv2 = texture2D(dTex, w * 0.047 + vec2(.37, .11)).r;
    alb *= (0.78 + 0.44 * mv) * (0.86 + 0.28 * mv2);
    alb = mix(alb, vColor * dot(alb, vec3(.3, .59, .11)) * 3.2, vFw);
    diffuseColor.rgb = alb;`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
    vec3 nm = (texture2D(nG, w * 0.17).xyz * wg + texture2D(nF, w * 0.15).xyz * vSp.x + texture2D(nR, w * 0.11).xyz * vSp.y + texture2D(nS, w * 0.2).xyz * vSp.z + texture2D(nU, w * 0.3).xyz * vSp.w) * 2.0 - 1.0;
    normal = normalize(normal + (viewMatrix * vec4(nm.x, 0.0, -nm.y, 0.0)).xyz * (0.85 * (1.0 - far * 0.75)));`);
};
const _tc = new THREE.Color(), _tc2 = new THREE.Color(), _tc3 = new THREE.Color();
const BEACH_R = [335, 520, -260, 270];
let _urb = 0, _fw = 0; const _sp = [0, 0, 0, 0], _fcol = new THREE.Color(1, 1, 1);
function terrainColor(i, j, x, z) {
  const idx = j * GW + i, h = H[idx], h0 = H0[idx], N = GW * GH;
  const gx = (H[Math.min(N - 1, idx + 1)] - H[Math.max(0, idx - 1)]) / (2 * CELL), gz = (H[Math.min(N - 1, idx + GW)] - H[Math.max(0, idx - GW)]) / (2 * CELL), g = Math.hypot(gx, gz);
  _urb = 0; _fw = 0; _sp[0] = _sp[1] = _sp[3] = 0; _sp[2] = 1; _fcol.setRGB(1, 1, 1);
  if (h < -0.35) { const t = clamp(-h / 9, 0, 1); return _tc.setHex(0xd9c48a).lerp(_tc2.setHex(0x1f5f7c), t); }
  const uw = urbanW(x, z), uS = smooth(0.3, 0.7, uw);
  const beach = x > BEACH_R[0] && x < BEACH_R[1] && z > BEACH_R[2] && z < BEACH_R[3] && h0 < 3;
  if (beach || h0 < 0.5) return _tc.setHex(0xefdc9d).lerp(_tc2.setHex(0xdcc785), fbm(x * 0.05, z * 0.05, 2));
  _sp[2] = 0;
  const n = fbm(x * 0.012 + 20, z * 0.012 + 6, 3), n2 = vnoise(x * 0.07, z * 0.07);
  const c = _tc.setHex(0x4f8f3e).lerp(_tc2.setHex(0x3a7a33), n).lerp(_tc2.setHex(0x5f9a45), n2 * 0.35);
  const hm = hillMask(x, z);
  // campos de cultivo (planos, baixos, fora dos morros)
  const wf = (1 - smooth(0.3, 0.7, hm)) * (1 - smooth(5, 8, h0)) * (1 - smooth(0.06, 0.2, g)) * (1 - uS);
  if (wf > 0.01) {
    const f = hash2(Math.floor((x + 1000) / 70), Math.floor((z + 1000) / 90));
    _tc3.setHex(f < 0.25 ? 0xcfc060 : f < 0.5 ? 0x86b34c : f < 0.7 ? 0x98774c : f < 0.85 ? 0x62a040 : 0xb2c455); c.lerp(_tc3, wf * 0.8); _fcol.copy(_tc3); _fw = wf * 0.85;
  }
  // mata fechada: grama mais escura onde há muitos morros
  c.lerp(_tc3.setHex(0x2b6330), smooth(0.4, 0.9, hm) * 0.55 * (1 - smooth(14, 30, h0)));
  // terra / rocha em encostas íngremes e no alto
  const wr = Math.max(smooth(0.3, 0.72, g), smooth(30, 52, h0) * 0.9);
  c.lerp(_tc3.setHex(h0 > 34 ? 0x8d8982 : 0x7e6f57), wr);
  // urbano
  let pw = 0;
  if (uS > 0.01) { pw = uS * (1 - smooth(0.45, 0.85, g)); c.lerp(_tc3.setHex(0x8c8e89), pw); _urb = pw; }
  { const wFo = clamp(smooth(0.35, 0.85, hm) * 0.85 * (1 - smooth(16, 32, h0)) + smooth(0.52, 0.7, n) * 0.45, 0, 1); _sp[3] = pw; _sp[1] = wr * (1 - pw); _sp[0] = wFo * (1 - wr) * (1 - pw); _fw *= (1 - wr) * (1 - pw); }
  return c;
}
{
  const CW = 64;
  for (let cj = 0; cj < GH - 1; cj += CW) for (let ci = 0; ci < GW - 1; ci += CW) {
    const nx = Math.min(CW, GW - 1 - ci), nz = Math.min(CW, GH - 1 - cj), vw = nx + 1, vh = nz + 1;
    const pos = new Float32Array(vw * vh * 3), nor = new Float32Array(vw * vh * 3), col = new Float32Array(vw * vh * 3), spl = new Float32Array(vw * vh * 4), fwa = new Float32Array(vw * vh), idxs = [];
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
      const gi = ci + i, gj = cj + j, x = gi * CELL - HALF_X, z = gj * CELL - HALF_Z, k = j * vw + i, gk = gj * GW + gi;
      const hl = H[gj * GW + Math.max(0, gi - 1)], hr = H[gj * GW + Math.min(GW - 1, gi + 1)], hu = H[Math.max(0, gj - 1) * GW + gi], hd = H[Math.min(GH - 1, gj + 1) * GW + gi];
      let ax = hl - hr, az = hu - hd; const ay = 2 * CELL, len = Math.hypot(ax, ay, az);
      pos[k * 3] = x; pos[k * 3 + 1] = H[gk]; pos[k * 3 + 2] = z; nor[k * 3] = ax / len; nor[k * 3 + 1] = ay / len; nor[k * 3 + 2] = az / len;
      terrainColor(gi, gj, x, z); col[k * 3] = _fcol.r; col[k * 3 + 1] = _fcol.g; col[k * 3 + 2] = _fcol.b; spl.set(_sp, k * 4); fwa[k] = _fw;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * vw + i, b = a + 1, c = a + vw, d = c + 1; idxs.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSp', new THREE.BufferAttribute(spl, 4)); g.setAttribute('aFw', new THREE.BufferAttribute(fwa, 1)); g.setIndex(idxs);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, groundMat); m.receiveShadow = true; scene.add(m);
  }
}

/* ---------------- água, ondas, nado ---------------- */
plane(3000, 3000, 0x0f4a80, 0, -0.32, 0);
const waveH = (x, z, t) => {
  const d = -sampleGrid(H, x, z), a = 0.1 + 0.9 * smooth(0, 14, d);
  return a * (Math.sin(x * 0.07 + z * 0.045 + t * 1.25) * 0.5 + Math.sin(z * 0.11 + t * 1.7 + x * 0.02) * 0.34 + Math.sin((x - z) * 0.19 + t * 2.4) * 0.12) - 0.08;
};
const isSea = (x, z) => terrainH(x, z) < -0.2 && deckAt(x, z) === null;
const inWater = (x, z) => terrainH(x, z) < -0.7 && deckAt(x, z) === null;
const walkable = (x, z) => x < -1500 || (Math.abs(x) < BOUND_X && z > -BOUND_Z && z < BOUND_Z && !isSea(x, z));
const SEA_N = 72, SEA_CELL = 5.5;
const seaGeo = new THREE.BufferGeometry(), seaHt = new Float32Array((SEA_N + 1) * (SEA_N + 1));
{
  const nv = (SEA_N + 1) * (SEA_N + 1), idx = [];
  seaGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3)); seaGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3)); seaGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  for (let j = 0; j < SEA_N; j++) for (let i = 0; i < SEA_N; i++) { const a = j * (SEA_N + 1) + i, b = a + 1, c = a + SEA_N + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  seaGeo.setIndex(idx);
}
const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.1 }));
sea.frustumCulled = false; scene.add(sea);
let seaTick = 0;
function updateSea(t) {
  const cam = camera.position;
  if (cam.x < -1500) { sea.visible = false; return; } sea.visible = true;
  if (seaTick++ & 1) return;
  const cx = Math.round(cam.x / SEA_CELL) * SEA_CELL, cz = Math.round(cam.z / SEA_CELL) * SEA_CELL, n1 = SEA_N + 1;
  const pos = seaGeo.attributes.position, col = seaGeo.attributes.color, nor = seaGeo.attributes.normal, pa = pos.array, ca = col.array, na = nor.array;
  for (let j = 0, k = 0; j <= SEA_N; j++) for (let i = 0; i <= SEA_N; i++, k++) {
    const wx = cx + (i - SEA_N / 2) * SEA_CELL, wz = cz + (j - SEA_N / 2) * SEA_CELL;
    const depth = -sampleGrid(H, wx, wz), a = 0.1 + 0.9 * smooth(0, 14, depth);
    const h = a * (Math.sin(wx * 0.07 + wz * 0.045 + t * 1.25) * 0.5 + Math.sin(wz * 0.11 + t * 1.7 + wx * 0.02) * 0.34 + Math.sin((wx - wz) * 0.19 + t * 2.4) * 0.12) - 0.08;
    const dn = clamp(depth / 14, 0, 1);
    const foam = clamp((h - 0.4) * 1.4, 0, 0.35) * smooth(2, 8, depth) + (depth < 1.6 ? 0.3 * (0.6 + 0.4 * Math.sin(t * 2.6 + wx * 0.12 + wz * 0.1)) * (1 - depth / 1.6) : 0);
    seaHt[k] = h; pa[k * 3] = wx; pa[k * 3 + 1] = h; pa[k * 3 + 2] = wz;
    ca[k * 3] = 0.02 - 0.016 * dn + foam; ca[k * 3 + 1] = 0.2 - 0.14 * dn + foam; ca[k * 3 + 2] = 0.3 - 0.11 * dn + foam;
  }
  for (let j = 0, k = 0; j <= SEA_N; j++) for (let i = 0; i <= SEA_N; i++, k++) {
    const hl = seaHt[i > 0 ? k - 1 : k], hr = seaHt[i < SEA_N ? k + 1 : k], hu = seaHt[j > 0 ? k - n1 : k], hd = seaHt[j < SEA_N ? k + n1 : k];
    const nx = hl - hr, nz = hu - hd, ny = 2 * SEA_CELL, l = Math.hypot(nx, ny, nz);
    na[k * 3] = nx / l; na[k * 3 + 1] = ny / l; na[k * 3 + 2] = nz / l;
  }
  pos.needsUpdate = true; col.needsUpdate = true; nor.needsUpdate = true;
}

/* ---------------- altura do chão (terreno, pontes, mar) ---------------- */
let T = 0;
function groundH(x, z) {
  if (x < -1500) return 0;
  const d = deckAt(x, z); if (d !== null) return d;
  const ry = roadY(x, z); if (ry !== null) return ry;
  const t = terrainH(x, z);
  return t < -0.7 ? waveH(x, z, T) - 0.75 : t;
}
const surfaceY = (x, z) => { const d = deckAt(x, z); if (d !== null) return d; const ry = roadY(x, z); return ry !== null ? ry : Math.max(terrainH(x, z), -0.08); };

/* ---------------- hash espacial, prédios (caixas orientadas) e estáticos ---------------- */
const HC = 24;
const bHash = new Map(), sHash = new Map();
const cellKey = (ix, iz) => (ix + 400) * 2000 + (iz + 400);
function hashInsert(map, o, x0, x1, z0, z1) {
  for (let ix = Math.floor(x0 / HC); ix <= Math.floor(x1 / HC); ix++) for (let iz = Math.floor(z0 / HC); iz <= Math.floor(z1 / HC); iz++) { const k = cellKey(ix, iz); let a = map.get(k); if (!a) map.set(k, a = []); a.push(o); }
}
function hashRemove(map, o, x0, x1, z0, z1) {
  for (let ix = Math.floor(x0 / HC); ix <= Math.floor(x1 / HC); ix++) for (let iz = Math.floor(z0 / HC); iz <= Math.floor(z1 / HC); iz++) { const a = map.get(cellKey(ix, iz)); if (a) { const q = a.indexOf(o); if (q >= 0) a.splice(q, 1); } }
}
function registerBox(cx, cz, hx, hz, rot, y0, top, extra) {
  const c = Math.cos(rot), s = Math.sin(rot), ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
  const b = { cx, cz, hx, hz, c, s, y0, h: top, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, ...extra };
  buildings.push(b); hashInsert(bHash, b, b.x0, b.x1, b.z0, b.z1); return b;
}
function addStatic(x, z, r) { const o = { x, z, r }; statics.push(o); hashInsert(sHash, o, x - r, x + r, z - r, z + r); return o; }
function removeStatic(o) { const i = statics.indexOf(o); if (i >= 0) statics.splice(i, 1); hashRemove(sHash, o, o.x - o.r, o.x + o.r, o.z - o.r, o.z + o.r); }
function pushOutBox(p, r, b) {
  const dx0 = p.x - b.cx, dz0 = p.z - b.cz, lx = dx0 * b.c + dz0 * b.s, lz = -dx0 * b.s + dz0 * b.c;
  const qx = clamp(lx, -b.hx, b.hx), qz = clamp(lz, -b.hz, b.hz);
  let dx = lx - qx, dz = lz - qz; const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  let nlx, nlz, nx, nz;
  if (d2 > 1e-8) { const d = Math.sqrt(d2), pen = r - d; nlx = dx / d; nlz = dz / d; nx = lx + nlx * pen; nz = lz + nlz * pen; }
  else {
    const l = lx + b.hx, rr = b.hx - lx, t = lz + b.hz, bt = b.hz - lz, m = Math.min(l, rr, t, bt);
    if (m === l) { nlx = -1; nlz = 0; nx = -b.hx - r; nz = lz; } else if (m === rr) { nlx = 1; nlz = 0; nx = b.hx + r; nz = lz; }
    else if (m === t) { nlx = 0; nlz = -1; nx = lx; nz = -b.hz - r; } else { nlx = 0; nlz = 1; nx = lx; nz = b.hz + r; }
  }
  p.x = b.cx + nx * b.c - nz * b.s; p.z = b.cz + nx * b.s + nz * b.c;
  return { nx: nlx * b.c - nlz * b.s, nz: nlx * b.s + nlz * b.c };
}
function collideStatic(p, r) {
  let hit = null;
  const ix0 = Math.floor((p.x - r) / HC), ix1 = Math.floor((p.x + r) / HC), iz0 = Math.floor((p.z - r) / HC), iz1 = Math.floor((p.z + r) / HC);
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
    const k = cellKey(ix, iz), ab = bHash.get(k);
    if (ab) for (const b of ab) {
      if (p.x < b.x0 - r || p.x > b.x1 + r || p.z < b.z0 - r || p.z > b.z1 + r) continue;
      const res = pushOutBox(p, r, b); if (res) hit = res;
    }
    const as = sHash.get(k);
    if (as) for (const s of as) {
      const dx = p.x - s.x, dz = p.z - s.z, rr = r + s.r;
      if (dx > rr || dx < -rr || dz > rr || dz < -rr) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.001, pen = rr - d; hit = { nx: dx / d, nz: dz / d }; p.x += hit.nx * pen; p.z += hit.nz * pen; }
    }
  }
  if (p.x < -1500) return hit;
  if (p.x < -BOUND_X + r) { p.x = -BOUND_X + r; hit = { nx: 1, nz: 0 }; }
  if (p.x > BOUND_X - r) { p.x = BOUND_X - r; hit = { nx: -1, nz: 0 }; }
  if (p.z < -BOUND_Z + r) { p.z = -BOUND_Z + r; hit = { nx: 0, nz: 1 }; }
  if (p.z > BOUND_Z - r) { p.z = BOUND_Z - r; hit = { nx: 0, nz: -1 }; }
  return hit;
}
function boxAt(x, z, m, fn) { // percorre prédios que contêm o ponto (com margem m)
  const a = bHash.get(cellKey(Math.floor(x / HC), Math.floor(z / HC)));
  if (!a) return null;
  for (const b of a) {
    if (x < b.x0 - m || x > b.x1 + m || z < b.z0 - m || z > b.z1 + m) continue;
    const dx = x - b.cx, dz = z - b.cz, lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
    if (Math.abs(lx) < b.hx + m && Math.abs(lz) < b.hz + m && (!fn || fn(b))) return b;
  }
  return null;
}
const insideBuilding = (x, z, m = 0) => !!boxAt(x, z, m);
function segBlocked(ax, az, bx, bz) { // linha de visão 2D contra caixas orientadas
  const seen = new Set();
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  for (let ix = Math.floor(x0 / HC); ix <= Math.floor(x1 / HC); ix++) for (let iz = Math.floor(z0 / HC); iz <= Math.floor(z1 / HC); iz++) {
    const a = bHash.get(cellKey(ix, iz)); if (!a) continue;
    for (const b of a) {
      if (seen.has(b)) continue; seen.add(b);
      const ux = ax - b.cx, uz = az - b.cz, vx = bx - b.cx, vz = bz - b.cz;
      const la = [ux * b.c + uz * b.s, -ux * b.s + uz * b.c], lb = [vx * b.c + vz * b.s, -vx * b.s + vz * b.c];
      let t0 = 0, t1 = 1; const d = [lb[0] - la[0], lb[1] - la[1]], hh = [b.hx, b.hz];
      for (let q = 0; q < 2; q++) {
        if (Math.abs(d[q]) < 1e-9) { if (la[q] < -hh[q] || la[q] > hh[q]) { t0 = 2; break; } }
        else { let ta = (-hh[q] - la[q]) / d[q], tb = (hh[q] - la[q]) / d[q]; if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) break; }
      }
      if (t0 <= t1) return true;
    }
  }
  return false;
}

/* ---------------- lotes de geometria (mescla de muitos objetos em poucas malhas) ---------------- */
class Batch {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  tri(a, b, c, ua, ub, uc, col, n) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); for (let i = 0; i < 3; i++) { this.n.push(n[0], n[1], n[2]); this.c.push(col.r, col.g, col.b); }
    this.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }
  quad(p0, p1, p2, p3, u0, u1, u2, u3, col, hint) {
    let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
    if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { [p1, p3] = [p3, p1]; [u1, u3] = [u3, u1]; n = [-n[0], -n[1], -n[2]]; }
    this.tri(p0, p1, p2, u0, u1, u2, col, n); this.tri(p0, p2, p3, u0, u2, u3, col, n);
  }
  geo(g, m, col, uv = [0.02, 0.02]) {
    const gg = g.index ? g.toNonIndexed() : g.clone(); gg.applyMatrix4(m);
    const pa = gg.attributes.position.array, na = gg.attributes.normal.array;
    for (let i = 0; i < pa.length; i += 3) { this.p.push(pa[i], pa[i + 1], pa[i + 2]); this.n.push(na[i], na[i + 1], na[i + 2]); this.c.push(col.r, col.g, col.b); this.u.push(uv[0], uv[1]); }
    gg.dispose();
  }
  build(mat, cast = true) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m;
  }
}
const _bc = new THREE.Color();
function pushBox(B, cx, cz, hx, hz, rot, y0, y1, hex, roofHex, uvDiv = 8) {
  const c = Math.cos(rot), s = Math.sin(rot), col = _bc.setHex(hex).clone(), rc = _bc.setHex(roofHex ?? hex).clone().multiplyScalar(roofHex ? 1 : 0.55);
  const cor = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([lx, lz]) => [cx + lx * c - lz * s, cz + lx * s + lz * c]);
  const vr = Math.max(1, Math.round((y1 - y0) / 7));
  for (let k = 0; k < 4; k++) {
    const A = cor[k], Bb = cor[(k + 1) % 4], len = Math.hypot(Bb[0] - A[0], Bb[1] - A[1]), ur = Math.max(1, Math.round(len / uvDiv));
    B.quad([A[0], y0, A[1]], [Bb[0], y0, Bb[1]], [Bb[0], y1, Bb[1]], [A[0], y1, A[1]], [0, 0], [ur, 0], [ur, vr], [0, vr], col, [(A[0] + Bb[0]) / 2 - cx, 0, (A[1] + Bb[1]) / 2 - cz]);
  }
  B.quad([cor[0][0], y1, cor[0][1]], [cor[1][0], y1, cor[1][1]], [cor[2][0], y1, cor[2][1]], [cor[3][0], y1, cor[3][1]], [0.02, 0.02], [0.02, 0.02], [0.02, 0.02], [0.02, 0.02], rc, [0, 1, 0]);
}
function pushGable(B, cx, cz, hx, hz, rot, y1, rh, hex) {
  const c = Math.cos(rot), s = Math.sin(rot), col = _bc.setHex(hex).clone(), o = 0.7, uv = [0.02, 0.02];
  const P = (lx, lz, y) => [cx + lx * c - lz * s, y, cz + lx * s + lz * c];
  const a = P(-hx - o, -hz - o, y1), b = P(hx + o, -hz - o, y1), d = P(hx + o, hz + o, y1), e = P(-hx - o, hz + o, y1), r0 = P(-hx - o, 0, y1 + rh), r1 = P(hx + o, 0, y1 + rh);
  B.quad(a, b, r1, r0, uv, uv, uv, uv, col, [0, 1, 0]); B.quad(e, d, r1, r0, uv, uv, uv, uv, col, [0, 1, 0]);
  const g = _bc.setHex(hex).clone().multiplyScalar(0.8), a2 = P(-hx, -hz, y1), e2 = P(-hx, hz, y1), r2 = P(-hx, 0, y1 + rh * 0.92), b2 = P(hx, -hz, y1), d2 = P(hx, hz, y1), r3 = P(hx, 0, y1 + rh * 0.92);
  B.quad(a2, e2, r2, r2, uv, uv, uv, uv, g, [-c, 0, -s]); B.quad(b2, d2, r3, r3, uv, uv, uv, uv, g, [c, 0, s]);
}
const winTex = canvasTex(128, 128, (c, w, h) => {
  c.fillStyle = '#ececec'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const lit = (hash2(i * 7 + j * 3, 5) < 0.35 && (i + j) % 2 === 0) || (i === 1 && j === 0);
    c.fillStyle = lit ? '#ffe9a0' : '#35506a'; c.fillRect(i * 64 + 12, j * 64 + 14, 40, 38);
    c.fillStyle = 'rgba(255,255,255,.28)'; c.fillRect(i * 64 + 12, j * 64 + 14, 40, 6);
  }
  c.fillStyle = 'rgba(0,0,0,.10)'; c.fillRect(0, 62, w, 4);
});
const buildMat = worldDetail(new THREE.MeshStandardMaterial({ map: winTex, vertexColors: true, roughness: 0.6, metalness: 0.08 }), 'bld', AS.brickD, AS.brickN, { scale: 0.42, gain: 5.6, mix: 0.7, wall: true, nk: 0.5 });
const palettes = [0xe0cba0, 0xbcc2cc, 0xb06a50, 0x9db8d6, 0xe3b0a6, 0x7ea0c4, 0xf0e8cc, 0xf2f2f2, 0x8fc7c0, 0xe0c070];
const batches = {};
const batchFor = (x, z) => { const k = Math.floor(x / 200) + '_' + Math.floor(z / 200); return batches[k] || (batches[k] = new Batch()); };

/* ---------------- prédios ---------------- */
function addBuildingBox(cx, cz, hx, hz, rot, y0, h, tint, opts = {}) {
  const B = batchFor(cx, cz), top = y0 + h;
  pushBox(B, cx, cz, hx, hz, rot, y0 - 1.5, top, tint, null, opts.uvDiv || 8);
  if (opts.gable) pushGable(B, cx, cz, hx, hz, rot, top, opts.gable.rh, opts.gable.color);
  else if (h > 14 && R() < 0.7) pushBox(B, cx + (R() - .5) * hx, cz + (R() - .5) * hz, 1.6, 1.6, rot, top, top + 2.2, 0x888b90, 0x777a80, 99);
  return registerBox(cx, cz, hx, hz, rot, y0 - 1.5, top, { kind: opts.kind || 'bld' });
}
function addBuilding(x0, x1, z0, z1, h, pi) { return addBuildingBox((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, URBAN_H, h, palettes[pi % palettes.length]); }
function addSolid(x0, x1, z0, z1, h, color, y0 = 0) { // caixa avulsa (interiores, detalhes)
  const m = mesh(geoBox(x1 - x0, h, z1 - z0), lam(color), (x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2, scene); m.receiveShadow = true;
  return registerBox((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, y0, y0 + h, { kind: 'solid' });
}

/* ---------------- estradas: calçada (camada de baixo) + asfalto (camada de cima) ---------------- */
function asphaltTex(kind, plain) {
  return canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = kind === 'rural' ? '#4b4b49' : '#3b3e44'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) { c.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.08)'; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    if (plain) return;
    c.fillStyle = '#e8e8e8'; c.fillRect(7, 0, 3, h); c.fillRect(w - 10, 0, 3, h);
    if (kind === 'rural') { c.fillStyle = '#ececec'; for (let y = 0; y < h; y += 64) c.fillRect(w / 2 - 1.5, y, 3, 34); }
    else { c.fillStyle = '#e8c02a'; for (let y = 0; y < h; y += 128) { c.fillRect(w / 2 - 4, y, 2.5, 80); c.fillRect(w / 2 + 1.5, y, 2.5, 80); } }
  });
}
const curbTex = canvasTex(64, 128, (c, w, h) => {
  c.fillStyle = '#b4b4ae'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) { const g = 150 + Math.random() * 60; c.fillStyle = `rgba(${g},${g},${g - 4},.35)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  c.fillStyle = 'rgba(90,90,86,.5)'; for (let y = 0; y < h; y += 32) c.fillRect(0, y, w, 1.5);
});
const offs = (f, u) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
const roadMats = {
  curb: new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.95, ...offs(-1) }),
  street: new THREE.MeshStandardMaterial({ map: asphaltTex('street', false), roughness: 0.92, ...offs(-3) }),
  streetP: new THREE.MeshStandardMaterial({ map: asphaltTex('street', true), roughness: 0.92, ...offs(-3) }),
  rural: new THREE.MeshStandardMaterial({ map: asphaltTex('rural', false), roughness: 0.92, ...offs(-3) }),
  ruralP: new THREE.MeshStandardMaterial({ map: asphaltTex('rural', true), roughness: 0.92, ...offs(-3) }),
  bridge: new THREE.MeshStandardMaterial({ map: asphaltTex('street', false), roughness: 0.92, ...offs(-3) }),
  disc: new THREE.MeshStandardMaterial({ map: asphaltTex('street', true), roughness: 0.92, ...offs(-5) })
};
for (const k in roadMats) { if (k === 'curb') worldDetail(roadMats[k], 'curb', AS.paveD, AS.paveN, { scale: 0.42, gain: 1.9, mode: 'replace', nk: 0.7 }); else worldDetail(roadMats[k], 'asph', AS.asphD, AS.asphN, { scale: 0.3, gain: 7.2, mix: 0.9, nk: 0.55 }); }
const CURB = 2.4; // calçada ao lado do asfalto
function pointOnEdge(e, s) {
  s = clamp(s, 0, e.L); let lo = 0, hi = e.cl.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cl[m] <= s) lo = m; else hi = m; }
  const p = e.pts[lo], q = e.pts[hi], seg = e.cl[hi] - e.cl[lo] || 1, t = (s - e.cl[lo]) / seg, dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
  return { x: p.x + dx * t, z: p.z + dz * t, y: p.y + (q.y - p.y) * t, tx: dx / l, tz: dz / l };
}
for (const e of edges) if (e.type !== 'bridge') for (const p of e.pts) { const ty = sampleGrid(H, p.x, p.z); if (ty > p.y) p.y = ty; } // a pista nunca fica abaixo do terreno
const roadBatches = {}; for (const k in roadMats) roadBatches[k] = new Batch();
const bridgeBatch = new Batch();
const deg3 = n => n.edges.length >= 3;
for (const e of edges) {
  const white = new THREE.Color(0xffffff), kind = e.type === 'rural' ? 'rural' : e.type === 'bridge' ? 'bridge' : 'street';
  const hwC = e.W / 2 + CURB, hwA = e.W / 2;
  const LC = [], RC = [], LA = [], RA = [];
  for (let i = 0; i < e.pts.length; i++) {
    const a = e.pts[Math.max(0, i - 1)], b = e.pts[Math.min(e.pts.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1, tx = (b.x - a.x) / l, tz = (b.z - a.z) / l, p = e.pts[i];
    const yC = p.y + (e.type === 'bridge' ? 0.01 : 0.04), yA = p.y + (e.type === 'bridge' ? 0.025 : 0.06);
    LC.push([p.x + tz * hwC, yC, p.z - tx * hwC]); RC.push([p.x - tz * hwC, yC, p.z + tx * hwC]);
    LA.push([p.x + tz * hwA, yA, p.z - tx * hwA]); RA.push([p.x - tz * hwA, yA, p.z + tx * hwA]);
    p.tx = tx; p.tz = tz;
  }
  for (let i = 0; i < e.pts.length - 1; i++) {
    const v0 = e.cl[i] / 16, v1 = e.cl[i + 1] / 16;
    roadBatches.curb.quad(RC[i], LC[i], LC[i + 1], RC[i + 1], [0, v0], [1, v0], [1, v1], [0, v1], white, [0, 1, 0]);
    const plain = (kind !== 'bridge') && ((e.cl[i] < 14 && deg3(e.a)) || (e.L - e.cl[i + 1] < 14 && deg3(e.b)));
    roadBatches[kind === 'bridge' ? 'bridge' : kind + (plain ? 'P' : '')].quad(RA[i], LA[i], LA[i + 1], RA[i + 1], [0, v0], [1, v0], [1, v1], [0, v1], white, [0, 1, 0]);
    if (e.type === 'bridge') {
      const dn = 1.7, bot = e.pts[i].y - dn, bot1 = e.pts[i + 1].y - dn, k = new THREE.Color(0x8d8f93), L = LC, Rr = RC;
      bridgeBatch.quad([L[i][0], bot, L[i][2]], [L[i + 1][0], bot1, L[i + 1][2]], [L[i + 1][0], L[i + 1][1], L[i + 1][2]], [L[i][0], L[i][1], L[i][2]], [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], k, [L[i][0] - Rr[i][0], 0, L[i][2] - Rr[i][2]]);
      bridgeBatch.quad([Rr[i][0], bot, Rr[i][2]], [Rr[i + 1][0], bot1, Rr[i + 1][2]], [Rr[i + 1][0], Rr[i + 1][1], Rr[i + 1][2]], [Rr[i][0], Rr[i][1], Rr[i][2]], [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], k, [Rr[i][0] - L[i][0], 0, Rr[i][2] - L[i][2]]);
      bridgeBatch.quad([L[i][0], bot, L[i][2]], [Rr[i][0], bot, Rr[i][2]], [Rr[i + 1][0], bot1, Rr[i + 1][2]], [L[i + 1][0], bot1, L[i + 1][2]], [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], [0.3, 0.3], k, [0, -1, 0]);
    }
  }
}
// cruzamentos: discos de asfalto liso + faixas de pedestre sem sobreposição
{
  const white = new THREE.Color(0xffffff), uv = [0.5, 0.5], stripes = [];
  for (const n of nodes) {
    if (n.edges.length < 3) continue;
    const Wm = Math.max(...n.edges.map(e => e.W)), r = Wm / 2 + 0.8, y = n.y + 0.075;
    for (let k = 0; k < 20; k++) {
      const a0 = k / 20 * Math.PI * 2, a1 = (k + 1) / 20 * Math.PI * 2;
      roadBatches.disc.tri([n.x, y, n.z], [n.x + Math.cos(a1) * r, y, n.z + Math.sin(a1) * r], [n.x + Math.cos(a0) * r, y, n.z + Math.sin(a0) * r], uv, uv, uv, white, [0, 1, 0]);
    }
    const dirs = [];
    for (const e of n.edges) {
      if (e.type === 'rural' || e.type === 'bridge') continue;
      const atA = e.a === n, p = atA ? e.pts[Math.min(3, e.pts.length - 1)] : e.pts[Math.max(0, e.pts.length - 4)], q = atA ? e.pts[0] : e.pts[e.pts.length - 1];
      const dx = p.x - q.x, dz = p.z - q.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      if (dirs.some(d => d[0] * ux + d[1] * uz > 0.6)) continue; dirs.push([ux, uz]);
      const off = Wm / 2 + CURB + 3.2;
      for (let k = -3; k <= 3; k++) stripes.push([n.x + ux * off - uz * k * 1.8, n.y + 0.09, n.z + uz * off + ux * k * 1.8, Math.atan2(ux, uz)]);
    }
  }
  const sm = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 3), new THREE.MeshBasicMaterial({ color: 0xe8e8e8, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 }), Math.max(1, stripes.length));
  const d = new THREE.Object3D();
  stripes.forEach((s, i) => { d.position.set(s[0], s[1], s[2]); d.rotation.set(-Math.PI / 2, 0, 0); d.rotation.order = 'YXZ'; d.rotation.y = s[3]; d.updateMatrix(); sm.setMatrixAt(i, d.matrix); });
  sm.count = stripes.length; scene.add(sm);
}
for (const k in roadBatches) roadBatches[k].build(roadMats[k], false);
bridgeBatch.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), true);
// índice espacial das estradas (posição, largura e altura)
const roadHash = new Map();
for (const e of edges) if (e.type !== 'bridge') for (let i = 0; i < e.pts.length; i++) { const p = e.pts[i], o = { x: p.x, z: p.z, hw: e.W / 2 + CURB, y: p.y + 0.06, e, i }; const k = cellKey(Math.floor(p.x / HC), Math.floor(p.z / HC)); let a = roadHash.get(k); if (!a) roadHash.set(k, a = []); a.push(o); }
for (const e of edges) if (e.type === 'bridge') for (let i = 0; i < e.pts.length; i++) { const p = e.pts[i], o = { x: p.x, z: p.z, hw: e.W / 2 + CURB, y: p.y, bridge: true }; const k = cellKey(Math.floor(p.x / HC), Math.floor(p.z / HC)); let a = roadHash.get(k); if (!a) roadHash.set(k, a = []); a.push(o); }
function roadClear(x, z) { // menor distância até a borda da calçada
  let best = 1e9; const ix = Math.floor(x / HC), iz = Math.floor(z / HC);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const arr = roadHash.get(cellKey(ix + a, iz + b)); if (arr) for (const o of arr) { const d = Math.hypot(o.x - x, o.z - z) - o.hw; if (d < best) best = d; } }
  return best;
}
function roadY(x, z) { // altura da pista sob o ponto (ou null se não estiver sobre uma pista)
  const ix = Math.floor(x / HC), iz = Math.floor(z / HC); let best = null, bd = 1e9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const arr = roadHash.get(cellKey(ix + a, iz + b)); if (!arr) continue;
    for (const o of arr) { if (o.bridge) continue; const dx = o.x - x, dz = o.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = o; } }
  }
  if (!best || bd > (best.hw + 7) * (best.hw + 7)) return null;
  const pts = best.e.pts; let by = null, bdist = 1e9; // projeta nos dois trechos vizinhos: altura contínua ao longo da pista
  for (let k = best.i - 1; k <= best.i; k++) {
    if (k < 0 || k >= pts.length - 1) continue;
    const p = pts[k], q = pts[k + 1], dx = q.x - p.x, dz = q.z - p.z, t = clamp(((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1), 0, 1), ex = x - (p.x + dx * t), ez = z - (p.z + dz * t), d = ex * ex + ez * ez;
    if (d < bdist) { bdist = d; by = p.y + (q.y - p.y) * t; }
  }
  if (by === null || bdist > (best.hw + 0.6) * (best.hw + 0.6)) return null;
  return by + 0.06;
}
// pontes: pilares, grades e as bases
for (const d of decks) {
  if (d.kind === 'bridge') {
    const len = d.x1 - d.x0, rail = new Batch(), pil = new Batch(), col = new THREE.Color(0xb8bac0), colp = new THREE.Color(0x9a9ca2);
    for (let x = d.x0; x <= d.x1; x += 3) for (const sd of [-1, 1]) {
      const y = deckY(d, x), z = d.zc + sd * (d.hw - 0.4);
      rail.geo(UG.box, T4(x, y + 0.65, z, 0.15, 1.3, 0.15), col);
    }
    for (const sd of [-1, 1]) for (let x = d.x0; x < d.x1; x += 6) { const y0 = deckY(d, x), y1 = deckY(d, x + 6), z = d.zc + sd * (d.hw - 0.4); rail.geo(UG.box, T4(x + 3, (y0 + y1) / 2 + 1.25, z, 6.05, 0.16, 0.2, 0, 0, Math.atan2(y1 - y0, 6)), col); }
    for (let x = d.x0 + 22; x < d.x1 - 15; x += 34) for (const sd of [-1, 1]) { const y = deckY(d, x) - 1.5; pil.geo(UG.cyl, T4(x, (y - 8) / 2, d.zc + sd * 5, 1.4, y + 8, 1.4), colp); }
    rail.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 })); pil.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    void len;
  } else {
    const B = new Batch(), wood = new THREE.Color(0x9c7a4d), dark = new THREE.Color(0x5a4228);
    B.geo(UG.box, T4((d.x0 + d.x1) / 2, d.yA - 0.2, d.zc, d.x1 - d.x0, 0.4, d.hw * 2), wood);
    for (let x = d.x0 + 3; x < d.x1; x += 8) for (const sd of [-1, 1]) B.geo(UG.cyl, T4(x, (d.yA - 6) / 2, d.zc + sd * (d.hw - 0.4), 0.5, d.yA + 6, 0.5), dark);
    for (let x = d.x0; x < d.x1; x += 5) for (const sd of [-1, 1]) B.geo(UG.box, T4(x, d.yA + 0.5, d.zc + sd * (d.hw - 0.1), 0.16, 1.0, 0.16), dark);
    B.build(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
  }
}

/* ---------------- lojas enterráveis (portas) ---------------- */
const doors = [], pumpSpots = [];
const SHOPS = {
  bank: { name: 'Banco', text: 'BANCO', sign: '#0b3d91', cash: 6000, heat: 12, w: 28, d: 20, pal: 6, h: 26, wall: 0xe6dfcf, f1: '#d8d2c2', f2: '#b9b2a0' },
  jewelry: { name: 'Joalheria', text: 'JOALHERIA', sign: '#6a1b9a', cash: 3500, heat: 9, w: 20, d: 14, pal: 5, h: 16, wall: 0x2b2438, f1: '#1c1826', f2: '#d9d9e6' },
  market: { name: 'Mercado', text: 'MERCADO', sign: '#1b8a3a', cash: 1200, heat: 6, w: 32, d: 22, pal: 3, h: 10, wall: 0xf2f2f2, f1: '#e9e9e9', f2: '#9fc9a8' },
  gas: { name: 'Posto de Gasolina', text: 'POSTO', sign: '#d62828', cash: 800, heat: 5, w: 18, d: 12, pal: 0, h: 5.5, wall: 0xf4e3b0, f1: '#e0d2a6', f2: '#bdb088' }
};
const SPECIALS = { '1,2': 'bank', '2,2': 'jewelry', '2,1': 'market', '1,1': 'gas' };
function makeSignTex(text, bg) {
  return canvasTex(512, 128, (c, w, h) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,.14)'; c.fillRect(0, 0, w, 12);
    c.fillStyle = '#fff'; c.font = 'bold 70px Arial Black, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2 + 4);
    c.strokeStyle = '#ffd23f'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
  });
}
function makeDoor(key, x, z, nx, nz) {
  const def = SHOPS[key], g = new THREE.Group(); g.position.set(x, URBAN_H, z); g.rotation.y = Math.atan2(nx, nz); scene.add(g);
  const col = new THREE.Color(def.sign).getHex();
  mesh(geoBox(3.3, 3.7, 0.3), lam(0xe8e2d0), 0, 1.85, 0.1, g);
  mesh(geoBox(2.6, 3.2, 0.3), lam(0x1d3446, { roughness: 0.12, metalness: 0.6, emissive: 0x0b1824 }), 0, 1.6, 0.2, g);
  mesh(geoBox(5.4, 0.25, 2.2), lam(col), 0, 4.0, 1.1, g);
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ map: makeSignTex(def.text, def.sign) })); sg.position.set(0, 5.5, 0.12); g.add(sg);
  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f })); marker.rotation.x = Math.PI; marker.position.set(0, 7.6, 1.4); g.add(marker);
  doors.push({ key, name: def.name, x, z, nx, nz, fx: x + nx * 1.6, fz: z + nz * 1.6, cash: def.cash, heat: def.heat, workers: [], marker });
}
function buildSpecial(key, cx, cz) {
  const H = 19.5, d = SHOPS[key], GY = URBAN_H;
  if (key === 'bank') { addBuilding(cx - H, cx + H, cz - H, cz + H, d.h, d.pal); makeDoor(key, cx + H, cz, 1, 0); }
  else if (key === 'jewelry' || key === 'market') { addBuilding(cx - H, cx + H, cz - H, cz + H, d.h, d.pal); makeDoor(key, cx - H, cz, -1, 0); }
  else {
    plane(2 * H + 4, 2 * H + 4, 0x6e7075, cx, GY + 0.05, cz);
    addBuilding(cx - H, cx - 4, cz - 11, cz + 11, d.h, d.pal); makeDoor(key, cx - 4, cz, 1, 0);
    mesh(geoBox(16, 0.5, 22), lam(0xf2f2f2), cx + 8, GY + 5.8, cz, scene); mesh(geoBox(16.2, 0.35, 22.2), lam(0xd62828), cx + 8, GY + 5.4, cz, scene);
    for (const [px, pz] of [[cx + 1.5, cz - 10], [cx + 1.5, cz + 10], [cx + 14.5, cz - 10], [cx + 14.5, cz + 10]]) { mesh(new THREE.CylinderGeometry(0.28, 0.28, 5.6, 8), lam(0xdddddd), px, GY + 2.8, pz, scene); addStatic(px, pz, 0.3); }
    for (const [px, pz] of [[cx + 6, cz - 6], [cx + 6, cz + 6], [cx + 12, cz - 6], [cx + 12, cz + 6]]) pumpSpots.push([px, pz]);
    mesh(geoBox(1.2, 8, 0.5), lam(0xd62828), cx + 19, GY + 4, cz - 17, scene); addStatic(cx + 19, cz - 17, 0.8);
  }
}

/* ---------------- distritos em grade (centro e resort) ---------------- */
const treeSpots = [], pineSpots = [], palmSpots = [], lampSpots = [];
function buildBlocks(xs, zs, o) {
  for (let ci = 0; ci < xs.length - 1; ci++) for (let cj = 0; cj < zs.length - 1; cj++) {
    const cx = (xs[ci] + xs[ci + 1]) / 2, cz = (zs[cj] + zs[cj + 1]) / 2, H = 19.5;
    const dcen = Math.hypot(cx - o.cx, cz - o.cz), tall = Math.exp(-(dcen * dcen) / (2 * o.sigma * o.sigma));
    const hh = () => Math.round(o.minH + R() * o.rngH + tall * R() * o.tallH);
    lampSpots.push([cx - 21.5, cz - 21.5], [cx + 21.5, cz + 21.5]);
    if (o.only && !o.only(ci, cj)) continue;
    const sp = o.specials && SPECIALS[ci + ',' + cj];
    if (sp) { buildSpecial(sp, cx, cz); continue; }
    if (R() < o.parkP) {
      parks.push({ x: cx, z: cz });
      plane(2 * H + 4, 2 * H + 4, 0x5aa850, cx, URBAN_H + 0.04, cz);
      for (let k = 0; k < 9; k++) { const tx = cx + (R() - .5) * 2 * (H - 2), tz = cz + (R() - .5) * 2 * (H - 2); treeSpots.push([tx, tz, 0.9 + R() * 0.7]); addStatic(tx, tz, 0.6); }
      mesh(new THREE.CylinderGeometry(3.2, 3.5, 0.7, 14), lam(0xb7b9bd), cx, URBAN_H + 0.35, cz, scene);
      mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.2, 14), lam(0x4fb8e8), cx, URBAN_H + 0.72, cz, scene, false);
      mesh(new THREE.CylinderGeometry(0.4, 0.6, 2.2, 8), lam(0xb7b9bd), cx, URBAN_H + 1.2, cz, scene);
      addStatic(cx, cz, 3.3);
      continue;
    }
    const t = R(), pi = () => Math.floor(R() * palettes.length), mk = (x0, x1, z0, z1) => addBuilding(x0, x1, z0, z1, hh(), pi());
    if (t < 0.35) mk(cx - H, cx + H, cz - H, cz + H);
    else if (t < 0.65) { if (R() < .5) { mk(cx - H, cx - 1, cz - H, cz + H); mk(cx + 1, cx + H, cz - H, cz + H); } else { mk(cx - H, cx + H, cz - H, cz - 1); mk(cx - H, cx + H, cz + 1, cz + H); } }
    else { mk(cx - H, cx - 1, cz - H, cz - 1); mk(cx + 1, cx + H, cz - H, cz - 1); mk(cx - H, cx - 1, cz + 1, cz + H); mk(cx + 1, cx + H, cz + 1, cz + H); }
  }
}
buildBlocks(XSD, ZSD, { cx: -260, cz: -30, sigma: 85, minH: 7, rngH: 9, tallH: 62, parkP: 0, specials: true, only: (ci, cj) => ci >= 1 && ci <= 2 && cj >= 1 && cj <= 2 });

console.log('[boot] heightmap+roads+blocks done', Math.round(performance.now()));
/* ---------------- lotes ao longo das estradas curvas ---------------- */
function obbOverlap(cx, cz, hx, hz, rot, b, pad = 1.0) { // teste SAT entre duas caixas orientadas
  const c1 = Math.cos(rot), s1 = Math.sin(rot), dx = b.cx - cx, dz = b.cz - cz;
  for (const [ax, az] of [[c1, s1], [-s1, c1], [b.c, b.s], [-b.s, b.c]]) {
    const r1 = hx * Math.abs(c1 * ax + s1 * az) + hz * Math.abs(-s1 * ax + c1 * az), r2 = b.hx * Math.abs(b.c * ax + b.s * az) + b.hz * Math.abs(-b.s * ax + b.c * az);
    if (Math.abs(dx * ax + dz * az) > r1 + r2 + pad) return false;
  }
  return true;
}
function overlapsAny(cx, cz, hx, hz, rot) {
  const rad = Math.hypot(hx, hz), ix0 = Math.floor((cx - rad - 30) / HC), ix1 = Math.floor((cx + rad + 30) / HC), iz0 = Math.floor((cz - rad - 30) / HC), iz1 = Math.floor((cz + rad + 30) / HC);
  for (let a = ix0; a <= ix1; a++) for (let b = iz0; b <= iz1; b++) { const arr = bHash.get(cellKey(a, b)); if (arr) for (const o of arr) if (Math.hypot(o.cx - cx, o.cz - cz) < rad + Math.hypot(o.hx, o.hz) + 1 && obbOverlap(cx, cz, hx, hz, rot, o)) return true; }
  return false;
}
const LOTSTAT = { ok: 0, low: 0, water: 0, road: 0, slope: 0, overlap: 0 };
function lotOK(cx, cz, hx, hz, rot) { // devolve a altura mínima do terreno sob o lote, ou null
  const c = Math.cos(rot), s = Math.sin(rot), pts = [[0, 0], [-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
  const h0 = sampleGrid(H, cx, cz); if (h0 < 0.7) { LOTSTAT.low++; return null; }
  let lo = 1e9, hi = -1e9;
  for (const [lx, lz] of pts) { const x = cx + lx * c - lz * s, z = cz + lx * s + lz * c, hh = sampleGrid(H, x, z); if (!walkable(x, z)) { LOTSTAT.water++; return null; } if (roadClear(x, z) < 3.2) { LOTSTAT.road++; return null; } lo = Math.min(lo, hh); hi = Math.max(hi, hh); }
  if (hi - lo > 3.2) { LOTSTAT.slope++; return null; }
  if (overlapsAny(cx, cz, hx, hz, rot)) { LOTSTAT.overlap++; return null; }
  LOTSTAT.ok++; return lo;
}
const roofCols = [0x8a3b2a, 0x5a3b2a, 0x3a4a5a, 0x7a2f2f];
function tryLot(e, s, side, kind) { for (const k of [1, 0.78, 0.6]) { const b = tryLotSized(e, s, side, kind, k); if (b) return b; } return null; }
function tryLotSized(e, s, side, kind, scale) {
  const p = pointOnEdge(e, s), rx = -p.tz * side, rz = p.tx * side, rot = Math.atan2(p.tz, p.tx);
  let w, d, h, tint, opts = {};
  if (kind === 'industrial') { w = 24 + R() * 16; d = 18 + R() * 10; h = 6 + R() * 7; tint = choice([0xb9c0c8, 0xa7b2bd, 0xc9c2b0]); opts.uvDiv = 22; }
  else if (kind === 'beach') { w = 12 + R() * 6; d = 10 + R() * 4; h = 4 + R() * 5; tint = choice([0xf5e6b8, 0xbfe3e0, 0xf2b6a8, 0xffffff, 0xf0d070]); }
  else if (kind === 'house') { w = 9 + R() * 4; d = 8 + R() * 3; h = 4 + R() * 1.5; tint = choice([0xf2e6c8, 0xd9b99b, 0xc9d6df, 0xe8cfcf, 0xf5f5f0]); opts.gable = { rh: 2.8, color: choice(roofCols) }; opts.kind = 'house'; }
  else if (kind === 'barn') { w = 15 + R() * 3; d = 10; h = 6.5; tint = 0xa63a2d; opts.gable = { rh: 4, color: 0x4a3a30 }; opts.uvDiv = 30; }
  else { const t1 = Math.exp(-((p.x + 260) ** 2 + (p.z + 40) ** 2) / (2 * 100 * 100)), t2 = Math.exp(-((p.x - 240) ** 2 + (p.z - 30) ** 2) / (2 * 110 * 110)), tall = Math.max(t1, t2 * 0.55); w = 14 + R() * 8; d = 14 + R() * 6; h = 7 + R() * 11 + tall * R() * 52; tint = choice(palettes); if (p.x > 300 && p.x < 400) h = 5 + R() * 14; }
  if (scale < 1) { w *= scale; d = Math.max(d * scale, 8); }
  if (kind === 'city') d = Math.min(d, 16);
  const off = e.W / 2 + CURB + 3.5 + d / 2, cx = p.x + rx * off, cz = p.z + rz * off;
  const y0 = lotOK(cx, cz, w / 2, d / 2, rot); if (y0 === null) return null;
  return addBuildingBox(cx, cz, w / 2, d / 2, rot, y0, h, tint, opts);
}
const hubs = [RW[2], RE[2]];
for (const e of edges) {
  if (e.grid) { // prédios colados nas ruas curvas (um depois do outro)
    for (const side of [-1, 1]) for (let s = 9 + R() * 6; s < e.L - 9;) { const b = tryLot(e, s, side, 'city'); s += b ? b.hx * 2 + 1.5 : 6; }
    continue;
  }
  if (e.type === 'bridge') continue;
  let step, kinds;
  if (e.type === 'rural') {
    for (let s = 22; s < e.L - 18; s += 22 + R() * 14) {
      const p = pointOnEdge(e, s), hd = Math.min(...hubs.map(h => Math.hypot(h.x - p.x, h.z - p.z)));
      if (hd < 95) { for (const side of [-1, 1]) if (R() < 0.8) tryLot(e, s, side, 'house'); }
      else if (R() < 0.18) {
        const side = R() < 0.5 ? -1 : 1, b = tryLot(e, s, side, 'house');
        if (b) { const sb = tryLot(e, s + 20, side, 'barn'); if (sb) { const sx = sb.cx + (R() - .5) * 8, sz = sb.cz + side * 10; if (walkable(sx, sz) && roadClear(sx, sz) > 5) { batchFor(sx, sz).geo(UG.cyl, T4(sx, sampleGrid(H, sx, sz) + 6, sz, 3.2, 12, 3.2), new THREE.Color(0xc4c8cc)); registerBox(sx, sz, 2.8, 2.8, 0, 0, 14, { kind: 'silo' }); } } }
      }
    }
    continue;
  }
  if (e.type === 'beach') { step = 30; kinds = ['beach']; }
  else if (e.a.tag === 'harbor' || e.b.tag === 'harbor') { step = 36; kinds = ['industrial']; }
  else { step = 42; kinds = ['city']; }
  for (let s = 18; s < e.L - 18; s += step * (0.8 + R() * 0.4)) for (const side of [-1, 1]) tryLot(e, s, side, choice(kinds));
}
for (const k in batches) batches[k].build(buildMat);

console.log('[boot] lots done', Math.round(performance.now()));
/* ---------------- árvores: tronco com casca + copa de cartões de folhas (perto) e versão simples (longe) ---------------- */
const windU = { value: 0 };
function leafMat(tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex || null, color: tex ? 0xffffff : 0x3f8f3a, alphaTest: tex ? 0.4 : 0, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uTime = windU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_INSTANCING
      float wph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
    #else
      float wph = 0.0;
    #endif
    float wsw = sin(uTime * 1.5 + wph + position.y * 0.55) * 0.03 * position.y;
    transformed.x += wsw; transformed.z += wsw * 0.6;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);'); // sem inverter a normal no verso do cartão
  };
  m.customProgramCacheKey = () => 'leafwind'; return m;
}
const barkMat = k => new THREE.MeshStandardMaterial({ map: AS[k] || null, normalMap: AS[k + '_Normal'] || null, color: AS[k] ? 0xffffff : 0x6b4a2b, roughness: 0.92 });
class GeoB { // acumula triângulos com posição, normal e uv
  constructor() { this.p = []; this.n = []; this.u = []; }
  v(p, n, u) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.u.push(u[0], u[1]); }
  quad(P, N, U) { for (const i of [0, 1, 2, 0, 2, 3]) this.v(P[i], N[i], U[i]); }
  geo(g, m) { const gg = g.index ? g.toNonIndexed() : g.clone(); if (m) gg.applyMatrix4(m); const pa = gg.attributes.position.array, na = gg.attributes.normal.array, ua = gg.attributes.uv.array; for (let i = 0; i < pa.length / 3; i++) this.v([pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]], [na[i * 3], na[i * 3 + 1], na[i * 3 + 2]], [ua[i * 2], ua[i * 2 + 1]]); gg.dispose(); }
  build() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.computeBoundingSphere(); return g; }
}
const v3 = { add: (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k], norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }, cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] };
function leafCard(G, base, ax, ay, w, h, uv, cen, centered) { // cartão de folhas; normais "infladas" a partir do centro da copa
  const b0 = centered ? v3.add(base, ay, -h / 2) : base, P = [v3.add(b0, ax, -w / 2), v3.add(b0, ax, w / 2), v3.add(v3.add(b0, ax, w / 2), ay, h), v3.add(v3.add(b0, ax, -w / 2), ay, h)];
  const N = P.map(p => v3.norm([p[0] - cen[0], (p[1] - cen[1]) * 0.8 + 0.9, p[2] - cen[2]]));
  G.quad(P, N, [[uv[0], uv[2]], [uv[1], uv[2]], [uv[1], uv[3]], [uv[0], uv[3]]]);
}
function leafyTreeGeo(seed) {
  const r = mulberry32(seed), T = new GeoB(), L = new GeoB(), cen = [0, 5.1, 0];
  T.geo(new THREE.CylinderGeometry(0.13, 0.3, 4.4, 8, 2), T4(0, 2.2, 0));
  for (let k = 0; k < 3; k++) { const a = k * 2.1 + r(); T.geo(new THREE.CylinderGeometry(0.04, 0.1, 2.2, 5), T4(Math.cos(a) * 0.65, 3.9, Math.sin(a) * 0.65, 1, 1, 1, Math.sin(a) * 0.75, 0, -Math.cos(a) * 0.75)); }
  for (let k = 0; k < 14; k++) {
    const th = r() * 6.283, ph = Math.acos(1 - 1.7 * r()), dir = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)], rad = 0.4 + 1.5 * r();
    const c = [cen[0] + dir[0] * rad * 1.15, cen[1] + dir[1] * rad * 0.85, cen[2] + dir[2] * rad * 1.15];
    const nrm = v3.norm([dir[0] + (r() - .5) * 0.9, dir[1] + (r() - .5) * 0.9, dir[2] + (r() - .5) * 0.9]);
    let ax = v3.norm(v3.cross([0, 1, 0], nrm)); if (!isFinite(ax[0]) || Math.hypot(ax[0], ax[1], ax[2]) < 0.5) ax = [1, 0, 0];
    let ay = v3.cross(nrm, ax); const rot = r() * 6.283, ca = Math.cos(rot), sa = Math.sin(rot), ax2 = v3.add([ax[0] * ca, ax[1] * ca, ax[2] * ca], ay, sa), ay2 = v3.add([ay[0] * ca, ay[1] * ca, ay[2] * ca], ax, -sa);
    leafCard(L, c, ax2, ay2, 2.6 + r() * 1.1, 2.6 + r() * 1.1, [0.02, 0.98, 0.02, 0.98], cen, true);
  }
  return { trunk: T.build(), leaves: L.build() };
}
function pineTreeGeo() {
  const T = new GeoB(), L = new GeoB();
  T.geo(new THREE.CylinderGeometry(0.05, 0.28, 8.8, 8, 2), T4(0, 4.4, 0));
  for (let t = 0; t < 7; t++) {
    const y = 1.9 + t * 1.02, len = 3.1 - t * 0.37, n = t < 4 ? 5 : 4, droop = 0.42 - t * 0.03;
    for (let b = 0; b < n; b++) {
      const a = b / n * 6.283 + t * 0.9, out = [Math.cos(a), 0, Math.sin(a)], along = v3.norm([out[0] * Math.cos(droop), -Math.sin(droop), out[2] * Math.cos(droop)]), side = [-Math.sin(a), 0, Math.cos(a)];
      leafCard(L, [0, y, 0], side, along, len * 1.05, len, [0.02, 0.74, 0.0, 1.0], [0, y - 2.5, 0], false);
      leafCard(L, [0, y, 0], v3.norm(v3.cross(along, side)), along, len * 0.7, len, [0.02, 0.74, 0.0, 1.0], [0, y - 2.5, 0], false); // cartão cruzado: volume
    }
  }
  for (let k = 0; k < 2; k++) leafCard(L, [0, 7.6, 0], [Math.cos(k * 1.57), 0, Math.sin(k * 1.57)], [0, 1, 0], 1.7, 1.9, [0.02, 0.74, 0.0, 1.0], [0, 6.5, 0], false);
  return { trunk: T.build(), leaves: L.build() };
}
function palmTreeGeo() {
  const T = new GeoB(), L = new GeoB(), tg = new THREE.CylinderGeometry(0.15, 0.25, 7, 8, 7), pa = tg.attributes.position;
  for (let i = 0; i < pa.count; i++) { const t = (pa.getY(i) + 3.5) / 7; pa.setX(i, pa.getX(i) + 0.95 * t * t); pa.setY(i, pa.getY(i) + 3.5); }
  tg.computeVertexNormals(); T.geo(tg, null);
  const crown = [0.95, 6.95, 0];
  for (let f = 0; f < 11; f++) {
    const a = f / 11 * 6.283 + (f % 2) * 0.25, out = [Math.cos(a), 0, Math.sin(a)], side = [-Math.sin(a) * 0.62, 0, Math.cos(a) * 0.62], lift = f % 2 ? 0.95 : 0.55, uv = f % 3 ? [0.04, 0.44] : [0.48, 0.77];
    const pt = k => [crown[0] + out[0] * k * 1.15, crown[1] + lift * k - 0.4 * k * k, crown[2] + out[2] * k * 1.15];
    for (let k = 0; k < 3; k++) {
      const p0 = pt(k), p1 = pt(k + 1), P = [v3.add(p0, side, -1), v3.add(p0, side, 1), v3.add(p1, side, 1), v3.add(p1, side, -1)], N = P.map(p => v3.norm([p[0] - crown[0], 1.6, p[2] - crown[2]]));
      L.quad(P, N, [[uv[0], k / 3], [uv[1], k / 3], [uv[1], (k + 1) / 3], [uv[0], (k + 1) / 3]]);
    }
  }
  return { trunk: T.build(), leaves: L.build() };
}
function bushGeo() {
  const r = mulberry32(77), L = new GeoB();
  for (let k = 0; k < 7; k++) { const a = r() * 6.283, nrm = v3.norm([Math.cos(a), 0.5 + r() * 0.6, Math.sin(a)]), ax = v3.norm(v3.cross([0, 1, 0], nrm)), ay = v3.cross(nrm, ax); leafCard(L, [Math.cos(a) * 0.35, 0.75, Math.sin(a) * 0.35], ax, ay, 1.7, 1.7, [0.02, 0.98, 0.02, 0.98], [0, 0.2, 0], true); }
  return L.build();
}
const lowTreeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
const TREE_CH = 170, treeChunks = [];
function plantSpecies(list, sp) { // agrupa por região: malhas instanciadas detalhadas (perto) e simples (longe)
  const groups = new Map(), d = new THREE.Object3D(), col = new THREE.Color();
  for (const it of list) { const k = Math.floor(it[0] / TREE_CH) + '_' + Math.floor(it[1] / TREE_CH); let g = groups.get(k); if (!g) groups.set(k, g = []); g.push(it); }
  for (const [, arr] of groups) {
    const n = arr.length, mk = (geo, mat, shadow) => { const im = new THREE.InstancedMesh(geo, mat, n); im.castShadow = shadow; im.receiveShadow = false; return im; };
    const near = [], far = mk(sp.low, lowTreeMat, false);
    if (sp.trunk) near.push(mk(sp.trunk, sp.trunkMat, true)); near.push(mk(sp.leaves, sp.leafMat, QUAL.soft && !sp.small));
    let cx = 0, cz = 0;
    arr.forEach(([x, z, sc], i) => {
      const s = (sc || 1) * sp.scale * (0.88 + R() * 0.26); d.rotation.set(0, R() * 6.283, 0); d.scale.set(s, s * (0.92 + R() * 0.2), s); d.position.set(x, sampleGrid(H, x, z) - 0.05, z); d.updateMatrix();
      for (const m of near) m.setMatrixAt(i, d.matrix); far.setMatrixAt(i, d.matrix);
      col.setHex(sp.tints[(R() * sp.tints.length) | 0]).multiplyScalar(0.85 + R() * 0.3); near[near.length - 1].setColorAt(i, col); far.setColorAt(i, col);
      cx += x; cz += z;
    });
    for (const m of [...near, far]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); scene.add(m); }
    far.visible = false; treeChunks.push({ x: cx / n, z: cz / n, near, far, isNear: true, small: !!sp.small });
  }
}
function plantForest() {
  const low = (parts) => mergeParts(parts);
  const LO = { cyl: new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), ico: new THREE.IcosahedronGeometry(1, 0), cone: new THREE.ConeGeometry(1, 1, 6, 1, true) };
  const leafyLow = low([part(LO.cyl, 0x5a4630, 0, 2.1, 0, 0.22, 4.2, 0.22), part(LO.ico, 0x7fb565, 0, 5.2, 0, 2.5, 2.1, 2.5)]);
  const mk = (leafKey, barkKey, seed, tints, scale) => { const g = leafyTreeGeo(seed); return { trunk: g.trunk, leaves: g.leaves, trunkMat: barkMat(barkKey), leafMat: leafMat(AS[leafKey]), low: leafyLow, tints, scale }; };
  const species = [mk('NormalTree_Leaves', 'NormalTree_Bark', 11, [0x8a9c78, 0x7c9070, 0x98a680, 0x86a070], 0.86), mk('BirchTree_Leaves', 'BirchTree_Bark', 23, [0xa9bf72, 0xb8c878, 0x9cb86a], 0.8), mk('MapleTree_Leaves', 'MapleTree_Bark', 37, [0xd8b4a2, 0xe0c0a0, 0xc9a090], 0.84)];
  const buckets = [[], [], []];
  for (const t of treeSpots) { const h = hash2(Math.round(t[0] * 3), Math.round(t[1] * 3)); buckets[h < 0.62 ? 0 : h < 0.88 ? 1 : 2].push(t); }
  species.forEach((sp, i) => plantSpecies(buckets[i], sp));
  const pg = pineTreeGeo();
  plantSpecies(pineSpots, { trunk: pg.trunk, leaves: pg.leaves, trunkMat: barkMat('PineTree_Bark'), leafMat: leafMat(AS.PineTree_Leaves), low: low([part(LO.cyl, 0x4f3a26, 0, 1.4, 0, 0.2, 2.8, 0.2), part(LO.cone, 0x4c8a52, 0, 5.4, 0, 2.2, 7.2, 2.2)]), tints: [0x5f8f62, 0x558558, 0x6a9a6a, 0x4f7f55], scale: 0.95 });
  const pl = palmTreeGeo();
  plantSpecies(palmSpots.map(p => [p[0], p[1], 1]), { trunk: pl.trunk, leaves: pl.leaves, trunkMat: barkMat('PalmTree_Trunk'), leafMat: leafMat(AS.PalmTree_Leaves), low: low([part(LO.cyl, 0x8a6a3c, 0.4, 3.4, 0, 0.2, 6.8, 0.2), part(LO.cone, 0x6fae5a, 0.95, 6.9, 0, 3.3, 1.1, 3.3)]), tints: [0xb4cca4, 0xa6c096, 0xc0d4ac], scale: 1 });
  // arbustos soltos no campo e nos parques (sem colisão)
  const bushes = [];
  for (let k = 0; k < 9000 && bushes.length < 1400; k++) { const x = (R() * 2 - 1) * 580, z = (R() * 2 - 1) * 680, h0 = sampleGrid(H, x, z); if (h0 < 1.2 || h0 > 34 || inBeach(x, z) || urbanW(x, z) > 0.5 || roadClear(x, z) < 2.5 || boxAt(x, z, 2)) continue; bushes.push([x, z, 0.7 + R() * 0.9]); }
  for (const p of parks) for (let k = 0; k < 6; k++) bushes.push([p.x + (R() - .5) * 34, p.z + (R() - .5) * 34, 0.8 + R() * 0.5]);
  plantSpecies(bushes, { trunk: null, leaves: bushGeo(), leafMat: leafMat(AS.Bush_Leaves), low: low([part(LO.ico, 0x74aa5e, 0, 0.6, 0, 0.9, 0.7, 0.9)]), tints: [0x8a9c78, 0x7a9468, 0x9aaa80], scale: 1, small: true });
}
let treeLodT = 0, treeNear = QUAL.treeNear;
function updateTreeLOD(dt) {
  windU.value = T; treeLodT -= dt; if (treeLodT > 0) return; treeLodT = 0.25;
  const cx = camera.position.x, cz = camera.position.z;
  const nd = treeNear;
  for (const c of treeChunks) { const d = Math.hypot(c.x - cx, c.z - cz), near = c.isNear ? d < nd + 25 : d < nd, farOn = !near && d < (c.small ? 260 : 620); if (near !== c.isNear || c.far.visible !== farOn) { c.isNear = near; for (const m of c.near) m.visible = near; c.far.visible = farOn; } }
}

/* ---------------- postes, árvores, palmeiras, areia ---------------- */
for (const e of edges) {
  if (e.type === 'rural' || e.type === 'bridge') continue;
  for (let s = 20; s < e.L - 10; s += 38) {
    const side = ((s / 38) | 0) % 2 ? 1 : -1, p = pointOnEdge(e, s), off = e.W / 2 + 1.2;
    const x = p.x - p.tz * side * off, z = p.z + p.tx * side * off;
    if (!insideBuilding(x, z, 1) && walkable(x, z)) lampSpots.push([x, z]);
  }
  if (e.type === 'beach') for (let s = 8; s < e.L; s += 14) for (const side of [-1, 1]) { const p = pointOnEdge(e, s), x = p.x - p.tz * side * (e.W / 2 + 4), z = p.z + p.tx * side * (e.W / 2 + 4); if (!insideBuilding(x, z, 1)) palmSpots.push([x, z]); }
}
const inBeach = (x, z) => x > BEACH_R[0] && x < BEACH_R[1] && z > BEACH_R[2] && z < BEACH_R[3];
for (let k = 0; k < 400; k++) { const x = BEACH_R[0] + 40 + R() * (BEACH_R[1] - BEACH_R[0] - 40), z = BEACH_R[2] + R() * (BEACH_R[3] - BEACH_R[2]); if (terrainH(x, z) > 0.4 && roadClear(x, z) > 3 && !insideBuilding(x, z, 3) && deckAt(x, z) === null && R() < 0.25) palmSpots.push([x, z]); }
// floresta
{
  let n = 0;
  for (let k = 0; k < 60000 && n < 5200; k++) {
    const x = (R() * 2 - 1) * 580, z = (R() * 2 - 1) * 680, h0 = sampleGrid(H, x, z);
    if (h0 < 1.3 || inBeach(x, z)) continue;
    const uw = urbanW(x, z); if (uw > 0.6) continue;
    const hm = hillMask(x, z), nn = fbm(x * 0.012 + 70, z * 0.012 + 30, 3), dens = (hm * 0.95 + (nn - 0.52) * 1.5 + 0.1) * (1 - uw);
    if (R() > dens) continue;
    if (roadClear(x, z) < 6 || boxAt(x, z, 5) || !walkable(x, z)) continue;
    const sl = Math.abs(sampleGrid(H, x + 3, z) - h0) + Math.abs(sampleGrid(H, x, z + 3) - h0); if (sl > 5) continue;
    if (h0 > 14 || R() < 0.45) pineSpots.push([x, z, 0.9 + R() * 0.9]); else treeSpots.push([x, z, 0.8 + R() * 0.9]);
    addStatic(x, z, 0.5); n++;
  }
}
{
  const d = new THREE.Object3D();
  const mkInst = (geo, mat, list, yOf, scaleOf) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); im.castShadow = true;
    list.forEach((it, i) => { const [x, z, sc] = it; d.rotation.set(0, R() * 6, 0); d.scale.setScalar(scaleOf ? scaleOf(sc) : 1); d.position.set(x, yOf(x, z, sc), z); d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
    im.count = list.length; scene.add(im); return im;
  };
  plantForest();
  for (const [x, z] of palmSpots) addStatic(x, z, 0.45);
  const lamps = lampSpots.filter(([x, z]) => walkable(x, z)).map(p => [p[0], p[1], 1]);
  const pole = mkInst(new THREE.CylinderGeometry(0.12, 0.16, 6, 6), lam(0x333840), lamps, (x, z) => sampleGrid(H, x, z) + 3);
  mkInst(geoBox(0.9, 0.25, 0.5), lam(0xfff3b0, { emissive: 0xfff3b0 }), lamps, (x, z) => sampleGrid(H, x, z) + 6.1);
  for (const [x, z] of lamps) addStatic(x, z, 0.25);
  // semáforos (modelo do pacote) em parte dos cruzamentos urbanos
  if (hasModel('TrafficLight')) {
    const spots = [];
    for (const n of nodes) {
      if (n.edges.length < 3 || n.edges.some(e => e.type === 'rural' || e.type === 'bridge') || hash2(n.id * 7 + 1, 13) > 0.5) continue;
      const Wm = Math.max(...n.edges.map(e => e.W)), r = Wm / 2 + 1.5, a0 = Math.floor(hash2(n.id, 5) * 4) * Math.PI / 2 + Math.PI / 4, x = n.x + Math.cos(a0) * r * 1.2, z = n.z + Math.sin(a0) * r * 1.2;
      if (walkable(x, z) && !insideBuilding(x, z, 0.6)) spots.push([x, z, a0]);
    }
    const tg = modelGeo('TrafficLight', 5.4 / AS.models.TrafficLight.size[1], () => true, g => '#' + g.color), tm = new THREE.InstancedMesh(tg, lowTreeMat, Math.max(1, spots.length));
    spots.forEach(([x, z, a0], i) => { d.scale.setScalar(1); d.rotation.set(0, -a0 + Math.PI / 2, 0); d.position.set(x, groundH(x, z), z); d.updateMatrix(); tm.setMatrixAt(i, d.matrix); addStatic(x, z, 0.25); });
    tm.count = spots.length; tm.castShadow = true; scene.add(tm);
  }
  void pole;
}
// guarda-sóis e toalhas
{
  const n = 46, poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), lam(0xdddddd), n), tops = new THREE.InstancedMesh(new THREE.ConeGeometry(1.9, 0.8, 10), lam(0xffffff), n), d = new THREE.Object3D();
  let i = 0;
  for (let k = 0; k < 400 && i < n; k++) {
    const x = 392 + R() * 70, z = -230 + R() * 480; if (terrainH(x, z) < 0.5 || roadClear(x, z) < 4 || !walkable(x, z) || deckAt(x, z) !== null) continue;
    const y = terrainH(x, z); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.position.set(x, y + 1.3, z); d.updateMatrix(); poles.setMatrixAt(i, d.matrix);
    d.position.set(x, y + 2.7, z); d.updateMatrix(); tops.setMatrixAt(i, d.matrix); tops.setColorAt(i, new THREE.Color(choice([0xff4d4d, 0xffd23f, 0x4dd0ff, 0xff8cf0, 0x6bff6b])));
    plane(1.1, 2.2, choice([0xff6b6b, 0x59a5ff, 0xffe066, 0xffffff]), x + 2.2, y + 0.04, z + 0.6); i++;
  }
  poles.count = tops.count = i; tops.castShadow = true; scene.add(poles, tops);
}
// torres de salva-vidas e bar da praia
for (const z of [-150, 110]) {
  const x = 408, y = terrainH(x, z);
  addSolid(x - 2, x + 2, z - 2, z + 2, 3.2, 0xffffff, y + 2.2);
  for (const [ax, az] of [[x - 1.7, z - 1.7], [x + 1.7, z - 1.7], [x - 1.7, z + 1.7], [x + 1.7, z + 1.7]]) mesh(geoBox(0.3, 2.2, 0.3), lam(0x8d5a34), ax, y + 1.1, az, scene);
  mesh(geoBox(5, 0.4, 5), lam(0xff4d4d), x, y + 5.6, z, scene);
}
{ const x = 420, z = 30, y = terrainH(x, z); addSolid(x - 6, x + 6, z - 3.5, z + 3.5, 3.5, 0x8d5a34, y); mesh(geoBox(14, 0.5, 9), lam(0x2eb5c9), x, y + 3.8, z, scene); }

/* ---------------- letreiro nas colinas ---------------- */
{
  let bx = -300, bz = -560, bh = -1;
  for (let x = -450; x < -150; x += 8) for (let z = -640; z < -420; z += 8) { const h = sampleGrid(H, x, z); if (h > bh && roadClear(x, z) > 12) { bh = h; bx = x; bz = z; } }
  const tex = canvasTex(1024, 192, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 150px Arial Black, Impact, sans-serif'; c.textAlign = 'center'; c.fillText('PEDRO CITY', w / 2, 150); c.strokeStyle = '#888'; c.lineWidth = 6; c.strokeText('PEDRO CITY', w / 2, 150); });
  const s = new THREE.Mesh(new THREE.PlaneGeometry(90, 17), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false })); s.position.set(bx, bh + 14, bz); scene.add(s);
  for (const dx of [-35, 0, 35]) mesh(geoBox(1.5, 12, 1.5), lam(0xdddddd), bx + dx, bh + 5, bz - 0.5, scene);
}

/* ---------------- pontos de aparição (pedestres, carros) ---------------- */
const walkSpots = { city: [], beach: [], rural: [] }, roadSpots = [];
for (const e of edges) {
  for (let s = 8; s < e.L - 8; s += 16) {
    const p = pointOnEdge(e, s); roadSpots.push({ e, s: s });
    if (e.type === 'bridge') { walkSpots.city.push({ x: p.x - p.tz * (e.W / 2 + 1), z: p.z + p.tx * (e.W / 2 + 1) }); continue; }
    for (const side of [-1, 1]) {
      const x = p.x - p.tz * side * (e.W / 2 + 1.4), z = p.z + p.tx * side * (e.W / 2 + 1.4);
      if (!walkable(x, z) || insideBuilding(x, z, 1)) continue;
      const zone = inBeach(x, z) ? 'beach' : urbanW(x, z) > 0.5 ? 'city' : 'rural';
      walkSpots[zone].push({ x, z });
    }
  }
}
for (let k = 0; k < 500; k++) { const x = BEACH_R[0] + 55 + R() * 130, z = BEACH_R[2] + R() * 520; if (terrainH(x, z) > 0.5 && walkable(x, z) && deckAt(x, z) === null && !insideBuilding(x, z, 2) && inBeach(x, z)) walkSpots.beach.push({ x, z }); }
for (let k = 0; k < 400; k++) { const x = (R() * 2 - 1) * 560, z = (R() * 2 - 1) * 680; if (terrainH(x, z) > 1.5 && urbanW(x, z) < 0.3 && !inBeach(x, z) && walkable(x, z) && !insideBuilding(x, z, 2) && Math.abs(sampleGrid(H, x + 3, z) - terrainH(x, z)) < 1.5) walkSpots.rural.push({ x, z }); }

/* ---------------- coletáveis ---------------- */
function addPickup(x, z, kind = 'health', amount = 0, life = 0, respawn = 0) {
  const g = new THREE.Group();
  if (kind === 'health') {
    mesh(geoBox(0.9, 0.3, 0.3), lam(0x2ee06a, { emissive: 0x1a8a40 }), 0, 0, 0, g, false);
    mesh(geoBox(0.3, 0.9, 0.3), lam(0x2ee06a, { emissive: 0x1a8a40 }), 0, 0, 0, g, false);
  } else if (amount >= 1000) {
    mesh(geoBox(0.7, 0.22, 0.36), lam(0xf2c200, { emissive: 0x6a5000, metalness: 0.8, roughness: 0.3 }), 0, -0.12, 0, g, false);
    mesh(geoBox(0.7, 0.22, 0.36), lam(0xf2c200, { emissive: 0x6a5000, metalness: 0.8, roughness: 0.3 }), 0, 0.12, 0, g, false);
  } else {
    mesh(geoBox(0.6, 0.12, 0.34), lam(0x3fbf5f, { emissive: 0x1a6a30 }), 0, -0.05, 0, g, false);
    mesh(geoBox(0.6, 0.12, 0.34), lam(0x3fbf5f, { emissive: 0x1a6a30 }), 0.03, 0.07, 0.02, g, false);
    mesh(geoBox(0.14, 0.3, 0.38), lam(0xf5f5f5), 0, 0.0, 0, g, false);
  }
  const y = amount && x > -1500 ? groundH(x, z) : groundH(x, z);
  g.position.set(x, y + 1, z); scene.add(g);
  const p = { kind, x, z, y, g, t: 0, ph: Math.random() * 6, amount, life, respawn }; pickups.push(p); return p;
}
const addCash = (x, z, amount, life = 30) => addPickup(x, z, 'cash', amount, life);
for (let k = 0; k < 22; k++) { const pool = k < 8 ? walkSpots.city : k < 15 ? walkSpots.beach : walkSpots.rural; const sp = choice(pool); if (sp) addPickup(sp.x, sp.z); }

/* ---------------- mapa pré-renderizado (minimapa e mapa grande) ---------------- */
const MAP_X0 = -HALF_X, MAP_Z0 = -HALF_Z, MAP_S = 1;
const mapCanvas = document.createElement('canvas'); mapCanvas.width = HALF_X * 2 * MAP_S; mapCanvas.height = HALF_Z * 2 * MAP_S;
(function drawMap() {
  const c = mapCanvas.getContext('2d'), S = MAP_S;
  c.fillStyle = '#2a8fd0'; c.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const h = H[j * GW + i], x = i * CELL - HALF_X, z = j * CELL - HALF_Z;
    if (h < -0.35) { const t = clamp(-h / 14, 0, 1); c.fillStyle = `rgb(${Math.round(60 - 40 * t)},${Math.round(160 - 80 * t)},${Math.round(215 - 60 * t)})`; }
    else c.fillStyle = terrainColor(i, j, x, z).getStyle();
    c.fillRect((i * CELL - CELL / 2) * S, (j * CELL - CELL / 2) * S, CELL * S + 0.6, CELL * S + 0.6);
  }
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const pass of [0, 1]) for (const e of edges) {
    c.beginPath(); e.pts.forEach((p, i) => { const X = (p.x + HALF_X) * S, Z = (p.z + HALF_Z) * S; if (i) c.lineTo(X, Z); else c.moveTo(X, Z); });
    c.lineWidth = (pass ? e.W - 2 : e.W + 4) * S * (e.type === 'rural' ? 1.4 : 1); c.strokeStyle = pass ? (e.type === 'bridge' ? '#b8bac0' : e.type === 'rural' ? '#8d8470' : '#5b5e66') : '#2d2f33'; c.stroke();
  }
  c.fillStyle = '#d8d3c8';
  for (const b of buildings) {
    if (b.kind === 'solid' || b.x0 < -1500) continue;
    const cs = b.c, sn = b.s, P = [[-b.hx, -b.hz], [b.hx, -b.hz], [b.hx, b.hz], [-b.hx, b.hz]].map(([lx, lz]) => [(b.cx + lx * cs - lz * sn + HALF_X) * S, (b.cz + lx * sn + lz * cs + HALF_Z) * S]);
    c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let k = 1; k < 4; k++) c.lineTo(P[k][0], P[k][1]); c.closePath(); c.fill();
  }
  for (const d of decks) if (d.kind === 'pier') { c.fillStyle = '#9c7a4d'; c.fillRect((d.x0 + HALF_X) * S, (d.zc - d.hw + HALF_Z) * S, (d.x1 - d.x0) * S, d.hw * 2 * S); }
})();

console.log('[boot] world done', Math.round(performance.now()));
/* ---------------- áudio ---------------- */
let actx = null, master = null, muted = false, engineOsc = null, engineGain = null, sirenOsc = null, sirenGain = null;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)(); master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
    engineOsc = actx.createOscillator(); engineOsc.type = 'sawtooth'; engineGain = actx.createGain(); engineGain.gain.value = 0;
    const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; engineOsc.connect(lp); lp.connect(engineGain); engineGain.connect(master); engineOsc.start();
    sirenOsc = actx.createOscillator(); sirenOsc.type = 'square'; sirenGain = actx.createGain(); sirenGain.gain.value = 0; sirenOsc.connect(sirenGain); sirenGain.connect(master); sirenOsc.start();
  } catch (e) { actx = null; }
}
function noise(dur, vol, type, freq) {
  if (!actx || muted) return;
  const n = (actx.sampleRate * dur) | 0, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const s = actx.createBufferSource(); s.buffer = buf; const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = actx.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start();
}
function sfx(name, x, z) {
  if (!actx) return;
  const d = x === undefined ? 0 : Math.hypot(x - player.x, z - player.z), a = clamp(1 - d / 140, 0, 1);
  if (a <= 0) return;
  if (name === 'shot') noise(0.13, 0.5 * a, 'highpass', 1100);
  else if (name === 'boom') noise(1.1, 1.3 * a, 'lowpass', 450);
  else if (name === 'hit') noise(0.09, 0.45 * a, 'lowpass', 900);
  else if (name === 'crash') noise(0.28, 0.8 * a, 'lowpass', 650);
}

/* ---------------- partículas ---------------- */
const partGeo = geoBox(1, 1, 1);
const partMats = {};
const partPool = [], parts = [];
function puff(x, y, z, n, color, speed, life, size, grav = 8, up = 2) {
  const mat = partMats[color] || (partMats[color] = new THREE.MeshBasicMaterial({ color }));
  for (let i = 0; i < n; i++) {
    const m = partPool.pop() || new THREE.Mesh(partGeo, mat); m.material = mat; m.visible = true; scene.add(m);
    m.position.set(x, y, z);
    parts.push({ m, vx: rand(-1, 1) * speed, vy: rand(0, 1) * speed + up, vz: rand(-1, 1) * speed, life: rand(0.5, 1) * life, t0: 0, size: size * rand(0.6, 1.2), g: grav });
    parts[parts.length - 1].t0 = parts[parts.length - 1].life;
  }
}
function updateParts(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { scene.remove(p.m); partPool.push(p.m); parts.splice(i, 1); continue; }
    p.vy -= p.g * dt; p.m.position.x += p.vx * dt; p.m.position.y = Math.max(0.05, p.m.position.y + p.vy * dt); p.m.position.z += p.vz * dt;
    p.m.scale.setScalar(p.size * (p.life / p.t0));
  }
}
const fireballs = [];
function fireball(x, y, z, r) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.95 }));
  m.position.set(x, y, z); scene.add(m); fireballs.push({ m, t: 0, r });
}
let shake = 0;

/* ---------------- pessoas ---------------- */
const skins = [0xf1c9a5, 0xe0ac82, 0xc68642, 0x8d5524, 0x5c3a1e];
const hairs = [0x2b1b10, 0x5a3a1e, 0x111111, 0xc9a04a, 0x8a4b2a, 0x777777];
const HG = {
  torso: new THREE.CapsuleGeometry(0.19, 0.3, 4, 12), limb: new THREE.CapsuleGeometry(0.075, 0.36, 4, 8), leg: new THREE.CapsuleGeometry(0.1, 0.5, 4, 8),
  cap: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52)
};
const humanMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 });
function makeHuman(o) {
  const skin = o.skin, shirt = o.shirt, pants = o.pants, hair = o.hair ?? choice(hairs), style = o.hairStyle ?? choice(['short', 'short', 'long', 'bald']);
  const body = [
    part(UG.box, pants, 0, 0.86, 0, 0.46, 0.2, 0.27), part(HG.torso, shirt, 0, 1.15, 0, 1.28, 1, 0.78), part(UG.box, 0x222222, 0, 0.9, 0, 0.5, 0.05, 0.3),
    part(UG.cyl, skin, 0, 1.53, 0, 0.06, 0.1, 0.06), part(UG.sph, skin, 0, 1.68, 0, 0.165, 0.185, 0.17), part(UG.box, skin, 0, 1.665, -0.17, 0.035, 0.05, 0.05),
    part(UG.sph, 0x111111, -0.06, 1.7, -0.147, 0.022, 0.026, 0.02), part(UG.sph, 0x111111, 0.06, 1.7, -0.147, 0.022, 0.026, 0.02),
    part(UG.sph, skin, -0.17, 1.67, 0.0, 0.03, 0.05, 0.035), part(UG.sph, skin, 0.17, 1.67, 0.0, 0.03, 0.05, 0.035)
  ];
  if (style !== 'bald') body.push(part(HG.cap, hair, 0, 1.69, 0.012, 0.18, 0.18, 0.185));
  if (style === 'long') body.push(part(UG.box, hair, 0, 1.56, 0.125, 0.33, 0.42, 0.09));
  if (style === 'short') body.push(part(UG.box, hair, 0, 1.7, 0.14, 0.31, 0.14, 0.07));
  if (o.hat) { body.push(part(UG.cyl, o.hat, 0, 1.82, 0, 0.185, 0.09, 0.19), part(UG.box, o.hat, 0, 1.775, -0.16, 0.3, 0.025, 0.14)); }
  if (o.tie) body.push(part(UG.box, o.tie, 0, 1.2, -0.152, 0.055, 0.34, 0.02), part(UG.box, 0xffffff, 0, 1.38, -0.15, 0.17, 0.04, 0.02));
  if (o.apron) body.push(part(UG.box, o.apron, 0, 1.02, -0.152, 0.36, 0.52, 0.02), part(UG.box, o.apron, 0, 1.33, -0.14, 0.05, 0.12, 0.02));
  if (o.badge) body.push(part(UG.box, 0xf2c200, 0.11, 1.3, -0.152, 0.06, 0.07, 0.02));
  if (o.vest) body.push(part(HG.torso, o.vest, 0, 1.15, -0.01, 1.34, 0.98, 0.84));
  const bodyMesh = new THREE.Mesh(mergeParts(body), humanMat); bodyMesh.castShadow = true;
  const arm = (side) => {
    const ps = o.shortSleeve ? [part(HG.limb, shirt, 0, -0.14, 0, 1.05, 0.55, 1.05), part(HG.limb, skin, 0, -0.38, 0, 0.9, 0.5, 0.9)] : [part(HG.limb, shirt, 0, -0.25, 0, 1, 1, 1)];
    ps.push(part(UG.sph, skin, 0, -0.52, 0, 0.07, 0.07, 0.07));
    return ps;
  };
  const leg = () => [part(HG.leg, pants, 0, -0.36, 0, 1, 1, 1), part(UG.box, o.shoes ?? 0x1b1b1f, 0, -0.78, -0.04, 0.17, 0.13, 0.31)];
  const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.add(bodyMesh);
  const limb = (x, y, list) => { const p = new THREE.Group(); p.position.set(x, y, 0); const m = new THREE.Mesh(mergeParts(list), humanMat); m.castShadow = true; p.add(m); g.add(p); return p; };
  const legL = limb(-0.12, 0.85, leg()), legR = limb(0.12, 0.85, leg());
  const armL = limb(-0.31, 1.42, arm(-1)), armR = limb(0.31, 1.42, arm(1));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, -0.82, 0); armR.add(muzzle);
  let gunMesh = null, batMesh = null;
  if (o.gun) { gunMesh = new THREE.Mesh(mergeParts([part(UG.box, 0x23262b, 0, -0.64, -0.01, 0.07, 0.26, 0.11), part(UG.box, 0x5a5f68, 0, -0.62, -0.01, 0.075, 0.2, 0.06)]), humanMat); gunMesh.castShadow = true; armR.add(gunMesh); }
  if (o.bat) {
    batMesh = new THREE.Mesh(mergeParts([part(UG.cyl, 0x222222, 0, -0.56, 0, 0.04, 0.22, 0.04), part(UG.cyl, 0xc8a26a, 0, -0.9, 0, 0.045, 0.5, 0.045), part(UG.cyl, 0xc8a26a, 0, -1.28, 0, 0.07, 0.4, 0.07), part(UG.sph, 0xc8a26a, 0, -1.48, 0, 0.07, 0.04, 0.07)]), humanMat);
    batMesh.castShadow = true; batMesh.visible = false; armR.add(batMesh);
  }
  scene.add(g);
  return { g, legL, legR, armL, armR, muzzle, gun: gunMesh, bat: batMesh };
}
function makeCow() {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const white = 0xf4f1ea, blk = 0x1c1c1c, body = [part(UG.box, white, 0, 1.0, 0, 0.72, 0.7, 1.55), part(UG.box, 0xe6a3a3, 0, 0.78, 0.2, 0.3, 0.1, 0.35), part(UG.box, white, 0, 1.28, -0.98, 0.42, 0.42, 0.5), part(UG.box, 0xe6a3a3, 0, 1.18, -1.25, 0.3, 0.2, 0.1), part(UG.box, white, 0.18, 1.55, -0.92, 0.07, 0.14, 0.07), part(UG.box, white, -0.18, 1.55, -0.92, 0.07, 0.14, 0.07), part(UG.box, blk, 0, 1.0, 0.82, 0.07, 0.5, 0.07), part(UG.box, blk, 0.2, 1.05, -0.83, 0.04, 0.04, 0.04), part(UG.box, blk, -0.2, 1.05, -0.83, 0.04, 0.04, 0.04)];
  for (let i = 0; i < 4; i++) { const sd = i % 2 ? 1 : -1; body.push(part(UG.box, blk, sd * 0.37, 1.05 + (i > 1 ? 0.1 : -0.05), -0.4 + i * 0.35, 0.03, 0.3 + Math.random() * 0.15, 0.4 + Math.random() * 0.2)); }
  body.push(part(UG.box, blk, 0, 1.37, 0.1, 0.5, 0.05, 0.4));
  const bm = new THREE.Mesh(mergeParts(body), humanMat); bm.castShadow = true; g.add(bm);
  const leg = (x, z) => { const p = new THREE.Group(); p.position.set(x, 0.72, z); const m = new THREE.Mesh(mergeParts([part(UG.box, white, 0, -0.36, 0, 0.17, 0.72, 0.17), part(UG.box, 0x222222, 0, -0.7, 0, 0.18, 0.1, 0.18)]), humanMat); m.castShadow = true; p.add(m); g.add(p); return p; };
  const armL = leg(-0.24, -0.55), armR = leg(0.24, -0.55), legL = leg(-0.24, 0.55), legR = leg(0.24, 0.55);
  const muzzle = new THREE.Object3D(); g.add(muzzle); scene.add(g);
  return { g, legL, legR, armL, armR, muzzle, gun: null, bat: null };
}
function newChar(type, x, z, o) {
  const parts = o.model === 'cow' ? makeCow() : makeHuman(o);
  const c = {
    type, x, z, y: 0, vy: 0, vx: 0, vz: 0, mx: 0, mz: 0, h: rand(0, 6.28), hp: o.hp, maxhp: o.hp, mesh: parts.g, parts, alive: true, stun: 0, deadT: 0,
    walkT: Math.random() * 6, armed: !!o.gun, aim: 0, tgt: null, repath: 0, flee: 0, fx: 0, fz: 0, shootCd: rand(0.3, 1), blocked: 0, detour: 0, dvx: 0, dvz: 0, zone: o.zone || 'city', model: o.model || 'human', inCar: null, invuln: 0, wait: 0, leaveT: 0
  };
  chars.push(c); return c;
}
function npcLook() {
  return { shirt: choice([0xe04848, 0x4880e0, 0x48c060, 0xe0c048, 0xb048e0, 0xffffff, 0xff8a3d, 0x30c0c0, 0x333333]), pants: choice([0x2a3f6a, 0x333333, 0x6b4a2b, 0x4a5a3a, 0x8899aa]), skin: choice(skins), hat: Math.random() < .2 ? choice([0xdd3333, 0x2255cc, 0xeeeeee]) : 0, shoes: choice([0x1b1b1f, 0xf0f0f0, 0x5a3a1e]), shortSleeve: Math.random() < 0.4, hp: 50 };
}
function beachLook() { return { shirt: choice([0xff5599, 0x33ccff, 0xffee33, 0xff8844]), pants: choice([0x1188dd, 0xdd3355, 0xffffff, 0x22bb77]), skin: choice(skins), hat: 0, hp: 50, zone: 'beach', shortSleeve: true, shoes: 0xf0f0f0 }; }
function pickSpot(zone, minD = 60, maxD = 190) {
  const list = walkSpots[zone]; if (!list.length) return { x: START.x, z: START.z };
  const P = pursuit();
  for (let t = 0; t < 40; t++) { const sp = list[(Math.random() * list.length) | 0], d = Math.hypot(sp.x - P.x, sp.z - P.z); if (d >= minD && d <= maxD) return sp; }
  return list[(Math.random() * list.length) | 0];
}
const spawnPointCity = () => pickSpot('city'), spawnPointBeach = () => pickSpot('beach'), spawnPointRural = () => pickSpot('rural');

/* ---------------- jogador ---------------- */
const player = newChar('player', START.x, START.z, { shirt: 0xff7a1a, pants: 0x1d2b4f, skin: 0xe0ac82, hat: 0x111111, hair: 0x2b1b10, hairStyle: 'short', shoes: 0xf2f2f2, gun: true, bat: true, hp: 100, shortSleeve: true });
player.h = 0; player.hp = 100; player.maxhp = 100;
let heat = 0, lastShotT = -10, nextShot = 0, camYaw = 0, camPitch = 0.14, camDist = 4.2, recoil = 0, lastMouse = 0, hurtT = 0;

/* ---------------- carros ---------------- */
const carColors = [0xd62828, 0x1f6feb, 0xf2c200, 0xf5f5f5, 0xaab2bd, 0x2a9d4a, 0xff7a1a, 0x7b3fe4, 0x222629, 0xe83e8c, 0x0b8a8f, 0x8b1e2d];
const CAR_TYPES = {
  sedan: { low: [[-2.15, 0.38], [2.15, 0.38], [2.1, 0.72], [1.2, 0.88], [0.7, 0.92], [-1.35, 0.92], [-2.05, 0.88], [-2.15, 0.7]], cab: [[0.85, 0.9], [0.35, 1.48], [-1.05, 1.48], [-1.55, 0.9]], w: 1.9, cw: 1.68, wz: 1.35, hl: 0.78 },
  suv: { low: [[-2.15, 0.42], [2.15, 0.42], [2.15, 0.85], [1.4, 1.02], [0.95, 1.05], [-2.1, 1.05], [-2.15, 0.9]], cab: [[1.0, 1.02], [0.7, 1.82], [-1.9, 1.82], [-2.08, 1.02]], w: 1.98, cw: 1.8, wz: 1.4, hl: 0.82 },
  sport: { low: [[-2.1, 0.34], [2.15, 0.34], [2.15, 0.6], [1.0, 0.78], [0.3, 0.84], [-1.5, 0.88], [-2.1, 0.8]], cab: [[0.6, 0.82], [0.05, 1.27], [-1.0, 1.27], [-1.55, 0.86]], w: 1.98, cw: 1.62, wz: 1.3, hl: 0.66 },
  van: { low: [[-2.2, 0.42], [2.2, 0.42], [2.2, 0.92], [1.75, 1.08], [-2.2, 1.08]], cab: [[1.7, 1.05], [1.4, 1.95], [-2.12, 1.95], [-2.2, 1.05]], w: 2.0, cw: 1.9, wz: 1.55, hl: 0.85 }
};
const carGeoCache = {};
const carBodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.26, envMapIntensity: 1.5 });
const carLightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
const wheelGeo = (() => {
  const mk = (r, w, c) => ({ g: new THREE.CylinderGeometry(r, r, w, 14), c, m: T4(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2) });
  return mergeParts([mk(0.38, 0.28, 0x16171a), mk(0.25, 0.3, 0xc9ccd1), mk(0.09, 0.33, 0x555a60)]);
})();
const VEH = {
  sedan:   { L: 4.3, hw: 0.95, circ: [-1.45, 0, 1.45], r: 1.05, vmax: 28, acc: 17, turn: 1.9, hp: 300 },
  compact: { L: 3.5, hw: 0.85, circ: [-1.0, 1.0], r: 1.0, vmax: 21, acc: 13, turn: 2.1, hp: 220 },
  taxi:    { L: 4.3, hw: 0.95, circ: [-1.45, 0, 1.45], r: 1.05, vmax: 27, acc: 17, turn: 1.9, hp: 300 },
  suv:     { L: 4.3, hw: 0.99, circ: [-1.45, 0, 1.45], r: 1.1, vmax: 26, acc: 15, turn: 1.7, hp: 380 },
  sport:   { L: 4.25, hw: 0.99, circ: [-1.4, 0, 1.4], r: 1.05, vmax: 40, acc: 27, turn: 2.3, hp: 260 },
  muscle:  { L: 4.25, hw: 1.03, circ: [-1.4, 0, 1.4], r: 1.08, vmax: 36, acc: 25, turn: 2.0, hp: 330 },
  van:     { L: 4.4, hw: 1.0, circ: [-1.5, 0, 1.5], r: 1.15, vmax: 22, acc: 12, turn: 1.6, hp: 400 },
  pickup:  { L: 4.7, hw: 1.0, circ: [-1.6, 0, 1.6], r: 1.1, vmax: 25, acc: 15, turn: 1.7, hp: 380 },
  truck:   { L: 7.6, hw: 1.2, circ: [-3, -1.5, 0, 1.5, 3], r: 1.3, vmax: 17, acc: 8, turn: 1.25, hp: 800 },
  bus:     { L: 9.6, hw: 1.3, circ: [-3.6, -1.8, 0, 1.8, 3.6], r: 1.4, vmax: 15, acc: 7, turn: 1.1, hp: 900 },
  ambulance: { L: 5.4, hw: 1.15, circ: [-1.9, 0, 1.9], r: 1.25, vmax: 27, acc: 14, turn: 1.5, hp: 450, tall: true },
  schoolbus: { L: 9.8, hw: 1.3, circ: [-3.7, -1.85, 0, 1.85, 3.7], r: 1.4, vmax: 15, acc: 7, turn: 1.1, hp: 900, tall: true },
  moto:    { L: 2.2, hw: 0.4, circ: [-0.55, 0.55], r: 0.55, vmax: 42, acc: 32, turn: 2.8, hp: 110 }
};
const scaleProf = (t, sx, sw) => ({ ...t, low: t.low.map(p => [p[0] * sx, p[1]]), cab: t.cab.map(p => [p[0] * sx, p[1]]), w: t.w * sw, cw: t.cw * sw, wz: t.wz * sx });
CAR_TYPES.compact = scaleProf(CAR_TYPES.sedan, 0.8, 0.9);
CAR_TYPES.taxi = { ...CAR_TYPES.sedan, taxi: true };
CAR_TYPES.muscle = { ...CAR_TYPES.sport, w: 2.06, cw: 1.7, muscle: true };
CAR_TYPES.pickup = { low: [[-2.35, 0.42], [2.3, 0.42], [2.3, 0.85], [1.6, 1.0], [1.1, 1.04], [-2.35, 1.04]], cab: [[1.25, 1.0], [0.85, 1.72], [-0.1, 1.72], [-0.5, 1.0]], w: 2.0, cw: 1.8, wz: 1.55, hl: 0.85, bed: true };
const WHEELS = {
  truck: [[-1, -2.7], [1, -2.7], [-1, 1.2], [1, 1.2], [-1, 2.7], [1, 2.7]],
  bus: [[-1.1, -3.1], [1.1, -3.1], [-1.1, 3.1], [1.1, 3.1]],
  moto: [[0, -0.85], [0, 0.85]]
};
function boxVehGeo(type, color) {
  const body = [], lights = [];
  if (type === 'truck') {
    body.push(part(UG.box, 0x1a1b1e, 0, 0.75, 0, 1.9, 0.5, 7.2), part(UG.box, color, 0, 1.95, -2.7, 2.2, 1.8, 2.0), part(UG.box, 0x1a2530, 0, 2.25, -3.72, 1.95, 0.85, 0.12),
      part(UG.box, 0xe9e9e9, 0, 2.4, 1.35, 2.35, 2.6, 5.0), part(UG.box, color, 0, 1.25, 1.35, 2.38, 0.18, 5.02), part(UG.box, 0x2a2d33, 0, 0.9, -3.78, 2.3, 0.3, 0.2), part(UG.box, 0x2a2d33, 0, 0.9, 3.78, 2.3, 0.3, 0.2));
    for (const sx of [-1, 1]) lights.push(part(UG.box, 0xfff3c0, sx * 0.8, 1.2, -3.8, 0.4, 0.2, 0.05), part(UG.box, 0xff2a2a, sx * 0.85, 1.2, 3.8, 0.4, 0.2, 0.05));
  } else {
    body.push(part(UG.box, color, 0, 1.95, 0, 2.5, 2.7, 9.3), part(UG.box, 0x1a2530, 0, 2.5, 0, 2.54, 0.95, 8.6), part(UG.box, 0x1a2530, 0, 2.55, -4.66, 2.2, 1.3, 0.1), part(UG.box, 0xf0f0f0, 0, 1.2, 0, 2.52, 0.3, 9.1),
      part(UG.box, 0x2a2d33, 0, 0.75, -4.72, 2.5, 0.3, 0.2), part(UG.box, 0x2a2d33, 0, 0.75, 4.72, 2.5, 0.3, 0.2), part(UG.box, 0xf2c200, 0, 3.25, -4.66, 1.6, 0.35, 0.1));
    for (const sx of [-1, 1]) lights.push(part(UG.box, 0xfff3c0, sx * 0.9, 1.0, -4.74, 0.4, 0.25, 0.05), part(UG.box, 0xff2a2a, sx * 0.9, 1.0, 4.74, 0.4, 0.25, 0.05));
  }
  return { body: mergeParts(body), lights: lights.length ? mergeParts(lights) : mergeParts([part(UG.box, 0, 0, -50, 0, 0.01, 0.01, 0.01)]) };
}
function motoGeo(color) {
  const body = [
    part(UG.box, color, 0, 0.85, -0.18, 0.3, 0.3, 0.75), part(UG.box, 0x1a1c20, 0, 0.82, 0.5, 0.26, 0.1, 0.75), part(UG.box, color, 0, 0.7, 0.98, 0.22, 0.05, 0.5, 0.2),
    part(UG.box, 0x2a2d33, 0, 0.5, 0.05, 0.34, 0.38, 0.5), part(UG.box, 0x9aa0a8, 0.22, 0.38, 0.35, 0.08, 0.08, 0.6), part(UG.box, 0x2a2d33, 0, 0.62, -0.95, 0.08, 0.85, 0.08, 0.35),
    part(UG.box, 0x2a2d33, 0, 1.08, -0.78, 0.76, 0.06, 0.06), part(UG.box, color, 0, 0.98, -0.95, 0.26, 0.2, 0.18), part(UG.box, 0x1a1c20, 0, 0.45, 0.62, 0.1, 0.5, 0.1, -0.5)
  ];
  const lights = [part(UG.box, 0xfff6c8, 0, 0.98, -1.06, 0.2, 0.18, 0.06), part(UG.box, 0xff2a2a, 0, 0.8, 1.2, 0.18, 0.08, 0.05)];
  return { body: mergeParts(body), lights: mergeParts(lights) };
}
VEH.truck.tall = VEH.bus.tall = true;
const MODEL_OF = { sedan: 'NormalCar1', compact: 'NormalCar2', suv: 'SUV', sport: 'SportsCar', muscle: 'SportsCar2', taxi: 'Taxi', bus: 'Bus', schoolbus: 'SchoolBus', ambulance: 'Ambulance' };
const PAINT = { NormalCar1: { Blue: 1 }, NormalCar2: { LightBlue: 1 }, SUV: { White: 1 }, SportsCar: { Orange: 1, DarkOrange: 0.78 }, SportsCar2: { White: 1 }, Bus: { Bottom: 1 } };
const LIGHT_COL = { Headlights: 0xfff3c0, TailLights: 0xff2a2a, WhiteLights: 0xffffff, BlueLights: 0x2060ff, Lights: 0xfff3c0 };
const PART_COL = { Windows: 0x1a2530, Black: 0x16171a, Grey: 0x8f949c, Material: 0x16171a, Wheel: 0x16171a };
function modelCarGeo(mn, type, color) {
  const M = AS.models[mn], k = VEH[type].L / M.size[2], paint = PAINT[mn] || {}, isWheel = p => /Wheel/i.test(p.name), tc = new THREE.Color();
  const bodyCol = g => { if (paint[g.mat]) return tc.set(color).multiplyScalar(paint[g.mat]).getHex(); return PART_COL[g.mat] ?? parseInt(g.color, 16); };
  const body = modelGeo(mn, k, (p, g) => !isWheel(p) && !(g.mat in LIGHT_COL), bodyCol);
  const lights = modelGeo(mn, k, (p, g) => !isWheel(p) && g.mat in LIGHT_COL, g => LIGHT_COL[g.mat]);
  const wheels = M.parts.filter(isWheel).map(p => ({ pos: p.center.map(v => v * k), geo: modelGeo(mn, k, q => q === p, g => g.mat === 'Grey' ? 0xc9ccd1 : 0x16171a, (v, part) => part ? [v[0] - p.center[0] * k, v[1] - p.center[1] * k, v[2] - p.center[2] * k] : v) }));
  return { body, lights, wheels, top: M.size[1] * k };
}
function buildCarGeo(type, color, cop) {
  const key = type + color + cop; if (carGeoCache[key]) return carGeoCache[key];
  { const mn = cop ? 'Cop' : MODEL_OF[type]; if (mn && hasModel(mn)) return (carGeoCache[key] = modelCarGeo(mn, type, color)); }
  if (type === 'truck' || type === 'bus') return (carGeoCache[key] = boxVehGeo(type, color));
  if (type === 'moto') return (carGeoCache[key] = motoGeo(color));
  const t = CAR_TYPES[type], Lh = VEH[type].L / 2, glass = 0x1a2530, base = cop ? 0x15171c : type === 'taxi' ? 0xf2c200 : color, topLen = t.cab[1][1], col = type === 'taxi' ? 0xf2c200 : color;
  const body = [
    { g: prof(t.low, t.w, 0.09), c: base },
    { g: prof(t.cab, t.cw, 0.06), c: glass },
    { g: prof([[t.cab[1][0] + 0.03, topLen - 0.05], [t.cab[1][0] - 0.02, topLen + 0.05], [t.cab[2][0] + 0.02, topLen + 0.05], [t.cab[2][0] - 0.03, topLen - 0.05]], t.cw - 0.04, 0.03), c: cop ? 0xf2f2f2 : col },
    part(UG.box, 0x101114, 0, 0.3, 0, t.w - 0.3, 0.18, 2 * Lh - 0.2),
    part(UG.box, 0x2a2d33, 0, 0.5, -Lh, t.w + 0.02, 0.2, 0.16), part(UG.box, 0x2a2d33, 0, 0.5, Lh, t.w + 0.02, 0.2, 0.16),
    part(UG.box, 0x0d0d0f, 0, 0.66, -Lh, 0.95, 0.14, 0.05), part(UG.box, 0xe8e8e8, 0, 0.55, Lh + 0.09, 0.5, 0.13, 0.02),
    part(UG.box, col, -t.w / 2 - 0.06, t.cab[0][1] + 0.1, -0.55, 0.12, 0.1, 0.2), part(UG.box, col, t.w / 2 + 0.06, t.cab[0][1] + 0.1, -0.55, 0.12, 0.1, 0.2)
  ];
  for (const sx of [-1, 1]) {
    body.push(part(UG.box, 0x08080a, sx * (t.w / 2 + 0.005), 0.72, -0.1, 0.02, 0.5, 0.025), part(UG.box, 0x08080a, sx * (t.w / 2 + 0.005), 0.72, 1.05, 0.02, 0.5, 0.025));
    for (const wz of [-t.wz, t.wz]) body.push(part(UG.cyl, 0x060607, sx * (t.w / 2 - 0.02), 0.4, wz, 0.5, 0.06, 0.5, 0, 0, Math.PI / 2));
  }
  if (cop) body.push(part(UG.box, 0xf2f2f2, 0, 0.64, 0.35, t.w + 0.015, 0.34, 1.45));
  if (t.taxi) body.push(part(UG.box, 0xffffff, 0, topLen + 0.22, 0.2, 0.7, 0.2, 0.3), part(UG.box, 0x222222, 0, topLen + 0.22, 0.2, 0.72, 0.06, 0.32));
  if (t.muscle) body.push(part(UG.box, 0x101010, -0.25, 0.9, -0.2, 0.22, 0.02, 3.2), part(UG.box, 0x101010, 0.25, 0.9, -0.2, 0.22, 0.02, 3.2), part(UG.box, 0x101010, 0, 1.0, -1.4, 0.5, 0.12, 0.6));
  if (t.bed) {
    body.push(part(UG.box, base, -0.95, 1.2, 1.45, 0.1, 0.5, 1.9), part(UG.box, base, 0.95, 1.2, 1.45, 0.1, 0.5, 1.9), part(UG.box, base, 0, 1.2, Lh - 0.1, 1.9, 0.5, 0.1), part(UG.box, 0x2a2d33, 0, 1.0, 1.45, 1.8, 0.05, 1.8));
  }
  const lights = [];
  for (const sx of [-1, 1]) lights.push(part(UG.box, 0xfff3c0, sx * 0.66, t.hl, -Lh - 0.01, 0.42, 0.15, 0.05), part(UG.box, 0xff2a2a, sx * 0.7, t.hl + 0.03, Lh, 0.46, 0.13, 0.05));
  return (carGeoCache[key] = { body: mergeParts(body), lights: mergeParts(lights) });
}
function makeCarMesh(color, cop, type) {
  const g = buildCarGeo(type, color, cop), grp = new THREE.Group(), t = CAR_TYPES[type];
  const body = new THREE.Mesh(g.body, carBodyMat); body.castShadow = true; body.receiveShadow = true; grp.add(body);
  const lights = new THREE.Mesh(g.lights, carLightMat); grp.add(lights);
  const wheels = []; let wr = 0.38;
  if (g.wheels) { // modelo pronto: rodas próprias
    for (const w of g.wheels) { const m = new THREE.Mesh(w.geo, wheelMat); m.position.set(w.pos[0], w.pos[1], w.pos[2]); m.castShadow = true; grp.add(m); wheels.push(m); wr = w.pos[1]; }
  } else {
    const pos = WHEELS[type] || [[-1, -t.wz], [1, -t.wz], [-1, t.wz], [1, t.wz]], big = type === 'truck' || type === 'bus'; wr = type === 'moto' ? 0.36 : big ? 0.5 : 0.38;
    for (const [x, z] of pos) {
      const w = new THREE.Mesh(wheelGeo, wheelMat); w.scale.setScalar(wr / 0.38); if (type === 'moto') w.scale.x = 0.5;
      w.position.set(type === 'moto' ? 0 : x * (big ? Math.abs(x) : (t.w / 2 - 0.1)), wr, z); w.castShadow = true; grp.add(w); wheels.push(w);
    }
  }
  let sR = null, sB = null;
  if (cop) {
    const top = g.top ? g.top - 0.02 : t.cab[1][1] + 0.16, zz = g.top ? -0.05 : 0.1;
    sR = new THREE.Mesh(UG.box, new THREE.MeshBasicMaterial({ color: 0xff2020 })); sR.scale.set(0.5, 0.12, 0.26); sR.position.set(-0.33, top, zz); grp.add(sR);
    sB = new THREE.Mesh(UG.box, new THREE.MeshBasicMaterial({ color: 0x2060ff })); sB.scale.set(0.5, 0.12, 0.26); sB.position.set(0.33, top, zz); grp.add(sB);
  }
  scene.add(grp);
  return { g: grp, meshes: [body, lights], wheels, sR, sB, wr };
}
function pickVehType(e) {
  const rural = e && e.type === 'rural', hw = e && (e.type === 'main' || e.type === 'bridge');
  const w = rural ? { pickup: 5, truck: 2, suv: 2, sedan: 2, compact: 1.5, van: 1, moto: 1 } : { sedan: 4, compact: 3, taxi: 3, suv: 2.5, van: 1.5, sport: 1.3, muscle: 1, pickup: 1.2, bus: hw ? 1.0 : 0.6, schoolbus: 0.5, ambulance: 0.5, truck: hw ? 1.2 : 0.4, moto: 2 };
  let tot = 0; for (const k in w) tot += w[k]; let r = Math.random() * tot; for (const k in w) { r -= w[k]; if (r <= 0) return k; } return 'sedan';
}
function makeRider() {
  const h = makeHuman({ ...npcLook(), hat: 0, hairStyle: 'short', shortSleeve: Math.random() < 0.5, hp: 50 });
  scene.remove(h.g); h.g.position.set(0, 0.0, 0.42); h.g.rotation.x = -0.18;
  h.legL.rotation.x = h.legR.rotation.x = 1.15; h.armL.rotation.x = h.armR.rotation.x = 1.1; h.legL.rotation.z = 0.25; h.legR.rotation.z = -0.25;
  return h.g;
}
function newCar(x, z, h, mode, cop, forcedType, edge) {
  const type = forcedType || (cop ? 'sedan' : pickVehType(edge)), V = VEH[type];
  const color = type === 'taxi' ? 0xf2c200 : choice(carColors), cm = makeCarMesh(color, cop, type);
  const c = {
    x, z, h, color, speed: 0, hp: cop ? 380 : V.hp, maxhp: cop ? 380 : V.hp, mesh: cm.g, meshes: cm.meshes, wheels: cm.wheels, wr: cm.wr, type, V, isMoto: type === 'moto', sR: cm.sR, sB: cm.sB, cop: !!cop, mode, driver: mode === 'player' ? 'player' : null,
    maxSpeed: cop ? 33 : V.vmax, acc: cop ? 21 : V.acc, turnK: V.turn, cruise: rand(10, 14), edge: null, dir: 1, s: 0, spf: clamp(V.vmax / 28, 0.6, 1.3) * rand(0.9, 1.08), pitch: 0, roll: 0, slopeRoll: 0, vy: 0, vyG: 0, air: false, airT: 0, bounced: false, ys: 0, prevH: h, stuckT: 0, ghost: 0, rev: 0, lastPlayer: false, smokeT: 0, wreckT: 0, cargo: cop ? 2 : 0, deployT: 0, y: 0
  };
  if (c.isMoto) { c.rider = makeRider(); cm.g.add(c.rider); }
  cars.push(c); return c;
}
function pursuit() { const d = player.inside; if (d) return { x: d.fx, z: d.fz, speed: 0 }; return player.inCar || player; }
const LANE_OF = e => Math.min(3.4, e.W / 2 - 2.4);
function projectS(e, hint, x, z) {
  let lo = 0, hi = e.cl.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cl[m] <= hint) lo = m; else hi = m; }
  let best = 1e18, bs = hint;
  for (let i = Math.max(0, lo - 4); i <= Math.min(e.pts.length - 2, lo + 6); i++) {
    const p = e.pts[i], q = e.pts[i + 1], dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1, t = clamp(((x - p.x) * dx + (z - p.z) * dz) / l2, 0, 1), px = p.x + dx * t, pz = p.z + dz * t, d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < best) { best = d; bs = e.cl[i] + t * (e.cl[i + 1] - e.cl[i]); }
  }
  return bs;
}
function placeOnEdge(c, e, sPos, dir) {
  c.edge = e; c.dir = dir; c.s = sPos; const p = pointOnEdge(e, sPos), tx = p.tx * dir, tz = p.tz * dir, off = LANE_OF(e);
  c.x = p.x - tz * off; c.z = p.z + tx * off; c.h = headingTo(tx, tz);
}
function spawnTraffic(initial, minD = initial ? 25 : 90, maxD = initial ? 260 : 300) {
  const P = pursuit();
  for (let t = 0; t < 40; t++) {
    const sp = roadSpots[(Math.random() * roadSpots.length) | 0], e = sp.e; if (e.type === 'rural' && Math.random() < 0.5) continue;
    const dir = Math.random() < 0.5 ? 1 : -1, tmp = {}; placeOnEdge(tmp, e, sp.s, dir);
    const d = Math.hypot(tmp.x - P.x, tmp.z - P.z); if (d < minD || d > maxD) continue;
    if (cars.some(o => Math.hypot(o.x - tmp.x, o.z - tmp.z) < 10)) continue;
    const c = newCar(tmp.x, tmp.z, tmp.h, 'traffic', false, null, e); c.driver = 'npc'; placeOnEdge(c, e, sp.s, dir); c.speed = Math.min(e.speed * c.spf, c.maxSpeed * 0.8); return c;
  }
  return null;
}
function chooseNext(c, chase) {
  const cur = c.edge, node = c.dir > 0 ? cur.b : cur.a;
  let opts = node.edges.filter(e2 => e2 !== cur); if (!opts.length) opts = [cur];
  const pe = pointOnEdge(cur, c.dir > 0 ? cur.L : 0), ex = pe.tx * c.dir, ez = pe.tz * c.dir;
  const info = opts.map(e2 => { const d2 = e2.a === node && !(e2 === cur && c.dir > 0) ? 1 : -1, far = d2 > 0 ? e2.b : e2.a, p = pointOnEdge(e2, d2 > 0 ? 1 : e2.L - 1); return { e: e2, d: d2, far, dot: p.tx * d2 * ex + p.tz * d2 * ez }; });
  let pick;
  if (chase) { const tgt = pursuit(); let best = 1e9; for (const o of info) { const dd = Math.hypot(o.far.x - tgt.x, o.far.z - tgt.z); if (dd < best) { best = dd; pick = o; } } }
  else { info.sort((a, b) => b.dot - a.dot); pick = Math.random() < 0.6 ? info[0] : choice(info); }
  c.edge = pick.e; c.dir = pick.d; c.s = pick.d > 0 ? 0.5 : pick.e.L - 0.5;
}
function carCircles(c) { const f = fwdOf(c.h), r = c.V.r; return c.V.circ.map(o => ({ x: c.x + f.x * o, z: c.z + f.z * o, r })); }

function aiDrive(c, dt, depth = 0) {
  const chase = c.mode === 'chase', tgtObj = pursuit();
  if (!c.edge) { const sp = roadSpots[(Math.random() * roadSpots.length) | 0]; placeOnEdge(c, sp.e, sp.s, 1); }
  const e = c.edge;
  let ax, az, wantSpeed = chase ? Math.min(27, c.maxSpeed * 0.92) : Math.min(e.speed * c.spf, c.maxSpeed * 0.8);
  const dPl = Math.hypot(tgtObj.x - c.x, tgtObj.z - c.z);
  const direct = chase && dPl < 28 && !segBlocked(c.x, c.z, tgtObj.x, tgtObj.z);
  if (direct) { ax = tgtObj.x; az = tgtObj.z; if (dPl < 9) wantSpeed = Math.max(8, Math.abs(tgtObj.speed || 0) + 4); }
  else {
    c.s = projectS(e, c.s, c.x, c.z);
    const remain = c.dir > 0 ? e.L - c.s : c.s;
    if (remain < 9 && depth < 2) { chooseNext(c, chase); return aiDrive(c, dt, depth + 1); }
    const look = Math.max(9, Math.abs(c.speed) * 0.7), p = pointOnEdge(e, clamp(c.s + c.dir * look, 0, e.L)), tx = p.tx * c.dir, tz = p.tz * c.dir, off = chase ? 0 : LANE_OF(e);
    ax = p.x - tz * off; az = p.z + tx * off;
    const nd = c.dir > 0 ? e.b : e.a;
    if (!chase && remain < 22 && nd.edges.length > 2) wantSpeed = Math.min(wantSpeed, 7);
  }
  let desired = headingTo(ax - c.x, az - c.z), diff = wrap(desired - c.h);
  if (c.rev > 0) { c.rev -= dt; wantSpeed = -5; diff = -diff; }
  if (Math.abs(diff) > 0.6 && wantSpeed > 8) wantSpeed = 8;
  const f = fwdOf(c.h), look2 = 5 + Math.abs(c.speed) * 0.55;
  if (c.speed > 0.5 && c.rev <= 0) {
    for (const o of cars) { if (o === c || o.mode === 'wreck') continue; const dx = o.x - c.x, dz = o.z - c.z; if (dx * dx + dz * dz > 900) continue; const fw = dx * f.x + dz * f.z, lt = Math.abs(dx * -f.z + dz * f.x); if (fw > 1 && fw < look2 + 2 && lt < 2.1) { wantSpeed = Math.min(wantSpeed, fw < 5 ? 0 : 3); } }
    if (!chase || dPl > 8) for (const o of chars) { if (!o.alive || o.inCar) continue; const dx = o.x - c.x, dz = o.z - c.z; if (dx * dx + dz * dz > 900) continue; const fw = dx * f.x + dz * f.z, lt = Math.abs(dx * -f.z + dz * f.x); if (fw > 1 && fw < look2 && lt < 1.9) wantSpeed = Math.min(wantSpeed, fw < 4 ? 0 : 3); }
  }
  if (c.speed < wantSpeed) c.speed += Math.min(12, c.acc * 0.8) * dt * (c.speed < 0 ? 2 : 1); else c.speed -= (wantSpeed <= 0.1 ? 26 : 10) * dt;
  c.h += clamp(diff * 3, -c.turnK * 1.15, c.turnK * 1.15) * clamp(Math.abs(c.speed) / 4, 0.1, 1) * (c.speed < 0 ? -1 : 1) * dt;
  if (Math.abs(c.speed) < 0.8 && wantSpeed > 3) {
    c.stuckT += dt;
    if (c.stuckT > 2.5 && !chase) c.ghost = 3;
    if (c.stuckT > 1.8 && c.rev <= 0 && (chase || c.stuckT > 4.5)) { c.rev = 1.4; c.stuckT = 0; }
  } else c.stuckT = Math.max(0, c.stuckT - dt);
  if (c.ghost > 0) c.ghost -= dt;
}

function updateCarPlayer(c, dt) {
  const thr = keys.KeyW || keys.ArrowUp, brk = keys.KeyS || keys.ArrowDown, hb = keys.Space;
  const steer = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0);
  if (c.air) { c.h += steer * c.turnK * 0.22 * dt; c.speed *= Math.exp(-0.05 * dt); return; } // no ar: quase sem controle
  if (thr) { if (c.speed < 0) c.speed += 40 * dt; else c.speed += c.acc * Math.max(0.12, 1 - c.speed / c.maxSpeed) * dt; }
  else if (brk) { if (c.speed > 0.4) c.speed -= 36 * dt; else c.speed = Math.max(-10, c.speed - 12 * dt); }
  else c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), (2.5 + c.speed * c.speed * 0.003) * dt);
  if (hb) c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), 32 * dt);
  const sp = Math.abs(c.speed);
  c.h += steer * (hb ? c.turnK * 1.5 : c.turnK) * clamp(sp / 5, 0, 1) * (c.speed >= 0 ? 1 : -1) * (1 - 0.4 * sp / c.maxSpeed) * dt;
}

function updateCar(c, dt) {
  if (c.mode === 'wreck') {
    c.speed *= Math.exp(-2 * dt); c.wreckT += dt;
    c.smokeT -= dt; if (c.smokeT <= 0) { c.smokeT = 0.06; puff(c.x + rand(-1, 1), 1, c.z + rand(-1, 1), 1, 0xff7a1a, 1.5, 0.7, 0.9, -2, 2); puff(c.x, 1.5, c.z, 1, 0x222222, 1, 1.6, 1.4, -3, 2); }
    if (c.wreckT > 22) removeCar(c);
  } else if (c.mode === 'player') updateCarPlayer(c, dt);
  else if (c.mode === 'traffic' || c.mode === 'chase') { if (!c.air) aiDrive(c, dt); }
  else c.speed *= Math.exp(-3 * dt); // estacionado
  // dano por fogo
  if (c.mode !== 'wreck' && c.hp < c.maxhp * 0.2) { c.hp -= 6 * dt; if (c.hp <= 0) explodeCar(c); }
  if (c.mode !== 'wreck' && c.hp < c.maxhp * 0.5) { c.smokeT -= dt; if (c.smokeT <= 0) { c.smokeT = c.hp < c.maxhp * 0.2 ? 0.07 : 0.18; const f = fwdOf(c.h); puff(c.x + f.x * 1.6, 1.1, c.z + f.z * 1.6, 1, c.hp < c.maxhp * 0.2 ? 0xff7a1a : 0x333333, 1, 1.2, 0.9, -2, 1.5); } }
  const f = fwdOf(c.h), px0 = c.x, pz0 = c.z;
  c.x += f.x * c.speed * dt; c.z += f.z * c.speed * dt;
  if (!walkable(c.x + f.x * 1.6, c.z + f.z * 1.6) || !walkable(c.x - f.x * 1.6, c.z - f.z * 1.6)) { c.x = px0; c.z = pz0; c.speed *= -0.25; }
  // colisão com o mundo
  let hit = false, nx = 0, nz = 0;
  for (const o of c.V.circ) {
    const p = { x: c.x + f.x * o, z: c.z + f.z * o }, ox = p.x, oz = p.z, n = collideStatic(p, c.V.r);
    if (n) { c.x += p.x - ox; c.z += p.z - oz; hit = true; nx = n.nx; nz = n.nz; }
  }
  if (hit) {
    const vn = c.speed * (f.x * nx + f.z * nz);
    if (vn < 0) {
      const vx = f.x * c.speed - 1.25 * vn * nx, vz = f.z * c.speed - 1.25 * vn * nz; c.speed = vx * f.x + vz * f.z;
      if (-vn > 6) { damageCar(c, (-vn - 5) * 6, c.mode === 'player'); sfx('crash', c.x, c.z); if (c.mode === 'player') { shake = Math.max(shake, Math.min(0.6, -vn * 0.03)); } puff(c.x + f.x * 2, 1, c.z + f.z * 2, 6, 0xffcc44, 4, 0.5, 0.2, 10); }
    }
  }
  // atropelar gente
  const sp = Math.abs(c.speed), gh = groundH(c.x, c.z);
  if (sp > 2.5 && c.mode !== 'wreck' && !(c.air && c.y - gh > 1.1)) for (const o of chars) {
    if (!o.alive || o.inCar || o.y > 1.2) continue;
    const dx = o.x - c.x, dz = o.z - c.z; if (dx * dx + dz * dz > 70) continue;
    const fw = dx * f.x + dz * f.z, lt = dx * -f.z + dz * f.x;
    if (Math.abs(lt) < c.V.hw + 0.4 && Math.abs(fw) < c.V.L / 2 + 0.3) {
      const byP = c.mode === 'player' || c.lastPlayer, isP = o.type === 'player';
      if (isP && o.invuln > 0) continue;
      damageChar(o, isP ? Math.min(sp * 2, 30) : sp * 7, byP, f.x * c.speed * 0.9 + -f.z * lt * 2, f.z * c.speed * 0.9 + f.x * lt * 2);
      if (isP) o.invuln = 1.0;
      o.vy = 3 + sp * 0.18; o.stun = 1.4; c.speed *= 0.94; sfx('hit', o.x, o.z);
      if (o.type === 'player') shake = Math.max(shake, 0.4);
    }
  }
  // --- altura: gravidade, decolagem em cristas e pouso ---
  const GRAV = 20;
  if (c.gh0 === undefined) { c.gh0 = gh; c.y = c.ys = gh; }
  const dgh = gh - c.gh0, stepLim = 0.1 + sp * dt * 0.8; c.gh0 = gh; // variação do chão neste quadro
  const isStep = Math.abs(dgh) > stepLim;                        // degrau (meio-fio, borda de pista): não é rampa
  const vg = isStep ? c.vyG : dgh / Math.max(dt, 1e-3);           // velocidade vertical do chão sob o carro
  if (!c.air) {
    const canFly = c.mode !== 'wreck' && c.mode !== 'parked';
    if (isStep && dgh < -0.6 && canFly) { c.air = true; c.airT = 0; c.vy = Math.min(c.vyG, 2); c.y = c.gh0 - dgh; }              // caiu de um barranco
    else if (!isStep && c.vyG - vg > (c.mode === 'player' ? 1.5 : 6) && sp > 8 && canFly) { c.air = true; c.airT = 0; c.vy = c.vyG; } // crista: o chão cai mais rápido que a gravidade
    else { c.y = gh; c.vyG += (vg - c.vyG) * Math.min(1, dt * 12); c.bounced = false; }
  }
  if (c.air) {
    c.airT += dt; c.vy -= GRAV * dt; c.y += c.vy * dt;
    if (c.y <= gh) {
      const imp = Math.max(0, clamp(vg, -12, 12) - c.vy); c.y = gh;
      if (imp > 4.5) { sfx(imp > 10 ? 'crash' : 'hit', c.x, c.z); puff(c.x, gh + 0.2, c.z, Math.min(14, 4 + imp | 0), 0xcfc7b0, 3, 0.6, 0.35, 5, 1.5); if (c.mode === 'player') shake = Math.max(shake, Math.min(0.7, imp * 0.045)); }
      if (imp > 11 && c.mode === 'player') damageCar(c, (imp - 10) * 8, false);
      c.speed *= 1 - clamp((imp - 4) * 0.012, 0, 0.3);
      if (imp > 7 && !c.bounced) { c.bounced = true; c.vy = imp * 0.2; c.y = gh + 0.01; } // um quique
      else { c.air = false; c.vyG = clamp(vg, -12, 12); }
    }
  }
  c.ys = c.air ? c.y : c.ys + (c.y - c.ys) * Math.min(1, dt * 22);
  if (c.air) { c.pitch += (clamp(Math.atan2(c.vy, Math.max(6, sp)) * 0.8, -0.5, 0.45) - c.pitch) * Math.min(1, dt * 3); } // no ar o nariz acompanha a trajetória
  else { const hf = groundH(c.x + f.x * 2, c.z + f.z * 2), hb = groundH(c.x - f.x * 2, c.z - f.z * 2); c.pitch += (clamp(Math.atan2(hf - hb, 4), -0.45, 0.45) - c.pitch) * Math.min(1, dt * 8); const hr = groundH(c.x - f.z * 1.1, c.z + f.x * 1.1), hl = groundH(c.x + f.z * 1.1, c.z - f.x * 1.1); c.slopeRoll += (clamp(Math.atan2(hr - hl, 2.2), -0.35, 0.35) - c.slopeRoll) * Math.min(1, dt * 8); }
  c.mesh.position.set(c.x, c.ys, c.z); c.mesh.rotation.set(c.pitch, c.h, c.isMoto ? c.roll : c.slopeRoll, 'YXZ');
  for (const w of c.wheels) w.rotation.x -= c.speed * dt / c.wr;
  if (c.isMoto) {
    const dh = wrap(c.h - c.prevH) / Math.max(dt, 1e-3); c.prevH = c.h; c.roll += (clamp(dh * c.speed * 0.014, -0.7, 0.7) - c.roll) * Math.min(1, dt * 8);
    c.mesh.rotation.z = c.roll; c.rider.visible = c.mode !== 'wreck' && (c.driver === 'npc' || c.driver === 'cop');
  }
  if (c.sR) { const on = Math.floor(T * 6) % 2 === 0; c.sR.material.color.setHex(on ? 0xff2020 : 0x300000); c.sB.material.color.setHex(on ? 0x101840 : 0x2060ff); }
}
function carVsCars() {
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (a.ghost > 0 || b.ghost > 0) continue;
    if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > ((a.V.L + b.V.L) / 2 + 2) ** 2) continue;
    const ca = carCircles(a), cb = carCircles(b); let hit = false, nx = 0, nz = 0, pen = 0;
    for (const p of ca) for (const q of cb) {
      const dx = p.x - q.x, dz = p.z - q.z, d2 = dx * dx + dz * dz;
      const rr = p.r + q.r;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01; hit = true; nx = dx / d; nz = dz / d; pen = Math.max(pen, rr - d); }
    }
    if (!hit) continue;
    a.x += nx * pen * 0.5; a.z += nz * pen * 0.5; b.x -= nx * pen * 0.5; b.z -= nz * pen * 0.5;
    const fa = fwdOf(a.h), fb = fwdOf(b.h);
    const vax = fa.x * a.speed, vaz = fa.z * a.speed, vbx = fb.x * b.speed, vbz = fb.z * b.speed;
    const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
    if (vn < 0) {
      const jn = -vn * 0.75;
      a.speed = (vax + nx * jn) * fa.x + (vaz + nz * jn) * fa.z; b.speed = (vbx - nx * jn) * fb.x + (vbz - nz * jn) * fb.z;
      if (-vn > 4) {
        const dmg = (-vn - 3) * 6; if (a.mode === 'player') b.lastPlayer = true; if (b.mode === 'player') a.lastPlayer = true;
        damageCar(a, dmg, b.mode === 'player'); damageCar(b, dmg, a.mode === 'player'); sfx('crash', a.x, a.z);
        puff((a.x + b.x) / 2, 1, (a.z + b.z) / 2, 6, 0xffcc44, 4, 0.5, 0.2, 10);
        if (a.mode === 'player' || b.mode === 'player') shake = Math.max(shake, Math.min(0.6, -vn * 0.04));
        if (a.mode === 'player' && b.cop || b.mode === 'player' && a.cop) addHeat(0.5);
      }
    }
  }
}
function damageCar(c, dmg, byPlayer) {
  if (c.mode === 'wreck') return;
  c.hp -= dmg; if (byPlayer) c.lastPlayer = true;
  if (player.inCar === c && dmg > 4) hurtPlayer(dmg * 0.06);
  if (c.hp <= 0) explodeCar(c);
}
function explodeCar(c) {
  if (c.mode === 'wreck') return;
  const wasPlayer = player.inCar === c;
  if (wasPlayer) ejectPlayer(c, true);
  if (c.driver === 'npc' || c.driver === 'cop') c.driver = null;
  c.mode = 'wreck'; c.wreckT = 0; c.speed *= 0.3;
  for (const m of c.meshes) m.material = lam(0x151515);
  if (c.sR) { c.sR.visible = c.sB.visible = false; }
  explode(c.x, c.z, 9, 90, c.lastPlayer || wasPlayer);
}
const freeGeo = o => o.traverse(m => { if (m.geometry && m.geometry.attributes.color && m.material === humanMat) m.geometry.dispose(); }); // libera as malhas próprias de um boneco
function removeCar(c) { if (c.rider) freeGeo(c.rider); scene.remove(c.mesh); const i = cars.indexOf(c); if (i >= 0) cars.splice(i, 1); }

/* ---------------- jet ski ---------------- */
const jets = [];
const jetWater = (x, z) => deckAt(x, z) === null && terrainH(x, z) < -0.9;
const jetColors = [0xff4d2e, 0x19b5ff, 0xffd23f, 0x7cf27c, 0xff5ccf];
function makeJetMesh(color) {
  const parts = [
    { g: prof([[-1.15, 0.02], [0.95, 0.02], [1.45, 0.3], [1.3, 0.46], [0.55, 0.56], [-1.15, 0.5]], 0.8, 0.09), c: color },
    part(UG.box, 0x1a1c20, 0, 0.64, 0.42, 0.38, 0.14, 0.95), part(UG.box, 0x2a2d33, 0, 0.82, -0.3, 0.07, 0.45, 0.07), part(UG.box, 0x2a2d33, 0, 1.03, -0.32, 0.62, 0.05, 0.07),
    part(UG.box, 0x9fd8ff, 0, 0.98, -0.62, 0.42, 0.28, 0.04, -0.5), part(UG.box, 0xffffff, -0.44, 0.38, 0.0, 0.06, 0.1, 2.2), part(UG.box, 0xffffff, 0.44, 0.38, 0.0, 0.06, 0.1, 2.2),
    part(UG.box, 0xfff3c0, 0, 0.46, -1.45, 0.3, 0.08, 0.05), part(UG.box, 0x222428, 0, 0.35, 1.18, 0.5, 0.2, 0.2)
  ];
  const g = new THREE.Group(), m = new THREE.Mesh(mergeParts(parts), carBodyMat); m.castShadow = true; g.add(m); g.rotation.order = 'YXZ'; scene.add(g); return g;
}
function addJet(x, z) {
  const color = choice(jetColors);
  const j = { x, z, h: Math.PI + rand(-0.6, 0.6), speed: 0, y: 0, pitch: 0, roll: 0, steer: 0, mesh: makeJetMesh(color), color, rider: false };
  jets.push(j); return j;
}
function updateJet(j, dt, driven) {
  if (driven) {
    const thr = keys.KeyW || keys.ArrowUp, brk = keys.KeyS || keys.ArrowDown, st = ((keys.KeyA || keys.ArrowLeft) ? 1 : 0) - ((keys.KeyD || keys.ArrowRight) ? 1 : 0);
    if (thr) j.speed += 16 * Math.max(0.08, 1 - j.speed / 28) * dt; else if (brk) j.speed -= (j.speed > 0 ? 20 : 6) * dt;
    j.speed = Math.max(j.speed, -6); j.steer += (st - j.steer) * Math.min(1, dt * 6);
    j.h += j.steer * 1.8 * clamp(Math.abs(j.speed) / 5, 0.15, 1) * (j.speed >= 0 ? 1 : -1) * dt;
  } else j.steer *= Math.exp(-3 * dt);
  j.speed *= Math.exp(-(driven && (keys.KeyW || keys.ArrowUp) ? 0.1 : 0.55) * dt);
  const f = fwdOf(j.h), jx0 = j.x, jz0 = j.z; j.x += f.x * j.speed * dt; j.z += f.z * j.speed * dt;
  if (!jetWater(j.x, j.z) || !jetWater(j.x + f.x * 1.2, j.z + f.z * 1.2)) { j.x = jx0; j.z = jz0; j.speed *= -0.3; }
  j.x = clamp(j.x, -BOUND_X, BOUND_X); j.z = clamp(j.z, -BOUND_Z, BOUND_Z);
  const r = { x: -f.z, z: f.x };
  const hy = waveH(j.x, j.z, T), hf = waveH(j.x + f.x * 1.3, j.z + f.z * 1.3, T), hb = waveH(j.x - f.x * 1.3, j.z - f.z * 1.3, T), hr = waveH(j.x + r.x * 0.5, j.z + r.z * 0.5, T), hl = waveH(j.x - r.x * 0.5, j.z - r.z * 0.5, T);
  const tp = Math.atan2(hf - hb, 2.6) + clamp(j.speed, 0, 28) * 0.004, tr = Math.atan2(hr - hl, 1.0) + j.steer * j.speed * 0.012;
  j.pitch += (tp - j.pitch) * Math.min(1, dt * 8); j.roll += (tr - j.roll) * Math.min(1, dt * 8);
  { // altura: segue a onda, mas decola nas cristas em alta velocidade
    const base = hy + 0.1, vg = clamp((base - (j.b0 ?? base)) / Math.max(dt, 1e-3), -30, 30); j.b0 = base;
    if (!j.air) { if ((j.vyG || 0) - vg > 0.7 && Math.abs(j.speed) > 13) { j.air = true; j.vy = j.vyG + 1.2; } else { j.y = base; j.vyG = (j.vyG || 0) + (vg - (j.vyG || 0)) * Math.min(1, dt * 12); } }
    if (j.air) {
      j.vy -= 15 * dt; j.y += j.vy * dt; j.pitch += (clamp(j.vy * 0.05, -0.4, 0.4) - j.pitch) * Math.min(1, dt * 4);
      if (j.y <= base) { const imp = vg - j.vy; j.y = base; j.air = false; j.vyG = vg; if (imp > 2) { puff(j.x, base + 0.3, j.z, Math.min(16, 6 + imp * 2 | 0), 0xe6f7ff, 4, 0.8, 0.3, 7, 3); sfx('hit', j.x, j.z); j.speed *= 0.95; if (driven) shake = Math.max(shake, Math.min(0.3, imp * 0.04)); } }
    }
  }
  j.mesh.position.set(j.x, j.y, j.z); j.mesh.rotation.set(j.pitch, j.h, j.roll);
  if (Math.abs(j.speed) > 3 && Math.random() < dt * 40) puff(j.x - f.x * 1.2 + rand(-0.3, 0.3), j.y + 0.2, j.z - f.z * 1.2 + rand(-0.3, 0.3), 2, 0xe6f7ff, 2.4, 0.7, 0.2, 5, 1.6);
}
function enterJet(j) {
  player.onJet = j; j.rider = true; player.swim = false; player.vx = player.vz = player.vy = 0; camYaw = j.h; camPitch = 0.22;
  if (engineGain) engineGain.gain.value = 0.05; toast('Jet ski! W acelera, A/D vira');
}
function exitJet() {
  const j = player.onJet; if (!j) return;
  player.onJet = null; j.rider = false; j.speed *= 0.3;
  let landed = false;
  for (let r = 3; r <= 9 && !landed; r += 2) for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283, x = j.x + Math.cos(a) * r, z = j.z + Math.sin(a) * r; if (terrainH(x, z) > 0.2 && walkable(x, z) && !insideBuilding(x, z, 1)) { player.x = x; player.z = z; player.y = groundH(x, z); landed = true; break; } }
  if (!landed) { const f = fwdOf(j.h); player.x = j.x - f.z * 1.8; player.z = j.z + f.x * 1.8; player.y = groundH(player.x, player.z); }
  player.parts.legL.rotation.x = player.parts.legR.rotation.x = 0; player.mesh.rotation.x = 0;
  if (engineGain) engineGain.gain.value = 0;
}
const nearestJet = (range) => { let b = null, bd = range; for (const j of jets) { if (j.rider) continue; const d = Math.hypot(j.x - player.x, j.z - player.z); if (d < bd) { bd = d; b = j; } } return b; };
function syncPlayerOnJet(dt) {
  const j = player.onJet, f = fwdOf(j.h);
  updateJet(j, dt, true);
  player.x = j.x; player.z = j.z; player.y = j.y; player.mx = player.mz = 0; player.h = j.h; player.swim = false;
  player.mesh.position.set(j.x - f.x * 0.4, j.y + 0.02, j.z - f.z * 0.4); player.mesh.rotation.set(j.pitch * 0.7, j.h, j.roll * 0.6);
  const p = player.parts; p.legL.rotation.x = p.legR.rotation.x = 1.3; p.armL.rotation.x = 1.25;
  player.aim = Math.max(0, player.aim - dt); if (mouseDown) player.aim = 0.8;
  p.armR.rotation.x = player.aim > 0 ? Math.PI / 2 : 1.25;
  player.mesh.updateMatrixWorld(true);
  if (mouseDown && isFire() && T >= nextShot && state === 'play') { nextShot = T + WEAP[weapon].rate; fire(); }
  if (engineGain) { engineOsc.frequency.value = 60 + Math.abs(j.speed) * 5; engineGain.gain.value = muted ? 0 : 0.04 + Math.abs(j.speed) * 0.0013; }
}

/* ---------------- explosões ---------------- */
function explode(x, z, radius, dmg, byPlayer) {
  fireball(x, 1.2, z, radius * 0.55);
  puff(x, 1, z, 26, 0xff8a1a, 9, 0.9, 1.2, 4, 3); puff(x, 1, z, 14, 0xffe066, 7, 0.6, 0.8, 4, 3); puff(x, 1, z, 14, 0x222222, 5, 1.8, 1.8, -1, 3);
  sfx('boom', x, z);
  const d0 = Math.hypot(x - player.x, z - player.z); shake = Math.max(shake, clamp(1 - d0 / 70, 0, 1) * 1.0);
  for (const c of chars) {
    if (!c.alive || c.inCar) continue;
    const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz); if (d > radius) continue;
    const k = 1 - d / radius; damageChar(c, dmg * k + 10, byPlayer, dx / (d || 1) * 14 * k, dz / (d || 1) * 14 * k); c.vy = 7 * k + 2; c.stun = 1.5;
  }
  for (const o of cars) {
    if (Math.hypot(o.x - x, o.z - z) < radius && o.mode !== 'wreck' && (o.x !== x || o.z !== z)) { if (byPlayer) o.lastPlayer = true; damageCar(o, dmg * 0.8, byPlayer); }
  }
  for (const p of props) {
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz); if (d > radius * 1.3 || d < 0.01) continue;
    const k = 1 - d / (radius * 1.3); if (!p.fixed) { p.vx += dx / d * 16 * k; p.vz += dz / d * 16 * k; p.vy = 6 + 6 * k; }
    if ((p.kind === 'barrel' || p.kind === 'pump' || p.kind === 'case') && !p.dead) { if (byPlayer) p.byP = true; p.hp -= 200; setTimeout(() => killProp(p, p.byP), 120 + Math.random() * 200); }
  }
  panic(x, z, 60, 8);
  if (byPlayer && d0 < 100) addHeat(2);
}

/* ---------------- props (objetos do mapa) ---------------- */
const PK = {
  crate: { r: 0.75, h: 1, mass: 2.2, bounce: 0.25, geo: () => geoBox(1, 1, 1), col: [0xb5803c, 0xa06a2c] },
  barrel: { r: 0.45, h: 1.1, mass: 1.6, bounce: 0.2, geo: () => new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10), col: [0xd62828] },
  cone: { r: 0.32, h: 0.7, mass: 0.6, bounce: 0.3, geo: () => new THREE.ConeGeometry(0.3, 0.7, 8), col: [0xff7a1a] },
  ball: { r: 0.5, h: 1.0, mass: 0.45, bounce: 0.78, geo: () => new THREE.SphereGeometry(0.5, 12, 10), col: [0xffffff, 0xff4d4d, 0x4dd0ff, 0xffd23f] },
  pump: { r: 0.7, h: 1.7, mass: 999, bounce: 0, geo: () => geoBox(0.8, 1.7, 0.6), col: [0xd62828], fixed: true },
  case: { r: 0.95, h: 1.3, mass: 999, bounce: 0, geo: () => geoBox(1.8, 0.8, 0.9), col: [0x2b2438], fixed: true },
  bin: { r: 0.42, h: 0.95, mass: 1.0, bounce: 0.2, geo: () => new THREE.CylinderGeometry(0.4, 0.34, 0.95, 8), col: [0x5f6770, 0x3f8f5f] }
};
function addProp(kind, x, z) {
  const k = PK[kind];
  let m;
  if (kind === 'case') {
    m = new THREE.Group(); mesh(geoBox(1.8, 0.8, 0.9), lam(0x2b2438), 0, 0.4, 0, m);
    mesh(geoBox(1.74, 0.5, 0.84), new THREE.MeshStandardMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.3 }), 0, 1.05, 0, m, false);
    for (let i = 0; i < 4; i++) mesh(new THREE.OctahedronGeometry(0.11), lam(choice([0xff3b6b, 0x3bd0ff, 0xffe24a, 0xffffff]), { emissive: 0x333333, metalness: 0.6, roughness: 0.1 }), (i - 1.5) * 0.4, 0.93, 0, m, false);
    scene.add(m);
  } else {
    m = new THREE.Mesh(k.geo(), lam(choice(k.col))); m.castShadow = true; scene.add(m);
    if (kind === 'barrel') mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.14, 10), lam(0xf5f5f5), 0, 0.15, 0, m, false);
    if (kind === 'pump') { mesh(geoBox(0.6, 0.5, 0.05), lam(0xdff6ff, { emissive: 0x7fb6d6 }), 0, 0.3, -0.31, m, false); mesh(geoBox(0.86, 0.1, 0.66), lam(0x222222), 0, 0.85, 0, m); }
  }
  const p = { kind, x, z, y: 0, vx: 0, vz: 0, vy: 0, r: k.r, h: k.h, mass: k.mass, bounce: k.bounce, mesh: m, hp: kind === 'barrel' ? 60 : kind === 'pump' ? 90 : kind === 'case' ? 40 : 9999, spin: 0, dead: false, byP: false, fixed: !!k.fixed };
  if (p.fixed) { const gy = groundH(x, z); m.position.set(x, gy + (kind === 'case' ? 0 : k.h / 2), z); p.st = addStatic(x, z, k.r * 0.9); }
  props.push(p); return p;
}
function killProp(p, byPlayer) {
  if (p.dead) return; p.dead = true; scene.remove(p.mesh); const i = props.indexOf(p); if (i >= 0) props.splice(i, 1);
  if (p.st) removeStatic(p.st);
  if (p.kind === 'case') { puff(p.x, 1, p.z, 16, 0xbfe9ff, 4, 0.8, 0.14, 9, 2); addCash(p.x, p.z, 600, 0); if (byPlayer) addHeat(1.5); sfx('hit', p.x, p.z); return; }
  explode(p.x, p.z, p.kind === 'pump' ? 10 : 8, p.kind === 'pump' ? 90 : 75, byPlayer);
}
for (let i = 0; i < 140; i++) {
  const kind = choice(['crate', 'crate', 'barrel', 'barrel', 'cone', 'cone', 'cone', 'bin']), sp = choice(walkSpots.city);
  if (sp && Math.hypot(sp.x - START.x, sp.z - START.z) > 8 && !insideBuilding(sp.x, sp.z, 0.5)) addProp(kind, sp.x + rand(-1, 1), sp.z + rand(-1, 1));
}
for (let i = 0; i < 26; i++) { const sp = choice(walkSpots.beach); if (sp) addProp('ball', sp.x, sp.z); }
for (let i = 0; i < 16; i++) { const sp = choice(walkSpots.beach); if (sp) addProp('crate', sp.x, sp.z); }
for (let i = 0; i < 24; i++) { const sp = choice(walkSpots.rural); if (sp) addProp(choice(['crate', 'barrel', 'crate']), sp.x, sp.z); }
// pirâmide de caixas perto do início
for (const [dz, dy] of [[0, 0], [1.1, 0], [0.55, 1]]) { const p = addProp('crate', START.x + 4, START.z + 16 + dz); p.y = URBAN_H + dy; }
addProp('barrel', START.x + 4, START.z + 21); addProp('barrel', START.x + 4, START.z + 22.2); addProp('ball', START.x + 2, START.z + 6);

function updateProps(dt) {
  const PP = pursuit();
  for (let pi = props.length - 1; pi >= 0; pi--) {
    const p = props[pi];
    if (p.hp <= 0 && !p.dead) { killProp(p, p.byP); continue; }
    const pd2 = (p.x - PP.x) ** 2 + (p.z - PP.z) ** 2;
    if (p.fixed) { p.mesh.visible = pd2 < 400 * 400; continue; }
    p.mesh.visible = pd2 < 300 * 300;
    if (pd2 > 260 * 260 && p.vx * p.vx + p.vz * p.vz < 0.01 && p.vy === 0) continue;
    const g = groundH(p.x, p.z);
    p.vy -= 24 * dt; p.y += p.vy * dt;
    if (p.y < g) { p.y = g; if (p.vy < -2.5) p.vy = -p.vy * p.bounce; else p.vy = 0; }
    const air = p.y > g + 0.02, moving = p.vx * p.vx + p.vz * p.vz > 0.01;
    if (moving || air) {
      p.x += p.vx * dt; p.z += p.vz * dt;
      if (!air) { const f = Math.exp(-(p.kind === 'ball' ? 0.5 : 2.6) * dt); p.vx *= f; p.vz *= f; }
      if (!walkable(p.x, p.z)) { p.x -= p.vx * dt; p.z -= p.vz * dt; p.vx *= -0.4; p.vz *= -0.4; }
      const n = collideStatic(p, p.r);
      if (n) { const vn = p.vx * n.nx + p.vz * n.nz; if (vn < 0) { p.vx -= 1.5 * vn * n.nx; p.vz -= 1.5 * vn * n.nz; } }
      if (p.kind === 'ball') { p.mesh.rotation.x += p.vz * dt / p.r; p.mesh.rotation.z -= p.vx * dt / p.r; }
      else if (air) { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.z += p.spin * 0.6 * dt; }
      else { p.mesh.rotation.x *= Math.exp(-6 * dt); p.mesh.rotation.z *= Math.exp(-6 * dt); }
    }
    p.mesh.position.set(p.x, p.y + (p.kind === 'ball' ? p.r : p.h / 2), p.z);
    // personagens empurram
    if (pd2 > 90 * 90) continue;
    for (const c of chars) {
      if (!c.alive || c.inCar) continue;
      const dx = p.x - c.x, dz = p.z - c.z, rr = p.r + 0.4; if (dx > rr || dx < -rr || dz > rr || dz < -rr) continue;
      const d = Math.hypot(dx, dz) || 0.01; if (d >= rr || p.y > c.y + 1.6) continue;
      const nx = dx / d, nz = dz / d, push = Math.max(0, c.mx * nx + c.mz * nz);
      p.x += nx * (rr - d); p.z += nz * (rr - d); p.vx += nx * push * 0.9 / p.mass; p.vz += nz * push * 0.9 / p.mass; p.spin = rand(-4, 4);
    }
    // carros empurram
    for (const c of cars) {
      if (Math.abs(c.speed) < 1.2 || c.mode === 'wreck') continue;
      if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 > (c.V.L / 2 + 3) ** 2) continue;
      for (const q of carCircles(c)) {
        const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
        if (d < q.r + p.r) {
          const f = fwdOf(c.h), sp = c.speed;
          p.vx = f.x * sp * 1.1 + dx / (d || 1) * 2; p.vz = f.z * sp * 1.1 + dz / (d || 1) * 2; p.vy = Math.max(p.vy, 2 + Math.abs(sp) * 0.15); p.spin = rand(-8, 8);
          p.x = q.x + dx / (d || 1) * (q.r + 0.05 + p.r);  p.z = q.z + dz / (d || 1) * (q.r + 0.05 + p.r);
          if (p.kind === 'barrel' && Math.abs(sp) > 9) { p.hp -= 70; if (c.mode === 'player' || c.lastPlayer) p.byP = true; }
          sfx('hit', p.x, p.z); break;
        }
      }
    }
  }
}

/* ---------------- dano / crime / polícia ---------------- */
function addHeat(v) { heat = clamp(heat + v, 0, 22); }
const stars = () => (heat <= 0 ? 0 : Math.min(5, 1 + Math.floor(heat / 4)));
function panic(x, z, radius, t) {
  for (const c of chars) if (c.type === 'npc' && c.alive && (c.x - x) ** 2 + (c.z - z) ** 2 < radius * radius) { c.flee = Math.max(c.flee, t * rand(0.7, 1.2)); c.fx = x; c.fz = z; }
}
function damageChar(c, dmg, byPlayer, kx = 0, kz = 0) {
  c.vx += kx; c.vz += kz;
  if (!c.alive) return;
  c.hp -= dmg; hitFlash(c);
  if (c.type === 'npc') { c.flee = 6; c.fx = player.x; c.fz = player.z; if (byPlayer && c.model !== 'cow') addHeat(1.5); }
  if (c.type === 'cop' && byPlayer) addHeat(4);
  if (c.type === 'player') { hurtT = 0.4; $('hurt').style.opacity = 1; if (c.hp <= 0) killPlayer(); return; }
  if (c.hp <= 0) {
    c.alive = false; c.deadT = 0; c.stun = 0;
    if (byPlayer) { if (c.type === 'cop') { addHeat(6); toast('POLICIAL DERRUBADO!'); } else if (c.model !== 'cow') addHeat(2.5); }
    puff(c.x, 1, c.z, 8, 0xffffff, 3, 0.6, 0.25, 6);
    if (c.role) { if (byPlayer) addCash(c.x, c.z, Math.round(c.door.cash * 0.2), 0); }
    else if (c.type === 'cop') addCash(c.x, c.z, Math.round(rand(60, 140)), 30);
    else if (c.type === 'npc' && c.model !== 'cow') addCash(c.x, c.z, Math.round(rand(15, 90)), 30);
  }
}
function hitFlash(c) { puff(c.x, 1.2, c.z, 4, 0xffee88, 2.5, 0.35, 0.18, 6); }
function hurtPlayer(d) { damageChar(player, d, false); }

let spawnCopT = 0, calmT = 0;
function copLook() { return { shirt: 0x2459c4, pants: 0x14234d, skin: choice(skins), hat: 0x0d1630, badge: true, vest: 0x161c2a, gun: true, hp: 100 }; }
function spawnCop() {
  const P = pursuit();
  for (let t = 0; t < 30; t++) {
    const sp = roadSpots[(Math.random() * roadSpots.length) | 0], p = pointOnEdge(sp.e, sp.s), d = Math.hypot(p.x - P.x, p.z - P.z);
    if (d < 55 || d > 120) continue;
    const c = newChar('cop', p.x + rand(-3, 3), p.z + rand(-3, 3), copLook()); c.maxhp = 100; return;
  }
}
function spawnCopCar() {
  const P = pursuit();
  for (let t = 0; t < 30; t++) {
    const sp = roadSpots[(Math.random() * roadSpots.length) | 0], dir = Math.random() < 0.5 ? 1 : -1, tmp = {}; placeOnEdge(tmp, sp.e, sp.s, dir);
    const d = Math.hypot(tmp.x - P.x, tmp.z - P.z); if (d < 70 || d > 170) continue;
    const c = newCar(tmp.x, tmp.z, tmp.h, 'chase', true); c.driver = 'cop'; placeOnEdge(c, sp.e, sp.s, dir); c.speed = 8; return;
  }
}
function updatePolice(dt) {
  const s = stars();
  const footWant = s === 0 ? 0 : [0, 2, 3, 4, 5, 6][s], carWant = [0, 0, 1, 1, 2, 2][s];
  const cops = chars.filter(c => c.type === 'cop' && c.alive), copCars = cars.filter(c => c.cop && c.mode === 'chase');
  spawnCopT -= dt;
  if (s > 0 && spawnCopT <= 0 && state === 'play') {
    spawnCopT = 1.6;
    if (copCars.length < carWant) spawnCopCar(); else if (cops.length < footWant) spawnCop();
  }
  // esfria quando está longe
  let near = 1e9; const PP = pursuit();
  for (const c of cops) near = Math.min(near, Math.hypot(c.x - PP.x, c.z - PP.z));
  for (const c of copCars) near = Math.min(near, Math.hypot(c.x - PP.x, c.z - PP.z));
  if (near < 55 || heat <= 0) calmT = 0; else calmT += dt;
  if (heat > 0 && calmT > 12) { heat = Math.max(0, heat - dt * 0.5); if (heat === 0) toast('Você despistou a polícia!'); }
  // viaturas desembarcam policiais
  for (const c of copCars) {
    if (c.cargo > 0 && Math.hypot(c.x - player.x, c.z - player.z) < 24 && Math.abs(c.speed) < 14) {
      c.deployT += dt;
      if (c.deployT > 1.2) { c.cargo = 0; const f = fwdOf(c.h); for (const sd of [-1, 1]) { const k = newChar('cop', c.x - f.z * 2.4 * sd, c.z + f.x * 2.4 * sd, copLook()); k.maxhp = 100; } }
    }
  }
  if (heat <= 0) {
    for (const c of cars.slice()) {
      if (!c.cop || c.mode === 'player' || c.mode === 'wreck' || c.mode === 'parked') continue;
      c.mode = 'traffic'; c.leaveT = (c.leaveT || 0) + dt;
      if (c.leaveT > 5 && Math.hypot(c.x - player.x, c.z - player.z) > 60) removeCar(c);
    }
  }
  // sirene
  if (sirenGain) {
    let d = 1e9; for (const c of copCars) d = Math.min(d, Math.hypot(c.x - player.x, c.z - player.z));
    sirenGain.gain.value = muted || heat <= 0 ? 0 : clamp(1 - d / 120, 0, 1) * 0.05;
    sirenOsc.frequency.value = 700 + Math.sin(T * 7) * 200;
  }
}

/* ---------------- IA das pessoas ---------------- */
function moveChar(c, wx, wz, dt) {
  c.mx = wx + c.vx; c.mz = wz + c.vz;
  const ox = c.x, oz = c.z, isP = c.type === 'player';
  c.x += c.mx * dt; c.z += c.mz * dt;
  const f = Math.exp(-5 * dt); c.vx *= f; c.vz *= f;
  if (!isP && !walkable(c.x, c.z)) { if (walkable(c.x, oz)) c.z = oz; else if (walkable(ox, c.z)) c.x = ox; else { c.x = ox; c.z = oz; } c.blocked++; }
  const g = groundH(c.x, c.z), swim = isP && inWater(c.x, c.z);
  if (swim !== !!c.swim && swim) { puff(c.x, g + 0.8, c.z, 12, 0xe8f6ff, 3, 0.7, 0.3, 8, 3); sfx('hit', c.x, c.z); }
  c.swim = swim;
  if (swim) { c.y += (g - c.y) * Math.min(1, dt * 7); c.vy = 0; }
  else { c.vy -= 24 * dt; c.y += c.vy * dt; if (c.y < g) { c.y = g; c.vy = 0; } else if (c.vy <= 0.1 && c.y - g < 0.45) { c.y = g; c.vy = 0; } }
  const n = collideStatic(c, 0.38); c.blocked = n ? c.blocked + 1 : Math.max(0, c.blocked - 1);
  for (const car of cars) {
    if (Math.abs(car.x - c.x) > car.V.L / 2 + 3 || Math.abs(car.z - c.z) > car.V.L / 2 + 3) continue;
    for (const q of carCircles(car)) {
      const dx = c.x - q.x, dz = c.z - q.z, d2 = dx * dx + dz * dz, rr = q.r + 0.38;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01; c.x = q.x + dx / d * rr; c.z = q.z + dz / d * rr; }
    }
  }
}
function newTarget(c) {
  for (let t = 0; t < 14; t++) {
    const a = rand(0, 6.28), r = rand(8, 30), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (!walkable(x, z) || insideBuilding(x, z, 1.5) || Math.abs(terrainH(x, z) - terrainH(c.x, c.z)) > 3) continue;
    if (c.zone === 'beach' && !inBeach(x, z)) continue;
    if (c.zone === 'city' && urbanW(x, z) < 0.25) continue;
    c.tgt = { x, z }; return;
  }
  c.tgt = { x: c.x, z: c.z };
}
function deadPose(c, dt) {
  c.deadT += dt;
  c.mesh.rotation.x += (-Math.PI / 2 - c.mesh.rotation.x) * Math.min(1, dt * 8);
  c.parts.legL.rotation.x = c.parts.legR.rotation.x = c.parts.armL.rotation.x = c.parts.armR.rotation.x = 0.2;
  moveChar(c, 0, 0, dt);
  c.mesh.position.set(c.x, c.y + 0.18, c.z); c.mesh.rotation.y = c.h;
}
function animHuman(c, dt) {
  const p = c.parts, spd = Math.hypot(c.mx, c.mz);
  c.walkT += dt * (3 + spd * 1.5);
  const s = Math.sin(c.walkT) * Math.min(1, spd / 2.5) * 0.9;
  p.legL.rotation.x = s; p.legR.rotation.x = -s; p.armL.rotation.x = -s * 0.8;
  p.armR.rotation.x = c.armed ? (c.aim > 0 ? Math.PI / 2 : 0.5 + s * 0.2) : s * 0.8;
  if (c.handsUp) p.armL.rotation.x = p.armR.rotation.x = 3.0;
  c.atkYaw = 0;
  if (c === player) { if (player.atk) meleePose(player); else if (weapon === 'fist') { p.armL.rotation.x = 0.85 + s * 0.1; p.armR.rotation.x = 0.85 - s * 0.1; } else if (weapon === 'bat') p.armR.rotation.x = 0.75 + s * 0.15; }
  if (c.swim) {
    const st = Math.sin(c.walkT * 0.9), mv = Math.min(1, spd / 2);
    p.armL.rotation.x = 2.5 + st * 0.9 * mv; p.armR.rotation.x = 2.5 - st * 0.9 * mv; p.legL.rotation.x = st * 0.3 * mv; p.legR.rotation.x = -st * 0.3 * mv;
    c.mesh.rotation.x += (-(0.35 + 0.8 * mv) - c.mesh.rotation.x) * Math.min(1, dt * 6);
    c.mesh.position.set(c.x, c.y + 0.35, c.z); c.mesh.rotation.y = c.h;
    if (mv > 0.3 && Math.random() < dt * 14) puff(c.x - Math.sin(c.h) * 0.2, c.y + 0.75, c.z - Math.cos(c.h) * 0.2, 1, 0xe8f6ff, 1.2, 0.5, 0.2, 6, 1.5);
    return;
  }
  c.mesh.position.set(c.x, c.y, c.z); c.mesh.rotation.y = c.h + (c.atkYaw || 0);
  c.mesh.rotation.x += (0 - c.mesh.rotation.x) * Math.min(1, dt * 10);
}
function updateNPC(c, dt) {
  if (c.role) c.robbed = Math.max(0, c.robbed - dt);
  if (!c.alive) {
    deadPose(c, dt);
    if (c.role && c.deadT > 60) { Object.assign(c, { alive: true, hp: c.maxhp, x: c.post.x, z: c.post.z, vx: 0, vz: 0, flee: 0, stun: 0, mx: 0, mz: 0 }); c.mesh.rotation.x = 0; }
    else if (!c.role && c.deadT > 10) { const sp = pickSpot(c.zone === 'inside' ? 'city' : c.zone); Object.assign(c, { alive: true, hp: c.maxhp, x: sp.x, z: sp.z, vx: 0, vz: 0, flee: 0, stun: 0, tgt: null, mx: 0, mz: 0 }); c.mesh.rotation.x = 0; }
    return;
  }
  if (c.stun > 0) { c.stun -= dt; moveChar(c, 0, 0, dt); c.mesh.position.set(c.x, c.y, c.z); c.mesh.rotation.x = Math.min(0.8, c.stun) * -0.7; return; }
  // carro vindo veloz
  const pc = player.inCar;
  if (pc && Math.abs(pc.speed) > 6 && (pc.x - c.x) ** 2 + (pc.z - c.z) ** 2 < 100) { c.flee = Math.max(c.flee, 2); c.fx = pc.x; c.fz = pc.z; }
  c.flee = Math.max(0, c.flee - dt);
  let wx = 0, wz = 0;
  if (c.flee > 0) {
    const dx = c.x - c.fx, dz = c.z - c.fz, d = Math.hypot(dx, dz) || 1;
    let ux = dx / d, uz = dz / d;
    if (c.blocked > 3) { const t = ux; ux = -uz; uz = t; }
    const fsp = c.model === 'cow' ? 4.2 : 6.2; wx = ux * fsp; wz = uz * fsp; c.h += wrap(headingTo(ux, uz) - c.h) * Math.min(1, dt * 10); c.handsUp = false;
  } else if (c.role) {
    const pl = player.inside === c.door, dx = c.post.x - c.x, dz = c.post.z - c.z, d = Math.hypot(dx, dz);
    if (d > 0.5) { wx = dx / d * 2; wz = dz / d * 2; c.h += wrap(headingTo(dx, dz) - c.h) * Math.min(1, dt * 6); }
    else { const tx = pl ? player.x : c.door.fx, tz = pl ? player.z : c.door.fz; c.h += wrap(headingTo(tx - c.x, tz - c.z) - c.h) * Math.min(1, dt * 3); }
    c.handsUp = pl && ((player.aim > 0 && Math.hypot(player.x - c.x, player.z - c.z) < 11) || (robbing && robbing.w === c));
  } else {
    if (c.wait > 0) c.wait -= dt;
    else {
      c.repath -= dt;
      if (!c.tgt || c.repath <= 0 || c.blocked > 25) { newTarget(c); c.repath = rand(6, 14); c.blocked = 0; if (Math.random() < 0.3) c.wait = rand(1, 3); }
      const dx = c.tgt.x - c.x, dz = c.tgt.z - c.z, d = Math.hypot(dx, dz);
      if (d < 1.2) { c.tgt = null; c.wait = rand(0.5, 2.5); }
      else { const wsp = c.model === 'cow' ? 0.9 : 1.7; wx = dx / d * wsp; wz = dz / d * wsp; c.h += wrap(headingTo(dx, dz) - c.h) * Math.min(1, dt * 6); }
    }
  }
  moveChar(c, wx, wz, dt); animHuman(c, dt);
}
function updateCop(c, dt) {
  if (!c.alive) { deadPose(c, dt); if (c.deadT > 6) { freeGeo(c.mesh); scene.remove(c.mesh); chars.splice(chars.indexOf(c), 1); } return; }
  if (c.stun > 0) { c.stun -= dt; moveChar(c, 0, 0, dt); c.mesh.position.set(c.x, c.y, c.z); c.mesh.rotation.x = Math.min(0.8, c.stun) * -0.7; return; }
  const tgt = pursuit(), dx = tgt.x - c.x, dz = tgt.z - c.z, d = Math.hypot(dx, dz);
  let wx = 0, wz = 0;
  if (heat <= 0) {
    c.leaveT += dt; if (c.leaveT > 7 && d > 45) { freeGeo(c.mesh); scene.remove(c.mesh); chars.splice(chars.indexOf(c), 1); return; }
    wx = Math.sign(-dx || 1) * 2; wz = Math.sign(-dz || 1) * 2; c.aim = 0;
  } else {
    c.leaveT = 0; c.shootCd -= dt; c.aim = Math.max(0, c.aim - dt);
    const los = d < 45 && !segBlocked(c.x, c.z, tgt.x, tgt.z);
    let ux = dx / (d || 1), uz = dz / (d || 1);
    if (!los || d > 15) {
      if (c.blocked > 6 && c.detour <= 0) { c.detour = 1.2; const s = Math.random() < .5 ? 1 : -1; c.dvx = -uz * s; c.dvz = ux * s; }
      if (c.detour > 0) { c.detour -= dt; ux = c.dvx; uz = c.dvz; }
      wx = ux * 5.6; wz = uz * 5.6;
    } else if (d < 6) { wx = -ux * 2.5; wz = -uz * 2.5; }
    else { const s = c.dvx || 1; wx = -uz * s * 1.6; wz = ux * s * 1.6; if (Math.random() < dt * 0.4) c.dvx = -s; }
    c.h += wrap(headingTo(dx, dz) - c.h) * Math.min(1, dt * 9);
    if (los && d < 32 && c.shootCd <= 0 && !player.inside) {
      c.shootCd = rand(1.1, 2.0); c.aim = 0.7;
      c.mesh.updateMatrixWorld(true); const mp = new THREE.Vector3(); c.parts.muzzle.getWorldPosition(mp);
      const ty = player.inCar ? 1.0 : player.y + 1.1, sp = 0.09 + d * 0.006;
      const dir = new THREE.Vector3(tgt.x - mp.x + rand(-1, 1) * sp * d * 0.5, ty - mp.y + rand(-0.4, 0.4), tgt.z - mp.z + rand(-1, 1) * sp * d * 0.5).normalize();
      spawnBullet(mp, dir, 70, 'cop', 5); sfx('shot', c.x, c.z);
    }
  }
  moveChar(c, wx, wz, dt); animHuman(c, dt);
}

function separateChars() {
  for (let i = 0; i < chars.length; i++) {
    const a = chars[i]; if (!a.alive || a.inCar) continue;
    for (let j = i + 1; j < chars.length; j++) {
      const b = chars[j]; if (!b.alive || b.inCar) continue;
      const dx = b.x - a.x, dz = b.z - a.z; if (dx > 0.85 || dx < -0.85 || dz > 0.85 || dz < -0.85) continue;
      const d2 = dx * dx + dz * dz; if (d2 >= 0.7225 || Math.abs(a.y - b.y) > 1.4) continue;
      const d = Math.sqrt(d2) || 0.01, pen = (0.85 - d) * 0.5, nx = dx / d, nz = dz / d;
      const wa = a.type === 'player' ? 0.2 : 1, wb = b.type === 'player' ? 0.2 : 1, tot = wa + wb;
      a.x -= nx * pen * 2 * wa / tot; a.z -= nz * pen * 2 * wa / tot; b.x += nx * pen * 2 * wb / tot; b.z += nz * pen * 2 * wb / tot;
    }
  }
}

/* ---------------- balas ---------------- */
const bulletGeo = geoBox(0.07, 0.07, 1.1);
const bulletMats = { player: new THREE.MeshBasicMaterial({ color: 0xfff08a }), cop: new THREE.MeshBasicMaterial({ color: 0xff7a5a }), remote: new THREE.MeshBasicMaterial({ color: 0x9fe8ff }) };
function spawnBullet(pos, dir, speed, owner, dmg) {
  const m = new THREE.Mesh(bulletGeo, bulletMats[owner]); m.position.copy(pos); m.lookAt(pos.clone().add(dir)); scene.add(m);
  bullets.push({ m, p: pos.clone(), d: dir.clone(), speed, owner, dmg, life: 1.6 });
}
function hitTest(x, y, z, owner) {
  if (owner === 'player' && MP.on) for (const rp of MP.players.values()) { if (!rp.st || rp.st.v || !(rp.st.f & 8)) continue; const dx = x - rp.x, dz = z - rp.z; if (dx * dx + dz * dz < 0.25 && y > rp.y && y < rp.y + 1.85) return { k: 'remote', o: rp }; }
  if (y < surfaceY(x, z) + 0.03) return { k: 'ground' };
  { const wb = boxAt(x, z, 0, b => y < b.h && y > b.y0 - 0.5); if (wb) return { k: 'wall', o: wb }; }
  for (const c of chars) {
    if (!c.alive || c.inCar) continue; if (owner === 'cop' && c.type === 'cop') continue; if (owner === 'player' && c.type === 'player') continue;
    const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < 0.25 && y > c.y && y < c.y + 1.85) return { k: 'char', o: c };
  }
  for (const c of cars) {
    const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz > (c.V.L / 2 + 2) ** 2) continue;
    const f = fwdOf(c.h), lz = dx * f.x + dz * f.z, lx = dx * -f.z + dz * f.x;
    if (Math.abs(lx) < c.V.hw + 0.1 && Math.abs(lz) < c.V.L / 2 && y - c.y < (c.isMoto ? 1.9 : c.V.tall ? 3.4 : 1.8) && y > c.y + 0.1) return { k: 'car', o: c };
  }
  for (const p of props) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < p.r * p.r && y > p.y && y < p.y + p.h) return { k: 'prop', o: p }; }
  return null;
}
function killBullet(i) { scene.remove(bullets[i].m); bullets.splice(i, 1); }
function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.life -= dt; if (b.life <= 0) { killBullet(i); continue; }
    const total = b.speed * dt, steps = Math.ceil(total / 0.6), sd = total / steps; let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      b.p.addScaledVector(b.d, sd);
      const h = hitTest(b.p.x, b.p.y, b.p.z, b.owner); if (!h) continue;
      dead = true;
      if (h.k === 'remote') { puff(b.p.x, b.p.y, b.p.z, 5, 0xffee88, 2.5, 0.35, 0.18, 6); sfx('hit', b.p.x, b.p.z); }
      else if (h.k === 'ground' || h.k === 'wall') puff(b.p.x, b.p.y, b.p.z, 5, h.k === 'ground' && inWater(b.p.x, b.p.z) ? 0xcdeeff : 0xe6dcb0, 2.5, 0.35, 0.14, 8);
      else if (h.k === 'char') { if (b.from && h.o === player) MP.lastHit = { id: b.from, t: T }; const byP = b.owner === 'player'; damageChar(h.o, b.dmg, byP, b.d.x * 3, b.d.z * 3); sfx('hit', h.o.x, h.o.z); if (byP && h.o.type === 'npc') panic(h.o.x, h.o.z, 20, 5); }
      else if (h.k === 'car') {
        const byP = b.owner === 'player'; puff(b.p.x, b.p.y, b.p.z, 6, 0xffc040, 3.5, 0.4, 0.15, 8);
        if (h.o === player.inCar) { damageCar(h.o, b.dmg * 1.4, false); hurtPlayer(b.dmg * 0.3); }
        else { damageCar(h.o, b.dmg, byP); if (byP) { if (h.o.driver === 'npc') addHeat(0.6); if (h.o.cop) addHeat(1); } }
      } else if (h.k === 'prop') {
        const p = h.o; p.vx += b.d.x * 4 / p.mass; p.vz += b.d.z * 4 / p.mass; p.vy = Math.max(p.vy, 2); p.spin = rand(-6, 6);
        if (p.kind === 'barrel' || p.kind === 'pump' || p.kind === 'case') { if (b.owner === 'player') p.byP = true; p.hp -= b.dmg * 1.3; if (p.hp <= 0) killProp(p, p.byP); }
        puff(b.p.x, b.p.y, b.p.z, 4, 0xffe9a0, 2.5, 0.3, 0.13, 8);
      }
    }
    if (dead) { killBullet(i); continue; }
    b.m.position.copy(b.p);
    if (b.p.y > 300) killBullet(i);
  }
}

/* ---------------- entrada ---------------- */
const keys = {};
let mouseDown = false, state = 'menu', paused = true, noLock = false;
addEventListener('keydown', e => {
  if (paused && e.code !== 'KeyM') return;
  keys[e.code] = true;
  if (e.code === 'KeyE') toggleCar();
  if (e.code === 'KeyF') kick();
  { const wk = { Digit1: 'gun', Digit2: 'fist', Digit3: 'bat', Digit4: 'smg', Digit5: 'shotgun', Digit6: 'rifle' }[e.code]; if (wk) setWeapon(wk); }
  if (e.code === 'KeyH') { const h = $('hint'); h.style.display = h.style.display === 'none' ? '' : 'none'; }
  if (e.code === 'KeyM') { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; toast(muted ? 'Som desligado' : 'Som ligado', 1000); }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
addEventListener('mousedown', e => { if (!paused && e.button === 0) mouseDown = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (paused || !(document.pointerLockElement || noLock && e.buttons)) return;
  camYaw -= e.movementX * 0.0024; camPitch = clamp(camPitch + e.movementY * 0.0021, -0.45, 1.2); lastMouse = T;
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
const overlay = $('overlay');
function startGame() {
  if (!gameReady) return;
  initAudio(); if (actx && actx.state === 'suspended') actx.resume();
  paused = false; overlay.style.display = 'none'; if (state === 'menu') state = 'play';
  $('cross').style.display = 'block';
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { noLock = true; }); } catch (e) { noLock = true; }
}
overlay.addEventListener('click', startGame);
document.addEventListener('pointerlockerror', () => { noLock = true; });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !noLock && state !== 'menu') { paused = true; mouseDown = false; overlay.style.display = 'flex'; $('goBtn').textContent = 'CLIQUE PARA CONTINUAR'; }
});
function toast(t, ms = 2200) { const e = $('toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(toast.h); toast.h = setTimeout(() => { e.style.opacity = 0; }, ms); }

/* ---------------- ações do jogador ---------------- */
function kick() {
  if (state !== 'play' || player.inCar) return;
  const f = fwdOf(player.h); player.aim = 0.4;
  for (const p of props) {
    const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz), fw = (dx * f.x + dz * f.z);
    if (d < 2.4 && fw > 0 && (fw / (d || 1)) > 0.3) { const k = p.kind === 'ball' ? 16 : 10; p.vx = f.x * k / Math.sqrt(p.mass); p.vz = f.z * k / Math.sqrt(p.mass); p.vy = p.kind === 'ball' ? 7 : 4; p.spin = rand(-8, 8); sfx('hit', p.x, p.z); }
  }
  for (const c of chars) {
    if (c === player || !c.alive || c.inCar) continue;
    const dx = c.x - player.x, dz = c.z - player.z, d = Math.hypot(dx, dz), fw = dx * f.x + dz * f.z;
    if (d < 2 && fw > 0) { damageChar(c, 10, true, f.x * 9, f.z * 9); c.vy = 3; c.stun = 0.9; sfx('hit', c.x, c.z); }
  }
}
function ejectPlayer(car, exploded) {
  const f = fwdOf(car.h); let spot = null;
  for (const [ox, oz] of [[f.z * 2.4, -f.x * 2.4], [-f.z * 2.4, f.x * 2.4], [-f.x * 3.5, -f.z * 3.5], [f.x * 3.5, f.z * 3.5]]) {
    const p = { x: car.x + ox, z: car.z + oz }; const q = { x: p.x, z: p.z }; collideStatic(q, 0.4);
    if (Math.abs(q.x - p.x) < 0.01 && Math.abs(q.z - p.z) < 0.01) { spot = p; break; }
  }
  if (!spot) spot = { x: car.x, z: car.z };
  player.x = spot.x; player.z = spot.z; player.y = car.y; player.vy = exploded ? 6 : 0; player.mesh.visible = true; player.inCar = null;
  { const pp = player.parts; pp.legL.rotation.z = pp.legR.rotation.z = 0; player.mesh.rotation.set(0, car.h, 0, 'YXZ'); }
  if (exploded) { player.vx = rand(-6, 6); player.vz = rand(-6, 6); hurtPlayer(35); }
  if (car.mode === 'player') { car.mode = 'parked'; car.driver = null; }
  if (engineGain) engineGain.gain.value = 0;
}
function killPlayer() {
  if (state !== 'play') return;
  if (MP.on) { const lh = MP.lastHit && T - MP.lastHit.t < 6 ? MP.players.get(MP.lastHit.id) : null; mpEvent({ t: 'k', n: MP.name, by: lh ? lh.name : 0 }); toast(lh ? lh.name + ' eliminou você!' : 'Você morreu', 3000); }
  state = 'dead'; player.alive = false; mouseDown = false;
  if (player.onJet) { player.onJet.rider = false; player.onJet = null; }
  if (player.inCar) { const c = player.inCar; player.mesh.visible = true; player.inCar = null; player.x = c.x; player.z = c.z; c.mode = 'parked'; c.driver = null; }
  if (engineGain) engineGain.gain.value = 0;
  $('wasted').style.display = 'flex';
  setTimeout(respawnPlayer, 3800);
}
function respawnPlayer() {
  state = 'play'; $('wasted').style.display = 'none'; heat = 0;
  Object.assign(player, { alive: true, hp: 100, x: -251.5, z: -26, y: 1, vx: 0, vz: 0, vy: 0, h: 0, stun: 0 });
  if (player.onJet) { player.onJet.rider = false; player.onJet = null; }
  player.inside = null; robbing = null; intTarget = 0; money = Math.round(money * 0.9);
  player.atk = null; weapon = 'gun'; showWeapon();
  player.swim = false; player.parts.legL.rotation.x = player.parts.legR.rotation.x = 0;
  player.mesh.rotation.x = 0; player.mesh.visible = true; camYaw = 0;
  for (let i = chars.length - 1; i >= 0; i--) if (chars[i].type === 'cop') { freeGeo(chars[i].mesh); scene.remove(chars[i].mesh); chars.splice(i, 1); }
  for (const c of cars.slice()) if (c.cop) removeCar(c);
  toast('Você acordou no hospital. Fique longe de encrenca!');
}
function fire() {
  const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
  const cp = camera.position;
  let t = 3, aim = null, tWall = 90;
  for (; t < 90; t += 0.8) {
    const x = cp.x + camDir.x * t, y = cp.y + camDir.y * t, z = cp.z + camDir.z * t, h = hitTest(x, y, z, 'player');
    if (h) { if (!aim) aim = new THREE.Vector3(x, y, z); if (h.k === 'wall' || h.k === 'car') { tWall = t; break; } }
  }
  if (!aim) aim = cp.clone().addScaledVector(camDir, 90);
  // assistência de mira: gruda no alvo mais perto da mira
  let best = null, bestD = 99;
  for (const c of chars) {
    if (c === player || !c.alive || c.inCar) continue;
    const vx = c.x - cp.x, vy = c.y + 1.1 - cp.y, vz = c.z - cp.z, tt = vx * camDir.x + vy * camDir.y + vz * camDir.z;
    if (tt < 3 || tt > Math.min(tWall + 0.8, 70)) continue;
    const d = Math.hypot(vx - camDir.x * tt, vy - camDir.y * tt, vz - camDir.z * tt);
    if (d < 0.9 + 0.045 * tt && d < bestD) { bestD = d; best = c; }
  }
  if (best) aim.set(best.x, best.y + 1.1, best.z);
  else for (const p of props) {
    if (p.kind !== 'barrel' && p.kind !== 'pump' && p.kind !== 'case') continue;
    const vx = p.x - cp.x, vy = p.y + p.h * 0.5 - cp.y, vz = p.z - cp.z, tt = vx * camDir.x + vy * camDir.y + vz * camDir.z;
    if (tt < 3 || tt > Math.min(tWall + 0.8, 60)) continue;
    const d = Math.hypot(vx - camDir.x * tt, vy - camDir.y * tt, vz - camDir.z * tt);
    if (d < 0.9 + 0.04 * tt) { aim.set(p.x, p.y + p.h * 0.5, p.z); break; }
  }
  const mp = new THREE.Vector3(); player.parts.muzzle.getWorldPosition(mp);
  const W = WEAP[weapon].fire ? WEAP[weapon] : WEAP.gun, base = aim.sub(mp).normalize();
  const mpDirs = [];
  for (let k = 0; k < W.pellets; k++) { const dir = base.clone(); dir.x += rand(-1, 1) * W.spread; dir.y += rand(-1, 1) * W.spread * 0.75; dir.z += rand(-1, 1) * W.spread; dir.normalize(); spawnBullet(mp, dir, W.speed, 'player', W.dmg); mpDirs.push([+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)]); }
  mpEvent({ t: 'f', o: [+mp.x.toFixed(2), +mp.y.toFixed(2), +mp.z.toFixed(2)], ds: mpDirs, sp: W.speed, dm: W.dmg });
  muzzleLight.position.copy(mp); muzzleLight.intensity = W.pellets > 1 ? 10 : 6; puff(mp.x, mp.y, mp.z, W.pellets > 1 ? 7 : 3, 0xffd060, 2, 0.12, 0.22, 0, 0);
  recoil += W.recoil; sfx('shot'); if (W.pellets > 1) sfx('crash'); lastShotT = T;
  panic(player.x, player.z, 38, 4);
  for (const c of chars) if (c.type === 'cop' && c.alive && heat <= 0 && Math.hypot(c.x - player.x, c.z - player.z) < 35) addHeat(2);
}

/* ---------------- armas: pistola / soco / taco ---------------- */
let weapon = 'gun', lastAtk = -9, comboN = 0, nextAtk = 0;
const WEAP = {
  gun: { fire: true, rate: 0.14, dmg: 25, spread: 0.008, pellets: 1, speed: 150, recoil: 0.012, model: 'Pistol_1', len: 0.21, grip: 0.16 },
  smg: { fire: true, rate: 0.065, dmg: 13, spread: 0.028, pellets: 1, speed: 150, recoil: 0.007, model: 'SubmachineGun_1', len: 0.4, grip: 0.36 },
  shotgun: { fire: true, rate: 0.75, dmg: 13, spread: 0.075, pellets: 8, speed: 125, recoil: 0.05, model: 'Shotgun_1', len: 0.9, grip: 0.3, long: true },
  rifle: { fire: true, rate: 0.1, dmg: 30, spread: 0.012, pellets: 1, speed: 190, recoil: 0.014, model: 'AssaultRifle_1', len: 0.8, grip: 0.34, long: true },
  fist: {}, bat: {}
};
const isFire = () => !!WEAP[weapon].fire;
function showWeapon() { // mostra só a arma equipada
  const pp = player.parts;
  if (pp.guns) { for (const k in pp.guns) pp.guns[k].visible = k === weapon; if (pp.guns[weapon]) pp.muzzle = pp.guns[weapon].userData.muzzle; }
  else if (pp.gun) pp.gun.visible = isFire();
  if (pp.bat) pp.bat.visible = weapon === 'bat';
  document.querySelectorAll('#weapons .w').forEach(e => e.classList.toggle('on', e.dataset.w === weapon));
}
function setWeapon(w) {
  if (player.inCar || player.onJet && !WEAP[w].fire || state !== 'play') return;
  weapon = w; player.atk = null; showWeapon();
  $('cross').style.display = isFire() && !player.inCar ? 'block' : 'none';
}
function startMelee() {
  if (player.atk || T < nextAtk || player.swim) return;
  comboN = T - lastAtk < 0.9 ? (comboN % 3) + 1 : 1; lastAtk = T;
  const bat = weapon === 'bat';
  const a = bat ? { kind: 'bat', dur: 0.62, hitAt: 0.5, dmg: 38, knock: 14, range: 2.7, cos: 0.2, stun: 1.3 }
    : comboN === 1 ? { kind: 'jabR', dur: 0.3, hitAt: 0.45, dmg: 12, knock: 4, range: 1.8, cos: 0.55, stun: 0.45 }
    : comboN === 2 ? { kind: 'jabL', dur: 0.3, hitAt: 0.45, dmg: 14, knock: 5, range: 1.8, cos: 0.55, stun: 0.5 }
    : { kind: 'hook', dur: 0.46, hitAt: 0.55, dmg: 22, knock: 12, range: 2.0, cos: 0.4, stun: 1.0 };
  a.t = 0; a.done = false; player.atk = a; nextAtk = T + a.dur + 0.04; player.aim = 0.9;
  // trava a mira no alvo mais perto à frente (ajuda a acertar)
  const f = { x: -Math.sin(camYaw), z: -Math.cos(camYaw) }; let best = null, bd = 4.2;
  for (const c of chars) {
    if (c === player || !c.alive || c.inCar) continue;
    const dx = c.x - player.x, dz = c.z - player.z, d = Math.hypot(dx, dz); if (d > bd || d < 0.1) continue;
    if ((dx * f.x + dz * f.z) / d > 0.35) { bd = d; best = c; }
  }
  if (best) { player.lockH = headingTo(best.x - player.x, best.z - player.z); player.lockT = 0.35; }
}
function meleeHit(a) {
  mpEvent({ t: 'm', x: +player.x.toFixed(2), z: +player.z.toFixed(2), y: +player.y.toFixed(2), h: +(player.lockT > 0 ? player.lockH : player.h).toFixed(3), r: a.range, c: a.cos, dm: a.dmg, kn: a.knock });
  const h = player.lockT > 0 ? player.lockH : player.h, f = fwdOf(h), ox = player.x, oz = player.z; let hits = 0;
  for (const c of chars) {
    if (c === player || !c.alive || c.inCar) continue;
    const dx = c.x - ox, dz = c.z - oz, d = Math.hypot(dx, dz); if (d > a.range || Math.abs(c.y - player.y) > 1.5) continue;
    if (d > 0.4 && (dx * f.x + dz * f.z) / d < a.cos) continue;
    damageChar(c, a.dmg, true, f.x * a.knock + (dx / (d || 1)) * 2, f.z * a.knock + (dz / (d || 1)) * 2);
    c.vy = a.kind === 'bat' ? 4.5 : a.kind === 'hook' ? 3.5 : 1.5; c.stun = Math.max(c.stun, a.stun); hits++;
    puff(c.x, 1.3, c.z, 6, 0xffffff, 3, 0.35, 0.2, 5); if (c.type === 'npc') panic(c.x, c.z, 18, 4);
  }
  for (const p of props) {
    const dx = p.x - ox, dz = p.z - oz, d = Math.hypot(dx, dz); if (d > a.range + 0.5) continue;
    if (d > 0.4 && (dx * f.x + dz * f.z) / d < a.cos - 0.1) continue;
    if (p.fixed) { if (a.kind === 'bat' || a.kind === 'hook') { p.hp -= a.dmg; if (p.kind === 'case' && a.kind === 'bat') p.hp = 0; if (p.hp <= 0) killProp(p, true); else hits++; } continue; }
    const k = (a.kind === 'bat' ? 18 : a.kind === 'hook' ? 12 : 7) / Math.sqrt(p.mass); p.vx = f.x * k; p.vz = f.z * k; p.vy = a.kind === 'bat' ? 6 : 3; p.spin = rand(-9, 9); p.byP = true; hits++;
    if (p.kind === 'barrel' && a.kind === 'bat') { p.hp -= 45; }
  }
  if (a.kind === 'bat') for (const c of cars) {
    if (c.mode === 'wreck') continue; const dx = c.x - ox, dz = c.z - oz;
    if (Math.hypot(dx, dz) < c.V.L / 2 + 1.4 && (dx * f.x + dz * f.z) > 0) { damageCar(c, 14, true); puff(c.x - dx * 0.2, 1, c.z - dz * 0.2, 6, 0xffcc44, 4, 0.4, 0.15, 10); hits++; if (c.driver === 'npc') addHeat(0.5); }
  }
  sfx(hits ? 'hit' : 'shot', ox, oz); if (hits) { shake = Math.max(shake, a.kind === 'bat' ? 0.35 : 0.15); }
}
function updateMelee(dt) {
  const a = player.atk; if (!a) return;
  a.t += dt; const p = a.t / a.dur;
  if (!a.done && p >= a.hitAt) { a.done = true; meleeHit(a); }
  if (a.t >= a.dur) player.atk = null;
}
function meleePose(c) { // braços durante o ataque
  const a = c.atk, p = clamp(a.t / a.dur, 0, 1), pp = c.parts;
  if (a.kind === 'bat') {
    const ang = p < 0.3 ? 0.7 + (2.9 - 0.7) * (p / 0.3) : p < 0.7 ? 2.9 + (0.2 - 2.9) * ((p - 0.3) / 0.4) : 0.2 + (0.7 - 0.2) * ((p - 0.7) / 0.3);
    pp.armR.rotation.x = ang; pp.armL.rotation.x = ang * 0.5; c.atkYaw = p < 0.3 ? 0.45 * (p / 0.3) : p < 0.7 ? 0.45 - 1.1 * ((p - 0.3) / 0.4) : -0.65 * (1 - (p - 0.7) / 0.3);
  } else {
    const ext = Math.sin(Math.min(1, p / 0.9) * Math.PI), right = a.kind !== 'jabL';
    const hook = a.kind === 'hook' ? 1 : 0;
    (right ? pp.armR : pp.armL).rotation.x = 0.5 + 1.15 * ext + hook * 0.3; (right ? pp.armL : pp.armR).rotation.x = 0.9;
    c.atkYaw = (right ? -1 : 1) * (0.25 + hook * 0.5) * ext;
  }
}

/* ---------------- jogador a pé ---------------- */
function updatePlayerFoot(dt) {
  const p = player;
  if (p.stun > 0) p.stun -= dt;
  if (p.invuln > 0) p.invuln -= dt;
  const ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + (keys.ArrowRight ? 0 : 0), iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
  let mx = cy * ix - sy * iz, mz = -sy * ix - cy * iz; const len = Math.hypot(mx, mz);
  const sprint = keys.ShiftLeft || keys.ShiftRight, speed = p.swim ? 3.6 : sprint ? 8.6 : 5;
  if (len > 0) { mx = mx / len * speed; mz = mz / len * speed; } else mx = mz = 0;
  if (keys.ArrowLeft) camYaw += 2 * dt; if (keys.ArrowRight) camYaw -= 2 * dt;
  p.aim = Math.max(0, p.aim - dt); if (mouseDown) p.aim = 0.8;
  if (p.lockT > 0) { p.lockT -= dt; p.h += wrap(p.lockH - p.h) * Math.min(1, dt * 22); }
  else if (p.aim > 0) p.h += wrap(camYaw - p.h) * Math.min(1, dt * 14);
  else if (len > 0) p.h += wrap(headingTo(mx, mz) - p.h) * Math.min(1, dt * 12);
  if (keys.Space && !p.swim && p.y <= groundH(p.x, p.z) + 0.01 && p.vy === 0) p.vy = 8.2;
  moveChar(p, mx, mz, dt);
  animHuman(p, dt);
  p.mesh.updateMatrixWorld(true);
  updateMelee(dt);
  if (mouseDown && state === 'play') { if (isFire()) { if (T >= nextShot) { nextShot = T + WEAP[weapon].rate; fire(); } } else startMelee(); }
}

/* ---------------- câmera ---------------- */
function insideSolid(x, y, z) { if (y < surfaceY(x, z) + 0.2) return true; return !!boxAt(x, z, 0.3, b => y < b.h + 0.3 && y > b.y0 - 1); }
function updateCamera(dt) {
  const car = player.inCar || player.onJet;
  if (car && Math.abs(car.speed) > 3 && T - lastMouse > 1.0) { camYaw += wrap((car.speed > 0 ? car.h : car.h + Math.PI) - camYaw) * Math.min(1, dt * 2.2); camPitch += (0.3 - camPitch) * Math.min(1, dt * 2); }
  recoil *= Math.exp(-10 * dt);
  const subj = car || player, targetDist = player.onJet ? 7.5 : car ? (car.isMoto ? 6.5 : car.V && car.V.L > 6 ? 12 : 9) : player.inside ? 3.4 : 4.3, shoulder = car ? 0 : 0.8;
  const tx = subj.x + Math.cos(camYaw) * shoulder, tz = subj.z - Math.sin(camYaw) * shoulder, ty = (car ? car.y + 1.5 : player.y + 1.55);
  const pe = clamp(camPitch - recoil, -0.5, 1.25), cp = Math.cos(pe), bx = Math.sin(camYaw) * cp, by = Math.sin(pe), bz = Math.cos(camYaw) * cp;
  let d = targetDist;
  while (d > 0.8 && insideSolid(tx + bx * d, ty + by * d, tz + bz * d)) d -= 0.25;
  camDist = d < camDist ? d : camDist + (d - camDist) * Math.min(1, dt * 3);
  const sh = shake > 0 ? shake : 0;
  camera.position.set(tx + bx * camDist + rand(-sh, sh) * 0.3, Math.max(0.3, ty + by * camDist) + rand(-sh, sh) * 0.3, tz + bz * camDist + rand(-sh, sh) * 0.3);
  camera.lookAt(tx, ty, tz);
  const fov = car ? 65 + clamp(Math.abs(car.speed) * 0.7, 0, 20) : 65; camera.fov += (fov - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix();
  shake = Math.max(0, shake - dt * 1.8);
}

/* ---------------- minimapa ---------------- */
const mm = $('minimap'), mctx = mm.getContext('2d'), MM = mm.width / 2, MK = 1.0 * (mm.width / 200);
function drawMinimap() {
  const subj = pursuit(), ctx = mctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, mm.width, mm.height);
  ctx.save(); ctx.translate(MM, MM); ctx.rotate(camYaw);
  ctx.save(); ctx.scale(MK / MAP_S * 0.9, MK / MAP_S * 0.9); ctx.drawImage(mapCanvas, -(subj.x - MAP_X0) * MAP_S, -(subj.z - MAP_Z0) * MAP_S); ctx.restore();
  const k = MK * 0.9, bl = (x, z, col, r) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc((x - subj.x) * k, (z - subj.z) * k, r, 0, 7); ctx.fill(); };
  for (const p of pickups) if (p.g.visible) bl(p.x, p.z, p.kind === 'health' ? '#2ee06a' : '#ffd23f', p.kind === 'health' ? 5 : 3);
  for (const d of doors) bl(d.fx, d.fz, '#ff8a1a', 5);
  for (const c of cars) if (c.cop && c.mode !== 'wreck') bl(c.x, c.z, Math.floor(T * 5) % 2 ? '#ff3030' : '#3a70ff', 6);
  for (const c of chars) if (c.type === 'cop' && c.alive) bl(c.x, c.z, Math.floor(T * 5) % 2 ? '#ff3030' : '#3a70ff', 4);
  for (const j of jets) bl(j.x, j.z, '#19e0ff', 3);
  if (MP.on) for (const rp of MP.players.values()) if (rp.st) bl(rp.x, rp.z, rp.col, 6);
  if (player.inCar) for (const c of cars) if (c !== player.inCar && c.mode === 'parked' && !c.cop) bl(c.x, c.z, '#ffd23f', 3);
  // seta do jogador
  const f = fwdOf(player.inCar ? player.inCar.h : player.h), px = -f.z, pz = f.x;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(f.x * 12, f.z * 12); ctx.lineTo(-f.x * 8 + px * 8, -f.z * 8 + pz * 8); ctx.lineTo(-f.x * 3, -f.z * 3); ctx.lineTo(-f.x * 8 - px * 8, -f.z * 8 - pz * 8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  // N
  ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center';
  ctx.fillText('N', MM + Math.sin(camYaw) * (MM - 16), MM - Math.cos(camYaw) * (MM - 16) + 8);
}

/* ---------------- HUD ---------------- */
let lastStars = -1, lastZone = '', lastHp = -1;
function zoneName(x, z) {
  if (x < -1500) return '';
  if (inWater(x, z)) return 'Mar aberto';
  const d = deckAt(x, z); if (d !== null) return decks.find(k => x > k.x0 && x < k.x1 && Math.abs(z - k.zc) < k.hw).kind === 'pier' ? 'Píer' : 'Ponte';
  const h = terrainH(x, z);
  if (h < 0.4 && Math.hypot(x - 5, z + 215) < 70) return 'Ilhota';
  if (inBeach(x, z)) return 'Praia do Resort';
  if (x > -430 && x < -90 && z > -210 && z < 190) return 'Centro';
  if (x > 110 && x < 400 && z > -240 && z < 270) return 'Distrito Leste';
  if (z < -200) return x < 0 ? 'Campo Oeste' : 'Colinas Leste';
  if (z > 160) return x < 0 ? 'Porto' : 'Marina';
  return x < 0 ? 'Ilha Oeste' : 'Ilha Leste';
}
function updateHUD() {
  const s = stars(), el = $('stars');
  if (s !== lastStars) { el.innerHTML = [0, 1, 2, 3, 4].map(i => `<span class="${i < s ? 'on' : 'off'}">★</span>`).join(''); lastStars = s; }
  let cl = ''; for (const c of chars) if (c.type === 'cop' && c.alive && Math.hypot(c.x - player.x, c.z - player.z) < 55) { cl = 'flash'; break; }
  if (el.className !== cl) el.className = cl;
  const hp = Math.max(0, Math.round(player.hp)); if (hp !== lastHp) { $('hpFill').style.width = hp + '%'; lastHp = hp; }
  const car = player.inCar;
  $('carBar').style.display = car ? 'block' : 'none';
  if (car) { $('carFill').style.width = clamp(car.hp / car.maxhp * 100, 0, 100) + '%'; $('speed').textContent = Math.round(Math.abs(car.speed) * 3.6) + ' km/h'; }
  else if (player.onJet) $('speed').textContent = Math.round(Math.abs(player.onJet.speed) * 3.6) + ' km/h';
  else $('speed').textContent = '';
  $('money').textContent = '$ ' + money.toLocaleString('pt-BR');
  const z = player.inside ? player.inside.name : zoneName(player.x, player.z); if (z !== lastZone) { $('zone').textContent = z; lastZone = z; }
  hurtT -= 0; if (hurtT > 0) hurtT -= 1 / 60; else $('hurt').style.opacity = 0;
  $('cross').style.display = car || state !== 'play' || !isFire() ? 'none' : 'block';
  if (state !== 'play') $('interact').style.display = 'none';
}

/* ---------------- spawn inicial ---------------- */
for (let i = 0; i < 50; i++) { const p = pickSpot('city', 15, 220), c = newChar('npc', p.x, p.z, npcLook()); c.zone = 'city'; }
for (let i = 0; i < 20; i++) { const p = pickSpot('beach', 0, 1e9); const c = newChar('npc', p.x, p.z, beachLook()); c.zone = 'beach'; }
for (let i = 0; i < 12; i++) { const p = pickSpot('rural', 0, 1e9); const c = newChar('npc', p.x, p.z, npcLook()); c.zone = 'rural'; }
for (let k = 0; k < 6; k++) { const sp = pickSpot('rural', 0, 1e9); for (let i = 0; i < 3; i++) { const c = newChar('npc', sp.x + rand(-5, 5), sp.z + rand(-5, 5), { model: 'cow', hp: 40, zone: 'rural' }); c.zone = 'rural'; } }
for (let i = 0; i < 26; i++) spawnTraffic(true);
{ // jet skis perto da praia leste e do píer
  const pz = decks.find(d => d.kind === 'pier');
  const spots = [[pz.x1 + 8, pz.zc + 14], [pz.x1 + 8, pz.zc - 14], [pz.x0 + 40, pz.zc + 20]];
  for (const z of [-150, 60, 150]) { const x = scanX(z, 420, 1, -1.2) + 8; spots.push([x, z]); }
  for (const [x, z] of spots) addJet(x, z);
}
for (const [dx, dz, h, type] of [[4.5, -14, 0, 'sport'], [-3.2, 12, Math.PI, 'moto'], [4.4, 22, 0, 'muscle'], [-3.4, 26, Math.PI, 'sedan']]) {
  const c = newCar(-256.5 + (dx > 0 ? 0 : -7) , START.z + dz, h, 'parked', false, type); c.driver = null; c.h = h; c.x = dx > 0 ? -252.2 : -267.8;
}

/* ---------------- interiores ---------------- */
function floorTex(c1, c2, w, d) {
  const t = canvasTex(64, 64, (c, W, H) => { c.fillStyle = c1; c.fillRect(0, 0, W, H); c.fillStyle = c2; c.fillRect(0, 0, W / 2, H / 2); c.fillRect(W / 2, H / 2, W / 2, H / 2); });
  t.repeat.set(w / 2, d / 2); return t;
}
function shelf(x0, x1, z0, z1, h, color = 0x8a8f98) {
  addSolid(x0, x1, z0, z1, h, color);
  const bx = [], palette = [0xe04848, 0x4880e0, 0xf2c200, 0x48c060, 0xff8a3d, 0xffffff, 0xb048e0], longX = (x1 - x0) > (z1 - z0);
  for (let y = 0.4; y < h - 0.2; y += 0.55) for (let a = (longX ? x0 : z0) + 0.3; a < (longX ? x1 : z1) - 0.2; a += 0.45) for (const sd of [0, 1]) {
    const col = choice(palette);
    if (longX) bx.push(part(UG.box, col, a, y, sd ? z1 + 0.08 : z0 - 0.08, 0.34, 0.36, 0.14));
    else bx.push(part(UG.box, col, sd ? x1 + 0.08 : x0 - 0.08, y, a, 0.14, 0.36, 0.34));
  }
  const m = new THREE.Mesh(mergeParts(bx), humanMat); m.castShadow = true; scene.add(m);
}
function counterTop(x0, x1, z0, z1, y, color) { mesh(geoBox(x1 - x0 + 0.3, 0.12, z1 - z0 + 0.3), lam(color, { roughness: 0.3, metalness: 0.2 }), (x0 + x1) / 2, y, (z0 + z1) / 2, scene); }
function addWorker(d, x, z, look) {
  const c = newChar('npc', x, z, { hp: 50, ...look });
  Object.assign(c, { role: 'worker', door: d, post: { x, z }, robbed: 0, zone: 'inside', h: Math.PI, handsUp: false });
  d.workers.push(c); return c;
}
function buildInterior(d, idx) {
  const def = SHOPS[d.key], X = INT_X - idx * 60, Z = 0, w = def.w, dd = def.d, H = 5, t = 0.6, wc = def.wall;
  d.room = { X, Z, w, d: dd }; d.ix = X; d.iz = Z + dd / 2 - 2.6; d.exitX = X; d.exitZ = Z + dd / 2 - 0.4;
  const fl = new THREE.Mesh(geoBox(w, 0.3, dd), new THREE.MeshStandardMaterial({ map: floorTex(def.f1, def.f2, w, dd), roughness: 0.35, metalness: 0.1 }));
  fl.position.set(X, -0.15, Z); fl.receiveShadow = true; scene.add(fl);
  addSolid(X - w / 2 - t, X + w / 2 + t, Z - dd / 2 - t, Z - dd / 2, H, wc);
  addSolid(X - w / 2 - t, X - w / 2, Z - dd / 2, Z + dd / 2, H, wc);
  addSolid(X + w / 2, X + w / 2 + t, Z - dd / 2, Z + dd / 2, H, wc);
  addSolid(X - w / 2 - t, X - 2, Z + dd / 2, Z + dd / 2 + t, H, wc);
  addSolid(X + 2, X + w / 2 + t, Z + dd / 2, Z + dd / 2 + t, H, wc);
  plane(4, 2, 0x2a8f4a, X, 0.02, Z + dd / 2 - 0.9);
  const ex = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85), new THREE.MeshBasicMaterial({ map: makeSignTex('SAÍDA', '#1a7a3a') })); ex.position.set(X, 3.9, Z + dd / 2 - 0.05); ex.rotation.y = Math.PI; scene.add(ex);
  const sk = () => choice(skins);
  if (d.key === 'bank') {
    addSolid(X - 9, X + 9, Z - 4.6, Z - 3.2, 1.1, 0x6b4a2b); counterTop(X - 9, X + 9, Z - 4.6, Z - 3.2, 1.16, 0xd6c7a1);
    mesh(geoBox(18, 1.4, 0.06), new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.22, roughness: 0.05 }), X, 1.95, Z - 3.9, scene, false);
    const vd = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.5, 24), new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.9, roughness: 0.25 })); vd.rotation.x = Math.PI / 2; vd.position.set(X, 2.4, Z - dd / 2 + 0.3); scene.add(vd);
    mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.7, 12), lam(0x333333), X, 2.4, Z - dd / 2 + 0.7, scene).rotation.x = Math.PI / 2;
    for (const gx of [-3, 0, 3]) addPickup(X + gx, Z - 8.4, 'cash', 1500, 0, 240);
    for (const bx of [-9, 9]) { addSolid(X + bx - 2, X + bx + 2, Z + 2.2, Z + 3.2, 0.6, 0x5a3a1e); }
    for (const [px, pz] of [[-12.5, 8], [12.5, 8], [-12.5, -8.5], [12.5, -8.5]]) { mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.6, 10), lam(0x8a5a3a), X + px, 0.3, Z + pz, scene); mesh(UG.sph, lam(0x2f8f3f), X + px, 1.1, Z + pz, scene).scale.setScalar(0.6); }
    for (const sx of [-5.5, 5.5]) addWorker(d, X + sx, Z - 6.2, { shirt: 0xf5f5f5, pants: 0x1c1f2b, vest: 0x23304a, tie: 0xc0392b, skin: sk(), hairStyle: choice(['short', 'long']), shoes: 0x111111 });
  } else if (d.key === 'jewelry') {
    addSolid(X - 6, X + 6, Z - 5.0, Z - 3.8, 1.1, 0x2b2438); counterTop(X - 6, X + 6, Z - 5.0, Z - 3.8, 1.16, 0xd4af37);
    plane(3, dd - 1, 0x8b1a2b, X, 0.02, Z + 0.4);
    for (const cz of [-0.5, 2.8]) for (const cx of [-5.5, 0, 5.5]) addProp('case', X + cx, Z + cz);
    mesh(UG.sph, lam(0xfff2c0, { emissive: 0xffe9a0 }), X, 4.4, Z, scene, false).scale.setScalar(0.35);
    for (const sx of [-2.5, 2.5]) addWorker(d, X + sx, Z - 5.9, { shirt: 0xf5f5f5, pants: 0x111111, vest: 0x4a2b6a, tie: 0xd4af37, skin: sk(), hairStyle: choice(['short', 'long']), shoes: 0x111111 });
  } else if (d.key === 'market') {
    for (const zz of [-6.5, -2.5, 1.5]) shelf(X - 12, X + 3, Z + zz, Z + zz + 1.2, 2.0);
    addSolid(X - 16, X - 14.6, Z - 9, Z + 3, 2.2, 0xcfe8f5);
    addSolid(X + 6, X + 13, Z + 4.8, Z + 6.0, 1.1, 0x555b66); counterTop(X + 6, X + 13, Z + 4.8, Z + 6.0, 1.16, 0xdddddd);
    mesh(geoBox(0.7, 0.4, 0.5), lam(0x222831), X + 9.5, 1.4, Z + 5.2, scene);
    addWorker(d, X + 9.5, Z + 3.6, { shirt: 0x2e9e55, pants: 0x30343b, apron: 0xf2f2f2, hat: 0x2e9e55, skin: sk(), shoes: 0x222222 });
    addWorker(d, X - 8, Z - 9.2, { shirt: 0x2e9e55, pants: 0x30343b, apron: 0xf2f2f2, hat: 0x2e9e55, skin: sk(), shoes: 0x222222 });
    addProp('crate', X + 11, Z - 8); addProp('crate', X + 12.2, Z - 8); addProp('ball', X + 8, Z + 9);
  } else {
    addSolid(X - 1, X + 6, Z - 1.5, Z - 0.3, 1.1, 0x444a55); counterTop(X - 1, X + 6, Z - 1.5, Z - 0.3, 1.16, 0xdddddd);
    mesh(geoBox(0.7, 0.4, 0.5), lam(0x222831), X + 3, 1.4, Z - 0.9, scene);
    shelf(X - 8, X + 2, Z - 5.9, Z - 5.0, 2.0);
    addSolid(X + 7.6, X + 9, Z - 4, Z + 3, 2.2, 0xcfe8f5);
    addWorker(d, X + 3, Z - 3.2, { shirt: 0xff7a1a, pants: 0x2d3b66, hat: 0xff7a1a, apron: 0xffffff, skin: sk(), shoes: 0x222222 });
  }
}

doors.forEach((d, i) => buildInterior(d, i));
for (const [x, z] of pumpSpots) addProp('pump', x, z);

/* ---------------- interações ---------------- */
let robbing = null, money = 0, fading = false;
function fadeTo(fn) { fading = true; const f = $('fade'); f.style.opacity = 1; setTimeout(() => { fn(); f.style.opacity = 0; fading = false; }, 240); }
function enterShop(d) {
  fadeTo(() => { player.inside = d; player.x = d.ix; player.z = d.iz; player.y = 0; player.vx = player.vz = 0; player.h = 0; camYaw = 0; camPitch = 0.38; intLight.position.set(d.room.X, 4.4, d.room.Z); intTarget = 140; toast('Dentro: ' + d.name); });
}
function leaveShop(d) {
  fadeTo(() => { player.inside = null; robbing = null; intTarget = 0; player.x = d.fx + d.nx * 0.8; player.z = d.fz + d.nz * 0.8; player.y = 0; player.h = headingTo(d.nx, d.nz); camYaw = player.h; camPitch = 0.14; });
}
function startRob(w, d) { robbing = { w, d, t: 1.5 }; toast('Assaltando... fique perto!', 1600); }
function completeRob(r) {
  money += r.d.cash; r.w.robbed = 150; r.w.handsUp = false; toast('ASSALTO! +$' + r.d.cash, 3200);
  puff(r.w.x, 1.3, r.w.z, 22, 0x59e07a, 5, 1.2, 0.25, 6, 3); addHeat(r.d.heat); sfx('shot'); panic(r.w.x, r.w.z, 30, 6);
}
function enterCar(best) {
  if (best.driver) {
    const wasCop = best.cop, f = fwdOf(best.h);
    const npc = newChar(wasCop ? 'cop' : 'npc', best.x - f.z * 2.2, best.z + f.x * 2.2, wasCop ? copLook() : npcLook());
    if (wasCop) { npc.maxhp = 100; } else { npc.flee = 8; npc.fx = best.x; npc.fz = best.z; }
    addHeat(wasCop ? 6 : 3); toast(wasCop ? 'Você roubou um carro de polícia!' : 'Carro roubado!');
    panic(best.x, best.z, 25, 6);
  } else toast('Entrou no carro');
  best.driver = 'player'; best.mode = 'player'; best.rev = 0; best.ghost = 0; best.lastPlayer = true; best.cruise = 12;
  player.inCar = best; player.mesh.visible = !!best.isMoto; player.vx = player.vz = 0;
  if (engineGain) engineGain.gain.value = 0.06;
  camYaw = best.h; camPitch = 0.3;
}
function findInteraction() {
  if (state !== 'play' || fading) return null;
  if (player.inCar) return { label: 'sair do carro', run: () => ejectPlayer(player.inCar, false) };
  if (player.onJet) return { label: 'descer do jet ski', run: exitJet };
  const px = player.x, pz = player.z;
  if (player.inside) {
    const d = player.inside;
    if (!robbing) for (const w of d.workers) if (w.alive && w.robbed <= 0 && Math.hypot(w.x - px, w.z - pz) < 4.2) return { label: 'ASSALTAR ' + d.name.toUpperCase(), run: () => startRob(w, d) };
    if (Math.hypot(px - d.exitX, pz - d.exitZ) < 3.4) return { label: 'sair', run: () => leaveShop(d) };
    return null;
  }
  for (const d of doors) if (Math.hypot(px - d.fx, pz - d.fz) < 3.6) return { label: 'entrar: ' + d.name, run: () => enterShop(d) };
  const j = nearestJet(5.5); if (j) return { label: 'pegar jet ski', run: () => enterJet(j) };
  let best = null, bd = 4.2;
  for (const c of cars) { if (c.mode === 'wreck') continue; const dd = Math.hypot(c.x - px, c.z - pz); if (dd < bd) { bd = dd; best = c; } }
  if (best) return { label: best.driver ? 'roubar carro' : 'entrar no carro', run: () => enterCar(best) };
  return null;
}
function toggleCar() { const it = findInteraction(); if (it) it.run(); }

/* ---------------- população dinâmica ---------------- */
let popT = 0;
function pickAnySpot(minD, maxD) {
  const P = pursuit(), zones = ['city', 'city', 'city', 'beach', 'rural'];
  for (let t = 0; t < 40; t++) {
    const zone = choice(zones), list = walkSpots[zone]; if (!list.length) continue;
    const sp = list[(Math.random() * list.length) | 0], d = Math.hypot(sp.x - P.x, sp.z - P.z);
    if (d >= minD && d <= maxD) return { x: sp.x, z: sp.z, zone };
  }
  return null;
}
function relocateCar(c) {
  const P = pursuit();
  for (let t = 0; t < 30; t++) {
    const sp = roadSpots[(Math.random() * roadSpots.length) | 0], dir = Math.random() < 0.5 ? 1 : -1, tmp = {}; placeOnEdge(tmp, sp.e, sp.s, dir);
    const d = Math.hypot(tmp.x - P.x, tmp.z - P.z); if (d < 110 || d > 290) continue;
    if (cars.some(o => o !== c && Math.hypot(o.x - tmp.x, o.z - tmp.z) < 10)) continue;
    placeOnEdge(c, sp.e, sp.s, dir); c.speed = Math.min(sp.e.speed * c.spf, c.maxSpeed * 0.8); c.stuckT = 0; c.rev = 0; c.ghost = 0; c.y = groundH(c.x, c.z); c.prevH = c.h; return true;
  }
  return false;
}
function popTick() {
  const P = pursuit(); let moved = 0;
  for (const c of chars) {
    if (c.type !== 'npc' || c.role || !c.alive || c.model === 'cow' || moved >= 3) continue;
    if (Math.hypot(c.x - P.x, c.z - P.z) > 250) {
      const sp = pickAnySpot(70, 210); if (!sp) continue;
      Object.assign(c, { x: sp.x, z: sp.z, zone: sp.zone, tgt: null, flee: 0, vx: 0, vz: 0, wait: 0, stun: 0 }); c.y = groundH(sp.x, sp.z); moved++;
    }
  }
  let cm = 0;
  for (const c of cars) if (c.mode === 'traffic' && cm < 2 && Math.hypot(c.x - P.x, c.z - P.z) > 380) { if (relocateCar(c)) cm++; }
}

/* ---------------- mapa grande (tecla N) ---------------- */
let bigOpen = false;
function drawBigMap() {
  const cv = $('bigcanvas'), S = Math.min((innerWidth - 60) / mapCanvas.width, (innerHeight - 80) / mapCanvas.height);
  cv.width = Math.round(mapCanvas.width * S); cv.height = Math.round(mapCanvas.height * S);
  const c = cv.getContext('2d'); c.drawImage(mapCanvas, 0, 0, cv.width, cv.height);
  const X = x => (x + HALF_X) * S, Z = z => (z + HALF_Z) * S, dot = (x, z, col, r) => { c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(X(x), Z(z), r, 0, 7); c.fill(); c.stroke(); };
  for (const d of doors) { dot(d.fx, d.fz, '#ff8a1a', 5); c.fillStyle = '#fff'; c.font = 'bold 12px Arial'; c.strokeStyle = '#000'; c.lineWidth = 3; c.strokeText(d.name, X(d.fx) + 8, Z(d.fz) + 4); c.fillText(d.name, X(d.fx) + 8, Z(d.fz) + 4); }
  for (const j of jets) dot(j.x, j.z, '#19e0ff', 4);
  for (const p of pickups) if (p.kind === 'health' && p.g.visible) dot(p.x, p.z, '#2ee06a', 4);
  for (const cc of cars) if (cc.cop && cc.mode !== 'wreck') dot(cc.x, cc.z, '#ff3030', 5);
  const P = pursuit(), f = fwdOf(player.inCar ? player.inCar.h : player.h), px = X(P.x), pz = Z(P.z);
  c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.moveTo(px + f.x * 14, pz + f.z * 14); c.lineTo(px - f.x * 8 - f.z * 8, pz - f.z * 8 + f.x * 8); c.lineTo(px - f.x * 8 + f.z * 8, pz - f.z * 8 - f.x * 8); c.closePath(); c.fill(); c.stroke();
}
function toggleBigMap() { bigOpen = !bigOpen; $('bigmap').style.display = bigOpen ? 'flex' : 'none'; if (bigOpen) drawBigMap(); }
addEventListener('keydown', e => { if (e.code === 'KeyN' && !paused) toggleBigMap(); });

/* ---------------- personagem do jogador: Remy (modelo com esqueleto + animações) ---------------- */
const remy = { on: false, airT: 0 };
const _ra = new THREE.Vector3(), _rb = new THREE.Vector3(), _rq = new THREE.Quaternion(), _rp = new THREE.Quaternion(), _rt = new THREE.Quaternion(), _rd = new THREE.Vector3(), _rd2 = new THREE.Vector3();
function aimBone(bone, child, dir, w = 1) { // gira o osso para que o trecho osso->filho aponte na direção (em coordenadas do mundo)
  bone.getWorldPosition(_ra); child.getWorldPosition(_rb); _rb.sub(_ra).normalize();
  _rq.setFromUnitVectors(_rb, dir); if (w < 1) _rq.slerp(_rt.identity(), 1 - w);
  bone.parent.getWorldQuaternion(_rp); _rt.copy(_rp).invert().multiply(_rq).multiply(_rp);
  bone.quaternion.premultiply(_rt); bone.updateWorldMatrix(false, true);
}
async function loadRemy() {
  try {
    const [obj, aj] = await Promise.all([new FBXLoader().loadAsync('assets/Remy.fbx'), fetch('assets/remy_anims.json').then(r => r.json())]);
    const box = new THREE.Box3().setFromObject(obj), S = 1.8 / (box.max.y - box.min.y), k = 1 / S;
    obj.scale.setScalar(S); obj.rotation.y = Math.PI; // o modelo olha para +z; o jogo usa -z como frente
    obj.traverse(o => {
      if (!o.isMesh) return; o.castShadow = true; o.frustumCulled = false;
      const conv = m => { const hair = /Hair|Eyelash/i.test(m.name), n = new THREE.MeshStandardMaterial({ name: m.name, map: m.map || null, normalMap: m.normalMap || null, color: m.map ? 0xffffff : m.color, roughness: 0.8, metalness: 0, alphaTest: hair ? 0.3 : 0, side: hair ? THREE.DoubleSide : THREE.FrontSide }); if (n.map) n.map.colorSpace = THREE.SRGBColorSpace; return n; };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    });
    const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.add(obj); scene.add(g);
    const B = n => obj.getObjectByName('mixamorig' + n);
    remy.b = { rA: B('RightArm'), rF: B('RightForeArm'), rH: B('RightHand'), lA: B('LeftArm'), lF: B('LeftForeArm'), lH: B('LeftHand'), rU: B('RightUpLeg'), rL: B('RightLeg'), rT: B('RightFoot'), lU: B('LeftUpLeg'), lL: B('LeftLeg'), lT: B('LeftFoot') };
    const mixer = remy.mixer = new THREE.AnimationMixer(obj), clip = n => THREE.AnimationClip.parse(aj[n]);
    const jump = clip('jump'), idle = aj.idle ? clip('idle') : THREE.AnimationUtils.subclip(jump, 'idle', 0, 3, 30);
    remy.act = { idle: mixer.clipAction(idle), walk: mixer.clipAction(clip('walk')), run: mixer.clipAction(clip('run')), jump: mixer.clipAction(jump) };
    for (const n of ['pistol', 'punch', 'swim']) if (aj[n]) remy.act[n] = mixer.clipAction(clip(n));
    if (remy.act.punch) { remy.act.punch.paused = true; remy.punchDur = aj.punch.duration; }
    for (const n in remy.act) { const a = remy.act[n]; a.play(); a.setEffectiveWeight(n === 'idle' ? 1 : 0); }
    remy.act.jump.paused = true; remy.jumpDur = jump.duration;
    // armas na mão direita (o osso da mão aponta para os dedos em +Y; o cano segue essa direção)
    const hand = remy.b.rH, guns = {};
    for (const wk in WEAP) {
      const W = WEAP[wk]; if (!W.fire) continue; let m;
      if (hasModel(W.model)) {
        const M = AS.models[W.model], sc = W.len / M.size[0], hgt = M.size[1] * sc, oy = W.len * (0.5 - W.grip) + 0.09, tc = new THREE.Color();
        m = new THREE.Mesh(modelGeo(W.model, sc, () => true, g => tc.set('#' + g.color).multiplyScalar(2.6).addScalar(0.02).getHex(), v => [v[2], v[0], v[1]]), humanMat);
        m.position.set(0, oy * k, (-hgt * 0.62 + 0.03) * k); m.userData.mz = [0, (W.len * 0.5 + oy + 0.03) * k, (hgt * 0.2 + 0.03) * k];
      } else { m = new THREE.Mesh(mergeParts([part(UG.box, 0x23262b, 0, 0.13, 0.03, 0.05, 0.3, 0.09), part(UG.box, 0x3a3d44, 0, 0.0, -0.045, 0.05, 0.1, 0.13)]), humanMat); m.position.set(0, 0.09 * k, 0.03 * k); m.userData.mz = [0, 0.45 * k, 0.03 * k]; }
      m.scale.setScalar(k); m.castShadow = true; m.name = 'w_' + wk; hand.add(m);
      const mz = new THREE.Object3D(); mz.position.fromArray(m.userData.mz); hand.add(mz); m.userData.muzzle = mz; guns[wk] = m;
    }
    const gun = guns.gun, muzzle = gun.userData.muzzle;
    const bat = new THREE.Mesh(mergeParts([part(UG.cyl, 0x222222, 0, 0.02, 0, 0.035, 0.24, 0.035), part(UG.cyl, 0xc8a26a, 0, 0.4, 0, 0.04, 0.55, 0.04), part(UG.cyl, 0xc8a26a, 0, 0.82, 0, 0.065, 0.4, 0.065)]), humanMat); bat.scale.setScalar(k); bat.position.set(0, 0.08 * k, 0.03 * k); bat.castShadow = true; bat.name = 'w_bat'; hand.add(bat);
    const dm = () => new THREE.Object3D();
    g.visible = player.mesh.visible; g.position.copy(player.mesh.position); scene.remove(player.mesh);
    player.mesh = g; player.parts = { g, legL: dm(), legR: dm(), armL: dm(), armR: dm(), muzzle, gun, guns, bat };
    remy.obj = obj; remy.aj = aj; remy.on = true; showWeapon();
  } catch (e) { console.warn('Remy não carregou; usando o boneco simples.', e); }
}
function updateRemy(dt) {
  if (!remy.on) return;
  const p = player, A = remy.act, b = remy.b, moto = p.inCar && p.inCar.isMoto, seated = moto || !!p.onJet, veh = p.inCar || p.onJet;
  const sp = veh ? 0 : Math.hypot(p.mx, p.mz), air = !veh && !p.swim && p.alive && p.y - groundH(p.x, p.z) > 0.3;
  remy.airT = air ? remy.airT + dt : 0;
  const swim = !!p.swim && !!A.swim, punching = !!A.punch && p.atk && p.atk.kind !== 'bat' && p.atk.kind !== 'jabL' && sp < 1.5 && !air;
  const aimStand = !!A.pistol && isFire() && p.aim > 0 && sp < 0.5 && !air && !veh && !swim;
  const loco = !(swim || air || punching || aimStand), wRun = loco ? smooth(2.2, 4.2, sp) : 0;
  const tgt = { run: wRun, walk: loco && sp >= 0.3 ? 1 - wRun : 0, idle: loco && sp < 0.3 ? 1 : 0, jump: air && !swim ? 1 : 0, swim: swim ? 1 : 0, punch: punching ? 1 : 0, pistol: aimStand ? 1 : 0 }, kk = Math.min(1, dt * 11);
  for (const n in A) A[n].setEffectiveWeight(A[n].getEffectiveWeight() + ((tgt[n] || 0) - A[n].getEffectiveWeight()) * kk);
  A.run.timeScale = clamp(sp / 5.3, 0.6, 1.7); A.walk.timeScale = clamp(sp / 1.68, 0.6, 2.2);
  A.jump.time = clamp(0.62 + remy.airT * 0.85, 0, remy.jumpDur - 0.05);
  if (A.swim) A.swim.timeScale = 0.5 + Math.min(1, sp / 3.6) * 1.2;
  if (punching) A.punch.time = clamp(p.atk.t / p.atk.dur, 0, 1) * (remy.punchDur - 0.05);
  remy.mixer.update(dt);
  if (swim) { p.mesh.rotation.x = 0; p.mesh.position.y = p.y - 0.05; } // a animação de nado já deixa o corpo deitado
  remy.clipPose = swim || punching || aimStand;
  if (!p.alive) return;
  p.mesh.updateMatrixWorld(true);
  const f = fwdOf(p.h + (p.atkYaw || 0)), F = _rd.set(f.x, 0, f.z), dir = (fx, uy, sx = 0) => _rd2.set(F.x * fx - F.z * sx, uy, F.z * fx + F.x * sx).normalize();
  if (seated) { // sentado na moto / jet ski
    for (const [U, L, T, sd] of [[b.rU, b.rL, b.rT, 1], [b.lU, b.lL, b.lT, -1]]) { aimBone(U, L, dir(0.85, -0.42, sd * 0.3)); aimBone(L, T, dir(-0.15, -1, sd * 0.05)); }
    for (const [Ar, Fo, Ha, sd] of [[b.rA, b.rF, b.rH, 1], [b.lA, b.lF, b.lH, -1]]) { if (sd > 0 && p.onJet && p.aim > 0 && isFire()) { camera.getWorldDirection(_rd2); aimBone(Ar, Fo, _rd2); aimBone(Fo, Ha, _rd2); continue; } aimBone(Ar, Fo, dir(0.7, -0.62, sd * 0.12)); aimBone(Fo, Ha, dir(0.95, -0.15, -sd * 0.08)); }
  } else if (veh || p.swim || remy.clipPose) { /* carro, nado, soco ou mira parado: a animação resolve */ }
  else if (p.atk) {
    const a = p.atk, t = clamp(a.t / a.dur, 0, 1);
    if (a.kind === 'bat') { const ang = t < 0.3 ? 0.4 + 1.9 * (t / 0.3) : t < 0.7 ? 2.3 - 2.9 * ((t - 0.3) / 0.4) : -0.6 + 0.9 * ((t - 0.7) / 0.3), d = dir(Math.cos(ang), Math.sin(ang), 0.15); aimBone(b.rA, b.rF, d); aimBone(b.rF, b.rH, d); }
    else {
      const e = Math.sin(Math.min(1, t / 0.9) * Math.PI), right = a.kind !== 'jabL', hk = a.kind === 'hook' ? 0.5 : 0;
      for (const [Ar, Fo, Ha, sd] of [[b.rA, b.rF, b.rH, 1], [b.lA, b.lF, b.lH, -1]]) { const x = (sd > 0) === right ? e : 0; aimBone(Ar, Fo, dir(0.3 + 0.9 * x, -0.9 + 0.85 * x, sd * (0.25 - hk * x))); aimBone(Fo, Ha, dir(0.55 + 0.6 * x, 0.75 * (1 - x), -sd * (0.2 + hk * x))); }
    }
  }
  else if (isFire() && p.aim > 0) { camera.getWorldDirection(_rd2); aimBone(b.rA, b.rF, _rd2); aimBone(b.rF, b.rH, _rd2); if (WEAP[weapon].long) { aimBone(b.lA, b.lF, dir(0.75, -0.25, 0.5)); aimBone(b.lF, b.lH, dir(0.7, 0.1, 0.65)); } }
  else if (weapon === 'fist') { for (const [Ar, Fo, Ha, sd] of [[b.rA, b.rF, b.rH, 1], [b.lA, b.lF, b.lH, -1]]) { aimBone(Ar, Fo, dir(0.35, -0.9, sd * 0.25), 0.85); aimBone(Fo, Ha, dir(0.55, 0.75, -sd * 0.2), 0.85); } }
  else if (weapon === 'bat') { aimBone(b.rA, b.rF, dir(0.3, -0.95, 0.2), 0.8); aimBone(b.rF, b.rH, dir(0.75, 0.6, 0.1), 0.8); }
}

/* ---------------- multijogador (PeerJS) — versão 1: jogadores se veem e lutam entre si ---------------- */
const MP = { on: false, host: false, peer: null, conns: new Map(), hostConn: null, id: null, room: null, name: 'Jogador', players: new Map(), sendT: 0, lastHit: null };
const ROOM_PREFIX = 'pedrocity-v1-', MP_COLS = ['#ff4d6d', '#4dd0ff', '#ffd23f', '#7cf27c', '#c77dff', '#ff9f43'];
const mpStatus = t => { const e = $('mpStatus'); if (e) e.textContent = t; };
function mpRaw(msg, except) { // anfitrião repassa para todos; convidado fala só com o anfitrião
  if (!MP.on) return;
  if (MP.host) { for (const [id, c] of MP.conns) if (id !== except && c.open) c.send(msg); }
  else if (MP.hostConn && MP.hostConn.open) MP.hostConn.send(msg);
}
function mpEvent(msg) { if (!MP.on) return; msg.id = MP.id; mpRaw(msg); }
function mpInfo() {
  const e = $('mpInfo'); if (!e) return;
  if (!MP.on) { e.style.display = 'none'; return; }
  e.style.display = 'block'; e.innerHTML = 'SALA <b>' + MP.room + '</b> · ' + (MP.players.size + 1) + ' jogador' + (MP.players.size ? 'es' : '') + [...MP.players.values()].map(p => ' · <span style="color:' + p.col + '">' + p.name.replace(/[<>&]/g, '') + '</span>').join('');
}
function mpRemove(id) {
  const rp = MP.players.get(id); if (!rp) return;
  if (rp.av) { scene.remove(rp.av.g); if (rp.av.tag) { rp.av.tag.material.map.dispose(); rp.av.tag.material.dispose(); } }
  if (rp.veh) scene.remove(rp.veh.g);
  MP.players.delete(id); toast(rp.name + ' saiu', 2000); mpInfo();
}
function mpHandle(m) {
  if (!m || m.id === MP.id) return;
  if (m.t === 's') {
    let rp = MP.players.get(m.id);
    if (!rp) { rp = { id: m.id, name: String(m.n || 'Jogador').slice(0, 12), col: MP_COLS[MP.players.size % MP_COLS.length], st: null, x: m.x, y: m.y, z: m.z, h: m.h, px: m.x, py: m.y, pz: m.z, ph: m.h, t0: 0, av: null, veh: null, vehKey: '' }; MP.players.set(m.id, rp); toast(rp.name + ' entrou na sala', 2200); mpInfo(); }
    rp.px = rp.x; rp.py = rp.y; rp.pz = rp.z; rp.ph = rp.h; rp.t0 = performance.now(); rp.st = m;
    if (Math.hypot(m.x - rp.x, m.z - rp.z) > 30) { rp.x = rp.px = m.x; rp.y = rp.py = m.y; rp.z = rp.pz = m.z; } // teleporte (loja, respawn)
  } else if (m.t === 'f') {
    const o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
    for (const d of m.ds) { spawnBullet(o, new THREE.Vector3(d[0], d[1], d[2]), m.sp, 'remote', m.dm); bullets[bullets.length - 1].from = m.id; }
    sfx('shot', m.o[0], m.o[2]);
  } else if (m.t === 'm') {
    if (state !== 'play' || player.inCar || player.onJet) return;
    const f = fwdOf(m.h), dx = player.x - m.x, dz = player.z - m.z, d = Math.hypot(dx, dz);
    if (d < m.r && Math.abs(player.y - m.y) < 1.6 && (d < 0.4 || (dx * f.x + dz * f.z) / d > m.c)) { MP.lastHit = { id: m.id, t: T }; damageChar(player, m.dm, false, f.x * m.kn, f.z * m.kn); player.vy = 3; sfx('hit', player.x, player.z); shake = Math.max(shake, 0.3); }
  } else if (m.t === 'k') { toast(m.by ? m.by + ' eliminou ' + m.n : m.n + ' morreu', 3000); }
  else if (m.t === 'bye') mpRemove(m.who);
  else if (m.t === 'full') { mpStatus('Sala cheia (máximo de 5 jogadores).'); mpLeave(); }
}
function mpLeave() { try { if (MP.peer) MP.peer.destroy(); } catch (e) { /* ignora */ } for (const id of [...MP.players.keys()]) mpRemove(id); MP.on = false; MP.peer = null; MP.conns.clear(); MP.hostConn = null; mpInfo(); }
function mpStart(asHost, code) {
  if (typeof Peer === 'undefined') { mpStatus('Biblioteca de rede não carregou (sem internet?).'); return; }
  if (MP.peer) mpLeave();
  MP.name = (($('mpName') && $('mpName').value.trim()) || 'Jogador').slice(0, 12); try { localStorage.setItem('pedro_nome', MP.name); } catch (e) { /* ignora */ }
  MP.host = asHost; MP.room = asHost ? Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(4, 'X') : code.toUpperCase();
  mpStatus(asHost ? 'Criando sala...' : 'Entrando na sala ' + MP.room + '...');
  const popt = { config: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] } };
  const peer = MP.peer = asHost ? new Peer(ROOM_PREFIX + MP.room, popt) : new Peer(popt);
  setTimeout(() => { if (MP.peer === peer && !peer.open && !peer.destroyed) mpStatus('Sem resposta do servidor de salas. Confira a internet e tente de novo.'); }, 12000);
  peer.on('error', err => {
    if (err.type === 'unavailable-id' && asHost) { mpStart(true); return; }
    mpStatus(err.type === 'peer-unavailable' ? 'Sala ' + MP.room + ' não encontrada.' : 'Erro de rede: ' + err.type);
    if (!MP.on) { try { peer.destroy(); } catch (e) { /* ignora */ } MP.peer = null; }
  });
  peer.on('open', id => {
    MP.id = id;
    if (asHost) {
      MP.on = true; mpInfo(); mpStatus('Sala criada! Código: ' + MP.room + '  —  passe para seus amigos e clique em JOGAR.');
      try { history.replaceState(null, '', '?sala=' + MP.room); } catch (e) { /* ignora */ }
      peer.on('connection', conn => {
        conn.on('open', () => {
          if (MP.conns.size >= 4) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
          MP.conns.set(conn.peer, conn);
        });
        conn.on('data', m => { if (!m || typeof m !== 'object') return; m.id = conn.peer; mpHandle(m); mpRaw(m, conn.peer); });
        conn.on('close', () => { MP.conns.delete(conn.peer); mpRemove(conn.peer); mpRaw({ t: 'bye', id: MP.id + '-sys', who: conn.peer }); });
      });
    } else {
      const conn = MP.hostConn = peer.connect(ROOM_PREFIX + MP.room, { reliable: true });
      conn.on('open', () => { MP.on = true; mpInfo(); mpStatus('Conectado à sala ' + MP.room + '! Clique em JOGAR.'); });
      setTimeout(() => { // a conexão é direta entre os computadores: algumas redes bloqueiam
        if (MP.peer !== peer || conn.open) return; const pc = conn.peerConnection, ice = pc ? pc.iceConnectionState : 'sem resposta';
        mpStatus('Não deu para ligar direto com o anfitrião (' + ice + '). A rede de um dos dois está bloqueando.'); console.warn('[mp] falha ao conectar', ice, pc && pc.connectionState);
        try { peer.destroy(); } catch (e) { /* ignora */ } MP.peer = null;
      }, 15000);
      conn.on('data', mpHandle);
      conn.on('close', () => { toast('O anfitrião saiu: a sala fechou', 4000); mpLeave(); });
    }
  });
}
addEventListener('beforeunload', () => { try { if (MP.peer) MP.peer.destroy(); } catch (e) { /* ignora */ } });

// ---- envio do meu estado (12 vezes por segundo) ----
const r2 = v => Math.round(v * 100) / 100;
function mpNet(dt) {
  if (!MP.on) return; MP.sendT -= dt; if (MP.sendT > 0) return; MP.sendT = 0.08;
  const car = player.inCar, jet = player.onJet, veh = car || jet;
  const air = !veh && !player.swim && player.y - groundH(player.x, player.z) > 0.3;
  mpEvent({
    t: 's', n: MP.name, x: r2(player.x), y: r2(veh ? (car ? car.ys : jet.y) : player.y), z: r2(player.z), h: r2(veh ? veh.h : player.h), sp: r2(veh ? Math.abs(veh.speed) : Math.hypot(player.mx, player.mz)),
    f: (air ? 1 : 0) | (player.swim ? 2 : 0) | (player.aim > 0 ? 4 : 0) | (player.alive ? 8 : 0), w: weapon, at: player.atk ? player.atk.kind : 0, ap: r2(camPitch), hp: Math.max(0, player.hp | 0),
    v: car ? { k: car.isMoto ? 'moto' : 'car', ty: car.type, co: car.color, cop: car.cop ? 1 : 0, pi: r2(car.pitch), ro: r2(car.isMoto ? car.roll : car.slopeRoll) } : jet ? { k: 'jet', co: jet.color, pi: r2(jet.pitch), ro: r2(jet.roll) } : 0
  });
}
// ---- avatar de outro jogador: clone do Remy com esqueleto e animações próprias ----
function mpAvatar(rp) {
  if (!remy.on) return null;
  const obj = skClone(remy.obj), g = new THREE.Group(); g.rotation.order = 'YXZ'; g.add(obj); scene.add(g);
  obj.traverse(o => { if (!o.isMesh) return; o.frustumCulled = false; if (o.name === 'Tops') { const cm = m => { const n = m.clone(); n.color.set(rp.col).lerp(new THREE.Color(0xffffff), 0.25); return n; }; o.material = Array.isArray(o.material) ? o.material.map(cm) : cm(o.material); } });
  const B = n => obj.getObjectByName('mixamorig' + n), mixer = new THREE.AnimationMixer(obj), act = {};
  for (const n of ['idle', 'walk', 'run', 'jump', 'pistol', 'punch', 'swim']) if (remy.aj[n]) { act[n] = mixer.clipAction(THREE.AnimationClip.parse(remy.aj[n])); act[n].play(); act[n].setEffectiveWeight(n === 'idle' ? 1 : 0); }
  if (act.jump) { act.jump.paused = true; act.jump.time = 1.0; }
  const guns = {}; for (const k in WEAP) if (WEAP[k].fire) guns[k] = obj.getObjectByName('w_' + k);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const cx = cv.getContext('2d');
  cx.font = 'bold 34px Arial'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.lineWidth = 6; cx.strokeStyle = '#000'; cx.strokeText(rp.name, 128, 34); cx.fillStyle = rp.col; cx.fillText(rp.name, 128, 34);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthWrite: false })); tag.scale.set(1.9, 0.48, 1); tag.position.y = 2.15; g.add(tag);
  return { g, obj, mixer, act, guns, bat: obj.getObjectByName('w_bat'), tag, b: { rA: B('RightArm'), rF: B('RightForeArm'), rH: B('RightHand'), lA: B('LeftArm'), lF: B('LeftForeArm'), lH: B('LeftHand'), rU: B('RightUpLeg'), rL: B('RightLeg'), rT: B('RightFoot'), lU: B('LeftUpLeg'), lL: B('LeftLeg'), lT: B('LeftFoot') } };
}
function mpUpdate(dt) {
  if (!MP.on) return; const now = performance.now();
  for (const rp of MP.players.values()) {
    const st = rp.st; if (!st) continue;
    const a = clamp((now - rp.t0) / 100, 0, 1.25); // interpola entre os dois últimos pacotes
    rp.x = rp.px + (st.x - rp.px) * a; rp.y = rp.py + (st.y - rp.py) * a; rp.z = rp.pz + (st.z - rp.pz) * a; rp.h = rp.ph + wrap(st.h - rp.ph) * Math.min(1, a);
    // veículo do outro jogador (só visual, sem IA)
    const v = st.v, key = v ? v.k + (v.ty || '') + v.co + (v.cop || 0) : '';
    if (key !== rp.vehKey) {
      if (rp.veh) scene.remove(rp.veh.g); rp.veh = null; rp.vehKey = key;
      if (v) { if (v.k === 'jet') rp.veh = { g: makeJetMesh(v.co), wheels: [], wr: 1 }; else if (VEH[v.ty]) { const cm = makeCarMesh(v.co, !!v.cop, v.ty); rp.veh = { g: cm.g, wheels: cm.wheels, wr: cm.wr, V: VEH[v.ty] }; if (v.k === 'moto') cm.g.rotation.order = 'YXZ'; } }
    }
    if (rp.veh) { rp.veh.g.position.set(rp.x, rp.y, rp.z); rp.veh.g.rotation.set(v.pi || 0, rp.h, v.ro || 0, 'YXZ'); for (const w of rp.veh.wheels) w.rotation.x -= st.sp * dt / rp.veh.wr; }
    // atropelamento: vale no computador de quem é atingido
    if (rp.veh && rp.veh.V && st.sp > 3 && state === 'play' && !player.inCar && !player.onJet && !(player.invuln > 0)) {
      const f = fwdOf(rp.h), dx = player.x - rp.x, dz = player.z - rp.z, fw = dx * f.x + dz * f.z, lt = dx * -f.z + dz * f.x;
      if (Math.abs(lt) < rp.veh.V.hw + 0.4 && Math.abs(fw) < rp.veh.V.L / 2 + 0.3 && Math.abs(player.y - rp.y) < 1.5) { MP.lastHit = { id: rp.id, t: T }; damageChar(player, Math.min(st.sp * 2, 30), false, f.x * st.sp * 0.9, f.z * st.sp * 0.9); player.invuln = 1; player.vy = 3 + st.sp * 0.15; shake = Math.max(shake, 0.4); sfx('hit', player.x, player.z); }
    }
    if (!rp.av) { rp.av = mpAvatar(rp); if (!rp.av) continue; }
    const av = rp.av, A = av.act, b = av.b, alive = !!(st.f & 8), air = !!(st.f & 1), swim = !!(st.f & 2), aim = !!(st.f & 4), fireW = !!(WEAP[st.w] && WEAP[st.w].fire), seated = v && (v.k === 'moto' || v.k === 'jet');
    av.g.visible = !(v && v.k === 'car');
    if (!av.g.visible) continue;
    for (const k in av.guns) if (av.guns[k]) av.guns[k].visible = k === st.w; if (av.bat) av.bat.visible = st.w === 'bat';
    const sp = v ? 0 : st.sp, punching = !!A.punch && st.at && st.at !== 'bat' && st.at !== 'jabL' && sp < 1.5, aimStand = !!A.pistol && fireW && aim && sp < 0.5 && !air && !v && !swim;
    const loco = !(swim || air || punching || aimStand), wRun = loco ? smooth(2.2, 4.2, sp) : 0;
    const tgt = { run: wRun, walk: loco && sp >= 0.3 ? 1 - wRun : 0, idle: loco && sp < 0.3 ? 1 : 0, jump: air && !swim ? 1 : 0, swim: swim ? 1 : 0, punch: punching ? 1 : 0, pistol: aimStand ? 1 : 0 }, kk = Math.min(1, dt * 11);
    for (const n in A) A[n].setEffectiveWeight(A[n].getEffectiveWeight() + ((tgt[n] || 0) - A[n].getEffectiveWeight()) * kk);
    if (A.run) A.run.timeScale = clamp(sp / 5.3, 0.6, 1.7); if (A.walk) A.walk.timeScale = clamp(sp / 1.68, 0.6, 2.2); if (A.swim) A.swim.timeScale = 0.5 + Math.min(1, sp / 3.6) * 1.2;
    av.mixer.update(dt);
    const f = fwdOf(rp.h);
    if (seated) av.g.position.set(rp.x - f.x * 0.42, rp.y + 0.02, rp.z - f.z * 0.42); else av.g.position.set(rp.x, swim ? rp.y - 0.05 : rp.y, rp.z);
    av.g.rotation.y = rp.h; av.g.rotation.x += ((alive ? (seated ? (v.pi || 0) - 0.15 : 0) : -Math.PI / 2) - av.g.rotation.x) * Math.min(1, dt * 8); if (!alive) av.g.position.y += 0.18;
    if (!alive) continue;
    av.g.updateMatrixWorld(true);
    const F = _rd.set(f.x, 0, f.z), dir = (fx, uy, sx = 0) => _rd2.set(F.x * fx - F.z * sx, uy, F.z * fx + F.x * sx).normalize();
    if (seated) {
      for (const [U, L, Tt, sd] of [[b.rU, b.rL, b.rT, 1], [b.lU, b.lL, b.lT, -1]]) { aimBone(U, L, dir(0.85, -0.42, sd * 0.3)); aimBone(L, Tt, dir(-0.15, -1, sd * 0.05)); }
      for (const [Ar, Fo, Ha, sd] of [[b.rA, b.rF, b.rH, 1], [b.lA, b.lF, b.lH, -1]]) { aimBone(Ar, Fo, dir(0.7, -0.62, sd * 0.12)); aimBone(Fo, Ha, dir(0.95, -0.15, -sd * 0.08)); }
    } else if (swim || punching || aimStand) { /* a animação resolve */ }
    else if (st.at === 'bat') { const d = dir(0.6, 0.5, 0.15); aimBone(b.rA, b.rF, d); aimBone(b.rF, b.rH, d); }
    else if (st.at === 'jabL') { aimBone(b.lA, b.lF, dir(1, -0.1, -0.1)); aimBone(b.lF, b.lH, dir(1, 0, 0)); }
    else if (fireW && aim) { const d = dir(Math.cos(st.ap || 0), -Math.sin(st.ap || 0)); aimBone(b.rA, b.rF, d); aimBone(b.rF, b.rH, d); }
    else if (st.w === 'bat') { aimBone(b.rA, b.rF, dir(0.3, -0.95, 0.2), 0.8); aimBone(b.rF, b.rH, dir(0.75, 0.6, 0.1), 0.8); }
  }
}
// ---- menu ----
{
  const nm = $('mpName'); if (nm) { try { nm.value = localStorage.getItem('pedro_nome') || ''; } catch (e) { /* ignora */ } }
  const box = $('mp'); if (box) for (const ev of ['click', 'mousedown', 'keydown', 'keyup']) box.addEventListener(ev, e => e.stopPropagation());
  if ($('mpHost')) $('mpHost').onclick = () => mpStart(true);
  if ($('mpJoin')) $('mpJoin').onclick = () => { const c = ($('mpCode').value || '').trim(); if (c.length < 3) { mpStatus('Digite o código da sala.'); return; } mpStart(false, c); };
  const q = /[?&]sala=([A-Za-z0-9]{3,6})/.exec(location.search); if (q && $('mpCode')) { $('mpCode').value = q[1].toUpperCase(); mpStatus('Convite para a sala ' + q[1].toUpperCase() + ': escreva seu nome e clique em ENTRAR.'); }
}

/* ---------------- loop principal ---------------- */
let last = performance.now(), trafficT = 0;
const clock = { acc: 0 };
let fpsN = 0, fpsT = 0, fpsVal = 60, fpsShow = false, adaptCool = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now;
  if (!paused) update(dt);
  mpNet(raw);
  renderer.render(scene, camera);
  // mede o FPS e ajusta a resolução sozinho para manter o jogo fluido
  fpsN++; fpsT += raw;
  if (fpsT >= 1) {
    fpsVal = fpsN / fpsT; fpsN = 0; fpsT = 0; adaptCool--;
    if (!paused && adaptCool <= 0 && document.visibilityState === 'visible') {
      if (fpsVal < 45 && resScale > 0.55) { resScale = Math.max(0.55, resScale - 0.1); adaptCool = 2; renderer.setPixelRatio(BASE_PR * resScale); if (fpsVal < 30) treeNear = Math.max(90, treeNear - 30); }
      else if (fpsVal > 57 && resScale < 1) { resScale = Math.min(1, resScale + 0.05); adaptCool = 4; renderer.setPixelRatio(BASE_PR * resScale); }
    }
    if (fpsShow) $('fps').textContent = Math.round(fpsVal) + ' FPS · ' + QUAL.label + ' · res ' + Math.round(resScale * 100) + '%';
  }
}
addEventListener('keydown', e => {
  if (e.code === 'KeyP') { fpsShow = !fpsShow; $('fps').style.display = fpsShow ? 'block' : 'none'; }
  if (e.code === 'KeyG' && !paused) { const order = ['baixa', 'media', 'alta'], nx = order[(order.indexOf(QNAME) + 1) % 3]; try { localStorage.setItem('pedro_q', nx); } catch (er) { /* ignora */ } location.search = ''; location.reload(); }
});
const PROF = {}; let _pt = 0; const lap = k => { const n = performance.now(); PROF[k] = (PROF[k] || 0) + n - _pt; _pt = n; };
function update(dt) {
  T += dt; _pt = performance.now();
  // jogador
  if (state === 'play') {
    if (player.inCar) {
      const c = player.inCar; player.x = c.x; player.z = c.z; player.y = c.y; player.mx = player.mz = 0;
    } else if (player.onJet) syncPlayerOnJet(dt);
    else updatePlayerFoot(dt);
    if (player.inCar || player.onJet) $('interact').style.display = 'none';
  } else if (state === 'dead') deadPose(player, dt);
  lap('player');
  // mundo
  { const P = pursuit();
    for (const c of chars.slice()) {
      if (c.type === 'player') continue;
      const d2 = (c.x - P.x) ** 2 + (c.z - P.z) ** 2, far = d2 > QUAL.npcDist * QUAL.npcDist;
      c.mesh.visible = !far && !(c.role && player.inside !== c.door);
      if (far && c.type === 'npc') continue;
      if (c.type === 'npc') updateNPC(c, dt); else if (c.type === 'cop') updateCop(c, dt);
    } }
  lap('chars'); separateChars(); lap('separate');
  { const P = pursuit(); for (const c of cars.slice()) { const d2 = (c.x - P.x) ** 2 + (c.z - P.z) ** 2; c.mesh.visible = d2 < 330 * 330; if (d2 > 420 * 420 && c.mode === 'traffic') continue; updateCar(c, dt); } }
  for (const j of jets) if (!j.rider) updateJet(j, dt, false);
  lap('cars'); carVsCars(); lap('carVsCars');
  if (player.inCar) {
    const c = player.inCar; player.x = c.x; player.z = c.z;
    if (c.isMoto) {
      const f = fwdOf(c.h), pp = player.parts; player.mesh.position.set(c.x - f.x * 0.42, c.ys + 0.02, c.z - f.z * 0.42); player.mesh.rotation.set(c.pitch - 0.18, c.h, c.roll * 0.9, 'YXZ');
      pp.legL.rotation.x = pp.legR.rotation.x = 1.15; pp.legL.rotation.z = 0.25; pp.legR.rotation.z = -0.25; pp.armL.rotation.x = pp.armR.rotation.x = 1.1;
    }
    if (engineGain) { engineOsc.frequency.value = 45 + Math.abs(c.speed) * 4.5; engineGain.gain.value = muted ? 0 : 0.05 + Math.abs(c.speed) * 0.0015; }
  }
  updateRemy(dt); mpUpdate(dt);
  { const it = findInteraction(), el = $('interact'); if (it) { el.style.display = 'block'; const h = '<b>E</b> ' + it.label; if (el.innerHTML !== h) el.innerHTML = h; } else el.style.display = 'none'; }
  if (robbing) {
    const r = robbing; r.t -= dt; r.w.handsUp = true;
    if (!r.w.alive || player.inside !== r.d || Math.hypot(player.x - r.w.x, player.z - r.w.z) > 6) { robbing = null; r.w.handsUp = false; toast('Assalto cancelado', 1200); }
    else if (r.t <= 0) { robbing = null; completeRob(r); }
  }
  for (const d of doors) { d.marker.position.y = 7.6 + Math.sin(T * 3) * 0.3; d.marker.rotation.y += dt * 2; }
  intLight.intensity += (intTarget - intLight.intensity) * Math.min(1, dt * 6);
  lap('misc'); updateProps(dt); lap('props'); updateBullets(dt); lap('bullets'); updatePolice(dt); lap('police'); updateParts(dt); lap('parts');
  for (let i = fireballs.length - 1; i >= 0; i--) {
    const f = fireballs[i]; f.t += dt; const k = f.t / 0.7; f.m.scale.setScalar(f.r * (0.4 + k * 1.4)); f.m.material.opacity = Math.max(0, 0.95 - k);
    if (f.t > 0.7) { scene.remove(f.m); f.m.geometry.dispose(); f.m.material.dispose(); fireballs.splice(i, 1); }
  }
  muzzleLight.intensity *= Math.exp(-30 * dt);
  // pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.g.rotation.y += dt * 2; p.g.position.y = p.y + 0.9 + Math.sin(T * 3 + p.ph) * 0.15;
    if (p.t > 0) { p.t -= dt; p.g.visible = p.t <= 0; continue; }
    if (p.life > 0) { p.life -= dt; if (p.life <= 0) { scene.remove(p.g); pickups.splice(i, 1); continue; } }
    if (state !== 'play' || player.inCar || player.onJet || Math.hypot(p.x - player.x, p.z - player.z) > 1.8) continue;
    if (p.kind === 'health') { if (player.hp < player.maxhp) { player.hp = Math.min(player.maxhp, player.hp + 50); p.t = 40; p.g.visible = false; toast('+ VIDA'); } }
    else { money += p.amount; toast('+$' + p.amount, 1400); sfx('hit', p.x, p.z); if (p.respawn) { p.t = p.respawn; p.g.visible = false; } else { scene.remove(p.g); pickups.splice(i, 1); } }
  }
  // população dinâmica
  popT -= dt;
  if (popT <= 0) { popT = 0.5; popTick(); }
  trafficT -= dt;
  if (trafficT <= 0) { trafficT = 1.5; if (cars.filter(c => c.mode === 'traffic').length < 26) spawnTraffic(false); }
  lap('pickups_pop');
  updateSea(T); lap('sea'); updateTreeLOD(dt);
  for (const c of clouds) { c.position.x += dt * 3; const cx = camera.position.x, cz = camera.position.z; if (c.position.x - cx > 700) c.position.x -= 1400; if (c.position.x - cx < -700) c.position.x += 1400; if (c.position.z - cz > 700) c.position.z -= 1400; if (c.position.z - cz < -700) c.position.z += 1400; }
  lap('clouds'); updateCamera(dt); lap('camera');
  { const sx = Math.round(player.x * 2) / 2, sz = Math.round(player.z * 2) / 2; sun.target.position.set(sx, 0, sz); sun.position.set(sx + SUN_DIR.x * 140, SUN_DIR.y * 140, sz + SUN_DIR.z * 140); }
  if (sky) { sky.position.copy(camera.position); sunDisc.position.set(camera.position.x + 420, 360, camera.position.z + 250); }
  updateHUD(); lap('hud'); drawMinimap(); lap('minimap');
}
requestAnimationFrame(frame);

window.game = { MP, mpStart, renderer, treeChunks, pause: () => { paused = true; }, resume: () => { paused = false; }, remy, groundH, roadClear, pointOnEdge, lotOK, LOTSTAT, PROF, popTick, toggleBigMap, setWeapon, get weapon() { return weapon; }, startMelee, mapCanvas, terrainH, nodes, edges, decks, walkSpots, roadSpots, doors, jets, get money() { return money; }, set money(v) { money = v; }, enterShop, findInteraction, startRob, bullets, hitTest, sim: (n, dt = 0.033) => { for (let i = 0; i < n; i++) update(dt); }, THREE, scene, camera, player, chars, cars, props, buildings, get heat() { return heat; }, set heat(v) { heat = v; }, get state() { return state; }, startGame, explode, toggleCar, fire, keys, setYaw: v => { camYaw = v; }, setPitch: v => { camPitch = v; }, spawnCopCar, spawnCop };
await loadRemy();
genPhase = false;
gameReady = true; { const b = $('goBtn'); if (b) b.textContent = 'CLIQUE PARA JOGAR'; }
