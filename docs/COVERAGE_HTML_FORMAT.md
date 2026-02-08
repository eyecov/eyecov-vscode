# PHPUnit coverage HTML format

This document describes how to parse PHPUnit’s HTML coverage report (e.g. `coverage-html/`) to get **covered lines**, **uncovered lines**, and **which tests cover each covered line**.

The sample file used is: `coverage-html/Domain/Automation/Models/Action.php.html` (one HTML file per source file).

---

## 1. File structure

- **Title**: `<title>Code Coverage for /path/to/app/Domain/.../Action.php</title>`  
  Use this to resolve the source file path if needed.

- **Summary table**: First `<table class="table table-bordered">` with:
  - **Total** row: overall line coverage (e.g. `42 / 61` lines, `68.85%`).
  - **Class** row: same for the class.
  - **Method** rows: one per method, with `<a href="#LINE">` linking to the code table (line number).

- **Code table**: `<table id="code" class="table table-borderless table-condensed">`  
  One `<tr>` per line of source code. This is what we parse for line-level coverage and test names.

---

## 2. Line-level coverage (code table)

Each row in `#code` is:

```html
<tr class="... d-flex">
  <td class="col-1 text-end">
    <a id="LINE" href="#LINE">LINE</a>
  </td>
  <td class="col-11 codeLine">...source code...</td>
</tr>
```

**Line number**: From the first `<td>`: `<a id="N" href="#N">N</a>` → line number is `N`.

**Coverage status** is indicated by the `<tr>` class:

| `<tr>` class contains | Meaning        | Use as        |
|-----------------------|----------------|---------------|
| `danger`               | Not covered    | **uncovered** |
| `success`              | Covered        | **covered**   |
| `covered-by-large-tests` | Covered (with test list) | **covered** |
| `covered-by-medium-tests` | Covered (with test list) | **covered** |
| `covered-by-small-tests`  | Covered (with test list) | **covered** |
| (none of the above)    | Not executable (blank, comment, etc.) | **skip** (neither covered nor uncovered) |

So:

- **Covered lines**: rows with `class` containing `success`, `covered-by-large-tests`, `covered-by-medium-tests`, or `covered-by-small-tests`.
- **Uncovered lines**: rows with `class` containing `danger`.
- **Other lines**: no need to treat as covered or uncovered for line coverage stats.

---

## 3. Which tests cover a line (covered lines only)

For **covered** lines, the first `<td>` often has Bootstrap popover attributes:

- **`data-bs-title`**: Human-readable summary, e.g. `"105 tests cover line 83"`.
- **`data-bs-content`**: HTML fragment (attribute-encoded) containing the list of tests.

Example:

```html
<tr class="covered-by-large-tests popin d-flex">
  <td data-bs-title="1 test covers line 113"
      data-bs-content="&lt;ul&gt;&lt;li class=&quot;covered-by-large-tests&quot;&gt;P\Tests\Feature\Domain\Automation\Support\Actions\WaitActionTest::__pest_evaluable_it_will_return_the_correct_query_to_only_run_on_subscribers_that_need_to_continue&lt;/li&gt;&lt;/ul&gt;"
      data-bs-placement="top" data-bs-html="true" class="col-1 text-end">
    <a id="113" href="#113">113</a>
  </td>
  <td class="col-11 codeLine">...</td>
</tr>
```

Decoded, `data-bs-content` is:

```html
<ul>
  <li class="covered-by-large-tests">P\Tests\Feature\Domain\Automation\Support\Actions\WaitActionTest::__pest_evaluable_it_will_return_the_correct_query_to_only_run_on_subscribers_that_need_to_continue</li>
</ul>
```

**Parsing tests for a covered line**:

1. Take the first `<td>` of the row that has `data-bs-content`.
2. Read `data-bs-content` and decode HTML entities (e.g. `&lt;` → `<`, `&quot;` → `"`).
3. Parse the resulting HTML and collect text from each `<li>...</li>` (strip tags, trim).  
   Each item is one test name (e.g. `P\Tests\Feature\...\WaitActionTest::__pest_evaluable_...`).

If `data-bs-content` or `data-bs-title` is missing, the line is still covered; you just have no test list for it.

---

## 4. Parsing algorithm (summary)

1. **Locate the code table**: Find `<table id="code">` (or the table that contains rows with `<a id="N">` in the first cell).
2. **For each `<tr>` in the code table**:
   - **Line number**: From the first `<td>` → `<a id="N">` (or text of that anchor). Parse as integer `N`.
- **Status**:
  - If `tr` class contains `danger` → add `N` to **uncovered**.
  - Else if `tr` class contains `success`, `covered-by-large-tests`, `covered-by-medium-tests`, or `covered-by-small-tests` → add `N` to **covered**.
  - Else → skip (non-executable).
   - **Tests** (only for covered lines):
     - From the first `<td>` of that row, read attribute `data-bs-content`.
     - Decode HTML entities, then extract text from each `<li>...</li>`.
     - Store `testsByLine[N] = [ "Test\\Class::method", ... ]`.
3. **Result**:
   - `coveredLines`: set of line numbers that are covered.
   - `uncoveredLines`: set of line numbers that are uncovered (executable but not covered).
   - `testsByLine`: map line number → array of test names (only for lines that have `data-bs-content`).

---

## 5. Summary stats (optional)

From the first table you can also get:

- **Total covered / total lines**: e.g. from the “Total” row text like `42 / 61` (split and parse).
- **Percentage**: e.g. `68.85%` from the same row or from progress bar `aria-valuenow="68.85"`.

These are redundant if you compute totals from the code table, but useful for a quick sanity check.

---

## 6. Notes

- **Encoding**: Attributes are HTML-entity encoded (`&lt;`, `&quot;`, etc.). Decode before parsing as HTML.
- **Pest**: Test names may look like `P\Tests\Feature\...\SomeTest::__pest_evaluable_it_does_something`. The `P\` is the Pest namespace; the rest is class and “method” (description).
- **Large test lists**: Some lines have many tests; `data-bs-content` can be very long. Streaming or chunked parsing may help for huge files.
- **No test list**: Some reports or lines may not have `data-bs-content`; covered lines are still identified by the `success` or `covered-by-*-tests` class (large/medium/small).
