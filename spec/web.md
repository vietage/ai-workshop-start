# Web view
`./skill-atlas serve [--port <port>]`: a local web page, at `http://localhost:4173` by default
- Listens on *localhost only*; a request for another host name is refused (DNS rebinding)
- The same scan as the CLI: a GitHub URL or a local directory; *nothing is stored*
- Stops with Ctrl+C
## The page
- A field for the **repository link**, and a *Scan* button
- The repository: `<owner>/<repo> · N skills`, its scanned commit
- Its **skills**, sorted by name: name, the description's first sentence, path, `also in` for copies
- A skill selected → its **SKILL.md**, the file as it is, and its link
- Warnings, under the skills; a failed scan → its message, nothing else
- The page's URL keeps the link and the skill: `?repo=<link>&skill=<path>`; reload shows the same,
  a failed scan's message too
## API
`GET /api/scan?repo=<link>` → JSON: `repository`, `skills` (each with its `link` and `content`,
the SKILL.md text), `warnings`
- No link, a scan that fails, or a malformed request → status 400, `{ "error": <message> }`
- Each file is read once: the page shows the text the scan parsed
