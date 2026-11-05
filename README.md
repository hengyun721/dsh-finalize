# dsh-finalize

[![ci](https://github.com/hengyun721/dsh-finalize/actions/workflows/ci.yml/badge.svg)](https://github.com/hengyun721/dsh-finalize/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**English** | [简体中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that runs **one finalize pass the moment a file is delivered** — and nowhere else. It strips the fingerprints document libraries leave behind, recomputes the statistics that are actually derivable, and puts everything it **will not** fabricate into a side panel instead of writing it into the file.

> **Design rule: fix what is provably wrong, never invent evidence.**
> Edit time, revision history, comments and "was written by a human" claims are reported, not written. `Application` is removed rather than replaced with a fake `Microsoft Office Word 16.0` string — absence is unremarkable, a lie contradicts the rest of the package.

## Why this exists

Documents produced by `python-docx`, `python-pptx`, `openpyxl` or LibreOffice carry their own birth certificate: a creator field naming the library, a 2013 template date, `Words=0` on a forty-page report, a leftover template thumbnail. Those are bugs, not style choices, and anyone who unzips the file can see them.

The usual advice — forge the edit time, invent a revision count — makes things worse. It contradicts the fields you cannot change (the `rsid` trail, the real save history) and collapses the moment someone looks. This plugin takes the honest half: normalize what is wrong, report what only a human can supply.

## What it does

| Format | Automatic fixes | Reported, never fixed |
|---|---|---|
| `docx` | creator and description, template date, `Application`/`AppVersion`, word/character/paragraph/line counts, template thumbnail | `TotalTime=0`, missing comments, missing tracked changes, page count |
| `pptx` | same core properties, slide/notes/hidden-slide counts, word counts | no speaker notes, cropped images still in `ppt/media`, hidden slides |
| `xlsx` | core properties, `TitlesOfParts` aligned to sheet names | zero formulas, pivot cache retaining deleted rows, external links, hidden sheets |
| `odt` `ods` `odp` | `meta:generator`, creator, dates, `meta:document-statistic`, thumbnail and its manifest entry | `meta:editing-duration=PT0S`, single save cycle, no annotations, no tracked changes |
| `pdf` | **nothing — read-only by design** | Producer/Creator/XMP, incremental updates, missing bookmarks, signatures, punctuation in extractable text |

Several files in one delivery are processed independently. Several deliveries in one session merge into a single report for 30 minutes instead of overwriting each other.

## Text checks

When a document is delivered, its paragraphs are also checked for punctuation that does not match their language. The language is detected per paragraph from script counts (Han / Kana / Hangul / Latin), and Latin paragraphs are separated into English, French and German by diacritics and stop words.

| Language | Expected | Flagged example |
|---|---|---|
| Chinese | `，。！？；：、（）“”` | `这是测试,包含逗号` |
| Japanese | `、。「」『』` | `テスト，です` |
| Korean | ASCII `, . ? !` | `테스트，입니다` |
| English / French / German | ASCII, plus each language's own quotes (`« »`, `„ “`) | `sentence，with` |

Also flagged: spaces before punctuation, three or more repeated marks, and unbalanced `“ ”` / `「 」` / `『 』`.

Findings are **reported, never rewritten** — a blind character swap damages code, URLs, formulas and citations far more often than it helps. URLs, e-mail addresses, paths, decimals and list numbers (`1.`, `3.2`) are skipped entirely; spreadsheet cells are only checked when longer than eight characters.

PDF text is decoded from the text layer: Flate content streams, `Tj`/`TJ` operators and per-font `ToUnicode` maps, including Identity-H CID fonts, so Word and LibreOffice exports are covered. Scanned pages, fonts without a `ToUnicode` map and text drawn as outlines cannot be read — those files are reported as *not checked* rather than guessed at.

**Only your own text is judged.** When the delivered document reuses paragraphs from a file the user supplied, those paragraphs are treated as the template: they are never listed as problems, and their punctuation style becomes the accepted style for new text — a template that writes `一:` makes the assistant's `二:` correct, not an error. Text the user edited themselves falls into the same bucket: noted, never changed.

Detection is automatic: the newest sibling Office file that is older than the delivery and shares at least a quarter of its paragraphs (minimum three) becomes the baseline. `textCheck.templates` pins explicit paths, `textCheck.baseline: false` turns detection off.

## Install

The plugin is a DSH bundle — a plain package with a `dsh.bundle.patch`; there is no build step and no runtime dependency.

```bash
git clone https://github.com/hengyun721/dsh-finalize.git
dsh plugin --profile desktop add /absolute/path/to/dsh-finalize
```

Or from inside the Harness, install the checkout directory with the plugin manager (`install_bundle`, target = the absolute path above). Restart once if it reports `restart-required`.

## Usage

Nothing to call. Deliver a file with `present` (or a configured transport) and the pass runs **before** the tool executes, so the file on disk is already normalized when it reaches the recipient. The text check runs only for delivered documents — ordinary chat replies are never scanned.

A shield icon appears in the message action row next to copy / like / dislike / branch:

| State | Meaning |
|---|---|
| grey | no delivery in this session yet |
| amber with a count | that many items need a human |
| click | panel with `fixed` / `open` / `read-only` rows per file |

The panel also offers **Scan recent files**, which runs the pass on the newest Office files in the working directory without a delivery — handy when a document was produced by a script rather than through `present`.

## Configuration

```yaml
- id: dsh-finalize
  name: 'dsh-finalize'
  config:
    author: ''
    triggerTools: [present, qqbot_send_file]
    formats: [docx, pptx, xlsx, pdf, odt, ods, odp]
    scanLimit: 5
    autoFix:
      stripGeneratorFields: true
      dropApplicationField: true
      recomputeStats: true
    textCheck:
      punctuation: true
      languages: [zh, ja, en, fr, ko, de]
      templates: []
      baseline: true
    report:
      surface: panel
```

| Key | Type | Default | Description |
|---|---|---|---|
| `author` | string | `''` | Written into `dc:creator`, `lastModifiedBy` and `meta:initial-creator`. Empty clears generator names without inventing a person. |
| `triggerTools` | string[] | `present`, `qqbot_send_file` | Delivery tools that trigger the pass. |
| `formats` | string[] | all seven | Adapter whitelist; anything else is reported as `skipped`. |
| `scanLimit` | number | `5` | How many recent files **Scan recent files** processes. |
| `autoFix.stripGeneratorFields` | boolean | `true` | Remove library names and `generated by …` descriptions. |
| `autoFix.dropApplicationField` | boolean | `true` | Remove `Application`/`AppVersion` instead of faking an Office version. |
| `autoFix.recomputeStats` | boolean | `true` | Recompute word/character/paragraph counters from the body. |
| `textCheck.punctuation` | boolean | `true` | Run the punctuation check on document text. |
| `textCheck.languages` | string[] | all six | Language codes the checker may flag: `zh`, `ja`, `ko`, `en`, `fr`, `de`. |
| `textCheck.templates` | string[] | `[]` | Explicit template paths, relative to the delivered file. |
| `textCheck.baseline` | boolean | `true` | Auto-detect the template by paragraph overlap when no explicit path is set. |
| `report.surface` | `panel` \| `silent` | `panel` | Whether the action-row button renders. |

## Repository layout

| Path | Responsibility |
|---|---|
| `index.js` | Host half. Registers the `tools/pre-execute` hook on the delivery tools, routes each file to an adapter, merges per-session reports, and serves `/api/finalize.report` and `/api/finalize.scan`. Registers no tool and no prompt section. |
| `client.js` | Browser half. Registers the shield button into `conversation.chat.assistant-actions` and renders the report panel (fixed overlay, theme tokens, no DOM writes outside its own tree). |
| `lib/office.js` | Format engine, dependency-free. ZIP reader/writer (`node:zlib`), OOXML adapters (`docx`/`pptx`/`xlsx`), ODF adapter (`odt`/`ods`/`odp`), read-only PDF inspector. |
| `lib/punctuation.js` | Text checker. Per-paragraph language detection (`zh`/`ja`/`ko`/`en`/`fr`/`de`) and the punctuation rules; returns grouped findings with snippets and suggested replacements. |
| `lib/pdf-text.js` | Heuristic PDF text extraction: object streams, Flate content streams, `Tj`/`TJ` decoding and `ToUnicode` CMaps. Used only for the punctuation check; it never writes. |
| `cordis.patch.yml` | Bundle patch: inserts the `dsh-finalize` row and the default config. This is what `install_bundle` applies to the profile. |
| `package.json` | Package manifest: `dsh.bundle.patch`, the `dsh.client` web half (`platform`, `immediately`, `inject`), the export map, and the `check` / `test` scripts. |
| `locale/en.json`, `locale/zh.json` | Display metadata read by the Plugin Manager and Settings without activating the plugin: `meta.title`, `meta.description`. |
| `icon.svg` | Original plugin icon (document + check), used in the plugin inventory and bundle details. |
| `test/smoke.test.mjs` | Four `node:test` cases: ODF rewrite, docx rewrite, PDF inspector, non-ZIP rejection. Fixtures are built in memory; nothing on disk. |
| `.github/workflows/ci.yml` | CI on push and pull request: Node 20, `npm run check`, then `npm test`. |
| `CHANGELOG.md` | Version history in Keep-a-Changelog format. |
| `LICENSE` | MIT. |
| `README.md` | This document. |
| `README.zh.md` | Chinese translation. |

### Engine map

`lib/office.js` is deliberately one file with a flat API:

| Symbol | Role |
|---|---|
| `readZip(buffer)` | Parse the central directory into `{ name, data, time, date }` entries. No ZIP64. |
| `writeZip(entries)` | Rebuild the archive with `deflateRaw`. Entries named `mimetype` are stored uncompressed and keep their position, as ODF requires. |
| `finalizeDocx` / `finalizePptx` / `finalizeXlsx` | OOXML adapters; they share `fixCore`, `stripApplication`, `dropThumbnail` and `commonUnresolved`. |
| `finalizeOdf` | ODF adapter over `meta.xml` and `META-INF/manifest.xml`. |
| `inspectPdf` | Regex-level PDF inspector; returns observations only and never rewrites bytes. |
| `finalizeOffice(bytes, kind, options)` | Dispatcher used by the Host half. |

## Compatibility

Built to sit beside other plugins without changing their behaviour.

- **No tool, no prompt section.** Nothing is added to the model's tool list or system prompt, so token accounting and tool selection are untouched.
- **One passive listener.** `tools/pre-execute` runs only for the configured delivery tools, always returns `next()`, and swallows its own failures, so it can neither block nor rewrite another tool's call.
- **No transport coupling.** It hooks the delivery tool, not a transport, so QQ, Web and CLI transports keep working.
- **Namespaced surface.** Routes are `/api/finalize.report` and `/api/finalize.scan`; the slot id is `dsh-finalize`. Neither collides with the shipped `deliverables`, `changes.*` or `presented` routes.
- **Opt-in debug only.** Nothing is written outside the delivered files unless `DSH_FINALIZE_DEBUG=1`.

## Limits

- Page counts need a layout engine; the plugin reports rather than guesses.
- ODF support rewrites `meta.xml` and the manifest thumbnail entry, nothing else. Verified structurally; opening in LibreOffice is not covered by CI.
- Legacy binary formats (`doc`, `xls`, `ppt`), `rtf` and `ipynb` are not implemented. `doc` stores a *real* accumulated edit time in `PIDSI_EDITTIME` — worth adding before reaching for anything cosmetic.
- This is not an authorship detector and does not claim a file "looks human". It removes noise and reports contradictions.

## Debugging

Set `DSH_FINALIZE_DEBUG=1` before starting the Harness to write `dsh-finalize.log` and `dsh-finalize-last.json` into the OS temp directory. Off by default; nothing is written to your workspace.

## Development

```bash
npm run check   # node --check on the three runtime files
npm test        # four unit tests, no dependencies
```

`npm test` runs the test file in-process so it also works inside sandboxed terminals where the test runner cannot spawn children.

## License

MIT — see [LICENSE](LICENSE).
