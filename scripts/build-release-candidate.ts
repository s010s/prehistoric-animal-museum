import { execFileSync } from 'node:child_process'

// This build prepares a local artifact. It never approves or publishes a draft.
process.env.MUSEUM_RELEASE_CANDIDATE = '1'
const { validateReleaseCandidate } = await import('./release-candidate-quality')
await validateReleaseCandidate()
execFileSync('node',['--import','tsx','scripts/validate-model-previews.ts','--target=production'],{stdio:'inherit',env:process.env})
execFileSync('node',['--import','tsx','scripts/generate-seo-social-cards.ts','--out','.handoff/expansion-12/release-fix/integration/candidate-social'],{stdio:'inherit',env:process.env})
process.argv.push('--mode','release-candidate')
await import('./build-static-site')
execFileSync('node',['--import','tsx','scripts/validate-production-boundary.ts','--release-candidate'],{stdio:'inherit',env:process.env})
