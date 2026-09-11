import { createBackupStream } from './backupArchive'
import { checkBackupCancelled, type BackupOptions } from './backupIO'

let completedFrame: HTMLIFrameElement | undefined

/** Use the application's own SW; no third-party iframe or Blob download fallback. */
export async function downloadBackup(options: BackupOptions = {}): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('BACKUP_SW_UNAVAILABLE')
  checkBackupCancelled(options)
  // The PWA plugin registers after page load; a quick click can get here first.
  // Registering the same URL/scope is idempotent and joins that installation.
  try {
    if (!(await navigator.serviceWorker.getRegistration()))
      await navigator.serviceWorker.register('/sw.js')
  } catch {
    throw new Error('BACKUP_SW_UNAVAILABLE')
  }
  checkBackupCancelled(options)
  // First installation claims clients. Do not force an update/reload during a backup.
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timer)
        navigator.serviceWorker.removeEventListener('controllerchange', changed)
        options.signal?.removeEventListener('abort', aborted)
      }
      const changed = () => {
        cleanup()
        resolve()
      }
      const aborted = () => {
        cleanup()
        reject(options.signal?.reason)
      }
      // A fresh production install precaches the application before claiming
      // clients. Allow slow networks to finish; the user can still cancel.
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error('BACKUP_SW_UNAVAILABLE'))
      }, 60000)
      navigator.serviceWorker.addEventListener('controllerchange', changed, { once: true })
      options.signal?.addEventListener('abort', aborted, { once: true })
      if (navigator.serviceWorker.controller) changed()
    })
  }
  const worker = navigator.serviceWorker.controller
  if (!worker) throw new Error('BACKUP_SW_UNAVAILABLE')
  const { stream, size } = await createBackupStream(options)
  const reader = stream.getReader()
  const channel = new globalThis.MessageChannel()
  const frame = document.createElement('iframe')
  frame.hidden = true
  let delivered = false
  try {
    await new Promise<void>((resolve, reject) => {
      let finished = false
      const finish = (error?: unknown) => {
        if (finished) return
        finished = true
        window.clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
        window.removeEventListener('pagehide', abort)
        if (error) {
          channel.port1.postMessage({ type: 'abort' })
          void reader.cancel(error).catch(() => {})
          reject(error)
        } else resolve()
      }
      const abort = () =>
        finish(options.signal?.reason ?? new globalThis.DOMException('Aborted', 'AbortError'))
      const timer = window.setTimeout(() => finish(new Error('BACKUP_SW_UNAVAILABLE')), 15000)
      options.signal?.addEventListener('abort', abort, { once: true })
      window.addEventListener('pagehide', abort, { once: true })
      channel.port1.onmessage = async ({ data }) => {
        if (finished) return
        try {
          if (data.type === 'ready') {
            if (typeof data.url !== 'string' || !/^\/__backup_download\/[a-f0-9-]+$/.test(data.url))
              throw new Error('BACKUP_SW_PROTOCOL')
            frame.src = data.url
            document.body.append(frame)
          } else if (data.type === 'pull') {
            window.clearTimeout(timer)
            checkBackupCancelled(options)
            const result = await reader.read()
            if (finished) return
            if (result.done) channel.port1.postMessage({ type: 'end' })
            else
              channel.port1.postMessage({ type: 'chunk', bytes: result.value }, [
                result.value.buffer,
              ])
          } else if (data.type === 'complete') finish()
          else if (data.type === 'cancel') abort()
          else throw new Error('BACKUP_SW_PROTOCOL')
        } catch (error) {
          finish(error)
        }
      }
      worker.postMessage({ type: 'FUKUSHU_BACKUP_DOWNLOAD_V1', size }, [channel.port2])
      if (options.signal?.aborted) abort()
    })
    delivered = true
  } finally {
    channel.port1.close()
    channel.port2.close()
    // SW completion means the Response was handed off, not that the browser has
    // emitted its download event. Immediate removal can cancel small downloads.
    // Retire the previous frame only after a subsequent successful export.
    if (delivered) {
      completedFrame?.remove()
      completedFrame = frame
    } else frame.remove()
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
