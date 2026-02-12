/**
 * GPUPass — runs a fragment shader over a fullscreen triangle, reading from
 * input textures and writing to an FBO (or screen).
 */

import { linkProgram, FULLSCREEN_VERT } from './shaders.js';

export class GPUPass {
    /**
     * @param {WebGL2RenderingContext} gl
     * @param {string} fragSource — fragment shader GLSL source
     */
    constructor(gl, fragSource) {
        this.gl = gl;
        this.program = linkProgram(gl, FULLSCREEN_VERT, fragSource);
        this._uniformCache = {};
        this._vao = gl.createVertexArray(); // empty VAO for attributeless rendering
    }

    _loc(name) {
        if (!(name in this._uniformCache)) {
            this._uniformCache[name] = this.gl.getUniformLocation(this.program, name);
        }
        return this._uniformCache[name];
    }

    /**
     * Execute the pass.
     * @param {Object} opts
     * @param {WebGLFramebuffer|null} opts.target — FBO to render to (null = screen)
     * @param {number} opts.width — viewport width
     * @param {number} opts.height — viewport height
     * @param {Object<string, {texture, unit}>} opts.textures — input textures
     * @param {Object<string, number|number[]>} opts.uniforms — uniform values
     */
    execute({ target = null, width, height, textures = {}, uniforms = {} }) {
        const gl = this.gl;

        gl.useProgram(this.program);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target);
        gl.viewport(0, 0, width, height);

        // Bind input textures
        let unit = 0;
        for (const [name, tex] of Object.entries(textures)) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(this._loc(name), unit);
            unit++;
        }

        // Set uniforms
        for (const [name, value] of Object.entries(uniforms)) {
            const loc = this._loc(name);
            if (loc === null) continue;
            if (typeof value === 'number') {
                gl.uniform1f(loc, value);
            } else if (Array.isArray(value) || value instanceof Float32Array) {
                switch (value.length) {
                    case 1: gl.uniform1f(loc, value[0]); break;
                    case 2: gl.uniform2fv(loc, value); break;
                    case 3: gl.uniform3fv(loc, value); break;
                    case 4: gl.uniform4fv(loc, value); break;
                }
            }
        }

        // Draw fullscreen triangle (3 vertices, no buffer)
        gl.bindVertexArray(this._vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    setUniformInt(name, value) {
        const gl = this.gl;
        gl.useProgram(this.program);
        gl.uniform1i(this._loc(name), value);
    }
}
