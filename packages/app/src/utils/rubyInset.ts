const originalPadding = new WeakMap<HTMLElement, { value: string; priority: string }>()

/** Reserve only the space that visible ruby annotations borrow from the top padding. */
export function fitLeadingRuby(body: HTMLElement): void {
  const view = body.ownerDocument.defaultView
  if (!view) return
  let original = originalPadding.get(body)
  if (!original) {
    original = {
      value: body.style.getPropertyValue('padding-top'),
      priority: body.style.getPropertyPriority('padding-top'),
    }
    originalPadding.set(body, original)
  }
  body.style.removeProperty('padding-top')
  if (original.value) body.style.setProperty('padding-top', original.value, original.priority)
  const padding = parseFloat(view.getComputedStyle(body).paddingTop) || 0
  const edge = body.getBoundingClientRect().top + padding
  let top = edge
  for (const annotation of body.querySelectorAll('ruby rt')) {
    const rect = annotation.getBoundingClientRect()
    if (rect.width && rect.height && view.getComputedStyle(annotation).visibility === 'visible')
      top = Math.min(top, rect.top)
  }
  if (edge - top > 0.5)
    body.style.setProperty('padding-top', `${padding + Math.ceil(edge - top)}px`, 'important')
}
