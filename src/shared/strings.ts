import type { OpenResult } from './ipc'

export const t = {
  appName: 'PdfReader',
  menu: {
    file: 'Tệp',
    open: 'Mở PDF…',
    recent: 'Tài liệu gần đây',
    quit: 'Thoát',
    view: 'Xem'
  },
  dialog: {
    openTitle: 'Mở PDF',
    pdfFilter: 'Tài liệu PDF',
    openFailedTitle: 'Không mở được file'
  },
  openError(path: string, result: Extract<OpenResult, { ok: false }>): string {
    if (result.reason === 'missing') return `Không tìm thấy file:\n${path}`
    if (result.reason === 'not-pdf') return `File không phải PDF:\n${path}`
    return `Lỗi khi mở file:\n${path}\n\n${result.message ?? ''}`
  },
  home: {
    title: 'Tài liệu gần đây',
    open: 'Mở PDF…',
    empty: 'Chưa mở tài liệu nào. Bấm "Mở PDF…" hoặc Ctrl+O.',
    missing: 'Không tìm thấy file',
    notStarted: 'Chưa đọc'
  },
  reader: {
    loading: 'Đang tải…',
    loadFailed: 'Không đọc được file PDF.',
    page: (current: number, total: number) => `Trang ${current} / ${total}`,
    zoomIn: 'Phóng to (Ctrl +)',
    zoomOut: 'Thu nhỏ (Ctrl -)',
    fitWidth: 'Vừa chiều ngang',
    fitPage: 'Vừa trang'
  }
}
