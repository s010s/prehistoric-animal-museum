import type { Page } from '@playwright/test'

const SOFTWARE_RENDERER_PATTERN =
  /swiftshader|llvmpipe|software rasterizer|microsoft basic render/i
const VERIFIED_HARDWARE_PATTERN =
  /apple|metal|nvidia|geforce|quadro|amd|radeon|intel|iris/i

export interface WebGlHardwareInfo {
  readonly renderer: string
  readonly vendor: string
}

export function isSoftwareWebGlRenderer(renderer: string): boolean {
  return SOFTWARE_RENDERER_PATTERN.test(renderer)
}

export function isHardwareWebGlRenderer(renderer: string): boolean {
  return (
    !isSoftwareWebGlRenderer(renderer) &&
    VERIFIED_HARDWARE_PATTERN.test(renderer)
  )
}

export async function readWebGlHardware(
  page: Page,
): Promise<WebGlHardwareInfo> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const context =
      canvas.getContext('webgl2', { powerPreference: 'high-performance' }) ??
      canvas.getContext('webgl', { powerPreference: 'high-performance' })
    const extension = context?.getExtension('WEBGL_debug_renderer_info')
    const renderer =
      context && extension
        ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL))
        : 'unavailable'
    const vendor =
      context && extension
        ? String(context.getParameter(extension.UNMASKED_VENDOR_WEBGL))
        : 'unavailable'
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    return { renderer, vendor }
  })
}

export async function requireHardwareWebGl(
  page: Page,
): Promise<WebGlHardwareInfo> {
  const hardware = await readWebGlHardware(page)
  if (!isHardwareWebGlRenderer(hardware.renderer)) {
    throw new Error(
      `HARDWARE_WEBGL_REQUIRED: renderer=${hardware.renderer}; vendor=${hardware.vendor}`,
    )
  }
  return hardware
}
