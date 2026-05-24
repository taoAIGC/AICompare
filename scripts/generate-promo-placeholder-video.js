const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const root = process.cwd();
const outDir = path.join(root, 'generated', 'promo-placeholder');
const framesDir = path.join(outDir, 'frames');
const fontStack = `-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif`;

const scenes = [
  {
    id: 'scene-01',
    duration: 3.0,
    voice: '还在一个个打开 AI，一个个复制问题吗？',
    eyebrow: 'HOOK',
    title: '还在一个个打开 AI？',
    body: '同一个问题，来回复制、切网页、等结果。这个流程太慢了。',
    placeholder: '后期替换建议：\n插入多窗口切换、复制粘贴的真实录屏',
    accent: '#ff6b57'
  },
  {
    id: 'scene-02',
    duration: 4.0,
    voice: 'AI Compare，把多个 AI 放进同一个标签页。',
    eyebrow: 'SETUP',
    title: '一个标签页\n同时放下多个 AI',
    body: '这是产品的核心卖点。镜头要让人一眼看懂结构。',
    placeholder: '后期替换建议：\n插入插件首页或品牌主界面截图',
    accent: '#111111'
  },
  {
    id: 'scene-03',
    duration: 4.0,
    voice: '输入一次问题，同时发给 ChatGPT、Claude、Gemini。',
    eyebrow: 'ACTION',
    title: '输入一次\n同时发给多个 AI',
    body: '镜头重点不是输入框，而是“一次输入，多路发送”。',
    placeholder: '后期替换建议：\n插入输入问题并点击 PK 的录屏',
    accent: '#2a6df4'
  },
  {
    id: 'scene-04',
    duration: 3.5,
    voice: '不用切网页，不用复制粘贴。',
    eyebrow: 'VALUE',
    title: '不用切网页\n不用复制粘贴',
    body: '这一段是效率价值，要干净、短、狠。',
    placeholder: '后期替换建议：\n插入同屏对比画面或多列结果截图',
    accent: '#16a34a'
  },
  {
    id: 'scene-05',
    duration: 4.5,
    voice: '谁回答更快，谁更清楚，谁更适合你的任务，一眼就能看出来。',
    eyebrow: 'PAYOFF',
    title: '谁更快\n谁更清楚\n一眼看出来',
    body: '这不是功能，是结果。让观众感受到“判断成本下降”。',
    placeholder: '后期替换建议：\n插入三列答案对比、复制结果、标注亮点',
    accent: '#7c3aed'
  },
  {
    id: 'scene-06',
    duration: 3.5,
    voice: '这就是 AI Compare，让多 AI 对比，变成一个动作。',
    eyebrow: 'CLOSE',
    title: 'AI Compare',
    body: '让多 AI 对比，变成一个动作。',
    placeholder: '后期替换建议：\n插入 Logo、口号、下载或安装引导',
    accent: '#111111'
  }
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: 'pipe', ...options });
}

