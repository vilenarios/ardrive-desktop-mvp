# CORE-4 — ArFS Hide/Unhide support in ardrive-core-js (scoping)

Upstream dependency of SYNC-5 (desktop delete→hide). Reference implementation: **ardrive-web** (Dart). Read-only scoping 2026-07-03; cites `/mnt/c/source/ardrive-core-js` and `/mnt/c/source/ardrive-web`.

## The mechanism (mirror ardrive-web exactly)
Hide is **not** a new tx type, tag, or ArFS spec bump. It is a plain **new metadata revision** that adds one field to the entity's JSON metadata:
- **`isHidden: boolean`** — an optional field inside the entity metadata JSON (alongside `name`), NOT a plaintext GQL tag. ardrive-web: `file_entity.dart:39-40`, `folder_entity.dart:25-26`, `drive_entity.dart:28`; it's in `reservedJsonMetadataKeys`, not `reservedGqlTags`.
- Written via the same `prepareEntityDataItem` path as rename/move (`arweave_service.dart:1614-1628`). ArFS version stays `'0.15'` — **no spec bump**.
- **Public vs private**: identical to rename — public JSON is cleartext; private entities encrypt the whole JSON blob (name + isHidden + all) with the file/drive key. No hide-specific crypto path.
- **No cascade**: hiding a folder writes ONE revision for the folder entity only; children keep their own `isHidden`. "Effectively hidden" is computed by the caller walking ancestors, never stamped on descendants.
- **`lastModifiedDate` untouched**: ardrive-web does NOT bump the wire `lastModifiedDate` on hide (only its local DB `lastUpdated`). core-js must do the same — a genuine no-op on that field — so desktop's file-change detection (which keys off `lastModifiedDate`) isn't disturbed.
- **Filtering is the consumer's job**: core-js only (a) writes the revision and (b) surfaces `isHidden` on parsed entities. "Don't display / don't re-download" logic stays in desktop's sync-manager (ardrive-web filters purely at display: `drive_detail_data_list.dart:109` `items.where((i)=>!i.isHidden)`, plus a global `showHiddenFiles` user pref).
- Drives are hideable too in web (same mechanism) — see open Q1.

## Insertion points in core-js (mirror the rename methods — same 4 layers)
| Layer | File | Rename precedent to copy |
|---|---|---|
| Params | `src/types/ardrive_types.ts` | `RenamePublic/PrivateFileParams` :252-257; folder :259-264; drive :266-271 |
| Public API | `src/ardrive.ts` | `renamePublic/PrivateFile` :1493-1605; folder :1607-1719; drive :1720+ |
| DAO tx | `src/arfs/arfsdao.ts` | `renamePublicFile` :2162-2199; private :2201-2242; folder :2244+ |
| Tx JSON schema | `src/arfs/tx/arfs_tx_data_types.ts` | `ArFSPublic/PrivateFileMetadataTransactionData` :221-298; folder :147-206; `protectedDataJsonFields` guard :59-67 |
| Read-back builders | `arfs_builders/arfs_{file,folder}_builders.ts` | add `'isHidden'` to `protectedDataJsonKeys` (:51/:45); read in `buildEntity()` |
| Entity shapes | `src/arfs/arfs_entities.ts` | add `isHidden?: boolean` to `ArFSFileOrFolderEntity` + thread through the POSITIONAL constructors (:258-, :321-, :396-, :532-, :599-) — **widest blast radius; positional ctors touch every call site** |

`isHidden: boolean` fits existing `EntityMetaDataTransactionData = Record<string, JsonSerializable>` (`types.ts:34`, boolean is in the `JsonSerializable` union) — no type-system change. Include the key only when defined (mirror web's `includeIfNull:false`) so ordinary renames don't start emitting `isHidden:null`. Cost: reuse `estimateAndAssertCostOfFolderUpload` — no new estimator.

## Proposed API (mirrors public/private × file/folder)
`hide/unhide` × `Public/Private` × `File/Folder`: e.g. `hidePublicFile({fileId})`, `unhidePrivateFolder({folderId, driveKey})`. Action is baked into the method name (like move/rename); `Hide*Params` shared between hide and unhide. DAO methods are a "no-op rename" that re-writes name/size/dates/txids unchanged and flips only `isHidden`.

## Tests
Existing rename/move coverage is thin (only cost-estimator tests). Meet/exceed the bar: (1) builder round-trip tests — `isHidden` survives parse for public AND private (encrypted), absent when unset; (2) tx-data test — `isHidden` in JSON only when passed; (3) ≥1 DAO/ArDrive test stubbing wallet/GatewayAPI asserting `hide→true` / `unhide→false`.

## Open questions for Phil
1. **Scope**: file/folder only, or also drive-level hide (web supports it; core-js has `renamePrivateDrive` precedent — cheap add now vs later)?
2. **Cascade**: confirm "no cascade" like web (caller computes effective-hidden by walking ancestors).
3. **Filtering boundary**: confirm core-js stops at exposing `isHidden`; desktop sync-manager owns don't-display/don't-redownload.
4. **`lastModifiedDate`**: confirm hide is a genuine no-op on the wire field (recommended — protects desktop edit-detection).
5. **BASE BRANCH — see the dev/master finding below; needs Phil's re-confirmation.**
6. **Alpha prerelease**: cut `npm publish --tag alpha` from the branch before desktop consumes, or interim git/tarball dep?
7. **Ticket**: real `PE-####` for branch name.

## ⚠️ Release-lifecycle finding (contradicts the `dev` instruction)
- GitHub's **actual default branch is `master`**, not `dev` (`gh api repos/ardriveapp/ardrive-core-js` → `default_branch: master`; local `origin/HEAD→dev` is stale cache).
- **`dev` is dormant ~11 months**: `git log origin/master..dev` is EMPTY; `dev..master` is 15+ commits. Every merged PR since 2025-08 targeted `master`; both currently-open PRs target `master`. The historical `dev`→alpha→`master` pipeline has been dormant.
- semantic-release is NOT active (the `.releaserc` only ever lived on an unmerged 2021 branch); publishing is manual (`chore: bump version` + hand-edited CHANGELOG). npm dist-tags today: `latest: 4.0.0`, `alpha: 3.0.3-alpha.0` (stale Aug-2025), `beta` dead.
- **Consequence**: PRing to `dev` builds on an 11-month-stale base and risks stranding. `master` is where active development is. This needs Phil's re-decision (he said `dev` before seeing this).

Full analysis: research agent transcript 2026-07-03.
