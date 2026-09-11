/* Download Response approach adapted from StreamSaver.js (MIT).
 * Copyright (c) 2016 Jimmy Karl Roland Wärting. See /streamsaver-LICENSE.txt.
 * This variant asks for one chunk per pull instead of eagerly enqueueing messages.
 */
;(() => {
  const pending = new Map()
  const prefix = '/__backup_download/'
  self.addEventListener('message', (event) => {
    const data = event.data
    const port = event.ports[0]
    if (data?.type !== 'FUKUSHU_BACKUP_DOWNLOAD_V1' || !port) return
    event.waitUntil(
      (async () => {
        const client = event.source?.id && (await self.clients.get(event.source.id))
        if (!client || new URL(client.url).origin !== self.location.origin) {
          port.close()
          return
        }
        const path = prefix + crypto.randomUUID()
        let controller
        let settlePull
        let finish
        let finished = false
        const done = new Promise((resolve) => {
          finish = resolve
        })
        const cleanup = () => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          pending.delete(path)
          settlePull?.()
          port.close()
          finish()
        }
        const timer = setTimeout(() => {
          controller?.error(new Error('Download was not started'))
          port.postMessage({ type: 'error' })
          cleanup()
        }, 60000)
        const stream = new ReadableStream(
          {
            start(value) {
              controller = value
            },
            pull() {
              return new Promise((resolve) => {
                settlePull = resolve
                port.postMessage({ type: 'pull' })
              })
            },
            cancel() {
              port.postMessage({ type: 'cancel' })
              cleanup()
            },
          },
          { highWaterMark: 0 },
        )
        port.onmessage = ({ data: message }) => {
          if (finished) return
          if (message.type === 'chunk' && message.bytes instanceof Uint8Array && settlePull) {
            controller.enqueue(message.bytes)
            const resolve = settlePull
            settlePull = undefined
            resolve()
          } else if (message.type === 'end') {
            controller.close()
            port.postMessage({ type: 'complete' })
            cleanup()
          } else {
            controller.error(new Error('Backup download aborted'))
            cleanup()
          }
        }
        const filename = `fukushu-backup-${new Date().toISOString().slice(0, 10)}.fukushu`
        const headers = {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'",
        }
        if (Number.isSafeInteger(data.size) && data.size > 0)
          headers['Content-Length'] = String(data.size)
        pending.set(path, { stream, headers, clientId: client.id, timer })
        port.postMessage({ type: 'ready', url: path })
        await done
      })(),
    )
  })
  self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url)
    if (url.origin !== self.location.origin || !url.pathname.startsWith(prefix)) return
    const entry = pending.get(url.pathname)
    // iframe navigations have no clientId. Their single-use random URL is the
    // capability; ordinary fetches must originate from the initiating client.
    const allowedClient = event.clientId
      ? event.clientId === entry?.clientId
      : event.request.mode === 'navigate' && event.request.destination === 'iframe'
    if (!entry || event.request.method !== 'GET' || !allowedClient) {
      event.respondWith(new Response('Backup download unavailable', { status: 404 }))
      return
    }
    pending.delete(url.pathname)
    clearTimeout(entry.timer)
    event.respondWith(new Response(entry.stream, { headers: entry.headers }))
  })
})()
