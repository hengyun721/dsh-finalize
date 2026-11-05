# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-11-05

### Changed

- The punctuation check now judges only text the assistant produced. Paragraphs
  that match a document the user supplied are reported as `inherited` (note, not
  a problem), and a finding whose local signature also occurs in that document is
  `convention` — the assistant followed the template's own style, correct even
  when the style is non-standard (for example `一:` instead of `一：`).
- Any existing text, including paragraphs the user edited, is only ever reported:
  the plugin never rewrites it.

### Added

- Automatic template detection: the newest sibling Office file that is older than
  the delivery and shares at least 25% of its paragraphs (minimum 3) becomes the
  baseline. `textCheck.templates` pins explicit paths, `textCheck.baseline: false`
  disables detection.

## [0.5.0] - 2026-11-05

### Added

- PDF text extraction for the punctuation check: object streams (`/Type /ObjStm`),
  Flate content streams, `Tj` / `TJ` / `'` operators, literal and hex strings,
  and per-font `ToUnicode` CMaps including Identity-H CID fonts.
- Files with no readable text layer (scans, outline text, fonts without a
  `ToUnicode` map) are reported as *not checked* instead of being guessed at.

### Fixed

- List and section numbers (`1.`, `3.2`, `1)`) are no longer reported as
  punctuation errors when they precede Chinese text.

## [0.4.0] - 2026-11-05

### Added

- Punctuation check for document text: detects the paragraph language (`zh`,
  `ja`, `ko`, `en`, `fr`, `de`) and reports punctuation that does not belong to
  it — ASCII marks inside Chinese/Japanese text, fullwidth marks inside Latin or
  Korean text, the Chinese comma in Japanese, spaces before punctuation,
  repeated marks and unbalanced quotes.
- Skips URLs, e-mail addresses, paths and decimals; spreadsheet cells are only
  checked when longer than eight characters. PDF text layers are not checked.
- `textCheck.punctuation` and `textCheck.languages` configuration.

## [0.3.0] - 2026-11-02

### Added

- OpenDocument adapters: `odt`, `ods`, `odp` (`meta:generator`, creator, dates,
  `meta:document-statistic`, thumbnail and manifest entry).
- `mimetype` entries are written uncompressed and stay first, as ODF requires.

### Fixed

- `dc:creator` and `dcterms:modified` replacements no longer drop namespace
  declarations that ODF writers place on the element itself.

## [0.2.0] - 2026-11-02

### Added

- `pptx` adapter: slide/notes/hidden-slide statistics, cropped-image residue,
  missing speaker notes.
- `xlsx` adapter: `TitlesOfParts` alignment, formula count, pivot cache,
  external links, hidden sheets.
- `pdf` inspector: producer/creator/XMP, incremental updates, bookmarks,
  encryption, signatures. Read-only.
- Several files per delivery are processed independently; repeated deliveries
  merge into one session report for 30 minutes.

## [0.1.0] - 2026-11-02

### Added

- Initial release: `docx` adapter, pre-delivery `tools/pre-execute` hook on
  `present` / `qqbot_send_file`, zero-token design, message action panel.
