const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const readmePath = path.join(repoRoot, 'README.md');
const startMarker = '<!-- AUTO-README-STATUS:START -->';
const endMarker = '<!-- AUTO-README-STATUS:END -->';

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim();
}

function formatDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const minutes = pad(Math.abs(offsetMinutes) % 60);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} UTC${sign}${hours}:${minutes}`;
}

function getStagedChanges() {
  const output = runGit(['diff', '--cached', '--name-status', '--diff-filter=ACMR']);

  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...fileParts] = line.split('\t');
      return {
        status,
        file: fileParts.join('\t')
      };
    })
    .filter((entry) => entry.file !== 'README.md');
}

function getRecentCommits(limit = 5) {
  const output = runGit(['log', `-n${limit}`, '--pretty=format:%h%x09%cs%x09%s']);

  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, date, subject] = line.split('\t');
      return { hash, date, subject };
    });
}

function buildSection() {
  const stagedChanges = getStagedChanges();
  const recentCommits = getRecentCommits();

  const stagedLines = stagedChanges.length
    ? stagedChanges.map(({ status, file }) => `- \`${status}\` \`${file}\``)
    : ['- No staged file changes detected besides `README.md`.'];

  const commitLines = recentCommits.length
    ? recentCommits.map(({ hash, date, subject }) => `- \`${hash}\` ${date} ${subject}`)
    : ['- No commit history found yet.'];

  return [
    startMarker,
    '## Development Snapshot / 开发快照',
    '',
    `Last auto-update / 最近自动更新：${formatDate()}`,
    '',
    '### Staged changes for this commit / 本次提交暂存变更',
    ...stagedLines,
    '',
    '### Recent commits / 最近提交',
    ...commitLines,
    '',
    '_This section is maintained automatically by `scripts/update-readme.js` via `.githooks/pre-commit`._',
    endMarker
  ].join('\n');
}

function updateReadme() {
  const original = fs.readFileSync(readmePath, 'utf8');
  const section = buildSection();
  const blockPattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);

  let nextContent;

  if (blockPattern.test(original)) {
    nextContent = original.replace(blockPattern, section);
  } else {
    nextContent = `${original.trimEnd()}\n\n---\n\n${section}\n`;
  }

  if (nextContent !== original) {
    fs.writeFileSync(readmePath, nextContent);
  }
}

updateReadme();
