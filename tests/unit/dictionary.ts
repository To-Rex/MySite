/** Every string in a dictionary, with the path it sits at. */
export type Leaf = { path: string; value: string }

export function leaves(node: unknown, path = ''): Leaf[] {
  if (typeof node === 'string') return [{ path, value: node }]
  if (Array.isArray(node)) return node.flatMap((item, i) => leaves(item, `${path}[${i}]`))
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, path ? `${path}.${key}` : key))
  }
  throw new Error(`unexpected ${typeof node} at ${path}`)
}
