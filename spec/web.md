# Web view
`./skill-atlas serve [--port <port>]`: a local web page, at `http://localhost:4173` by default
- Listens on *localhost only*; a request for another host name is refused (DNS rebinding)
- The same scan as the CLI: a GitHub URL or a local directory; *nothing is stored*
- Stops with Ctrl+C
## The page
- A field for the **repository link**, and a *Scan* button
- The repository: `<owner>/<repo> · N skills`, its scanned commit
- Its **skills**, sorted by name: name, the description's first sentence, path, `also in` for copies
- A **filter** field above the skills: typing narrows them *as you type*, without scanning again,
  by the same rule as `--filter`: its text split on whitespace into words, every word in the name
  or the description, in any order; the header shows `<owner>/<repo> · 2 of 6 skills`
  - No match → no skills, and `no skills match "<words>"`, the words joined by one space; not an
    error
  - The selected skill filtered out → the first one that matches is selected
- A skill selected → its **SKILL.md**, the file as it is, and its link
- An **organisation** link, `github.com/<org>`: above the skills, `<org> · N repositories · M skills`,
  its **repositories** with their counts (`N skills`, or `not scanned`), in the CLI's order, and its
  warnings; no skills until one is selected
  - A repository selected → its skills as for its link, at the commit counted; the filter as today
  - An empty repository selected → no skills, `No skills in this repository.`, no error; not
    scanned again
  - It fails → its message; the organisation stays
  - Unknown organisation → its message, nothing else
- Warnings, under the skills; a failed scan → its message, nothing else
- The page's URL keeps the link, the skill and the filter: `?repo=<link>&skill=<path>&filter=<words>`,
  the words joined by one space;
  reload shows the same, a failed scan's message too
  - After a failed scan, changing the filter still updates `filter=`, with the failed link
  - An organisation: `?repo=github.com/<org>&repository=<name>&skill=<path>&filter=<words>`
## API
`GET /api/scan?repo=<link>[&filter=<words>]` → JSON: `repository`, `skills` (each with its `link`
and `content`, the SKILL.md text), `total` (the count before the filter), `warnings`
- `filter`: only the skills that match every word, as `--filter`; no words → no filter
- No link, a scan that fails, or a malformed request → status 400, `{ "error": <message> }`
- Each file is read once: the page shows the text the scan parsed
- An organisation → JSON: `organisation` (`name`, `url`), `repositories` (each with `name`, `url`,
  `commit`, `skillCount`; `null` for one that failed), `skills` (their sum), `warnings`
  - With `filter` → status 400; unknown organisation → status 400
