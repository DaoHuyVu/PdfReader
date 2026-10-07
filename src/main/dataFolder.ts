import { join } from 'path'
import type { DataFolderSource } from '../shared/settings'

/**
 * The Data Folder holds all Document data. See docs/adr/0002.
 * Order: PDFREADER_DATA_DIR, the folder chosen in Settings, personal OneDrive, local APPDATA.
 * Work/school OneDrive (%OneDrive% / %OneDriveCommercial%) is deliberately ignored so personal
 * reading data never syncs into an employer tenant.
 */
export function describeDataFolder(
  env: Record<string, string | undefined>,
  configured: string | null = null
): { path: string; source: DataFolderSource } {
  if (env.PDFREADER_DATA_DIR) return { path: env.PDFREADER_DATA_DIR, source: 'env' }
  if (configured) return { path: configured, source: 'settings' }
  if (env.OneDriveConsumer) return { path: join(env.OneDriveConsumer, 'PdfReaderData'), source: 'onedrive' }
  if (env.APPDATA) return { path: join(env.APPDATA, 'PdfReader'), source: 'appdata' }
  throw new Error('Cannot resolve the data folder: neither OneDriveConsumer nor APPDATA is set')
}

export function resolveDataFolder(env: Record<string, string | undefined>, configured: string | null = null): string {
  return describeDataFolder(env, configured).path
}

export function documentsDir(dataFolder: string): string {
  return join(dataFolder, 'documents')
}
