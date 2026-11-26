---
id: github-repository
title: Scan a GitHub repository at a commit
spec: spec/web.md#the-page
needs: network
---
# Scan a GitHub repository at a commit

Needs the network; `GITHUB_TOKEN`, if set, raises the GitHub rate limit.

## Steps
1. Scan `https://github.com/JetBrains/koog/tree/709079e4a34d6c9234583352550e6a2b88a0bb85`.
2. Click the first skill.

## Expected
- The header starts with `JetBrains/koog ·`, counts the skills, and shows the commit `709079e4a34d`.
- At least one skill is listed.
- The selected skill's link is
  `https://github.com/JetBrains/koog/blob/709079e4a34d6c9234583352550e6a2b88a0bb85/…/SKILL.md`.
