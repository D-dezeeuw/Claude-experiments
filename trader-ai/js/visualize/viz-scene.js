/**
 * TraderAI — ThreeJS Scene Setup
 * Dark space scene with bloom postprocessing, orbit controls, axis grid.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

export const SCENE_SIZE = 100; // scene coordinate range 0-100

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
  const orange = new THREE.Color(0xf97316);
  const blue = new THREE.Color(0x3b82f6);
  const gray = new THREE.Color(0x6b7280);

  const axisConfigs = [
    { dir: [1, 0, 0], color: orange, label: 'X' },
    { dir: [0, 1, 0], color: blue,   label: 'Y' },
    { dir: [0, 0, 1], color: gray,   label: 'Z' },
  ];

  for (const ax of axisConfigs) {
    // Main axis line
    const points = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(ax.dir[0] * SCENE_SIZE, ax.dir[1] * SCENE_SIZE, ax.dir[2] * SCENE_SIZE),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: ax.color, transparent: true, opacity: 0.6 });
    scene.add(new THREE.Line(geo, mat));

    // Tick marks every 25 units
    for (let t = 0; t <= SCENE_SIZE; t += 25) {
      const tickGeo = new THREE.SphereGeometry(0.3, 4, 4);
      const tickMat = new THREE.MeshBasicMaterial({ color: ax.color });
      const tick = new THREE.Mesh(tickGeo, tickMat);
      tick.position.set(ax.dir[0] * t, ax.dir[1] * t, ax.dir[2] * t);
      scene.add(tick);
    }
  }

  // Subtle grid on XZ plane at Y=0
  const gridHelper = new THREE.GridHelper(SCENE_SIZE, 10, 0x1a1a2e, 0x1a1a2e);
  gridHelper.position.set(SCENE_SIZE / 2, 0, SCENE_SIZE / 2);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.3;
  scene.add(gridHelper);

  // Subtle grid on XY plane at Z=0
  const gridXY = new THREE.GridHelper(SCENE_SIZE, 10, 0x1a1a2e, 0x1a1a2e);
  gridXY.rotation.x = Math.PI / 2;
  gridXY.position.set(SCENE_SIZE / 2, SCENE_SIZE / 2, 0);
  gridXY.material.transparent = true;
  gridXY.material.opacity = 0.15;
  scene.add(gridXY);
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
