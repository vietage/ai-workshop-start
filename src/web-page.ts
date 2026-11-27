// The web view's one page: plain HTML, CSS and a script, no build step. Everything from the scan
// is put in with textContent, never as HTML.
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skill Atlas</title>
<style>
  /* A modern gradient style: a violet-to-pink header, cards on a soft gradient, gradient accents. */
  :root {
    color-scheme: light dark;
    --gradient: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%);
    --page: linear-gradient(160deg, #eef2ff 0%, #faf5ff 50%, #fdf2f8 100%);
    --card: #ffffffd9; --text: #1e1b4b; --muted: #6b6b8a; --border: #6366f126;
    --accent: #7c3aed; --selected: linear-gradient(90deg, #6366f11f, #ec48990f);
    --shadow: 0 1px 2px #1e1b4b0f, 0 8px 24px #4c1d9514; --warning: #b45309;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page: linear-gradient(160deg, #0f0c29 0%, #1e1b4b 55%, #3b0a33 100%);
      --card: #1b1838d9; --text: #ede9fe; --muted: #a5a3c7; --border: #a78bfa2e;
      --accent: #a78bfa; --selected: linear-gradient(90deg, #8b5cf633, #ec48991f);
      --shadow: 0 1px 2px #0006, 0 8px 24px #0005; --warning: #fbbf24;
    }
  }
  * { box-sizing: border-box; }
  /* Hidden means not shown, whatever display a rule below gives the element. */
  [hidden] { display: none !important; }
  body { margin: 0; min-height: 100vh; font: 15px/1.5 system-ui, sans-serif; color: var(--text); background: var(--page); background-attachment: fixed; }
  header { padding: 20px 24px 22px; background: var(--gradient); color: white; box-shadow: 0 4px 20px #6d28d933; }
  h1 { margin: 0 0 12px; font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
  form { display: flex; gap: 8px; }
  input { flex: 1; padding: 9px 12px; font: inherit; border: 1px solid var(--border); border-radius: 10px; background: var(--card); color: inherit; }
  input:focus { outline: 2px solid #a78bfa; outline-offset: 1px; }
  header input { border-color: #ffffff59; background: #ffffff26; color: white; }
  header input::placeholder { color: #ffffffb3; }
  header input:focus { outline-color: white; }
  button { padding: 9px 20px; font: inherit; font-weight: 600; border: 0; border-radius: 10px; background: white; color: #6d28d9; cursor: pointer; box-shadow: 0 2px 8px #1e1b4b33; }
  button:hover { background: #f5f3ff; }
  button:disabled { opacity: .7; cursor: default; }
  #progress { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 13px; color: #ffffffd9; }
  #progress-bar { flex: 1; max-width: 420px; height: 8px; accent-color: white; }
  main { display: grid; grid-template-columns: minmax(260px, 380px) 1fr; gap: 16px; padding: 16px 24px 24px; min-height: calc(100vh - 110px); }
  #list, #skill, #organisation, #problems { background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); }
  #list { overflow: auto; align-self: start; }
  #summary { padding: 14px 16px 10px; color: var(--muted); }
  #summary strong { color: var(--text); }
  #filter { display: block; width: calc(100% - 32px); margin: 0 16px 12px; padding: 7px 12px; }
  #no-match { margin: 0; padding: 10px 16px; border-top: 1px solid var(--border); color: var(--muted); }
  #no-match:empty { display: none; }
  #skills { list-style: none; margin: 0; padding: 0; }
  #skills li { padding: 10px 16px; border-top: 1px solid var(--border); cursor: pointer; }
  #skills li:hover { background: #8b5cf60f; }
  #skills li[aria-selected="true"] { background: var(--selected); box-shadow: inset 3px 0 var(--accent); }
  .name { font-weight: 600; }
  .description { font-size: 13px; }
  .path, .copies { font-size: 12px; color: var(--muted); font-family: ui-monospace, monospace; word-break: break-all; }
  #organisation { margin: 16px 24px 0; padding: 14px 16px; }
  #org-summary { color: var(--muted); margin-bottom: 10px; }
  #org-summary strong { color: var(--text); }
  /* The repositories in a column, one a line: its name, and its count right next to it. */
  #repositories { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-width: 560px; max-height: 30vh; overflow: auto; }
  #repositories li { display: flex; align-items: baseline; gap: 8px; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  #repositories li:hover { background: #8b5cf60f; }
  #repositories li[aria-selected="true"] { background: var(--selected); box-shadow: inset 3px 0 var(--accent); }
  #repositories .count { padding: 0 8px; border-radius: 999px; font-size: 12px; color: var(--muted); background: #8b5cf61a; white-space: nowrap; }
  /* The scan's errors and warnings, apart from the repositories and skills: a limited height, scrolled when they don't fit. */
  #problems { margin: 16px 24px 0; padding: 10px 16px 12px; }
  #problems h2 { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--warning); }
  #warnings { margin: 0; padding: 0 0 0 16px; font-size: 13px; line-height: 20px; color: var(--warning); max-height: 160px; overflow: auto; overscroll-behavior: contain; }
  #error { margin: 16px 24px; padding: 10px 14px; border-radius: 10px; background: #e11d4822; color: #e11d48; white-space: pre-wrap; }
  #error:empty { display: none; }
  #skill { padding: 18px 24px; overflow: auto; min-width: 0; }
  #skill h2 { margin: 0 0 4px; font-size: 18px; background: var(--gradient); -webkit-background-clip: text; background-clip: text; color: transparent; width: fit-content; }
  #skill a { font-size: 13px; word-break: break-all; color: var(--accent); }
  #content { margin: 12px 0 0; padding: 14px; border: 1px solid var(--border); border-radius: 10px; background: #8b5cf608; font: 13px/1.5 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
  .placeholder { color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>Skill Atlas</h1>
  <form id="form">
    <input id="repo" name="repo" placeholder="https://github.com/owner/repo, …/tree/<commit>, https://github.com/organisation, or a local directory" autocomplete="off" required>
    <button id="scan" type="submit">Scan</button>
  </form>
  <div id="progress" hidden>
    <progress id="progress-bar" aria-label="Repositories scanned" value="0" max="1"></progress>
    <span id="progress-text"></span>
  </div>
</header>
<section id="organisation" hidden>
  <div id="org-summary"></div>
  <ul id="repositories" role="listbox"></ul>
</section>
<div id="error" role="alert"></div>
<section id="problems" aria-labelledby="problems-title" hidden>
  <h2 id="problems-title"></h2>
  <ul id="warnings" tabindex="0" aria-label="Errors and warnings"></ul>
</section>
<main id="main" hidden>
  <section id="list">
    <div id="summary"></div>
    <input id="filter" type="search" placeholder="Filter by name or description" aria-label="Filter skills" autocomplete="off">
    <p id="no-match"></p>
    <ul id="skills" role="listbox"></ul>
  </section>
  <section id="skill"><p class="placeholder">Select a skill to see its SKILL.md.</p></section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
// The scan shown (undefined after a failed one), the link last scanned, and the selected skill's path.
let result;
let scanned;
let selected;
// The organisation shown, when the link is one, and the name of its selected repository.
let organisation;
let repository;
// The latest scan of a link entered: only its progress is shown.
let scanning;
// Scans under way: the Scan button waits for all of them.
let pending = 0;
const plural = (count, one, many) => count + ' ' + (count === 1 ? one : many);

// The same rule as filterSkills in src/core/model.ts: the name or the description contains every
// word, each in any case, in any order.
const matches = (skill, words) =>
  words.every((word) => [skill.name, skill.description].some((text) => text.toLowerCase().includes(word.toLowerCase())));
// The filter's words, split on whitespace, joined by one space: '' without a word.
const filterWords = () => $('filter').value.split(/\\s+/).filter(Boolean).join(' ');

function setUrl(repo, skill) {
  const params = new URLSearchParams();
  if (repo) params.set('repo', repo);
  if (organisation && repository) params.set('repository', repository);
  if (skill) params.set('skill', skill);
  if (filterWords()) params.set('filter', filterWords());
  const query = params.toString();
  history.replaceState(null, '', query ? '?' + query : location.pathname);
}

/** The scan of a link: the API's answer, or its message as an error. */
async function request(link) {
  const response = await fetch('/api/scan?repo=' + encodeURIComponent(link));
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}

/**
 * The same, streamed: \`progress(scanned, total)\` as an organisation's repositories are done, then
 * the answer; one JSON object a line.
 */
async function requestWithProgress(link, progress) {
  const response = await fetch('/api/scan?stream=1&repo=' + encodeURIComponent(link));
  if (!response.ok) throw new Error((await response.json()).error);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const lines = buffered.split('\\n');
    buffered = done ? '' : lines.pop();
    for (const line of lines.filter(Boolean)) {
      const body = JSON.parse(line);
      if (body.error !== undefined) throw new Error(body.error);
      if (body.result) return body.result;
      progress(body.progress.scanned, body.progress.total);
    }
    if (done) throw new Error('The scan ended without an answer');
  }
}

/** The progress bar: \`N of M repositories scanned\`; hidden without a total. */
function showProgress(scanned, total) {
  $('progress').hidden = total === undefined;
  if (total === undefined) return;
  $('progress-bar').max = Math.max(total, 1);
  $('progress-bar').value = total === 0 ? 1 : scanned;
  $('progress-text').textContent = scanned + ' of ' + plural(total, 'repository', 'repositories') + ' scanned';
}

/** Runs a scan with the Scan button disabled until every scan under way is done. */
async function busy(work) {
  pending++;
  $('scan').disabled = true;
  $('scan').textContent = 'Scanning…';
  try {
    await work();
  } finally {
    if (--pending === 0) {
      $('scan').disabled = false;
      $('scan').textContent = 'Scan';
    }
  }
}

/** A link entered: a repository, or an organisation and, if \`name\` is one of them, that repository. */
function scan(repo, skill, name) {
  // This scan, to tell it from a later one of the same link.
  const current = {};
  return busy(async () => {
    $('error').textContent = '';
    scanned = repo;
    scanning = current;
    organisation = undefined;
    repository = undefined;
    showProgress();
    try {
      // The whole repository: the filter narrows it here, as you type, without scanning again.
      // An organisation: the progress bar while its repositories are scanned.
      const body = await requestWithProgress(repo, (done, total) => scanning === current && showProgress(done, total));
      if (scanning !== current) return;
      showProgress();
      if (body.organisation) {
        organisation = body;
        result = undefined;
        showOrganisation();
        if (organisation.repositories.some((entry) => entry.name === name)) return await openRepository(name, skill);
        $('main').hidden = true;
        setUrl(repo);
        return;
      }
      $('organisation').hidden = true;
      result = body;
      show(skill);
    } catch (error) {
      if (scanning !== current) return;
      showProgress();
      failed(error);
    }
  });
}

/** A failed scan: its message, nothing else; the organisation stays when one of its repositories failed. */
function failed(error) {
  result = undefined;
  setUrl(scanned);
  $('organisation').hidden = !organisation;
  $('main').hidden = true;
  $('error').textContent = error.message;
  showWarnings();
}

/**
 * The scan's errors and warnings, in their own area: the organisation's while one is shown (they
 * include each repository's), else the repository's; none after a failed scan of a link.
 */
function showWarnings() {
  const warnings = organisation ? organisation.warnings : result ? result.warnings : [];
  $('problems').hidden = !warnings.length;
  $('problems-title').textContent = plural(warnings.length, 'warning', 'warnings');
  $('warnings').replaceChildren(...warnings.map((warning) => element('li', '', warning)));
}

/** The organisation: its repositories, each with its skill count; its warnings apart. */
function showOrganisation() {
  const { organisation: owner, repositories, skills } = organisation;
  $('organisation').hidden = false;
  $('org-summary').replaceChildren(
    element('strong', '', owner.name),
    ' · ' + plural(repositories.length, 'repository', 'repositories') + ' · ' + plural(skills, 'skill', 'skills'),
  );
  $('repositories').replaceChildren(...repositories.map((entry) => {
    const item = element('li');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.dataset.name = entry.name;
    const count = entry.skillCount === null ? 'not scanned' : plural(entry.skillCount, 'skill', 'skills');
    item.append(element('span', 'name', entry.name), element('span', 'count', count));
    item.addEventListener('click', () => busy(() => openRepository(entry.name)));
    return item;
  }));
  showWarnings();
}

/** One repository of the organisation: its skills, as for a repository link, at the commit counted. */
async function openRepository(name, skill) {
  const entry = organisation.repositories.find((candidate) => candidate.name === name);
  repository = name;
  for (const item of $('repositories').children) item.setAttribute('aria-selected', String(item.dataset.name === name));
  $('error').textContent = '';
  // Empty, without a commit: nothing to scan, and no skills, as its count says.
  if (!entry.commit && entry.skillCount === 0) {
    result = { repository: { id: entry.url.replace('https://github.com/', '') }, skills: [], total: 0, warnings: [] };
    return show(skill);
  }
  const current = organisation;
  try {
    const body = await request(entry.commit ? entry.url + '/tree/' + entry.commit : entry.url);
    if (organisation !== current || repository !== name) return;
    result = body;
    show(skill);
  } catch (error) {
    if (organisation === current && repository === name) failed(error);
  }
}

/** The repository, and its skills that match the filter; the skill at \`path\` selected if shown. */
function show(path) {
  const { repository, skills: all } = result;
  const words = filterWords();
  const skills = words ? all.filter((skill) => matches(skill, words.split(' '))) : all;
  $('main').hidden = false;
  const summary = $('summary');
  summary.replaceChildren(
    element('strong', '', repository.id),
    ' · ' + (words ? skills.length + ' of ' : '') + all.length + (all.length === 1 ? ' skill' : ' skills'),
    repository.commit ? ' · ' + repository.commit.slice(0, 12) : '',
  );
  $('skills').replaceChildren(...skills.map((skill) => {
    const item = element('li');
    item.setAttribute('role', 'option');
    item.dataset.path = skill.path;
    item.append(element('div', 'name', skill.name));
    if (skill.summary) item.append(element('div', 'description', skill.summary));
    item.append(element('div', 'path', skill.path));
    if (skill.copies.length) item.append(element('div', 'copies', 'also in ' + skill.copies.join(', ')));
    item.addEventListener('click', () => select(skill.path));
    return item;
  }));
  $('no-match').textContent = words && !skills.length ? 'no skills match "' + words + '"' : '';
  showWarnings();
  const initial = skills.find((skill) => skill.path === path) ?? skills[0];
  select(initial?.path);
}

function select(path) {
  const skill = result.skills.find((skill) => skill.path === path);
  selected = skill?.path;
  for (const item of $('skills').children) item.setAttribute('aria-selected', String(item.dataset.path === path));
  setUrl(scanned, selected);
  const pane = $('skill');
  if (!skill) {
    const text = result.skills.length ? 'No skill selected.' : 'No skills in this repository.';
    return pane.replaceChildren(element('p', 'placeholder', text));
  }
  const link = element('a', '', skill.link);
  link.href = skill.link;
  link.target = '_blank';
  link.rel = 'noopener';
  pane.replaceChildren(element('h2', '', skill.name), link, element('pre', '', skill.content));
  pane.querySelector('pre').id = 'content';
}

$('filter').addEventListener('input', () => {
  // After a failed scan there is nothing to narrow, but the URL still keeps the word.
  if (result) show(selected);
  else setUrl(scanned);
});

$('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const repo = $('repo').value.trim();
  if (repo) scan(repo);
});

const params = new URLSearchParams(location.search);
$('filter').value = params.get('filter') ?? '';
if (params.get('repo')) {
  $('repo').value = params.get('repo');
  scan(params.get('repo'), params.get('skill'), params.get('repository'));
}
</script>
</body>
</html>
`;