function writeText(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function buildSceneHtml(scene) {
  const placeholderLines = scene.placeholder.split('\n').map((line) => `<div>${line}</div>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    :root {
      --accent: ${scene.accent};
      --bg1: #f8f6f1;
      --bg2: #ffffff;
      --bg3: #eef4ff;
      --ink: #111111;
      --muted: #4b5563;
      --line: rgba(17,17,17,0.08);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 1440px;
      height: 900px;
      overflow: hidden;
      font-family: ${fontStack};
      background:
        radial-gradient(circle at 15% 20%, rgba(255,255,255,0.92), transparent 38%),
        radial-gradient(circle at 85% 80%, rgba(90,138,255,0.12), transparent 28%),
        linear-gradient(135deg, var(--bg1), var(--bg2) 54%, var(--bg3));
      color: var(--ink);
    }
    .wrap {
      position: relative;
      width: 100%;
      height: 100%;
      padding: 56px;
      display: grid;
      grid-template-columns: 1.05fr 0.95fr;
      gap: 28px;
    }
    .panel {
      border-radius: 34px;
      background: rgba(255,255,255,0.82);
      box-shadow: 0 24px 80px rgba(17,17,17,0.10);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.6);
    }
    .copy {
      padding: 52px 48px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 22px;
      letter-spacing: 0.28em;
      color: var(--muted);
      margin-bottom: 26px;
    }
    .eyebrow::before {
      content: "";
      width: 38px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
    }
    h1 {
      margin: 0;
      font-size: 78px;
      line-height: 0.98;
      letter-spacing: -0.05em;
      white-space: pre-line;
    }
    p {
      margin: 28px 0 0;
      font-size: 30px;
      line-height: 1.45;
      color: var(--muted);
      max-width: 90%;
    }
    .timeline {
      margin-top: 34px;
      display: flex;
      gap: 10px;
    }
    .timeline span {
      height: 10px;
      border-radius: 999px;
      background: rgba(17,17,17,0.08);
      flex: 1;
    }
    .timeline span.active {
      background: var(--accent);
      flex: 1.4;
    }
    .mock {
      position: relative;
      padding: 22px;
      overflow: hidden;
    }
    .mock-inner {
      width: 100%;
      height: 100%;
      border-radius: 26px;
      border: 2px dashed rgba(17,17,17,0.18);
      background:
        linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,248,248,0.95)),
        repeating-linear-gradient(90deg, rgba(17,17,17,0.02), rgba(17,17,17,0.02) 1px, transparent 1px, transparent 33.333%);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      padding: 36px;
      position: relative;
    }
    .badge {
      position: absolute;
      top: 20px;
      left: 20px;
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(17,17,17,0.86);
      color: #fff;
      font-size: 18px;
      letter-spacing: 0.08em;
    }
    .mock-grid {
      width: 88%;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 28px;
    }
    .mock-grid span {
      height: 220px;
      border-radius: 20px;
      background: linear-gradient(180deg, rgba(255,255,255,0.8), rgba(240,240,240,0.95));
      border: 1px solid rgba(17,17,17,0.06);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
      position: relative;
      overflow: hidden;
    }
    .mock-grid span::before {
      content: "";
      position: absolute;
      top: 18px;
      left: 16px;
      right: 16px;
      height: 16px;
      border-radius: 999px;
      background: rgba(17,17,17,0.08);
    }
    .mock-grid span::after {
      content: "";
      position: absolute;
      top: 48px;
      left: 16px;
      right: 16px;
      bottom: 16px;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(17,17,17,0.035), transparent);
    }
    .placeholder-title {
      font-size: 38px;
      font-weight: 700;
      letter-spacing: -0.03em;
      margin-bottom: 18px;
    }
    .placeholder-lines {
      font-size: 25px;
      line-height: 1.45;
      color: #374151;
    }
    .caption {
      position: absolute;
      left: 56px;
      right: 56px;
      bottom: 28px;
      padding: 18px 22px;
      border-radius: 24px;
      background: rgba(17,17,17,0.88);
      color: #ffffff;
      font-size: 28px;
      line-height: 1.35;
      text-align: center;
      box-shadow: 0 20px 45px rgba(17,17,17,0.24);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="panel copy">
      <div class="eyebrow">${scene.eyebrow}</div>
      <h1>${scene.title}</h1>
      <p>${scene.body}</p>
      <div class="timeline">
        ${scenes.map((item) => `<span class="${item.id === scene.id ? 'active' : ''}"></span>`).join('')}
      </div>
    </section>
    <section class="panel mock">
      <div class="mock-inner">
        <div class="badge">PLACEHOLDER SHOT</div>
        <div class="mock-grid"><span></span><span></span><span></span></div>
        <div class="placeholder-title">这里替换真实截图或录屏</div>
        <div class="placeholder-lines">${placeholderLines}</div>
      </div>
    </section>
  </div>
  <div class="caption">${scene.voice}</div>
</body>
</html>`;
}

async function renderFrames() {
  ensureDir(framesDir);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  for (const scene of scenes) {
    const html = buildSceneHtml(scene);
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: path.join(framesDir, `${scene.id}.png`) });
  }

  await browser.close();
}

function buildVoice() {
  const voiceText = scenes.map((scene) => scene.voice).join('\n');
  const voicePath = path.join(outDir, 'voice.txt');
  writeText(voicePath, voiceText);
  run('say', ['-v', 'Eddy (Chinese (China mainland))', '-r', '285', '-f', voicePath, '-o', path.join(outDir, 'voice.aiff')]);
}

function buildSceneVideos() {
  for (const scene of scenes) {
    const input = path.join(framesDir, `${scene.id}.png`);
    const output = path.join(outDir, `${scene.id}.mp4`);
    run('ffmpeg', [
      '-y',
      '-loop', '1',
      '-i', input,
      '-t', String(scene.duration),
      '-r', '25',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      output
    ]);
  }
}

function concatVideo() {
  const listPath = path.join(outDir, 'concat.txt');
  const listText = scenes
    .map((scene) => `file '${path.join(outDir, `${scene.id}.mp4`).replace(/'/g, "'\\''")}'`)
    .join('\n');
  writeText(listPath, listText);
  run('ffmpeg', [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    path.join(outDir, 'video-noaudio.mp4')
  ]);
}

function muxFinal() {
  run('ffmpeg', [
    '-y',
    '-i', path.join(outDir, 'video-noaudio.mp4'),
    '-i', path.join(outDir, 'voice.aiff'),
    '-filter_complex', '[1:a]adelay=180|180,volume=1.5[a]',
    '-map', '0:v',
    '-map', '[a]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-shortest',
    path.join(outDir, 'promo-placeholder-final.mp4')
  ]);
}

function writeScript() {
  const lines = [
    '# Promo Placeholder Video',
    '',
    '这是一条可后期替换素材的宣传片底片。',
    '',
    '## Scene Plan',
    ...scenes.flatMap((scene, index) => [
      `${index + 1}. ${scene.voice}`,
      `   - 时长：${scene.duration}s`,
      `   - 替换建议：${scene.placeholder.replace(/\n/g, ' / ')}`
    ]),
    '',
    '## Assets',
    `- Final video: ${path.join('generated', 'promo-placeholder', 'promo-placeholder-final.mp4')}`,
    `- Voice: ${path.join('generated', 'promo-placeholder', 'voice.aiff')}`
  ];
  writeText(path.join(outDir, 'README.md'), lines.join('\n'));
}

async function main() {
  ensureDir(outDir);
  await renderFrames();
  buildVoice();
  buildSceneVideos();
  concatVideo();
  muxFinal();
  writeScript();
  console.log(path.join(outDir, 'promo-placeholder-final.mp4'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
