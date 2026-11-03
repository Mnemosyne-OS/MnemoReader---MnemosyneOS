# Maintaining reader notes

## Responsibilities

- `BookNotes` coordinates selection, note storage, chapter expansion, and navigation.
- `BookNoteEntry` owns a highlight's unsaved comment/color draft. Failed saves keep
  that draft open; successful saves close the editor.
- `FloatingNotes` handles movement, resizing, and viewport constraints.
- `BookColorKey` and `HighlightColorPicker` handle per-book color meanings and colors.
- `noteChapters` groups populated chapters and preserves front-matter highlights.
- `annotations` reads and validates local notes and migrates the old array format.
- `bookSearch` performs literal matching within the open book and its notes.
- `notesVaultSync` reconciles notes; `catalogueSync` reconciles book metadata. Both
  reach the host through `readerVault`, the one place that knows the spines, the
  part size and the 15 s deadline on every host call.
- `syncLoop` decides when a pass runs: on a change, never on a clock, with a growing
  delay while a pass fails the same way. The hooks wire it to the UI events.

The original library, extraction, and audio paths remain in their existing modules.

## Saving and reconciliation

Local writes happen before change events. A failed local write must not appear saved
or trigger a successful remote state. Corrupt stored notes are reported rather than
replaced with an empty version.

Each remote note part starts with a marker containing its book ID. Catalogue records
use a different marker. Write replacements first, persist their IDs, then forget the
superseded rows, then finalize the journal: a retry after a partial failure never
deletes the last saved version before its replacement exists.

Only a row the host lists NOW with this book's marker is ever forgotten. An ID from
the journal alone can name another row after the sandbox was purged (its IDs start
again). A row already gone is the outcome asked for, not an error. An unreadable
journal or deletion queue is reset with a warning and rebuilt from the markers.

Catalogue migration accepts untagged legacy records only when their title, author,
and format exactly match the current book. It does not guess reversed names or make
book-specific corrections. Ambiguous old records require explicit user review.
Deleting a local book's notes uses an explicit deletion queue; a book missing on
another device is not deletion consent. Catalogue records and archived book text
are not purged by note deletion.

The host lists at most the 200 newest entries of the vault. A row past that listing
cannot be verified, so it is never forgotten: a deleted book whose copies are past
it stays in the deletion queue until they are seen again. The journal is trusted
only to avoid writing again what a full listing no longer shows (the host embeds
before it deduplicates, so a needless write costs an embedding). Clearing browser
storage can lose unsynced work. This feature syncs retrieval snapshots, not
collaborative editable notes across devices.

## Spines, and three host behaviours

The catalogue uses `READER_BOOK`; notes use `READER_NOTES` for their first part (one
per annotated book, which the vault tile counts) and `READER_NOTES_PART` for the
rest. An app may store its own UPPER_SNAKE spine in its own sandbox; the host then
takes its document path. The first version of this sync used `SOCIAL_CONTACT` and
`SOCIAL_NODE`, which the host treats as scraped social content:

- social spines are near-deduplicated on their first 1000 characters, and a match
  returns the OLD row's ID, so an edit past the note header was never stored;
- `SOCIAL_NODE` and `SOCIAL_CONTACT` go through the PromptShield, which refuses an
  ordinary quote such as "You are now the keeper of the lantern" (and a title such
  as "You Are Now Less Dumb");
- when inline embedding fails the host re-chunks at 2000 characters and returns the
  first ID only. Every part therefore stays under 1800 characters.

`src/test/fakeVaultHost.ts` models all three, so the tests fail the way the vault
does. Rows written by the first version (v1 markers) are recognised and replaced.

The cartridge never unlocks permanence, changes vault governance, or runs its own
Dream engine. The sandbox is left out of Dream until the person unlocks it, and
Dream selects chronicles by a list of spine categories that app spines are not in
yet: reader notes reach chat recall once unlocked, not Dream scans. Quoted passages
remain distinguishable from reader comments and general notes.

## Review checks

From `apps/mnemo-reader` in the workspace: `npx tsc --noEmit`, the test files you
touched, and `npx eslint` on the files you changed. The published `dist/` is
rebuilt from these sources on release, never edited by hand. Every UI string goes
through `t()` with a key in all seven locales (`src/i18n/i18n.test.ts` checks it).

For host validation, save a general note and a highlight/comment, reopen the reader,
verify persistence and navigation, and check retrieval sources in a new chat scoped
to the reader vault. Edit a comment late in a long note and check the vault row
changed. Change book metadata and verify catalogue replacement preserves notes.
