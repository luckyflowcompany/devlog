// projects/*/ 의 개발일지 원본을 정적 사이트(site/)로 만든다 — 디자인: 명세서 스타일 (DEVLOG_SPEC §10).
//   site/index.html              최근에 갱신된 프로젝트의 대시보드 (프로젝트 탭)
//   site/{slug}/index.html       프로젝트 대시보드 — 소개 · 단계 · 로드맵 · 회차 목록
//   site/{slug}/{YYYY-MM-DD-N}/  회차 — 낱장 명세서 + 시행착오 영수증
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { marked } from 'marked';
import { parse } from 'yaml';

const SITE_URL = 'https://luckyflowcompany.github.io/devlog';
const OUT = 'site';
const ENTRY_FILE = /^(\d{4}-\d{2}-\d{2})_(\d+)_(.+)\.md$/;
const STAGES = ['기획', '개발', '테스트', '출시'];
const STATUS_CLASS = { '개발 중': 'run', 테스트: 'run', 프로토타입: 'run', 출시: 'ok', 기획: 'run', 보류: 'hold' };

const warnings = [];
const warn = (msg) => warnings.push(msg);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// 인라인 마크다운(`코드`, **굵게**)만 HTML 로
const inline = (s) => marked.parseInline(String(s ?? ''));
const dot = (d) => d.replaceAll('-', '.');

// ---------- 읽기 ----------

