import { describe, expect, it } from 'vitest'
import type { Highlight } from '../../../../shared/documentData'
import { buildExportAnnotations, type ToPdfPoint } from './buildAnnotations'

// Page-unit point (origin top-left) -> PDF point (origin bottom-left) on an 800-unit-high page shifted 10 right.
const toPdf: ToPdfPoint = (_pageIndex, x, y) => [x + 10, 800 - y]

function hl(id: string, parts: Highlight['parts'], extra: Partial<Highlight> = {}): Highlight {
  return { id, color: 'yellow', note: null, text: id, parts, createdAt: 1, updatedAt: 1, ...extra }
}

describe('buildExportAnnotations', () => {
  it('turns each part into quad points and a bounding rect in PDF space', () => {
    const highlight = hl(
      'a',
      [
        { pageIndex: 0, rects: [{ x: 0, y: 100, width: 50, height: 10 }] },
        {
          pageIndex: 1,
          rects: [
            { x: 5, y: 0, width: 20, height: 10 },
            { x: 5, y: 20, width: 30, height: 10 }
          ]
        }
      ],
      { note: 'remember' }
    )
    expect(buildExportAnnotations([highlight], toPdf)).toEqual([
      {
        pageIndex: 0,
        quadPoints: [10, 700, 60, 700, 10, 690, 60, 690],
        rect: [10, 690, 60, 700],
        color: [1, 0.89, 0.2],
        note: 'remember'
      },
      {
        pageIndex: 1,
        quadPoints: [15, 800, 35, 800, 15, 790, 35, 790, 15, 780, 45, 780, 15, 770, 45, 770],
        rect: [15, 770, 45, 800],
        color: [1, 0.89, 0.2],
        note: null
      }
    ])
  })

  it('skips Unanchored Highlights and empty parts', () => {
    const lost = hl('lost', [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 1, height: 1 }] }], { status: 'unanchored' })
    const empty = hl('empty', [{ pageIndex: 0, rects: [] }])
    expect(buildExportAnnotations([lost, empty], toPdf)).toEqual([])
  })

  it('skips carried Highlights that are not yet re-anchored', () => {
    const carried = hl('carried', [{ pageIndex: 0, rects: [{ x: 0, y: 0, width: 1, height: 1 }] }], {
      status: 'carried'
    })
    expect(buildExportAnnotations([carried], toPdf)).toEqual([])
  })

  it('puts the Note on the first exported part when an earlier part is empty', () => {
    const highlight = hl(
      'b',
      [
        { pageIndex: 0, rects: [] },
        { pageIndex: 1, rects: [{ x: 0, y: 0, width: 10, height: 10 }] }
      ],
      { note: 'n' }
    )
    expect(buildExportAnnotations([highlight], toPdf).map((a) => a.note)).toEqual(['n'])
  })
})
