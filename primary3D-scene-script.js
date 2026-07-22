(() => {
'use strict';
const CONFIG = {
triggerSelector: '.statue-trigger-section',
initDelayMs: 0,
lazyRootMargin: '20% 0px',
autoDestroyCheckMs: 1000,
showControlPanel: true,
};
if (window.BA329Scene) {
try { window.BA329Scene.destroy(); } catch (e) { console.warn(e); }
}
const canvas  = document.getElementById('gl');
const errorEl = document.getElementById('gl-error');
function showError(msg){
console.error(msg);
if (!errorEl) return;
errorEl.style.display = 'block';
errorEl.textContent += (errorEl.textContent ? '\n' : '') + msg;
}
const ctl = {
cancelled:   false,
initStarted: false,
instance:    null,
lazyIO:      null,
bootAC:      new AbortController(),
};
function startInit(){
if (ctl.initStarted || ctl.cancelled) return;
ctl.initStarted = true;
if (ctl.lazyIO){ ctl.lazyIO.disconnect(); ctl.lazyIO = null; }
initScene().catch(err => {
console.error('Scene init failed:', err);
showError('Scene init failed: ' + (err && err.message ? err.message : err));
});
}
const api = {
init(){ startInit(); },
destroy(){
ctl.cancelled = true;
if (ctl.lazyIO){ ctl.lazyIO.disconnect(); ctl.lazyIO = null; }
ctl.bootAC.abort();
if (ctl.instance){ ctl.instance.dispose(); ctl.instance = null; }
},
pause(){  ctl.instance && ctl.instance.pause();  },
resume(){ ctl.instance && ctl.instance.resume(); },
get active(){ return !!(ctl.instance && !ctl.instance.disposed); },
};
window.BA329Scene = api;
if (!canvas){
showError('#gl canvas not found — scene not initialized.');
return;
}
const triggerEl = document.querySelector(CONFIG.triggerSelector);
if (!triggerEl){
console.warn(`[BA329Scene] Trigger "${CONFIG.triggerSelector}" not found — using the canvas as the init trigger instead.`);
}
const initTrigger = triggerEl || canvas;
if ('IntersectionObserver' in window){
ctl.lazyIO = new IntersectionObserver((entries) => {
if (entries.some(e => e.isIntersecting)){
if (ctl.lazyIO){ ctl.lazyIO.disconnect(); ctl.lazyIO = null; }
if (CONFIG.initDelayMs > 0) setTimeout(startInit, CONFIG.initDelayMs);
else startInit();
}
}, { rootMargin: CONFIG.lazyRootMargin });
ctl.lazyIO.observe(initTrigger);
} else {
startInit();
}
window.addEventListener('pagehide', () => {
ctl.instance && ctl.instance.dispose();
}, { signal: ctl.bootAC.signal });
async function initScene(){
const THREE = await import('three');
const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
const { GLTFLoader }  = await import('three/addons/loaders/GLTFLoader.js');
const BufferGeometryUtils = await import('three/addons/utils/BufferGeometryUtils.js');
const { EdgeSplitModifier } = await import('three/addons/modifiers/EdgeSplitModifier.js');
const { RoomEnvironment }   = await import('three/addons/environments/RoomEnvironment.js');
if (ctl.cancelled) return;
const ac = new AbortController();
const on = (target, type, fn, opts) =>
target.addEventListener(type, fn, Object.assign({}, opts, { signal: ac.signal }));
const disposables = new Set();
const track = (obj) => { disposables.add(obj); return obj; };
const baseUrl = "https://cdn.jsdelivr.net/gh/tadasba329/BA329-NEUE@main";
function assetUrl(file){ return `${baseUrl}/${file}`; }
const tl = new THREE.TextureLoader();
function tex(file, srgb){
const url = /^https?:\/\//.test(file) ? file : assetUrl(file);
const t = tl.load(
url,
undefined,
undefined,
() => showError(`Failed to load texture: ${url}`)
);
t.wrapS = t.wrapT = THREE.RepeatWrapping;
if (srgb) t.colorSpace = THREE.SRGBColorSpace;
return track(t);
}
const settings = {
textureSize:     0.75,
textureStrength: 0.32,
normalStrength:  1.08,
roughness:       0.78,
baseColor:       '#ffffff',
modelRoughness:  0.78,
modelMetalness:  0.0,
modelReflection: 0.5,
modelFit:        2.0,   // auto-fit target size in world units (max of width/height)
modelScale:      1.0,   // extra multiplier on top of the auto fit
modelOffsetX:    0.0,
modelOffsetY:    0.0,
modelOffsetZ:    0.03,
lightIntensity:  3.85,
lightX:          -6,
lightY:          6,
lightZ:          4,
ambient:         2,
modelShadowLift: 0.0,
shadows:          true,
shadowStrength:   1.6,   // how dark the cast shadow is
shadowX:          -4,
shadowY:          5,
shadowZ:          6,
shadowBias:       -0.0005,
shadowNormalBias: 0.02,
shadowSoftness:   8,
shadowClip:       0.35,
radius:          0.27,
feather:         0.05,
hoverDepth:      0.43,
hoverFalloff:    2.0,
lensEnabled:       true,
lensMagnification: 1.15,
lensBlurAmount:    1.0,
lensBlurSize:      20.0,
lensBlurPasses:    2,
lensMotionBlur:    0.0,
lensZoomBlur:      0.25,
liqRefraction:     80.0,
liqScale:          0.2,
liqSpeed:          0.08,
liqChromatic:      30.0,
liqReflection:     0.0,
liqShininess:      200.0,
inkStrength:     0.56,
inkSpeed:        0.08,
inkDistortion:   0.6,
revealTargetSelector: '#gl',
revealStart:     0.3,
revealEnd:       0.9,
revealSmoothing: 0.15,
revealCatchupSmoothing: 0.5,
dropsEnabled:      false,
dropMax:           2,
dropInterval:      6.6,
dropRandomness:    0.7,
dropBaseSize:        0.08,
dropExpansion:       3.0,
dropScaleRandomness: 2.0,
dropStretch:           2.2,
dropStretchChance:     0.8,
dropStretchRandomness: 1.0,
dropStretchHeal:       0.1,
dropIntensity:     1.0,
dropPopTime:       0.12,
dropGrowTime:      2.4,
dropHoldTime:      0.6,
dropFadeTime:      2.8,
dropDistortion:    0.3,
dropWarp:          0.6,
dropFeather:       0.09,
dropSpread:        1.0,
dropCenterBias:    0.0,
dropFadeSpread:    0.5,
};
const MAX_DROPS = 12;
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 3.4);
const mapColor  = tex('PolishedConcrete01_1K_BaseColor.avif', true);
const mapNormal = tex('PolishedConcrete01_1K_Normal.avif');
const mapRough  = tex('PolishedConcrete01_1K_Roughness.avif');
const maskNoise = tex('https://cdn.jsdelivr.net/gh/tadasba329/BA329-NEUE@dcf0c645a3ccf922a40c2d617efdd91a28e4fde5/noise-mask-v2.jpg');
function applyRepeat(){
const r = 1 / settings.textureSize;
[mapColor, mapNormal, mapRough].forEach(t => t.repeat.set(r, r));
}
applyRepeat();
const u = {
uMouseWorld:    { value: new THREE.Vector3(9999, 9999, 0) },
uRadius:        { value: settings.radius },
uFeather:       { value: settings.feather },
uMask:          { value: maskNoise },
uTexStrength:   { value: settings.textureStrength },
uTime:          { value: 0 },
uInkStrength:   { value: settings.inkStrength },
uInkSpeed:      { value: settings.inkSpeed },
uInkDistortion: { value: settings.inkDistortion },
uHoverDepth:    { value: settings.hoverDepth },
uHoverFalloff:  { value: settings.hoverFalloff },
uGlobalReveal:  { value: 0 },
uModelScl:      { value: 1.0 },
uModelOff:      { value: new THREE.Vector3(0, 0, settings.modelOffsetZ) },
uShadowClip:    { value: settings.shadowClip },
uModelLift:     { value: settings.modelShadowLift },
uDrops:    { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(9999, 9999, 0, 0)) },
uDropsAux: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(0, 0, 0.09, 0)) },
uDropsStretch: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(1, 0, 1, 0)) },
};
function makeConcrete(){
const m = new THREE.MeshStandardMaterial({
color: new THREE.Color(settings.baseColor),
map: mapColor,
normalMap: mapNormal,
roughnessMap: mapRough,
roughness: settings.roughness,
metalness: 0.0,
normalScale: new THREE.Vector2(settings.normalStrength, settings.normalStrength),
});
m.onBeforeCompile = (shader) => {
shader.uniforms.uTexStrength = u.uTexStrength;
shader.fragmentShader = shader.fragmentShader
.replace('#include <common>', '#include <common>\nuniform float uTexStrength;')
.replace('#include <map_fragment>', `
#ifdef USE_MAP
vec4 sampledDiffuseColor = texture2D( map, vMapUv );
sampledDiffuseColor.rgb = mix( vec3(1.0), sampledDiffuseColor.rgb, uTexStrength );
diffuseColor *= sampledDiffuseColor;
#endif
`);
};
return track(m);
}
const revealVertexChunk = `
vec2 wpos2 = position.xy * uModelScl + uModelOff.xy;
float dRev = distance(wpos2, uMouseWorld.xy);
float inkT = uTime * uInkSpeed;
vec2 inkUV = wpos2 / 1.4 + vec2(inkT * 0.06, inkT * 0.04);
vec2 inkWarp = vec2(
sin(inkUV.y * 6.2831853 + inkT * 1.7),
cos(inkUV.x * 6.2831853 - inkT * 1.3)
) * uInkDistortion * 0.12;
float nRev = texture2D(uMask, inkUV + inkWarp).r;
dRev += (nRev - 0.5) * uInkStrength;
float hole = 1.0 - smoothstep(uRadius - uFeather, uRadius + uFeather, dRev);
hole = pow(clamp(hole, 0.0, 1.0), uHoverFalloff) * uHoverDepth;
for (int i = 0; i < MAX_DROPS; i++){
vec4 D = uDrops[i];
if (D.w > 0.001){
vec4 A = uDropsAux[i];
vec4 S = uDropsStretch[i];
vec2 rel = wpos2 - D.xy;
vec2 rot = vec2(
rel.x * S.x + rel.y * S.y,
-rel.x * S.y + rel.y * S.x
);
rot.x /= max(S.z, 1.0);
float dd = length(rot);
vec2 dUV = wpos2 / 1.4 + vec2(A.x * 3.13, A.x * 5.71) + vec2(inkT * 0.06, inkT * 0.04);
vec2 dWarp = vec2(
sin(dUV.y * 6.2831853 + inkT * 1.7 + A.x * 6.2831853),
cos(dUV.x * 6.2831853 - inkT * 1.3 + A.x * 6.2831853)
) * A.w * 0.12;
float dn = texture2D(uMask, dUV + dWarp).r;
dd += (dn - 0.5) * A.y;
float dropHole = 1.0 - smoothstep(D.z - A.z, D.z + A.z, dd);
hole = max(hole, dropHole * D.w);
}
}
float reveal = uGlobalReveal * (1.0 - hole);
`;
function injectReveal(shader, hasNormals){
Object.assign(shader.uniforms, {
uMouseWorld: u.uMouseWorld, uRadius: u.uRadius, uFeather: u.uFeather,
uMask: u.uMask, uTime: u.uTime, uInkStrength: u.uInkStrength,
uInkSpeed: u.uInkSpeed, uInkDistortion: u.uInkDistortion,
uHoverDepth: u.uHoverDepth, uHoverFalloff: u.uHoverFalloff,
uGlobalReveal: u.uGlobalReveal,
uModelScl: u.uModelScl, uModelOff: u.uModelOff,
uDrops: u.uDrops, uDropsAux: u.uDropsAux, uDropsStretch: u.uDropsStretch,
});
shader.vertexShader = shader.vertexShader.replace(
'#include <common>',
`#include <common>
#define MAX_DROPS ${MAX_DROPS}
uniform vec3 uMouseWorld;
uniform vec3 uModelOff;
uniform float uRadius, uFeather, uInkStrength, uInkSpeed, uInkDistortion, uTime, uGlobalReveal, uHoverDepth, uHoverFalloff, uModelScl;
uniform sampler2D uMask;
uniform vec4 uDrops[MAX_DROPS];
uniform vec4 uDropsAux[MAX_DROPS];
uniform vec4 uDropsStretch[MAX_DROPS];`
);
if (hasNormals){
shader.vertexShader = shader.vertexShader.replace(
'#include <beginnormal_vertex>',
`#include <beginnormal_vertex>
${revealVertexChunk}
objectNormal = normalize(mix(vec3(0.0, 0.0, 1.0), objectNormal, reveal));`
);
shader.vertexShader = shader.vertexShader.replace(
'#include <begin_vertex>',
`#include <begin_vertex>
transformed.z *= reveal;`
);
} else {
shader.uniforms.uShadowClip = u.uShadowClip;
shader.vertexShader = shader.vertexShader
.replace('#include <common>', '#include <common>\nvarying float vReveal;')
.replace(
'#include <begin_vertex>',
`#include <begin_vertex>
${revealVertexChunk}
vReveal = reveal;
transformed.z *= reveal;`
);
shader.fragmentShader = shader.fragmentShader
.replace('#include <common>', '#include <common>\nvarying float vReveal;\nuniform float uShadowClip;')
.replace('#include <clipping_planes_fragment>',
'#include <clipping_planes_fragment>\nif (vReveal < uShadowClip) discard;');
}
}
const bgGeo = track(new THREE.PlaneGeometry(30, 30));
{
const pos = bgGeo.attributes.position;
const uv = new Float32Array(pos.count * 2);
for (let i = 0; i < pos.count; i++){
uv[i*2] = pos.getX(i); uv[i*2+1] = pos.getY(i);
}
bgGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
const bgMat = makeConcrete();
const bg = new THREE.Mesh(bgGeo, bgMat);
bg.position.z = -0.001;
bg.receiveShadow = settings.shadows;
scene.add(bg);
const modelMat = makeConcrete();
const baseCompile = modelMat.onBeforeCompile;
modelMat.onBeforeCompile = (shader) => {
baseCompile(shader);
injectReveal(shader, true);
shader.uniforms.uModelLift = u.uModelLift;
shader.fragmentShader = shader.fragmentShader
.replace('#include <common>', '#include <common>\nuniform float uModelLift;')
.replace(
'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
`vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
totalDiffuse = max(totalDiffuse, diffuseColor.rgb * uModelLift);`
);
};
modelMat.roughness = settings.modelRoughness;
modelMat.metalness = settings.modelMetalness;
{
const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = track(pmrem.fromScene(new RoomEnvironment(), 0.04));
pmrem.dispose();
modelMat.envMap = envRT.texture;
modelMat.envMapIntensity = settings.modelReflection;
}
const depthMat = track(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
depthMat.onBeforeCompile = (shader) => injectReveal(shader, false);
const sun = new THREE.DirectionalLight(0xffffff, settings.lightIntensity);
sun.position.set(settings.lightX, settings.lightY, settings.lightZ);
sun.castShadow = false;
scene.add(sun);
const ambient = new THREE.AmbientLight(0xffffff, settings.ambient);
scene.add(ambient);
const shadowLight = new THREE.DirectionalLight(0xffffff, settings.shadowStrength);
shadowLight.position.set(settings.shadowX, settings.shadowY, settings.shadowZ);
shadowLight.castShadow = settings.shadows;
shadowLight.shadow.mapSize.set(2048, 2048);
shadowLight.shadow.camera.left = -3; shadowLight.shadow.camera.right = 3;
shadowLight.shadow.camera.top = 3;  shadowLight.shadow.camera.bottom = -3;
shadowLight.shadow.camera.near = 0.5; shadowLight.shadow.camera.far = 20;
shadowLight.shadow.bias = settings.shadowBias;
shadowLight.shadow.normalBias = settings.shadowNormalBias;
shadowLight.shadow.radius = settings.shadowSoftness;
scene.add(shadowLight);
const antiShadowLight = new THREE.DirectionalLight(0xffffff, -settings.shadowStrength);
antiShadowLight.position.copy(shadowLight.position);
antiShadowLight.castShadow = false;
scene.add(antiShadowLight);
function syncShadowFade(reveal){
const k = Math.min(Math.max(reveal, 0), 1);
const fade = k * k * (3 - 2 * k);
shadowLight.intensity = settings.shadowStrength * fade;
antiShadowLight.intensity = -settings.shadowStrength * fade;
}
function applyShadowSettings(){
const on = settings.shadows;
renderer.shadowMap.enabled = on;
shadowLight.visible = on;
antiShadowLight.visible = on;
shadowLight.castShadow = on;
bg.receiveShadow = on;
syncShadowFade(u.uGlobalReveal.value);
shadowLight.shadow.radius = settings.shadowSoftness;
u.uShadowClip.value = settings.shadowClip;
shadowLight.position.set(settings.shadowX, settings.shadowY, settings.shadowZ);
antiShadowLight.position.copy(shadowLight.position);
shadowLight.shadow.bias = settings.shadowBias;
shadowLight.shadow.normalBias = settings.shadowNormalBias;
modelGroup.traverse(o => {
if (o.isMesh){ o.castShadow = on; o.receiveShadow = false; }
});
bgMat.needsUpdate = true;
modelMat.needsUpdate = true;
}
function applyModelLight(){
sun.intensity = settings.lightIntensity;
sun.position.set(settings.lightX, settings.lightY, settings.lightZ);
ambient.intensity = settings.ambient;
}
const fsVertex = `
varying vec2 vUv;
void main(){
vUv = uv;
gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const rtSize = new THREE.Vector2();
renderer.getDrawingBufferSize(rtSize);
const sceneRT = track(new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, { samples: 4 }));
const blurSize = new THREE.Vector2(Math.max(1, rtSize.x >> 1), Math.max(1, rtSize.y >> 1));
const blurA = track(new THREE.WebGLRenderTarget(blurSize.x, blurSize.y));
const blurB = track(new THREE.WebGLRenderTarget(blurSize.x, blurSize.y));
const blurUniforms = {
tInput:  { value: null },
uDir:    { value: new THREE.Vector2(1, 0) },
uTexel:  { value: new THREE.Vector2(1 / blurSize.x, 1 / blurSize.y) },
uSpread: { value: 1 },
};
const blurMat = track(new THREE.ShaderMaterial({
uniforms: blurUniforms,
depthTest: false, depthWrite: false,
vertexShader: fsVertex,
fragmentShader: `
uniform sampler2D tInput;
uniform vec2 uDir, uTexel;
uniform float uSpread;
varying vec2 vUv;
void main(){
vec2 o1 = uDir * uTexel * 1.3846153846 * uSpread;
vec2 o2 = uDir * uTexel * 3.2307692308 * uSpread;
vec4 c = texture2D(tInput, vUv) * 0.2270270270;
c += (texture2D(tInput, vUv + o1) + texture2D(tInput, vUv - o1)) * 0.3162162162;
c += (texture2D(tInput, vUv + o2) + texture2D(tInput, vUv - o2)) * 0.0702702703;
gl_FragColor = c;
}
`,
}));
const lensUniforms = {
tSharp:      { value: sceneRT.texture },
tBlur:       { value: sceneRT.texture },
uResolution: { value: rtSize.clone() },
uCenterUv:   { value: new THREE.Vector2(-10, -10) },
uVelocity:   { value: new THREE.Vector2(0, 0) },
uInvPV:      { value: new THREE.Matrix4() },
uLightDir:   { value: new THREE.Vector3(0, 0, 1) },
uMag:        { value: settings.lensMagnification },
uBlurMix:    { value: settings.lensBlurAmount },
uMotion:     { value: settings.lensMotionBlur },
uZoom:       { value: settings.lensZoomBlur },
uLiqRefract:   { value: settings.liqRefraction },
uLiqScale:     { value: settings.liqScale },
uLiqSpeed:     { value: settings.liqSpeed },
uLiqChromatic: { value: settings.liqChromatic },
uLiqReflect:   { value: settings.liqReflection },
uLiqShine:     { value: settings.liqShininess },
uMouseWorld:    u.uMouseWorld,
uRadius:        u.uRadius,
uFeather:       u.uFeather,
uMask:          u.uMask,
uTime:          u.uTime,
uInkStrength:   u.uInkStrength,
uInkSpeed:      u.uInkSpeed,
uInkDistortion: u.uInkDistortion,
uHoverDepth:    u.uHoverDepth,
uHoverFalloff:  u.uHoverFalloff,
uGlobalReveal:  u.uGlobalReveal,
};
const compositeMat = track(new THREE.ShaderMaterial({
uniforms: lensUniforms,
depthTest: false, depthWrite: false,
vertexShader: fsVertex,
fragmentShader: `
uniform sampler2D tSharp, tBlur, uMask;
uniform vec2 uResolution, uCenterUv, uVelocity;
uniform mat4 uInvPV;
uniform vec3 uMouseWorld, uLightDir;
uniform float uRadius, uFeather, uInkStrength, uInkSpeed, uInkDistortion;
uniform float uTime, uHoverDepth, uHoverFalloff, uGlobalReveal;
uniform float uMag, uBlurMix, uMotion, uZoom;
uniform float uLiqRefract, uLiqScale, uLiqSpeed, uLiqChromatic, uLiqReflect, uLiqShine;
varying vec2 vUv;
vec2 worldOnPlane(vec2 uv){
vec2 ndc = uv * 2.0 - 1.0;
vec4 nearP = uInvPV * vec4(ndc, -1.0, 1.0); nearP /= nearP.w;
vec4 farP  = uInvPV * vec4(ndc,  1.0, 1.0); farP  /= farP.w;
vec3 dir = farP.xyz - nearP.xyz;
float t = -nearP.z / dir.z;
return nearP.xy + dir.xy * t;
}
float hoverHole(vec2 wpos){
float dRev = distance(wpos, uMouseWorld.xy);
float inkT = uTime * uInkSpeed;
vec2 inkUV = wpos / 1.4 + vec2(inkT * 0.06, inkT * 0.04);
vec2 inkWarp = vec2(
sin(inkUV.y * 6.2831853 + inkT * 1.7),
cos(inkUV.x * 6.2831853 - inkT * 1.3)
) * uInkDistortion * 0.12;
float nRev = texture2D(uMask, inkUV + inkWarp).r;
dRev += (nRev - 0.5) * uInkStrength;
float hole = 1.0 - smoothstep(uRadius - uFeather, uRadius + uFeather, dRev);
return pow(clamp(hole, 0.0, 1.0), uHoverFalloff) * uHoverDepth;
}
vec3 liquidNormal(vec2 wpos){
float t = uTime * uLiqSpeed;
vec2 e = vec2(0.012, 0.0);
vec2 p1 = wpos * uLiqScale + vec2(t * 0.13, -t * 0.11);
float h  = texture2D(uMask, p1).r;
float hx = texture2D(uMask, p1 + e.xy).r;
float hy = texture2D(uMask, p1 + e.yx).r;
vec2 p2 = wpos * uLiqScale * 1.7 - vec2(t * 0.07, t * 0.09);
h  += texture2D(uMask, p2).r * 0.5;
hx += texture2D(uMask, p2 + e.xy).r * 0.5;
hy += texture2D(uMask, p2 + e.yx).r * 0.5;
vec2 g = vec2(hx - h, hy - h) / e.x;
return normalize(vec3(-g * 0.35, 1.0));
}
vec4 sampleScene(vec2 uv, float blurK){
uv = clamp(uv, vec2(0.002), vec2(0.998));
vec4 s = texture2D(tSharp, uv);
vec4 b = texture2D(tBlur, uv);
return mix(s, b, blurK);
}
void main(){
vec2 wpos = worldOnPlane(vUv);
float m = hoverHole(wpos) * uGlobalReveal;
vec3 n = liquidNormal(wpos);
vec2 texel = 1.0 / uResolution;
vec2 refr = n.xy * uLiqRefract * m * texel;
vec2 magUv = uCenterUv + (vUv - uCenterUv) / max(uMag, 0.01);
vec2 uv = mix(vUv, magUv, m) + refr;
float blurK = clamp(uBlurMix * m, 0.0, 1.0);
vec2 mo = uVelocity * uMotion * m;
vec2 zo = (uCenterUv - uv) * uZoom * m;
vec4 col;
if (dot(mo, mo) + dot(zo, zo) > 1e-12){
col = vec4(0.0);
for (int i = 0; i < 8; i++){
float t = (float(i) / 7.0 - 0.5) * 2.0;
col += sampleScene(uv + mo * t * 0.5 + zo * t * 0.5, blurK);
}
col /= 8.0;
} else {
col = sampleScene(uv, blurK);
}
if (uLiqChromatic > 0.01){
vec2 ca = n.xy * uLiqChromatic * m * texel;
col.r = sampleScene(uv + ca, blurK).r;
col.b = sampleScene(uv - ca, blurK).b;
}
vec3 L = normalize(uLightDir);
vec3 V = vec3(0.0, 0.0, 1.0);
float spec = pow(max(dot(reflect(-L, n), V), 0.0), uLiqShine);
col.rgb += spec * uLiqReflect * m;
gl_FragColor = col;
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`,
}));
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postQuadGeo = track(new THREE.PlaneGeometry(2, 2));
const postQuad = new THREE.Mesh(postQuadGeo, compositeMat);
postScene.add(postQuad);
const modelGroup = new THREE.Group();
scene.add(modelGroup);
function applyModelTransform(){
modelGroup.scale.setScalar(settings.modelScale);
modelGroup.position.set(settings.modelOffsetX, settings.modelOffsetY, settings.modelOffsetZ);
u.uModelScl.value = settings.modelScale;
u.uModelOff.value.set(settings.modelOffsetX, settings.modelOffsetY, settings.modelOffsetZ);
}
applyModelTransform();
const dracoLoader = new DRACOLoader();
let visIO = null;
let connCheckId = 0;
let inView = true;
let tabVisible = !document.hidden;
let manualPaused = false;
let running = false;
let disposed = false;
let loopReady = false;
let idleSettled = false;
let catchupDone = false;
let inkDropFn = null, revealFn = null, hideFn = null;
let gui = null;
const wake = () => { idleSettled = false; };
function dispose(){
if (disposed) return;
disposed = true;
renderer.setAnimationLoop(null);
ac.abort();
if (connCheckId) clearInterval(connCheckId);
if (visIO) visIO.disconnect();
if (gui){ try { gui.destroy(); } catch(e){} gui = null; }
modelGroup.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
disposables.forEach(d => { if (d.dispose) d.dispose(); });
disposables.clear();
dracoLoader.dispose();
renderer.dispose();
if (renderer.forceContextLoss) renderer.forceContextLoss();
if (window.inkDrop === inkDropFn)     window.inkDrop = undefined;
if (window.revealModel === revealFn)  window.revealModel = undefined;
if (window.hideModel === hideFn)      window.hideModel = undefined;
}
function updateRunState(){
const shouldRun = loopReady && inView && tabVisible && !manualPaused && !disposed;
if (shouldRun === running) return;
running = shouldRun;
if (running){
clock.getDelta();
idleSettled = false;
renderer.setAnimationLoop(loop);
} else {
renderer.setAnimationLoop(null);
}
}
const instance = {
dispose,
pause(){  manualPaused = true;  updateRunState(); },
resume(){ manualPaused = false; updateRunState(); },
get disposed(){ return disposed; },
};
ctl.instance = instance;
if (ctl.cancelled){ dispose(); return; }
const modelUrl = 'https://cdn.jsdelivr.net/gh/tadasba329/BA329-NEUE@cae8e094c68f48154569def9fc673915bc718ad6/index-new-update-v2-cut-optimized.glb';
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
const dropBounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
await new Promise((resolve, reject) => {
gltfLoader.load(modelUrl, (gltf) => {
gltf.scene.updateMatrixWorld(true);
const srcMeshes = [];
gltf.scene.traverse((c) => { if (c.isMesh) srcMeshes.push(c); });
const edgeSplitModifier = new EdgeSplitModifier();
const smoothAngle = Math.PI / 1;
const geos = [];
let unionBB = null;
srcMeshes.forEach((c) => {
let g = c.geometry.clone();
g.applyMatrix4(c.matrixWorld); // bake the node's transform in
g.deleteAttribute('normal');
g = BufferGeometryUtils.mergeVertices(g);
g.computeVertexNormals();
g = edgeSplitModifier.modify(g, smoothAngle);
g.computeBoundingBox();
if (!unionBB) unionBB = g.boundingBox.clone();
else unionBB.union(g.boundingBox);
geos.push(g);
});
if (!unionBB){
showError('Model contains no meshes.');
resolve();
return;
}
const size = new THREE.Vector3();   unionBB.getSize(size);
const center = new THREE.Vector3(); unionBB.getCenter(center);
const fit = settings.modelFit / Math.max(size.x, size.y, 1e-6);
let finalBB = null;
geos.forEach((g) => {
g.translate(-center.x, -center.y, -unionBB.min.z);
g.scale(fit, fit, fit);
const pos = g.attributes.position;
const uv = new Float32Array(pos.count * 2);
for (let i = 0; i < pos.count; i++){
uv[i*2] = pos.getX(i); uv[i*2+1] = pos.getY(i);
}
g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
g.computeBoundingBox();
if (!finalBB) finalBB = g.boundingBox.clone();
else finalBB.union(g.boundingBox);
const mesh = new THREE.Mesh(g, modelMat);
mesh.customDepthMaterial = depthMat;
mesh.castShadow = settings.shadows;
mesh.receiveShadow = false; // shadow rig must not touch the model
mesh.frustumCulled = false;
modelGroup.add(mesh);
});
if (finalBB){
dropBounds.minX = finalBB.min.x; dropBounds.maxX = finalBB.max.x;
dropBounds.minY = finalBB.min.y; dropBounds.maxY = finalBB.max.y;
}
resolve();
}, undefined, (err) => {
console.error('GLTFLoader error:', err);
showError(`Failed to load model: ${modelUrl}`);
reject(err);
});
});
if (ctl.cancelled || disposed){ dispose(); return; }
applyShadowSettings();
function renderBlurChain(){
if (settings.lensBlurAmount <= 0.001 || settings.lensBlurSize <= 0.001){
lensUniforms.tBlur.value = sceneRT.texture;
return;
}
blurUniforms.uTexel.value.set(1 / blurSize.x, 1 / blurSize.y);
blurUniforms.uSpread.value = Math.max(settings.lensBlurSize, 0.01);
postQuad.material = blurMat;
let src = sceneRT.texture;
const passes = Math.max(1, Math.round(settings.lensBlurPasses));
for (let p = 0; p < passes; p++){
blurUniforms.tInput.value = src;
blurUniforms.uDir.value.set(1, 0);
renderer.setRenderTarget(blurA);
renderer.render(postScene, postCam);
blurUniforms.tInput.value = blurA.texture;
blurUniforms.uDir.value.set(0, 1);
renderer.setRenderTarget(blurB);
renderer.render(postScene, postCam);
src = blurB.texture;
}
renderer.setRenderTarget(null);
lensUniforms.tBlur.value = blurB.texture;
}
const lensProj = new THREE.Vector3();
const centerNow = new THREE.Vector2(-10, -10);
const centerPrev = new THREE.Vector2(-10, -10);
const velSmooth = new THREE.Vector2(0, 0);
const velRaw = new THREE.Vector2(0, 0);
function updateLensUniforms(dt){
camera.updateMatrixWorld();
lensUniforms.uInvPV.value
.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
.invert();
lensUniforms.uLightDir.value.copy(sun.position).normalize();
const mw = u.uMouseWorld.value;
if (Math.abs(mw.x) > 100.0){
centerNow.set(-10, -10);
velRaw.set(0, 0);
} else {
lensProj.set(mw.x, mw.y, 0).project(camera);
centerNow.set(lensProj.x * 0.5 + 0.5, lensProj.y * 0.5 + 0.5);
if (centerPrev.x > -5){
velRaw.subVectors(centerNow, centerPrev).divideScalar(Math.max(dt, 0.001));
} else {
velRaw.set(0, 0);
}
}
centerPrev.copy(centerNow);
velSmooth.lerp(velRaw, 1 - Math.exp(-8 * dt));
lensUniforms.uVelocity.value.copy(velSmooth);
lensUniforms.uCenterUv.value.copy(centerNow);
}
const easeOutCubic = k => 1 - Math.pow(1 - k, 3);
const smooth = k => k * k * (3 - 2 * k);
const revealTarget = document.querySelector(settings.revealTargetSelector) || canvas;
let revealGoal = 0;
let manualOverride = false;
function visibleFraction(el){
const r = el.getBoundingClientRect();
const vh = window.innerHeight;
const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
return Math.max(0, Math.min(visible, r.height)) / Math.max(r.height, 1);
}
function updateScrollReveal(){
if (manualOverride) return;
const f = visibleFraction(revealTarget);
const span = Math.max(settings.revealEnd - settings.revealStart, 0.0001);
const k = Math.min(Math.max((f - settings.revealStart) / span, 0), 1);
revealGoal = smooth(k);
}
on(window, 'scroll', () => { manualOverride = false; updateScrollReveal(); }, { passive: true });
on(window, 'resize', updateScrollReveal);
updateScrollReveal();
const dropSlots = new Array(MAX_DROPS).fill(null);
let nextDropAt = 1.0;
function worldDropBounds(){
const s = settings.modelScale;
return {
minX: dropBounds.minX * s + settings.modelOffsetX,
maxX: dropBounds.maxX * s + settings.modelOffsetX,
minY: dropBounds.minY * s + settings.modelOffsetY,
maxY: dropBounds.maxY * s + settings.modelOffsetY,
};
}
function scheduleNextDrop(now){
const jitter = (Math.random() * 2 - 1) * settings.dropRandomness;
nextDropAt = now + Math.max(0.05, settings.dropInterval * (1 + jitter));
}
function spawnDrop(now){
const slot = dropSlots.findIndex(d => d === null);
if (slot === -1) return;
const wb = worldDropBounds();
const s = settings.dropSpread;
const cx = (wb.minX + wb.maxX) / 2;
const cy = (wb.minY + wb.maxY) / 2;
const hx = (wb.maxX - wb.minX) / 2 * s;
const hy = (wb.maxY - wb.minY) / 2 * s;
const bias = Math.pow(Math.random(), 1 + Math.max(0, settings.dropCenterBias));
const angle = Math.random() * Math.PI * 2;
const ox = Math.cos(angle) * bias * hx;
const oy = Math.sin(angle) * bias * hy;
const scale = 1 + Math.random() * Math.max(0, settings.dropScaleRandomness - 1);
const popRadius  = settings.dropBaseSize * scale;
const fullRadius = popRadius * settings.dropExpansion;
let stretch = 1;
if (Math.random() < settings.dropStretchChance && settings.dropStretch > 1){
const range = Math.min(Math.max(settings.dropStretchRandomness, 0), 1);
const amount = 1 - Math.random() * range;
stretch = 1 + (settings.dropStretch - 1) * amount;
}
const stretchAngle = Math.random() * Math.PI * 2;
dropSlots[slot] = {
x: cx + ox,
y: cy + oy,
popRadius,
fullRadius,
stretch,
cosA: Math.cos(stretchAngle),
sinA: Math.sin(stretchAngle),
seed: Math.random(),
born: now,
};
}
function updateDrops(now){
if (settings.dropsEnabled && now >= nextDropAt){
if (u.uGlobalReveal.value > 0.95){
const alive = dropSlots.filter(Boolean).length;
if (alive < Math.min(settings.dropMax, MAX_DROPS)) spawnDrop(now);
scheduleNextDrop(now);
} else {
nextDropAt = now + 0.25;
}
}
const popT  = settings.dropPopTime;
const growT = settings.dropGrowTime;
const holdT = settings.dropHoldTime;
const fadeT = settings.dropFadeTime;
const total = popT + growT + holdT + fadeT;
for (let i = 0; i < MAX_DROPS; i++){
const D = u.uDrops.value[i];
const A = u.uDropsAux.value[i];
const S = u.uDropsStretch.value[i];
const drop = dropSlots[i];
if (!drop){
D.set(9999, 9999, 0, 0);
S.set(1, 0, 1, 0);
continue;
}
const t = now - drop.born;
if (t >= total){
dropSlots[i] = null;
D.set(9999, 9999, 0, 0);
S.set(1, 0, 1, 0);
continue;
}
let radius, strength, growProgress, fadeK = 0;
let currentStretch;
const stretchAtFadeStart = 1 + (drop.stretch - 1) * (1 - settings.dropStretchHeal);
if (t < popT){
const k = easeOutCubic(t / popT);
radius = drop.popRadius * k;
strength = k;
growProgress = 0;
currentStretch = drop.stretch;
} else if (t < popT + growT + holdT){
if (t < popT + growT){
const k = easeOutCubic((t - popT) / growT);
radius = drop.popRadius + (drop.fullRadius - drop.popRadius) * k;
growProgress = k;
} else {
radius = drop.fullRadius;
growProgress = 1;
}
strength = 1;
const kh = smooth((t - popT) / (growT + holdT));
currentStretch = 1 + (drop.stretch - 1) * (1 - settings.dropStretchHeal * kh);
} else {
fadeK = (t - popT - growT - holdT) / fadeT;
radius = drop.fullRadius * (1 + settings.dropFadeSpread * fadeK);
strength = 1 - smooth(fadeK);
growProgress = 1;
const longAxisStart = drop.fullRadius * stretchAtFadeStart;
const longAxisNow = longAxisStart + (radius - longAxisStart) * smooth(fadeK);
currentStretch = Math.max(1, longAxisNow / radius);
}
const distort = settings.dropDistortion * (0.25 + 0.75 * growProgress) * (1 + 0.6 * fadeK);
const warp    = settings.dropWarp * (0.4 + 0.6 * growProgress) * (1 + 0.6 * fadeK);
D.set(drop.x, drop.y, radius, strength * settings.dropIntensity);
A.set(drop.seed, distort, settings.dropFeather, warp);
S.set(drop.cosA, drop.sinA, currentStretch, 0);
}
}
inkDropFn = (x, y, scale, stretch, stretchAngle) => {
const slot = dropSlots.findIndex(d => d === null);
if (slot === -1) return;
const s = scale ?? (1 + Math.random() * Math.max(0, settings.dropScaleRandomness - 1));
const popRadius = settings.dropBaseSize * s;
const st = stretch ?? 1;
const ang = stretchAngle ?? Math.random() * Math.PI * 2;
dropSlots[slot] = {
x, y,
popRadius,
fullRadius: popRadius * settings.dropExpansion,
stretch: Math.max(1, st),
cosA: Math.cos(ang),
sinA: Math.sin(ang),
seed: Math.random(),
born: u.uTime.value,
};
idleSettled = false;
};
revealFn = () => { manualOverride = true; revealGoal = 1; idleSettled = false; };
hideFn   = () => { manualOverride = true; revealGoal = 0; idleSettled = false; };
window.inkDrop = inkDropFn;
window.revealModel = revealFn;
window.hideModel = hideFn;
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
const mouseTarget = new THREE.Vector3(9999, 9999, 0);
let hasMouse = false;
function setMouse(x, y){
ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
raycaster.setFromCamera(ndc, camera);
if (raycaster.ray.intersectPlane(plane, hit)){
mouseTarget.copy(hit); hasMouse = true;
}
}
on(window, 'pointermove', e => setMouse(e.clientX, e.clientY));
on(window, 'pointerleave', () => hasMouse = false);
on(window, 'touchmove', e => {
if (e.touches[0]) setMouse(e.touches[0].clientX, e.touches[0].clientY);
}, { passive:true });
function resize(){
renderer.setSize(window.innerWidth, window.innerHeight, false);
camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();
renderer.getDrawingBufferSize(rtSize);
sceneRT.setSize(rtSize.x, rtSize.y);
blurSize.set(Math.max(1, rtSize.x >> 1), Math.max(1, rtSize.y >> 1));
blurA.setSize(blurSize.x, blurSize.y);
blurB.setSize(blurSize.x, blurSize.y);
lensUniforms.uResolution.value.copy(rtSize);
idleSettled = false;
}
on(window, 'resize', resize);
resize();
if (CONFIG.showControlPanel){
try {
const { GUI } = await import('three/addons/libs/lil-gui.module.min.js');
gui = new GUI({ title: 'BA329 Scene' });
gui.domElement.style.zIndex = '10001';
const W = (fn) => (v) => { fn(v); wake(); };
const fModel = gui.addFolder('Model');
fModel.add(settings, 'modelScale', 0.1, 4, 0.01).name('Scale').onChange(W(applyModelTransform));
fModel.add(settings, 'modelOffsetX', -2, 2, 0.01).name('Offset X').onChange(W(applyModelTransform));
fModel.add(settings, 'modelOffsetY', -2, 2, 0.01).name('Offset Y').onChange(W(applyModelTransform));
fModel.add(settings, 'modelOffsetZ', 0, 0.3, 0.001).name('Offset Z (depth)').onChange(W(applyModelTransform));
const fSurf = gui.addFolder('Surface');
fSurf.add(settings, 'textureSize', 0.1, 4, 0.01).name('Texture size').onChange(W(applyRepeat));
fSurf.add(settings, 'textureStrength', 0, 1, 0.01).name('Texture strength').onChange(W(v => u.uTexStrength.value = v));
fSurf.add(settings, 'normalStrength', 0, 3, 0.01).name('Normal strength').onChange(W(v => {
bgMat.normalScale.set(v, v); modelMat.normalScale.set(v, v);
}));
fSurf.add(settings, 'roughness', 0, 1, 0.01).name('Roughness (background)').onChange(W(v => {
bgMat.roughness = v;
}));
fSurf.addColor(settings, 'baseColor').name('Base color').onChange(W(v => {
bgMat.color.set(v); modelMat.color.set(v);
}));
fSurf.close();
const fMat = gui.addFolder('Model material');
fMat.add(settings, 'modelRoughness', 0, 1, 0.01).name('Matte (1) / shiny (0)').onChange(W(v => modelMat.roughness = v));
fMat.add(settings, 'modelMetalness', 0, 1, 0.01).name('Metalness').onChange(W(v => modelMat.metalness = v));
fMat.add(settings, 'modelReflection', 0, 3, 0.01).name('Reflections').onChange(W(v => modelMat.envMapIntensity = v));
const fLight = gui.addFolder('Model light');
fLight.add(settings, 'lightIntensity', 0, 10, 0.01).name('Intensity').onChange(W(applyModelLight));
fLight.add(settings, 'lightX', -15, 15, 0.1).name('X').onChange(W(applyModelLight));
fLight.add(settings, 'lightY', -15, 15, 0.1).name('Y').onChange(W(applyModelLight));
fLight.add(settings, 'lightZ', 0.5, 15, 0.1).name('Z').onChange(W(applyModelLight));
fLight.add(settings, 'ambient', 0, 5, 0.01).name('Ambient').onChange(W(applyModelLight));
fLight.add(settings, 'modelShadowLift', 0, 6, 0.01).name('Shadow lift (model)').onChange(W(v => u.uModelLift.value = v));
const fShadow = gui.addFolder('Model cast shadow');
fShadow.add(settings, 'shadows').name('Enabled').onChange(W(applyShadowSettings));
fShadow.add(settings, 'shadowStrength', 0, 5, 0.01).name('Shadow opacity').onChange(W(applyShadowSettings));
fShadow.add(settings, 'shadowSoftness', 0, 25, 0.5).name('Softness').onChange(W(applyShadowSettings));
fShadow.add(settings, 'shadowClip', 0.05, 0.9, 0.01).name('Reveal cutoff').onChange(W(applyShadowSettings));
fShadow.add(settings, 'shadowX', -15, 15, 0.1).name('X').onChange(W(applyShadowSettings));
fShadow.add(settings, 'shadowY', -15, 15, 0.1).name('Y').onChange(W(applyShadowSettings));
fShadow.add(settings, 'shadowZ', 0.5, 15, 0.1).name('Z').onChange(W(applyShadowSettings));
fShadow.add(settings, 'shadowBias', -0.005, 0.005, 0.0001).name('Bias').onChange(W(applyShadowSettings));
fShadow.add(settings, 'shadowNormalBias', 0, 0.2, 0.001).name('Normal bias').onChange(W(applyShadowSettings));
const fHover = gui.addFolder('Hover');
fHover.add(settings, 'radius', 0.02, 1.5, 0.01).name('Radius').onChange(W(v => u.uRadius.value = v));
fHover.add(settings, 'feather', 0.001, 0.5, 0.001).name('Feather').onChange(W(v => u.uFeather.value = v));
fHover.add(settings, 'hoverDepth', 0, 1, 0.01).name('Depth').onChange(W(v => u.uHoverDepth.value = v));
fHover.add(settings, 'hoverFalloff', 0.2, 6, 0.05).name('Falloff').onChange(W(v => u.uHoverFalloff.value = v));
fHover.close();
const fInk = gui.addFolder('Ink edge');
fInk.add(settings, 'inkStrength', 0, 2, 0.01).name('Strength').onChange(W(v => u.uInkStrength.value = v));
fInk.add(settings, 'inkSpeed', 0, 1, 0.005).name('Speed').onChange(W(v => u.uInkSpeed.value = v));
fInk.add(settings, 'inkDistortion', 0, 3, 0.01).name('Distortion').onChange(W(v => u.uInkDistortion.value = v));
fInk.close();
const fLens = gui.addFolder('Lens');
fLens.add(settings, 'lensEnabled').name('Enabled').onChange(W(() => {}));
fLens.add(settings, 'lensMagnification', 1, 2, 0.01).name('Magnification').onChange(W(v => lensUniforms.uMag.value = v));
fLens.add(settings, 'lensBlurAmount', 0, 1, 0.01).name('Blur amount').onChange(W(v => lensUniforms.uBlurMix.value = v));
fLens.add(settings, 'lensBlurSize', 0, 60, 0.5).name('Blur size').onChange(W(() => {}));
fLens.add(settings, 'lensBlurPasses', 1, 4, 1).name('Blur passes').onChange(W(() => {}));
fLens.add(settings, 'lensMotionBlur', 0, 1, 0.01).name('Motion blur').onChange(W(v => lensUniforms.uMotion.value = v));
fLens.add(settings, 'lensZoomBlur', 0, 2, 0.01).name('Zoom blur').onChange(W(v => lensUniforms.uZoom.value = v));
fLens.close();
const fLiq = gui.addFolder('Liquid');
fLiq.add(settings, 'liqRefraction', 0, 300, 1).name('Refraction').onChange(W(v => lensUniforms.uLiqRefract.value = v));
fLiq.add(settings, 'liqScale', 0.02, 2, 0.01).name('Scale').onChange(W(v => lensUniforms.uLiqScale.value = v));
fLiq.add(settings, 'liqSpeed', 0, 1, 0.005).name('Speed').onChange(W(v => lensUniforms.uLiqSpeed.value = v));
fLiq.add(settings, 'liqChromatic', 0, 120, 1).name('Chromatic').onChange(W(v => lensUniforms.uLiqChromatic.value = v));
fLiq.add(settings, 'liqReflection', 0, 2, 0.01).name('Reflection').onChange(W(v => lensUniforms.uLiqReflect.value = v));
fLiq.add(settings, 'liqShininess', 10, 800, 1).name('Shininess').onChange(W(v => lensUniforms.uLiqShine.value = v));
fLiq.close();
const fRev = gui.addFolder('Reveal');
fRev.add(settings, 'revealStart', 0, 1, 0.01).name('Start').onChange(W(updateScrollReveal));
fRev.add(settings, 'revealEnd', 0, 1, 0.01).name('End').onChange(W(updateScrollReveal));
fRev.add(settings, 'revealSmoothing', 0.01, 1, 0.01).name('Smoothing');
fRev.add({ reveal(){ revealFn(); } }, 'reveal').name('Force reveal');
fRev.add({ hide(){ hideFn(); } }, 'hide').name('Force hide');
fRev.close();
const fDrops = gui.addFolder('Ink drops');
fDrops.add(settings, 'dropsEnabled').name('Enabled').onChange(W(() => {}));
fDrops.add(settings, 'dropMax', 1, MAX_DROPS, 1).name('Max alive');
fDrops.add(settings, 'dropInterval', 0.5, 20, 0.1).name('Interval (s)');
fDrops.add(settings, 'dropRandomness', 0, 1, 0.01).name('Interval jitter');
fDrops.add(settings, 'dropBaseSize', 0.01, 0.5, 0.005).name('Base size');
fDrops.add(settings, 'dropExpansion', 1, 8, 0.1).name('Expansion');
fDrops.add(settings, 'dropIntensity', 0, 1, 0.01).name('Intensity');
fDrops.add(settings, 'dropSpread', 0, 1.5, 0.01).name('Spread');
fDrops.add(settings, 'dropFeather', 0.005, 0.3, 0.005).name('Feather');
fDrops.add(settings, 'dropDistortion', 0, 2, 0.01).name('Distortion');
fDrops.add(settings, 'dropWarp', 0, 2, 0.01).name('Warp');
fDrops.add({ spawn(){ spawnDrop(u.uTime.value); wake(); } }, 'spawn').name('Spawn drop now');
fDrops.close();
} catch (e) {
console.warn('Control panel failed to load:', e);
}
}
if (renderer.compileAsync) {
await renderer.compileAsync(scene, camera);
postQuad.material = blurMat;
await renderer.compileAsync(postScene, postCam);
postQuad.material = compositeMat;
await renderer.compileAsync(postScene, postCam);
} else {
renderer.compile(scene, camera);
}
if (ctl.cancelled || disposed){ dispose(); return; }
visIO = new IntersectionObserver((entries) => {
inView = entries[entries.length - 1].isIntersecting;
updateRunState();
}, { rootMargin: '10% 0px' });
visIO.observe(canvas);
on(document, 'visibilitychange', () => {
tabVisible = !document.hidden;
updateRunState();
});
connCheckId = setInterval(() => {
if (!canvas.isConnected) dispose();
}, CONFIG.autoDestroyCheckMs);
const clock = new THREE.Clock();
const away = new THREE.Vector3(9999, 9999, 0);
function loop(){
if (!canvas.isConnected){ dispose(); return; }
const dt = Math.min(clock.getDelta(), 0.05);
const mouseGone      = !hasMouse && Math.abs(u.uMouseWorld.value.x) > 100.0;
const revealSettled  = Math.abs(revealGoal - u.uGlobalReveal.value) < 0.0008;
const dropsAlive     = dropSlots.some(Boolean);
const dropsPending   = settings.dropsEnabled && u.uGlobalReveal.value > 0.9;
const isIdle         = mouseGone && revealSettled && !dropsAlive && !dropsPending;
if (isIdle){
if (idleSettled) return;
u.uGlobalReveal.value = revealGoal;
u.uMouseWorld.value.copy(away);
idleSettled = true;
} else {
idleSettled = false;
}
u.uMouseWorld.value.lerp(hasMouse ? mouseTarget : away, 1 - Math.exp(-6 * dt));
u.uTime.value += dt;
if (!catchupDone && Math.abs(revealGoal - u.uGlobalReveal.value) < 0.01) catchupDone = true;
const sm = Math.max(catchupDone ? settings.revealSmoothing : settings.revealCatchupSmoothing, 0.0001);
u.uGlobalReveal.value += (revealGoal - u.uGlobalReveal.value) * (1 - Math.exp(-dt / sm));
updateDrops(u.uTime.value);
if (settings.shadows) syncShadowFade(u.uGlobalReveal.value);
const lensActive =
settings.lensEnabled &&
u.uGlobalReveal.value > 0.001 &&
Math.abs(u.uMouseWorld.value.x) <= 100.0;
if (lensActive){
renderer.setRenderTarget(sceneRT);
renderer.render(scene, camera);
renderer.setRenderTarget(null);
renderBlurChain();
updateLensUniforms(dt);
postQuad.material = compositeMat;
renderer.render(postScene, postCam);
} else {
centerPrev.set(-10, -10);
velSmooth.set(0, 0);
renderer.render(scene, camera);
}
}
loopReady = true;
updateRunState();
}
})();
