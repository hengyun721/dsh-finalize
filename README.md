# dsh-finalize

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that runs **one finalize pass the moment a file is delivered** — and nowhere else.

It strips the fingerprints document libraries leave behind (`python-docx`, `python-pptx`, `openpyxl`, `LibreOffice`), recomputes the statistics that are actually derivable, and puts everything it **will not** fabricate into a side panel instead of writing it into the file.

> **Design rule:** fix what is provably wrong, never invent evidence.
> Edit time, revision history, comments and "was written by a human" claims are reported, not written.

## What it does

| Format | Automatic fixes | Reported, not fixed |
|---|---|---|
| `docx` | creator/description, template date, `Application`/`AppVersion`, word/character/paragraph/line counts, template thumbnail | `TotalTime=0`, missing comments, missing tracked changes, page count |
| `pptx` | same core properties, slide/notes/hidden-slide counts, word counts | no speaker notes, cropped images still in `ppt/media`, hidden slides |
| `xlsx` | core properties, `TitlesOfParts` aligned to sheet names | zero formulas, pivot cache retaining deleted source rows, external links, hidden sheets |
| `odt` `ods` `odp` | `meta:generator`, creator, dates, `meta:document-statistic`, thumbnail | `meta:editing-duration=PT0S`, one save cycle, no annotations, no tracked changes |
| `pdf` | **nothing — read-only by design** | Producer/Creator/XMP, incremental updates, missing bookmarks, signatures |

`Application` is **removed**, never replaced with a fake `Microsoft Office Word 16.0` string: absence is unremarkable, a lie contradicts the rest of the package.

## Install

The plugin is a DSH bundle — a plain package with a `dsh.bundle.patch`; there is
no build step and no dependency to install.

```bash
git clone https://github.com/hengyun721/dsh-finalize.git
dsh plugin --profile desktop add /absolute/path/to/dsh-finalize
```

Or, from inside the Harness, install the checkout directory as a bundle with the
plugin manager (`install_bundle`, target = the absolute path above). Restart once
if the manager reports `restart-required`.

The plugin adds no tool and no prompt section, so it costs **zero tokens** — the
model never sees it.

## Use

Nothing to call. Deliver a file with `present` (or send it through a configured transport) and the pass runs before the tool executes. A shield icon appears in the message action row next to copy / like / dislike / branch:

- grey — no delivery yet in this session
- amber with a count — that many items need a human

Clicking opens a panel with **已修 / 待人工 / 只读** rows per file, plus a **扫描最近文件** button that runs the pass on the newest Office files in the working directory without a delivery.

Several files in one delivery are processed independently; several deliveries in one session merge into one report for 30 minutes.

## Configuration

```yaml
- id: dsh-finalize
  name: 'dsh-finalize'
  config:
    author: ''                 # empty = clear generator names, write no name
    triggerTools: [present, qqbot_send_file]
    formats: [docx, pptx, xlsx, pdf, odt, ods, odp]
    scanLimit: 5
    autoFix:
      stripGeneratorFields: true
      dropApplicationField: true
      recomputeStats: true
    report:
      surface: panel
```

## Debugging

Set `DSH_FINALIZE_DEBUG=1` before starting DSH to get `.log` diagnostics in the OS temp directory (`dsh-finalize.log`, `dsh-finalize-last.json`). Off by default; nothing is written to your workspace.

## Compatibility

Built to sit beside other plugins without changing their behaviour:

- **No tool, no prompt section.** Nothing is added to the model's tool list or
  system prompt, so token accounting and tool selection are untouched.
- **One passive listener.** `tools/pre-execute` runs only for the configured
  delivery tools, always returns `next()`, and swallows its own failures, so it
  can neither block nor rewrite another tool's call.
- **No transport coupling.** It hooks the delivery tool (`present`,
  `qqbot_send_file`), not a transport, so QQ / Web / CLI transports keep working.
- **Namespaced surface.** Route paths are `/api/finalize.report` and
  `/api/finalize.scan`; the client slot id is `dsh-finalize`. Neither collides
  with the shipped `deliverables`, `changes.*` or `presented` routes.
- **Opt-in debug only.** Nothing is written outside the delivered files unless
  `DSH_FINALIZE_DEBUG=1`; no global state, no workspace files.

## Limits

- Page counts need a layout engine; the plugin reports rather than guesses.
- ODF support rewrites `meta.xml`, the manifest thumbnail entry, and nothing else. Verified structurally; opening in LibreOffice is not covered by CI.
- Legacy binary formats (`doc`, `xls`, `ppt`), `rtf` and `ipynb` are not implemented. `doc` stores a *real* accumulated edit time in `PIDSI_EDITTIME` — worth adding before reaching for anything cosmetic.
- This is not an authorship detector and does not claim a file "looks human". It removes noise and reports contradictions.

## 中文说明

交付文件前自动跑一次：清掉 `python-docx` / `python-pptx` / `openpyxl` / LibreOffice 的生成器痕迹，重算能算准的统计字段，把「必须编造才能解决」的项（编辑时长、修订记录、批注）收进消息操作栏的侧边面板，而不是写进文件。

不注册工具、不加提示词，token 增量为 0。

## License

MIT
