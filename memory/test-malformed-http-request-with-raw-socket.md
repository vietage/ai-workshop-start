# Send a malformed HTTP request (a header without a colon) with node:net, not node:http

`node:http`'s `request` throws `ERR_INVALID_HTTP_TOKEN` for a header name like `Bad Header`, so it
can't reach the server's `clientError` handler with a bad header. Write the request yourself:

```ts
const socket = connect({ host: '127.0.0.1', port }, () =>
  socket.write(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\nBad Header\r\n\r\n`));
```

and collect the data until `end` (the handler answers with `connection: close`). Split head and
body on the first `\r\n\r\n`.

**Why it matters:** without it the "Not a valid request" branch of `clientError` goes untested; a
regression to Node's empty 400 passes `npm test`.

**Where it applies:** `tests/web.test.ts`, `src/web.ts` (`clientError`). See also
`node-http-431-long-url-maxheadersize-clienterror.md` for the too-long branch.

Learned in #54, 2026-11-27.
