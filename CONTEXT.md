# PdfReader

A personal desktop PDF reader that remembers where you stopped reading and lets you highlight text, without modifying the original PDF files.

## Language

### Documents

**Document**:
A PDF identified by its content, not its file path. Renamed, moved, or identical copies of the same file are the same Document.
_Avoid_: File, book, PDF (when meaning the identity rather than the bytes)

**Document Fingerprint**:
The content-derived identity of a Document, stable across renames, moves, and machines.
_Avoid_: ID, path, hash (in conversation)

**Recent Documents**:
The list of Documents recently opened on this machine, each shown with its reading progress.
_Avoid_: History, library

### Reading

**Reading Position**:
The single, automatically saved place where the reader stopped in a Document: page, scroll offset within the page, and zoom. Each Document has at most one.
_Avoid_: Bookmark, last page, progress

**Reading Progress**:
How far through a Document the Reading Position is, expressed as a percentage.
_Avoid_: Position

### Annotation

**Highlight**:
A colored mark over a contiguous span of text in a Document. A span that crosses a page break is still one Highlight.
_Avoid_: Annotation, mark, selection

**Highlight Color**:
One of a small fixed palette of colors a Highlight can have.

**Note**:
Optional free text attached to exactly one Highlight.
_Avoid_: Comment, annotation

**Unanchored Highlight**:
A Highlight whose text can no longer be found in the Document after its data was carried over from an earlier version. Still listed, but not drawn on any page.
_Avoid_: Broken highlight, orphan

**Carry Over**:
Moving the Reading Position and Highlights from an earlier version of a file to its changed version, which has a new Document Fingerprint. Done only after the user confirms.
_Avoid_: Migrate, relink

**Deleted Highlight**:
A record that a Highlight was removed, kept so that merging data from another machine does not bring it back.
_Avoid_: Tombstone (in UI text)

### Sync

**Data Folder**:
The folder holding all Document data, by default inside the user's OneDrive so every machine sees the same data.
_Avoid_: Database, storage, profile

**Conflict Copy**:
A duplicate of a Document's data file that OneDrive creates when two machines changed it while out of sync; the app merges it back.
_Avoid_: Duplicate, backup

### Output

**Export**:
Producing a new PDF file that contains the Document's Highlights and Notes as standard PDF annotations. The original file is never changed.
_Avoid_: Save, flatten
