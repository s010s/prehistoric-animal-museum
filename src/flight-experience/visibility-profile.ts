/** Candidate ranges are metres from the camera. Detailed props retain their existing
 * budgets; separate coarse terrain + same-source canopy fill the distant interval.
 * Apply expanded fog only after BOTH distant layers have valid coverage.
 */
export interface VisibilityProfile { nearPropCellRadius:number;canopyVisible:number;canopyCache:number;terrainVisible:number;fogStart:number;fogEnd:number;cameraFar:number;maxCanopyTiles:number;maxCanopyCandidates:number }
export const VISIBILITY_PROFILES:Readonly<Record<'low'|'balanced',VisibilityProfile>>={
  low:{nearPropCellRadius:4,canopyVisible:3000,canopyCache:3500,terrainVisible:3400,fogStart:1500,fogEnd:2900,cameraFar:4500,maxCanopyTiles:225,maxCanopyCandidates:32768},
  balanced:{nearPropCellRadius:6,canopyVisible:4500,canopyCache:5000,terrainVisible:5000,fogStart:2300,fogEnd:4400,cameraFar:6200,maxCanopyTiles:441,maxCanopyCandidates:49152},
}
