// projects/*/ 의 개발일지 원본을 정적 사이트(site/)로 만든다 (DEVLOG_SPEC §2, §10).
//   site/index.html                     허브 — 최신 회차 + 프로젝트 목록 + 최근 회차
//   site/{slug}/index.html              프로젝트 — 회차 목록
//   site/{slug}/{YYYY-MM-DD-N}/         회차 — 본문 + 그 회차 이미지
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { marked } from 'marked';
import { parse } from 'yaml';

const SITE_URL = 'https://luckyflowcompany.github.io/devlog';
const OUT = 'site';
const ENTRY_FILE = /^(\d{4}-\d{2}-\d{2})_(\d+)_(.+)\.md$/;

const warnings = [];
const warn = (msg) => warnings.push(msg);

// ---------- 읽기 ----------

function readProjects() {
  if (!existsSync('projects')) return [];
  return readdirSync('projects', { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readProject(join('projects', d.name)))
    .filter(Boolean)
    .sort((a, b) => (b.entries[0]?.date ?? '').localeCompare(a.entries[0]?.date ?? ''));
}

function readProject(dir) {
  const configPath = join(dir, 'project.yml');
  if (!existsSync(configPath)) return warn(`${dir}: project.yml 없음 — 건너뜀`);
  const p = parse(readFileSync(configPath, 'utf8'));
  p.dir = dir;
  p.accent ??= '#8a8f98';
  const entriesDir = join(dir, 'entries');
  p.entries = existsSync(entriesDir)
    ? readdirSync(entriesDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => readEntry(p, join(entriesDir, f)))
        .filter(Boolean)
        .sort((a, b) => b.key.localeCompare(a.key, undefined, { numeric: true }))
    : [];
  return p;
}

function readEntry(project, file) {
  const m = basename(file).match(ENTRY_FILE);
  if (!m) return warn(`${file}: 파일명이 YYYY-MM-DD_N_주제.md 가 아님 — 건너뜀`);
  const [, date, session] = m;
  const raw = readFileSync(file, 'utf8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = fm ? parse(fm[1]) : {};
  const body = fm ? raw.slice(fm[0].length) : raw;
  if (!meta.title) warn(`${file}: title 없음`);
  const key = `${date}_${session}`;
  return {
    key,
    url: `${date}-${session}`,
    date: String(meta.date ?? date),
    session: Number(meta.session ?? session),
    title: meta.title ?? basename(file, '.md'),
    summary: meta.summary ?? '',
    version: meta.version != null ? String(meta.version) : undefined,
    cover: meta.cover,
    assetsDir: join(project.dir, 'assets', key),
    html: renderMarkdown(body),
    minutes: Math.max(1, Math.round(body.replace(/\s+/g, '').length / 500)),
  };
}

function renderMarkdown(md) {
  let html = marked.parse(md, { gfm: true });
  // 이미지 + 기울임 캡션 → figure. 캡션이 바로 다음 줄(같은 문단)이거나 다음 문단인 두 경우 모두
  html = html.replace(/<p>(<img [^>]+>)\s*<em>([\s\S]*?)<\/em><\/p>/g, '<figure>$1<figcaption>$2</figcaption></figure>');
  html = html.replace(
    /<p>(<img [^>]+>)<\/p>\s*<p><em>([\s\S]*?)<\/em><\/p>/g,
    '<figure>$1<figcaption>$2</figcaption></figure>',
  );
  html = html.replace(/<p>(<img [^>]+>)<\/p>/g, '<figure>$1</figure>');
  html = html.replace(/<img /g, '<img loading="lazy" ');
  html = html.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, '</table></div>');
  return html;
}

// ---------- 템플릿 (디자인 ⑪ — DEVLOG_SPEC §10) ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 2026-10-04 → 2026년 10월 4일 / 10월 4일
const longDate = (d) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${y}년 ${m}월 ${day}일`;
};
const shortDate = (d) => {
  const [, m, day] = d.split('-').map(Number);
  return `${m}월 ${day}일`;
};

// 버전이 있으면 제목 앞에 붙인다 (§4-2)
const displayTitle = (e) => (e.version ? `v${e.version} — ${e.title}` : e.title);

// 프로젝트 이름만 대표색 — 강조는 이것과 목록 점뿐이다
const metaLine = (p, ...rest) =>
  `<span class="p" style="--c:${esc(p.accent)}">${esc(p.name)}</span>${rest.filter(Boolean).map((r) => ` · ${r}`).join('')}`;

const projectCover = (p) => {
  if (p.cover && existsSync(join(p.dir, p.cover))) return `${p.slug}/cover${extname(p.cover)}`;
  const e = p.entries.find((x) => x.cover);
  return e ? `${p.slug}/${e.url}/${e.cover}` : null;
};

function layout({ title, description, root, body, ogImage, path, nav = '' }) {
  const fullTitle = title ? `${title} — LuckyFlow Devlog` : 'LuckyFlow Devlog';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0e0f11">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="LuckyFlow Devlog">
<meta property="og:title" content="${esc(title || 'LuckyFlow Devlog')}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE_URL}/${path}">
${ogImage ? `<meta property="og:image" content="${SITE_URL}/${ogImage}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="${root}theme/style.css">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0e0f11"/><path d="M10 9v14h9" stroke="#f2f3f5" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22.5" cy="22" r="2.4" fill="#7ddf8e"/></svg>')}">
</head>
<body>
${body}
</body>
</html>`;
}

function siteNav(projects, root, current) {
  const links = projects
    .map((p) => `<a href="${root}${p.slug}/"${p.slug === current ? ' class="on"' : ''}>${esc(p.name)}</a>`)
    .join('');
  return `<nav class="nav"><div class="w">
  <a class="logo" href="${root}">LuckyFlow Devlog</a>
  <div class="links"><a href="${root}"${current ? '' : ' class="on"'}>전체</a>${links}</div>
</div></nav>`;
}

const thumb = (src) => (src ? `<img src="${src}" alt="" loading="lazy">` : `<div class="ph"></div>`);

function entryRow(p, e, href, withProject) {
  return `<a class="li" href="${href}">
  <div class="d">${shortDate(e.date)}</div>
  <div class="li-text">
    <div class="meta">${withProject ? metaLine(p, `#${e.session}`) : `#${e.session}`}</div>
    <h3>${esc(displayTitle(e))}</h3>
    ${e.summary ? `<p>${esc(e.summary)}</p>` : ''}
  </div>
  <div class="th">${thumb(e.cover ? `${href}${esc(e.cover)}` : null)}</div>
</a>`;
}

function homePage(projects) {
  const all = projects
    .flatMap((p) => p.entries.map((e) => ({ p, e })))
    .sort((a, b) => b.e.date.localeCompare(a.e.date) || b.e.session - a.e.session);
  const latest = all[0];

  const lead = latest
    ? `<a class="lead" href="${latest.p.slug}/${latest.e.url}/">
  ${latest.e.cover ? `<img src="${latest.p.slug}/${latest.e.url}/${esc(latest.e.cover)}" alt="">` : '<div class="ph"></div>'}
  <div>
    <div class="meta">${metaLine(latest.p, longDate(latest.e.date), `#${latest.e.session}`)}</div>
    <h1>${esc(displayTitle(latest.e))}</h1>
    ${latest.e.summary ? `<p>${esc(latest.e.summary)}</p>` : ''}
  </div>
</a>`
    : '<p class="empty">아직 회차가 없다.</p>';

  const projectRows = projects
    .map(
      (p) => `<a class="pj" href="${p.slug}/" style="--c:${esc(p.accent)}">
  <b>${esc(p.name)}</b><span>${esc(p.tagline ?? '')}</span><em>${p.entries.length}회차${p.status ? ` · ${esc(p.status)}` : ''}</em>
</a>`,
    )
    .join('\n');

  const recent = all
    .slice(1, 11)
    .map(({ p, e }) => entryRow(p, e, `${p.slug}/${e.url}/`, true))
    .join('\n');

  const body = `${siteNav(projects, '', null)}
<main class="w">
${lead}
<h2>프로젝트</h2>
<div class="rows">${projectRows}</div>
${recent ? `<h2>최근 회차</h2>\n<div class="rows">${recent}</div>` : ''}
</main>`;
  return layout({ title: '', description: 'LuckyFlow 게임 개발일지', root: '', body, path: '', ogImage: latest?.e.cover ? `${latest.p.slug}/${latest.e.url}/${latest.e.cover}` : null });
}

function projectPage(p, projects) {
  const facts = [p.status, p.started && `${longDate(String(p.started))} 시작`, (p.platforms ?? []).join(' · '), (p.stack ?? []).join(' · ')]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  const rows = p.entries.map((e) => entryRow(p, e, `${e.url}/`, false)).join('\n');
  const body = `${siteNav(projects, '../', p.slug)}
<main class="w">
<header class="phead" style="--c:${esc(p.accent)}">
  <h1><span class="dot"></span>${esc(p.name)}</h1>
  ${p.tagline ? `<p>${esc(p.tagline)}</p>` : ''}
  ${facts ? `<div class="meta">${facts}</div>` : ''}
</header>
<h2>회차 ${p.entries.length}</h2>
<div class="rows">${rows || '<p class="empty">아직 회차가 없다.</p>'}</div>
</main>`;
  return layout({ title: p.name, description: p.tagline ?? '', root: '../', body, ogImage: projectCover(p), path: `${p.slug}/` });
}

function entryPage(p, e, i) {
  const newer = p.entries[i - 1];
  const older = p.entries[i + 1];
  const nav = (x, label, cls) =>
    x
      ? `<a class="${cls}" href="../${x.url}/"><span>${label}</span>${esc(displayTitle(x))}</a>`
      : `<span class="${cls}"></span>`;
  const body = `<main class="w narrow entry">
  <a class="back" href="../">← ${esc(p.name)}</a>
  <div class="meta">${metaLine(p, longDate(e.date), `#${e.session}`)}</div>
  <h1>${esc(displayTitle(e))}</h1>
  ${e.summary ? `<p class="sum">${esc(e.summary)}</p>` : ''}
  <hr>
  <div class="prose">${e.html}</div>
  <nav class="pager">${nav(older, '이전 회차', 'prev')}${nav(newer, '다음 회차', 'next')}</nav>
</main>`;
  return layout({
    title: `${displayTitle(e)} · ${p.name}`,
    description: e.summary,
    root: '../../',
    body,
    ogImage: e.cover ? `${p.slug}/${e.url}/${e.cover}` : projectCover(p),
    path: `${p.slug}/${e.url}/`,
  });
}

// ---------- 쓰기 ----------

function write(path, html) {
  mkdirSync(join(OUT, path), { recursive: true });
  writeFileSync(join(OUT, path, 'index.html'), html);
}

const projects = readProjects();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync('theme', join(OUT, 'theme'), { recursive: true });
writeFileSync(join(OUT, '.nojekyll'), '');

write('', homePage(projects));
for (const p of projects) {
  write(p.slug, projectPage(p, projects));
  if (p.cover && existsSync(join(p.dir, p.cover))) cpSync(join(p.dir, p.cover), join(OUT, p.slug, `cover${extname(p.cover)}`));
  p.entries.forEach((e, i) => {
    write(join(p.slug, e.url), entryPage(p, e, i));
    if (existsSync(e.assetsDir)) cpSync(e.assetsDir, join(OUT, p.slug, e.url), { recursive: true });
    if (e.cover && !existsSync(join(e.assetsDir, e.cover))) warn(`${p.slug}/${e.key}: 커버 "${e.cover}" 없음`);
  });
}

for (const w of warnings) console.warn(`⚠ ${w}`);
console.log(`site/ 생성 — 프로젝트 ${projects.length}개, 회차 ${projects.reduce((n, p) => n + p.entries.length, 0)}편`);
