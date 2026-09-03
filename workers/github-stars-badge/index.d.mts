export interface BadgeRequestDependencies {
  cache: Pick<Cache, 'match' | 'put'>
  fetchImpl: typeof fetch
  now: () => number
  waitUntil: (promise: Promise<unknown>) => void
}

export function handleBadgeRequest(
  request: Request,
  dependencies: BadgeRequestDependencies,
): Promise<Response>

declare const worker: {
  fetch(
    request: Request,
    environment: unknown,
    context: { waitUntil: (promise: Promise<unknown>) => void },
  ): Promise<Response>
}

export default worker
