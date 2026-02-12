/**
 * WebGL 2 context initialization and capability detection.
 */

export function initContext(canvas) {
    const gl = canvas.getContext('webgl2', {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
    });

    if (!gl) {
        throw new Error('WebGL 2 not supported');
    }

    // Required: render to float textures
    const extColorFloat = gl.getExtension('EXT_color_buffer_float');
    if (!extColorFloat) {
        throw new Error('EXT_color_buffer_float not supported — cannot render to float textures');
    }

    // Optional: linear filtering on float textures
    const extFloatLinear = gl.getExtension('OES_texture_float_linear');

    // Optional: GPU timer queries for profiling
    const extTimer = gl.getExtension('EXT_disjoint_timer_query_webgl2');

    const caps = {
        maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
        maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
        maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
        floatLinearFiltering: !!extFloatLinear,
        timerQuery: !!extTimer,
    };

    return { gl, caps };
}
