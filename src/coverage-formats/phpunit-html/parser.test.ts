import { describe, it, expect } from "vitest";
import { LINE_STATUS } from "../../coverage-types";
import { parseCoverageHtml, parseTestName } from "./parser";

const MINIMAL_HTML = `
<!DOCTYPE html>
<html>
<head><title>Code Coverage for /var/app/Domain/Foo/Action.php</title></head>
<body>
<table id="code" class="table table-borderless table-condensed">
<tr class="success d-flex"><td class="col-1 text-end"><a id="1" href="#1">1</a></td><td class="col-11 codeLine"><?php</td></tr>
<tr class="danger d-flex"><td class="col-1 text-end"><a id="2" href="#2">2</a></td><td class="col-11 codeLine">throw new \\Exception();</td></tr>
<tr class="covered-by-large-tests popin d-flex"><td data-bs-content="&lt;ul&gt;&lt;li class=&quot;covered-by-large-tests&quot;&gt;P\\Tests\\Feature\\ActionTest::__pest_evaluable_it_does_something&lt;/li&gt;&lt;/ul&gt;" class="col-1 text-end"><a id="3" href="#3">3</a></td><td class="col-11 codeLine">return true;</td></tr>
</table>
</body>
</html>
`;

describe("parseCoverageHtml", () => {
  it("extracts source path from title", () => {
    const result = parseCoverageHtml(MINIMAL_HTML);
    expect(result.sourcePath).toBe("/var/app/Domain/Foo/Action.php");
  });

  it("truncates source path at first < when title is malformed or contains unescaped HTML", () => {
    const malformedTitle =
      '<html><head><title>Code Coverage for /var/app/Domain/Foo/Action.php <script>nop</script></title></head><body><table id="code"></table></body></html>';
    const result = parseCoverageHtml(malformedTitle);
    expect(result.sourcePath).toBe("/var/app/Domain/Foo/Action.php");
  });

  it("extracts covered and uncovered lines", () => {
    const result = parseCoverageHtml(MINIMAL_HTML);
    expect(result.coveredLines).toEqual([1, 3]);
    expect(result.uncoveredLines).toEqual([2]);
  });

  it("extracts tests by line from data-bs-content", () => {
    const result = parseCoverageHtml(MINIMAL_HTML);
    expect(result.testsByLine.get(3)).toEqual([
      "P\\Tests\\Feature\\ActionTest::__pest_evaluable_it_does_something",
    ]);
    expect(result.testsByLine.get(1)).toBeUndefined();
  });

  it("returns lineStatuses with S/M/L, uncovered, warning, uncoverable codes", () => {
    const result = parseCoverageHtml(MINIMAL_HTML);
    expect(result.lineStatuses.get(1)).toBe(LINE_STATUS.COVERED_LARGE); // success
    expect(result.lineStatuses.get(2)).toBe(LINE_STATUS.UNCOVERED); // danger
    expect(result.lineStatuses.get(3)).toBe(LINE_STATUS.COVERED_LARGE); // covered-by-large-tests
  });

  it("maps covered-by-small-tests and covered-by-medium-tests to correct status codes", () => {
    const html = `
<table id="code">
<tr class="covered-by-small-tests d-flex"><td><a id="1" href="#1">1</a></td><td>small</td></tr>
<tr class="covered-by-medium-tests d-flex"><td><a id="2" href="#2">2</a></td><td>medium</td></tr>
<tr class="d-flex"><td><a id="3" href="#3">3</a></td><td>no coverage class</td></tr>
</table>`;
    const result = parseCoverageHtml(html);
    expect(result.lineStatuses.get(1)).toBe(LINE_STATUS.COVERED_SMALL);
    expect(result.lineStatuses.get(2)).toBe(LINE_STATUS.COVERED_MEDIUM);
    expect(result.lineStatuses.get(3)).toBe(LINE_STATUS.UNCOVERABLE);
  });

  it("returns empty arrays when code table is missing", () => {
    const result = parseCoverageHtml("<html><body>no table</body></html>");
    expect(result.coveredLines).toEqual([]);
    expect(result.uncoveredLines).toEqual([]);
    expect(result.testsByLine.size).toBe(0);
  });

  it("skips popover parsing for oversized data-bs-content but still classifies line from tr class", () => {
    const longList = Array.from(
      { length: 20_000 },
      (_, i) => `<li>Test::method_${i}</li>`,
    ).join("");
    const hugeContent = `&lt;ul&gt;${longList}&lt;/ul&gt;`;
    const htmlOversized = `
<table id="code">
<tr class="covered-by-large-tests d-flex"><td data-bs-content="${hugeContent}" class="col-1"><a id="1" href="#1">1</a></td><td>line</td></tr>
</table>`;
    const result = parseCoverageHtml(htmlOversized);
    expect(result.coveredLines).toEqual([1]);
    expect(result.testsByLine.get(1)).toBeUndefined();
  });

  it("treats warning tr class as neutral (ignored/dead code; not covered or uncovered)", () => {
    const htmlWithWarning = `
<table id="code">
<tr class="success d-flex"><td><a id="1" href="#1">1</a></td><td>line 1</td></tr>
<tr class="warning d-flex"><td><a id="2" href="#2">2</a></td><td>dead code</td></tr>
<tr class="danger d-flex"><td><a id="3" href="#3">3</a></td><td>uncovered</td></tr>
</table>`;
    const result = parseCoverageHtml(htmlWithWarning);
    expect(result.coveredLines).toEqual([1]);
    expect(result.uncoveredLines).toEqual([3]);
    expect(result.coveredLines).not.toContain(2);
    expect(result.uncoveredLines).not.toContain(2);
    expect(result.lineStatuses.get(2)).toBe(LINE_STATUS.WARNING);
  });
});

describe("parseTestName", () => {
  it("parses Pest-style test string", () => {
    const raw =
      "P\\Tests\\Feature\\Domain\\Automation\\Support\\Actions\\WaitActionTest::__pest_evaluable_it_will_return_the_correct_query";
    const t = parseTestName(raw);
    expect(t.class).toBe("WaitActionTest");
    expect(t.classFile).toBe("WaitActionTest.php");
    expect(t.path).toBe(
      "tests/Feature/Domain/Automation/Support/Actions/WaitActionTest.php",
    );
    expect(t.description).toBe("it will return the correct query");
    expect(t.raw).toBe(raw);
  });

  it("parses Pest describe block", () => {
    const raw =
      "P\\Tests\\Feature\\ActionTest::__pest_evaluable__completedActionSubscribers__→_it_returns_empty_when_action_has_no_completed_subscribers";
    const t = parseTestName(raw);
    expect(t.class).toBe("ActionTest");
    expect(t.describe).toBe("completedActionSubscribers");
    expect(t.description).toBe(
      "it returns empty when action has no completed subscribers",
    );
  });

  it("handles plain method name without namespace", () => {
    const raw = "testSomething";
    const t = parseTestName(raw);
    expect(t.class).toBe("");
    expect(t.description).toBe("testSomething");
    // path is pathParts.join('/') + '.php'; with no :: pathParts is [] so path is '.php'
    expect(t.path).toBe(".php");
  });
});
