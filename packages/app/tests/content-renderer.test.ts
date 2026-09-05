import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ContentRenderer from '../src/components/ContentRenderer.vue'

describe('ContentRenderer', () => {
  it('trims boundary blank lines but preserves indentation and internal line breaks', () => {
    const wrapper = mount(ContentRenderer, {
      props: { content: { format: 'plain', value: '\n\n  first\n\nsecond\n \n' } },
    })
    expect(wrapper.find('.plain-content').element.textContent).toBe('  first\n\nsecond')
  })
  it('removes boundary HTML breaks and empty paragraphs without changing code or interior breaks', () => {
    const wrapper = mount(ContentRenderer, {
      props: {
        content: {
          format: 'html',
          value: '\n<p><br></p><div><br><b>first</b><br>second<br></div><p><br></p>\n',
        },
      },
    })
    expect(wrapper.find('.rich-content').element.innerHTML).toBe(
      '<div><b>first</b><br>second</div>',
    )
    const code = mount(ContentRenderer, {
      props: { content: { format: 'html', value: '<pre><code>\n  code\n</code></pre>' } },
    })
    expect(code.find('pre').element.textContent).toBe('\n  code\n')
  })
  it('renders inline and display LaTeX in plain GIFT content', () => {
    const wrapper = mount(ContentRenderer, {
      props: {
        content: {
          format: 'plain',
          value: 'Inline \\(x^2\\) and display \\[\\frac{1}{2}\\]',
        },
      },
    })
    expect(wrapper.findAll('.katex')).toHaveLength(2)
    expect(wrapper.find('.katex-display').exists()).toBe(true)
  })

  it('sanitizes rich content before rendering math', () => {
    const wrapper = mount(ContentRenderer, {
      props: {
        content: {
          format: 'html',
          value: '<script>alert(1)</script><b>Safe \\(a+b\\)</b>',
        },
      },
    })
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('b .katex').exists()).toBe(true)
  })

  it('renders embedded media without loading remote media', () => {
    const wrapper = mount(ContentRenderer, {
      props: {
        content: {
          format: 'html',
          value:
            '<img src="https://example.com/tracker.png"><img src="data:image/png;base64,iVBORw0KGgo=">',
        },
      },
    })
    expect(wrapper.find('img[src^="https:"]').exists()).toBe(false)
    expect(wrapper.find('.missing-media').text()).toContain('tracker.png')
    expect(wrapper.find('img[src^="data:image/png"]').exists()).toBe(true)
  })
})
