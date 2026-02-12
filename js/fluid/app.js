/**
 * Gaussian Fluids — Main Application
 *
 * Phases 1-2: GPGPU pipeline + Gaussian Spatial Representation.
 * Evaluates velocity field from Gaussians with analytical vorticity
 * and divergence, displayed via colormaps.
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
let currentPreset = 'taylor-green';
let currentQuality = 1;
let vizMode = 1; // default to vorticity
let vizScale = 1.0;

let frameCount = 0, lastFpsTime = 0, fps = 0;

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
    buildField();

    lastFpsTime = performance.now();
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
        // Defer fitting so the UI can update
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
        vizScale = 1.0;
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
        intUniforms: {
            u_N: field.N,
            u_texSize: field.texSize,
        },
    });
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

    viscEl.addEventListener('input', () => {
        viscVal.textContent = (viscEl.value * 0.0001).toFixed(4);
    });

    brushEl.addEventListener('input', () => {
        brushVal.textContent = (brushEl.value * 0.003).toFixed(2);
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

    if (now - lastFpsTime >= 500) {
        fps = Math.round(frameCount / ((now - lastFpsTime) * 0.001));
        frameCount = 0;
        lastFpsTime = now;
    }

    if (!field || !field.texPosScale) return; // still loading

    const q = QUALITY[currentQuality];

    // Evaluate Gaussian field to texture
    evalFieldToTexture(q.evalRes);

    // Display with colormap
    displayPass.execute({
        target: null,
        width: canvas.width,
        height: canvas.height,
        textures: { u_field: fieldTex },
        uniforms: { u_scale: vizScale },
        intUniforms: { u_mode: vizMode },
    });

    statsEl.textContent = `${fps} fps | ${field.N} gaussians | ${q.evalRes}\u00B2 eval | scale ${vizScale.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();
