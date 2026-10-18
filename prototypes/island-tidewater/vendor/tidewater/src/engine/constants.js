// Enum values shared by the CPU-side engine. Numeric values match three.js so
// ported code comparing against THREE.* constants keeps working.

export const StaticDrawUsage = 35044;
export const DynamicDrawUsage = 35048;
export const StreamDrawUsage = 35040;

export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;

export { WebGLCoordinateSystem, WebGPUCoordinateSystem } from './math/Matrix4.js';
export { NoColorSpace, SRGBColorSpace, LinearSRGBColorSpace } from './math/Color.js';
