import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PdfReaderApi } from '../shared/ipc'

const api: PdfReaderApi = {
  getContext: () => ipcRenderer.invoke(IPC.getContext),
  readDocumentBytes: () => ipcRenderer.invoke(IPC.readDocumentBytes),
  loadDocumentData: () => ipcRenderer.invoke(IPC.loadDocumentData),
  reportReadingPosition: (reading, pageCount) => ipcRenderer.send(IPC.reportReadingPosition, reading, pageCount),
  openFileDialog: () => ipcRenderer.invoke(IPC.openFileDialog),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  listRecent: () => ipcRenderer.invoke(IPC.listRecent)
}

contextBridge.exposeInMainWorld('api', api)
