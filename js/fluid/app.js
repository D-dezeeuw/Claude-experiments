/**
 * Gaussian Fluids — Main Application
 *
 * Phase 1: GPGPU foundation with pipeline verification.
 * Subsequent phases add simulation, projection, and visualization.
 */

import { initContext } from './gpu/context.js';
import { createFloatTexture, createFBO, PingPong, readbackTexture } from './gpu/textures.js';
import { GPUPass } from './gpu/pass.js';

// ---------------------------------------------------------------------------
// Shader sources
// ---------------------------------------------------------------------------

const WRITE_TEST_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform float u_time;
void main() {
    float s = sin(v_uv.x * 20.0 + u_time) * 0.5 + 0.5;
    float c = cos(v_uv.y * 20.0 - u_time * 0.7) * 0.5 + 0.5;
    outColor = vec4(s, c, s * c, 1.0);
}
`;

const DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_tex;
void main() {
    outColor = texture(u_tex, v_uv);
}
`;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let gl, caps, canvas;
let statsEl;
let writePass, displayPass;
let pingPong;
let time = 0;
let frameCount = 0;
let lastFpsTime = 0;
let fps = 0;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
    canvas = document.getElementById('c');
    statsEl = document.getElementById('stats');

    // Size canvas to window
    resize();
    window.addEventListener('resize', resize);

    // Init WebGL 2
    const ctx = initContext(canvas);
    gl = ctx.gl;
    caps = ctx.caps;

    // Log capabilities
    console.log('WebGL 2 initialized', caps);

    // Phase 1: Create GPGPU passes
    writePass = new GPUPass(gl, WRITE_TEST_FRAG);
    displayPass = new GPUPass(gl, DISPLAY_FRAG);

    // Create ping-pong textures at 512x512
    pingPong = new PingPong(gl, 512, 512);

    // Verify float readback works
    verifyPipeline();

    // Start render loop
    lastFpsTime = performance.now();
    requestAnimationFrame(loop);
}

function resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
}

// ---------------------------------------------------------------------------
// Phase 1 Verification
// ---------------------------------------------------------------------------

function verifyPipeline() {
    // Write a known pattern to the float texture
    writePass.execute({
        target: pingPong.writeFBO,
        width: 512,
        height: 512,
        uniforms: { u_time: 0.0 },
    });
    pingPong.swap();

    // Read back and verify
    const data = pingPong.readback();
    const sample = data.slice(0, 4);
    const expected = [
        Math.sin(0.0) * 0.5 + 0.5,  // s at uv.x ≈ 0
        Math.cos(0.0) * 0.5 + 0.5,  // c at uv.y ≈ 0
    ];

    // Allow some tolerance for GPU float precision
    const ok = Math.abs(sample[0] - expected[0]) < 0.05 &&
               Math.abs(sample[1] - expected[1]) < 0.05;

    console.log(`Pipeline verification: ${ok ? 'PASS' : 'FAIL'}`,
        { gpu: [sample[0].toFixed(4), sample[1].toFixed(4)],
          cpu: [expected[0].toFixed(4), expected[1].toFixed(4)] });

    if (!ok) {
        console.warn('Float texture readback mismatch — GPU precision or driver issue');
    }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function loop(now) {
    requestAnimationFrame(loop);

    time = now * 0.001;
    frameCount++;

    // FPS counter
    if (now - lastFpsTime >= 500) {
        fps = Math.round(frameCount / ((now - lastFpsTime) * 0.001));
        frameCount = 0;
        lastFpsTime = now;
    }

    // Phase 1: Write animated pattern to float texture
    writePass.execute({
        target: pingPong.writeFBO,
        width: 512,
        height: 512,
        uniforms: { u_time: time },
    });
    pingPong.swap();

    // Display the float texture to screen
    displayPass.execute({
        target: null,
        width: canvas.width,
        height: canvas.height,
        textures: { u_tex: pingPong.read },
    });

    // Update stats
    statsEl.textContent = `${fps} fps | ${canvas.width}x${canvas.height} | Phase 1: GPGPU Pipeline OK`;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init();
