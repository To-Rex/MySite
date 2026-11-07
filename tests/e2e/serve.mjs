/**
 * Serves `dist/` the way Netlify does: same files, same response headers.
 *
 * The headers are the reason this exists. `vite preview` serves the build with
 * no Content-Security-Policy at all, so a test against it proves nothing about
 * whether production lets the app run — and a CSP that blocks the theme script,
 * the meshing worker or a font does so silently, in production only. This reads
 * the generated `dist/_headers` and applies each block to the paths it names.
 *
 *   node tests/e2e/serve.mjs [port]
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')
const port = Number(process.argv[2] ?? 4321)

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[serve] dist/ is missing — run `npm run build` first')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

/** `_headers`: a path pattern on its own line, then indented `Name: value` lines. */
function parseHeaders(text) {
  const rules = []
  let current = null
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (/^\s/.test(line)) {
      const at = line.indexOf(':')
      if (current && at > 0) current.headers.push([line.slice(0, at).trim(), line.slice(at + 1).trim()])
    } else {
      current = { pattern: line.trim(), headers: [] }
      rules.push(current)
    }
  }
  return rules
}

const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern)

const rules = parseHeaders(readFileSync(join(dist, '_headers'), 'utf8'))

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://${request.headers.host}`)
  const path = pathname.endsWith('/') ? `${pathname}index.html` : pathname
  const file = normalize(join(dist, path))

  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
    return
  }

  response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  for (const rule of rules) {
    if (!matches(rule.pattern, pathname)) continue
    for (const [name, value] of rule.headers) {
      // The one edit: `upgrade-insecure-requests` rewrites every sub-request to
      // https, and this server speaks plain http on localhost. Everything else
      // in the policy is enforced exactly as shipped.
      response.setHeader(name, name.toLowerCase() === 'content-security-policy' ? value.replace(/;?\s*upgrade-insecure-requests/, '') : value)
    }
  }
  createReadStream(file).pipe(response)
}).listen(port, '127.0.0.1', () => {
  console.log(`[serve] dist/ with production headers on http://127.0.0.1:${port}`)
})
