import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type PdfReaderApi } from '../shared/ipc'
import type { Settings } from '../shared/settings'

const api: PdfReaderApi = {
  getContext: () => ipcRenderer.invoke(IPC.getContext),
  readDocumentBytes: () => ipcRenderer.invoke(IPC.readDocumentBytes),
  loadDocumentData: () => ipcRenderer.invoke(IPC.loadDocumentData),
  reportReadingPosition: (reading, pageCount) => ipcRenderer.send(IPC.reportReadingPosition, reading, pageCount),
  saveHighlight: (highlight) => ipcRenderer.invoke(IPC.saveHighlight, highlight),
  deleteHighlight: (id) => ipcRenderer.invoke(IPC.deleteHighlight, id),
  openFileDialog: () => ipcRenderer.invoke(IPC.openFileDialog),
  openPath: (path) => ipcRenderer.invoke(IPC.openPath, path),
  listRecent: () => ipcRenderer.invoke(IPC.listRecent),
  flushReadingPosition: () => ipcRenderer.send(IPC.flushReadingPosition),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  onSettingsChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, settings: Settings) => listener(settings)
    ipcRenderer.on(IPC.settingsChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC.settingsChanged, handler)
    }
  },
  getDataFolderInfo: () => ipcRenderer.invoke(IPC.getDataFolderInfo),
  chooseDataFolder: () => ipcRenderer.invoke(IPC.chooseDataFolder),
  relaunchApp: () => ipcRenderer.send(IPC.relaunchApp),
  exportPdf: (annotations) => ipcRenderer.invoke(IPC.exportPdf, annotations)
}

contextBridge.exposeInMainWorld('api', api)
