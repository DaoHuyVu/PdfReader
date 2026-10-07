export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

/** Per-machine preferences, stored by main in <userData>\settings.json. */
export interface Settings {
  /** Data Folder chosen by the user, or null for the default. Applies after restart. */
  dataFolder: string | null
  theme: Theme
  /** Invert page colors for reading at night. */
  invertPages: boolean
}

export const DEFAULT_SETTINGS: Settings = { dataFolder: null, theme: 'system', invertPages: false }

export type DataFolderSource = 'env' | 'settings' | 'onedrive' | 'appdata'

export interface DataFolderInfo {
  /** The Data Folder the current settings point to. */
  path: string
  source: DataFolderSource
  /** True when `path` differs from the folder this running app uses. */
  restartNeeded: boolean
}
