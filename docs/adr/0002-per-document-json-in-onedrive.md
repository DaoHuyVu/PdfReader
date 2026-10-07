# Store data as one JSON file per Document in a OneDrive folder

Reading data syncs between machines by living in a OneDrive folder (`%OneDriveConsumer%\PdfReaderData`), with one JSON file per Document named by its Fingerprint, written atomically (temp file + rename). We rejected a single SQLite database because OneDrive syncs whole files without understanding locks, so concurrent use on two machines can corrupt it or produce an unmergeable conflict copy; per-Document files confine conflicts to one Document and keep them mergeable. Work/school OneDrive (`%OneDrive%` / `%OneDriveCommercial%`) is deliberately ignored so personal reading data never syncs into an employer tenant; without a personal OneDrive the data stays local in `%APPDATA%\PdfReader`.

## Consequences

- The app must detect OneDrive conflict copies (e.g. `<fingerprint>-LAPTOP.json`), merge them, and delete the extra file.
- Merge rules: Reading Position takes the most recently updated value; Highlights are unioned by id, and deletions are kept as tombstones so a deleted Highlight does not come back after a merge.
- Cross-Document queries (e.g. "all Notes everywhere") require scanning files; acceptable at personal-library scale.
