import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestPersistentStorage } from '../src/utils/persistentStorage'

const originalStorage = navigator.storage

afterEach(() => {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: originalStorage,
  })
})

describe('requestPersistentStorage', () => {
  it('requests persistent browser storage', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist },
    })

    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })

  it('does not interrupt import when persistence is unavailable or rejected', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: undefined,
    })
    await expect(requestPersistentStorage()).resolves.toBe(false)

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { persist: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })
})
