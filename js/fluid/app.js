/**
 * Gaussian Fluids — Main Application
 *
 * GPGPU pipeline + Gaussian Spatial Representation + Euler advection +
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

    // Real-time mouse force overlay
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
        color = coolwarm(vort / u_scale);
    } else if (u_mode == 2) {
        color = viridis(length(vel) / u_scale);
    } else if (u_mode == 3) {
        color = magma(length(vel) / u_scale);
    } else {
        float mag = length(vel);
        float angle = atan(vel.y, vel.x);
        float hue = angle / 6.2832 + 0.5;
        color = hsl2rgb(hue, 0.8, 0.05 + clamp(mag / u_scale, 0.0, 1.0) * 0.55);
    }

    // Brush cursor ring
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
let field = null;
let currentPreset = 'taylor-green';
let currentQuality = 1;
let vizMode = 1;
let vizScale = 0.5;
let fieldReady = false;

let frameCount = 0, lastFpsTime = 0, fps = 0;
let lastFrameTime = 0;

let mouse = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, vx: 0, vy: 0, down: false, onCanvas: false };
let brushRadius = 0.09;
let viscosity = 0.001;
let vortexSign = 1;
let needsUpload = false;
let originalPositions = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    canvas = document.getElementById('c');
    statsEl = document.getElementById('stats');

    resize();
    window.addEventListener('resize', resize);

    try {
        const ctx = initContext(canvas);
        gl = ctx.gl;
        statsEl.textContent = 'WebGL 2 OK. Compiling shaders...';
    } catch (e) {
        statsEl.textContent = 'Error: ' + e.message;
        console.error(e);
        return;
    }

    try {
        evalPass = new GPUPass(gl, EVAL_FIELD_FRAG);
        displayPass = new GPUPass(gl, DISPLAY_FRAG);
        statsEl.textContent = 'Shaders OK. Building field...';
    } catch (e) {
        statsEl.textContent = 'Shader error: ' + e.message;
        console.error(e);
        return;
    }

    setupMouse();
    setupUI();
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
    fieldReady = false;
    const q = QUALITY[currentQuality];
    const presetFn = PRESETS[currentPreset];

    field = new GaussianField(q.nx, q.ny);
    field.initGrid();
    originalPositions = new Float32Array(field.positions);

    statsEl.textContent = `Building ${q.nx * q.ny} Gaussians...`;

    // Use setTimeout so the status text renders before blocking fit
    setTimeout(() => {
        try {
            if (presetFn !== PRESETS['free']) {
                field.fitToField(presetFn, 40);
            } else {
                // Seed free canvas with a few random vortices so it's not blank
                seedRandomVortices(field, 4);
            }
            field.uploadToGPU(gl);
            createEvalTextures(q.evalRes);
            autoScale(q.evalRes);
            fieldReady = true;
            statsEl.textContent = `Ready — ${field.N} Gaussians`;
        } catch (e) {
            statsEl.textContent = 'Build error: ' + e.message;
            console.error(e);
        }
    }, 20);
}

function seedRandomVortices(f, count) {
    for (let v = 0; v < count; v++) {
        const cx = 0.2 + Math.random() * 0.6;
        const cy = 0.2 + Math.random() * 0.6;
        const sign = (v % 2 === 0) ? 1 : -1;
        const str = 1.5 + Math.random() * 1.5;
        const radius = 0.06 + Math.random() * 0.06;
        const r2 = radius * radius;

        for (let i = 0; i < f.N; i++) {
            const dx = f.positions[i * 2] - cx;
            const dy = f.positions[i * 2 + 1] - cy;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < r2 * 16) {
                const falloff = Math.exp(-dist2 / (2 * r2));
                f.weights[i * 2]     += -dy * str * sign * falloff;
                f.weights[i * 2 + 1] +=  dx * str * sign * falloff;
            }
        }
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
// Advection — Euler integration of Gaussian centers through velocity field
// ---------------------------------------------------------------------------

function advectStep(dt) {
    if (!field || !originalPositions) return;

    const N = field.N;

    // Precompute inverse covariances for active Gaussians
    const invCov = new Float32Array(N * 3);
    const active = new Uint8Array(N);
    let activeCount = 0;

    for (let j = 0; j < N; j++) {
        if (Math.abs(field.weights[j * 2]) < 1e-7 && Math.abs(field.weights[j * 2 + 1]) < 1e-7) continue;

        active[j] = 1;
        activeCount++;

        const theta = field.rotations[j];
        const sx_inv = 1 / Math.exp(field.logScales[j * 2]);
        const sy_inv = 1 / Math.exp(field.logScales[j * 2 + 1]);
        const c = Math.cos(theta), s = Math.sin(theta);
        const r00 = c * sx_inv, r01 = s * sx_inv;
        const r10 = -s * sy_inv, r11 = c * sy_inv;
        invCov[j * 3]     = r00 * r00 + r10 * r10;
        invCov[j * 3 + 1] = r00 * r01 + r10 * r11;
        invCov[j * 3 + 2] = r01 * r01 + r11 * r11;
    }

    if (activeCount === 0) return;

    // Evaluate velocity at each center and move
    for (let i = 0; i < N; i++) {
        const px = field.positions[i * 2];
        const py = field.positions[i * 2 + 1];
        let ux = 0, uy = 0;

        for (let j = 0; j < N; j++) {
            if (!active[j]) continue;
            const dx = px - field.positions[j * 2];
            const dy = py - field.positions[j * 2 + 1];
            const a = invCov[j * 3], b = invCov[j * 3 + 1], d = invCov[j * 3 + 2];
            const exponent = -0.5 * (a * dx * dx + 2 * b * dx * dy + d * dy * dy);
            if (exponent < -6) continue;
            const g = Math.exp(exponent);
            ux += field.weights[j * 2] * g;
            uy += field.weights[j * 2 + 1] * g;
        }

        field.positions[i * 2]     += dt * ux;
        field.positions[i * 2 + 1] += dt * uy;
    }

    // Weak spring toward original grid
    const spring = 1.5;
    for (let i = 0; i < N; i++) {
        field.positions[i * 2]     += spring * dt * (originalPositions[i * 2]     - field.positions[i * 2]);
        field.positions[i * 2 + 1] += spring * dt * (originalPositions[i * 2 + 1] - field.positions[i * 2 + 1]);
    }

    // Clamp to domain
    for (let i = 0; i < N * 2; i++) {
        field.positions[i] = Math.max(0.001, Math.min(0.999, field.positions[i]));
    }

    needsUpload = true;
}

// ---------------------------------------------------------------------------
// Decay + scale tracking
// ---------------------------------------------------------------------------

function applyDecay(dt) {
    if (!field) return;

    const decay = Math.exp(-viscosity * dt * 60);
    let anySignificant = false;

    for (let i = 0; i < field.N * 2; i++) {
        field.weights[i] *= decay;
        if (Math.abs(field.weights[i]) > 1e-6) anySignificant = true;
    }

    if (anySignificant) needsUpload = true;
    adjustScale();
}

function adjustScale() {
    if (!field) return;
    let maxW = 0;
    for (let i = 0; i < field.N * 2; i++) {
        const a = Math.abs(field.weights[i]);
        if (a > maxW) maxW = a;
    }
    const target = Math.max(maxW * 2.0, 0.01);
    if (target > vizScale) {
        vizScale = vizScale * 0.5 + target * 0.5;
    } else {
        vizScale = vizScale * 0.95 + target * 0.05;
    }
}

// ---------------------------------------------------------------------------
// Mouse / Touch interaction
// ---------------------------------------------------------------------------

function setupMouse() {
    function clientToUV(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: clientX / rect.width,
            y: 1.0 - clientY / rect.height,
        };
    }

    canvas.addEventListener('mouseenter', () => { mouse.onCanvas = true; });
    canvas.addEventListener('mouseleave', () => { mouse.onCanvas = false; mouse.down = false; });

    canvas.addEventListener('mousemove', (e) => {
        mouse.onCanvas = true;
        const uv = clientToUV(e.clientX, e.clientY);
        mouse.px = mouse.x;
        mouse.py = mouse.y;
        mouse.x = uv.x;
        mouse.y = uv.y;
        mouse.vx = mouse.x - mouse.px;
        mouse.vy = mouse.y - mouse.py;
        if (mouse.down) applyMouseForce();
    });

    canvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
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

    window.addEventListener('mouseup', () => { mouse.down = false; });

    // Touch
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

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

function applyMouseForce() {
    if (!field || !fieldReady) return;
    const speed = Math.sqrt(mouse.vx * mouse.vx + mouse.vy * mouse.vy);
    if (speed < 0.0005) return;

    const strength = 15.0;
    const r2 = brushRadius * brushRadius;

    for (let i = 0; i < field.N; i++) {
        const dx = field.positions[i * 2] - mouse.x;
        const dy = field.positions[i * 2 + 1] - mouse.y;
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

function injectVortex(cx, cy) {
    if (!field || !fieldReady) return;

    const strength = 3.0 * vortexSign;
    vortexSign *= -1;
    const r2 = brushRadius * brushRadius;

    for (let i = 0; i < field.N; i++) {
        const dx = field.positions[i * 2] - cx;
        const dy = field.positions[i * 2 + 1] - cy;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < r2 * 16) {
            const falloff = Math.exp(-dist2 / (2 * r2));
            field.weights[i * 2]     += -dy * strength * falloff;
            field.weights[i * 2 + 1] +=  dx * strength * falloff;
        }
    }
    needsUpload = true;
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

    presetEl.addEventListener('change', () => { currentPreset = presetEl.value; buildField(); });

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
    vizEl.addEventListener('change', () => { vizMode = modeMap[vizEl.value] ?? 0; });
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function loop(now) {
    requestAnimationFrame(loop);
    frameCount++;

    const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;

    if (now - lastFpsTime >= 500) {
        fps = Math.round(frameCount / ((now - lastFpsTime) * 0.001));
        frameCount = 0;
        lastFpsTime = now;
    }

    if (!field || !fieldReady) return;

    try {
        applyDecay(dt);
        advectStep(dt);

        if (needsUpload) {
            field.uploadToGPU(gl);
            needsUpload = false;
        }

        const q = QUALITY[currentQuality];
        evalFieldToTexture(q.evalRes);

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

        statsEl.textContent = `${fps} fps | ${field.N} gaussians | scale ${vizScale.toFixed(3)}`;
    } catch (e) {
        statsEl.textContent = 'Render error: ' + e.message;
        console.error(e);
    }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();
