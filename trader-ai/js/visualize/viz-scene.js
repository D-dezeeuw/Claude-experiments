/**
 * TraderAI — ThreeJS Scene Setup
 * Dark space scene with bloom postprocessing, orbit controls, axis grid.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const SCENE_SIZE = 100;

// Store axis label references for dynamic updates
let axisLabelEls = { x: null, y: null, z: null };

export function createScene(container) {
  const w = container.clientWidth;
  const h = container.clientHeight;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08080f);
  scene.fog = new THREE.FogExp2(0x08080f, 0.003);

  // Camera
  const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 1000);
  camera.position.set(140, 100, 140);
  camera.lookAt(50, 50, 50);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // CSS2D label renderer (overlay)
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  container.appendChild(labelRenderer.domElement);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(50, 50, 50);
  controls.minDistance = 30;
  controls.maxDistance = 400;
  controls.update();

  // Bloom postprocessing
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.8,   // strength
    0.4,   // radius
    0.15   // threshold
  );
  const composer = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  // Build axes and grid
  buildAxes(scene);
  buildAmbientStars(scene);

  return { scene, camera, renderer, composer, controls, labelRenderer, bloomPass };
}

function buildAxes(scene) {
  const orange = 0xf97316;
  const blue = 0x3b82f6;
  const gray = 0x9ca3af;

  const axisConfigs = [
    { dir: new THREE.Vector3(1, 0, 0), color: orange, hex: '#f97316', id: 'x', defaultLabel: 'X Axis' },
    { dir: new THREE.Vector3(0, 1, 0), color: blue,   hex: '#3b82f6', id: 'y', defaultLabel: 'Y Axis' },
    { dir: new THREE.Vector3(0, 0, 1), color: gray,   hex: '#9ca3af', id: 'z', defaultLabel: 'Z Axis' },
  ];

  const S = SCENE_SIZE;
  const ARROW_LEN = 6;
  const ARROW_RAD = 1.2;

  for (const ax of axisConfigs) {
    const end = ax.dir.clone().multiplyScalar(S);
    const arrowTip = ax.dir.clone().multiplyScalar(S + ARROW_LEN);

    // ── Axis line (origin → end) ──
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), end]);
    const lineMat = new THREE.LineBasicMaterial({ color: ax.color, transparent: true, opacity: 0.6 });
    scene.add(new THREE.Line(lineGeo, lineMat));

    // ── Arrow cone at the tip ──
    const coneGeo = new THREE.ConeGeometry(ARROW_RAD, ARROW_LEN, 8);
    const coneMat = new THREE.MeshBasicMaterial({ color: ax.color, transparent: true, opacity: 0.8 });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    // Position at the tip and orient along axis direction
    cone.position.copy(end).add(ax.dir.clone().multiplyScalar(ARROW_LEN / 2));
    // Default cone points up (+Y); rotate to match axis direction
    if (ax.id === 'x') cone.rotation.z = -Math.PI / 2;
    else if (ax.id === 'z') cone.rotation.x = Math.PI / 2;
    // y is default (up), no rotation needed
    scene.add(cone);

    // ── Tick marks every 25 units with small value labels ──
    for (let t = 0; t <= S; t += 25) {
      const tickGeo = new THREE.SphereGeometry(0.4, 6, 6);
      const tickMat = new THREE.MeshBasicMaterial({ color: ax.color });
      const tick = new THREE.Mesh(tickGeo, tickMat);
      tick.position.copy(ax.dir.clone().multiplyScalar(t));
      scene.add(tick);

      // Small tick value label
      if (t > 0) {
        const tickDiv = document.createElement('div');
        tickDiv.style.cssText = `font-size:9px;font-family:monospace;color:${ax.hex};opacity:0.5;pointer-events:none;`;
        tickDiv.textContent = String(t);
        const tickLabel = new CSS2DObject(tickDiv);
        const offset = ax.id === 'x' ? new THREE.Vector3(0, -3, 0)
                     : ax.id === 'y' ? new THREE.Vector3(-3, 0, 0)
                     : new THREE.Vector3(0, -3, 0);
        tickLabel.position.copy(ax.dir.clone().multiplyScalar(t)).add(offset);
        scene.add(tickLabel);
      }
    }

    // ── Axis name label (beyond arrow tip) ──
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = `
      font-size: 13px; font-weight: 700; font-family: system-ui, sans-serif;
      color: ${ax.hex}; pointer-events: none; white-space: nowrap;
      text-shadow: 0 0 8px rgba(0,0,0,0.9), 0 0 3px ${ax.hex}40;
      padding: 2px 6px; border-radius: 4px;
      background: rgba(8,8,15,0.7); border: 1px solid ${ax.hex}30;
    `;
    labelDiv.textContent = ax.defaultLabel;
    labelDiv.id = 'axis-label-' + ax.id;
    const label3d = new CSS2DObject(labelDiv);
    label3d.position.copy(arrowTip).add(ax.dir.clone().multiplyScalar(4));
    scene.add(label3d);

    axisLabelEls[ax.id] = labelDiv;

    // ── "0" label at origin for this axis ──
    const zeroDiv = document.createElement('div');
    zeroDiv.style.cssText = `font-size:9px;font-family:monospace;color:${ax.hex};opacity:0.4;pointer-events:none;`;
    zeroDiv.textContent = '0';
    const zeroLabel = new CSS2DObject(zeroDiv);
    const zeroOffset = ax.id === 'x' ? new THREE.Vector3(0, -3, 0)
                     : ax.id === 'y' ? new THREE.Vector3(-3, 0, 0)
                     : new THREE.Vector3(0, -3, 0);
    zeroLabel.position.copy(zeroOffset);
    scene.add(zeroLabel);
  }

  // ── Subtle grid on XZ plane at Y=0 ──
  const gridHelper = new THREE.GridHelper(S, 10, 0x1a1a2e, 0x1a1a2e);
  gridHelper.position.set(S / 2, 0, S / 2);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.3;
  scene.add(gridHelper);

  // ── Subtle grid on XY plane at Z=0 ──
  const gridXY = new THREE.GridHelper(S, 10, 0x1a1a2e, 0x1a1a2e);
  gridXY.rotation.x = Math.PI / 2;
  gridXY.position.set(S / 2, S / 2, 0);
  gridXY.material.transparent = true;
  gridXY.material.opacity = 0.15;
  scene.add(gridXY);
}

/** Update axis labels when user changes dropdown selections */
export function updateAxisLabels(xLabel, yLabel, zLabel) {
  if (axisLabelEls.x) axisLabelEls.x.textContent = xLabel;
  if (axisLabelEls.y) axisLabelEls.y.textContent = yLabel;
  if (axisLabelEls.z) axisLabelEls.z.textContent = zLabel;
}

