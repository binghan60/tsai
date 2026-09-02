import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const sourceRoot = path.resolve('src')
const sourceExtensions = new Set(['.vue', '.js', '.css'])
const paletteNames = [
  'red', 'rose', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald',
  'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia',
  'pink', 'slate', 'gray', 'zinc', 'neutral', 'stone',
]

const stockPalettePattern = new RegExp(`\\b(?:${paletteNames.join('|')})-(?:50|100|200|300|400|500|600|700|800|900|950)\\b`, 'g')
const literalColorPattern = /#[0-9a-f]{3,8}\b|(?:rgb|rgba|hsl|hsla)\s*\(/gi

function withoutComments(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(fullPath)
    return sourceExtensions.has(path.extname(entry.name)) ? [fullPath] : []
  }))
  return nested.flat()
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

function collectMatches(file, source, pattern, rule, findings) {
  pattern.lastIndex = 0
  for (const match of source.matchAll(pattern)) {
    findings.push({
      file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
      line: lineNumber(source, match.index),
      rule,
      value: match[0],
    })
  }
}

function collectActionSemantics(file, source, findings) {
  for (const match of source.matchAll(/<Button\b[\s\S]*?<\/Button>/g)) {
    const button = match[0]
    if (button.includes('<Pencil') && !/variant=["']secondary["']/.test(button)) {
      findings.push({
        file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
        line: lineNumber(source, match.index),
        rule: '編輯按鈕必須使用 secondary',
        value: 'Pencil',
      })
    }
    if (button.includes('<Trash2') && !/variant=["']destructive(?:-solid|-outline)?["']/.test(button)) {
      findings.push({
        file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
        line: lineNumber(source, match.index),
        rule: '刪除按鈕必須使用 destructive 系列',
        value: 'Trash2',
      })
    }
  }

  for (const match of source.matchAll(/<ConfirmDialog\b[\s\S]*?(?:\/>|<\/ConfirmDialog>)/g)) {
    const dialog = match[0]
    const dangerousConfirm = /confirm-label=["'][^"']*(?:刪除|捨棄|撤銷|永久移除)[^"']*["']/.test(dialog)
    if (dangerousConfirm && !/\bdestructive(?:\s|=|\/?>)/.test(dialog)) {
      findings.push({
        file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
        line: lineNumber(source, match.index),
        rule: '危險確認視窗必須標記 destructive',
        value: 'ConfirmDialog',
      })
    }
  }
}

const findings = []
for (const file of await sourceFiles(sourceRoot)) {
  if (path.basename(file) === 'style.css') continue
  const source = withoutComments(await readFile(file, 'utf8'))
  collectMatches(file, source, stockPalettePattern, '請改用語意色 token', findings)
  collectMatches(file, source, literalColorPattern, '色碼只能定義在 src/style.css', findings)
  if (path.extname(file) === '.vue') collectActionSemantics(file, source, findings)
}

if (findings.length) {
  console.error('Color audit failed:')
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.rule}（${finding.value}）`)
  }
  process.exitCode = 1
} else {
  console.log('Color audit passed: no stock palette classes or literal colors outside src/style.css.')
}
