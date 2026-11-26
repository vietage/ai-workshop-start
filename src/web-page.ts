// The web view's one page: plain HTML, CSS and a script, no build step. Everything from the scan
// is put in with textContent, never as HTML.
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skill Atlas</title>
<style>
  :root { color-scheme: light dark; --border: #8884; --muted: #888; --accent: #4f7cff; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 system-ui, sans-serif; }
  header { padding: 16px 24px; border-bottom: 1px solid var(--border); }
  h1 { margin: 0 0 10px; font-size: 18px; }
  form { display: flex; gap: 8px; }
  input { flex: 1; padding: 8px 10px; font: inherit; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: inherit; }
  button { padding: 8px 16px; font: inherit; border: 0; border-radius: 6px; background: var(--accent); color: white; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  main { display: grid; grid-template-columns: minmax(260px, 380px) 1fr; min-height: calc(100vh - 100px); }
  #list { border-right: 1px solid var(--border); overflow: auto; }
  #summary { padding: 12px 16px; color: var(--muted); }
  #summary strong { color: CanvasText; }
  #filter { display: block; width: calc(100% - 32px); margin: 0 16px 12px; padding: 6px 10px; }
  #no-match { margin: 0; padding: 10px 16px; border-top: 1px solid var(--border); color: var(--muted); }
  #no-match:empty { display: none; }
  #skills { list-style: none; margin: 0; padding: 0; }
  #skills li { padding: 10px 16px; border-top: 1px solid var(--border); cursor: pointer; }
  #skills li:hover { background: #8881; }
  #skills li[aria-selected="true"] { background: #4f7cff22; box-shadow: inset 3px 0 var(--accent); }
  .name { font-weight: 600; }
  .description { font-size: 13px; }
  .path, .copies { font-size: 12px; color: var(--muted); font-family: ui-monospace, monospace; word-break: break-all; }
  #warnings { margin: 0; padding: 12px 16px 12px 32px; font-size: 13px; color: #c80; border-top: 1px solid var(--border); }
  #warnings:empty { display: none; }
  #organisation { padding: 12px 24px; border-bottom: 1px solid var(--border); }
  #org-summary { color: var(--muted); margin-bottom: 8px; }
  #org-summary strong { color: CanvasText; }
  #repositories { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; max-height: 30vh; overflow: auto; }
  #repositories li { padding: 4px 10px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
  #repositories li:hover { background: #8881; }
  #repositories li[aria-selected="true"] { background: #4f7cff22; border-color: var(--accent); }
  #repositories .count { margin-left: 6px; font-size: 12px; color: var(--muted); }
  #org-warnings { margin: 8px 0 0; padding-left: 16px; font-size: 13px; color: #c80; }
  #org-warnings:empty { display: none; }
  #error { margin: 16px; padding: 10px 14px; border-radius: 6px; background: #d3303022; color: #e55; white-space: pre-wrap; }
  #error:empty { display: none; }
  #skill { padding: 16px 24px; overflow: auto; min-width: 0; }
  #skill h2 { margin: 0 0 4px; font-size: 17px; }
  #skill a { font-size: 13px; word-break: break-all; color: var(--accent); }
  #content { margin: 12px 0 0; padding: 14px; border: 1px solid var(--border); border-radius: 6px; font: 13px/1.5 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
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
</header>
<section id="organisation" hidden>
  <div id="org-summary"></div>
  <ul id="repositories" role="listbox"></ul>
  <ul id="org-warnings"></ul>
</section>
<div id="error" role="alert"></div>
<main id="main" hidden>
  <section id="list">
    <div id="summary"></div>
    <input id="filter" type="search" placeholder="Filter by name or description" aria-label="Filter skills" autocomplete="off">
    <p id="no-match"></p>
    <ul id="skills" role="listbox"></ul>
    <ul id="warnings"></ul>
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
  return busy(async () => {
    $('error').textContent = '';
    scanned = repo;
    organisation = undefined;
    repository = undefined;
    try {
      // The whole repository: the filter narrows it here, as you type, without scanning again.
      const body = await request(repo);
      if (scanned !== repo) return;
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
      if (scanned === repo) failed(error);
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
}

/** The organisation: its repositories, each with its skill count, and its warnings. */
function showOrganisation() {
  const { organisation: owner, repositories, skills, warnings } = organisation;
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
  $('org-warnings').replaceChildren(...warnings.map((warning) => element('li', '', warning)));
}

/** One repository of the organisation: its skills, as for a repository link, at the commit counted. */
async function openRepository(name, skill) {
  const entry = organisation.repositories.find((candidate) => candidate.name === name);
  repository = name;
  for (const item of $('repositories').children) item.setAttribute('aria-selected', String(item.dataset.name === name));
  $('error').textContent = '';
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
  const { repository, skills: all, warnings } = result;
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
  $('warnings').replaceChildren(...warnings.map((warning) => element('li', '', warning)));
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
