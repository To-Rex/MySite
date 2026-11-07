import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The rules the README calls load-bearing, as tests.
 *
 * Every one of them was learned from a failure that produced no error: a static
 * import that tripled the entry bundle, a clock that rewound a scene, a canvas
 * that swallowed clicks, a CSS rule that silently lost half its declarations.
 * None of those break the build or the type check, so nothing but a rule a
 * machine re-reads on every change will catch the next one.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = join(ROOT, 'src')
const THREE_DIR = join(SRC, 'components/three')
const rel = (file: string) => relative(ROOT, file)

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

/** Local specifiers resolve to a file; anything else is a package and stays a name. */
function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/') ? join(SRC, specifier.slice(2)) : specifier.startsWith('.') ? resolve(dirname(from), specifier) : null
  if (!base) return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  throw new Error(`cannot resolve "${specifier}" from ${rel(from)}`)
}

/**
 * What a file pulls in when it is loaded — static imports and re-exports only.
 *
 * `import type` is erased and does not count. A dynamic `import()` does not
 * count either: that is the boundary a lazy chunk sits behind, which is the
 * whole point. With `verbatimModuleSyntax` on, `import { type A } from 'x'` is
 * NOT erased — it survives as a side-effect import — so only a whole-clause
 * `import type` is treated as free.
 */
function staticImports(file: string): string[] {
  const out: string[] = []
  for (const statement of parse(file).statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue
      out.push((statement.moduleSpecifier as ts.StringLiteral).text)
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
      out.push((statement.moduleSpecifier as ts.StringLiteral).text)
    }
  }
  return out
}

/** Everything reachable from `entry` without crossing a dynamic import. */
function closure(entry: string): { files: Map<string, string | null>; packages: Map<string, string> } {
  const files = new Map<string, string | null>([[entry, null]])
  const packages = new Map<string, string>()
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    for (const specifier of staticImports(file)) {
      if (/\.(css|svg|png|woff2?)$/.test(specifier)) continue
      const local = resolveLocal(file, specifier)
      if (!local) {
        if (!packages.has(specifier)) packages.set(specifier, file)
      } else if (!files.has(local)) {
        files.set(local, file)
        queue.push(local)
      }
    }
  }
  return { files, packages }
}

/** The chain of imports that led to `file`, for a failure message worth reading. */
function trail(files: Map<string, string | null>, file: string): string {
  const chain: string[] = []
  for (let at: string | null = file; at; at = files.get(at) ?? null) chain.unshift(rel(at))
  return chain.join(' → ')
}

const isThree = (name: string) => name === 'three' || name.startsWith('three/') || name.startsWith('@react-three/')

describe('lazy 3D', () => {
  it('keeps three.js out of everything the entry loads up front', () => {
    const { files, packages } = closure(join(SRC, 'main.tsx'))
    const leaks = [...packages].filter(([name]) => isThree(name)).map(([name, importer]) => `${name}  ←  ${trail(files, importer)}`)
    // One static import moved the entry from 136 kB to 372 kB.
    expect(leaks, 'three.js reached the entry bundle through a static import').toEqual([])
  })

  it('reaches every scene only through a dynamic import', () => {
    const { files } = closure(join(SRC, 'main.tsx'))
    for (const scene of ['HeroScene.tsx', 'UniverseScene.tsx', 'CompanionTurtle.tsx', 'ValleyScene.tsx', 'Spectacle.tsx', 'Cameo.tsx']) {
      expect(files.has(join(THREE_DIR, scene)), `${scene} is statically imported: ${trail(files, join(THREE_DIR, scene))}`).toBe(false)
    }
    // …while the gates that decide whether they load are in the entry, as intended.
    expect(files.has(join(THREE_DIR, 'Companion.tsx'))).toBe(true)
    expect(files.has(join(THREE_DIR, 'Valley.tsx'))).toBe(true)
  })

  it('keeps the meshing worker free of every package, three.js above all', () => {
    const { files, packages } = closure(join(THREE_DIR, 'creatures.worker.ts'))
    // A worker is its own bundle: anything it imports is shipped a second time.
    expect([...packages.keys()]).toEqual([])
    expect([...files.keys()].map((file) => relative(THREE_DIR, file)).sort()).toEqual(['creatures.ts', 'creatures.worker.ts', 'mascots.ts', 'sdf.ts'])
  })
})

