/**
 * Gaussian Fluids — Main Application
 *
 * Phases 1-2 + Interactivity: GPGPU pipeline, Gaussian Spatial Representation,
 * mouse/touch interaction (drag to stir, tap to spawn vortices, weight decay).
 */

import { initContext } from './gpu/context.js';
import { createFloatTexture, createFBO } from './gpu/textures.js';
import { GPUPass } from './gpu/pass.js';
import { GAUSSIAN_EVAL, COLORMAPS } from './gpu/glsl-lib.js';
import { GaussianField } from './simulation/gaussians.js';
import { PRESETS } from './simulation/initial-conditions.js';

// ---------------------------------------------------------------------------
// Shader sources
// ---------------------------------------------------------------------------

const EVAL_FIELD_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outField;

uniform sampler2D t_posScale;
uniform sampler2D t_rotWeight;
uniform int u_N;
uniform int u_texSize;

// Mouse force overlay (instant GPU feedback)
uniform vec2 u_mousePos;
uniform vec2 u_mouseVel;
uniform float u_mouseActive;
uniform float u_brushRadius;

${GAUSSIAN_EVAL}

void main() {
    vec2 x = v_uv;
    vec2 vel = vec2(0.0);
    float vort = 0.0;
    float divg = 0.0;

    for (int i = 0; i < 4096; i++) {
        if (i >= u_N) break;

        vec4 ps = texelFetch(t_posScale, gIdx(i, u_texSize), 0);
        vec4 rw = texelFetch(t_rotWeight, gIdx(i, u_texSize), 0);

        vec2 mu = ps.xy;
        mat2 sigInv = getInvCovariance(rw.x, ps.zw);
        vec2 d = x - mu;
        float g = evalGaussian(x, mu, sigInv);
        vec2 w = rw.yz;

        vel += w * g;

        vec2 gG = gradGaussian(d, sigInv, g);
        vort += w.y * gG.x - w.x * gG.y;
        divg += w.x * gG.x + w.y * gG.y;
    }

    // Add real-time mouse force (instant visual feedback while dragging)
    if (u_mouseActive > 0.5) {
        vec2 d = x - u_mousePos;
        float r2 = u_brushRadius * u_brushRadius;
        float g = exp(-dot(d, d) / (2.0 * r2));
        vel += u_mouseVel * g * 8.0;
    }

    outField = vec4(vel, vort, divg);
}
`;

const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_field;
uniform int u_mode;
uniform float u_scale;

// Brush cursor
uniform vec2 u_cursorPos;
uniform float u_cursorRadius;
uniform float u_cursorActive;

${COLORMAPS}

vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}

void main() {
    vec4 f = texture(u_field, v_uv);
    vec2 vel = f.xy;
    float vort = f.z;

    vec3 color;
    if (u_mode == 1) {
        // Vorticity: diverging coolwarm
        color = coolwarm(vort / u_scale);
    } else if (u_mode == 2) {
        // Velocity magnitude: viridis
        color = viridis(length(vel) / u_scale);
    } else if (u_mode == 3) {
        // Debug: magma intensity
        color = magma(length(vel) / u_scale);
    } else {
        // Dye: hue from direction, brightness from magnitude
        float mag = length(vel);
        float angle = atan(vel.y, vel.x);
        float hue = angle / 6.2832 + 0.5;
        color = hsl2rgb(hue, 0.8, 0.05 + clamp(mag / u_scale, 0.0, 1.0) * 0.55);
    }

    // Draw brush cursor ring
    float dist = length(v_uv - u_cursorPos);
    float ring = smoothstep(u_cursorRadius - 0.003, u_cursorRadius, dist)
               * (1.0 - smoothstep(u_cursorRadius, u_cursorRadius + 0.003, dist));
    color = mix(color, vec3(1.0), ring * 0.5 * u_cursorActive);

    outColor = vec4(color, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Quality presets
// ---------------------------------------------------------------------------

const QUALITY = [
    { label: 'Low',    nx: 16, ny: 16, evalRes: 128 },
    { label: 'Medium', nx: 24, ny: 24, evalRes: 256 },
    { label: 'High',   nx: 32, ny: 32, evalRes: 384 },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let gl, canvas, statsEl;
let evalPass, displayPass;
let fieldTex, fieldFBO;
let field; // GaussianField
let currentPreset = 'free';
let currentQuality = 1;
let vizMode = 1; // default to vorticity
let vizScale = 1.0;

let frameCount = 0, lastFpsTime = 0, fps = 0;
let lastFrameTime = 0;

// Mouse / touch interaction state
let mouse = {
    x: 0.5, y: 0.5,   // current position (UV coords, [0,1])
    px: 0.5, py: 0.5,  // previous position
    vx: 0, vy: 0,      // velocity (delta per frame)
    down: false,        // button/touch pressed
    onCanvas: false,    // cursor is over the canvas
};
let brushRadius = 0.08;
let viscosity = 0.001;
let vortexSign = 1; // alternates +1/-1 for clockwise/counter-clockwise taps
let needsUpload = false; // flag to batch GPU uploads

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    canvas = document.getElementById('c');
    statsEl = document.getElementById('stats');

    resize();
    window.addEventListener('resize', resize);

    const ctx = initContext(canvas);
    gl = ctx.gl;
    console.log('WebGL 2 ready', ctx.caps);

    evalPass = new GPUPass(gl, EVAL_FIELD_FRAG);
    displayPass = new GPUPass(gl, DISPLAY_FRAG);

    setupUI();
    setupMouse();
    buildField();

    lastFpsTime = performance.now();
    lastFrameTime = performance.now();
    requestAnimationFrame(loop);
}

function resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
}

// ---------------------------------------------------------------------------
// Field construction
// ---------------------------------------------------------------------------

function buildField() {
    const q = QUALITY[currentQuality];
    const presetFn = PRESETS[currentPreset];

    field = new GaussianField(q.nx, q.ny);
    field.initGrid();

    if (presetFn !== PRESETS['free']) {
        statsEl.textContent = `Fitting ${q.nx * q.ny} Gaussians...`;
        setTimeout(() => {
            field.fitToField(presetFn, 40);
            field.uploadToGPU(gl);
            createEvalTextures(q.evalRes);
            autoScale(q.evalRes);
            console.log(`Built: ${field.N} Gaussians, ${q.evalRes}x${q.evalRes} eval`);
        }, 10);
    } else {
        field.uploadToGPU(gl);
        createEvalTextures(q.evalRes);
        vizScale = 0.01;
    }
}

function createEvalTextures(res) {
    if (fieldTex) gl.deleteTexture(fieldTex);
    if (fieldFBO) gl.deleteFramebuffer(fieldFBO);
    fieldTex = createFloatTexture(gl, res, res);
    fieldFBO = createFBO(gl, fieldTex);
}

function autoScale(res) {
    evalFieldToTexture(res);

    const buf = new Float32Array(res * res * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFBO);
    gl.readPixels(0, 0, res, res, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let maxVel = 0, maxVort = 0;
    for (let i = 0; i < buf.length; i += 4) {
        const vm = Math.sqrt(buf[i] * buf[i] + buf[i + 1] * buf[i + 1]);
        const va = Math.abs(buf[i + 2]);
        if (vm > maxVel) maxVel = vm;
        if (va > maxVort) maxVort = va;
    }
    vizScale = Math.max(maxVel, maxVort, 0.01);
}

function evalFieldToTexture(res) {
    evalPass.execute({
        target: fieldFBO,
        width: res,
        height: res,
        textures: {
            t_posScale: field.texPosScale,
            t_rotWeight: field.texRotWeight,
        },
        uniforms: {
            u_mousePos: [mouse.x, mouse.y],
            u_mouseVel: [mouse.vx, mouse.vy],
            u_mouseActive: mouse.down ? 1.0 : 0.0,
            u_brushRadius: brushRadius,
        },
        intUniforms: {
            u_N: field.N,
            u_texSize: field.texSize,
        },
    });
}

// ---------------------------------------------------------------------------
// Mouse / Touch interaction
// ---------------------------------------------------------------------------

function setupMouse() {
    // Convert client coordinates to UV [0,1] with Y flipped
    function clientToUV(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: clientX / rect.width,
            y: 1.0 - clientY / rect.height,
        };
    }

    // --- Mouse events ---
    canvas.addEventListener('mouseenter', () => { mouse.onCanvas = true; });
    canvas.addEventListener('mouseleave', () => { mouse.onCanvas = false; });

    canvas.addEventListener('mousemove', (e) => {
        const uv = clientToUV(e.clientX, e.clientY);
        mouse.px = mouse.x;
        mouse.py = mouse.y;
        mouse.x = uv.x;
        mouse.y = uv.y;
        mouse.vx = mouse.x - mouse.px;
        mouse.vy = mouse.y - mouse.py;

        if (mouse.down) {
            applyMouseForce();
        }
    });

    canvas.addEventListener('mousedown', (e) => {
        if (e.target !== canvas) return;
        const uv = clientToUV(e.clientX, e.clientY);
        mouse.x = uv.x;
        mouse.y = uv.y;
        mouse.px = uv.x;
        mouse.py = uv.y;
        mouse.vx = 0;
        mouse.vy = 0;
        mouse.down = true;
        injectVortex(mouse.x, mouse.y);
    });

    canvas.addEventListener('mouseup', () => { mouse.down = false; });

    // --- Touch events ---
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.touches[0];
        const uv = clientToUV(t.clientX, t.clientY);
        mouse.x = uv.x;
        mouse.y = uv.y;
        mouse.px = uv.x;
        mouse.py = uv.y;
        mouse.vx = 0;
        mouse.vy = 0;
        mouse.down = true;
        mouse.onCanvas = true;
        injectVortex(mouse.x, mouse.y);
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const t = e.touches[0];
        const uv = clientToUV(t.clientX, t.clientY);
        mouse.px = mouse.x;
        mouse.py = mouse.y;
        mouse.x = uv.x;
        mouse.y = uv.y;
        mouse.vx = mouse.x - mouse.px;
        mouse.vy = mouse.y - mouse.py;
        applyMouseForce();
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        mouse.down = false;
        mouse.onCanvas = false;
    });

    // Prevent context menu on long press
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

/**
 * Drag interaction: push nearby Gaussian weights in the direction of mouse movement.
 */
function applyMouseForce() {
    if (!field) return;

    const speed = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);
    if (speed < 0.0005) return;

    const strength = 15.0;
    const r2 = brushRadius * brushRadius;

    for (let i = 0; i < field.N; i++) {
        const px = field.positions[i * 2];
        const py = field.positions[i * 2 + 1];
        const dx = px - mouse.x;
        const dy = py - mouse.y;
        const dist2 = dx * dx + dy * dy;

        if (dist2 < r2 * 16) {
            const falloff = Math.exp(-dist2 / (2 * r2));
            field.weights[i * 2]     += mouse.vx * strength * falloff;
            field.weights[i * 2 + 1] += mouse.vy * strength * falloff;
        }
    }

    needsUpload = true;
    adjustScale();
}

/**
 * Tap/click interaction: spawn a vortex (rotational flow) at the given position.
 * Alternates clockwise / counter-clockwise.
 */
function injectVortex(cx, cy) {
    if (!field) return;

    const strength = 3.0 * vortexSign;
    vortexSign *= -1; // alternate direction
    const r2 = brushRadius * brushRadius;

    for (let i = 0; i < field.N; i++) {
        const px = field.positions[i * 2];
        const py = field.positions[i * 2 + 1];
        const dx = px - cx;
        const dy = py - cy;
        const dist2 = dx * dx + dy * dy;

        if (dist2 < r2 * 16) {
            const falloff = Math.exp(-dist2 / (2 * r2));
            // Rotational: perpendicular to radial direction
            field.weights[i * 2]     += -dy * strength * falloff;
            field.weights[i * 2 + 1] +=  dx * strength * falloff;
        }
    }

    needsUpload = true;
    adjustScale();
}

/**
 * Smoothly track vizScale to match actual field magnitude (both up and down).
 */
function adjustScale() {
    let maxW = 0;
    for (let i = 0; i < field.N * 2; i++) {
        const a = Math.abs(field.weights[i]);
        if (a > maxW) maxW = a;
    }
    const target = Math.max(maxW * 2.0, 0.01);
    // Fast scale-up, gentler scale-down
    if (target > vizScale) {
        vizScale = vizScale * 0.5 + target * 0.5;
    } else {
        vizScale = vizScale * 0.95 + target * 0.05;
    }
}

/**
 * Apply viscous decay: exponential damping of all weights each frame.
 */
function applyDecay(dt) {
    if (!field) return;

    const decay = Math.exp(-viscosity * dt * 60);
    let anySignificant = false;

    for (let i = 0; i < field.N * 2; i++) {
        field.weights[i] *= decay;
        if (Math.abs(field.weights[i]) > 1e-6) anySignificant = true;
    }

    if (anySignificant) {
        needsUpload = true;
    }
    // Keep vizScale tracking actual field magnitude
    adjustScale();
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function setupUI() {
    const presetEl = document.getElementById('preset');
    const qualEl   = document.getElementById('quality');
    const viscEl   = document.getElementById('viscosity');
    const brushEl  = document.getElementById('brushSize');
    const vizEl    = document.getElementById('vizMode');
    const qualVal  = document.getElementById('qualVal');
    const viscVal  = document.getElementById('viscVal');
    const brushVal = document.getElementById('brushVal');

    presetEl.value = currentPreset;
    vizEl.value = 'vorticity';

    presetEl.addEventListener('change', () => {
        currentPreset = presetEl.value;
        buildField();
    });

    qualEl.value = currentQuality;
    qualVal.textContent = QUALITY[currentQuality].label;
    qualEl.addEventListener('input', () => {
        currentQuality = parseInt(qualEl.value);
        qualVal.textContent = QUALITY[currentQuality].label;
        buildField();
    });

    viscosity = viscEl.value * 0.0001;
    viscEl.addEventListener('input', () => {
        viscosity = viscEl.value * 0.0001;
        viscVal.textContent = viscosity.toFixed(4);
    });

    brushRadius = brushEl.value * 0.003;
    brushEl.addEventListener('input', () => {
        brushRadius = brushEl.value * 0.003;
        brushVal.textContent = brushRadius.toFixed(2);
    });

    const modeMap = { 'dye': 0, 'vorticity': 1, 'velocity': 2, 'debug': 3 };
    vizEl.addEventListener('change', () => {
        vizMode = modeMap[vizEl.value] ?? 0;
    });
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function loop(now) {
    requestAnimationFrame(loop);
    frameCount++;

    const dt = Math.min((now - lastFrameTime) / 1000, 0.05); // cap at 50ms
    lastFrameTime = now;

    if (now - lastFpsTime >= 500) {
        fps = Math.round(frameCount / ((now - lastFpsTime) * 0.001));
        frameCount = 0;
        lastFpsTime = now;
    }

    if (!field || !field.texPosScale) return; // still loading

    // Apply viscous decay
    applyDecay(dt);

    // Upload modified weights if needed
    if (needsUpload) {
        field.uploadToGPU(gl);
        needsUpload = false;
    }

    const q = QUALITY[currentQuality];

    // Evaluate Gaussian field to texture
    evalFieldToTexture(q.evalRes);

    // Display with colormap + cursor
    displayPass.execute({
        target: null,
        width: canvas.width,
        height: canvas.height,
        textures: { u_field: fieldTex },
        uniforms: {
            u_scale: vizScale,
            u_cursorPos: [mouse.x, mouse.y],
            u_cursorRadius: brushRadius,
            u_cursorActive: mouse.onCanvas ? 1.0 : 0.0,
        },
        intUniforms: { u_mode: vizMode },
    });

    statsEl.textContent = `${fps} fps | ${field.N} gaussians | ${q.evalRes}\u00B2 eval | brush ${brushRadius.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();
