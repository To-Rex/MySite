// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchContributions, fetchProfile, fetchRepos } from '@/features/github/api'

/**
 * The GitHub section talks to two public APIs with no token, so it gets sixty
 * requests an hour per visitor and no promise that either answers. What has to
 * hold: one fetch per hour per source, and one source failing never taking the
 * others down with it.
 */

type Reply = { status?: number; body: unknown }

function stubFetch(replies: (url: string) => Reply) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const { status = 200, body } = replies(String(input))
    return new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Error' })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const repo = (id: number) => ({ id, name: `repo-${id}` })

beforeEach(() => sessionStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('caching', () => {
  it('asks GitHub once and serves the session cache afterwards', async () => {
    const fetchMock = stubFetch(() => ({ body: { login: 'To-Rex' } }))
    expect(await fetchProfile()).toEqual({ login: 'To-Rex' })
    expect(await fetchProfile()).toEqual({ login: 'To-Rex' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://api.github.com/users/To-Rex')
  })

  it('asks again once the answer is more than an hour old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'))
    const fetchMock = stubFetch(() => ({ body: { login: 'To-Rex' } }))
    await fetchProfile()
    vi.setSystemTime(new Date('2026-06-15T12:59:00Z'))
    await fetchProfile()
    expect(fetchMock).toHaveBeenCalledOnce()
    vi.setSystemTime(new Date('2026-06-15T13:01:00Z'))
    await fetchProfile()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure', async () => {
    stubFetch(() => ({ status: 403, body: { message: 'rate limit exceeded' } }))
    await expect(fetchProfile()).rejects.toThrow('403')
    const fetchMock = stubFetch(() => ({ body: { login: 'To-Rex' } }))
    expect(await fetchProfile()).toEqual({ login: 'To-Rex' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('repositories', () => {
  it('joins both pages, most recently pushed first as GitHub returns them', async () => {
    const fetchMock = stubFetch((url) => ({ body: url.endsWith('page=1') ? [repo(1), repo(2)] : [repo(3)] }))
    expect((await fetchRepos()).map((r) => r.id)).toEqual([1, 2, 3])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toContain('type=owner')
  })

  it('still shows the first hundred when the second page fails', async () => {
    stubFetch((url) => (url.endsWith('page=1') ? { body: [repo(1)] } : { status: 500, body: {} }))
    expect((await fetchRepos()).map((r) => r.id)).toEqual([1])
  })

  it('fails when the first page does — there is nothing to show', async () => {
    stubFetch((url) => (url.endsWith('page=1') ? { status: 403, body: {} } : { body: [repo(3)] }))
    await expect(fetchRepos()).rejects.toThrow('403')
  })
})

describe('contributions', () => {
  const days = [{ date: '2026-06-15', count: 4, level: 2 }]

  it("reads the rolling year's total", async () => {
    const fetchMock = stubFetch(() => ({ body: { total: { lastYear: 321 }, contributions: days } }))
    expect(await fetchContributions()).toEqual({ total: 321, days })
    expect(String(fetchMock.mock.calls[0]![0])).toBe('https://github-contributions-api.jogruber.de/v4/To-Rex?y=last')
  })

  it('falls back to whatever total the mirror does send', async () => {
    stubFetch(() => ({ body: { total: { '2026': 77 }, contributions: days } }))
    expect((await fetchContributions()).total).toBe(77)
    sessionStorage.clear()
    stubFetch(() => ({ body: { total: {}, contributions: [] } }))
    expect(await fetchContributions()).toEqual({ total: 0, days: [] })
  })
})
