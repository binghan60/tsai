// PostToolUse hook：Edit/Write 改到會左右 CLAUDE.md 內容的檔案時，提醒同步更新那份文件。
//
// 為什麼是提醒而不是自動改：判斷「這次改動有沒有讓 CLAUDE.md 失準」需要讀懂改了什麼，
// shell 腳本做不到。這個 hook 負責的是「不要忘記」，實際的更新仍由 Claude 判斷後執行。
//
// 讀 stdin 的 hook input JSON，命中時把提醒寫回 Claude 的 context（additionalContext）。

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 每一類對應 CLAUDE.md 裡的一個段落，提醒時直接指出要看哪一節。
const CATEGORIES = [
  { id: 'models', test: /server\/src\/models\//, hint: 'Mongoose schema 或索引 → 第二節「資料模型」' },
  { id: 'routes', test: /server\/src\/routes\//, hint: 'API 路由 → 第五節「API 設計」' },
  { id: 'router', test: /client\/src\/router\//, hint: '前端路由 → 第六節「頁面規劃」' },
  { id: 'pages', test: /client\/src\/pages\//, hint: '前端頁面 → 第六節「頁面規劃」' },
  { id: 'deps', test: /(^|\/)package\.json$/, hint: '套件或開發指令 → 第三節「技術棧」、第八節「開發與驗證」' },
];

let raw = '';
process.stdin.on('data', (chunk) => {
  raw += chunk;
});

process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  // Windows 路徑是反斜線，統一成斜線再比對。
  const filePath = String(input.tool_input?.file_path ?? '').replace(/\\/g, '/');
  if (!filePath) process.exit(0);
  // 改 CLAUDE.md 本身、測試檔或套件內容都不需要提醒。
  if (/node_modules|\.test\.mjs$|\.test\.js$|CLAUDE\.md$/.test(filePath)) process.exit(0);

  const hit = CATEGORIES.find((category) => category.test.test(filePath));
  if (!hit) process.exit(0);

  // 同一個 session 內每一類只提醒一次。一次改五個路由檔卻收到五則一樣的訊息，
  // 只會讓提醒變成雜訊而被忽略。
  const markerDir = join(tmpdir(), 'claude-md-hook');
  const sessionId = String(input.session_id ?? 'nosession').replace(/[^\w-]/g, '');
  const marker = join(markerDir, `${sessionId}-${hit.id}`);
  try {
    mkdirSync(markerDir, { recursive: true });
    if (existsSync(marker)) process.exit(0);
    writeFileSync(marker, '');
  } catch {
    // 標記寫不進去就照常提醒——重複提醒比整個漏掉好。
  }

  process.stdout.write(
    JSON.stringify({
      suppressOutput: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `[CLAUDE.md 同步檢查] 這次動到了 ${filePath}（${hit.hint}）。` +
          '收尾前確認 CLAUDE.md 該段落是否已經失準，需要就一起更新。' +
          '若只是重構、修 bug 或調樣式，沒有改變資料模型／路由／頁面／技術選型，就不必動它。',
      },
    })
  );
});
