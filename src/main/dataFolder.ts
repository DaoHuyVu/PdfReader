import { join } from 'path'

/** The Data Folder holds all Document data. See docs/adr/0002. */
export function resolveDataFolder(env: Record<string, string | undefined>): string {
  if (env.PDFREADER_DATA_DIR) return env.PDFREADER_DATA_DIR
  // Personal OneDrive only; work/school OneDrive (%OneDrive% / %OneDriveCommercial%) is
  // deliberately ignored so personal reading data never syncs into an employer tenant.
  if (env.OneDriveConsumer) return join(env.OneDriveConsumer, 'PdfReaderData')
  if (env.APPDATA) return join(env.APPDATA, 'PdfReader')
  throw new Error('Cannot resolve the data folder: neither OneDriveConsumer nor APPDATA is set')
}

export function documentsDir(dataFolder: string): string {
  return join(dataFolder, 'documents')
}
