// SPDX-License-Identifier: AGPL-3.0-only
// V12 palette and far opening; real-time quadrature is deliberately bounded.
import { Vector3 } from 'three';
const sun = new Vector3(-.25, 0, -.69).normalize().multiplyScalar(Math.cos(Math.PI / 9));
sun.y = Math.sin(Math.PI / 9);
export const MEDIUM = { sigmaT: [.009, .0036, .0024], sigmaS: [.0008, .0011, .0014], sunDirection: sun.toArray(), sunIrradiance: [6.5, 6.2, 5.6], ambientIrradiance: [2.8, 3.1, 3.3].map((v, i) => v * 1.22 * Math.exp([.033, .016, .013][i] * 3)), anisotropy: .8 };
export const FIELD = { sunAngularDiameterDegrees: .53 };

// Preserve resolved film ripples. Atlas resolution controls the field budget,
// not the optical wave footprint shared by the interface and photon source.
export const WAVE_FOOTPRINT = .13505882352941176;
