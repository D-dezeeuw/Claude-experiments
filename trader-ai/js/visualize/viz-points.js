/**
 * TraderAI — 3D Point Cloud (Stars)
 * Renders 49 stocks as glowing stars with labels and hover tooltips.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SCENE_SIZE } from './viz-scene.js';

let pointCloud = null;
let labelGroup = null;
let starPositions = []; // {index, symbol, company, sector, pos: Vector3, metrics}
let hoveredIndex = -1;
let raycaster = null;
let mouse = new THREE.Vector2(-999, -999);

// ── Color gradient: orange (low) → white (mid) → blue (high) ──
function valueToColor(t) {
  // t: 0-1
  const orange = new THREE.Color(0xf97316);
  const white = new THREE.Color(0xffffff);
  const blue = new THREE.Color(0x3b82f6);
  if (t < 0.5) {
    return orange.clone().lerp(white, t * 2);
  } else {
    return white.clone().lerp(blue, (t - 0.5) * 2);
  }
}

// ── Normalize a value to 0-1 given a metric range ──
function normalize(value, range) {
  if (value == null || isNaN(value)) return 0.5; // midpoint for missing data
  const [min, max] = range;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ── Build the starfield from stock data ──
export function buildStarfield(sceneObj, stocks, selections, metrics) {
  // Clean up previous
  if (pointCloud) sceneObj.scene.remove(pointCloud);
  if (labelGroup) sceneObj.scene.remove(labelGroup);

  const mx = metrics[selections.x];
  const my = metrics[selections.y];
  const mz = metrics[selections.z];
  const mc = metrics[selections.color];
  const ms = metrics[selections.size];

  const count = stocks.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  starPositions = [];

  labelGroup = new THREE.Group();

  for (let i = 0; i < count; i++) {
    const stock = stocks[i];

    // Map to scene coordinates
    const nx = normalize(stock[mx.key], mx.range);
    const ny = normalize(stock[my.key], my.range);
    const nz = normalize(stock[mz.key], mz.range);
    const nc = normalize(stock[mc.key], mc.range);
    const ns = normalize(Math.abs(stock[ms.key] || 0), [0, Math.max(ms.range[1], Math.abs(ms.range[0]))]);

    const x = nx * SCENE_SIZE;
    const y = ny * SCENE_SIZE;
    const z = nz * SCENE_SIZE;

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const color = valueToColor(nc);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = 3 + ns * 12; // size range 3-15

    // Store for raycasting
    starPositions.push({
      index: i,
      symbol: stock.symbol,
      company: stock.company,
      sector: stock.sector,
      pos: new THREE.Vector3(x, y, z),
      stock,
    });

    // CSS2D label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'label-2d';
    labelDiv.textContent = stock.symbol;
    labelDiv.id = 'lbl-' + stock.symbol;
    const label = new CSS2DObject(labelDiv);
    label.position.set(x, y + 2.5, z);
    labelGroup.add(label);
  }

  // Geometry
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  // Custom shader material for glowing stars
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPixelRatio * (200.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        // Soft glow: bright center, fading edge
        float glow = 1.0 - smoothstep(0.0, 0.5, d);
        float core = 1.0 - smoothstep(0.0, 0.15, d);
        vec3 col = mix(vColor, vec3(1.0), core * 0.7);
        float alpha = glow * 0.9;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  pointCloud = new THREE.Points(geometry, material);
  sceneObj.scene.add(pointCloud);
  sceneObj.scene.add(labelGroup);

  // Update axis labels
  updateAxisLabels(selections, metrics);
}

// ── Update starfield when axes change ──
export function updateStarfield(stocks, selections, metrics) {
  if (!pointCloud || !stocks.length) return;

  const mx = metrics[selections.x];
  const my = metrics[selections.y];
  const mz = metrics[selections.z];
  const mc = metrics[selections.color];
  const ms = metrics[selections.size];

  const posAttr = pointCloud.geometry.getAttribute('position');
  const colAttr = pointCloud.geometry.getAttribute('color');
  const sizeAttr = pointCloud.geometry.getAttribute('size');

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];

    const nx = normalize(stock[mx.key], mx.range);
    const ny = normalize(stock[my.key], my.range);
    const nz = normalize(stock[mz.key], mz.range);
    const nc = normalize(stock[mc.key], mc.range);
    const ns = normalize(Math.abs(stock[ms.key] || 0), [0, Math.max(ms.range[1], Math.abs(ms.range[0]))]);

    const x = nx * SCENE_SIZE;
    const y = ny * SCENE_SIZE;
    const z = nz * SCENE_SIZE;

    // Animate position (lerp towards target)
    starPositions[i].targetPos = new THREE.Vector3(x, y, z);

    const color = valueToColor(nc);
    colAttr.setXYZ(i, color.r, color.g, color.b);
    sizeAttr.setX(i, 3 + ns * 12);
  }

  colAttr.needsUpdate = true;
  sizeAttr.needsUpdate = true;

  // Animate positions smoothly
  animatePositions(posAttr);
  updateAxisLabels(selections, metrics);
}

function animatePositions(posAttr) {
  let frame = 0;
  const totalFrames = 30;

  function step() {
    frame++;
    const t = Math.min(1, frame / totalFrames);
    const ease = t * (2 - t); // ease-out

    for (let i = 0; i < starPositions.length; i++) {
      const sp = starPositions[i];
      if (!sp.targetPos) continue;
      sp.pos.lerp(sp.targetPos, ease);
      posAttr.setXYZ(i, sp.pos.x, sp.pos.y, sp.pos.z);

      // Update label position
      const lbl = document.getElementById('lbl-' + sp.symbol);
      if (lbl && lbl.parentElement?.__css2dObject) {
        lbl.parentElement.__css2dObject.position.copy(sp.pos).y += 2.5;
      }
    }
    posAttr.needsUpdate = true;

    if (frame < totalFrames) requestAnimationFrame(step);
    else {
      // Snap to final
      for (const sp of starPositions) {
        if (sp.targetPos) sp.pos.copy(sp.targetPos);
      }
    }
  }
  step();
}

// ── Axis Labels ──
function updateAxisLabels(selections, metrics) {
  const xLabel = document.querySelector('[data-axis-label="x"]');
  const yLabel = document.querySelector('[data-axis-label="y"]');
  const zLabel = document.querySelector('[data-axis-label="z"]');
  // Labels are in the dropdowns themselves, no need for separate 3D labels
}

// ── Raycaster + Hover ──
export function setupRaycaster(sceneObj, stocks, metrics) {
  raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 3;

  const container = sceneObj.renderer.domElement;
  const tooltip = document.getElementById('tooltip');

  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    // Raycast
    raycaster.setFromCamera(mouse, sceneObj.camera);
    const intersects = pointCloud ? raycaster.intersectObject(pointCloud) : [];

    // Unhover previous
    if (hoveredIndex >= 0 && starPositions[hoveredIndex]) {
      const prevLbl = document.getElementById('lbl-' + starPositions[hoveredIndex].symbol);
      if (prevLbl) prevLbl.className = 'label-2d';
    }

    if (intersects.length > 0) {
      const idx = intersects[0].index;
      hoveredIndex = idx;
      const sp = starPositions[idx];

      // Highlight label
      const lbl = document.getElementById('lbl-' + sp.symbol);
      if (lbl) lbl.className = 'label-2d hovered';

      // Show tooltip
      const sel = {
        x: document.getElementById('axis-x').value,
        y: document.getElementById('axis-y').value,
        z: document.getElementById('axis-z').value,
        color: document.getElementById('axis-color').value,
        size: document.getElementById('axis-size').value,
      };

      tooltip.innerHTML = `
        <div class="tt-symbol">${sp.symbol}</div>
        <div class="tt-company">${sp.company} &middot; ${sp.sector}</div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.x].label}</span><span class="tt-value">${fmt(sp.stock[metrics[sel.x].key])}</span></div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.y].label}</span><span class="tt-value">${fmt(sp.stock[metrics[sel.y].key])}</span></div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.z].label}</span><span class="tt-value">${fmt(sp.stock[metrics[sel.z].key])}</span></div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.color].label}</span><span class="tt-value">${fmt(sp.stock[metrics[sel.color].key])}</span></div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.size].label}</span><span class="tt-value">${fmt(sp.stock[metrics[sel.size].key])}</span></div>
      `;
      tooltip.style.display = 'block';

      // Position tooltip near cursor
      const px = e.clientX - container.getBoundingClientRect().left;
      const py = e.clientY - container.getBoundingClientRect().top;
      tooltip.style.left = (px + 15) + 'px';
      tooltip.style.top = (py - 10) + 'px';

    } else {
      hoveredIndex = -1;
      tooltip.style.display = 'none';
    }
  });

  container.addEventListener('mouseleave', () => {
    hoveredIndex = -1;
    tooltip.style.display = 'none';
  });
}

function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  return typeof v === 'number' ? v.toFixed(2) : String(v);
}
