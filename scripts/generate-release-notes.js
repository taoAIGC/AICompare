const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const docsDir = path.join(repoRoot, 'docs', 'release-notes');
const latestPath = path.join(docsDir, 'latest.md');
const historyPath = path.join(docsDir, 'history.md');
const mode = readEnv('RELEASE_NOTES_MODE', 'worktree').toLowerCase();
const commandInput = readEnv('RELEASE_NOTES_COMMAND');
const maxCommands = 100;

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function readEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniq(values) {
  return [...new Set(values)];
}

function getCurrentRefName() {
  return readEnv('GITHUB_REF_NAME') || runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
}

function getHeadSha() {
  return readEnv('GITHUB_SHA') || runGit(['rev-parse', 'HEAD']);
}

function getPreviousTag() {
  try {
    return runGit(['describe', '--tags', '--abbrev=0', 'HEAD^']);
  } catch (error) {
    return '';
  }
}

function readLatestCommands() {
  if (!fs.existsSync(latestPath)) {
    return [];
  }

  const content = fs.readFileSync(latestPath, 'utf8');
  const match = content.match(/<!-- COMMANDS:START -->([\s\S]*?)<!-- COMMANDS:END -->/);
  if (!match) {
    return [];
  }

  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^- /, '').trim())
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean);
}

function normalizeCommand(command) {
  return String(command || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toUserFacingRequest(command) {
  const normalized = normalizeCommand(command)
    .replace(/^已围绕这项功能完成改进：/i, '')
    .replace(/^希望优化这项功能体验：/i, '')
    .replace(/^已让/i, '让')
    .replace(/^已支持/i, '支持')
    .replace(/^已将/i, '将')
    .replace(/^已明确/i, '明确')
    .replace(/^希望/, '');
  if (!normalized) {
    return '';
  }

  const ignoreRules = [
    /(继续|继续吧|继续做|继续一下)$/i,
    /^(这个是如何生成的|这两个有什么区别)/i,
    /(不要记录这两个部分)/i
  ];

  if (ignoreRules.some((rule) => rule.test(normalized))) {
    return '';
  }

  const rules = [
    {
      test: /(联系我|contact).*(显示|展示).*(更新日志)/i,
      text: '已支持在联系页直接查看更新日志，方便用户了解最近有哪些变化。'
    },
    {
      test: /(github).*(打包).*(自动).*(保存|记录)/i,
      text: '已支持在 GitHub 打包时自动沉淀版本更新记录，减少手动整理成本。'
    },
    {
      test: /(用户视角).*(总结)|强调对用户的价值和帮助/i,
      text: '已将更新说明改为用户视角，重点说明功能带来的实际价值和帮助。'
    },
    {
      test: /(latest\.md).*(不要记录改动的文件).*(记录我发出的命令)|记录我发出的命令/i,
      text: '已支持沉淀开发过程中的需求方向，方便后续回看产品是如何一步步改进的。'
    },
    {
      test: /(不需要每条命令都记录).*(latest\.md)|只把针对功能的改进的要求/i,
      text: '已让需求日志只保留真正影响功能体验的改进诉求，避免被无关指令干扰。'
    },
    {
      test: /(latest\.md|history\.md).*(区别|文档)/i,
      text: '已明确版本记录职责，便于区分开发日志和面向用户的版本总结。'
    }
  ];

  const matched = rules.find((rule) => rule.test.test(normalized));
  if (matched) {
    return matched.text;
  }

  if (/(优化|改进|增加|新增|支持|显示|展示|记录|总结|自动)/i.test(normalized)) {
    return normalized;
  }

  return '';
}

function updateCommandLog(existingCommands, nextCommand) {
  const commands = existingCommands
    .map((entry) => toUserFacingRequest(entry) || '')
    .filter(Boolean)
    .map((entry) => `[${formatDate()}] ${entry}`);
  const userFacingRequest = toUserFacingRequest(nextCommand);
  if (userFacingRequest) {
    const entry = `[${formatDate()}] ${userFacingRequest}`;
    const lastEntry = commands[commands.length - 1] || '';
    if (!lastEntry.endsWith(userFacingRequest)) {
      commands.push(entry);
    }
  }

  return commands.slice(-maxCommands);
}

function buildLatestDoc({ generatedAt, branchName, headSha, commands }) {
  const shortSha = headSha.slice(0, 7);
  const commandLines = commands.length
    ? commands.map((entry) => `- ${entry}`)
    : ['- 暂时还没有记录到新的功能改进需求。'];

  return [
    '# User Improvement Request Log',
    '',
    `Updated at: ${generatedAt}`,
    `Branch: ${branchName}`,
    `Head: ${shortSha}`,
    '',
    '## Latest User-Facing Improvement Requests',
    '',
    '<!-- COMMANDS:START -->',
    ...commandLines,
    '<!-- COMMANDS:END -->',
    ''
  ].join('\n');
}

function extractCommandsForSummary(content) {
  const match = content.match(/<!-- COMMANDS:START -->([\s\S]*?)<!-- COMMANDS:END -->/);
  if (!match) {
    return [];
  }

  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^- /, '').trim())
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter(Boolean);
}

