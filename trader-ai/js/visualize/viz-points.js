/**
 * TraderAI — 3D Point Cloud (Stars)
 * Renders stocks as glowing stars with labels, hover tooltips, and cluster spread.
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SCENE_SIZE, flyTo } from './viz-scene.js';

let pointCloud = null;
let labelGroup = null;
let clusterLines = null;
let starData = []; // {index, symbol, company, sector, pos, targetPos, basePos, stock, labelObj, labelDiv, _hasData}
let hoveredIndex = -1;
let activeCluster = null;
let raycaster = null;
let mouse = new THREE.Vector2(-999, -999);
let animId = null;

const CLUSTER_THRESHOLD = 3; // scene units — points closer than this are clustered
const SPREAD_RADIUS = 8;     // how far clustered points spread on hover

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

// ── Detect clusters: groups of points that overlap ──
function detectClusters() {
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < starData.length; i++) {
    if (assigned.has(i)) continue;
    const group = [i];
    assigned.add(i);

    for (let j = i + 1; j < starData.length; j++) {
      if (assigned.has(j)) continue;
      if (starData[i].basePos.distanceTo(starData[j].basePos) < CLUSTER_THRESHOLD) {
        group.push(j);
        assigned.add(j);
      }
    }

    if (group.length > 1) {
      clusters.push(group);
    }
  }
  return clusters;
}

// ── Build the starfield from stock data ──
export function buildStarfield(sceneObj, stocks, selections, metrics) {
  if (pointCloud) sceneObj.scene.remove(pointCloud);
  if (labelGroup) sceneObj.scene.remove(labelGroup);
  if (clusterLines) sceneObj.scene.remove(clusterLines);
  if (animId) cancelAnimationFrame(animId);

  const mc = metrics[selections.color];
  const ms = metrics[selections.size];
  const count = stocks.length;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  starData = [];
  labelGroup = new THREE.Group();
  clusterLines = new THREE.Group();

  for (let i = 0; i < count; i++) {
    const stock = stocks[i];
    const pos = computePosition(stock, selections, metrics);
    const nc = normalize(stock[mc.key], mc.range);
    const ns = normalize(Math.abs(stock[ms.key] || 0), [0, Math.max(ms.range[1], Math.abs(ms.range[0]))]);

    positions[i * 3] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;

    // Dim stars without data
    const hasData = stock._hasData !== false;
    const color = hasData ? valueToColor(nc) : new THREE.Color(0x444455);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    sizes[i] = hasData ? (3 + ns * 12) : 2;

    // CSS2D label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'label-2d' + (hasData ? '' : ' no-data');
    labelDiv.textContent = stock.symbol;
    const labelObj = new CSS2DObject(labelDiv);
    labelObj.position.copy(pos).y += 2.5;
    labelGroup.add(labelObj);

    starData.push({
      index: i, symbol: stock.symbol, company: stock.company,
      sector: stock.sector, pos: pos.clone(), basePos: pos.clone(),
      stock, labelObj, labelDiv, _hasData: hasData,
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
  sceneObj.scene.add(clusterLines);
}

// ── Update starfield when axes change ──
export function updateStarfield(stocks, selections, metrics) {
  if (!pointCloud || !stocks.length || !starData.length) return;
  if (animId) cancelAnimationFrame(animId);
  collapseCluster(); // reset any active cluster

  const mc = metrics[selections.color];
  const ms = metrics[selections.size];
  const colAttr = pointCloud.geometry.getAttribute('color');
  const sizeAttr = pointCloud.geometry.getAttribute('size');

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    const target = computePosition(stock, selections, metrics);
    starData[i].targetPos = target;
    starData[i].basePos = target.clone();

    const hasData = stock._hasData !== false;
    const nc = normalize(stock[mc.key], mc.range);
    const ns = normalize(Math.abs(stock[ms.key] || 0), [0, Math.max(ms.range[1], Math.abs(ms.range[0]))]);
    const color = hasData ? valueToColor(nc) : new THREE.Color(0x444455);
    colAttr.setXYZ(i, color.r, color.g, color.b);
    sizeAttr.setX(i, hasData ? (3 + ns * 12) : 2);
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
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    for (let i = 0; i < starData.length; i++) {
      const sd = starData[i];
      if (!sd.targetPos) continue;
      sd.pos.lerp(sd.targetPos, 0.08 + ease * 0.15);
      posAttr.setXYZ(i, sd.pos.x, sd.pos.y, sd.pos.z);
      sd.labelObj.position.set(sd.pos.x, sd.pos.y + 2.5, sd.pos.z);
    }
    posAttr.needsUpdate = true;

    if (frame < total) {
      animId = requestAnimationFrame(step);
    } else {
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

// ── Cluster spread: when hovering a cluster, spread points outward with lines ──
function spreadCluster(clusterIndices, centerPos) {
  collapseCluster(); // collapse any previous
  activeCluster = clusterIndices;

  const posAttr = pointCloud.geometry.getAttribute('position');
  const count = clusterIndices.length;

  // Clear old lines
  while (clusterLines.children.length) clusterLines.remove(clusterLines.children[0]);

  // Arrange in a circle around the center
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const offset = new THREE.Vector3(
      Math.cos(angle) * SPREAD_RADIUS,
      Math.sin(angle) * SPREAD_RADIUS * 0.6,
      Math.sin(angle + Math.PI / 4) * SPREAD_RADIUS * 0.4,
    );
    const idx = clusterIndices[i];
    const sd = starData[idx];
    const spreadPos = centerPos.clone().add(offset);

    sd.targetPos = spreadPos;

    // Draw line from spread position to origin
    const lineGeo = new THREE.BufferGeometry().setFromPoints([centerPos, spreadPos]);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.3 });
    clusterLines.add(new THREE.Line(lineGeo, lineMat));
  }

  // Animate spread
  let frame = 0;
  function step() {
    frame++;
    const t = Math.min(1, frame / 20);
    const ease = t * (2 - t);

    for (const idx of clusterIndices) {
      const sd = starData[idx];
      if (!sd.targetPos) continue;
      sd.pos.lerp(sd.targetPos, ease * 0.2);
      posAttr.setXYZ(idx, sd.pos.x, sd.pos.y, sd.pos.z);
      sd.labelObj.position.set(sd.pos.x, sd.pos.y + 2.5, sd.pos.z);
    }
    posAttr.needsUpdate = true;
    if (frame < 20) requestAnimationFrame(step);
  }
  step();
}

function collapseCluster() {
  if (!activeCluster || !pointCloud) return;
  const posAttr = pointCloud.geometry.getAttribute('position');

  for (const idx of activeCluster) {
    const sd = starData[idx];
    sd.pos.copy(sd.basePos);
    sd.targetPos = null;
    posAttr.setXYZ(idx, sd.pos.x, sd.pos.y, sd.pos.z);
    sd.labelObj.position.set(sd.pos.x, sd.pos.y + 2.5, sd.pos.z);
  }
  posAttr.needsUpdate = true;

  while (clusterLines.children.length) clusterLines.remove(clusterLines.children[0]);
  activeCluster = null;
}

// ── Focus camera on a specific stock ──
export function focusOnStock(sceneObj, symbol) {
  const sd = starData.find(s => s.symbol === symbol);
  if (!sd) return;

  for (const s of starData) s.labelDiv.className = 'label-2d' + (s._hasData ? '' : ' no-data');
  sd.labelDiv.className = 'label-2d hovered';

  // Check if this stock is in a cluster
  const clusters = detectClusters();
  const cluster = clusters.find(c => c.includes(sd.index));
  if (cluster && cluster.length > 1) {
    spreadCluster(cluster, sd.basePos.clone());
  }

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
      starData[hoveredIndex].labelDiv.className = 'label-2d' + (starData[hoveredIndex]._hasData ? '' : ' no-data');
    }

    if (intersects.length > 0) {
      const idx = intersects[0].index;
      hoveredIndex = idx;
      const sd = starData[idx];
      sd.labelDiv.className = 'label-2d hovered';

      // Check for cluster at this point
      const clusters = detectClusters();
      const cluster = clusters.find(c => c.includes(idx));

      if (cluster && cluster.length > 1 && (!activeCluster || !cluster.every(i => activeCluster.includes(i)))) {
        spreadCluster(cluster, sd.basePos.clone());
      }

      // Build tooltip — show cluster members if applicable
      const sel = {
        x: document.getElementById('axis-x').value,
        y: document.getElementById('axis-y').value,
        z: document.getElementById('axis-z').value,
        color: document.getElementById('axis-color').value,
        size: document.getElementById('axis-size').value,
      };

      const s = sd.stock;
      const verdictColor = (s.composite || 0) >= 60 ? '#4ade80' : (s.composite || 0) >= 40 ? '#facc15' : '#f87171';
      let ttHtml = `
        <div class="tt-symbol">${sd.symbol}</div>
        <div class="tt-company">${sd.company} &middot; ${sd.sector}</div>
        <div class="tt-row"><span class="tt-label">Verdict</span><span class="tt-value" style="color:${verdictColor}">${fmt(s.composite)}</span></div>
        <div class="tt-row"><span class="tt-label">Risk Rating</span><span class="tt-value">${fmt(s.riskRating)}</span></div>
        <div class="tt-row"><span class="tt-label">Invest Score</span><span class="tt-value">${fmt(s.investScore)}</span></div>
        <div class="tt-row"><span class="tt-label">Change</span><span class="tt-value" style="color:${(s.changePercent||0)>=0?'#4ade80':'#f87171'}">${s.changePercent != null ? (s.changePercent>=0?'+':'') + s.changePercent.toFixed(2) + '%' : '—'}</span></div>
      `;

      if (cluster && cluster.length > 1) {
        const others = cluster.filter(i => i !== idx).map(i => starData[i].symbol).join(', ');
        ttHtml += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(100,116,139,0.3);font-size:10px;color:#94a3b8">
          Cluster: ${cluster.length} stocks nearby<br>${others}
        </div>`;
      }

      tooltip.innerHTML = ttHtml;
      tooltip.style.display = 'block';
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      tooltip.style.left = (px + 15) + 'px';
      tooltip.style.top = (py - 10) + 'px';
    } else {
      hoveredIndex = -1;
      tooltip.style.display = 'none';

      // Collapse cluster when mouse moves away
      if (activeCluster) collapseCluster();
    }
  });

  canvas.addEventListener('mouseleave', () => {
    hoveredIndex = -1;
    tooltip.style.display = 'none';
    if (activeCluster) collapseCluster();
  });
}

function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  return typeof v === 'number' ? v.toFixed(2) : String(v);
}
