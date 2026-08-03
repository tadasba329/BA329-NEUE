/* =============================================================================
   BA329 — statue scene (optimised build)
   -----------------------------------------------------------------------------
   WHAT CHANGED VS. THE ORIGINAL

   1. LIGHTING IS NOW BAKED
      The old rig used 4 directional lights (2 shadow casters + 2 negative
      "anti-lights") and re-rendered two VSM shadow maps every single frame,
      one of them with shadow.radius = 93. That was the single most expensive
      thing in the scene.
      Now the shadow is baked ONCE at load: the statue silhouette is rendered
      from the light's direction into a small render target, blurred at two
      levels (contact + falloff), packed into one RG texture, and projected
      onto the background in its shader. Per frame cost: one texture fetch.
      The shadow still fades in/out with the scroll reveal.
      -> scene.lights: 5 directional + ambient  ==>  1 directional + ambient
      -> shadow map renders per frame: 2  ==>  0
      -> the custom depth material (which re-ran the whole reveal shader twice
         per frame) is gone entirely.

   2. THE HOVER / LENS EFFECT IS MUCH CHEAPER (look is unchanged)
      - Early-out in the composite shader: pixels outside the hover hole now
        cost 1 texture fetch instead of ~12. Before, liquidNormal() (6 fetches)
        and the chromatic aberration (4 fetches) ran on every pixel of the
        screen even when the hole was nowhere near.
      - The same early-out is in the vertex shader (skips the vertex texture
        fetch, which is slow on mobile).
      - Blur chain runs at quarter resolution instead of half, and is scissored
        to the lens' screen rect instead of the full screen.
      - MSAA on the scene target is quality-dependent (was hardcoded to 4x).
      - Ink-drop loop is compiled out completely when drops are disabled
        (they are, by default) and bounded by uDropCount when enabled.

   3. GEOMETRY
      - All statue meshes are merged into ONE geometry -> 1 draw call.
      - EdgeSplitModifier removed: it was called with an angle of PI, which
        splits nothing, so it was pure load-time cost.

   4. RESPONSIVE / CENTERING
      - The renderer sizes from the CANVAS BOX (ResizeObserver), not
        window.innerWidth/innerHeight. That mismatch is what pushed the statue
        off-centre inside Webflow.
      - Framing is 'cover': fixed camera distance, so the statue keeps the same
        apparent height on every viewport and the sides crop on narrow screens
        rather than the statue shrinking. settings.fitMode = 'contain' swaps to
        the pull-back-so-nothing-crops behaviour.
      - settings.cameraOffsetY is the only thing that moves the camera
        vertically. Nothing is computed from scroll position.
      - Pointer coords are mapped through the canvas rect, not the window.
      - Optional visualViewport lock for the mobile 100vh address-bar bug.

   6. FULLY STATIC ON SCROLL
      Nothing in the scene reads scroll position any more. The scroll-driven
      reveal is gone: the statue starts fully revealed and stays that way.
      window.revealModel() / window.hideModel() still work if you want to drive
      it from your own trigger. The only scroll listener left flags the cached
      canvas rect as stale so pointer mapping stays correct in a scrolling
      section — it touches nothing else.

   7. TEXTURES REMOVED
      The three concrete PBR maps (base colour / normal / roughness) are gone,
      along with the uv attributes that only existed to tile them. That drops
      3 texture fetches per pixel on a full-screen backdrop, the whole normal
      mapping path, and 3 CDN downloads at load. Surface is now flat colour +
      roughness. The noise mask stays — the ink edge, hover hole and liquid
      distortion all sample it.

   5. ADAPTIVE QUALITY
      Tier is picked from the device at boot and steps down automatically if
      frame time stays above CONFIG.targetFrameMs.

   -----------------------------------------------------------------------------
   REQUIRED CSS (this is the other half of the centering fix)

     .statue-wrap{                 -- the Webflow section holding the canvas
       position: relative;
       width: 100%;
       height: 100svh;             -- NOT 100vh, that is what pushes it down
       overflow: hidden;
     }
     #gl{
       position: absolute;
       inset: 0;
       width: 100%;
       height: 100%;
       display: block;
     }

   If the canvas is position:fixed instead, use `height:100svh` there too, or
   set CONFIG.fitToVisualViewport = true below.
   ============================================================================= */

(() => {
'use strict';

const CONFIG = {
  canvasSelector:      '#gl',
  errorSelector:       '#gl-error',
  initDelayMs:         0,
  autoDestroyCheckMs:  2000,
  showControlPanel:    false,

  // adaptive quality
  autoQuality:         true,
  targetFrameMs:       20,      // ~50fps; step down if we stay above this
  qualityTier:         'low',   // starting tier. null = auto-detect from device.
                                // change live via the GUI dropdown or
                                // BA329Scene.setQuality('high'|'medium'|'low'|'minimal')

  // sizing
  sizeFromCanvas:      true,    // size from the canvas box, not the window
  fitToVisualViewport: false,   // set true if the canvas is position:fixed
                                // and mobile browser chrome offsets it
};

/* ---------------------------------------------------------------- quality -- */

// `bake` is the shadow bake resolution. It is a ONE-TIME load cost, not a
// per-frame one, so it stays high even on low tiers — the tight softness
// setting needs the texels to keep a crisp contact edge.
const QUALITY = {
  high:    { dpr: 2.00, msaa: 4, blurDiv: 4, blurPasses: 2, lensTaps: 8, bake: 1024, lens: true  },
  medium:  { dpr: 1.50, msaa: 2, blurDiv: 4, blurPasses: 2, lensTaps: 6, bake: 1024, lens: true  },
  low:     { dpr: 1.25, msaa: 0, blurDiv: 4, blurPasses: 1, lensTaps: 4, bake: 1024, lens: true  },
  minimal: { dpr: 1.00, msaa: 0, blurDiv: 4, blurPasses: 1, lensTaps: 4, bake: 768,  lens: false },
};
const TIERS = ['high', 'medium', 'low', 'minimal'];

function detectTier(){
  if (CONFIG.qualityTier && QUALITY[CONFIG.qualityTier]) return CONFIG.qualityTier;
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) {}
  const cores = navigator.hardwareConcurrency || 4;
  const mem   = navigator.deviceMemory || 4;
  const px    = window.innerWidth * window.innerHeight * Math.min(window.devicePixelRatio || 1, 2);
  if (coarse) return px > 2.0e6 ? 'low' : 'medium';
  if (cores <= 4 || mem <= 4)  return 'medium';
  if (cores >= 8 && mem >= 8)  return 'high';
  return 'medium';
}

/* ------------------------------------------------------------------- boot -- */

if (window.BA329Scene) {
  try { window.BA329Scene.destroy(); } catch (e) { console.warn(e); }
}

const canvas  = document.querySelector(CONFIG.canvasSelector);
const errorEl = document.querySelector(CONFIG.errorSelector);

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
  bootAC:      new AbortController(),
};

function startInit(){
  if (ctl.initStarted || ctl.cancelled) return;
  ctl.initStarted = true;
  initScene().catch(err => {
    console.error('Scene init failed:', err);
    showError('Scene init failed: ' + (err && err.message ? err.message : err));
  });
}

