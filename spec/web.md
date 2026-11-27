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
- The skills and an organisation's repositories: lists to select from (`role="listbox"`, each
  `role="option"`, `aria-selected`), with the **keyboard** as with the mouse
  - Tab reaches each list once, on its selected item, else its first; the field, *Scan*, the
    warnings' list if shown, the filter, the skills, the SKILL.md link; in an organisation, after
    *Scan*, the repository's tab's `×` if open, then the organisation's tab's repositories, on the
    one marked, else its first, then the warnings' list if shown, or the repository's tab's
    warnings' list if shown, filter, skills and link
  - ArrowDown, ArrowUp, Home, End move the focus through the list, a visible outline on the item;
    the selection stays until Enter or Space selects the item, as a click; the focus leaving the
    list → Tab comes back to it on the selected item, not the one the arrows left it on
  - ArrowDown in the filter → the focus on the skills, on the selected one
- An **organisation** link, `github.com/<org>`: above the skills, `<org> · N repositories · M skills`,
  its **repositories** in a *column*, one a line, each with its count *next to its name* (`N skills`,
  or `not scanned`), in the CLI's order; no skills until one is selected
  - Repositories scanned with **0 skills** (an empty one too) → *not listed*; `not scanned` ones
    stay; the header's `N repositories` still counts *all* of them, as the CLI's; their warnings stay
  - Every one with 0 skills → no repositories, `<org> · N repositories · 0 skills`; no error
  - While it scans: a **progress bar** under the field, `N of M repositories scanned`, as each
    repository is done; *hidden* once the scan ends, also when it fails; another link entered →
    the earlier scan's progress is not shown
  - **Tabs**, in the page (not the browser's), above the organisation: its own tab, `<org>`, first,
    then the **repository's tab**, `<repo>` and a close button `×`, once one is selected: *one* tab,
    whose contents change to the repository selected; the active one tinted, with an accent bar
    - The organisation's tab: its repositories, as above; no skills, no filter
    - A repository selected → the repository's tab, made active: its skills as for its link, at the
      commit counted, and the filter; that repository marked in the list
    - Each repository opened keeps its own selected skill and filter, and its skills: selected
      again → as it was left, not scanned again; one opened for the first time: no filter
    - While it scans: `Scanning <repo>…`, nothing else but the organisation's warnings; its answer
      is kept, shown only if it is still the active tab's
    - Switching tabs scans nothing again: the organisation's tab shows its repositories as scanned
    - `×` → the repository's tab closed, the organisation's active, nothing scanned, nothing
      forgotten; the organisation's tab cannot be closed
    - Another link entered → the tabs closed, the repositories opened forgotten; a repository link
      has no tabs
  - A repository not listed, in the URL (`repository=<name>`) → the organisation's tab, none
    selected; no error
  - It fails → its message in the repository's tab; the organisation's tab stays, and its
    warnings; selected again → scanned again
  - Unknown organisation → its message, nothing else
- The **errors and warnings** of a scan in their *own area*, apart from the repositories and
  skills: under the tabs and the organisation, above the skills; `N warnings`, then one a line
  - An organisation's: while it is shown, in its tab or a repository's, its repositories' (a failed
    one's too, and those not listed), each as `<name>: <warning>`; else the repository's; none →
    no area
  - In a repository's tab, once its scan is done → its lines are its own scan's warnings,
    `<name>: <warning>`, where its lines were (where they would be in the repositories' order,
    before the cache's, if it had none); a `not scanned` line for it is gone; in the organisation's
    tab, while the repository's scan is under way (the filter used meanwhile too), or it fails →
    the organisation's as they were
  - Its lines found by their place, from each repository's `warnings` (API), not by their text: a
    repository named `cache` selected → its lines replaced, the cache's own `cache: …` stay
  - A *limited height*: the list grows to at most 160px, and scrolls when it doesn't fit; the
    area never grows past its title and that list; Tab reaches the list, so the keyboard scrolls it
- A failed scan → its message, nothing else
  - GitHub that does not answer → after the time limit (`spec/analysis.md`, *Details*), its
    message, `Cannot reach GitHub: no answer in 30 s for <url>`; the button back to `Scan`
  - An answer that is not the API's JSON → `The server answered <status>`, not a parser's error
- The page's URL keeps the link, the skill and the filter: `?repo=<link>&skill=<path>&filter=<words>`,
  the words joined by one space;
  reload shows the same, a failed scan's message too
  - A long link, as long as a browser's URL allows: the same, its scan's message, wrapped in its box,
    on reload too
  - A failed scan keeps `filter=` in the URL, with the failed link; the filter is hidden with the
    skills, and a reload restores its words
  - An organisation: the active tab's: `?repo=github.com/<org>` for the organisation's tab;
    `?repo=github.com/<org>&repository=<name>&skill=<path>&filter=<words>` for a repository's.
    Reload restores the organisation's tab and, with `repository=`, the repository's tab with that
    repository, active, with its skill and filter; the other repositories opened are not kept
## Style
A modern **gradient** style, light and dark as the system's colours:
- The header on a violet-to-pink gradient; the page on a soft gradient
- The organisation, the errors and warnings, the skills and the SKILL.md on rounded *cards*
- A selected skill or repository: a gradient tint and an accent bar; the skill's name in the
  gradient; a repository's count in a pill
- The tabs on rounded cards; the active tab: a gradient tint and an accent bar
## API
`GET /api/scan?repo=<link>[&filter=<words>]` → JSON: `repository`, `skills` (each with its `link`
and `content`, the SKILL.md text), `total` (the count before the filter), `warnings`
- `filter`: only the skills that match every word, as `--filter`; no words → no filter
- No link, a scan that fails, or a malformed request → status 400, `{ "error": <message> }`
  - A request up to *4 MB*, its URL and headers (Node's default: 16 KB), more than a browser's
    URL: a long link → its scan's message; the page's own URL with it → the page
  - Longer → status 400, `{ "error": "The request is too long: at most 4 MB" }`, not a 431
  - A request Node can't parse (a header line without a colon) → status 400,
    `{ "error": "Not a valid request" }`, not Node's empty 400; the server keeps running
- Each file is read once: the page shows the text the scan parsed
- An organisation → JSON: `organisation` (`name`, `url`), `repositories` (each with `name`, `url`,
  `commit`, `skillCount`; `null` for one that failed; `warnings`, its own, without `<name>: `:
  `not scanned: …` for one that failed), `skills` (their sum), `warnings`: each repository's,
  `<name>: <warning>`, in the order of `repositories`, then the cache's
  - *Every* repository, those with 0 skills too: the page leaves them out
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
