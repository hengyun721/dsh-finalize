# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
