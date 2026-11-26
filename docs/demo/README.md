# Demos

Short videos of features, each recorded from the script next to it by the
[record-demo](../../.agents/skills/record-demo/SKILL.md) skill:

```bash
.agents/skills/record-demo/setup.sh
node .agents/skills/record-demo/record.mjs docs/demo/<slug>.json docs/demo/<slug>.mp4
```

| Video | Script | Shows |
| --- | --- | --- |
| [word-filter.mp4](word-filter.mp4) | [word-filter.json](word-filter.json) | the filter by several words, [#13](https://github.com/vietage/ai-workshop-start/issues/13) |

## word-filter

The web view on `JetBrains/kotlin` at a fixed commit (7 skills), then the CLI:

| Filter | Shows | Why |
| --- | --- | --- |
| `gradle` | 4 of 7 skills | one word, in the name or the description |
| `gradle bump` | 3 of 7 | every word must match (AND) |
| `BUMP Gradle` | 3 of 7 | any case, any order |
| `gradle wrapper` | 1 of 7 | `wrapper` only appears in the description |
| `gradle wrapper xyz` | 0 of 7, `no skills match "gradle wrapper xyz"` | no match is not an error |
| `test`, then reload | 5 of 7, both times | the URL keeps `filter=` |
| `--filter "gradle bump"` in the CLI | `3 of 7 skills` | the same rule ([spec/cli.md](../../spec/cli.md)) |
