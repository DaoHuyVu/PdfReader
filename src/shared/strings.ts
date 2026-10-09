import type { ExportResult, OpenResult } from './ipc'

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
    fitPage: 'Vừa trang',
    toggleSidebar: 'Thanh bên (Ctrl+B)',
    invertPages: 'Đảo màu trang',
    passwordCancelled: 'File có mật khẩu nên chưa mở.',
    noTextLayer: 'File không có lớp text (có thể là bản scan), nên không highlight hay tìm kiếm được.',
    dismiss: 'Đóng',
    emptyDocument: 'File PDF không có trang nào.'
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
    tab: 'Highlight',
    search: 'Tìm trong highlight…',
    empty: 'Chưa có highlight nào. Bôi đen chữ để tạo highlight.',
    noMatch: 'Không có highlight phù hợp.',
    unanchored: 'Mất neo: không tìm thấy đoạn này trong bản hiện tại',
    page: (pageNumber: number) => `Trang ${pageNumber}`
  },
  outline: {
    tab: 'Mục lục',
    empty: 'File này không có mục lục.',
    expand: 'Mở rộng',
    collapse: 'Thu gọn'
  },
  search: {
    open: 'Tìm (Ctrl+F)',
    placeholder: 'Tìm trong tài liệu…',
    count: (current: number, total: number) => `${current} / ${total}`,
    none: 'Không thấy',
    searching: 'Đang tìm…',
    previous: 'Kết quả trước (Shift+Enter)',
    next: 'Kết quả tiếp (Enter)',
    close: 'Đóng (Esc)'
  },
  password: {
    title: 'File có mật khẩu',
    need: 'Nhập mật khẩu để mở file này.',
    incorrect: 'Sai mật khẩu. Thử lại.',
    ok: 'Mở',
    cancel: 'Hủy'
  },
  settings: {
    open: 'Cài đặt',
    title: 'Cài đặt',
    back: '← Tài liệu gần đây',
    dataFolder: 'Thư mục dữ liệu',
    dataFolderHelp:
      'Nơi lưu vị trí đọc và highlight. Chọn một thư mục trong OneDrive cá nhân để đồng bộ giữa các máy.',
    source: {
      env: 'Đang dùng biến môi trường PDFREADER_DATA_DIR',
      settings: 'Thư mục bạn đã chọn',
      onedrive: 'OneDrive cá nhân (mặc định)',
      appdata: 'Chỉ trên máy này (mặc định, vì không có OneDrive cá nhân)'
    },
    choose: 'Chọn thư mục…',
    chooseTitle: 'Chọn thư mục dữ liệu',
    useDefault: 'Dùng mặc định',
    restartNeeded: 'Khởi động lại PdfReader để dùng thư mục mới. Dữ liệu cũ không tự chuyển sang.',
    restart: 'Khởi động lại',
    theme: 'Giao diện',
    themes: { system: 'Theo Windows', light: 'Sáng', dark: 'Tối' },
    invertPages: 'Đảo màu trang PDF (đọc ban đêm)'
  },
  export: {
    button: 'Xuất PDF có highlight',
    dialogTitle: 'Xuất PDF có highlight',
    nothing: 'Chưa có highlight để xuất.',
    done: (path: string) => `Đã xuất file:
${path}`,
    failed(result: Extract<ExportResult, { ok: false }>): string {
      if (result.reason === 'same-file') return 'Không thể ghi đè lên file gốc. Hãy chọn tên khác.'
      if (result.reason === 'encrypted') return 'File được bảo vệ (mã hóa) nên chưa xuất được.'
      if (result.reason === 'changed') return 'File đã thay đổi trên đĩa. Hãy mở lại file rồi xuất.'
      return `Xuất PDF thất bại.

${result.message ?? ''}`
    }
  }
}
