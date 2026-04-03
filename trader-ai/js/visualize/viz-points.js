/**
 * TraderAI — 3D Point Cloud (Stars)
 * Renders stocks as glowing stars with labels and hover tooltips.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SCENE_SIZE, flyTo } from './viz-scene.js';

let pointCloud = null;
let labelGroup = null;
let starData = []; // {index, symbol, company, sector, pos, targetPos, stock, labelObj}
let hoveredIndex = -1;
let raycaster = null;
let mouse = new THREE.Vector2(-999, -999);
let animId = null;

// ── Color gradient: orange (low) → white (mid) → blue (high) ──
function valueToColor(t) {
  const orange = new THREE.Color(0xf97316);
  const white = new THREE.Color(0xffffff);
  const blue = new THREE.Color(0x3b82f6);
  if (t < 0.5) return orange.clone().lerp(white, t * 2);
  return white.clone().lerp(blue, (t - 0.5) * 2);
}

function normalize(value, range) {
  if (value == null || isNaN(value)) return 0.5;
  const [min, max] = range;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function computePosition(stock, selections, metrics) {
  const mx = metrics[selections.x];
  const my = metrics[selections.y];
  const mz = metrics[selections.z];
  return new THREE.Vector3(
    normalize(stock[mx.key], mx.range) * SCENE_SIZE,
    normalize(stock[my.key], my.range) * SCENE_SIZE,
    normalize(stock[mz.key], mz.range) * SCENE_SIZE,
  );
}

// ── Build the starfield from stock data ──
export function buildStarfield(sceneObj, stocks, selections, metrics) {
  // Clean up previous
  if (pointCloud) sceneObj.scene.remove(pointCloud);
  if (labelGroup) sceneObj.scene.remove(labelGroup);
  if (animId) cancelAnimationFrame(animId);

  const mc = metrics[selections.color];
  const ms = metrics[selections.size];
  const count = stocks.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  starData = [];
  labelGroup = new THREE.Group();

  for (let i = 0; i < count; i++) {
    const stock = stocks[i];
    const pos = computePosition(stock, selections, metrics);
    const nc = normalize(stock[mc.key], mc.range);
    const ns = normalize(Math.abs(stock[ms.key] || 0), [0, Math.max(ms.range[1], Math.abs(ms.range[0]))]);

    positions[i * 3] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;

    const color = valueToColor(nc);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    sizes[i] = 3 + ns * 12;

    // CSS2D label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'label-2d';
    labelDiv.textContent = stock.symbol;
    const labelObj = new CSS2DObject(labelDiv);
    labelObj.position.copy(pos).y += 2.5;
    labelGroup.add(labelObj);

    starData.push({
      index: i, symbol: stock.symbol, company: stock.company,
      sector: stock.sector, pos: pos.clone(), stock, labelObj, labelDiv,
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

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
        float glow = 1.0 - smoothstep(0.0, 0.5, d);
        float core = 1.0 - smoothstep(0.0, 0.15, d);
        vec3 col = mix(vColor, vec3(1.0), core * 0.7);
        gl_FragColor = vec4(col, glow * 0.9);
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
}

// ── Update starfield when axes change ──
export function updateStarfield(stocks, selections, metrics) {
  if (!pointCloud || !stocks.length || !starData.length) return;
  if (animId) cancelAnimationFrame(animId);

  const mc = metrics[selections.color];
  const ms = metrics[selections.size];
  const colAttr = pointCloud.geometry.getAttribute('color');
  const sizeAttr = pointCloud.geometry.getAttribute('size');

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    const target = computePosition(stock, selections, metrics);
    starData[i].targetPos = target;

    const nc = normalize(stock[mc.key], mc.range);
    const ns = normalize(Math.abs(stock[ms.key] || 0), [0, Math.max(ms.range[1], Math.abs(ms.range[0]))]);
    const color = valueToColor(nc);
    colAttr.setXYZ(i, color.r, color.g, color.b);
    sizeAttr.setX(i, 3 + ns * 12);
  }

  colAttr.needsUpdate = true;
  sizeAttr.needsUpdate = true;
  animateToTargets();
}

function animateToTargets() {
  const posAttr = pointCloud.geometry.getAttribute('position');
  let frame = 0;
  const total = 40;

  function step() {
    frame++;
    const t = Math.min(1, frame / total);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out

    for (let i = 0; i < starData.length; i++) {
      const sd = starData[i];
      if (!sd.targetPos) continue;

      // Lerp position
      sd.pos.lerp(sd.targetPos, 0.08 + ease * 0.15);
      posAttr.setXYZ(i, sd.pos.x, sd.pos.y, sd.pos.z);

      // Move label with the star
      sd.labelObj.position.set(sd.pos.x, sd.pos.y + 2.5, sd.pos.z);
    }
    posAttr.needsUpdate = true;

    if (frame < total) {
      animId = requestAnimationFrame(step);
    } else {
      // Snap final
      for (const sd of starData) {
        if (sd.targetPos) {
          sd.pos.copy(sd.targetPos);
          sd.labelObj.position.set(sd.pos.x, sd.pos.y + 2.5, sd.pos.z);
        }
      }
      posAttr.needsUpdate = true;
    }
  }
  step();
}

// ── Focus camera on a specific stock ──
export function focusOnStock(sceneObj, symbol) {
  const sd = starData.find(s => s.symbol === symbol);
  if (!sd) return;

  // Highlight the label
  for (const s of starData) s.labelDiv.className = 'label-2d';
  sd.labelDiv.className = 'label-2d hovered';

  // Fly camera to the stock
  flyTo(sceneObj, sd.pos);
}

// ── Raycaster + Hover ──
export function setupRaycaster(sceneObj, stocks, metrics) {
  raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 3;

  const canvas = sceneObj.renderer.domElement;
  const tooltip = document.getElementById('tooltip');

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, sceneObj.camera);
    const intersects = pointCloud ? raycaster.intersectObject(pointCloud) : [];

    // Unhover previous
    if (hoveredIndex >= 0 && starData[hoveredIndex]) {
      starData[hoveredIndex].labelDiv.className = 'label-2d';
    }

    if (intersects.length > 0) {
      const idx = intersects[0].index;
      hoveredIndex = idx;
      const sd = starData[idx];
      sd.labelDiv.className = 'label-2d hovered';

      const sel = {
        x: document.getElementById('axis-x').value,
        y: document.getElementById('axis-y').value,
        z: document.getElementById('axis-z').value,
        color: document.getElementById('axis-color').value,
        size: document.getElementById('axis-size').value,
      };

      tooltip.innerHTML = `
        <div class="tt-symbol">${sd.symbol}</div>
        <div class="tt-company">${sd.company} &middot; ${sd.sector}</div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.x].label}</span><span class="tt-value">${fmt(sd.stock[metrics[sel.x].key])}</span></div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.y].label}</span><span class="tt-value">${fmt(sd.stock[metrics[sel.y].key])}</span></div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.z].label}</span><span class="tt-value">${fmt(sd.stock[metrics[sel.z].key])}</span></div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.color].label}</span><span class="tt-value">${fmt(sd.stock[metrics[sel.color].key])}</span></div>
        <div class="tt-row"><span class="tt-label">${metrics[sel.size].label}</span><span class="tt-value">${fmt(sd.stock[metrics[sel.size].key])}</span></div>
      `;
      tooltip.style.display = 'block';
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      tooltip.style.left = (px + 15) + 'px';
      tooltip.style.top = (py - 10) + 'px';
    } else {
      hoveredIndex = -1;
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredIndex = -1;
    tooltip.style.display = 'none';
  });
}

function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  return typeof v === 'number' ? v.toFixed(2) : String(v);
}
