/// <reference types="vite/client" />
import type { PdfReaderApi } from '../../shared/ipc'

declare global {
  interface Window {
    api: PdfReaderApi
  }
}

export {}
