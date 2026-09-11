import { expect, test } from '@playwright/test'

test('offline SW downloads are single-use, uncached and propagate cancellation', async ({
  page,
  context,
}) => {
  await page.goto('/settings')
  await page.waitForFunction(() => navigator.serviceWorker.controller)
  await context.setOffline(true)
  const result = await page.evaluate(async () => {
    const channel = new MessageChannel()
    let pulls = 0
    let cancelled!: () => void
    const cancellation = new Promise<void>((resolve) => {
      cancelled = resolve
    })
    const url = await new Promise<string>((resolve) => {
      channel.port1.onmessage = ({ data }) => {
        if (data.type === 'ready') resolve(data.url)
        if (data.type === 'pull') {
          pulls++
          // Leave a pull outstanding: no further pull should arrive until answered.
          if (pulls === 1) channel.port1.postMessage({ type: 'chunk', bytes: new Uint8Array([42]) })
        }
        if (data.type === 'cancel') cancelled()
      }
      navigator.serviceWorker.controller!.postMessage({ type: 'FUKUSHU_BACKUP_DOWNLOAD_V1' }, [
        channel.port2,
      ])
    })
    const beforeFetch = pulls
    const response = await fetch(url)
    const reader = response.body!.getReader()
    const first = await reader.read()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const waitingPulls = pulls
    const replay = await fetch(url)
    await reader.cancel()
    await cancellation
    channel.port1.close()
    const cachesContainingDownload = await Promise.all(
      (await caches.keys()).map(async (key) => Boolean(await (await caches.open(key)).match(url))),
    )
    return {
      beforeFetch,
      waitingPulls,
      byte: first.value![0],
      replay: replay.status,
      cache: response.headers.get('Cache-Control'),
      disposition: response.headers.get('Content-Disposition'),
      cached: cachesContainingDownload.some(Boolean),
    }
  })
  expect(result).toMatchObject({
    beforeFetch: 0,
    waitingPulls: 2,
    byte: 42,
    replay: 404,
    cache: 'no-store',
    cached: false,
  })
  expect(result.disposition).toContain('attachment;')
})

test('saving starts SW installation when the PWA registration is still pending', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = ServiceWorkerContainer.prototype.register
    let first: ((registration: ServiceWorkerRegistration) => void) | undefined
    ServiceWorkerContainer.prototype.register = async function (url, options) {
      if (!first)
        return new Promise<ServiceWorkerRegistration>((resolve) => {
          first = resolve
        })
      const registration = await original.call(this, url, options)
      first(registration)
      return registration
    }
  })
  await page.goto('/settings')
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'バックアップを保存' }).click()
  const file = await pending
  await file.saveAs(test.info().outputPath('first-install.fukushu'))
  expect(await file.failure()).toBeNull()
  await expect(page.getByRole('button', { name: 'バックアップを保存' })).toBeEnabled()
})

test('small downloads survive stream completion and repeated exports', async ({ page }) => {
  await page.goto('/settings')
  for (let index = 0; index < 10; index++) {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'バックアップを保存' }).click()
    const file = await pending
    await file.saveAs(test.info().outputPath(`small-${index}.fukushu`))
    expect(await file.failure()).toBeNull()
    await expect(page.getByRole('button', { name: 'バックアップを保存' })).toBeEnabled()
  }
  await expect(page.locator('iframe[src^="/__backup_download/"]')).toHaveCount(1)
})
