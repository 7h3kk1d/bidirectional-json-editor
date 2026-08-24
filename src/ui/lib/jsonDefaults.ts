export { defaultForType } from '../../engine'

export function previewOf(node: import('../../engine').JsonView): string {
  switch (node.kind) {
    case 'object':
      return `{…} ${node.entries.length} ${node.entries.length === 1 ? 'key' : 'keys'}`
    case 'array':
      return `[…] ${node.items.length} ${node.items.length === 1 ? 'item' : 'items'}`
    case 'string':
      return JSON.stringify(node.value)
    case 'number':
      return String(node.value)
    case 'boolean':
      return String(node.value)
    case 'null':
      return 'null'
  }
}
