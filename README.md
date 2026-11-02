# dsh-finalize

[![ci](https://github.com/hengyun721/dsh-finalize/actions/workflows/ci.yml/badge.svg)](https://github.com/hengyun721/dsh-finalize/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**English** · **中文** — bilingual throughout, section by section. / 全文按小节中英对照。

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that runs **one finalize pass the moment a file is delivered** — and nowhere else. It strips the fingerprints document libraries leave behind, recomputes the statistics that are actually derivable, and puts everything it **will not** fabricate into a side panel instead of writing it into the file.

> **Design rule: fix what is provably wrong, never invent evidence.**
> Edit time, revision history, comments and "was written by a human" claims are reported, not written. `Application` is removed rather than replaced with a fake `Microsoft Office Word 16.0` string — absence is unremarkable, a lie contradicts the rest of the package.

---

## Why this exists / 为什么做这个

**EN** — Documents produced by `python-docx`, `python-pptx`, `openpyxl` or LibreOffice carry their own birth certificate: a creator field naming the library, a 2013 template date, `Words=0` on a forty-page report, a leftover template thumbnail. Those are *bugs*, not style choices, and they are trivially visible to anyone who unzips the file. At the same time, the usual "make it look human" advice is to forge edit time and revision counts — which contradicts the rest of the package and collapses under inspection.

This plugin takes the honest half: normalize what is wrong, report what only a human can supply.

**中文** — `python-docx`、`python-pptx`、`openpyxl`、LibreOffice 生成的文件自带「出生证明」：作者字段写着库名、创建时间是 2013 年的模板日期、四十页的报告 `Words=0`、还留着一张模板缩略图。这些是 bug，不是风格选择，任何人解压就能看到。而常见的「让它看起来像人写的」建议是伪造编辑时长和修订次数——那会和文件里其它字段自相矛盾，一查就穿。

这个插件只做诚实的那一半：把错的改对，把只有人才能提供的收进面板。

---

## What it does / 它做什么

| Format | Automatic fixes / 自动修 | Reported, never fixed / 只报告，不代填 |
|---|---|---|
| `docx` | creator & description, template date, `Application`/`AppVersion`, word/character/paragraph/line counts, template thumbnail | `TotalTime=0`, missing comments, missing tracked changes, page count |
| `pptx` | same core properties, slide/notes/hidden-slide counts, word counts | no speaker notes, cropped images still in `ppt/media`, hidden slides |
| `xlsx` | core properties, `TitlesOfParts` aligned to sheet names | zero formulas, pivot cache retaining deleted rows, external links, hidden sheets |
| `odt` `ods` `odp` | `meta:generator`, creator, dates, `meta:document-statistic`, thumbnail + manifest entry | `meta:editing-duration=PT0S`, single save cycle, no annotations, no tracked changes |
| `pdf` | **nothing — read-only by design** / 只读，不改一个字节 | Producer/Creator/XMP, incremental updates, missing bookmarks, signatures |

Several files in one delivery are processed independently. Several deliveries in one session merge into a single report for 30 minutes instead of overwriting each other.

一次交付多个文件会逐个独立处理；同一会话里多次交付会在 30 分钟内合并成一份报告，而不是互相覆盖。

---

## Install / 安装

The plugin is a DSH bundle — a plain package with a `dsh.bundle.patch`; there is no build step and no runtime dependency.

这是一个 DSH bundle（`dsh.bundle.patch`），无构建步骤、无运行时依赖。

```bash
git clone https://github.com/hengyun721/dsh-finalize.git
dsh plugin --profile desktop add /absolute/path/to/dsh-finalize
```

Or from inside the Harness, install the checkout directory with the plugin manager
(`install_bundle`, target = the absolute path above). Restart once if it reports `restart-required`.

也可以在 Harness 内用插件管理器安装该目录（`install_bundle`，target 指向上面的绝对路径）；若提示 `restart-required` 则重启一次。

---

## Usage / 使用

Nothing to call. Deliver a file with `present` (or a configured transport) and the pass runs **before** the tool executes, so the file on disk is already normalized when it reaches the recipient.

无需调用。用 `present`（或已配置的传输）交付文件时，检查在工具真正执行**之前**跑完，文件落盘时已经是处理过的。

A shield icon appears in the message action row next to copy / like / dislike / branch:

| State | Meaning |
|---|---|
| grey / 灰色 | no delivery in this session yet |
| amber + count / 琥珀色+数字 | that many items need a human |
| click / 点击 | panel with `已修` `待人工` `只读` rows per file |

The panel also offers **扫描最近文件** — it runs the pass on the newest Office files in the working directory without a delivery, which is handy when a document was produced by a script rather than through `present`.

面板里的「扫描最近文件」可以对工作区最新的 Office 文件手动跑一次，适合文档由脚本生成、没走 `present` 的场景。

---

## Configuration / 配置

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
    report:
      surface: panel
```

| Key | Type | Default | Description / 说明 |
|---|---|---|---|
| `author` | string | `''` | Written into `dc:creator` / `lastModifiedBy` / `meta:initial-creator`. Empty = clear generator names without inventing a person. / 留空只清除库名，不写任何人名 |
| `triggerTools` | string[] | `present`, `qqbot_send_file` | Delivery tools that trigger the pass. / 触发检查的交付工具 |
| `formats` | string[] | all seven | Adapter whitelist; anything else is reported as `skipped`. / 适配器白名单，其余标记为跳过 |
| `scanLimit` | number | `5` | How many recent files **扫描最近文件** processes. / 手动扫描处理多少个最近文件 |
| `autoFix.stripGeneratorFields` | boolean | `true` | Remove library names and `generated by …` descriptions. |
| `autoFix.dropApplicationField` | boolean | `true` | Remove `Application`/`AppVersion` instead of faking an Office version. |
| `autoFix.recomputeStats` | boolean | `true` | Recompute word/character/paragraph counters from the body. |
| `report.surface` | `panel` \| `silent` | `panel` | Whether the action-row button renders. |

---

## Repository layout / 仓库结构

Every file in this repository and what it is responsible for.

| Path | English | 中文 |
|---|---|---|
| `index.js` | Host half. Registers the `tools/pre-execute` hook on the delivery tools, routes each file to an adapter, merges per-session reports, and serves `/api/finalize.report` + `/api/finalize.scan`. Registers no tool and no prompt section. | Host 半边。在交付工具上挂 `tools/pre-execute`，按扩展名路由到适配器，合并同一会话的报告，并提供两个 API 路由。不注册工具、不写提示词。 |
| `client.js` | Browser half. Registers the shield button into `conversation.chat.assistant-actions` and renders the report panel (fixed overlay, theme tokens, no DOM writes outside its own tree). | 客户端半边。把盾牌按钮挂进消息操作栏，渲染报告面板（覆盖层、主题变量、不越界写 DOM）。 |
| `lib/office.js` | Format engine, dependency-free. Contains the ZIP reader/writer (deflate via `node:zlib`), the OOXML adapters (`docx`/`pptx`/`xlsx`), the ODF adapter (`odt`/`ods`/`odp`), and the read-only PDF inspector. | 格式引擎，零依赖。包含 ZIP 读写（`node:zlib`）、OOXML 适配器、ODF 适配器、只读 PDF 检查器。 |
| `cordis.patch.yml` | Bundle patch: inserts the `dsh-finalize` row and the default config shown above. This is what `install_bundle` applies to the profile. | bundle 补丁：插入插件行和上面的默认配置，`install_bundle` 应用的正是它。 |
| `package.json` | Package manifest. Declares `dsh.bundle.patch`, the `dsh.client` web half (`platform`, `immediately`, `inject`), the export map, and the `check` / `test` scripts. | 包清单：声明 bundle 补丁、客户端入口、导出表和脚本。 |
| `locale/en.json`, `locale/zh.json` | Display metadata read by the Plugin Manager and Settings without activating the plugin: `meta.title`, `meta.description`. | 插件管理器与设置页读取的展示信息（标题、描述），无需激活插件即可读取。 |
| `icon.svg` | Original plugin icon (document + check), used in the plugin inventory and bundle details. | 原创插件图标（文档 + 对勾），用于插件列表和 bundle 详情。 |
| `test/smoke.test.mjs` | Four `node:test` cases: ODF rewrite (generator, statistics, `mimetype` stays first and stored), docx rewrite (creator, `Application`, counts), PDF inspector (read-only, detects incremental updates), non-ZIP rejection. No fixtures on disk. | 四个 `node:test` 用例：ODF 重写、docx 重写、PDF 只读检查、非 ZIP 输入拒绝。不依赖磁盘 fixture。 |
| `.github/workflows/ci.yml` | CI on push/PR: Node 20, `npm run check` (syntax) then `npm test`. | 推送/PR 时的 CI：Node 20，先语法检查再跑单测。 |
| `CHANGELOG.md` | Version history in Keep-a-Changelog format. | 变更记录（Keep a Changelog 格式）。 |
| `LICENSE` | MIT. | MIT 许可。 |
| `README.md` | This document, bilingual. | 本文件，中英双语。 |

### Engine map / 引擎结构

`lib/office.js` is deliberately one file with a flat API:

| Symbol | Role / 作用 |
|---|---|
| `readZip(buffer)` | Parse the central directory into `{ name, data, time, date }` entries. No ZIP64. / 解析中央目录 |
| `writeZip(entries)` | Rebuild the archive with `deflateRaw`; entries named `mimetype` are stored uncompressed and keep their position, as ODF requires. / 重打包，`mimetype` 保持不压缩且位置不变 |
| `finalizeDocx` / `finalizePptx` / `finalizeXlsx` | OOXML adapters. Share `fixCore`, `stripApplication`, `dropThumbnail`, `commonUnresolved`. |
| `finalizeOdf` | ODF adapter over `meta.xml` + `META-INF/manifest.xml`. |
| `inspectPdf` | Regex-level PDF inspector; returns observations only and never rewrites bytes. |
| `finalizeOffice(bytes, kind, options)` | Dispatcher used by the Host half. |

---

## Compatibility / 兼容性

Built to sit beside other plugins without changing their behaviour.

- **No tool, no prompt section.** Nothing is added to the model's tool list or system prompt, so token accounting and tool selection are untouched. / 不注册工具、不写提示词，token 与工具选择不受影响。
- **One passive listener.** `tools/pre-execute` runs only for the configured delivery tools, always returns `next()`, and swallows its own failures, so it can neither block nor rewrite another tool's call. / 只在交付工具上触发，永远放行，自身异常不外溢。
- **No transport coupling.** It hooks the delivery tool, not a transport, so QQ / Web / CLI transports keep working. / 钩工具而非传输层。
- **Namespaced surface.** Routes are `/api/finalize.report` and `/api/finalize.scan`; the slot id is `dsh-finalize`. Neither collides with the shipped `deliverables`, `changes.*` or `presented` routes. / 路由与 slot id 均为独立命名空间。
- **Opt-in debug only.** Nothing is written outside the delivered files unless `DSH_FINALIZE_DEBUG=1`. / 除非显式开启调试，不写任何额外文件。

---

## Limits / 已知限制

- Page counts need a layout engine; the plugin reports rather than guesses. / 页数需要排版引擎，插件只报不猜。
- ODF support rewrites `meta.xml`, the manifest thumbnail entry and nothing else. Verified structurally; opening in LibreOffice is not covered by CI. / ODF 只改 `meta.xml` 和缩略图条目，CI 不覆盖 LibreOffice 实际打开。
- Legacy binary formats (`doc`, `xls`, `ppt`), `rtf` and `ipynb` are not implemented. `doc` stores a *real* accumulated edit time in `PIDSI_EDITTIME` — worth adding before reaching for anything cosmetic. / 未支持二进制旧格式与 `rtf`/`ipynb`。
- This is not an authorship detector and does not claim a file "looks human". It removes noise and reports contradictions. / 这不是「AI 检测绕过工具」。

---

## Debugging / 调试

`DSH_FINALIZE_DEBUG=1` before starting the Harness writes `dsh-finalize.log` and `dsh-finalize-last.json` into the OS temp directory. Off by default; nothing is written to your workspace.

启动 Harness 前设置 `DSH_FINALIZE_DEBUG=1`，会在系统临时目录写入上述两个诊断文件；默认关闭，不写工作区。

---

## Development / 开发

```bash
npm run check   # node --check on the three runtime files
npm test        # four unit tests, no dependencies
```

`npm test` runs the test file in-process so it also works inside sandboxed terminals where the test runner cannot spawn children.

---

## License / 许可

MIT — see [LICENSE](LICENSE).
