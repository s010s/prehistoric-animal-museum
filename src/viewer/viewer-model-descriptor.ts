export interface ViewerModelDescriptor {
  accessibilityLabel?: string
  id: string
  label: string
  modelUrl: string
  presentation: {
    cameraLightScale?: number
    initialYawDegrees: number
    initialRotationZDegrees?: number
    horizontalOffset?: {
      landscape: number
      portrait: number
    }
    verticalOffset?: {
      landscape: number
      portrait: number
    }
    safeAreaPadding: {
      landscape: number
      portrait: number
    }
    preciseBounds?: boolean
    shadow: {
      depthOffset?: number
      depthScale?: number
      horizontalOffset?: number
      opacity: number
      scale: number
      yOffset?: number
    }
    toneMappingExposure?: number
  }
  animation?: {
    clip: string
    loop: 'repeat' | 'once'
    speed: number
  }
}
