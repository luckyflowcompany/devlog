// projects/*/ 의 개발일지 원본을 정적 사이트(site/)로 만든다 (DEVLOG_SPEC §2, §10).
//   site/index.html                     허브 — 프로젝트 카드 + 최근 회차
//   site/{slug}/index.html              프로젝트 — 회차 타임라인
//   site/{slug}/{YYYY-MM-DD-N}/         회차 — 본문 + 그 회차 이미지
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { marked } from 'marked';
import { parse } from 'yaml';

const SITE_URL = 'https://luckyflowcompany.github.io/devlog';
const OUT = 'site';
const TAGS = ['기획', '코어', '아트', 'UI', '연출', '밸런스', '버그', '빌드', '세팅', '결정', '출시'];
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
  for (const t of meta.tags ?? []) if (!TAGS.includes(t)) warn(`${file}: 목록에 없는 태그 "${t}"`);
  if (!meta.title) warn(`${file}: title 없음`);
  const key = `${date}_${session}`;
  return {
    key,
    url: `${date}-${session}`,
    date: String(meta.date ?? date),
    session: Number(meta.session ?? session),
    title: meta.title ?? basename(file, '.md'),
    summary: meta.summary ?? '',
    tags: meta.tags ?? [],
    version: meta.version,
    cover: meta.cover,
    assetsDir: join(project.dir, 'assets', key),
    html: renderMarkdown(body),
    minutes: Math.max(1, Math.round(body.replace(/\s+/g, '').length / 500)),
  };
}

function renderMarkdown(md) {
  let html = marked.parse(md, { gfm: true });
  // 이미지 단독 문단 + 바로 다음 기울임 문단 → figure + 캡션
  html = html.replace(
    /<p>(<img [^>]+>)<\/p>\s*<p><em>([\s\S]*?)<\/em><\/p>/g,
    '<figure>$1<figcaption>$2</figcaption></figure>',
  );
  html = html.replace(/<p>(<img [^>]+>)<\/p>/g, '<figure>$1</figure>');
  html = html.replace(/<img /g, '<img loading="lazy" ');
  html = html.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, '</table></div>');
  return html;
}

// ---------- 템플릿 ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const fmtDate = (d) => d.replaceAll('-', '.');