function buildAmbientStars(scene) {
  // Background starfield (decorative — tiny, dim, distant)
  const count = 500;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 600;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 600;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 600;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.5,
    color: 0x444466,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geo, mat));
}

export function resizeScene(sceneObj, container) {
  const w = container.clientWidth;
  const h = container.clientHeight;
  sceneObj.camera.aspect = w / h;
  sceneObj.camera.updateProjectionMatrix();
  sceneObj.renderer.setSize(w, h);
  sceneObj.composer.setSize(w, h);
  sceneObj.labelRenderer.setSize(w, h);
}

export function animate(sceneObj) {
  function loop() {
    requestAnimationFrame(loop);
    sceneObj.controls.update();
    sceneObj.composer.render();
    sceneObj.labelRenderer.render(sceneObj.scene, sceneObj.camera);
  }
  loop();
}

/** Smoothly fly camera to focus on a 3D position */
export function flyTo(sceneObj, targetPos) {
  const { camera, controls } = sceneObj;
  const offset = new THREE.Vector3(25, 18, 25);
  const camTarget = targetPos.clone().add(offset);
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  let frame = 0;
  const total = 50;

  function step() {
    frame++;
    const t = Math.min(1, frame / total);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    camera.position.lerpVectors(startPos, camTarget, ease);
    controls.target.lerpVectors(startTarget, targetPos, ease);
    controls.update();

    if (frame < total) requestAnimationFrame(step);
  }
  step();
}
