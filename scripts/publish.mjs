// 프로젝트 리포의 devlog/ 를 허브의 projects/{slug}/ 로 복사한다 (DEVLOG_SPEC §9).
// 사용: npm run publish -- ~/Documents/Git/LogOffWeb
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const projectDir = process.argv[2];
if (!projectDir) {
  console.error('사용: npm run publish -- <프로젝트 경로>');
  process.exit(1);
}
const src = resolve(projectDir, 'devlog');
const configPath = join(src, 'project.yml');
if (!existsSync(configPath)) {
  console.error(`project.yml 이 없다: ${configPath}`);
  process.exit(1);
}
const { slug } = parse(readFileSync(configPath, 'utf8'));
if (!/^[a-z0-9-]+$/.test(slug ?? '')) {
  console.error(`slug 는 영소문자·숫자·하이픈만: "${slug}"`);
  process.exit(1);
}

const dest = resolve('projects', slug);
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true, filter: (p) => !p.endsWith('.DS_Store') });
console.log(`복사 완료: ${src} → projects/${slug}/`);
