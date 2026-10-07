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
  },
  carryOver: {
    title: 'File đã thay đổi',
    message: (fileName: string) => `"${fileName}" đã thay đổi kể từ lần đọc trước.`,
    detail: (highlightCount: number) =>
      `Chuyển vị trí đọc và ${highlightCount} highlight từ bản cũ sang bản này? ` +
      'Highlight có thể lệch nếu nội dung trang đã thay đổi.',
    yes: 'Chuyển',
    no: 'Không'
  },
  highlight: {
    colors: { yellow: 'Vàng', green: 'Xanh lá', blue: 'Xanh dương', pink: 'Hồng', orange: 'Cam' },
    colorButton: (colorName: string, key: number) => `${colorName} (phím ${key})`,
    saveFailed: 'Không lưu được highlight. Thử lại sau.',
    note: 'Ghi chú',
    notePlaceholder: 'Thêm ghi chú…',
    saveNote: 'Lưu',
    delete: 'Xóa highlight',
    panelTitle: 'Highlight',
    togglePanel: 'Danh sách highlight (Ctrl+B)',
    search: 'Tìm trong highlight…',
    empty: 'Chưa có highlight nào. Bôi đen chữ để tạo highlight.',
    noMatch: 'Không có highlight phù hợp.',
    unanchored: 'Mất neo: không tìm thấy đoạn này trong bản hiện tại',
    page: (pageNumber: number) => `Trang ${pageNumber}`
  }
}