describe('3D scenes', () => {
  const sceneFiles = readdirSync(THREE_DIR)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => join(THREE_DIR, name))

  it('never read the R3F clock', () => {
    // Canvases here are parked with frameloop="never", and R3F resets that clock
    // on the way out and back — or leaves a millisecond timestamp in it. Scenes
    // count their own time forward instead.
    const offenders: string[] = []
    for (const file of sceneFiles) {
      const source = parse(file)
      const visit = (node: ts.Node) => {
        const named =
          (ts.isPropertyAccessExpression(node) && node.name.text === 'clock') ||
          (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText(source) === 'clock')
        if (named) offenders.push(`${rel(file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(offenders).toEqual([])
  })

  it('give each <Canvas> the pointer-events it needs', () => {
    const canvases = new Map<string, string>()
    for (const file of sceneFiles) {
      const source = parse(file)
      const visit = (node: ts.Node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'Canvas') {
          canvases.set(relative(THREE_DIR, file), node.attributes.getText(source))
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect([...canvases.keys()].sort()).toEqual(['CompanionTurtle.tsx', 'HeroScene.tsx', 'UniverseScene.tsx', 'ValleyScene.tsx'])
    const passesClicksThrough = (name: string) => /pointerEvents:\s*'none'/.test(canvases.get(name) ?? '')
    // Full-bleed and fixed: R3F sets pointer-events:auto on its own wrapper, so
    // a `pointer-events-none` on the layer around it is not enough, and the
    // canvas eats every click on the page beneath it.
    expect(passesClicksThrough('CompanionTurtle.tsx')).toBe(true)
    expect(passesClicksThrough('ValleyScene.tsx')).toBe(true)
    // The one canvas whose meshes are meant to be clicked.
    expect(passesClicksThrough('UniverseScene.tsx')).toBe(false)
  })
})

describe('stylesheets', () => {
  const sheets = readdirSync(join(SRC, 'styles'))
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(SRC, 'styles', name))
  const withoutComments = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))

  it('never hand-write -webkit-backdrop-filter', () => {
    // Lightning CSS adds the prefix itself. Given both, it kept the prefixed
    // declaration and dropped the standard one — the only one Chrome and
    // Firefox read — and the glass panels shipped with no blur.
    for (const file of sheets) expect(withoutComments(file), rel(file)).not.toMatch(/-webkit-backdrop-filter/)
  })

  it('have no declaration stranded directly inside a top-level @media', () => {
    // What a rule looks like after a block is pasted into the middle of it:
    //   @media (…) { .a { … }  color: red; }
    // It is not a syntax error, the stray declarations are just dropped — and
    // `.universe-label` lost its cursor, wrapping and transition that way.
    const stranded: string[] = []
    for (const file of sheets) {
      const css = withoutComments(file)
      // Each open block: is it a conditional group at the top level, and the
      // text that sits directly in it (not inside a child block).
      const stack: { group: boolean; line: number; own: string }[] = []
      let prelude = ''
      let line = 1
      for (const char of css) {
        if (char === '\n') line++
        if (char === '{') {
          const head = prelude.trim()
          const insideRule = stack.some((block) => !block.group)
          stack.push({ group: /^@(media|supports|container|layer)\b/.test(head) && !insideRule, line, own: '' })
          prelude = ''
        } else if (char === '}') {
          const block = stack.pop()
          if (block?.group && /(^|;)\s*[-a-z]+\s*:[^;{}]+;?\s*$/i.test(`${block.own}${prelude}`.trim())) {
            stranded.push(`${rel(file)}: block opened on line ${block.line}`)
          }
          prelude = ''
        } else if (char === ';') {
          const top = stack[stack.length - 1]
          if (top) top.own += `${prelude};`
          prelude = ''
        } else {
          prelude += char
        }
      }
      expect(stack, `${rel(file)} has unbalanced braces`).toHaveLength(0)
    }
    expect(stranded).toEqual([])
  })
})
