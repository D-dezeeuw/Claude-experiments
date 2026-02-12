/**
 * GaussianField — manages the Gaussian Spatial Representation on CPU,
 * with texture upload to GPU.
 */

export class GaussianField {
    /**
     * @param {number} nx — grid columns
     * @param {number} ny — grid rows
     */
    constructor(nx, ny) {
        this.nx = nx;
        this.ny = ny;
        this.N = nx * ny;
        this.texSize = Math.ceil(Math.sqrt(this.N));

        // Per-Gaussian arrays
        this.positions  = new Float32Array(this.N * 2);
        this.logScales  = new Float32Array(this.N * 2);
        this.rotations  = new Float32Array(this.N);
        this.weights    = new Float32Array(this.N * 2);

        // GPU textures (created on first upload)
        this.texPosScale  = null;
        this.texRotWeight = null;
    }

    /**
     * Place Gaussians on a regular grid within [0, 1]^2.
     */
    initGrid() {
        const hx = 1 / this.nx;
        const hy = 1 / this.ny;
        const scaleX = Math.log(hx * 0.9);
        const scaleY = Math.log(hy * 0.9);

        for (let j = 0; j < this.ny; j++) {
            for (let i = 0; i < this.nx; i++) {
                const idx = j * this.nx + i;
                this.positions[idx * 2]     = hx * (i + 0.5);
                this.positions[idx * 2 + 1] = hy * (j + 0.5);
                this.logScales[idx * 2]     = scaleX;
                this.logScales[idx * 2 + 1] = scaleY;
                this.rotations[idx] = 0;
                this.weights[idx * 2] = 0;
                this.weights[idx * 2 + 1] = 0;
            }
        }
    }

    /**
     * Fit weights to approximate a target velocity field via Richardson iteration.
     * @param {Function} targetFn — (x, y) => [ux, uy]
     * @param {number} iterations
     */
    fitToField(targetFn, iterations = 40) {
        const N = this.N;
        const targX = new Float32Array(N);
        const targY = new Float32Array(N);

        // Evaluate target at Gaussian centers
        for (let i = 0; i < N; i++) {
            const [ux, uy] = targetFn(this.positions[i * 2], this.positions[i * 2 + 1]);
            targX[i] = ux;
            targY[i] = uy;
        }

        // Precompute Gram matrix G[i][j] = G_j(mu_i)
        const G = new Float32Array(N * N);
        for (let i = 0; i < N; i++) {
            const px = this.positions[i * 2];
            const py = this.positions[i * 2 + 1];
            for (let j = 0; j < N; j++) {
                G[i * N + j] = this._evalGaussianAt(j, px, py);
            }
        }

        // Estimate max eigenvalue for learning rate
        let maxRowSum = 0;
        for (let i = 0; i < N; i++) {
            let s = 0;
            for (let j = 0; j < N; j++) s += G[i * N + j];
            maxRowSum = Math.max(maxRowSum, s);
        }
        const lr = 0.9 / maxRowSum;

        // Zero weights
        this.weights.fill(0);

        // Jacobi iteration
        const dw = new Float32Array(N * 2);
        for (let iter = 0; iter < iterations; iter++) {
            dw.fill(0);
            for (let i = 0; i < N; i++) {
                let sx = 0, sy = 0;
                for (let j = 0; j < N; j++) {
                    const g = G[i * N + j];
                    sx += this.weights[j * 2]     * g;
                    sy += this.weights[j * 2 + 1] * g;
                }
                dw[i * 2]     = lr * (targX[i] - sx);
                dw[i * 2 + 1] = lr * (targY[i] - sy);
            }
            for (let k = 0; k < N * 2; k++) {
                this.weights[k] += dw[k];
            }
        }
    }

    /**
     * Evaluate Gaussian j at point (px, py).
     */
    _evalGaussianAt(j, px, py) {
        const mx = this.positions[j * 2];
        const my = this.positions[j * 2 + 1];
        const lsx = this.logScales[j * 2];
        const lsy = this.logScales[j * 2 + 1];
        const theta = this.rotations[j];

        const sx_inv = 1 / Math.exp(lsx);
        const sy_inv = 1 / Math.exp(lsy);
        const c = Math.cos(theta), s = Math.sin(theta);

        // R * S_inv
        const r00 =  c * sx_inv, r01 = s * sx_inv;
        const r10 = -s * sy_inv, r11 = c * sy_inv;

        // Sigma_inv = (R*S_inv)^T * (R*S_inv)
        const s00 = r00 * r00 + r10 * r10;
        const s01 = r00 * r01 + r10 * r11;
        const s11 = r01 * r01 + r11 * r11;

        const dx = px - mx;
        const dy = py - my;
        const exponent = -0.5 * (s00 * dx * dx + 2 * s01 * dx * dy + s11 * dy * dy);
        return Math.exp(exponent);
    }

    /**
     * Pack data into RGBA textures and upload to GPU.
     * @param {WebGL2RenderingContext} gl
     */
    uploadToGPU(gl) {
        const ts = this.texSize;
        const posScaleData  = new Float32Array(ts * ts * 4);
        const rotWeightData = new Float32Array(ts * ts * 4);

        for (let i = 0; i < this.N; i++) {
            const tx = i % ts;
            const ty = Math.floor(i / ts);
            const idx = (ty * ts + tx) * 4;

            posScaleData[idx]     = this.positions[i * 2];
            posScaleData[idx + 1] = this.positions[i * 2 + 1];
            posScaleData[idx + 2] = this.logScales[i * 2];
            posScaleData[idx + 3] = this.logScales[i * 2 + 1];

            rotWeightData[idx]     = this.rotations[i];
            rotWeightData[idx + 1] = this.weights[i * 2];
            rotWeightData[idx + 2] = this.weights[i * 2 + 1];
            rotWeightData[idx + 3] = 0;
        }

        if (!this.texPosScale) {
            this.texPosScale  = createTex(gl, ts, posScaleData);
            this.texRotWeight = createTex(gl, ts, rotWeightData);
        } else {
            updateTex(gl, this.texPosScale, ts, posScaleData);
            updateTex(gl, this.texRotWeight, ts, rotWeightData);
        }
    }
}

function createTex(gl, size, data) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
}

function updateTex(gl, tex, size, data) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
}
