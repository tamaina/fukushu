import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ContentRenderer from '../src/components/ContentRenderer.vue'

describe('ContentRenderer', () => {
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
})
