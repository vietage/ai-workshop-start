// The web view's one page: plain HTML, CSS and a script, no build step. Everything from the scan
// is put in with textContent, never as HTML.
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skill Atlas</title>
<style>
  /* A Miami neon-sunset style: a sunset over the ocean, palms, glass cards, neon accents on a dark
     base. Original artwork, drawn here in CSS and inline SVG: nothing is loaded from elsewhere. */
  :root {
    color-scheme: dark;
    --pink: #ff2e97; --cyan: #22e3e0; --purple: #a56bff; --orange: #ff9a3d;
    --sunset: linear-gradient(180deg, #150833 0%, #45127a 28%, #b3168c 50%, #ff2e97 62%, #ff8a45 70%, #ffb347 100%);
    --gradient: linear-gradient(100deg, #ff8ad4 0%, #ffb86b 50%, #5ff4ee 100%);
    --card: #150a30d6; --text: #f6edff; --muted: #cdbdf0; --border: #ff5cb866;
    --accent: #5ff4ee; --selected: linear-gradient(90deg, #ff2e9747, #22e3e021);
    --shadow: 0 0 0 1px #ff2e971f, 0 0 22px #ff2e9740, 0 12px 32px #0a021f99;
    --glow: 0 0 0 1px #22e3e059, 0 0 30px #ff2e9773, 0 12px 36px #0a021fb3;
    --warning: #ffc078; --error: #ffb3c0;
  }
  * { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: #ff5cb8 #150a3080; }
  /* Hidden means not shown, whatever display a rule below gives the element. */
  [hidden] { display: none !important; }
  body { margin: 0; min-height: 100vh; font: 15px/1.5 system-ui, sans-serif; color: var(--text); background-color: #150833; background-image: var(--sunset); background-attachment: fixed; }
  /* The scenery, behind everything and fixed while the page scrolls: the sun on the horizon, the ocean, two palms. */
  #scenery { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; --sun: min(46vh, 64vw); }
  #scenery svg { position: absolute; display: block; }
  #scenery .sun { left: 50%; bottom: calc(30vh - var(--sun) / 2); width: var(--sun); height: var(--sun); margin-left: calc(var(--sun) / -2); filter: drop-shadow(0 0 28px #ffb347b3) drop-shadow(0 0 70px #ff2e9780); }
  #scenery .ocean { position: absolute; left: 0; right: 0; bottom: 0; height: 30vh; border-top: 2px solid #ffe3a3; box-shadow: 0 0 24px #ff8a45;
    background-color: #150833;
    background-image: radial-gradient(ellipse 24% 100% at 50% 0, #ffd36bbf, #ffd36b00 72%), repeating-linear-gradient(180deg, #ffffff1c 0 2px, #ffffff00 2px 9px), linear-gradient(180deg, #ff6f61 0%, #b3168c 16%, #45127a 48%, #150833 100%); }
  #scenery .palm { bottom: -4vh; height: min(84vh, 150vw); width: auto; fill: #0d0420; }
  #scenery .palm.left { left: -3vw; }
  #scenery .palm.right { right: -2vw; height: min(64vh, 115vw); transform: scaleX(-1); }
  header { padding: 26px 24px 0; }
  /* The title: a bold retro heading with a neon glow. */
  h1 { margin: 0 0 16px 4px; width: fit-content; font-size: clamp(30px, 6vw, 46px); line-height: 1.05; font-weight: 900; font-style: italic; letter-spacing: .02em; color: #fff4fb; transform: skewX(-6deg);
    text-shadow: 0 0 4px #ffffff, 0 0 12px var(--pink), 0 0 28px var(--pink), 0 0 56px var(--purple), 3px 3px 0 #0d042099; }
  /* The cards: rounded, translucent glass, a soft neon border and shadow, lit a little more under the pointer. */
  .card { background-color: var(--card); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow); -webkit-backdrop-filter: blur(14px) saturate(140%); backdrop-filter: blur(14px) saturate(140%); }
  .card:hover { border-color: #ff8ad4; box-shadow: var(--glow); }
  #scan-card { padding: 14px 16px; }
  form { display: flex; flex-wrap: wrap; gap: 10px; }
  input { flex: 1 1 220px; min-width: 0; padding: 9px 12px; font: inherit; border: 1px solid #22e3e080; border-radius: 10px; background-color: #0a021f99; color: var(--text); box-shadow: inset 0 0 10px #22e3e01f; }
  input::placeholder { color: var(--muted); opacity: 1; }
  input:hover { border-color: var(--cyan); }
  input:focus { outline: 2px solid var(--cyan); outline-offset: 2px; border-color: var(--cyan); box-shadow: 0 0 16px #22e3e080, inset 0 0 10px #22e3e033; }
  button { padding: 9px 22px; font: inherit; font-weight: 700; border: 1px solid #ffd0ec; border-radius: 10px; background-color: #ff4fa8; background-image: linear-gradient(100deg, #ff4fa8, #ff9a3d); color: #1a0836; cursor: pointer; box-shadow: 0 0 14px #ff2e9799, 0 2px 8px #0a021f80; }
  button:hover { box-shadow: 0 0 24px #ff2e97, 0 2px 8px #0a021f80; }
  /* A clear focus from the keyboard, the same on every control. */
  button:focus-visible, a:focus-visible, #warnings:focus-visible, #tabs [role="tab"]:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
  /* Stop, the button while a scan runs: not Scan's pink gradient but cyan on a dark ground, a cyan glow. */
  #scan[type="button"] { background-color: #0a021f; background-image: none; color: var(--cyan); border-color: var(--cyan); box-shadow: 0 0 14px #22e3e099, 0 2px 8px #0a021f80; }
  #scan[type="button"]:hover { box-shadow: 0 0 24px #22e3e0, 0 2px 8px #0a021f80; }
  #progress { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 13px; color: var(--text); }
  #progress-bar { flex: 1; max-width: 420px; height: 10px; -webkit-appearance: none; appearance: none; overflow: hidden; border: 1px solid #22e3e080; border-radius: 999px; background-color: #0a021f99; box-shadow: 0 0 10px #22e3e059; accent-color: var(--pink); }
  #progress-bar::-webkit-progress-bar { background-color: #0a021f00; }
  #progress-bar::-webkit-progress-value { border-radius: 999px; background-image: linear-gradient(90deg, #22e3e0, #ff2e97); }
  #progress-bar::-moz-progress-bar { border-radius: 999px; background-image: linear-gradient(90deg, #22e3e0, #ff2e97); }
  main { display: grid; grid-template-columns: minmax(260px, 380px) 1fr; gap: 16px; padding: 16px 24px 24px; min-height: calc(100vh - 170px); }
  #list { overflow: auto; align-self: start; }
  #summary { padding: 14px 16px 10px; color: var(--muted); }
  #summary strong { color: var(--text); }
  #filter { display: block; width: calc(100% - 32px); margin: 0 16px 12px; padding: 7px 12px; }
  #no-match { margin: 0; padding: 10px 16px; border-top: 1px solid var(--border); color: var(--muted); }
  #no-match:empty { display: none; }
  #skills { list-style: none; margin: 0; padding: 0; }
  #skills li { padding: 10px 16px; border-top: 1px solid #ff5cb840; cursor: pointer; }
  #skills li:hover { background-color: #ff2e971f; }
  #skills li[aria-selected="true"] { background-image: var(--selected); box-shadow: inset 3px 0 var(--accent); }
  /* The item the keyboard is on: a visible focus, selected or not. */
  [role="option"]:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .name { font-weight: 600; }
  .description { font-size: 13px; }
  .path, .copies { font-size: 12px; color: var(--muted); font-family: ui-monospace, monospace; word-break: break-all; }
  #organisation { margin: 16px 24px 0; padding: 14px 16px; }
  /* An organisation's tabs: its own, then the repository's, with a close button. */
  #tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 24px 0; }
  #tabs [role="tab"] { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 10px; background-color: var(--card); box-shadow: var(--shadow); cursor: pointer; }
  #tabs [role="tab"]:hover { border-color: #ff8ad4; }
  #tabs [role="tab"][aria-selected="true"] { background-image: var(--selected); box-shadow: inset 0 -3px var(--accent), 0 0 18px #22e3e04d; font-weight: 600; }
  #tabs .close { padding: 0 6px; border: 0; border-radius: 999px; font-size: 14px; line-height: 1.4; background-color: #0a021f00; background-image: none; color: var(--muted); box-shadow: none; }
  #tabs .close:hover { background-color: #ff2e9740; color: var(--text); }
  #loading { width: fit-content; margin: 16px 24px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 10px; background-color: var(--card); color: var(--text); }
  #org-summary { color: var(--muted); margin-bottom: 10px; }
  #org-summary strong { color: var(--text); }
  /* The repositories in a column, one a line: its name, and its count right next to it. */
  #repositories { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; max-width: 560px; max-height: 30vh; overflow: auto; }
  #repositories li { display: flex; align-items: baseline; gap: 8px; padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  #repositories li:hover { background-color: #ff2e971f; }
  #repositories li[aria-selected="true"] { background-image: var(--selected); box-shadow: inset 3px 0 var(--accent); }
  #repositories .count { padding: 0 8px; border: 1px solid #22e3e059; border-radius: 999px; font-size: 12px; color: var(--text); background-color: #22e3e01f; white-space: nowrap; }
  /* The scan's errors and warnings, apart from the repositories and skills: a limited height, scrolled when they don't fit. */
  #problems { margin: 16px 24px 0; padding: 10px 16px 12px; border-color: #ff9a3d80; }
  #problems h2 { margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--warning); text-shadow: 0 0 10px #ff9a3d80; }
  #warnings { margin: 0; padding: 0 0 0 16px; font-size: 13px; line-height: 20px; color: var(--warning); max-height: 160px; overflow: auto; overscroll-behavior: contain; scrollbar-color: #ff9a3d #150a3080; }
  #error { margin: 16px 24px; padding: 10px 14px; border: 1px solid #ff6b8a; border-radius: 10px; background-color: #2a0620e6; color: var(--error); box-shadow: 0 0 18px #ff2e6a59; white-space: pre-wrap; overflow-wrap: anywhere; }
  #error:empty { display: none; }
  #skill { padding: 18px 24px; overflow: auto; min-width: 0; }
  #skill h2 { margin: 0 0 4px; font-size: 18px; background-image: var(--gradient); -webkit-background-clip: text; background-clip: text; color: transparent; width: fit-content; }
  #skill a { font-size: 13px; word-break: break-all; color: var(--accent); }
  #content { margin: 12px 0 0; padding: 14px; border: 1px solid #22e3e040; border-radius: 10px; background-color: #0a021f80; font: 13px/1.5 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; }
  .placeholder { color: var(--muted); }
  /* Narrow screens: one column, the Scan button under the field, less room around the cards. */
  @media (max-width: 720px) {
    header { padding: 18px 12px 0; }
    main { grid-template-columns: 1fr; padding: 12px 12px 20px; }
    #scan { flex: 1 1 100%; }
    #organisation, #problems, #tabs, #loading, #error { margin-left: 12px; margin-right: 12px; }
    #skill { padding: 14px 16px; }
    #scenery .palm.left { left: -22vw; }
    #scenery .palm.right { right: -16vw; height: 50vh; }
  }
  /* Movement only for those who have not asked for less of it. */
  @keyframes neon { 0%, 100% { opacity: 1; } 50% { opacity: .86; } }
  @keyframes sunglow { 0%, 100% { opacity: 1; } 50% { opacity: .9; } }
  @media (prefers-reduced-motion: no-preference) {
    h1 { animation: neon 5s ease-in-out infinite; }
    #scenery .sun { animation: sunglow 8s ease-in-out infinite; }
    .card, input, button, #tabs [role="tab"], #skills li, #repositories li { transition: border-color .2s ease, box-shadow .2s ease, background-color .2s ease; }
  }
</style>
</head>
<body>
<div id="scenery" aria-hidden="true">
  <svg class="sun" viewBox="0 0 200 200" focusable="false">
    <defs>
      <linearGradient id="sun-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff3a0"/><stop offset=".45" stop-color="#ffb347"/><stop offset="1" stop-color="#ff2e97"/>
      </linearGradient>
      <mask id="sun-bands">
        <rect width="200" height="200" fill="#fff"/>
        <rect y="52" width="200" height="3" fill="#000"/><rect y="64" width="200" height="4" fill="#000"/><rect y="77" width="200" height="5" fill="#000"/><rect y="90" width="200" height="6" fill="#000"/>
      </mask>
    </defs>
    <circle cx="100" cy="100" r="100" fill="url(#sun-fill)" mask="url(#sun-bands)"/>
  </svg>
  <div class="ocean"></div>
  <svg class="palm left" viewBox="-175 -130 350 670" focusable="false"><path id="palm" d="M-9 0C-4 150-22 330-58 540L-16 540C2 330 14 150 9 0ZM0 -2.8L-15.2 -14.7L-30 -24L-44.4 -30.5L-58.5 -34.4L-72.2 -35.6L-85.5 -34.1L-98.4 -29.9L-111 -23.1L-123.1 -13.6L-134.9 -1.4L-146.3 13.4L-157.3 31L-168 52L-162.1 46.9L-156.4 36.2L-154 38.8L-144.8 21.7L-144.8 31.3L-132.9 9.3L-134.7 24.8L-120.8 -1L-123.8 19.5L-108.4 -9.1L-112.1 15.3L-95.7 -15.1L-99.5 12.3L-82.7 -18.9L-86 10.4L-69.4 -20.5L-71.8 9.6L-55.9 -20L-56.7 10L-42 -17.2L-40.7 11.5L-27.9 -12.4L-23.9 14.1L-13.5 -5.3ZM0 -2.5L-10.8 -16.9L-21.5 -29.3L-32.3 -39.9L-43.1 -48.6L-53.8 -55.5L-64.6 -60.4L-75.4 -63.5L-86.2 -64.7L-96.9 -64.1L-107.7 -61.6L-118.5 -57.2L-129.2 -50.8L-140 -42L-133.5 -36.5L-128.4 -46.1L-125.3 -34.4L-117.1 -49.7L-116.6 -32.1L-105.9 -51.9L-107.4 -29.5L-94.8 -52.8L-97.7 -26.4L-83.8 -52.2L-87.7 -22.8L-72.9 -50.2L-77.2 -18.7L-62.1 -46.8L-66.3 -14.1L-51.4 -41.9L-55 -9.1L-40.7 -35.7L-43.3 -3.5L-30.1 -28L-31.2 2.6L-19.6 -18.9L-18.6 9.1L-9.2 -8.4ZM0 -2.1L-4.7 -15.6L-9.5 -28.2L-14.5 -40L-19.6 -50.9L-24.9 -61.1L-30.2 -70.4L-35.8 -78.9L-41.5 -86.6L-47.3 -93.4L-53.3 -99.5L-59.4 -104.7L-65.6 -109L-72 -112L-69.2 -97.1L-64.9 -105.1L-65.1 -85.7L-58.2 -98.5L-60.7 -74.9L-51.8 -91.4L-56 -64.6L-45.6 -84L-51.1 -54.6L-39.5 -76.1L-46 -45L-33.7 -67.8L-40.7 -35.6L-28.2 -59L-35.2 -26.6L-22.8 -49.8L-29.5 -18L-17.6 -40.1L-23.6 -9.6L-12.7 -30L-17.5 -1.6L-7.9 -19.5L-11.2 6.1L-3.4 -8.5ZM0 -2.1L2.2 -15.6L4.5 -28.3L7 -40.3L9.6 -51.5L12.2 -62L15.1 -71.7L18 -80.6L21 -88.9L24.2 -96.3L27.5 -103L30.9 -109L34.4 -114.1L38 -118L38 -102.2L33.6 -110.2L36.6 -90L29.7 -102.8L34.9 -78.5L26 -95L32.9 -67.5L22.4 -86.9L30.7 -56.9L19.1 -78.4L28.2 -46.7L15.9 -69.5L25.5 -36.9L13 -60.3L22.6 -27.5L10.2 -50.7L19.5 -18.5L7.6 -40.7L16.2 -9.9L5.2 -30.3L12.6 -1.7L2.9 -19.6L8.7 6L0.9 -8.5ZM0 -2.5L9.5 -17.9L19.1 -31.4L28.6 -43.1L38.2 -53.1L47.7 -61.3L57.2 -67.7L66.8 -72.3L76.3 -75.2L85.8 -76.2L95.4 -75.5L104.9 -73.1L114.5 -68.7L124 -62L118.8 -54.4L113.6 -64L111.8 -50.2L103.5 -65.6L104.3 -46.1L93.6 -65.9L96.3 -41.6L83.8 -64.9L87.9 -36.8L74 -62.6L79.1 -31.6L64.3 -59L69.8 -25.9L54.7 -54L60.2 -19.9L45.2 -47.7L50.1 -13.5L35.8 -40.1L39.6 -6.7L26.4 -31.2L28.7 0.5L17.2 -20.9L17.4 8.1L8 -9.4ZM0 -2.8L15.2 -15.1L30 -24.8L44.3 -31.9L58.3 -36.4L71.9 -38.3L85.1 -37.6L97.8 -34.4L110.2 -28.6L122.2 -20.2L133.7 -9.2L144.9 4.3L155.6 20.5L166 40L160.4 36.4L154.7 25.7L152.5 29.7L143.4 12.6L143.6 23.5L131.8 1.5L133.8 18.2L119.8 -7.6L123.1 14L107.6 -14.6L111.5 10.8L95.1 -19.6L99.1 8.7L82.3 -22.4L85.8 7.6L69.1 -23.2L71.6 7.6L55.7 -22L56.6 8.6L41.9 -18.6L40.7 10.7L27.8 -13.2L23.9 13.7L13.4 -5.7ZM0 -2.3L-12.5 -3.6L-24.3 -3.2L-35.4 -1L-45.6 2.9L-55.1 8.6L-63.9 16L-71.9 25.2L-79.1 36.2L-85.6 48.9L-91.4 63.4L-96.3 79.6L-100.5 97.7L-104 118L-104.4 110.3L-99.8 101.8L-102.4 99.9L-95.1 86.2L-99.3 89.5L-89.8 71.9L-94.9 79.7L-83.8 59L-89.4 70.3L-77.1 47.4L-82.8 61.4L-69.7 37.1L-75.1 53.1L-61.7 28.2L-66.2 45.3L-52.9 20.6L-56.2 38.1L-43.5 14.4L-45.1 31.4L-33.4 9.6L-32.9 25.2L-22.6 6.1L-19.5 19.5L-11.2 3.9ZM0 -2.3L13.1 -4.2L25.5 -4.4L37 -2.8L47.7 0.6L57.6 5.8L66.7 12.8L75.1 21.5L82.6 32L89.3 44.3L95.1 58.4L100.2 74.3L104.5 92L108 112L108.3 104.7L103.8 96.1L106.4 94.5L99 80.9L103 84.6L93.6 67L98.5 75.1L87.4 54.4L92.8 66.1L80.5 43.2L86 57.7L72.9 33.4L77.9 49.9L64.5 24.9L68.7 42.6L55.4 17.9L58.3 35.8L45.6 12.2L46.8 29.6L35 7.8L34 24L23.8 4.9L20.1 18.8L11.7 3.3Z"/></svg>
  <svg class="palm right" viewBox="-175 -130 350 670" focusable="false"><use href="#palm"/></svg>
</div>
<header>
  <h1>Skill Atlas</h1>
  <div id="scan-card" class="card">
    <form id="form">
      <input id="repo" name="repo" placeholder="https://github.com/owner/repo, …/tree/<commit>, https://github.com/organisation, or a local directory" autocomplete="off" required>
      <button id="scan" type="submit">Scan</button>
    </form>
    <div id="progress" hidden>
      <progress id="progress-bar" aria-label="Repositories scanned" value="0" max="1"></progress>
      <span id="progress-text"></span>
    </div>
  </div>
</header>
<nav id="tabs" role="tablist" aria-label="Organisation and its repositories" hidden></nav>
<section id="organisation" class="card" hidden>
  <div id="org-summary"></div>
  <ul id="repositories" role="listbox" aria-label="Repositories"></ul>
</section>
<p id="loading" class="placeholder" hidden></p>
<div id="error" role="alert"></div>
<section id="problems" class="card" aria-labelledby="problems-title" hidden>
  <h2 id="problems-title"></h2>
  <ul id="warnings" tabindex="0" aria-label="Errors and warnings"></ul>
</section>
<main id="main" hidden>
  <section id="list" class="card">
    <div id="summary"></div>
    <input id="filter" type="search" placeholder="Filter by name or description" aria-label="Filter skills" autocomplete="off">
    <p id="no-match"></p>
    <ul id="skills" role="listbox" aria-label="Skills"></ul>
  </section>
  <section id="skill" class="card"><p class="placeholder">Select a skill to see its SKILL.md.</p></section>
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
// The organisation shown, when the link is one, and the name of the repository in the active tab.
let organisation;
let repository;
// The organisation's repositories opened, by name, each \`{ name, result, error, selected, filter }\`:
// kept until another link is entered. The one in the repository's tab, undefined when it is
// closed; the same when that tab is the active one, undefined for the organisation's own tab.
let opened = new Map();
let tab;
let active;
// The latest scan of a link entered: only its progress is shown.
let scanning;
// The latest scan started, a link entered or a repository opened, while it runs: the Scan button is
// Stop, and stops it; it follows this one only, not an earlier one it replaced, which may never finish.
let running;
const plural = (count, one, many) => count + ' ' + (count === 1 ? one : many);
// The same rule as listedRepositories in src/core/organisation.ts: every repository but those
// scanned with no skills; the ones not scanned stay.
const listed = () => organisation.repositories.filter((entry) => entry.skillCount !== 0);

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
  // The organisation's own tab has no filter.
  if (filterWords() && !(organisation && !active)) params.set('filter', filterWords());
  const query = params.toString();
  history.replaceState(null, '', query ? '?' + query : location.pathname);
}

/**
 * A list from the keyboard: one item in the Tab order, the selected one, else the first; the arrow
 * keys, Home and End move the focus through it; Enter or Space selects the item focused, as a click.
 * When the focus leaves the list, its Tab stop goes back to the selected item.
 */
function rove(list, item) {
  const items = [...list.children];
  const current = item ?? items.find((entry) => entry.getAttribute('aria-selected') === 'true') ?? items[0];
  for (const entry of items) entry.tabIndex = entry === current ? 0 : -1;
  return current;
}
function focusItem(list, item) {
  rove(list, item)?.focus();
}
for (const list of [$('skills'), $('repositories')]) {
  list.addEventListener('keydown', (event) => {
    const items = [...list.children];
    const index = items.indexOf(event.target);
    if (index < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    const moves = { ArrowDown: items[index + 1], ArrowUp: items[index - 1], Home: items[0], End: items[items.length - 1] };
    if (event.key in moves) {
      event.preventDefault();
      if (moves[event.key]) focusItem(list, moves[event.key]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.target.click();
    }
  });
  list.addEventListener('focusout', (event) => {
    if (!list.contains(event.relatedTarget)) rove(list);
  });
}

/** A failed answer's message: its \`error\`, or its status when it is not the API's JSON. */
async function failure(response) {
  const body = await response.json().catch(() => undefined);
  if (typeof body?.error === 'string') return new Error(body.error);
  return new Error('The server answered ' + response.status + (response.statusText ? ' ' + response.statusText : ''));
}

/** The scan of a link: the API's answer, or its message as an error. */
async function request(link, signal) {
  const response = await fetch('/api/scan?repo=' + encodeURIComponent(link), { signal });
  if (!response.ok) throw await failure(response);
  return response.json();
}

/**
 * The same, streamed: \`progress(line)\` as an organisation's repositories are done, then the answer;
 * one JSON object a line.
 */
async function requestWithProgress(link, signal, progress) {
  const response = await fetch('/api/scan?stream=1&repo=' + encodeURIComponent(link), { signal });
  if (!response.ok) throw await failure(response);
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
      progress(body);
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

/**
 * The Scan button, or Stop while a scan runs: then not the form's submit button, so Enter in the
 * field still scans the link entered, and only a click stops.
 */
function scanButton(stop) {
  $('scan').type = stop ? 'button' : 'submit';
  $('scan').textContent = stop ? 'Stop' : 'Scan';
}

/**
 * Runs the latest scan, the button Stop until it ends; \`work(run)\` sets \`run.stopped\`, what Stop
 * shows. \`replace\` (a link entered): the scan before it, if still running, is aborted, and shows
 * nothing more; a repository opened leaves an earlier repository's scan to end, its answer kept.
 */
async function busy(work, replace) {
  if (replace) running?.controller.abort();
  const run = { controller: new AbortController(), stopped() {} };
  running = run;
  scanButton(true);
  try {
    await work(run);
  } finally {
    if (running === run) {
      running = undefined;
      scanButton(false);
    }
  }
}

/** Stop: the scan's request aborted, what it has found so far shown, and the button Scan again. */
function stop() {
  const run = running;
  if (!run) return;
  running = undefined;
  scanButton(false);
  run.stopped();
  run.controller.abort();
}

/** By skill count, the most first, then by name in any case; not scanned last: sortRepositories in src/core/organisation.ts. */
function sortRepositories(repositories) {
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const count = (entry) => entry.skillCount ?? -1;
  return [...repositories].sort(
    (a, b) => count(b) - count(a) || compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.name, b.name),
  );
}

/**
 * An organisation's scan stopped: the repositories done so far with their counts and warnings, the
 * others not scanned, as the API's answer would have them.
 */
function partialOrganisation(listing, done) {
  const repositories = sortRepositories(listing.repositories.map((entry) => done.get(entry.name)?.repository ?? entry));
  return {
    organisation: listing.organisation,
    repositories,
    skills: repositories.reduce((sum, entry) => sum + (entry.skillCount ?? 0), 0),
    warnings: repositories.flatMap((entry) => done.get(entry.name)?.warnings ?? []),
  };
}

/**
 * A link entered: a repository, or an organisation and, if \`name\` is one of them, that repository
 * in its tab, with \`filter\`.
 */
function scan(repo, skill, name, filter) {
  // This scan, to tell it from a later one of the same link.
  const current = {};
  return busy(async (run) => {
    $('error').textContent = '';
    scanned = repo;
    scanning = current;
    organisation = undefined;
    repository = undefined;
    opened = new Map();
    tab = undefined;
    active = undefined;
    $('tabs').hidden = true;
    $('loading').hidden = true;
    showProgress();
    // An organisation's repositories once listed, and each one done: what Stop keeps.
    let listing;
    const done = new Map();
    run.stopped = () => {
      scanning = undefined;
      result = undefined;
      showProgress();
      $('main').hidden = true;
      if (!listing) {
        $('organisation').hidden = true;
        // Nothing shown: no warnings either, not even the scan's before.
        showWarnings();
        return setUrl(repo);
      }
      organisation = partialOrganisation(listing, done);
      showOrganisation();
      activate(undefined);
    };
    try {
      // The whole repository: the filter narrows it here, as you type, without scanning again.
      // An organisation: the progress bar while its repositories are scanned.
      const body = await requestWithProgress(repo, run.controller.signal, (line) => {
        if (scanning !== current) return;
        if (line.repositories) listing = line;
        if (line.repository) done.set(line.repository.name, line);
        showProgress(line.progress.scanned, line.progress.total);
      });
      if (scanning !== current) return;
      showProgress();
      if (body.organisation) {
        organisation = body;
        result = undefined;
        showOrganisation();
        if (listed().some((entry) => entry.name === name)) return await openRepository(name, skill, filter, run);
        return activate(undefined);
      }
      $('organisation').hidden = true;
      result = body;
      show(skill);
    } catch (error) {
      if (scanning !== current) return;
      showProgress();
      failed(error);
    }
  }, true);
}

/** A failed scan: its message, nothing else; in a repository's tab, the organisation's tab stays. */
function failed(error) {
  result = undefined;
  setUrl(scanned);
  $('organisation').hidden = !organisation || active !== undefined;
  $('main').hidden = true;
  $('error').textContent = error.message;
  showWarnings();
}

/**
 * The scan's errors and warnings, in their own area: the organisation's while one is shown, in its
 * tab or a repository's; else the repository's; none after a failed scan of a link.
 */
function showWarnings() {
  const warnings = organisation ? organisationWarnings() : result ? result.warnings : [];
  $('problems').hidden = !warnings.length;
  $('problems-title').textContent = plural(warnings.length, 'warning', 'warnings');
  $('warnings').replaceChildren(...warnings.map((warning) => element('li', '', warning)));
}

/**
 * The organisation's warnings, each repository's as \`<name>: <warning>\`, in the order of its
 * repositories, then the cache's. In a repository's tab, once its own scan is done: its lines are
 * those of that scan, where they were (where they would be, in that order, if it had none), so that
 * a \`not scanned\` line of the organisation's scan goes; the organisation's as they were in its own
 * tab, while the repository's scan is under way, or when it failed. Whose a line is: by its place,
 * from each repository's own \`warnings\`, not by its text: a repository named \`cache\` is not the cache.
 */
function organisationWarnings() {
  if (!active?.result) return organisation.warnings;
  const lines = [];
  let at = 0;
  for (const entry of organisation.repositories) {
    const count = entry.warnings.length;
    lines.push(...(entry.name === active.name
      ? active.result.warnings.map((warning) => entry.name + ': ' + warning)
      : organisation.warnings.slice(at, at + count)));
    at += count;
  }
  // The cache's own, after the repositories'.
  return [...lines, ...organisation.warnings.slice(at)];
}

/**
 * The organisation: all its repositories counted; each one with its skill count, the ones with no
 * skills left out; its warnings apart.
 */
function showOrganisation() {
  const shown = organisation;
  const { organisation: owner, repositories, skills } = shown;
  $('organisation').hidden = false;
  $('org-summary').replaceChildren(
    element('strong', '', owner.name),
    ' · ' + plural(repositories.length, 'repository', 'repositories') + ' · ' + plural(skills, 'skill', 'skills'),
  );
  $('repositories').replaceChildren(...listed().map((entry) => {
    const item = element('li');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.dataset.name = entry.name;
    const count = entry.skillCount === null ? 'not scanned' : plural(entry.skillCount, 'skill', 'skills');
    item.append(element('span', 'name', entry.name), element('span', 'count', count));
    // While another link is scanned, this organisation is no longer the one shown: nothing to open.
    item.addEventListener('click', () => organisation === shown && busy((run) => openRepository(entry.name, undefined, '', run)));
    return item;
  }));
  rove($('repositories'));
  showWarnings();
}

/**
 * One repository of the organisation, in the repository's tab, made active: its skills, as for a
 * repository link, at the commit counted. Opened before → as it was left, not scanned again; one
 * that failed is scanned again. Stopped → its tab closed and the repository forgotten: the
 * organisation's tab, no repository selected.
 */
async function openRepository(name, skill, filter = '', run) {
  const known = opened.get(name);
  if (known && !known.error) {
    tab = known;
    return activate(known);
  }
  const entry = organisation.repositories.find((candidate) => candidate.name === name);
  const state = { name, selected: skill, filter };
  opened.set(name, state);
  tab = state;
  activate(state);
  run.stopped = () => {
    if (opened.get(name) === state) opened.delete(name);
    if (tab !== state) return;
    tab = undefined;
    if (active === state) activate(undefined);
    else showTabs();
  };
  try {
    state.result = await request(entry.commit ? entry.url + '/tree/' + entry.commit : entry.url, run.controller.signal);
  } catch (error) {
    state.error = error;
  }
  // Another tab, repository or link since: kept, if it is still the same link, but not shown.
  if (active === state) activate(state);
}

/** Shows a tab: the organisation's (\`undefined\`), its repositories; or the repository's, its skills. */
function activate(state) {
  active = state;
  repository = state?.name;
  showTabs();
  showWarnings();
  $('error').textContent = '';
  $('organisation').hidden = state !== undefined;
  $('loading').hidden = true;
  if (!state) {
    result = undefined;
    $('main').hidden = true;
    return setUrl(scanned);
  }
  $('filter').value = state.filter;
  if (state.error) return failed(state.error);
  if (!state.result) {
    // Still scanning: its name, and nothing else until it is done.
    result = undefined;
    $('main').hidden = true;
    $('loading').hidden = false;
    $('loading').textContent = 'Scanning ' + state.name + '…';
    return setUrl(scanned);
  }
  result = state.result;
  show(state.selected);
}

/** Closes the repository's tab: the organisation's, active. */
function closeTab() {
  tab = undefined;
  activate(undefined);
}

/** The tabs: the organisation's, then the repository's, if open; that repository marked in the list. */
function showTabs() {
  const node = (state, label) => {
    const item = element('div', 'tab');
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', String(active === state));
    item.append(element('span', 'label', label));
    item.addEventListener('click', () => activate(state));
    return item;
  };
  const tabs = [node(undefined, organisation.organisation.name)];
  if (tab) {
    const item = node(tab, tab.name);
    item.dataset.name = tab.name;
    const close = element('button', 'close', '×');
    close.type = 'button';
    close.title = 'Close ' + tab.name;
    close.setAttribute('aria-label', 'Close ' + tab.name);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab();
    });
    item.append(close);
    tabs.push(item);
  }
  $('tabs').hidden = false;
  $('tabs').replaceChildren(...tabs);
  for (const item of $('repositories').children) item.setAttribute('aria-selected', String(item.dataset.name === tab?.name));
  rove($('repositories'));
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
  if (active) active.selected = selected;
  for (const item of $('skills').children) item.setAttribute('aria-selected', String(item.dataset.path === path));
  rove($('skills'));
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
  if (active) active.filter = $('filter').value;
  // After a failed scan there is nothing to narrow, but the URL still keeps the word.
  if (result) show(selected);
  else setUrl(scanned);
});

// ArrowDown in the filter: on to the skills, the selected one.
$('filter').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' || !$('skills').children.length) return;
  event.preventDefault();
  focusItem($('skills'));
});

$('scan').addEventListener('click', (event) => {
  if (!running) return;
  event.preventDefault();
  stop();
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
  scan(params.get('repo'), params.get('skill'), params.get('repository'), params.get('filter') ?? '');
}
</script>
</body>
</html>
`;
