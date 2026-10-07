# Identify Documents by content, not file path

All per-Document data (Reading Position, Highlights, Notes) is keyed by a Document Fingerprint derived from the file's content (a hash of the first few MB plus the file size), not by its path. Users rename and move PDFs, and the same PDF lives at different paths on different machines once data syncs through OneDrive; path-keyed data would be lost or split in all of these cases.

## Consequences

- Byte-identical copies of a PDF share one set of Highlights and one Reading Position. This is intended: they are the same Document.
- If another program modifies the PDF's bytes (e.g. saves annotations into it), its Fingerprint changes and it becomes a new Document.
- Recent Documents still stores a path per machine, because a Fingerprint alone cannot locate a file.
