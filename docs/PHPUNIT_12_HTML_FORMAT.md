---
name: PHPUNIT 12.5 HTML coverage format and parsing
overview: The HTML coverage format is produced by phpunit/php-code-coverage (not PHPUnit itself). There is no official format specification or HTML parser in the ecosystem; the format can be reverse-engineered from the vendor templates and renderers for the purpose of parsing and converting to a stricter format.
todos: []
isProject: false
---

# PHPUnit 12.5 HTML coverage format and parsing

## Where the format is defined

- **Generator**: The HTML report is produced by [phpunit/php-code-coverage](https://github.com/sebastianbergmann/php-code-coverage) (dependency of PHPUnit). PHPUnit only configures and invokes it in [src/Runner/CodeCoverage.php](src/Runner/CodeCoverage.php) via `SebastianBergmann\CodeCoverage\Report\Html\Facade`.
- **Templates and renderers** live under `vendor/phpunit/php-code-coverage/src/Report/Html/`:
  - [Facade.php](vendor/phpunit/php-code-coverage/src/Report/Html/Facade.php) – orchestrates output
  - [Renderer.php](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer.php) – common template vars and helpers (breadcrumbs, coverage bars, color levels)
  - [Renderer/Directory.php](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/Directory.php), [Dashboard.php](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/Dashboard.php), [File.php](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/File.php) – page-specific rendering
  - [Renderer/Template/](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/Template/) – `.html.dist` templates (and some referenced as `.html`)

**Does a format spec or parser already exist?** No. Neither the PHPUnit repo nor php-code-coverage provide an official HTML format specification or a parser to convert HTML coverage back into a machine-friendly format (e.g. Clover XML, Cobertura). The HTML is designed for human viewing only.

---

## Exact format (for parsing)

### 1. Output layout


| Output                 | Location                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Root index + dashboard | `{target}/index.html`, `{target}/dashboard.html`                                          |
| Per-directory          | `{target}/{node_id}/index.html`, `{target}/{node_id}/dashboard.html`                      |
| Per-file               | `{target}/{file_id}.html`                                                                 |
| Assets                 | `_css/`, `_icons/`, `_js/` (billboard, bootstrap, jquery, file.js, style.css, custom.css) |


**What `node_id` and `file_id` are:** They are the same thing — the string returned by `$node->id()` for that node in php-code-coverage’s report tree. There is no separate numeric or opaque id; the “id” is a **path-like string** used directly in URLs and filenames.

- **Root:** The root node’s `id()` is the literal string `'index'`. The report writes the root to `index.html` and `dashboard.html` at `{target}/` (so the root is not written under a path named “index”).
- **Every other node (file or directory):** `id` is built in [AbstractNode::processId()](vendor/phpunit/php-code-coverage/src/Node/AbstractNode.php):
  - If the parent’s id is `'index'`: `id = str_replace(':', '_', name)` (the node’s name with colons replaced by underscores).
  - Otherwise: `id = parent->id() . '/' . name` (parent path + `/` + this node’s name).

So for a **file** node, `file_id` is the **relative path of that file in the report**, with forward slashes and colons replaced by underscores. Examples: a file at the root with name `Foo.php` has `file_id` = `Foo.php`; a file under a directory `src` with name `Foo.php` has `file_id` = `src/Foo.php`; a file in `src/Sub/Bar.php` has `file_id` = `src/Sub/Bar.php`. The corresponding HTML file is `{file_id}.html` under the target directory. For a **directory** node, `node_id` is the same construction (e.g. `src`, `src/Sub`), and its index/dashboard live at `{target}/{node_id}/index.html` and `{target}/{node_id}/dashboard.html`.

### 2. Directory listing pages (index.html)

- **Template**: `directory.html.dist`.
- **Structure**: One `<table class="table table-bordered">` with `<tbody>{{items}}</tbody>`. Each row comes from `directory_item.html.dist`.
- **Row columns** (order and semantics):
  - Icon + name (links: directories → `{name}/index.html`, files → `{name}.html`).
  - **Lines**: `{{lines_level}}` (CSS class: `danger` | `warning` | `success`), `{{lines_bar}}`, `{{lines_executed_percent}}`, `{{lines_number}}` (e.g. `5 / 10`).
  - **Methods**: same pattern (`methods_level`, `methods_bar`, `methods_tested_percent`, `methods_number`).
  - **Classes**: same pattern.
- **Color levels**: From [Renderer::colorLevel()](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer.php): percent ≤ lowUpperBound → `danger`; between low and high → `warning`; ≥ highLowerBound → `success`.

### 3. File / source pages

- **Template**: [file.html.dist](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/Template/file.html.dist).
- **Common vars** (from [Renderer::setCommonTemplateVariables()](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer.php)): `full_path`, `path_to_root`, `breadcrumbs`, `date`, `version`, `runtime`, `generator`, `low_upper_bound`, `high_lower_bound`.
- **Summary table**: `{{items}}` – Total row plus classes/methods (from file_item / method_item templates), same metric columns as directory rows.
- **Source code block**: `{{lines}}` is the result of [File::renderSourceWithLineCoverage()](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/File.php):
  - Wrapper: [lines.html.dist](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/Template/lines.html.dist): `<table id="code" class="table table-borderless table-condensed"><tbody>{{lines}}</tbody></table>`.
  - Each line: [line.html.dist](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/Template/line.html.dist):
    - `<tr class="{{class}} d-flex">` — see **§3.2** for the exact coverage states and class semantics.
    - `<td {{popover}} class="col-1 text-end">` with `data-bs-title="..."` and `data-bs-content="..."` (HTML list of tests) when popover is set.
    - Line number: `<a id="{{lineNumber}}" href="#{{lineNumber}}">{{lineNumber}}</a>`.
    - Code: `<td class="col-11 codeLine">{{lineContent}}</td>` — `lineContent` is syntax-highlighted HTML; see **§3.3** for span classes.

So for a **line-level parser**: select `#code tbody tr`, read `tr.class` for status (§3.2), first `td a` for line number, second `td.codeLine` for source (§3.3).

### 3.1 HTML list of tests (popover content) – detailed analysis

The “which tests cover this line” content is built in [File.php](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/File.php) and injected into the line’s first `<td>` as Bootstrap popover markup.

**How the list is built**

- **Entry point**: For each covered line, `renderSourceWithLineCoverage()` does:
  - `$popoverContent = '<ul>';`
  - `foreach ($coverageData[$i] as $test) { $popoverContent .= $this->createPopoverContentForTest($test, $testData[$test]); }`
  - `$popoverContent .= '</ul>';`
- **Per-test HTML** ([createPopoverContentForTest()](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/File.php), lines 1119–1145):
  - One `<li>` per test. No truncation, no cap on count.
  - Output: `sprintf('<li%s>%s</li>', $testCSS, htmlspecialchars($test, ENT_COMPAT | ENT_HTML401 | ENT_SUBSTITUTE))`.
  - `$test` is the test name string (e.g. `My\Namespace\Test::testMethod`). It is emitted as a single text node inside one `<li>`; the string is not split into multiple elements or lines in the HTML.
  - `$testCSS` is optional:  `class="covered-by-small-tests"`, `"covered-by-medium-tests"`, `"covered-by-large-tests"`, or `"danger"` (for failure), depending on test size/status.

**Resulting structure**

- One `<ul>` per line, containing exactly N `<li>` elements for N tests covering that line.
- Each `<li>` contains only the escaped test name (no line breaks or chunking in the markup).
- The whole string is then passed through `htmlspecialchars()` again and placed in the table cell as `data-bs-content="...". So the **HTML string and DOM** for a line with thousands of tests are unbounded: one` - `with thousands of`- `nodes, and a very long`data-bs-content` attribute.

**Are “lines” split when very long?**

- **Test names**: No. Each test name is one contiguous string inside one `<li>`. Long names (e.g. long class names) are not split into multiple lines or multiple elements; they can wrap only via normal block layout/CSS in the browser.
- **Number of tests**: No splitting. There is no pagination, “show first K”, or multiple `<ul>`s; every test is appended to the same single `<ul>`.

**Does the list grow to boundless length with thousands of tests?**

- **In the HTML/DOM**: Yes. The PHP loop has no limit; every covering test is appended. The generated HTML and the in-memory DOM can be arbitrarily large (e.g. thousands of `<li>` in one `<ul>` inside one popover).
- **On screen**: No. [style.css](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/Template/css/style.css) (lines 101–108) constrains the popover:
  - `.popover { max-width: none; }` — width is not limited.
  - `.popover-body { max-height: 90vh; overflow-y: auto; }` — the popover **body** has a maximum height of 90% of the viewport and becomes vertically scrollable. So visually the list does not grow without bound; it scrolls inside a fixed-height area. All list items are still in the DOM; only the visible region is bounded.

**Summary**


| Aspect                      | Behaviour                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Structure                   | Single `<ul>` with one `<li>` per test; no splitting into multiple lists.                                            |
| Long test name              | Single string in one `<li>`; no line-splitting in HTML; wrapping only by normal layout.                              |
| Many tests (e.g. thousands) | HTML/DOM: unbounded (one long string, many nodes). Display: bounded by 90vh + `overflow-y: auto` on `.popover-body`. |
| Truncation / pagination     | None in PHP or templates.                                                                                            |


**Parser implication**: There are no newline characters between `</li>` and the next `<li>` in the generated HTML; the popover content is one long concatenated string. A parser must be prepared for **insane line lengths** when reading `data-bs-content` or the equivalent markup (e.g. a single “line” containing thousands of `<li>...</li>` with no line breaks).

### 3.2 Line coverage states (covered / uncovered / not coverable / warning)

The `<tr>` class on each source line encodes coverage state. Logic is in [File::renderSourceWithLineCoverage()](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/File.php). The footer legend in [file.html.dist](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/Template/file.html.dist) lists: "Covered by small (and larger) tests", "Covered by medium (and large) tests", "Covered by large tests (and tests of unknown size)", "Not covered", "Not coverable".

**Line coverage (file view: `{id}.html`)**


| State                        | `tr` class                                                                       | Condition in code                                                                    | Meaning                                                                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Covered**                  | `covered-by-small-tests`, `covered-by-medium-tests`, or `covered-by-large-tests` | Line is in `$coverageData`, value is non-null, and `count($coverageData[$i]) > 0`.   | At least one test hit this line. The class reflects the *smallest* test size that covered it: small → `covered-by-small-tests`, else medium → `covered-by-medium-tests`, else → `covered-by-large-tests`.     |
|                              | + `popin`                                                                        | Same as above (covered).                                                             | Present when a popover is rendered (list of tests). So covered lines have e.g. `covered-by-large-tests popin`.                                                                                                |
| **Not covered**              | `danger`                                                                         | Line is in `$coverageData`, value is non-null, and `count($coverageData[$i]) === 0`. | Line is executable but no test executed it.                                                                                                                                                                   |
| **Not coverable**            | *(none)*                                                                         | Line is *not* in `$coverageData` (`!array_key_exists($i, $coverageData)`).           | Line was never considered executable (e.g. blank, comment, only whitespace). The `tr` has no coverage-related class (only layout classes like `d-flex`).                                                      |
| **Warning (ignored / dead)** | `warning`                                                                        | Line is in `$coverageData` but `$coverageData[$i] === null`.                         | Executable line with special status (e.g. ignored via `@codeCoverageIgnore`, or treated as dead). The footer legend does not name this; it is a fourth state distinct from "Not covered" and "Not coverable". |


**Parser**: To classify a line, read the `tr` element's `class` and match the first coverage-related token: `covered-by-small-tests`, `covered-by-medium-tests`, `covered-by-large-tests`, `danger`, `warning`, or absence of any of these → not coverable. Ignore `d-flex` and `popin` for status.

### 3.3 Syntax highlighting in source lines

The content of each `td.codeLine` is not plain text but **syntax-highlighted HTML** produced by [File::loadFile()](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/File.php) using PHP's `token_get_all()`. The following **five** `<span>` classes are used inside the cell:


| Class         | Token / condition                                                                                                                                                                                                                    | Description                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `**string`**  | Inside a string literal, or the `"` character that toggles the string flag.                                                                                                                                                          | String literal content and delimiters.   |
| `**keyword`** | PHP keywords (e.g. `abstract`, `class`, `function`, `return`, `if`, `foreach`) from the renderer's `KEYWORD_TOKENS` list (T_ABSTRACT, T_ARRAY, T_AS, … T_YIELD_FROM), and single-character tokens like `[` when not inside a string. | Reserved words and operator-like tokens. |
| `**default`** | Any other token (identifiers, numbers, operators, etc.) when not in a string and not comment/keyword/html.                                                                                                                           | Normal code; body text color.            |
| `**html`**    | `T_INLINE_HTML`.                                                                                                                                                                                                                     | Raw HTML in PHP files.                   |
| `**comment`** | `T_COMMENT`, `T_DOC_COMMENT`.                                                                                                                                                                                                        | Line and block comments.                 |


Each segment is emitted as `<span class="…">…</span>`; the value is HTML-escaped. Tabs and spaces are replaced with   `` sequences. There are no other span classes used for source highlighting in this report.

**Parser**: To recover plain source from `td.codeLine`, strip all `<span class="string|keyword|default|html|comment">` tags (or concatenate text nodes) and decode  `` (and other entities) as needed. Do not rely on a single text node; the cell is a mix of spans.

### 4. Dashboard pages

- **Templates**: `dashboard.html.dist`.
- **Content**: Breadcrumbs, charts (billboard.js) driven by inline JSON (`class_coverage_distribution`, `method_coverage_distribution`, `complexity_class`, `complexity_method`), and tables (`insufficient_coverage_classes`, `insufficient_coverage_methods`, `project_risks_classes`, `project_risks_methods`) as pre-rendered HTML fragments. Parsing dashboards is possible but more brittle; for “stricter format” conversion, directory index + file source pages are the main source of truth.

### 5. Exact color codes

Colors are defined in [style.css](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/Template/css/style.css) via CSS custom properties under `:root`, using `light-dark(light-value, dark-value)` so the report respects `prefers-color-scheme`. The default PHP values (when no custom colors are configured) are in [Colors::default()](vendor/phpunit/php-code-coverage/src/Report/Html/Colors.php).

**Coverage / table / legend (backgrounds)**


| CSS variable               | Light mode (hex) | Dark mode (hex) | Used for                               |
| -------------------------- | ---------------- | --------------- | -------------------------------------- |
| `--phpunit-success-low`    | `#dff0d8`        | `#2d4431`       | `covered-by-large-tests`, `tr.success` |
| `--phpunit-success-medium` | `#c3e3b5`        | `#3c6051`       | `covered-by-medium-tests`              |
| `--phpunit-success-high`   | `#99cb84`        | `#3d5c4e`       | `covered-by-small-tests`               |
| `--phpunit-warning`        | `#fcf8e3`        | `#3e3408`       | `warning`, `not-coverable`             |
| `--phpunit-danger`         | `#f2dede`        | `#42221e`       | `danger`, `not-covered`                |


**Colors class defaults** ([Colors.php](vendor/phpunit/php-code-coverage/src/Report/Html/Colors.php) `default()`): `successLow` `#dff0d8`, `successMedium` `#c3e3b5`, `successHigh` `#99cb84`, `warning` `#fcf8e3`, `danger` `#f2dede`. These can be overridden via PHPUnit configuration (e.g. `coverageHtmlColorSuccessLow` in phpunit.xml or CLI), in which case the generated report may use different hex values; the CSS variables above are the default theme only.

**Source syntax highlighting** (in `td.codeLine`): `span.comment` and `span.html` use `var(--bs-secondary-color)`; `span.default`, `span.keyword`, and `span.string` use `var(--bs-body-color)` (keyword is also bold). Those resolve to Bootstrap theme colors (e.g. light: `#212529` body, dark: `#dee2e6`).

### 6. Edge cases and parser pitfalls

- **Unescaped output**: `full_path` (filesystem path) and breadcrumb link text / hrefs use `pathAsString()` and `name()` **without** HTML escaping in the templates. Paths or names containing `<`, `>`, `"`, or `&` can produce malformed HTML (e.g. broken `<title>`, broken attributes). Parser should not assume well-formed markup; use robust HTML parsing and defensive extraction.
- **Path separators and IDs**: Node `id()` is built with forward slash (`parentId . '/' . name`). The only substitution is `str_replace(':', '_', $this->name)` (e.g. Windows stream names). On Windows, `pathAsString()` still uses `DIRECTORY_SEPARATOR` (backslash), so `full_path` in the title can contain backslashes. File output paths are always `{id}.html` (e.g. `src/Foo.php.html`). Parser: expect `/` in URLs and optional `\` in title/path strings.
- **Percentage and “n/a”**: When there are zero executable lines (or methods/classes), the renderer emits the literal string `n/a` for the percentage cell instead of a number (see [Renderer::renderItemTemplate()](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer.php)). Parser must treat `n/a` as a valid value for percentage fields in directory and file summary tables.
- **Source line content is HTML, not plain text**: The content of each `td.codeLine` is **syntax-highlighted HTML** (e.g. `<span class="keyword">...</span>`, `<span class="string">...</span>`), produced by [File::loadFile()](vendor/phpunit/php-code-coverage/src/Report/Html/Renderer/File.php) and tokenization. A parser that needs plain source must strip tags or aggregate text nodes; the cell is not a single plain-text string.
- **Very long single lines**: One line of code can be arbitrarily long (e.g. minified code). That line is one `<td class="codeLine">` with many inline elements. So again, **insane line length** is possible in the source table, not only in `data-bs-content`.
- `**data-bs-content` is entity-encoded**: The popover body HTML is passed through `htmlspecialchars()` before being written into the `data-bs-content` attribute. In the stored HTML file, the attribute value therefore contains `<`, `>`, `"`, `&` etc. A parser reading the raw file must decode HTML entities to recover the inner `<ul>...</ul>` structure (or parse the escaped markup directly).
- **Empty or minimal reports**: Root index/dashboard always exist. A report with no files still has `index.html` and `dashboard.html`; directory listing may have only the “Total” row. File pages for 0-line files yield an empty `#code` tbody. Parser should handle empty tables and missing rows.
- **Custom CSS**: Users can supply a custom CSS file. It can override `.popover-body`, table styles, or layout. Do not rely on specific dimensions or visibility; rely on structure (elements, classes, IDs) and content.

### 7. Covflux parser behavior

The Covflux PHPUnit HTML adapter implements the above with these specifics:

- **File discovery:** Only per-file HTML pages (`{file_id}.html`) are considered; `index.html` and `dashboard.html` (root and per-directory) are excluded from the list of coverage source files.
- **Source segment:** Config can set `sourceSegment` to `app`, `src`, `lib`, or `auto`. When `auto`, the adapter tries those segments per workspace root to resolve source paths under the coverage root.
- **Title / path:** If the `<title>` contains unescaped `<` or malformed markup, the parser truncates at the first `<` when deriving the source path.
- **Popover size:** Decoded `data-bs-content` above a maximum length is not parsed for tests-by-line; the line is still classified from the `tr` class (covered/uncovered/warning/uncoverable).
- **Line statuses:** Each line is mapped to an internal status code: covered-by-small, covered-by-medium, covered-by-large, uncovered, warning, or uncoverable. The adapter exposes these in `CoverageRecord.lineStatuses` for editor decorations (S/M/L shading and warning/uncoverable styling).
