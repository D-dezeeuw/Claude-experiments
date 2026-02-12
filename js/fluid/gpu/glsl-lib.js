/**
 * Shared GLSL function libraries as template strings.
 * Concatenated into fragment shaders that need them.
 */

export const GAUSSIAN_EVAL = `
// --- Gaussian evaluation functions ---

ivec2 gIdx(int i, int texSize) {
    return ivec2(i % texSize, i / texSize);
}

mat2 getInvCovariance(float theta, vec2 logScale) {
    vec2 s_inv = 1.0 / exp(logScale);
    float c = cos(theta), sn = sin(theta);
    mat2 R = mat2(c, sn, -sn, c);
    mat2 S_inv = mat2(s_inv.x, 0.0, 0.0, s_inv.y);
    mat2 RS = R * S_inv;
    return transpose(RS) * RS;
}

float evalGaussian(vec2 x, vec2 mu, mat2 sigmaInv) {
    vec2 d = x - mu;
    return exp(-0.5 * dot(d, sigmaInv * d));
}

vec2 gradGaussian(vec2 d, mat2 sigmaInv, float g) {
    return -(sigmaInv * d) * g;
}
`;

export const COLORMAPS = `
// --- Colormap functions ---

vec3 viridis(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = vec3(0.267, 0.004, 0.329);
    vec3 c1 = vec3(0.282, 0.141, 0.458);
    vec3 c2 = vec3(0.128, 0.567, 0.551);
    vec3 c3 = vec3(0.993, 0.906, 0.144);
    float t2 = t * t;
    float t3 = t2 * t;
    return c0 + (c1 - c0) * t * 4.0 * (1.0 - t) + (c2 - c0) * t2 * 2.0 + (c3 - c2) * t3;
}

vec3 coolwarm(float t) {
    t = clamp(t, -1.0, 1.0);
    vec3 cool = vec3(0.23, 0.30, 0.75);
    vec3 mid  = vec3(0.87, 0.87, 0.87);
    vec3 warm = vec3(0.71, 0.016, 0.15);
    if (t < 0.0) return mix(mid, cool, -t);
    return mix(mid, warm, t);
}

vec3 magma(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = vec3(0.001, 0.0, 0.014);
    vec3 c1 = vec3(0.329, 0.071, 0.537);
    vec3 c2 = vec3(0.784, 0.290, 0.408);
    vec3 c3 = vec3(0.996, 0.992, 0.749);
    if (t < 0.33) return mix(c0, c1, t * 3.0);
    if (t < 0.66) return mix(c1, c2, (t - 0.33) * 3.0);
    return mix(c2, c3, (t - 0.66) * 3.0);
}
`;
