/**
 * Shader compilation and program linking utilities.
 */

export function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compile error:\n${log}\n\nSource:\n${source}`);
    }
    return shader;
}

export function linkProgram(gl, vertSource, fragSource) {
    const vs = compileShader(gl, vertSource, gl.VERTEX_SHADER);
    const fs = compileShader(gl, fragSource, gl.FRAGMENT_SHADER);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error(`Program link error:\n${log}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
}

// Common vertex shader: fullscreen triangle from gl_VertexID (no buffers needed)
export const FULLSCREEN_VERT = `#version 300 es
out vec2 v_uv;
void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    v_uv = vec2(x, y) * 0.5 + 0.5;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
`;
