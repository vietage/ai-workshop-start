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
    <input id="repo" name="repo" placeholder="https://github.com/owner/repo, …/tree/<commit>, or a local directory" autocomplete="off" required>
    <button id="scan" type="submit">Scan</button>
  </form>
</header>
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

// The same rule as filterSkills in src/core/model.ts: the name or the description contains every
// word, each in any case, in any order.
const matches = (skill, words) =>
  words.every((word) => [skill.name, skill.description].some((text) => text.toLowerCase().includes(word.toLowerCase())));
// The filter's words, split on whitespace, joined by one space: '' without a word.
const filterWords = () => $('filter').value.split(/\\s+/).filter(Boolean).join(' ');

function setUrl(repo, skill) {
  const params = new URLSearchParams();
  if (repo) params.set('repo', repo);
  if (skill) params.set('skill', skill);
  if (filterWords()) params.set('filter', filterWords());
  const query = params.toString();
  history.replaceState(null, '', query ? '?' + query : location.pathname);
}

async function scan(repo, skill) {
  $('scan').disabled = true;
  $('scan').textContent = 'Scanning…';
  $('error').textContent = '';
  try {
    // The whole repository: the filter narrows it here, as you type, without scanning again.
    const response = await fetch('/api/scan?repo=' + encodeURIComponent(repo));
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    result = body;
    scanned = repo;
    show(skill);
  } catch (error) {
    result = undefined;
    scanned = repo;
    setUrl(repo);
    $('main').hidden = true;
    $('error').textContent = error.message;
  } finally {
    $('scan').disabled = false;
    $('scan').textContent = 'Scan';
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
  scan(params.get('repo'), params.get('skill'));
}
</script>
</body>
</html>
`;
