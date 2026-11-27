# Web view
`./skill-atlas serve [--port <port>]`: a local web page, at `http://localhost:4173` by default
- Listens on *localhost only*; a request for another host name is refused (DNS rebinding)
- The same scan as the CLI: a GitHub URL or a local directory; *nothing is stored*, but an
  organisation's *cache*, the same file as the CLI's (`spec/analysis.md`, *Cache*)
- Stops with Ctrl+C
## The page
- A field for the **repository link**, and a *Scan* button
- The *Scan* button: while a scan runs, *disabled*, `Scanning…`; once the **latest** scan ends,
  `Scan`, enabled again: after a success, a failure, an organisation, a repository opened from an
  organisation
  - The latest: the last link entered, or the last repository of an organisation opened; an
    earlier scan it replaced, ended or still running, does not change the button
  - A repository of the organisation clicked while another link is scanned → nothing
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
  its **repositories** in a *column*, one a line, each with its count *next to its name* (`N skills`,
  or `not scanned`), in the CLI's order, and its warnings; no skills until one is selected
  - While it scans: a **progress bar** under the field, `N of M repositories scanned`, as each
    repository is done; *hidden* once the scan ends, also when it fails; another link entered →
    the earlier scan's progress is not shown
  - A repository selected → its skills as for its link, at the commit counted; the filter as today
  - An empty repository selected → no skills, `No skills in this repository.`, no error; not
    scanned again
  - It fails → its message; the organisation stays
  - Unknown organisation → its message, nothing else
- Warnings, under the skills; a failed scan → its message, nothing else
  - An answer that is not the API's JSON → `The server answered <status>`, not a parser's error
- The page's URL keeps the link, the skill and the filter: `?repo=<link>&skill=<path>&filter=<words>`,
  the words joined by one space;
  reload shows the same, a failed scan's message too
  - A long link, as long as a browser's URL allows: the same, its scan's message, wrapped in its box,
    on reload too
  - A failed scan keeps `filter=` in the URL, with the failed link; the filter is hidden with the
    skills, and a reload restores its words
  - An organisation: `?repo=github.com/<org>&repository=<name>&skill=<path>&filter=<words>`
## Style
A modern **gradient** style, light and dark as the system's colours:
- The header on a violet-to-pink gradient; the page on a soft gradient
- The organisation, the skills and the SKILL.md on rounded *cards*
- A selected skill or repository: a gradient tint and an accent bar; the skill's name in the
  gradient; a repository's count in a pill
## API
`GET /api/scan?repo=<link>[&filter=<words>]` → JSON: `repository`, `skills` (each with its `link`
and `content`, the SKILL.md text), `total` (the count before the filter), `warnings`
- `filter`: only the skills that match every word, as `--filter`; no words → no filter
- No link, a scan that fails, or a malformed request → status 400, `{ "error": <message> }`
  - A request up to *4 MB*, its URL and headers (Node's default: 16 KB), more than a browser's
    URL: a long link → its scan's message; the page's own URL with it → the page
  - Longer → status 400, `{ "error": "The request is too long: at most 4 MB" }`, not a 431
- Each file is read once: the page shows the text the scan parsed
- An organisation → JSON: `organisation` (`name`, `url`), `repositories` (each with `name`, `url`,
  `commit`, `skillCount`; `null` for one that failed), `skills` (their sum), `warnings`
  - With `filter` → status 400; unknown organisation → status 400
  - The same JSON, and the same `stream=1` lines, with a cold or a warm *cache*; a repository
    scanned by the CLI is not fetched again, and the other way round
  - `cache=0`: every repository scanned again, as `--no-cache`; the page does not send it
  - A cache that cannot be used → status 200, at most one of the `warnings`, `cache: …`
- `stream=1`: `application/x-ndjson`, one JSON object a line: `{ "progress": { "scanned", "total" } }`
  as an organisation's repositories are done (0 of N first), then `{ "result": <the JSON above> }`;
  one repository: only the `result`
  - A scan that fails *before* any line → status 400, `{ "error": <message> }`, as without it;
    *after* → status 200, its last line `{ "error": <message> }`
