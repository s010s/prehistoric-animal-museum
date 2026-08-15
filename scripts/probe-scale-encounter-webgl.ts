import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import {
  isHardwareWebGlRenderer,
  readWebGlHardware,
} from '../e2e/support/webgl-hardware'

type ProbeChannel = 'chrome' | 'chromium'

const requestedChannel =
  process.argv.find((argument) => argument.startsWith('--channel='))?.split(
    '=',
  )[1] ?? 'chromium'
const headless = !process.argv.includes('--headed')

if (requestedChannel !== 'chromium' && requestedChannel !== 'chrome') {
  throw new Error(`Unsupported probe channel: ${requestedChannel}`)
}
const channel: ProbeChannel = requestedChannel
const output = path.resolve(
  process.env.SCALE_ENCOUNTER_GPU_PROBE_OUTPUT ??
    `.handoff/scale-encounter-ecology-density-experiment-2026-08-14/gpu-probe-${channel}.json`,
)

await mkdir(path.dirname(output), { recursive: true })

const browser = await chromium.launch({ channel, headless })
let exitCode: 0 | 2
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const hardware = await readWebGlHardware(page)
  const accepted = isHardwareWebGlRenderer(hardware.renderer)
  await writeFile(
    output,
    `${JSON.stringify(
      {
        accepted,
        browserVersion: browser.version(),
        channel,
        generatedAt: new Date().toISOString(),
        headless,
        ...hardware,
      },
      null,
      2,
    )}\n`,
  )
  console.log(
    `${accepted ? 'HARDWARE_WEBGL_OK' : 'HARDWARE_WEBGL_REJECTED'} ${hardware.renderer}`,
  )
  exitCode = accepted ? 0 : 2
  await context.close()
} finally {
  await browser.close()
}

process.exitCode = exitCode
