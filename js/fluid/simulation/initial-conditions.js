/**
 * Initial condition functions for the fluid simulation.
 * Each returns [u_x, u_y] given domain coordinates (x, y) in [0, 1]^2.
 */

const TAU = Math.PI * 2;

export function taylorGreen(x, y) {
    const ux =  Math.sin(TAU * x) * Math.cos(TAU * y);
    const uy = -Math.cos(TAU * x) * Math.sin(TAU * y);
    return [ux, uy];
}

export function vortexPair(x, y) {
    // Two counter-rotating Gaussian vortices
    const cx1 = 0.35, cy1 = 0.5, cx2 = 0.65, cy2 = 0.5;
    const sigma = 0.06;
    const gamma = 1.5; // circulation strength

    let ux = 0, uy = 0;
    const vortices = [
        { cx: cx1, cy: cy1, sign:  1.0 },
        { cx: cx2, cy: cy2, sign: -1.0 },
    ];

    for (const v of vortices) {
        const dx = x - v.cx;
        const dy = y - v.cy;
        const r2 = dx * dx + dy * dy;
        const factor = v.sign * gamma * (1 - Math.exp(-r2 / (sigma * sigma))) / (TAU * Math.max(r2, 1e-8));
        ux += -dy * factor;
        uy +=  dx * factor;
    }
    return [ux, uy];
}

export function blank() {
    return [0, 0];
}

export const PRESETS = {
    'taylor-green': taylorGreen,
    'vortex-pair': vortexPair,
    'free': blank,
};
