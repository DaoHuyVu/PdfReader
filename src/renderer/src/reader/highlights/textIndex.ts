import type { HighlightPart, HighlightRect } from '../../../../shared/documentData'

/** One piece of text pdf.js reports for a page, with its box in page units (scale 1, origin top-left). */
export interface TextRun {
  pageIndex: number
  text: string
  rect: HighlightRect
  /** True when the PDF marks a line break after this run. */
  hasEOL: boolean
}

interface CharRef {
  run: number
  /** Index of the source character inside `Array.from(run.text)`. */
  offset: number
}

export interface TextIndex {
  runs: TextRun[]
  /** Folded text of the whole Document: lower-case, no diacritics, single spaces. */
  text: string
  /** Source of each UTF-16 unit of `text`; null for spaces inserted at line ends and page breaks. */
  refs: (CharRef | null)[]
}

/** A match in `TextIndex.text`, as the half-open range [start, end). */
export interface TextMatch {
  start: number
  end: number
}

export function foldChar(char: string): string {
  const lower = char.toLowerCase()
  if (lower === 'đ') return 'd'
  return lower.normalize('NFD').replace(/\p{M}/gu, '')
}

const isSpace = (text: string) => /^\s+$/.test(text)

export function foldText(text: string): string {
  let out = ''
  for (const char of text) {
    const folded = foldChar(char)
    if (folded === '') continue
    if (isSpace(folded)) {
      if (out !== '' && !out.endsWith(' ')) out += ' '
    } else {
      out += folded
    }
  }
  return out.trimEnd()
}

export function buildTextIndex(runs: TextRun[]): TextIndex {
  let text = ''
  const refs: (CharRef | null)[] = []
  const pushSpace = (ref: CharRef | null) => {
    if (text !== '' && !text.endsWith(' ')) {
      text += ' '
      refs.push(ref)
    }
  }
  runs.forEach((run, runIndex) => {
    if (runIndex > 0 && runs[runIndex - 1].pageIndex !== run.pageIndex) pushSpace(null)
    Array.from(run.text).forEach((char, offset) => {
      const folded = foldChar(char)
      if (folded === '') return
      if (isSpace(folded)) {
        pushSpace({ run: runIndex, offset })
        return
      }
      for (let i = 0; i < folded.length; i++) {
        text += folded[i]
        refs.push({ run: runIndex, offset })
      }
    })
    if (run.hasEOL) pushSpace(null)
  })
  return { runs, text, refs }
}

export function findText(index: TextIndex, query: string, from = 0): TextMatch | null {
  const needle = foldText(query).trim()
  if (needle === '') return null
  const start = index.text.indexOf(needle, from)
  return start === -1 ? null : { start, end: start + needle.length }
}

export function findAllText(index: TextIndex, query: string): TextMatch[] {
  const matches: TextMatch[] = []
  let from = 0
  for (;;) {
    const match = findText(index, query, from)
    if (!match) return matches
    matches.push(match)
    from = match.end
  }
}

export function matchToParts(index: TextIndex, match: TextMatch): HighlightPart[] {
  const spans = new Map<number, { min: number; max: number }>()
  for (let i = match.start; i < match.end; i++) {
    const ref = index.refs[i]
    if (!ref) continue
    const span = spans.get(ref.run)
    if (!span) spans.set(ref.run, { min: ref.offset, max: ref.offset })
    else {
      span.min = Math.min(span.min, ref.offset)
      span.max = Math.max(span.max, ref.offset)
    }
  }
  const byPage = new Map<number, HighlightRect[]>()
  for (const [runIndex, { min, max }] of [...spans.entries()].sort((a, b) => a[0] - b[0])) {
    const run = index.runs[runIndex]
    const length = Math.max(1, Array.from(run.text).length)
    const rect: HighlightRect = {
      x: run.rect.x + (run.rect.width * min) / length,
      y: run.rect.y,
      width: (run.rect.width * (max + 1 - min)) / length,
      height: run.rect.height
    }
    const rects = byPage.get(run.pageIndex) ?? []
    rects.push(rect)
    byPage.set(run.pageIndex, rects)
  }
  return [...byPage.entries()].sort((a, b) => a[0] - b[0]).map(([pageIndex, rects]) => ({ pageIndex, rects }))
}
