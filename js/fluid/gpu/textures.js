/**
 * Float texture creation, FBO management, and ping-pong pairs.
 */

export function createFloatTexture(gl, width, height, data = null) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
}

export function createHalfFloatTexture(gl, width, height, data = null) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
}

export function createFBO(gl, texture) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
}

export function createMRTFBO(gl, textures) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const drawBuffers = [];
    for (let i = 0; i < textures.length; i++) {
        const attachment = gl.COLOR_ATTACHMENT0 + i;
        gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, textures[i], 0);
        drawBuffers.push(attachment);
    }
    gl.drawBuffers(drawBuffers);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`MRT Framebuffer incomplete: 0x${status.toString(16)}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
}

/**
 * Ping-pong pair: two textures + FBOs for iterative GPU computation.
 * read() returns current read texture, write() returns current write FBO.
 * swap() flips them.
 */
export class PingPong {
    constructor(gl, width, height, useHalfFloat = false) {
        this.gl = gl;
        this.width = width;
        this.height = height;
        const create = useHalfFloat ? createHalfFloatTexture : createFloatTexture;
        this.texA = create(gl, width, height);
        this.texB = create(gl, width, height);
        this.fboA = createFBO(gl, this.texA);
        this.fboB = createFBO(gl, this.texB);
        this._flip = false;
    }

    /** Texture to read from (bind as sampler input). */
    get read() { return this._flip ? this.texB : this.texA; }

    /** FBO to write to (bind as render target). */
    get writeFBO() { return this._flip ? this.fboA : this.fboB; }

    /** Texture attached to the write FBO (for chaining). */
    get writeTexture() { return this._flip ? this.texA : this.texB; }

    swap() { this._flip = !this._flip; }

    upload(data) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.read);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, data);
        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    readback() {
        const gl = this.gl;
        const buf = new Float32Array(this.width * this.height * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._flip ? this.fboB : this.fboA);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, buf);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return buf;
    }
}

export function uploadToTexture(gl, texture, width, height, data) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

export function readbackTexture(gl, fbo, width, height) {
    const buf = new Float32Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
}
