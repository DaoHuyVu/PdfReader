import { join } from 'path'

/** The Data Folder holds all Document data. See docs/adr/0002. */
export function resolveDataFolder(env: Record<string, string | undefined>): string {
  if (env.PDFREADER_DATA_DIR) return env.PDFREADER_DATA_DIR
  if (env.OneDrive) return join(env.OneDrive, 'PdfReaderData')
  if (env.APPDATA) return join(env.APPDATA, 'PdfReader')
  throw new Error('Cannot resolve the data folder: neither OneDrive nor APPDATA is set')
}

export function documentsDir(dataFolder: string): string {
  return join(dataFolder, 'documents')
}