const api = {
  init(){ startInit(); },
  destroy(){
    ctl.cancelled = true;
    ctl.bootAC.abort();
    if (ctl.instance){ ctl.instance.dispose(); ctl.instance = null; }
  },
  pause(){  ctl.instance && ctl.instance.pause();  },
  resume(){ ctl.instance && ctl.instance.resume(); },
  setQuality(t){ ctl.instance && ctl.instance.setQuality(t); },
  get active(){ return !!(ctl.instance && !ctl.instance.disposed); },
};
window.BA329Scene = api;

if (!canvas){
  showError('#gl canvas not found — scene not initialized.');
  return;
}

if (CONFIG.initDelayMs > 0) setTimeout(startInit, CONFIG.initDelayMs);
else startInit();

window.addEventListener('pagehide', () => {
  ctl.instance && ctl.instance.dispose();
}, { signal: ctl.bootAC.signal });

/* ------------------------------------------------------------------ scene -- */

async function initScene(){
  const THREE = await import('three');
  const { DRACOLoader }     = await import('three/addons/loaders/DRACOLoader.js');
  const { GLTFLoader }      = await import('three/addons/loaders/GLTFLoader.js');
  const BufferGeometryUtils = await import('three/addons/utils/BufferGeometryUtils.js');
  if (ctl.cancelled) return;

  const mergeGeos = BufferGeometryUtils.mergeGeometries || BufferGeometryUtils.mergeBufferGeometries;

  const ac = new AbortController();
  const on = (target, type, fn, opts) =>
    target.addEventListener(type, fn, Object.assign({}, opts, { signal: ac.signal }));

  const disposables = new Set();
  const track = (obj) => { disposables.add(obj); return obj; };
  const untrack = (obj) => { if (obj){ disposables.delete(obj); obj.dispose && obj.dispose(); } };

  const startTier = detectTier();
  const q = Object.assign({}, QUALITY[startTier]);
  let currentTier = Math.max(0, TIERS.indexOf(startTier));

  /* ------------------------------------------------------------- settings -- */

  const settings = {
    // surface (textures removed — flat shaded)
    roughness:       0.86,
    baseColor:       '#f5f5f5',
    modelRoughness:  0.48,

    // model placement
    modelFit:        2.0,
    modelScale:      0.55,
    modelOffsetX:    0.0,
    modelOffsetY:    0.0,
    modelOffsetZ:    0.03,

    // framing
    // 'cover'   = constant apparent height on every viewport. Sides crop if the
    //             viewport is narrower than the statue. Behaves like CSS
    //             background-size: cover.
    // 'contain' = pulls the camera back on narrow viewports so nothing ever
    //             crops, at the cost of the statue shrinking.
    fitMode:         'cover',
    fitMargin:       1.12,   // >1 = more breathing room around the statue
    minDistance:     2.2,
    // The single lever for vertical position. Nothing else moves the camera.
    cameraOffsetY:   0.0,    // world units, negative = statue moves up
    radiusFollowsFit:true,   // keep the hover hole the same on-screen size

    // light
    lightIntensity:  0.9,
    lightX:          15,
    lightY:          15,
    lightZ:          15,
    ambient:         3.77,

    // baked shadow (replaces the 4-light realtime rig)
    shadows:               true,
    shadowX:               5.8,
    shadowY:               1.0,
    shadowZ:               15.0,
    shadowOpacity:         0.24,  // contact layer darkening, 0..1
    shadowFalloffOpacity:  0.0,   // wide layer darkening, 0..1 (off)
    shadowSoftness:        0.006, // world units — resolution independent now
    shadowFalloffSize:     1.0,   // wide layer = softness * this

    // hover
    radius:          0.27,
    feather:         0.05,
    hoverDepth:      0.43,
    hoverFalloff:    2.0,

    // lens
    lensEnabled:       true,
    lensMagnification: 1.15,
    lensBlurAmount:    1.0,
    lensBlurSize:      20.0,
    lensMotionBlur:    0.0,
    lensZoomBlur:      0.25,

    // liquid
    liqRefraction:     80.0,
    liqScale:          0.2,
    liqSpeed:          0.08,
    liqChromatic:      30.0,
    liqReflection:     0.0,
    liqShininess:      200.0,

    // ink edge
    inkStrength:     0.56,
    inkSpeed:        0.08,
    inkDistortion:   0.6,

    // reveal — the scene is static, so this starts fully revealed and only
    // ever moves if you call revealModel() / hideModel() yourself
    startRevealed:          true,
    revealSmoothing:        0.15,

    // drops
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

  /* ------------------------------------------------------------- renderer -- */

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;   // nothing casts realtime shadows any more

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 3.4);

  /* ------------------------------------------------------------- textures -- */

  const baseUrl = 'https://cdn.jsdelivr.net/gh/tadasba329/BA329-NEUE@main';
  const assetUrl = (file) => `${baseUrl}/${file}`;
  const tl = new THREE.TextureLoader();

  function tex(file, srgb, noMips){
    const url = /^https?:\/\//.test(file) ? file : assetUrl(file);
    const t = tl.load(url, undefined, undefined, () => showError(`Failed to load texture: ${url}`));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (noMips){ t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    return track(t);
  }

  // Only the noise mask survives — it drives the ink edge, the hover hole and
  // the liquid distortion. The three concrete PBR maps are gone: that removes
  // 3 texture fetches per pixel on a full-screen backdrop, the normal-mapping
  // path in the fragment shader, and 3 CDN downloads at load.
  // Sampled in the vertex shader too -> no mipmaps, keeps the VS fetch cheap.
  const maskNoise = tex('https://cdn.jsdelivr.net/gh/tadasba329/BA329-NEUE@dcf0c645a3ccf922a40c2d617efdd91a28e4fde5/noise-mask-v2.jpg', false, true);

  const emptyTex = track(new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1));
  emptyTex.needsUpdate = true;

  /* ------------------------------------------------------------- uniforms -- */

  const u = {
    uMouseWorld:    { value: new THREE.Vector3(9999, 9999, 0) },
    uRadius:        { value: settings.radius },
    uFeather:       { value: settings.feather },
    uMask:          { value: maskNoise },
    uTime:          { value: 0 },
    uInkStrength:   { value: settings.inkStrength },
    uInkSpeed:      { value: settings.inkSpeed },
    uInkDistortion: { value: settings.inkDistortion },
    uHoverDepth:    { value: settings.hoverDepth },
    uHoverFalloff:  { value: settings.hoverFalloff },
    uGlobalReveal:  { value: 0 },
    uModelScl:      { value: 1.0 },
    uModelOff:      { value: new THREE.Vector3(0, 0, settings.modelOffsetZ) },
    uModelRough:    { value: settings.modelRoughness },

    // baked shadow
    uBakeMap:       { value: emptyTex },
    uBakeMatrix:    { value: new THREE.Matrix4() },
    uShadowOpacity: { value: settings.shadowOpacity },
    uShadowFalloff: { value: settings.shadowFalloffOpacity },

    // drops
    uDropCount:     { value: 0 },
    uDrops:         { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(9999, 9999, 0, 0)) },
    uDropsAux:      { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(0, 0, 0.09, 0)) },
    uDropsStretch:  { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4(1, 0, 1, 0)) },
  };

  /* ------------------------------------------------------------ materials -- */

  // Untextured surface. `receiveBakedShadow` is only true for the backdrop.
  function makeConcrete(receiveBakedShadow){
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(settings.baseColor),
      roughness: settings.roughness,
      metalness: 0.0,
    });

    // the statue material needs no injection here at all any more
    if (!receiveBakedShadow) return track(m);

    m.onBeforeCompile = (shader) => {
      shader.uniforms.uBakeMap       = u.uBakeMap;
      shader.uniforms.uBakeMatrix    = u.uBakeMatrix;
      shader.uniforms.uShadowOpacity = u.uShadowOpacity;
      shader.uniforms.uShadowFalloff = u.uShadowFalloff;
      shader.uniforms.uGlobalReveal  = u.uGlobalReveal;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nuniform mat4 uBakeMatrix;\nvarying vec2 vBakeUv;')
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vec4 bakeWorldPos = modelMatrix * vec4( transformed, 1.0 );
          vBakeUv = ( uBakeMatrix * bakeWorldPos ).xy * 0.5 + 0.5;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec2 vBakeUv;
          uniform sampler2D uBakeMap;
          uniform float uShadowOpacity, uShadowFalloff, uGlobalReveal;
        `)
        // one texture fetch replaces two shadow-map lookups + two light loops
        .replace('#include <map_fragment>', `
          {
            vec2 bakeUv = vBakeUv;
            float inBounds = step(0.0, bakeUv.x) * step(bakeUv.x, 1.0)
                           * step(0.0, bakeUv.y) * step(bakeUv.y, 1.0);
            vec2 bakeSample = texture2D( uBakeMap, bakeUv ).rg;
            float shade = bakeSample.r * uShadowOpacity + bakeSample.g * uShadowFalloff;
            shade = clamp(shade, 0.0, 0.92) * inBounds * smoothstep(0.0, 1.0, uGlobalReveal);
            diffuseColor.rgb *= (1.0 - shade);
          }
        `);
    };

    return track(m);
  }

  /* --------------------------------------------------- reveal vertex code -- */

  // Early-out added: vertices far from the pointer skip the vertex texture
  // fetch entirely. The drop loop is compiled out unless drops are enabled.
  const revealVertexChunk = `
    float reveal = uGlobalReveal;
    {
      vec2 wpos2 = position.xy * uModelScl + uModelOff.xy;
      float inkT = uTime * uInkSpeed;
      float hole = 0.0;

      float dRev = distance(wpos2, uMouseWorld.xy);
      if (dRev < uRadius + uFeather + uInkStrength * 0.6) {
        vec2 inkUV = wpos2 / 1.4 + vec2(inkT * 0.06, inkT * 0.04);
        vec2 inkWarp = vec2(
          sin(inkUV.y * 6.2831853 + inkT * 1.7),
          cos(inkUV.x * 6.2831853 - inkT * 1.3)
        ) * uInkDistortion * 0.12;
        float nRev = texture2D(uMask, inkUV + inkWarp).r;
        dRev += (nRev - 0.5) * uInkStrength;
        float h = 1.0 - smoothstep(uRadius - uFeather, uRadius + uFeather, dRev);
        hole = pow(clamp(h, 0.0, 1.0), uHoverFalloff) * uHoverDepth;
      }

      #ifdef USE_DROPS
      for (int i = 0; i < MAX_DROPS; i++){
        if (i >= uDropCount) break;
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
      #endif

      reveal = uGlobalReveal * (1.0 - hole);
    }
  `;

  function injectReveal(shader){
    Object.assign(shader.uniforms, {
      uMouseWorld: u.uMouseWorld, uRadius: u.uRadius, uFeather: u.uFeather,
      uMask: u.uMask, uTime: u.uTime, uInkStrength: u.uInkStrength,
      uInkSpeed: u.uInkSpeed, uInkDistortion: u.uInkDistortion,
      uHoverDepth: u.uHoverDepth, uHoverFalloff: u.uHoverFalloff,
      uGlobalReveal: u.uGlobalReveal,
      uModelScl: u.uModelScl, uModelOff: u.uModelOff,
      uDropCount: u.uDropCount,
      uDrops: u.uDrops, uDropsAux: u.uDropsAux, uDropsStretch: u.uDropsStretch,
    });

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      #define MAX_DROPS ${MAX_DROPS}
      uniform vec3 uMouseWorld;
      uniform vec3 uModelOff;
      uniform float uRadius, uFeather, uInkStrength, uInkSpeed, uInkDistortion;
      uniform float uTime, uGlobalReveal, uHoverDepth, uHoverFalloff, uModelScl;
      uniform sampler2D uMask;
      uniform int uDropCount;
      uniform vec4 uDrops[MAX_DROPS];
      uniform vec4 uDropsAux[MAX_DROPS];
      uniform vec4 uDropsStretch[MAX_DROPS];`
    );

    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        ${revealVertexChunk}
        objectNormal = normalize(mix(vec3(0.0, 0.0, 1.0), objectNormal, reveal));
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        transformed.z *= reveal;
      `);
  }

  /* ------------------------------------------------------------ backdrop -- */

  const bgGeo = track(new THREE.PlaneGeometry(30, 30));

  const bgMat = makeConcrete(true);
  const bg = new THREE.Mesh(bgGeo, bgMat);
  bg.position.z = -0.001;
  scene.add(bg);

  /* --------------------------------------------------------------- model -- */

  const modelMat = makeConcrete(false);
  {
    const baseCompile = modelMat.onBeforeCompile;
    modelMat.onBeforeCompile = (shader) => {
      baseCompile(shader);
      injectReveal(shader);
      shader.uniforms.uModelRough = u.uModelRough;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uModelRough;')
        .replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\nroughnessFactor = clamp(uModelRough, 0.045, 1.0);');
    };
  }
  modelMat.roughness = settings.modelRoughness;
  modelMat.metalness = 0.0;
  modelMat.defines = modelMat.defines || {};
  function applyDropsMode(){
    const want = !!settings.dropsEnabled;
    const has  = !!modelMat.defines.USE_DROPS;
    if (want === has) return;
    if (want) modelMat.defines.USE_DROPS = '';
    else delete modelMat.defines.USE_DROPS;
    modelMat.needsUpdate = true;
  }
  applyDropsMode();

  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  function applyModelTransform(){
    modelGroup.scale.setScalar(settings.modelScale);
    modelGroup.position.set(settings.modelOffsetX, settings.modelOffsetY, settings.modelOffsetZ);
    u.uModelScl.value = settings.modelScale;
    u.uModelOff.value.set(settings.modelOffsetX, settings.modelOffsetY, settings.modelOffsetZ);
  }
  applyModelTransform();

  /* --------------------------------------------------------------- lights -- */

  const sun = new THREE.DirectionalLight(0xffffff, settings.lightIntensity);
  sun.position.set(settings.lightX, settings.lightY, settings.lightZ);
  sun.castShadow = false;
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0xffffff, settings.ambient);
  scene.add(ambient);

  function applyModelLight(){
    sun.intensity = settings.lightIntensity;
    sun.position.set(settings.lightX, settings.lightY, settings.lightZ);
    ambient.intensity = settings.ambient;
  }

  function applyShadowSettings(){
    u.uShadowOpacity.value = settings.shadows ? settings.shadowOpacity : 0;
    u.uShadowFalloff.value = settings.shadows ? settings.shadowFalloffOpacity : 0;
  }

  /* ---------------------------------------------------- fullscreen passes -- */

  const fsVertex = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const rtSize   = new THREE.Vector2(1, 1);
  const blurSize = new THREE.Vector2(1, 1);
  renderer.getDrawingBufferSize(rtSize);

  const blurUniforms = {
    tInput:  { value: null },
    uDir:    { value: new THREE.Vector2(1, 0) },
    uTexel:  { value: new THREE.Vector2(1, 1) },
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
    tSharp:      { value: null },
    tBlur:       { value: null },
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

  // The big win: everything outside the hover hole now takes the cheap branch.
  const compositeMat = track(new THREE.ShaderMaterial({
    uniforms: lensUniforms,
    defines: { LENS_TAPS: q.lensTaps },
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
        float d = distance(wpos, uMouseWorld.xy);
        // cheap reject: skip the noise fetch for the ~95% of pixels that are
        // nowhere near the hole
        if (d > uRadius + uFeather + uInkStrength * 0.6) return 0.0;
        float inkT = uTime * uInkSpeed;
        vec2 inkUV = wpos / 1.4 + vec2(inkT * 0.06, inkT * 0.04);
        vec2 inkWarp = vec2(
          sin(inkUV.y * 6.2831853 + inkT * 1.7),
          cos(inkUV.x * 6.2831853 - inkT * 1.3)
        ) * uInkDistortion * 0.12;
        float nRev = texture2D(uMask, inkUV + inkWarp).r;
        d += (nRev - 0.5) * uInkStrength;
        float hole = 1.0 - smoothstep(uRadius - uFeather, uRadius + uFeather, d);
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
        if (blurK < 0.004) return s;
        return mix(s, texture2D(tBlur, uv), blurK);
      }

      void main(){
        vec4 col;
        vec2 wpos = worldOnPlane(vUv);
        float m = hoverHole(wpos) * uGlobalReveal;

        if (m < 0.002){
          col = texture2D(tSharp, vUv);            // plain blit — 1 fetch
        } else {
          vec3 n = liquidNormal(wpos);
          vec2 texel = 1.0 / uResolution;
          vec2 refr = n.xy * uLiqRefract * m * texel;
          vec2 magUv = uCenterUv + (vUv - uCenterUv) / max(uMag, 0.01);
          vec2 uv = mix(vUv, magUv, m) + refr;
          float blurK = clamp(uBlurMix * m, 0.0, 1.0);

          vec2 mo = uVelocity * uMotion * m;
          vec2 zo = (uCenterUv - uv) * uZoom * m;

          if (dot(mo, mo) + dot(zo, zo) > 1e-10){
            col = vec4(0.0);
            for (int i = 0; i < LENS_TAPS; i++){
              float t = (float(i) / float(LENS_TAPS - 1) - 0.5) * 2.0;
              col += sampleScene(uv + (mo + zo) * t * 0.5, blurK);
            }
            col /= float(LENS_TAPS);
          } else {
            col = sampleScene(uv, blurK);
          }

          float ca = uLiqChromatic * m;
          if (ca > 0.05){
            vec2 caOff = n.xy * ca * texel;
            col.r = sampleScene(uv + caOff, blurK).r;
            col.b = sampleScene(uv - caOff, blurK).b;
          }

          if (uLiqReflect > 0.001){
            vec3 L = normalize(uLightDir);
            float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), uLiqShine);
            col.rgb += spec * uLiqReflect * m;
          }
        }

        gl_FragColor = col;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));

  const combineUniforms = { tTight: { value: null }, tWide: { value: null } };
  const combineMat = track(new THREE.ShaderMaterial({
    uniforms: combineUniforms,
    depthTest: false, depthWrite: false,
    vertexShader: fsVertex,
    fragmentShader: `
      uniform sampler2D tTight, tWide;
      varying vec2 vUv;
      void main(){
        gl_FragColor = vec4(texture2D(tTight, vUv).a, texture2D(tWide, vUv).a, 0.0, 1.0);
      }
    `,
  }));

  const bakeMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }));

  const postScene    = new THREE.Scene();
  const postCam      = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postQuadGeo  = track(new THREE.PlaneGeometry(2, 2));
  const postQuad     = new THREE.Mesh(postQuadGeo, compositeMat);
  postQuad.frustumCulled = false;
  postScene.add(postQuad);

  let sceneRT = null;
  const blurA = track(new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false }));
  const blurB = track(new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false }));

  function makeSceneRT(){
    if (sceneRT) untrack(sceneRT);
    const opts = { depthBuffer: true, stencilBuffer: false };
    if (q.msaa > 0) opts.samples = q.msaa;
    sceneRT = track(new THREE.WebGLRenderTarget(
      Math.max(1, rtSize.x), Math.max(1, rtSize.y), opts
    ));
    lensUniforms.tSharp.value = sceneRT.texture;
    if (!lensUniforms.tBlur.value) lensUniforms.tBlur.value = sceneRT.texture;
  }
  makeSceneRT();

  /* ------------------------------------------------------- lifecycle vars -- */

  const clock = new THREE.Clock();
  const dracoLoader = new DRACOLoader();

  let visIO = null;
  let sizeRO = null;
  let connCheckId = 0;
  let inView = true;
  let tabVisible = !document.hidden;
  let manualPaused = false;
  let running = false;
  let disposed = false;
  let loopReady = false;
  let idleSettled = false;
  let inkDropFn = null, revealFn = null, hideFn = null;
  let gui = null;

  const wake = () => { idleSettled = false; };

  function dispose(){
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    ac.abort();
    if (connCheckId) clearInterval(connCheckId);
    if (visIO)  visIO.disconnect();
    if (sizeRO) sizeRO.disconnect();
    if (gui){ try { gui.destroy(); } catch (e) {} gui = null; }
    modelGroup.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    disposables.forEach(d => { if (d.dispose) d.dispose(); });
    disposables.clear();
    dracoLoader.dispose();
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
    if (window.inkDrop === inkDropFn)    window.inkDrop = undefined;
    if (window.revealModel === revealFn) window.revealModel = undefined;
    if (window.hideModel === hideFn)     window.hideModel = undefined;
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
    setQuality(tier){
      const i = TIERS.indexOf(tier);
      if (i < 0) return;
      currentTier = i;
      applyQuality();
    },
    get disposed(){ return disposed; },
  };
  ctl.instance = instance;
  if (ctl.cancelled){ dispose(); return; }

  /* ----------------------------------------------------------- load model -- */

  const modelUrl = 'https://cdn.jsdelivr.net/gh/tadasba329/BA329-NEUE@cae8e094c68f48154569def9fc673915bc718ad6/index-new-update-v2-cut-optimized.glb';
  dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/');
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  const dropBounds  = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  const modelHalf   = new THREE.Vector2(1, 1);
  let   modelDepth  = 0;

  await new Promise((resolve, reject) => {
    gltfLoader.load(modelUrl, (gltf) => {
      gltf.scene.updateMatrixWorld(true);

      const srcMeshes = [];
      gltf.scene.traverse((c) => { if (c.isMesh) srcMeshes.push(c); });

      const geos = [];
      let unionBB = null;

      srcMeshes.forEach((c) => {
        let g = c.geometry.clone();
        g.applyMatrix4(c.matrixWorld);
        // strip everything but position so all parts merge cleanly later
        for (const name of Object.keys(g.attributes)){
          if (name !== 'position') g.deleteAttribute(name);
        }
        g.morphAttributes = {};
        g = BufferGeometryUtils.mergeVertices(g);
        g.computeVertexNormals();
        // NOTE: EdgeSplitModifier was called with PI (= never splits) in the
        // original, so it did nothing but cost load time. Removed.
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

      const size   = new THREE.Vector3(); unionBB.getSize(size);
      const center = new THREE.Vector3(); unionBB.getCenter(center);
      const fit = settings.modelFit / Math.max(size.x, size.y, 1e-6);

      // no uv attribute: nothing samples a texture on the statue any more
      geos.forEach((g) => {
        g.translate(-center.x, -center.y, -unionBB.min.z);
        g.scale(fit, fit, fit);
      });

      // ONE draw call instead of one per source mesh
      let merged = null;
      if (geos.length === 1) merged = geos[0];
      else {
        try { merged = mergeGeos(geos, false); } catch (e) { console.warn('merge failed', e); }
      }

      const finalGeos = merged ? [merged] : geos;
      if (merged) geos.forEach(g => { if (g !== merged) g.dispose(); });

      let finalBB = null;
      finalGeos.forEach((g) => {
        g.computeBoundingBox();
        if (!finalBB) finalBB = g.boundingBox.clone();
        else finalBB.union(g.boundingBox);
        const mesh = new THREE.Mesh(g, modelMat);
        mesh.frustumCulled = false;
        modelGroup.add(mesh);
      });

      if (finalBB){
        dropBounds.minX = finalBB.min.x; dropBounds.maxX = finalBB.max.x;
        dropBounds.minY = finalBB.min.y; dropBounds.maxY = finalBB.max.y;
        modelHalf.set(
          Math.max(Math.abs(finalBB.min.x), Math.abs(finalBB.max.x)),
          Math.max(Math.abs(finalBB.min.y), Math.abs(finalBB.max.y))
        );
        modelDepth = finalBB.max.z - finalBB.min.z;
      }

      resolve();
    }, undefined, (err) => {
      console.error('GLTFLoader error:', err);
      showError(`Failed to load model: ${modelUrl}`);
      reject(err);
    });
  });

  if (ctl.cancelled || disposed){ dispose(); return; }

  /* ------------------------------------------------------- BAKED LIGHTING -- */
  /*
     Directional shadows for a static model + static light are a constant.
     So we solve them once:
       1. render the statue silhouette through an ortho camera aimed down the
          light direction  -> exactly the set of points the light can't reach
       2. blur it twice (contact + wide falloff)
       3. pack both into one RG texture
       4. project it onto the backdrop with the same matrix in the bg shader
     Per-frame cost afterwards: a single texture fetch. No shadow map, no
     extra lights, no depth material.
  */

  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  let bakeRT = null;

  function makeBakeRT(size, depth){
    return new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: !!depth,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
  }

  // separable gaussian, auto pass/spread split so big radii stay smooth
  function blurPingPong(srcTex, a, b, texel, sigmaTexels){
    const passes = Math.max(1, Math.min(6, Math.ceil(sigmaTexels / 12)));
    const spread = Math.max(0.4, sigmaTexels / (2.0 * Math.sqrt(passes)));
    blurUniforms.uTexel.value.set(texel, texel);
    blurUniforms.uSpread.value = spread;
    postQuad.material = blurMat;
    let read = srcTex;
    for (let p = 0; p < passes; p++){
      blurUniforms.tInput.value = read;
      blurUniforms.uDir.value.set(1, 0);
      renderer.setRenderTarget(a);
      renderer.render(postScene, postCam);

      blurUniforms.tInput.value = a.texture;
      blurUniforms.uDir.value.set(0, 1);
      renderer.setRenderTarget(b);
      renderer.render(postScene, postCam);

      read = b.texture;
    }
    return read;
  }

  function bakeShadow(){
    if (!modelGroup.children.length) return;
    renderer.setScissorTest(false);   // a rebake can land while the lens is up

    const size  = q.bake;
    const quart = Math.max(64, size >> 2);

    modelGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(settings.shadowX, settings.shadowY, settings.shadowZ);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    const dist = sphere.radius * 2.5 + 1.0;
    bakeCam.position.copy(center).addScaledVector(dir, dist);
    bakeCam.up.set(0, 1, 0);
    bakeCam.lookAt(center);
    bakeCam.updateMatrixWorld(true);

    // fit the frustum to the model in light space, then pad for the blur tail
    const inv = bakeCam.matrixWorldInverse;
    const corner = new THREE.Vector3();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++){
      corner.set(
        (i & 1) ? box.max.x : box.min.x,
        (i & 2) ? box.max.y : box.min.y,
        (i & 4) ? box.max.z : box.min.z
      ).applyMatrix4(inv);
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
    }

    const wideWorld = settings.shadowSoftness * settings.shadowFalloffSize;
    const pad = wideWorld * 3.0 + sphere.radius * 0.05;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;

    // keep it square so one texel size covers both axes
    const halfExtent = Math.max(maxX - minX, maxY - minY) * 0.5;
    const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5;
    bakeCam.left = cx - halfExtent; bakeCam.right = cx + halfExtent;
    bakeCam.bottom = cy - halfExtent; bakeCam.top = cy + halfExtent;
    bakeCam.near = 0.05;
    bakeCam.far  = dist + sphere.radius * 3.0;
    bakeCam.updateProjectionMatrix();

    u.uBakeMatrix.value
      .copy(bakeCam.projectionMatrix)
      .multiply(bakeCam.matrixWorldInverse);

    const texelWorld  = (halfExtent * 2) / size;
    const sigmaTight  = Math.max(0.5, settings.shadowSoftness / texelWorld);
    const sigmaWide   = Math.max(sigmaTight + 1, wideWorld / texelWorld);
    const sigmaExtraQ = Math.sqrt(Math.max(0, sigmaWide * sigmaWide - sigmaTight * sigmaTight)) / 4;

    const src = makeBakeRT(size, true);
    const fA  = makeBakeRT(size, false);
    const fB  = makeBakeRT(size, false);
    const qA  = makeBakeRT(quart, false);
    const qB  = makeBakeRT(quart, false);

    // --- 1. silhouette ---------------------------------------------------
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    const prevTarget = renderer.getRenderTarget();

    bg.visible = false;
    scene.overrideMaterial = bakeMat;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(src);
    renderer.clear(true, true, false);
    renderer.render(scene, bakeCam);
    scene.overrideMaterial = null;
    bg.visible = true;

    // --- 2. two blur levels ----------------------------------------------
    blurPingPong(src.texture, fA, fB, 1 / size, sigmaTight);
    blurPingPong(fB.texture, qA, qB, 1 / quart, sigmaExtraQ);

    // --- 3. pack into one RG texture --------------------------------------
    if (!bakeRT) bakeRT = track(makeBakeRT(size, false));
    else if (bakeRT.width !== size) bakeRT.setSize(size, size);

    combineUniforms.tTight.value = fB.texture;
    combineUniforms.tWide.value  = qB.texture;
    postQuad.material = combineMat;
    renderer.setRenderTarget(bakeRT);
    renderer.render(postScene, postCam);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    postQuad.material = compositeMat;

    [src, fA, fB, qA, qB].forEach(rt => rt.dispose());

    // the uniform object is shared with the compiled program, so swapping the
    // value is enough — no needsUpdate / recompile hitch
    u.uBakeMap.value = bakeRT.texture;
    applyShadowSettings();
  }

  let rebakeQueued = false;
  function scheduleRebake(){
    if (rebakeQueued || disposed) return;
    rebakeQueued = true;
    requestAnimationFrame(() => {
      rebakeQueued = false;
      if (!disposed){ bakeShadow(); wake(); }
    });
  }

  bakeShadow();

  /* --------------------------------------------------- sizing & framing -- */

  let canvasRect = canvas.getBoundingClientRect();
  let baseDistance = 3.4;

  // The canvas rect is needed to map the pointer, and it does move when the
  // page scrolls. Flag it stale and re-read lazily — one layout read per frame
  // at most, and it never touches the camera, so nothing shifts on scroll.
  let rectDirty = false;
  function getRect(){
    if (rectDirty){ canvasRect = canvas.getBoundingClientRect(); rectDirty = false; }
    return canvasRect;
  }
  on(window, 'scroll', () => { rectDirty = true; }, { passive: true });

  function measure(){
    let w = 0, h = 0;
    if (CONFIG.sizeFromCanvas){
      const r = canvas.getBoundingClientRect();
      w = Math.round(r.width); h = Math.round(r.height);
    }
    if (CONFIG.fitToVisualViewport && window.visualViewport){
      h = Math.round(window.visualViewport.height);
      canvas.style.height = h + 'px';
    }
    if (!w || !h){
      // canvas has no CSS box yet — make it fill its parent and re-measure
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const r2 = canvas.getBoundingClientRect();
      w = Math.round(r2.width)  || window.innerWidth;
      h = Math.round(r2.height) || window.innerHeight;
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  // 'cover' holds the camera at a fixed distance, so the statue keeps the same
  // apparent height everywhere and modelScale directly controls how big it
  // reads. 'contain' pulls back on narrow viewports so nothing crops.
  function fitCamera(){
    const s  = settings.modelScale;
    const hx = modelHalf.x * s;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const tanV = Math.tan(vFov / 2);

    let d = baseDistance;

    if (settings.fitMode === 'contain'){
      const dH = (hx * settings.fitMargin) / (tanV * Math.max(camera.aspect, 0.05))
               + settings.modelOffsetZ + modelDepth * 0.5;
      d = Math.max(d, dH);
    }
    d = Math.max(d, settings.minDistance);

    const camY = settings.cameraOffsetY;

    camera.position.set(0, camY, d);
    camera.lookAt(0, camY, 0);
    camera.updateProjectionMatrix();

    // world-space hover sizes scale with distance so the hole keeps the same
    // apparent size on a phone as on a desktop
    const k = settings.radiusFollowsFit ? Math.max(d / baseDistance, 0.25) : 1;
    u.uRadius.value      = settings.radius * k;
    u.uFeather.value     = settings.feather * k;
    u.uInkStrength.value = settings.inkStrength * k;
  }

  function resize(){
    const { w, h } = measure();
    canvasRect = canvas.getBoundingClientRect();
    rectDirty = false;

    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    renderer.getDrawingBufferSize(rtSize);
    sceneRT.setSize(rtSize.x, rtSize.y);
    blurSize.set(
      Math.max(1, Math.floor(rtSize.x / q.blurDiv)),
      Math.max(1, Math.floor(rtSize.y / q.blurDiv))
    );
    blurA.setSize(blurSize.x, blurSize.y);
    blurB.setSize(blurSize.x, blurSize.y);
    lensUniforms.uResolution.value.copy(rtSize);

    fitCamera();
    idleSettled = false;
  }

  // The design distance, locked in once at load from a desktop aspect. In
  // 'cover' mode this IS the camera distance on every device, which is what
  // keeps the statue the same apparent size everywhere and leaves modelScale
  // free to actually change how big it reads.
  {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const dV = (modelHalf.y * settings.modelScale * settings.fitMargin) / tanV;
    const dH = (modelHalf.x * settings.modelScale * settings.fitMargin) / (tanV * 1.6);
    baseDistance = Math.max(dV, dH, settings.minDistance) + settings.modelOffsetZ + modelDepth * 0.5;
  }

  if (window.ResizeObserver){
    sizeRO = new ResizeObserver(() => resize());
    sizeRO.observe(canvas);
  }
  on(window, 'resize', resize);
  on(window, 'orientationchange', () => setTimeout(resize, 120));
  if (window.visualViewport && CONFIG.fitToVisualViewport){
    on(window.visualViewport, 'resize', resize);
  }
  resize();

  /* --------------------------------------------------------------- quality -- */

  let qualityCtrl = null;
  const qualityProxy = { tier: TIERS[currentTier] };

  function applyQuality(){
    Object.assign(q, QUALITY[TIERS[currentTier]]);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    makeSceneRT();
    resize();
    lensActiveAllowed = q.lens;
    idleSettled = false;
    if (qualityCtrl){
      qualityProxy.tier = TIERS[currentTier];
      qualityCtrl.updateDisplay();
    }
  }

  let lensActiveAllowed = q.lens;

  const perf = { frames: 0, accum: 0, warmup: 40, strikes: 0 };
  function samplePerf(dt){
    if (!CONFIG.autoQuality) return;
    if (perf.warmup > 0){ perf.warmup--; return; }
    perf.accum += dt; perf.frames++;
    if (perf.frames < 45) return;
    const avgMs = (perf.accum / perf.frames) * 1000;
    perf.accum = 0; perf.frames = 0;
    if (avgMs > CONFIG.targetFrameMs){
      perf.strikes++;
      if (perf.strikes >= 2 && currentTier < TIERS.length - 1){
        perf.strikes = 0;
        currentTier++;
        applyQuality();
        console.info('[BA329] stepping down to quality tier:', TIERS[currentTier]);
      }
    } else {
      perf.strikes = 0;
    }
  }

  /* ----------------------------------------------------------- lens passes -- */

  const lensProj   = new THREE.Vector3();
  const centerNow  = new THREE.Vector2(-10, -10);
  const centerPrev = new THREE.Vector2(-10, -10);
  const velSmooth  = new THREE.Vector2(0, 0);
  const velRaw     = new THREE.Vector2(0, 0);
  const lensRadiusUv = new THREE.Vector2(0, 0);

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
      lensRadiusUv.set(0, 0);
    } else {
      lensProj.set(mw.x, mw.y, 0).project(camera);
      centerNow.set(lensProj.x * 0.5 + 0.5, lensProj.y * 0.5 + 0.5);

      // exact screen-space extent of the hole (same expression as the shader)
      const R = u.uRadius.value + u.uFeather.value + u.uInkStrength.value * 0.6;
      lensProj.set(mw.x + R, mw.y + R, 0).project(camera);
      lensRadiusUv.set(
        Math.abs(lensProj.x * 0.5 + 0.5 - centerNow.x),
        Math.abs(lensProj.y * 0.5 + 0.5 - centerNow.y)
      );

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

  // Only blurs the rectangle the lens actually covers instead of the whole
  // screen. Padding covers refraction + magnification offsets.
  function renderBlurChain(){
    if (settings.lensBlurAmount <= 0.001 || settings.lensBlurSize <= 0.001){
      lensUniforms.tBlur.value = sceneRT.texture;
      return;
    }

    const padX = lensRadiusUv.x + 0.14;
    const padY = lensRadiusUv.y + 0.14;
    const x0 = Math.max(0, Math.floor((lensUniforms.uCenterUv.value.x - padX) * blurSize.x));
    const y0 = Math.max(0, Math.floor((lensUniforms.uCenterUv.value.y - padY) * blurSize.y));
    const x1 = Math.min(blurSize.x, Math.ceil((lensUniforms.uCenterUv.value.x + padX) * blurSize.x));
    const y1 = Math.min(blurSize.y, Math.ceil((lensUniforms.uCenterUv.value.y + padY) * blurSize.y));
    const sw = x1 - x0, sh = y1 - y0;
    if (sw <= 0 || sh <= 0){
      lensUniforms.tBlur.value = sceneRT.texture;
      return;
    }

    renderer.setScissorTest(true);
    renderer.setScissor(x0, y0, sw, sh);

    blurUniforms.uTexel.value.set(1 / blurSize.x, 1 / blurSize.y);
    blurUniforms.uSpread.value = Math.max(settings.lensBlurSize / q.blurDiv, 0.01);
    postQuad.material = blurMat;

    let src = sceneRT.texture;
    const passes = Math.max(1, q.blurPasses);
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

    renderer.setScissorTest(false);
    renderer.setRenderTarget(null);
    lensUniforms.tBlur.value = blurB.texture;
  }

  /* -------------------------------------------------------- scroll reveal -- */

  const easeOutCubic = k => 1 - Math.pow(1 - k, 3);
  const smooth = k => k * k * (3 - 2 * k);

  // The scene is static: nothing reads scroll position, so nothing shifts as
  // the page moves. revealModel() / hideModel() are still there if you ever
  // want to drive it from your own trigger.
  let revealGoal = settings.startRevealed ? 1 : 0;
  u.uGlobalReveal.value = revealGoal;

  /* ---------------------------------------------------------------- drops -- */

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
      x: cx + ox, y: cy + oy,
      popRadius, fullRadius, stretch,
      cosA: Math.cos(stretchAngle),
      sinA: Math.sin(stretchAngle),
      seed: Math.random(),
      born: now,
    };
  }

  function updateDrops(now){
    if (!settings.dropsEnabled && u.uDropCount.value === 0 && !dropSlots.some(Boolean)) return;

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

    let highest = 0;

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
      highest = i + 1;

      let radius, strength, growProgress, fadeK = 0, currentStretch;
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

    u.uDropCount.value = highest;
  }

  inkDropFn = (x, y, scale, stretch, stretchAngle) => {
    const slot = dropSlots.findIndex(d => d === null);
    if (slot === -1) return;
    if (!settings.dropsEnabled){ settings.dropsEnabled = true; applyDropsMode(); }
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
  revealFn = () => { revealGoal = 1; idleSettled = false; };
  hideFn   = () => { revealGoal = 0; idleSettled = false; };

  window.inkDrop = inkDropFn;
  window.revealModel = revealFn;
  window.hideModel = hideFn;

  /* -------------------------------------------------------------- pointer -- */

  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const mouseTarget = new THREE.Vector3(9999, 9999, 0);
  let hasMouse = false;

  // mapped through the canvas rect, not the window — this is what made the
  // hover hole drift away from the cursor inside Webflow layouts
  function setMouse(clientX, clientY){
    const r = getRect();
    if (!r || !r.width || !r.height) return;
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    if (x < -0.25 || x > 1.25 || y < -0.25 || y > 1.25){ hasMouse = false; return; }
    ndc.set(x * 2 - 1, -(y * 2) + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(plane, hit)){
      mouseTarget.copy(hit);
      hasMouse = true;
      idleSettled = false;
    }
  }

  on(window, 'pointermove', e => setMouse(e.clientX, e.clientY), { passive: true });
  on(window, 'pointerleave', () => { hasMouse = false; idleSettled = false; });
  on(window, 'touchmove', e => {
    if (e.touches[0]) setMouse(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });

  /* ------------------------------------------------------------------ gui -- */

  if (CONFIG.showControlPanel){
    try {
      const { GUI } = await import('three/addons/libs/lil-gui.module.min.js');
      gui = new GUI({ title: 'BA329 Scene' });
      gui.domElement.style.zIndex = '10001';
      const W = (fn) => (v) => { fn(v); wake(); };

      const fFrame = gui.addFolder('Framing');
      fFrame.add(settings, 'fitMode', ['cover', 'contain']).name('Fit mode').onChange(W(fitCamera));
      fFrame.add(settings, 'fitMargin', 1, 2, 0.01).name('Margin').onChange(W(fitCamera));
      fFrame.add(settings, 'minDistance', 0.5, 8, 0.01).name('Min distance').onChange(W(fitCamera));
      fFrame.add(settings, 'cameraOffsetY', -1, 1, 0.01).name('Vertical offset').onChange(W(fitCamera));
      fFrame.add(settings, 'radiusFollowsFit').name('Scale hover w/ fit').onChange(W(fitCamera));

      const fModel = gui.addFolder('Model');
      fModel.add(settings, 'modelScale', 0.1, 4, 0.01).name('Scale')
        .onChange(W(() => { applyModelTransform(); fitCamera(); scheduleRebake(); }));
      fModel.add(settings, 'modelOffsetX', -2, 2, 0.01).name('Offset X')
        .onChange(W(() => { applyModelTransform(); scheduleRebake(); }));
      fModel.add(settings, 'modelOffsetY', -2, 2, 0.01).name('Offset Y')
        .onChange(W(() => { applyModelTransform(); scheduleRebake(); }));
      fModel.add(settings, 'modelOffsetZ', 0, 0.3, 0.001).name('Offset Z (depth)')
        .onChange(W(() => { applyModelTransform(); scheduleRebake(); }));

      const fSurf = gui.addFolder('Surface');
      fSurf.add(settings, 'roughness', 0, 1, 0.01).name('Roughness (background)')
        .onChange(W(v => bgMat.roughness = v));
      fSurf.addColor(settings, 'baseColor').name('Base color').onChange(W(v => {
        bgMat.color.set(v); modelMat.color.set(v);
      }));
      fSurf.close();

      const fMat = gui.addFolder('Model material');
      fMat.add(settings, 'modelRoughness', 0, 1, 0.01).name('Matte amount')
        .onChange(W(v => { u.uModelRough.value = v; modelMat.roughness = v; }));

      const fLight = gui.addFolder('Model light');
      fLight.add(settings, 'lightIntensity', 0, 10, 0.01).name('Intensity').onChange(W(applyModelLight));
      fLight.add(settings, 'lightX', -15, 15, 0.1).name('X').onChange(W(applyModelLight));
      fLight.add(settings, 'lightY', -15, 15, 0.1).name('Y').onChange(W(applyModelLight));
      fLight.add(settings, 'lightZ', 0.5, 15, 0.1).name('Z').onChange(W(applyModelLight));
      fLight.add(settings, 'ambient', 0, 5, 0.01).name('Ambient').onChange(W(applyModelLight));

      const fShadow = gui.addFolder('Baked shadow');
      fShadow.add(settings, 'shadows').name('Enabled').onChange(W(applyShadowSettings));
      fShadow.add(settings, 'shadowOpacity', 0, 1, 0.01).name('Contact opacity').onChange(W(applyShadowSettings));
      fShadow.add(settings, 'shadowFalloffOpacity', 0, 1, 0.01).name('Falloff opacity').onChange(W(applyShadowSettings));
      fShadow.add(settings, 'shadowSoftness', 0.002, 0.2, 0.002).name('Softness').onChange(W(scheduleRebake));
      fShadow.add(settings, 'shadowFalloffSize', 1, 30, 0.5).name('Falloff size').onChange(W(scheduleRebake));
      fShadow.add(settings, 'shadowX', -15, 15, 0.1).name('X').onChange(W(scheduleRebake));
      fShadow.add(settings, 'shadowY', -15, 15, 0.1).name('Y').onChange(W(scheduleRebake));
      fShadow.add(settings, 'shadowZ', 0.5, 15, 0.1).name('Z').onChange(W(scheduleRebake));

      const fHover = gui.addFolder('Hover');
      fHover.add(settings, 'radius', 0.02, 1.5, 0.01).name('Radius').onChange(W(fitCamera));
      fHover.add(settings, 'feather', 0.001, 0.5, 0.001).name('Feather').onChange(W(fitCamera));
      fHover.add(settings, 'hoverDepth', 0, 1, 0.01).name('Depth').onChange(W(v => u.uHoverDepth.value = v));
      fHover.add(settings, 'hoverFalloff', 0.2, 6, 0.05).name('Falloff').onChange(W(v => u.uHoverFalloff.value = v));
      fHover.close();

      const fInk = gui.addFolder('Ink edge');
      fInk.add(settings, 'inkStrength', 0, 2, 0.01).name('Strength').onChange(W(fitCamera));
      fInk.add(settings, 'inkSpeed', 0, 1, 0.005).name('Speed').onChange(W(v => u.uInkSpeed.value = v));
      fInk.add(settings, 'inkDistortion', 0, 3, 0.01).name('Distortion').onChange(W(v => u.uInkDistortion.value = v));
      fInk.close();

      const fLens = gui.addFolder('Lens');
      fLens.add(settings, 'lensEnabled').name('Enabled').onChange(W(() => {}));
      fLens.add(settings, 'lensMagnification', 1, 2, 0.01).name('Magnification').onChange(W(v => lensUniforms.uMag.value = v));
      fLens.add(settings, 'lensBlurAmount', 0, 1, 0.01).name('Blur amount').onChange(W(v => lensUniforms.uBlurMix.value = v));
      fLens.add(settings, 'lensBlurSize', 0, 60, 0.5).name('Blur size').onChange(W(() => {}));
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
      fRev.add(settings, 'revealSmoothing', 0.01, 1, 0.01).name('Smoothing');
      fRev.add({ reveal(){ revealFn(); } }, 'reveal').name('Force reveal');
      fRev.add({ hide(){ hideFn(); } }, 'hide').name('Force hide');
      fRev.close();

      const fDrops = gui.addFolder('Ink drops');
      fDrops.add(settings, 'dropsEnabled').name('Enabled').onChange(W(applyDropsMode));
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

      const fPerf = gui.addFolder('Performance');
      qualityCtrl = fPerf.add(qualityProxy, 'tier', TIERS).name('Quality')
        .onChange(W(t => { currentTier = TIERS.indexOf(t); applyQuality(); }));
      fPerf.add(CONFIG, 'autoQuality').name('Auto downgrade');
    } catch (e) {
      console.warn('Control panel failed to load:', e);
    }
  }

  /* -------------------------------------------------------------- compile -- */

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

  /* ------------------------------------------------------------ observers -- */

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

  /* ----------------------------------------------------------------- loop -- */

  const away = new THREE.Vector3(9999, 9999, 0);

  function loop(){
    if (!canvas.isConnected){ dispose(); return; }
    const dt = Math.min(clock.getDelta(), 0.05);

    const mouseGone     = !hasMouse && Math.abs(u.uMouseWorld.value.x) > 100.0;
    const revealSettled = Math.abs(revealGoal - u.uGlobalReveal.value) < 0.0008;
    const dropsAlive    = dropSlots.some(Boolean);
    const dropsPending  = settings.dropsEnabled && u.uGlobalReveal.value > 0.9;
    // fully hidden by the scroll reveal: the pointer can't change anything
    // on screen, so that counts as idle too
    const hidden        = revealSettled && revealGoal < 0.001;
    const isIdle        = (mouseGone || hidden) && revealSettled && !dropsAlive && !dropsPending;

    if (isIdle){
      if (idleSettled) return;               // nothing moving -> stop drawing
      u.uGlobalReveal.value = revealGoal;
      if (mouseGone) u.uMouseWorld.value.copy(away);
      idleSettled = true;
    } else {
      idleSettled = false;
      samplePerf(dt);
    }

    u.uMouseWorld.value.lerp(hasMouse ? mouseTarget : away, 1 - Math.exp(-6 * dt));
    u.uTime.value += dt;

    const sm = Math.max(settings.revealSmoothing, 0.0001);
    u.uGlobalReveal.value += (revealGoal - u.uGlobalReveal.value) * (1 - Math.exp(-dt / sm));

    updateDrops(u.uTime.value);

    const lensActive =
      settings.lensEnabled &&
      q.lens && lensActiveAllowed &&
      u.uGlobalReveal.value > 0.001 &&
      Math.abs(u.uMouseWorld.value.x) <= 100.0;

    if (lensActive){
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      updateLensUniforms(dt);
      renderBlurChain();

      postQuad.material = compositeMat;
      renderer.render(postScene, postCam);
    } else {
      centerPrev.set(-10, -10);
      velSmooth.set(0, 0);
      renderer.render(scene, camera);       // straight to screen, no post
    }
  }

  loopReady = true;
  updateRunState();
}
})();