function layout({ title, description, root, body, ogImage, accent, path }) {
  const fullTitle = title ? `${title} — LuckyFlow Devlog` : 'LuckyFlow Devlog';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="LuckyFlow Devlog">
<meta property="og:title" content="${esc(title || 'LuckyFlow Devlog')}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE_URL}/${path}">
${ogImage ? `<meta property="og:image" content="${SITE_URL}/${ogImage}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="${root}theme/style.css">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1d1b17"/><path d="M9 9v14h9" stroke="#f6f3ec" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="22.5" cy="22" r="2.4" fill="#e8b04b"/></svg>')}">
</head>
<body${accent ? ` style="--accent:${esc(accent)}"` : ''}>
<header class="site-head"><div class="wrap">
  <a class="brand" href="${root}"><span class="brand-mark"></span>LuckyFlow <b>Devlog</b></a>
</div></header>
<main>${body}</main>
<footer class="site-foot"><div class="wrap">
  <span>LuckyFlow · 만드는 과정을 기록한다</span>
  <span class="mono">원본 md 에서 자동 생성</span>
</div></footer>
</body>
</html>`;
}

const tagList = (tags) =>
  tags.length ? `<ul class="tags">${tags.map((t) => `<li class="tag" data-tag="${esc(t)}">${esc(t)}</li>`).join('')}</ul>` : '';

const projectCover = (p) => {
  if (p.cover && existsSync(join(p.dir, p.cover))) return `${p.slug}/cover${extname(p.cover)}`;
  const e = p.entries.find((x) => x.cover);
  return e ? `${p.slug}/${e.url}/${e.cover}` : null;
};

function homePage(projects) {
  const cards = projects
    .map((p) => {
      const cover = projectCover(p);
      const last = p.entries[0];
      return `<a class="project-card" href="${p.slug}/" style="--accent:${esc(p.accent)}">
  <div class="thumb">${cover ? `<img src="${cover}" alt="" loading="lazy">` : `<span class="thumb-empty">${esc(p.name)}</span>`}</div>
  <div class="project-card-body">
    <div class="row"><h3>${esc(p.name)}</h3><span class="status">${esc(p.status ?? '')}</span></div>
    <p>${esc(p.tagline ?? '')}</p>
    <div class="meta mono">${p.entries.length}회차${last ? ` · ${fmtDate(last.date)}` : ''}</div>
  </div>
</a>`;
    })
    .join('\n');

  const recent = projects
    .flatMap((p) => p.entries.map((e) => ({ p, e })))
    .sort((a, b) => b.e.date.localeCompare(a.e.date) || b.e.session - a.e.session)
    .slice(0, 8)
    .map(
      ({ p, e }) => `<li><a href="${p.slug}/${e.url}/" style="--accent:${esc(p.accent)}">
  <span class="mono date">${fmtDate(e.date)}</span>
  <span class="dot"></span><span class="proj">${esc(p.name)}</span>
  <span class="t">${esc(e.title)}</span>
</a></li>`,
    )
    .join('\n');

  const total = projects.reduce((n, p) => n + p.entries.length, 0);
  const body = `<section class="hero"><div class="wrap">
  <p class="eyebrow mono">DEVLOG · ${projects.length} PROJECTS · ${total} ENTRIES</p>
  <h1>만드는 과정을<br>기록합니다.</h1>
  <p class="lead">LuckyFlow 가 만드는 게임들의 개발일지. 세션마다 한 편씩, 무엇을 만들었고 왜 그렇게 정했는지 남긴다.</p>
</div></section>
<section class="wrap"><h2 class="section-title">프로젝트</h2><div class="project-grid">${cards || '<p class="empty">아직 프로젝트가 없다.</p>'}</div></section>
${recent ? `<section class="wrap"><h2 class="section-title">최근 회차</h2><ul class="recent">${recent}</ul></section>` : ''}`;
  return layout({ title: '', description: 'LuckyFlow 가 만드는 게임들의 개발일지', root: '', body, path: '' });
}

function projectPage(p) {
  const chips = [p.started && `${fmtDate(String(p.started))} 시작`, ...(p.platforms ?? []), ...(p.stack ?? [])]
    .filter(Boolean)
    .map((c) => `<li>${esc(c)}</li>`)
    .join('');
  const items = p.entries
    .map(
      (e) => `<li class="tl-item">
  <div class="tl-date mono"><b>${fmtDate(e.date)}</b><span>#${e.session}${e.version ? ` · v${esc(e.version)}` : ''}</span></div>
  <a class="tl-card" href="${e.url}/">
    <div class="tl-text">
      <h3>${esc(e.title)}</h3>
      <p>${esc(e.summary)}</p>
      ${tagList(e.tags)}
    </div>
    ${e.cover ? `<div class="tl-thumb"><img src="${e.url}/${esc(e.cover)}" alt="" loading="lazy"></div>` : ''}
  </a>
</li>`,
    )
    .join('\n');
  const body = `<section class="project-head"><div class="wrap">
  <a class="crumb mono" href="../">← 전체 프로젝트</a>
  <div class="row"><h1>${esc(p.name)}</h1><span class="status">${esc(p.status ?? '')}</span></div>
  <p class="lead">${esc(p.tagline ?? '')}</p>
  ${chips ? `<ul class="chips mono">${chips}</ul>` : ''}
</div></section>
<section class="wrap"><ol class="timeline">${items || '<p class="empty">아직 회차가 없다.</p>'}</ol></section>`;
  const cover = projectCover(p);
  return layout({ title: p.name, description: p.tagline ?? '', root: '../', body, accent: p.accent, ogImage: cover, path: `${p.slug}/` });
}

function entryPage(p, e, i) {
  const newer = p.entries[i - 1];
  const older = p.entries[i + 1];
  const nav = (x, label, cls) =>
    x
      ? `<a class="${cls}" href="../${x.url}/"><span class="mono">${label}</span><b>${esc(x.title)}</b></a>`
      : `<span class="${cls} none"></span>`;
  const body = `<article class="entry"><div class="wrap narrow">
  <a class="crumb mono" href="../">← ${esc(p.name)}</a>
  <div class="entry-meta mono">${fmtDate(e.date)} · #${e.session}${e.version ? ` · v${esc(e.version)}` : ''} · ${e.minutes}분</div>
  <h1>${esc(e.title)}</h1>
  ${e.summary ? `<p class="lead">${esc(e.summary)}</p>` : ''}
  ${tagList(e.tags)}
  <div class="prose">${e.html}</div>
  <nav class="pager">${nav(older, '이전 회차', 'prev')}${nav(newer, '다음 회차', 'next')}</nav>
</div></article>`;
  return layout({
    title: `${e.title} · ${p.name}`,
    description: e.summary,
    root: '../../',
    body,
    accent: p.accent,
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
  write(p.slug, projectPage(p));
  if (p.cover && existsSync(join(p.dir, p.cover))) cpSync(join(p.dir, p.cover), join(OUT, p.slug, `cover${extname(p.cover)}`));
  p.entries.forEach((e, i) => {
    write(join(p.slug, e.url), entryPage(p, e, i));
    if (existsSync(e.assetsDir)) cpSync(e.assetsDir, join(OUT, p.slug, e.url), { recursive: true });
    if (e.cover && !existsSync(join(e.assetsDir, e.cover))) warn(`${p.slug}/${e.key}: 커버 "${e.cover}" 없음`);
  });
}

for (const w of warnings) console.warn(`⚠ ${w}`);
console.log(`site/ 생성 — 프로젝트 ${projects.length}개, 회차 ${projects.reduce((n, p) => n + p.entries.length, 0)}편`);
