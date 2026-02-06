# Gaussian Fluids: WebGL 2 Implementation Plan

> Interactive fluid simulation based on *"Gaussian Fluids: A Grid-Free Fluid Solver based on Gaussian Spatial Representation"* (Xing et al., SIGGRAPH 2025), adapted for real-time rendering with **WebGL 2 + GLSL ES 3.0** shaders.

---

## Table of Contents

1. [Paper Summary & Core Math](#1-paper-summary--core-math)
2. [WebGL 2 Architecture Constraints](#2-webgl-2-architecture-constraints)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Phase 1 — GPGPU Foundation](#4-phase-1--gpgpu-foundation)
5. [Phase 2 — Gaussian Spatial Representation](#5-phase-2--gaussian-spatial-representation)
6. [Phase 3 — Velocity Field Evaluation](#6-phase-3--velocity-field-evaluation)
7. [Phase 4 — Advection (RK4)](#7-phase-4--advection-rk4)
8. [Phase 5 — Projection & Optimization](#8-phase-5--projection--optimization)
9. [Phase 6 — Adaptive Reseeding](#9-phase-6--adaptive-reseeding)
10. [Phase 7 — Visualization & Rendering](#10-phase-7--visualization--rendering)
11. [Phase 8 — 3D Extension](#11-phase-8--3d-extension)
12. [Phase 9 — Interactivity](#12-phase-9--interactivity)
13. [Phase 10 — Polish & Performance](#13-phase-10--polish--performance)
14. [File Structure](#14-file-structure)
15. [Milestones & Verification](#15-milestones--verification)

---

## 1. Paper Summary & Core Math

### 1.1 Core Idea

The velocity field **u(x)** of a fluid is represented as a weighted sum of N anisotropic Gaussian basis functions — directly inspired by 3D Gaussian Splatting, but encoding vector fields instead of radiance. The continuous, differentiable representation is evolved over time by recasting the Navier-Stokes equations as an optimization problem.

### 1.2 Gaussian Basis Function

Each Gaussian kernel:

```
G_i(x) = exp( -0.5 * (x - μ_i)^T * Σ_i^{-1} * (x - μ_i) )
```

Where:
- **μ_i** ∈ ℝ^d — center position of the i-th Gaussian
- **Σ_i = R_i · S_i · S_i^T · R_i^T** — covariance matrix
- **R_i** — rotation matrix (angle θ in 2D, quaternion in 3D)
- **S_i** — diagonal scale matrix (stored as `log(s)` to keep positive)

### 1.3 Velocity Field

```
u(x) = Σ_{i=1}^{N}  w_i · G_i(x)
```

Where **w_i** ∈ ℝ^d is the vector-valued weight (velocity contribution) of the i-th Gaussian.

### 1.4 Spatial Derivatives (Analytical)

Because each Gaussian is infinitely differentiable, all spatial derivatives are computed analytically. For a single Gaussian:

```
∇G_i(x) = -Σ_i^{-1} · (x - μ_i) · G_i(x)
```

The velocity gradient tensor:

```
∂u_j/∂x_k = Σ_i  w_{i,j} · [-Σ_i^{-1} · (x - μ_i)]_k · G_i(x)
```

**2D Vorticity** (scalar):
```
ω = ∂u_y/∂x - ∂u_x/∂y
```

**2D Divergence** (scalar):
```
∇·u = ∂u_x/∂x + ∂u_y/∂y
```

**3D Vorticity** (vector):
```
ω = ∇ × u = (∂u_z/∂y - ∂u_y/∂z,  ∂u_x/∂z - ∂u_z/∂x,  ∂u_y/∂x - ∂u_x/∂y)
```

### 1.5 Navier-Stokes (Incompressible)

```
∂u/∂t + (u · ∇)u = -(1/ρ)∇p + ν∇²u + f
∇ · u = 0
```

### 1.6 Operator-Splitting Solver (Per Time Step)

1. **Reseed** — Split Gaussians with high anisotropy ratio (`max(s)/min(s) ≥ r_aniso`)
2. **Advect** — Move Gaussian centers via RK4; covector-advect weights via flow Jacobian
3. **Project** — Fix positions/rotations, optimize weights + scales to minimize physics losses

### 1.7 Loss Functions

```
L_total = λ_ω · L_ω  +  λ_div · L_div  +  λ_bnd · L_bnd  +  λ_pos · L_pos  +  λ_aniso · L_aniso  +  λ_vol · L_vol
```

| Loss | Formula | Purpose |
|------|---------|---------|
| **L_ω** (vorticity) | `mean(\|ω_current - ω_target\|)` | Preserve vortex structures |
| **L_div** (divergence) | `mean((∇·u)²)` | Enforce incompressibility |
| **L_bnd** (boundary) | `mean(\|u · n\|²)` at walls | No-penetration condition |
| **L_pos** (position) | `mean(\|μ - μ_advected\|²)` | Prevent particle drift |
| **L_aniso** (anisotropy) | `mean(max(ratio, 1.5) - 1.5)` | Limit elongation |
| **L_vol** (volume) | `mean((det(S) - det(S_ref))²)` | Regularize Gaussian size |

### 1.8 Gradient Projection

When vorticity and divergence gradients conflict (negative dot product), project the divergence gradient orthogonally to the vorticity gradient:

```
g_div_projected = g_div - (g_div · g_ω / g_ω · g_ω) · g_ω
```

### 1.9 Covector Advection

After RK4 advection, the inverse covariance updates via the flow Jacobian **F = ∂Φ/∂x**:

```
Σ^{-1}_new = F^T · Σ^{-1}_old · F
```

Then decompose back into R and S via polar decomposition.

### 1.10 Divergence-Free Stream Function (2D Only)

An exactly divergence-free velocity field can be constructed from a scalar stream function φ:

```
φ(x) = Σ_i  φ_i · G_i(x)

u(x) = J · ∇φ(x)    where J = [[0, -1], [1, 0]]
```

This gives `u_x = -∂φ/∂y` and `u_y = ∂φ/∂x`, which is automatically divergence-free.

---

## 2. WebGL 2 Architecture Constraints

### 2.1 What We Have

| Feature | WebGL 2 / GLSL ES 3.0 Support |
|---------|-------------------------------|
| Float textures (read) | `OES_texture_float` — widely supported |
| Float textures (render to) | `EXT_color_buffer_float` — required, check at init |
| Multiple Render Targets (MRT) | Up to 4 via `gl.drawBuffers()` |
| Transform Feedback | Capture vertex shader outputs to buffers |
| 3D Textures | `sampler3D` — native in WebGL 2 |
| Integer textures | `isampler2D` / `usampler2D` — native |
| `texelFetch()` | Direct texel access without filtering — native |
| Instanced rendering | `gl.drawArraysInstanced()` — native |
| Uniform Buffer Objects | `layout(std140) uniform` — native |

### 2.2 What We Don't Have

| Missing Feature | Workaround |
|-----------------|------------|
| Compute shaders | GPGPU via fullscreen-quad fragment shader passes writing to FBOs |
| Shader Storage Buffers | Encode data in float textures; use `texelFetch()` |
| Atomic counters | Multi-pass reduction; CPU readback for counts |
| Shared memory / workgroups | Each fragment is independent; use texture lookups for neighbor data |
| Read-write textures | Ping-pong: read from texture A, write to texture B, swap |
| Arbitrary scatter writes | Vertex shader + transform feedback, or restructure as gather |

### 2.3 GPGPU Strategy

All "computation" in WebGL 2 happens by:

1. Binding input data as **float textures** (RGBA32F)
2. Rendering a **fullscreen triangle** (covers the viewport)
3. A **fragment shader** reads inputs via `texelFetch()`, computes, writes to `gl_FragColor`
4. Output goes to a **Framebuffer Object (FBO)** with float texture attachment
5. **Ping-pong** between two FBOs for iterative algorithms
6. **MRT** to write up to 4 vec4 outputs per pass (8-16 floats)

### 2.4 Data Layout in Textures

For N Gaussians, use a texture of width W = ceil(sqrt(N)), height H = W. Each Gaussian's index `i` maps to texel `(i % W, i / W)`.

**Texture slots per Gaussian (2D):**

| Texture | RGBA Contents | Per-Gaussian |
|---------|---------------|-------------|
| `t_posScale` | `(μ_x, μ_y, log_s_x, log_s_y)` | position + log-scale |
| `t_rotWeight` | `(θ, w_x, w_y, 0.0)` | rotation angle + velocity weight |

That's 7 floats per Gaussian in **2 texture lookups**.

**Texture slots per Gaussian (3D):**

| Texture | RGBA Contents |
|---------|---------------|
| `t_pos` | `(μ_x, μ_y, μ_z, 0.0)` |
| `t_scale` | `(log_s_x, log_s_y, log_s_z, 0.0)` |
| `t_rot` | `(q_x, q_y, q_z, q_w)` |
| `t_weight` | `(w_x, w_y, w_z, 0.0)` |

That's 13 floats per Gaussian in **4 texture lookups**.

### 2.5 Performance Budget

Target: **60 fps** on mid-range GPU (e.g., GTX 1060 / M1).

| Parameter | Budget |
|-----------|--------|
| Gaussians (2D) | 512–2048 |
| Gaussians (3D) | 256–1024 |
| Velocity grid resolution (2D) | 256×256 |
| Velocity grid resolution (3D) | 64×64×64 |
| Optimization iterations per frame | 4–16 |
| RK4 substeps | 1 per frame |

---

## 3. System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    JavaScript (CPU)                      │
│                                                         │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────────┐  │
│  │  Three.js │  │ Simulation│  │   Interaction        │  │
│  │  Scene &  │  │ Controller│  │   (mouse, GUI)       │  │
│  │  Renderer │  │ (timestep │  │                      │  │
│  │           │  │  loop)    │  │                      │  │
│  └─────┬─────┘  └─────┬─────┘  └──────────┬───────────┘  │
│        │              │                    │              │
│        ▼              ▼                    ▼              │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              GPU Pass Manager                       │  │
│  │  (schedules render passes, manages FBOs & textures) │  │
│  └─────────────────────────┬───────────────────────────┘  │
└────────────────────────────┼────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                     GPU (WebGL 2)                        │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Advection   │  │  Projection  │  │ Visualization│  │
│  │  Pass (RK4)  │  │  Passes      │  │ Pass         │  │
│  │              │  │  (iterative) │  │              │  │
│  │  Reads:      │  │  Reads:      │  │  Reads:      │  │
│  │  - particles │  │  - particles │  │  - particles │  │
│  │  - vel field │  │  - ω_target  │  │  Writes:     │  │
│  │  Writes:     │  │  - grid accel│  │  - screen    │  │
│  │  - particles'│  │  Writes:     │  │              │  │
│  │              │  │  - particles'│  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  Float Texture Pool:                                    │
│  [t_posScale_A/B] [t_rotWeight_A/B] [t_velField]       │
│  [t_vorticityTarget] [t_gridAccel] [t_gradients]        │
└─────────────────────────────────────────────────────────┘
```

### Solver Loop (Per Frame)

```
for each frame:
  1. [GPU] Reseed Pass — check anisotropy, mark splits (if needed)
  2. [GPU] Advection Pass — RK4 move particles, covector advect weights
  3. [GPU] Compute ω_target — evaluate vorticity at sample points from advected field
  4. [GPU] Projection Loop (K iterations):
       a. Evaluate current ω and ∇·u at sample points
       b. Compute loss gradients w.r.t. weights and scales
       c. Apply gradient descent update (Adam-like)
       d. Apply gradient projection if ω/div gradients conflict
  5. [GPU] Build spatial grid — bin particles for fast neighbor lookup
  6. [GPU] Visualization Pass — evaluate field on screen grid, color-map
  7. [GPU → Screen] Final composite render
```

---

## 4. Phase 1 — GPGPU Foundation

> Build the reusable infrastructure for all GPU computation passes.

### Step 1.1: WebGL 2 Context & Extension Setup

Create `js/gpu/context.js`:

```javascript
// Initialize WebGL 2 context
// Check and enable required extensions:
//   - EXT_color_buffer_float (render to float textures)
//   - OES_texture_float_linear (optional: linear filtering of float textures)
// Configure: gl.getParameter(gl.MAX_DRAW_BUFFERS) for MRT count
// Store capabilities object for runtime feature checks
```

### Step 1.2: Float Texture Manager

Create `js/gpu/textures.js`:

```javascript
// createFloatTexture(width, height, channels) → {texture, format}
//   - RGBA32F via gl.RGBA32F internal format
//   - gl.NEAREST filtering (no interpolation for data textures)
//   - gl.CLAMP_TO_EDGE wrapping
//
// createPingPongPair(width, height, channels) → {texA, texB, fboA, fboB, swap()}
//   - Two textures + two FBOs for read/write cycling
//   - swap() flips which is "read" and which is "write"
//
// uploadFloatData(texture, data: Float32Array)
// readbackFloatData(fbo, width, height) → Float32Array
```

### Step 1.3: Fullscreen Triangle & Pass Runner

Create `js/gpu/pass.js`:

```javascript
// Fullscreen triangle vertex shader (single triangle covering clip space):
//   gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0)  // 3 vertices
//   v_uv = gl_Position.xy * 0.5 + 0.5
//
// class GPUPass:
//   constructor(gl, fragmentShaderSource, uniforms)
//   setUniform(name, value)
//   bindInputTexture(unit, texture, uniformName)
//   execute(outputFBO)  // or null for screen
//   executeToMRT([fbo1, fbo2, ...])  // multiple render targets
```

### Step 1.4: Shader Compilation Utilities

Create `js/gpu/shaders.js`:

```javascript
// compileShader(gl, source, type) → shader
// linkProgram(gl, vertShader, fragShader) → program
// Common GLSL preamble:
//   #version 300 es
//   precision highp float;
//   precision highp sampler2D;
```

### Step 1.5: Verification

- Render a simple GPGPU pass: write `sin(uv.x * 10.0)` to a float texture, read it back, verify values match CPU computation.
- Confirm ping-pong works: write value, read it in next pass, modify, write again.

---

## 5. Phase 2 — Gaussian Spatial Representation

> Implement the core data structure: Gaussians encoded in textures with analytical derivative support.

### Step 2.1: Gaussian Parameter Initialization (CPU)

Create `js/simulation/gaussians.js`:

```javascript
// class GaussianField:
//   N — number of Gaussians
//   texSize — ceil(sqrt(N)) (texture dimension)
//
//   Parameters (Float32Arrays, mirrored to GPU textures):
//     positions[N*2]    — (μ_x, μ_y) per Gaussian
//     logScales[N*2]    — (log(s_x), log(s_y)) per Gaussian
//     rotations[N]      — θ angle per Gaussian (2D)
//     weights[N*2]      — (w_x, w_y) per Gaussian
//
//   Methods:
//     initGrid(domainMin, domainMax, nx, ny)
//       — place Gaussians on regular grid
//       — set initial scales to ~1.5× grid spacing
//       — rotations to 0, weights to 0
//
//     uploadToGPU()
//       — pack into textures t_posScale and t_rotWeight
//
//     readbackFromGPU()
//       — read float textures back to CPU arrays
```

### Step 2.2: Gaussian Evaluation Shader (GLSL)

Create `shaders/gaussian_eval.glsl` (shared GLSL functions):

```glsl
// Inverse covariance from log-scale and rotation:
//
// mat2 getInvCovariance(float theta, vec2 logScale) {
//     vec2 s_inv = 1.0 / exp(logScale);  // inverse scales
//     float c = cos(theta), sn = sin(theta);
//     mat2 R = mat2(c, sn, -sn, c);      // rotation matrix
//     mat2 S_inv = mat2(s_inv.x, 0, 0, s_inv.y);
//     mat2 RS = R * S_inv;
//     return transpose(RS) * RS;          // Σ^{-1} = (R·S)^{-T}·(R·S)^{-1}
// }
//
// float evalGaussian(vec2 x, vec2 mu, mat2 sigmaInv) {
//     vec2 d = x - mu;
//     return exp(-0.5 * dot(d, sigmaInv * d));
// }
//
// Gradient of Gaussian w.r.t. x:
// vec2 gradGaussian(vec2 x, vec2 mu, mat2 sigmaInv, float g) {
//     return -sigmaInv * (x - mu) * g;  // ∇G = -Σ^{-1}(x-μ)G(x)
// }
```

### Step 2.3: Velocity Evaluation Shader

Create `shaders/eval_velocity.frag`:

```glsl
// For a given query point x (from fragment UV → domain coordinates):
//   u(x) = Σ_i w_i · G_i(x)
//
// Loop over all Gaussians (brute force first, spatial grid later):
//   for (int i = 0; i < N; i++) {
//       vec4 posScale = texelFetch(t_posScale, idx(i), 0);
//       vec4 rotWeight = texelFetch(t_rotWeight, idx(i), 0);
//       vec2 mu = posScale.xy;
//       vec2 logS = posScale.zw;
//       float theta = rotWeight.x;
//       vec2 w = rotWeight.yz;
//       mat2 sigInv = getInvCovariance(theta, logS);
//       float g = evalGaussian(x, mu, sigInv);
//       velocity += w * g;
//   }
//   gl_FragColor = vec4(velocity, 0.0, 1.0);
```

### Step 2.4: Velocity Gradient Tensor Evaluation Shader

Create `shaders/eval_velocity_grad.frag`:

```glsl
// For a given query point x, compute the full 2×2 velocity gradient:
//   ∂u_j/∂x_k = Σ_i  w_{i,j} · [-Σ_i^{-1}·(x-μ_i)]_k · G_i(x)
//
// Output (via MRT or packed into vec4):
//   layout(location = 0) out vec4 out_velocity;     // (u_x, u_y, 0, 0)
//   layout(location = 1) out vec4 out_gradients;     // (∂ux/∂x, ∂ux/∂y, ∂uy/∂x, ∂uy/∂y)
//
// Derived quantities computed in downstream passes:
//   vorticity: ω = ∂uy/∂x - ∂ux/∂y  (= out_gradients.z - out_gradients.y)
//   divergence: ∇·u = ∂ux/∂x + ∂uy/∂y (= out_gradients.x + out_gradients.w)
```

### Step 2.5: Verification

- Initialize a Taylor-Green vortex field: `u = (sin(x)cos(y), -cos(x)sin(y))`
- Fit Gaussian weights to match (CPU least-squares or iterative)
- Render velocity magnitude to screen — should show characteristic checkerboard pattern
- Compare vorticity `ω = -2sin(x)sin(y)` with computed vorticity — visual match

---

## 6. Phase 3 — Velocity Field Evaluation

> Build the spatial acceleration structure and efficient field evaluation pass.

### Step 3.1: Spatial Grid Construction

Create `shaders/build_grid.frag` and `js/simulation/spatial-grid.js`:

The grid accelerates field evaluation from O(N) per query to O(K) where K is the number of nearby Gaussians.

```
Strategy:
1. Divide domain into a regular grid of cells (e.g., 32×32)
2. Each cell stores indices of Gaussians whose support overlaps it
3. A Gaussian with scale s has effective radius ~3s (99.7% of mass)

Implementation via "counting sort" in multiple passes:
  Pass 1: Count — for each Gaussian, determine which cells it overlaps,
           atomically increment cell counters (stored in a count texture)
  Pass 2: Prefix sum — compute offsets (parallel scan on count texture)
  Pass 3: Scatter — write Gaussian indices into a flat index texture

WebGL 2 workaround (no atomics):
  - CPU-side: read back positions, bin into cells, upload index texture
  - Acceptable for N ≤ 2048 (< 0.1ms on CPU)
  - Format: 2D texture where row = cell index, columns = Gaussian indices
  - Max Gaussians per cell: fixed (e.g., 32) with padding
```

### Step 3.2: Grid-Accelerated Evaluation Shader

Create `shaders/eval_velocity_grid.frag`:

```glsl
// Determine which grid cell this fragment's query point falls in
// Look up neighboring cells (3×3 in 2D)
// Only evaluate Gaussians indexed in those cells
// Sum contributions as before
//
// uniform sampler2D t_grid;        // cell → Gaussian indices
// uniform sampler2D t_gridCounts;  // cell → count of Gaussians
// uniform vec2 gridOrigin;
// uniform vec2 gridCellSize;
// uniform int maxPerCell;
```

### Step 3.3: Vorticity & Divergence Field Evaluation

Create `shaders/eval_vorticity_divergence.frag`:

```glsl
// Evaluate at each fragment:
//   ω(x) = Σ_i [w_{i,y} · (−Σ^{-1}(x−μ_i))_x − w_{i,x} · (−Σ^{-1}(x−μ_i))_y] · G_i(x)
//   div(x) = Σ_i [w_{i,x} · (−Σ^{-1}(x−μ_i))_x + w_{i,y} · (−Σ^{-1}(x−μ_i))_y] · G_i(x)
//
// Output: vec4(ω, div, 0.0, 0.0)
// Uses spatial grid for acceleration
```

### Step 3.4: Verification

- With Taylor-Green vortex, render vorticity field — should show smooth sine pattern
- Divergence should be near zero everywhere (analytically div-free initial condition)
- Compare brute-force vs grid-accelerated — results should be identical within float precision

---

## 7. Phase 4 — Advection (RK4)

> Move Gaussian particles through the velocity field using 4th-order Runge-Kutta integration.

### Step 4.1: Particle Advection Pass

Create `shaders/advect_particles.frag`:

```glsl
// Each fragment represents one Gaussian particle.
// texelFetch its current position from t_posScale.
// Perform RK4:
//
//   k1 = dt * evalVelocity(pos)
//   k2 = dt * evalVelocity(pos + 0.5*k1)
//   k3 = dt * evalVelocity(pos + 0.5*k2)
//   k4 = dt * evalVelocity(pos + k3)
//   newPos = pos + (k1 + 2*k2 + 2*k3 + k4) / 6
//
// evalVelocity() uses the full GSR evaluation (with spatial grid).
// This requires evaluating the sum of all Gaussians at 4 points per particle.
//
// Output: new position in t_posScale_out
```

### Step 4.2: Flow Jacobian Computation

To perform covector advection, we need the Jacobian of the flow map **F = I + dt · ∇u** (first-order approximation) or accumulated through RK4 substeps.

```glsl
// Compute velocity gradient ∂u/∂x at particle position:
//   mat2 J = identity + dt * velocityGradient(pos);
//   (use the same analytical gradient as Section 5)
//
// For higher accuracy, accumulate Jacobian through RK4 stages:
//   F = F4 · F3 · F2 · F1
//   where F_k = I + (dt/6 or dt/3) * ∇u(x_k)
```

### Step 4.3: Covector Advection Pass

Create `shaders/advect_covector.frag`:

```glsl
// For each Gaussian i:
//   1. Compute flow Jacobian F at particle position
//   2. Update inverse covariance: Σ^{-1}_new = F^T · Σ^{-1}_old · F
//   3. Decompose Σ^{-1}_new back to (R_new, S_new):
//      - Compute Σ_new = inverse(Σ^{-1}_new)  (2×2 inverse is cheap)
//      - SVD of Σ_new: Σ = U · D · U^T
//      - R_new = U, S_new = sqrt(D)
//      - θ_new = atan2(U[1][0], U[0][0])
//      - logS_new = log(sqrt(D))
//   4. Covector-advect the weight:
//      w_new = F^{-T} · w_old · det(F)  (covector transport)
//      For incompressible flow (det(F)≈1): w_new ≈ F^{-T} · w_old
//
// Output (MRT):
//   location 0: vec4(newPos.x, newPos.y, newLogS.x, newLogS.y)
//   location 1: vec4(newTheta, newW.x, newW.y, 0.0)
```

### Step 4.4: Domain Boundary Clamping

```glsl
// After advection, clamp particles to domain:
//   if (newPos.x < domainMin.x || newPos.x > domainMax.x ||
//       newPos.y < domainMin.y || newPos.y > domainMax.y) {
//       // Mark particle as inactive (set weight to 0)
//       // Or reflect position back into domain
//   }
```

### Step 4.5: Verification

- Place a single Gaussian in a uniform flow field `u = (1, 0)` — it should translate right at constant speed
- Taylor-Green vortex: advect particles for one step, check they follow streamlines
- Verify covector advection: place Gaussian in a shear flow, verify rotation updates correctly
- Check energy conservation: total kinetic energy ∫|u|²dx should remain approximately constant

---

## 8. Phase 5 — Projection & Optimization

> The most critical and complex phase. Enforce physical constraints by optimizing Gaussian weights and scales.

### Strategy for WebGL 2

The paper uses PyTorch's Adam optimizer with autograd. In WebGL 2 we have no autograd, so we implement the optimization entirely in shaders using analytical gradients.

**Key insight**: Since all derivatives of Gaussians are analytical, we can compute ∂L/∂w_i and ∂L/∂s_i in closed form without automatic differentiation.

### Step 5.1: Target Vorticity Computation

Create `shaders/compute_target_vorticity.frag`:

```glsl
// Before projection, compute the "target" vorticity at sample points.
// The target is the vorticity of the advected field (from the advection step).
// This is what projection must preserve.
//
// Sample points: regular grid over domain (e.g., 128×128)
// For each sample point x_j:
//   ω_target(x_j) = vorticity of advected Gaussian field at x_j
//
// Output: texture of target vorticity values
```

### Step 5.2: Loss Gradient Computation (Analytical)

Create `shaders/compute_loss_gradients.frag`:

This is the core shader. For each Gaussian i, compute ∂L/∂w_i and ∂L/∂(logS_i) by summing contributions from all sample points.

```
The gradient of the vorticity loss w.r.t. weight w_i:

  ∂L_ω/∂w_{i,x} = (1/M) Σ_j  sign(ω(x_j) - ω_target(x_j)) · (-[Σ^{-1}(x_j-μ_i)]_y) · G_i(x_j)
  ∂L_ω/∂w_{i,y} = (1/M) Σ_j  sign(ω(x_j) - ω_target(x_j)) · (+[Σ^{-1}(x_j-μ_i)]_x) · G_i(x_j)

The gradient of the divergence loss w.r.t. weight w_i:

  ∂L_div/∂w_{i,x} = (2/M) Σ_j  div(x_j) · (-[Σ^{-1}(x_j-μ_i)]_x) · G_i(x_j)
  ∂L_div/∂w_{i,y} = (2/M) Σ_j  div(x_j) · (-[Σ^{-1}(x_j-μ_i)]_y) · G_i(x_j)

Implementation:
  - Fragment shader where each fragment = one Gaussian
  - Inner loop over all sample points (or nearby sample points via grid)
  - Accumulate gradient contributions
  - Also compute scale gradients (∂L/∂logS_i) analogously
```

### Step 5.3: Gradient Projection

Create `shaders/gradient_project.frag`:

```glsl
// Per Gaussian, given grad_omega and grad_div (both vec2 for weights):
//   float dotProduct = dot(grad_div, grad_omega);
//   if (dotProduct < 0.0) {
//       // Project div gradient orthogonally to omega gradient
//       grad_div -= (dotProduct / dot(grad_omega, grad_omega)) * grad_omega;
//   }
//   combined_grad = lambda_omega * grad_omega + lambda_div * grad_div;
```

### Step 5.4: Adam Optimizer Step

Create `shaders/adam_update.frag`:

```glsl
// Standard Adam optimizer implemented per-Gaussian in a fragment shader.
// Maintains first moment (m) and second moment (v) in additional textures.
//
// Per parameter p (weight or logScale component):
//   m = beta1 * m + (1 - beta1) * grad
//   v = beta2 * v + (1 - beta2) * grad * grad
//   m_hat = m / (1 - beta1^t)
//   v_hat = v / (1 - beta2^t)
//   p = p - lr * m_hat / (sqrt(v_hat) + epsilon)
//
// Additional textures needed:
//   t_adam_m_weight, t_adam_v_weight  (first/second moments for weights)
//   t_adam_m_scale, t_adam_v_scale    (first/second moments for scales)
//
// Typical hyperparameters:
//   lr = 0.01, beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8
```

### Step 5.5: Projection Iteration Loop

In JavaScript, orchestrate K projection iterations per time step:

```javascript
for (let k = 0; k < K_PROJECTION_ITERS; k++) {
    // 1. Evaluate current vorticity + divergence at sample points
    evalVorticityDivergencePass.execute(t_currentVorDiv);

    // 2. Compute loss gradients w.r.t. weights and scales
    computeGradientsPass.execute(t_gradWeights, t_gradScales);

    // 3. Apply gradient projection (resolve omega/div conflicts)
    gradientProjectPass.execute(t_projectedGrads);

    // 4. Add regularization gradients (boundary, anisotropy, volume, position)
    addRegularizationPass.execute(t_totalGrads);

    // 5. Adam update step
    adamUpdatePass.execute(t_rotWeight_out);  // updates weights
    adamUpdateScalePass.execute(t_posScale_out);  // updates log-scales

    // 6. Swap ping-pong buffers
    t_rotWeight.swap();
    t_posScale.swap();
}
```

### Step 5.6: Boundary Loss

```glsl
// Sample points along domain boundaries (walls):
//   For no-penetration: penalize u · n (normal component)
//   For no-slip: penalize |u| (total velocity)
//
// ∂L_bnd/∂w_i = (2/M_bnd) Σ_j∈boundary  (u(x_j)·n_j) · n_j · G_i(x_j)
```

### Step 5.7: Regularization Losses

```glsl
// Position loss: ∂L_pos/∂μ_i = 2(μ_i - μ_i_advected)
//   (Only if positions are optimized — paper fixes them during projection)
//
// Anisotropy loss:
//   ratio = exp(max(logS) - min(logS))
//   if ratio > 1.5:
//     ∂L_aniso/∂logS = gradient pushing ratio toward 1.5
//
// Volume loss:
//   vol = exp(logS.x + logS.y)  (2D determinant of S)
//   ∂L_vol/∂logS = gradient pushing vol toward reference volume
```

### Step 5.8: Verification

- Initialize Taylor-Green vortex, run one advect + project cycle
- Measure divergence before and after projection — should decrease significantly
- Measure vorticity error before and after — should remain small
- Run 100 time steps — vorticity structures should persist (compare to ground truth)

---

## 9. Phase 6 — Adaptive Reseeding

> Split elongated Gaussians to maintain representation quality.

### Step 6.1: Anisotropy Detection Pass

Create `shaders/detect_splits.frag`:

```glsl
// For each Gaussian, compute anisotropy ratio:
//   vec2 s = exp(logScale);
//   float ratio = max(s.x, s.y) / min(s.x, s.y);
//   bool needsSplit = (ratio >= R_ANISO_THRESHOLD);  // typically 1.5–2.0
//
// Output: flag texture marking which Gaussians need splitting
```

### Step 6.2: Splitting (CPU-side)

Splitting changes the number of Gaussians, which requires resizing textures — this is handled on CPU:

```javascript
// 1. Read back anisotropy flags from GPU
// 2. For each flagged Gaussian i:
//    a. Sample 2 new positions along the major axis of Gaussian i:
//       offset = R_i · [s_major, 0] · 0.5
//       pos_A = μ_i + offset
//       pos_B = μ_i - offset
//    b. New scales: reduce major axis by 0.5, keep minor axis
//       logS_A = logS_B = logS_i - [log(2), 0] (along major axis)
//    c. New weights: w_A = w_B = w_i * 0.5
//    d. Rotation unchanged
// 3. Replace original Gaussian with 2 new ones in arrays
// 4. Resize textures if needed, re-upload all data
// 5. Rebuild spatial grid
```

### Step 6.3: Post-Split Refinement

After splitting, run a few projection iterations to re-fit the field:

```javascript
// The split is an approximation — the field changes slightly.
// Run 4–8 projection iterations to correct the representation.
```

### Step 6.4: Verification

- Create a single Gaussian in a shear flow — it should elongate, then split
- After split, field error should be small (< 1% change in vorticity)
- Particle count should grow in regions of high deformation

---

## 10. Phase 7 — Visualization & Rendering

> Render the fluid field to screen with informative and beautiful colormaps.

### Step 7.1: Vorticity Colormap Shader

Create `shaders/render_vorticity.frag`:

```glsl
// Evaluate vorticity ω at each screen pixel
// Map to color using diverging colormap (blue-white-red):
//   negative ω → blue (clockwise rotation)
//   zero ω → white/black
//   positive ω → red (counter-clockwise rotation)
//
// vec3 vorticityColormap(float omega, float maxOmega) {
//     float t = clamp(omega / maxOmega, -1.0, 1.0);
//     // Cool-warm diverging colormap
//     vec3 cool = vec3(0.2, 0.4, 0.9);   // blue
//     vec3 warm = vec3(0.9, 0.2, 0.2);   // red
//     vec3 mid  = vec3(0.95);             // white
//     if (t < 0.0) return mix(mid, cool, -t);
//     else         return mix(mid, warm,  t);
// }
```

### Step 7.2: Velocity Magnitude Shader

Create `shaders/render_velocity.frag`:

```glsl
// Evaluate |u(x)| at each pixel
// Map to sequential colormap (viridis-like):
//
// vec3 viridis(float t) {
//     // Attempt polynomial approximation of viridis
//     vec3 c0 = vec3(0.267, 0.004, 0.329);
//     vec3 c1 = vec3(0.282, 0.140, 0.457);
//     vec3 c2 = vec3(0.127, 0.566, 0.550);
//     vec3 c3 = vec3(0.993, 0.906, 0.144);
//     return mix(mix(c0, c1, t), mix(c2, c3, t), t);
// }
```

### Step 7.3: Dye Advection (Passive Tracer)

Create `shaders/advect_dye.frag`:

For beautiful smoke-like visuals, advect a passive scalar dye field through the velocity field:

```glsl
// Semi-Lagrangian advection of dye texture:
//   1. For each pixel at position x, trace backward: x_prev = x - dt * u(x)
//   2. Sample dye texture at x_prev (bilinear interpolation)
//   3. Write to output dye texture
//   4. Optionally add small diffusion for stability
//
// The dye field is a separate RGBA texture (can encode color + density)
// Users can "inject" dye via mouse interaction
```

### Step 7.4: Gaussian Debug Visualization

Create `shaders/render_gaussians.vert` + `.frag`:

```glsl
// Render each Gaussian as an oriented ellipse using instanced rendering:
//   - Instance ID → Gaussian index → texelFetch parameters
//   - Vertex shader transforms unit circle by R · S to create ellipse
//   - Fragment shader: discard outside ellipse, color by weight direction
//   - Useful for debugging particle distribution and advection
```

### Step 7.5: Composite Renderer

Create `shaders/composite.frag`:

```glsl
// Combine visualization layers:
//   - Background: vorticity or velocity colormap
//   - Overlay: dye advection (alpha-blended)
//   - Debug: Gaussian ellipses (toggle-able)
//   - UI: domain boundary, scale bar, colorbar legend
```

### Step 7.6: Verification

- Render Taylor-Green vortex — should show 4 counter-rotating vortex cells
- Dye advection should show smooth, swirling patterns following the flow
- Gaussian ellipses should align with local flow structure
- Performance: steady 60fps at 256×256 visualization resolution

---

## 11. Phase 8 — 3D Extension

> Extend the solver to three dimensions with volume rendering.

### Step 8.1: 3D Gaussian Parameters

Extend data layout to 3D (4 textures per Gaussian):

```
t_pos:    (μ_x, μ_y, μ_z, 0)
t_scale:  (logS_x, logS_y, logS_z, 0)
t_rot:    (q_x, q_y, q_z, q_w)         — quaternion
t_weight: (w_x, w_y, w_z, 0)
```

### Step 8.2: 3D Gaussian Evaluation Shader

```glsl
// mat3 getInvCovariance3D(vec4 quat, vec3 logScale):
//   Build rotation matrix from quaternion
//   Build inverse scale matrix
//   Σ^{-1} = (R·S^{-1})^T · (R·S^{-1})
//
// float evalGaussian3D(vec3 x, vec3 mu, mat3 sigmaInv):
//   vec3 d = x - mu;
//   return exp(-0.5 * dot(d, sigmaInv * d));
```

### Step 8.3: Quaternion Utilities (GLSL)

```glsl
// mat3 quatToMat3(vec4 q) — quaternion to 3×3 rotation matrix
// vec4 mat3ToQuat(mat3 m) — rotation matrix to quaternion
// vec4 quatMul(vec4 a, vec4 b) — quaternion multiplication
// vec4 quatNormalize(vec4 q) — normalize quaternion
```

### Step 8.4: 3D Velocity Field in 3D Texture

```glsl
// Evaluate velocity field on a 3D grid and store in a 3D texture (sampler3D).
// Resolution: 64×64×64 (262,144 voxels).
//
// Strategy: render to 2D texture atlas (64 slices of 64×64),
// then copy to 3D texture via gl.texSubImage3D().
//
// Each voxel stores: vec4(u_x, u_y, u_z, 0)
```

### Step 8.5: 3D Vorticity (Vector-Valued)

```glsl
// ω = ∇ × u:
//   ω_x = ∂u_z/∂y - ∂u_y/∂z
//   ω_y = ∂u_x/∂z - ∂u_z/∂x
//   ω_z = ∂u_y/∂x - ∂u_x/∂y
//
// Requires full 3×3 velocity gradient tensor (9 components).
// Use 3 textures or pack into atlas.
```

### Step 8.6: 3D RK4 Advection

Same as 2D but with vec3 positions and mat3 Jacobians. Covector advection uses 3×3 flow Jacobian:

```
Σ^{-1}_new = F^T · Σ^{-1}_old · F    (mat3 operations)
```

Polar decomposition of 3×3 matrix needed for extracting new quaternion and scales.

### Step 8.7: Volume Rendering

Create `shaders/volume_raycast.frag`:

```glsl
// Raycast through the 3D domain:
// 1. For each screen pixel, compute ray origin and direction from camera
// 2. March along ray with fixed step size
// 3. At each sample point, look up vorticity magnitude from 3D texture
// 4. Apply transfer function (map magnitude → color + opacity)
// 5. Front-to-back compositing:
//      color_accum += (1 - alpha_accum) * sample_color * sample_alpha
//      alpha_accum += (1 - alpha_accum) * sample_alpha
// 6. Early ray termination when alpha_accum > 0.99
```

### Step 8.8: 3D Projection Adaptation

The projection step in 3D follows the same structure as 2D but:
- Vorticity is now a 3-vector (3 loss components)
- Weight gradients have 3 components instead of 2
- Scale gradients have 3 components
- Helicity conservation (`h = ω · u`) can be added as an additional loss
- Sample points are on a 3D grid (fewer points needed: 32³ = 32K samples)

### Step 8.9: Verification

- Initialize leapfrog vortex rings — two coaxial rings should pass through each other
- Volume render vorticity magnitude — should show ring structures
- Divergence should remain near zero after projection

---

## 12. Phase 9 — Interactivity

> Make it a true interactive demo.

### Step 9.1: Mouse/Touch Force Injection

```javascript
// On mouse drag:
//   1. Map screen coordinates to domain coordinates
//   2. Compute force direction from mouse velocity (dx, dy)
//   3. Add a temporary "force Gaussian" to the field:
//      - Center at mouse position
//      - Weight proportional to mouse velocity
//      - Scale proportional to brush radius (user-adjustable)
//   4. This effectively injects vorticity into the flow
```

### Step 9.2: Dye Injection

```javascript
// On mouse press:
//   1. Inject colored dye at mouse position into dye texture
//   2. Use a Gaussian splat in the dye injection shader:
//      dye(x) += dyeColor * exp(-|x - mousePos|² / brushRadius²)
//   3. Cycle through hue for each injection (visually distinct)
```

### Step 9.3: GUI Controls

Integrate lightweight UI (dat.gui or custom HTML sliders):

| Control | Parameter | Range |
|---------|-----------|-------|
| Viscosity | `nu` | 0.0 – 0.01 |
| Time step | `dt` | 0.005 – 0.05 |
| Projection iterations | `K` | 1 – 32 |
| Visualization mode | enum | vorticity / velocity / dye / debug |
| Brush radius | float | 0.02 – 0.2 |
| Force strength | float | 0.1 – 10.0 |
| Colormap range | float | auto / manual |
| Pause/Resume | bool | — |
| Reset | button | — |

### Step 9.4: Preset Scenes

```javascript
// Taylor-Green Vortex: periodic counter-rotating vortex array
// Leapfrog Vortices: 4 vortices that pass through each other
// Karman Street: flow past obstacle with vortex shedding
// Free Canvas: blank field, user injects vortices with mouse
// Vortex Collision: two opposite-sign vortices colliding
```

### Step 9.5: Camera Controls (3D)

```javascript
// OrbitControls for 3D mode (already in project dependencies)
// Smooth zoom, rotate, pan
// Optional: preset viewpoints (top, side, perspective)
```

---

## 13. Phase 10 — Polish & Performance

### Step 10.1: Performance Profiling

```javascript
// Use gl.getExtension('EXT_disjoint_timer_query_webgl2')
// Measure per-pass GPU time:
//   - Advection: target < 2ms
//   - Grid build: target < 1ms
//   - Projection (per iteration): target < 3ms
//   - Visualization: target < 2ms
//   - Total frame: target < 16ms (60fps)
```

### Step 10.2: Adaptive Quality

```javascript
// If frame time > 16ms:
//   - Reduce projection iterations (K)
//   - Reduce sample point density
//   - Skip reseeding for this frame
// If frame time < 10ms:
//   - Increase projection iterations for better quality
```

### Step 10.3: Texture Compression

```javascript
// For N < 256 Gaussians, use 16×16 particle textures
// For N < 1024, use 32×32
// For N < 4096, use 64×64
// Minimize texture size to reduce memory bandwidth
```

### Step 10.4: Half-Float Optimization

```javascript
// Where precision allows, use RGBA16F instead of RGBA32F:
//   - Dye texture (visual only — doesn't need high precision)
//   - Visualization output
//   - Grid index texture (use integer texture instead)
// Keep RGBA32F for:
//   - Particle parameters (positions, weights — need precision)
//   - Adam optimizer moments (accumulator precision matters)
```

### Step 10.5: Error Monitoring

```javascript
// Per-frame diagnostics (toggle-able overlay):
//   - Max |∇·u| (divergence — should be < 0.01)
//   - Total |ω| (enstrophy — should be roughly conserved)
//   - Particle count N
//   - Frame time breakdown
//   - GPU memory estimate
```

---

## 14. File Structure

```
Claude-experiments/
├── index.html                          # Main entry (existing, extend)
├── fluid.html                          # Fluid simulation entry point
├── js/
│   ├── main.js                         # Existing terrain demo
│   ├── fluid/
│   │   ├── app.js                      # Main fluid application entry
│   │   ├── simulation/
│   │   │   ├── gaussians.js            # GaussianField class (CPU-side data)
│   │   │   ├── solver.js               # Simulation loop orchestrator
│   │   │   ├── advection.js            # RK4 advection pass management
│   │   │   ├── projection.js           # Projection iteration loop
│   │   │   ├── reseeding.js            # Adaptive split/merge logic
│   │   │   ├── spatial-grid.js         # Grid acceleration structure
│   │   │   └── initial-conditions.js   # Preset flow configurations
│   │   ├── gpu/
│   │   │   ├── context.js              # WebGL 2 setup + extensions
│   │   │   ├── textures.js             # Float texture + FBO management
│   │   │   ├── pass.js                 # GPUPass class (fullscreen quad)
│   │   │   └── shaders.js              # Shader compilation utilities
│   │   ├── rendering/
│   │   │   ├── visualizer.js           # Visualization mode switcher
│   │   │   ├── colormaps.js            # Colormap functions
│   │   │   ├── dye-advection.js        # Passive dye tracer
│   │   │   ├── volume-renderer.js      # 3D raycast renderer
│   │   │   └── debug-overlay.js        # Gaussian ellipses + stats
│   │   └── interaction/
│   │       ├── mouse-force.js          # Mouse → force injection
│   │       ├── gui.js                  # Parameter controls
│   │       └── presets.js              # Scene presets
│   └── lib/
│       └── three.min.js                # (if needed for 3D camera)
├── shaders/
│   ├── common/
│   │   ├── fullscreen.vert             # Fullscreen triangle vertex shader
│   │   ├── gaussian_eval.glsl          # Shared Gaussian math functions
│   │   ├── quaternion.glsl             # Quaternion utilities (3D)
│   │   └── colormaps.glsl              # Shared colormap functions
│   ├── simulation/
│   │   ├── eval_velocity.frag          # Velocity field evaluation
│   │   ├── eval_velocity_grid.frag     # Grid-accelerated velocity eval
│   │   ├── eval_vorticity_div.frag     # Vorticity + divergence eval
│   │   ├── advect_particles.frag       # RK4 particle advection
│   │   ├── advect_covector.frag        # Covector weight advection
│   │   ├── compute_loss_gradients.frag # Analytical loss gradients
│   │   ├── gradient_project.frag       # Gradient projection (MTL)
│   │   ├── adam_update.frag            # Adam optimizer step
│   │   ├── detect_splits.frag          # Anisotropy detection
│   │   └── boundary_loss.frag          # Boundary condition enforcement
│   └── rendering/
│       ├── render_vorticity.frag       # Vorticity colormap
│       ├── render_velocity.frag        # Velocity magnitude colormap
│       ├── advect_dye.frag             # Semi-Lagrangian dye advection
│       ├── inject_dye.frag             # Mouse dye injection
│       ├── render_gaussians.vert       # Instanced Gaussian ellipses
│       ├── render_gaussians.frag       # Gaussian ellipse fragment
│       ├── volume_raycast.frag         # 3D volume rendering
│       └── composite.frag              # Final screen composite
└── plan-fluid-shader.md                # This file
```

---

## 15. Milestones & Verification

### Milestone 1: GPGPU Pipeline (Phase 1)
- [ ] WebGL 2 context with float texture support
- [ ] Fullscreen quad pass working
- [ ] Ping-pong FBO read/write verified
- [ ] Float readback matches CPU computation

### Milestone 2: Static Gaussian Field (Phases 2–3)
- [ ] Gaussians initialized on grid, uploaded to textures
- [ ] Velocity field evaluated on screen — Taylor-Green matches expected pattern
- [ ] Vorticity and divergence computed analytically — values match theory
- [ ] Spatial grid acceleration working — no visual difference from brute force

### Milestone 3: Advection Working (Phase 4)
- [ ] Particles advect correctly in uniform flow
- [ ] Particles follow streamlines in Taylor-Green vortex
- [ ] Covector advection updates shapes correctly
- [ ] Flow Jacobian computed accurately

### Milestone 4: Full Solver Loop (Phases 5–6)
- [ ] Projection reduces divergence measurably
- [ ] Vorticity preserved through advect+project cycle
- [ ] Gradient projection eliminates ripple artifacts
- [ ] Adam optimizer converges in < 16 iterations
- [ ] Reseeding splits elongated Gaussians correctly
- [ ] Simulation runs stably for > 500 time steps

### Milestone 5: Beautiful Visualization (Phase 7)
- [ ] Vorticity colormap renders correctly
- [ ] Dye advection produces smooth, swirling patterns
- [ ] Gaussian debug view shows particle distribution
- [ ] 60fps at 256×256 with 1024 Gaussians

### Milestone 6: 3D Extension (Phase 8)
- [ ] 3D Gaussian evaluation working
- [ ] Leapfrog vortex rings simulated correctly
- [ ] Volume rendering shows vortex structures
- [ ] 30fps at 64³ with 512 Gaussians

### Milestone 7: Interactive Demo (Phases 9–10)
- [ ] Mouse force injection creates visible vortices
- [ ] Dye injection with color cycling
- [ ] GUI controls responsive
- [ ] Preset scenes load correctly
- [ ] Adaptive quality maintains smooth framerate
- [ ] Error diagnostics overlay functional

---

## Appendix A: Key Equations Quick Reference

```
Gaussian:         G_i(x) = exp(-0.5 · (x-μ_i)^T · Σ_i^{-1} · (x-μ_i))
Velocity:         u(x)   = Σ_i w_i · G_i(x)
Grad Gaussian:    ∇G_i   = -Σ_i^{-1} · (x-μ_i) · G_i(x)
Vorticity (2D):   ω      = ∂u_y/∂x - ∂u_x/∂y
Divergence:       ∇·u    = ∂u_x/∂x + ∂u_y/∂y
Covariance:       Σ_i    = R_i · S_i · S_i^T · R_i^T
Inv Covariance:   Σ^{-1} = (R·S)^{-T} · (R·S)^{-1}
Covector Advect:  Σ^{-1}_new = F^T · Σ^{-1}_old · F
Stream Function:  u = J · ∇φ  (2D, exactly div-free)
Gradient Proj:    g' = g_div - (g_div·g_ω / g_ω·g_ω) · g_ω
Adam Update:      p ← p - lr · m̂ / (√v̂ + ε)
```

## Appendix B: Loss Weight Recommendations

From the paper's experiments:

| Loss | Weight | Notes |
|------|--------|-------|
| λ_ω (vorticity) | 1.0 | Primary physics loss |
| λ_div (divergence) | 0.1–1.0 | Increase if div artifacts appear |
| λ_bnd (boundary) | 10.0 | Strong enforcement needed |
| λ_pos (position) | 0.01 | Light regularization |
| λ_aniso (anisotropy) | 0.1 | Prevents extreme elongation |
| λ_vol (volume) | 0.01 | Prevents collapse/explosion |

## Appendix C: Typical Simulation Parameters

| Parameter | 2D Value | 3D Value |
|-----------|----------|----------|
| N (Gaussians) | 576–2400 | 8000–64000 |
| dt | 0.025 | 0.025 |
| Grid cells | 32×32 | 16×16×16 |
| Sample points | 128×128 | 32×32×32 |
| Projection iters (K) | 8–16 | 4–8 |
| r_aniso (split threshold) | 1.5–2.0 | 1.5–2.0 |
| Adam lr | 0.01 | 0.01 |
| Adam β₁ | 0.9 | 0.9 |
| Adam β₂ | 0.999 | 0.999 |

For our **real-time WebGL 2** target, use the lower end of these ranges and scale adaptively.
