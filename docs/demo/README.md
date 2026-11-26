# Demo: filtering skills by several words

[word-filter.mp4](word-filter.mp4) (54 s): `./skill-atlas serve`, the web view scanning
`https://github.com/JetBrains/kotlin/tree/952b5c52a87032ff268d359fc0e0fafbf3bfc3b4` (7 skills), then the filter field:

| Filter | Shows | Why |
| --- | --- | --- |
| `gradle` | 4 of 7 skills | one word, in the name or the description |
| `gradle bump` | 3 of 7 | every word must match (AND) |
| `BUMP Gradle` | 3 of 7 | any case, any order |
| `gradle wrapper` | 1 of 7 | `wrapper` only appears in the description |
| `gradle wrapper xyz` | 0 of 7, `no skills match "gradle wrapper xyz"` | no match is not an error |
| `test`, then reload | 5 of 7, both times | the URL keeps `filter=` |

The same rule as `./skill-atlas scan <link> --filter "<words>"` ([spec/web.md](../../spec/web.md), [spec/cli.md](../../spec/cli.md)).