function mapCommandsToHighlights(commands) {
  const commandText = commands.join('\n');
  const highlights = [];

  const rules = [
    {
      test: /(联系我|contact).*(更新日志|release|history|latest)/i,
      text: '现在可以在联系页直接查看版本更新内容，不用再额外找发布说明。'
    },
    {
      test: /(github).*(打包|package).*(自动|保存|记录)/i,
      text: '打包流程会自动整理版本更新说明，发布时的信息同步更完整。'
    },
    {
      test: /(latest\.md).*(命令|需求)|记录我发出的命令/i,
      text: '开发过程中的用户需求会被连续记录，后续回看版本演进会更清楚。'
    },
    {
      test: /(功能体验的改进诉求|功能改进需求|用户改进需求)/i,
      text: '需求日志只保留真正影响体验的改进方向，版本总结会更聚焦。'
    },
    {
      test: /(history\.md).*(用户视角|总结)|用户视角做总结/i,
      text: '每个打包版本都会补上一份用户视角总结，更容易看懂这版具体带来了什么帮助。'
    },
    {
      test: /(不要记录改动的文件|不要记录文件|全量的改动)/i,
      text: '更新记录的重点更贴近真实需求，而不是被文件列表淹没。'
    },
    {
      test: /(智能体|agent)/i,
      text: '智能体相关能力继续完善，任务型使用场景会更顺手。'
    },
    {
      test: /(语言|文案|i18n|多语言)/i,
      text: '多语言和界面文案得到补强，不同语言环境下使用会更自然。'
    },
    {
      test: /(分享|share|链接)/i,
      text: '分享链路更清晰，结果转发、留存和协作会更方便。'
    }
  ];

  for (const rule of rules) {
    if (rule.test.test(commandText)) {
      highlights.push(rule.text);
    }
  }

  if (!highlights.length && commands.length) {
    highlights.push('这一版围绕最近的用户需求继续打磨，实际使用流程会更贴近日常场景。');
  }

  if (!highlights.length) {
    highlights.push('这一版继续提升整体可用性和版本说明清晰度。');
  }

  return uniq(highlights).slice(0, 5).map((line) => `- ${line}`);
}

function buildReleaseEntry({ releaseName, generatedAt, compareRange, highlights }) {
  const packagedDate = generatedAt.split(' ')[0] || generatedAt;
  return [
    `### ${packagedDate}`,
    ...highlights,
    ''
  ].join('\n');
}

function parseHistoryEntries(content) {
  return String(content || '')
    .replace(/<!-- RELEASE_ENTRY:START -->/g, '')
    .replace(/<!-- RELEASE_ENTRY:END -->/g, '')
    .replace(/^## .+$/gm, '')
    .replace(/^- Change range:.*$/gim, '')
    .replace(/^- Generated at:.*$/gim, '')
    .replace(/^### 本版更新亮点$/gim, '')
    .split(/\n{2,}(?=###\s)/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith('### '));
}

function updateReleaseHistory({ releaseName, generatedAt, compareRange, highlights }) {
  const entry = buildReleaseEntry({ releaseName, generatedAt, compareRange, highlights });
  const existing = fs.existsSync(historyPath) ? fs.readFileSync(historyPath, 'utf8') : '';
  const entries = uniq(parseHistoryEntries(existing)).filter((block) => block !== entry.trim());

  const next = [
    entry,
    ...(entries.length ? ['', ...entries] : []),
    ''
  ].join('\n');

  fs.writeFileSync(historyPath, next);
}

function writeLatestCommands() {
  const generatedAt = formatDate();
  const branchName = getCurrentRefName();
  const headSha = getHeadSha();
  const existingCommands = readLatestCommands();
  const commands = updateCommandLog(existingCommands, commandInput);
  const content = buildLatestDoc({
    generatedAt,
    branchName,
    headSha,
    commands
  });

  fs.writeFileSync(latestPath, content);
}

function appendReleaseSummary() {
  const generatedAt = formatDate();
  const refName = getCurrentRefName();
  const sha = getHeadSha();
  const shortSha = sha.slice(0, 7);
  const previousTag = getPreviousTag();
  const compareRange = previousTag ? `${previousTag}..${shortSha}` : '';
  const latestContent = fs.existsSync(latestPath) ? fs.readFileSync(latestPath, 'utf8') : '';
  const commands = extractCommandsForSummary(latestContent);
  const highlights = mapCommandsToHighlights(commands);
  const releaseName = `${refName}-${shortSha}`;

  updateReleaseHistory({
    releaseName,
    generatedAt,
    compareRange,
    highlights
  });
}

function main() {
  ensureDir(docsDir);

  if (mode === 'worktree') {
    writeLatestCommands();
    return;
  }

  if (mode === 'release') {
    appendReleaseSummary();
    return;
  }

  throw new Error(`Unsupported RELEASE_NOTES_MODE: ${mode}`);
}

main();
