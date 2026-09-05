/** Remove blank boundary lines without touching interior breaks or preformatted code. */
export function trimContentEdges(root: HTMLElement): void {
  function trim(parent: Node, start: boolean) {
    for (;;) {
      const node = start ? parent.firstChild : parent.lastChild
      if (!node) return
      if (node.nodeType === 3) {
        const value = node.textContent ?? ''
        if (!value.trim()) {
          parent.removeChild(node)
          continue
        }
        node.textContent = start
          ? value.replace(/^(?:[\t ]*\r?\n)+/, '')
          : value.replace(/(?:\r?\n[\t ]*)+$/, '')
        return
      }
      if (node.nodeType === 8 || node.nodeName === 'BR') {
        parent.removeChild(node)
        continue
      }
      if (/^(DIV|P|SPAN|B|STRONG|I|EM)$/.test(node.nodeName)) {
        trim(node, start)
        if (!node.hasChildNodes()) {
          parent.removeChild(node)
          continue
        }
      }
      return
    }
  }
  trim(root, true)
  trim(root, false)
}