function readProjects() {
  if (!existsSync('projects')) return [];
  return readdirSync('projects', { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readProject(join('projects', d.name)))
    .filter(Boolean)
    .sort((a, b) => (b.entries[0]?.key ?? '').localeCompare(a.entries[0]?.key ?? ''));
}

function readProject(dir) {
  const configPath = join(dir, 'project.yml');
  if (!existsSync(configPath)) return warn(`${dir}: project.yml 없음 — 건너뜀`);
  const p = parse(readFileSync(configPath, 'utf8'));
  p.dir = dir;
  p.code ??= p.slug.slice(0, 2).toUpperCase();
  p.roadmap ??= [];
  if (!STAGES.includes(p.stage)) warn(`${dir}: stage 는 ${STAGES.join('/')} 중 하나`);
  const entriesDir = join(dir, 'entries');
  p.entries = existsSync(entriesDir)
    ? readdirSync(entriesDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => readEntry(p, join(entriesDir, f)))
        .filter(Boolean)
        .sort((a, b) => b.key.localeCompare(a.key, undefined, { numeric: true }))
    : [];
  p.entries.forEach((e, i) => (e.no = `${p.code}-${String(p.entries.length - i).padStart(4, '0')}`));
  return p;
}

function readEntry(project, file) {
  const m = basename(file).match(ENTRY_FILE);
  if (!m) return warn(`${file}: 파일명이 YYYY-MM-DD_N_주제.md 가 아님 — 건너뜀`);
  const [, date, session] = m;
  const raw = readFileSync(file, 'utf8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = fm ? parse(fm[1]) : {};
  if (!meta.title) warn(`${file}: title 없음`);
  const key = `${date}_${session}`;
  return {
    key,
    url: `${date}-${session}`,
    date,
    title: meta.title ?? basename(file, '.md'),
    summary: meta.summary ?? '',
    version: meta.version != null ? String(meta.version) : null,
    cover: meta.cover,
    assetsDir: join(project.dir, 'assets', key),
    sections: splitSections(fm ? raw.slice(fm[0].length) : raw),
  };
}

// "## 제목" 단위로 나누고, 끝의 <details> 바뀐 파일 블록은 따로 뗀다
function splitSections(body) {
  const out = {};
  const det = body.match(/<details>[\s\S]*?<\/details>/);
  if (det) {
    out.files = [...det[0].matchAll(/^- (.+)$/gm)].map((x) => x[1]);
    body = body.replace(det[0], '');
  }
  for (const part of body.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    out[part.slice(0, nl).trim()] = part.slice(nl + 1).trim();
  }
  return out;
}

// "- 항목 — 이유" 목록 → [{text, note}]
const items = (md) =>
  (md ?? '')
    .split('\n')
    .filter((l) => /^- /.test(l))
    .map((l) => {
      const [text, ...rest] = l.slice(2).split(' — ');
      return { text, note: rest.join(' — ') };
    });

// 시행착오: "- 문제: …" 아래 "  - 원인: / 해결: / 보류: …"
function trials(md) {
  const list = [];
  for (const line of (md ?? '').split('\n')) {
    const top = line.match(/^- 문제:\s*(.+)/);
    const sub = line.match(/^\s+- (원인|해결|보류):\s*(.+)/);
    if (top) list.push({ problem: top[1] });
    else if (sub && list.length) list.at(-1)[sub[1]] = sub[2];
  }
  return list;
}

// ---------- 공통 조각 ----------

const steps = (stage) => {
  const n = STAGES.indexOf(stage) + 1;
  return `<div class="steps">${STAGES.map((s, i) => `<div${i < n ? '' : ' class="off"'}>${s}</div>`).join('')}</div>`;
};
const badge = (status) => `<span class="badge ${STATUS_CLASS[status] ?? 'run'}">${esc(status)}</span>`;
const coverOf = (p, base) => {
  const e = p.entries.find((x) => x.cover);
  return e ? `${base}${e.url}/${e.cover}` : null;
};

function layout({ title, description, root, body, ogImage, path }) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1a1a1a">
<title>${esc(title ? `${title} — LuckyFlow Devlog` : 'LuckyFlow Devlog')}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:site_name" content="LuckyFlow Devlog">
<meta property="og:title" content="${esc(title || 'LuckyFlow Devlog')}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE_URL}/${path}">
${ogImage ? `<meta property="og:image" content="${SITE_URL}/${ogImage}"><meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=VT323&display=swap">
<link rel="stylesheet" href="${root}theme/style.css">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#1d1c1a"/><text x="16" y="21" text-anchor="middle" font-family="monospace" font-size="13" font-weight="700" fill="#eeebe3">LF</text></svg>')}">
</head>
<body>
${body}
</body>
</html>`;
}

const brand = (root) =>
  `<a class="brand" href="${root}"><i>LF</i><span><b>LuckyFlow Devlog</b><small>게임 개발 명세서</small></span></a>`;

// ---------- 대시보드 (명세 B) ----------

function dashboard(p, projects, root, base) {
  const tabs = projects
    .map((q) => `<a href="${root}${q.slug}/"${q === p ? ' class="on"' : ''}>${esc(q.name)} <small>${esc(q.status)}</small></a>`)
    .join('');
  const cover = coverOf(p, base);
  const rm = p.roadmap
    .map(
      (r) =>
        `<li class="${esc(r.state)}"><span class="dot"></span><div><b>${esc(r.title)}</b>${r.note ? `<small>${esc(r.note)}</small>` : ''}</div><span class="when">${esc(r.state === 'now' ? '진행 중' : r.date ?? (r.state === 'done' ? '완료' : '예정'))}</span></li>`,
    )
    .join('');
  const doneCount = p.roadmap.filter((r) => r.state === 'done').length;
  const nextUp = p.roadmap.find((r) => r.state === 'now') ?? p.roadmap.find((r) => r.state === 'next');
  const list =
    p.entries
      .map(
        (e) => `<li><a class="et" href="${base}${e.url}/" style="${e.cover ? `background-image:url('${base}${e.url}/${esc(e.cover)}')` : ''}" aria-label="${esc(e.title)}"></a>
<div><span class="lb">${e.no} · ${dot(e.date)}${e.version ? ` · v${esc(e.version)}` : ''}</span><h4><a href="${base}${e.url}/">${esc(e.title)}</a></h4><p>${esc(e.summary)}</p></div></li>`,
      )
      .join('') +
    (nextUp ? `<li class="ghost"><div class="et"></div><div><span class="lb">다음 회차 · 예정</span><h4>${esc(nextUp.title)}</h4><p>다음 세션에서 기록한다.</p></div></li>` : '');
  const body = `<div class="dash">
<header class="top">${brand(root)}</header>
<nav class="tabs">${tabs}</nav>
<main class="card">
 <section class="hero">
  <div class="cover"${cover ? ` style="background-image:url('${cover}')"` : ''}></div>
  <div><span class="lb">${esc(p.tagline ?? '')}${p.started ? ` · ${dot(String(p.started))} 시작` : ''}</span>
   <h1>${esc(p.name)}</h1><p>${esc(p.description ?? '')}</p>
   <div class="meta">${badge(p.status)}${(p.stack ?? []).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
   ${steps(p.stage)}</div>
 </section>
 <div class="cols">
  <section><div class="sec"><h2>로드맵${p.milestone ? ` — ${esc(p.milestone)}` : ''}</h2><span>${doneCount} / ${p.roadmap.length}</span></div><ul class="rm">${rm}</ul></section>
  <section><div class="sec"><h2>이 프로젝트의 회차</h2><span>최신순</span></div><ul class="el">${list}</ul></section>
 </div>
 <footer class="foot"><span>${nextUp ? `다음 · ${esc(nextUp.title)}` : ''}</span><span>${esc(p.name)}</span></footer>
</main>
</div>`;
  return layout({ title: p.name, description: p.description ?? p.tagline ?? '', root, body, ogImage: cover && cover.replace(/^(\.\.\/)+/, ''), path: `${p.slug}/` });
}

// ---------- 회차 (낱장 명세서) ----------

function itemTable(rows, noteHead) {
  if (!rows.length) return '';
  return `<table><tr><th>항목</th><th class="n">${noteHead}</th></tr>${rows
    .map((r) => `<tr><td><b>${inline(r.text)}</b></td><td class="n">${r.note ? inline(r.note) : '—'}</td></tr>`)
    .join('')}</table>`;
}

function entryPage(p, e, i) {
  const s = e.sections;
  const newer = p.entries[i - 1];
  const older = p.entries[i + 1];
  const add = items(s['추가']);
  const chg = items(s['변경']);
  const fix = items(s['수정']);
  const tr = trials(s['시행착오']);
  const next = items(s['다음']);
  const block = (title, html) => (html ? `<h3><span>${title}</span></h3>${html}` : '');
  const md = (x) =>
    x
      ? marked
          .parse(x)
          .replace(/<p>(<img [^>]+>)\s*<em>([\s\S]*?)<\/em><\/p>/g, '<figure>$1<figcaption>$2</figcaption></figure>')
          .replace(/<p>(<img [^>]+>)<\/p>\s*<p><em>([\s\S]*?)<\/em><\/p>/g, '<figure>$1<figcaption>$2</figcaption></figure>')
      : '';
  const trialRows = tr
    .map(
      (t, k) =>
        `<div class="trial${t['보류'] ? ' trial-hold' : ''}"><span class="lb">TRIAL_${String(k + 1).padStart(2, '0')} · ${t['보류'] ? '보류' : '해결'}</span><b>${inline(t.problem)}</b>${t['원인'] ? `<p><span>원인</span>${inline(t['원인'])}</p>` : ''}<p><span>${t['보류'] ? '보류' : '해결'}</span>${inline(t['보류'] ?? t['해결'] ?? '')}</p></div>`,
    )
    .join('');
  const receipt = tr.length
    ? `<div class="rc"><div class="c big">LUCKYFLOW DEV.</div><div class="c">시행착오 영수증</div><div class="r"><span>${e.no}</span><span>${dot(e.date)}</span></div><hr>
${tr.map((t, k) => `<div>${String(k + 1).padStart(2, '0')}. ${esc(t.problem)}</div><div class="ko">→ ${t['보류'] ? '보류' : esc(t['해결'] ?? '')}</div>`).join('')}<hr>
<div class="r"><span>해결</span><span>${tr.filter((t) => !t['보류']).length}</span></div><div class="r"><span>보류</span><span>${tr.filter((t) => t['보류']).length}</span></div></div>`
    : '';
  const body = `<div class="entry">
<div class="back"><a href="../">← ${esc(p.name)}</a></div>
<article class="inv">
 <div class="hd">${brand('../../')}<div class="t"><span class="lb">회차 명세서</span>${e.version ? `<span class="badge ok">v${esc(e.version)}</span>` : `<span class="badge run">기록</span>`}</div></div>
 <div class="meta4"><div><span class="lb">회차 NO</span><b>${e.no}</b></div><div><span class="lb">작성일</span><b>${dot(e.date)}</b></div><div><span class="lb">프로젝트</span><b>${esc(p.name)}</b></div><div><span class="lb">단계</span><b>${esc(p.stage)}</b></div></div>
 <h1>${esc(e.title)}</h1>${e.summary ? `<p class="sum">${esc(e.summary)}</p>` : ''}
 ${md(s['화면'])}
 ${block('추가', itemTable(add, '비고'))}
 ${block('변경', itemTable(chg, '이유'))}
 ${block('수정', itemTable(fix, '비고'))}
 ${block('시행착오', trialRows)}
 ${s['숫자'] ? block('숫자', `<div class="prose">${md(s['숫자'])}</div>`) : ''}
 ${s['감상'] ? block('감상', `<div class="note">${md(s['감상'])}</div>`) : ''}
 ${block('다음', next.length ? `<div class="nexts">${next.map((n) => `<div><span class="lb">예정</span><b>${inline(n.text)}</b></div>`).join('')}</div>` : '')}
 <nav class="pager">${older ? `<a href="../${older.url}/"><span class="lb">← 이전 회차</span>${esc(older.title)}</a>` : '<span></span>'}${newer ? `<a class="r" href="../${newer.url}/"><span class="lb">다음 회차 →</span>${esc(newer.title)}</a>` : '<span></span>'}</nav>
</article>
<aside class="side">${receipt}${s.files ? `<div class="mini"><span class="lb">바뀐 파일</span><ul>${s.files.map((f) => `<li>${inline(f)}</li>`).join('')}</ul></div>` : ''}</aside>
</div>`;
  return layout({
    title: `${e.title} · ${p.name}`,
    description: e.summary,
    root: '../../',
    body,
    ogImage: e.cover ? `${p.slug}/${e.url}/${e.cover}` : null,
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

if (projects.length) write('', dashboard(projects[0], projects, '', `${projects[0].slug}/`));
for (const p of projects) {
  write(p.slug, dashboard(p, projects, '../', ''));
  p.entries.forEach((e, i) => {
    write(join(p.slug, e.url), entryPage(p, e, i));
    if (existsSync(e.assetsDir)) cpSync(e.assetsDir, join(OUT, p.slug, e.url), { recursive: true });
    if (e.cover && !existsSync(join(e.assetsDir, e.cover))) warn(`${p.slug}/${e.key}: 커버 "${e.cover}" 없음`);
    for (const need of ['추가', '다음']) if (!e.sections[need]) warn(`${p.slug}/${e.key}: "## ${need}" 섹션 없음`);
  });
}

for (const w of warnings) console.warn(`⚠ ${w}`);
console.log(`site/ 생성 — 프로젝트 ${projects.length}개, 회차 ${projects.reduce((n, p) => n + p.entries.length, 0)}편`);
