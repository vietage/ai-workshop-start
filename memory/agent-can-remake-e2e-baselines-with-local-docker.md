# An agent can remake the e2e screenshot baselines itself: start dockerd, `npm run e2e -- --update-snapshots`

Corrects `web-layout-change-breaks-e2e-screenshot-baselines.md` ("an agent can't remake them").
In the Air sandbox `docker` is installed but no daemon runs (`/var/run/docker.sock` missing). Start it:

```bash
(sudo dockerd > /tmp/dockerd.log 2>&1 &); sleep 8; sudo chmod 666 /var/run/docker.sock
export GITHUB_TOKEN=$(gh auth token)   # github-repository scenario
npm run e2e -- --update-snapshots      # same mcr.microsoft.com/playwright:v<ver>-noble image as CI
npm run e2e                            # a second run against them must pass, as the workflow does
```

The image is the one `qa/e2e.ts` uses on CI (linux/amd64), so the pixels match CI's. Look at a
couple of the PNGs before committing them.

**Why it matters:** without it a restyle PR waits on a person to run *Update screenshots*.

**Where it applies:** any change to `src/web-page.ts`; address-review on a red `e2e` job.

Learned in #61, 2026-11-27.
