# Node's http server answers 431 with no body to a URL over 16 KB: maxHeaderSize and clientError

`node:http` counts the request line (the URL) in its header limit, `maxHeaderSize`, 16 KB by
default. A longer request never reaches the handler: Node answers `431 Request Header Fields Too
Large` (or an empty `400` for a malformed one) itself. `createServer({ maxHeaderSize }, …)` raises
it; `server.on('clientError', (error, socket) => socket.end('HTTP/1.1 400 …\r\n\r\n<body>'))` writes
your own answer (`error.code === 'HPE_HEADER_OVERFLOW'` for too long; return on `ECONNRESET` or
`!socket.writable`). `src/web.ts` does both (`MAX_REQUEST`, 4 MB).

To test it, a `node:http` `request` with a path just over the limit gets the answer reliably
(5 runs of 5); `curl` works too. A local path (`/no/such/aaa…`) keeps the test off GitHub.

**Why it matters:** the page's `response.json()` throws `Unexpected end of JSON input` on the empty
body, and a reload of `?repo=<long link>` is a blank page; the handler's own checks never run.

**Where it applies:** `src/web.ts`, `src/web-page.ts` (`failure()`), `tests/web.test.ts`.

Learned in #46, 2026-11-27.
