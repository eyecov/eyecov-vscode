import { LINE_STATUS } from "../../coverage-types";

/**
 * Parser for PHPUnit coverage HTML report (e.g. coverage-html/*.php.html).
 * Extracts covered lines, uncovered lines, and which tests cover each covered line.
 *
 * See docs/COVERAGE_HTML_FORMAT.md for the format description.
 */

export interface CoverageHtmlResult {
  /** 1-based line numbers that are covered */
  coveredLines: number[];
  /** 1-based line numbers that are executable but not covered */
  uncoveredLines: number[];
  /** For each covered line that has test data: line number → list of test names */
  testsByLine: Map<number, string[]>;
  /** Optional: source file path from <title> */
  sourcePath?: string;
  /** Per-line status codes (LINE_STATUS.*): covered-small/medium/large, uncovered, warning, uncoverable */
  lineStatuses: Map<number, number>;
}

/** Normalized shape for one test (class, describe, description). */
export interface NormalizedTest {
  /** Test class name, e.g. ActionTest */
  class: string;
  /** Test class filename, e.g. ActionTest.php */
  classFile: string;
  /** Full namespace, e.g. P\\Tests\\Feature\\Domain\\Automation\\Models */
  namespace: string;
  /** Relative path to test file, e.g. Tests/Feature/Domain/Automation/Models/ActionTest.php */
  path: string;
  /** Describe block name if present, e.g. completedActionSubscribers */
  describe: string | null;
  /** Human-readable test description, e.g. it returns empty when action has no completed subscribers */
  description: string;
  /** Original raw string from coverage report */
  raw: string;
}

const PEST_PREFIX = "__pest_evaluable_";
const PEST_DESCRIBE_SEP = "__→_";

/**
 * Parse a raw Pest/PHPUnit test string into class, describe, and description.
 * Examples:
 *   P\Tests\Feature\...\ActionTest::__pest_evaluable_it_can_store_itself
 *   P\Tests\Feature\...\ActionTest::__pest_evaluable__completedActionSubscribers__→_it_returns_empty_when_...
 */
export function parseTestName(raw: string): NormalizedTest {
  const [fullClass, method] = raw.includes("::")
    ? raw.split("::", 2)
    : ["", raw];
  const nsParts = fullClass
    ? fullClass.replace(/\\/g, "\u0000").split("\u0000").filter(Boolean)
    : [];
  const className = nsParts.length > 0 ? nsParts[nsParts.length - 1]! : "";
  const namespace = nsParts.length > 1 ? nsParts.slice(0, -1).join("\\") : "";
  // Path: P\Tests\Feature\... → tests/Feature/.../ActionTest.php
  const pathParts = nsParts.length > 0 ? [...nsParts] : [];
  if (pathParts[0] === "P" && pathParts[1] === "Tests") {
    pathParts.shift(); // drop P
    pathParts[0] = "tests";
  } else if (pathParts[0] === "Tests") {
    pathParts[0] = "tests";
  }
  const path =
    pathParts.length > 0 ? pathParts.join("/") + ".php" : `${className}.php`;

  let describe: string | null = null;
  let description = method;

  if (description.startsWith(PEST_PREFIX)) {
    description = description.slice(PEST_PREFIX.length);
  }
  if (description.includes(PEST_DESCRIBE_SEP)) {
    const idx = description.indexOf(PEST_DESCRIBE_SEP);
    describe = description.slice(0, idx).replace(/^_+/, "");
    description = description.slice(idx + PEST_DESCRIBE_SEP.length);
  }
  description = description.replace(/_/g, " ").trim();

  return {
    class: className,
    classFile: className ? `${className}.php` : "",
    namespace,
    path,
    describe,
    description,
    raw,
  };
}

const CODE_TABLE_ID = 'id="code"';
const TR_CLASS = /<tr\s+class="([^"]*)"/;
const LINE_ANCHOR = /<a\s+[^>]*id="(\d+)"[^>]*>/;
const DATA_BS_CONTENT = /data-bs-content="([^"]*)"/;

/** Max decoded data-bs-content length; larger content is skipped to avoid parsing huge/malformed popovers. */
const MAX_POPOVER_CONTENT_LENGTH = 512 * 1024;

/**
 * Decode common HTML entities in a string.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Extract text from each <li>...</li> in an HTML fragment.
 * Strips tags and trims.
 */
function extractListItems(html: string): string[] {
  const items: string[] = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRegex.exec(html)) !== null) {
    const text = m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) items.push(text);
  }
  return items;
}

/**
 * Parse a single code table row: line number, coverage status, status code, and optional test list.
 */
function parseCodeRow(rowHtml: string): {
  line: number;
  status: "covered" | "uncovered" | "neutral";
  statusCode: number;
  tests: string[];
} {
  const lineMatch = rowHtml.match(LINE_ANCHOR);
  const line = lineMatch ? parseInt(lineMatch[1], 10) : 0; // 1-based editor line
  if (!line || !Number.isFinite(line)) {
    return {
      line: 0,
      status: "neutral",
      statusCode: LINE_STATUS.UNCOVERABLE,
      tests: [],
    };
  }

  const classMatch = rowHtml.match(TR_CLASS);
  const trClass = (classMatch && classMatch[1]) || "";
  let status: "covered" | "uncovered" | "neutral" = "neutral";
  let statusCode: number = LINE_STATUS.UNCOVERABLE;
  if (/\bdanger\b/.test(trClass)) {
    status = "uncovered";
    statusCode = LINE_STATUS.UNCOVERED;
  } else if (/\bwarning\b/.test(trClass)) {
    status = "neutral";
    statusCode = LINE_STATUS.WARNING;
  } else if (/\bcovered-by-small-tests\b/.test(trClass)) {
    status = "covered";
    statusCode = LINE_STATUS.COVERED_SMALL;
  } else if (/\bcovered-by-medium-tests\b/.test(trClass)) {
    status = "covered";
    statusCode = LINE_STATUS.COVERED_MEDIUM;
  } else if (/\b(covered-by-large-tests|success)\b/.test(trClass)) {
    status = "covered";
    statusCode = LINE_STATUS.COVERED_LARGE;
  }

  let tests: string[] = [];
  const contentMatch = rowHtml.match(DATA_BS_CONTENT);
  if (contentMatch && contentMatch[1]) {
    const decoded = decodeHtmlEntities(contentMatch[1]);
    if (decoded.length <= MAX_POPOVER_CONTENT_LENGTH) {
      tests = extractListItems(decoded);
    }
    // Oversized content: skip popover parsing; line status still from tr class above.
  }

  return { line, status, statusCode, tests };
}

/**
 * Parse PHPUnit coverage HTML and return covered lines, uncovered lines,
 * and which tests cover each covered line.
 *
 * @param html - Full HTML content of one file's coverage page (e.g. Action.php.html)
 * @returns Covered/uncovered line numbers and testsByLine map
 */
export function parseCoverageHtml(html: string): CoverageHtmlResult {
  const coveredLines: number[] = [];
  const uncoveredLines: number[] = [];
  const testsByLine = new Map<number, string[]>();
  const lineStatuses = new Map<number, number>();

  // Optional: source path from <title>Code Coverage for ...</title>.
  // We capture only up to the first "<" ([^<]+); anything after that is ignored until </title>.
  // So malformed or unescaped HTML in the title (e.g. path containing "<" or stray tags) is
  // truncated and does not break parsing.
  const titleMatch = html.match(
    /<title>Code Coverage for ([^<]+).*?<\/title>/s,
  );
  const sourcePath = titleMatch ? titleMatch[1].trim() : undefined;

  // Find the code table: from <table id="code"> to </table>
  const codeTableStart = html.indexOf(CODE_TABLE_ID);
  if (codeTableStart === -1) {
    return {
      coveredLines,
      uncoveredLines,
      testsByLine,
      sourcePath,
      lineStatuses,
    };
  }
  const tableStart = html.lastIndexOf("<table", codeTableStart);
  const tableEnd = html.indexOf("</table>", codeTableStart);
  const tableHtml =
    tableEnd > tableStart ? html.slice(tableStart, tableEnd + 8) : "";

  // Split into <tr>...</tr> segments (simple split; rows may contain newlines)
  const trSegments = tableHtml.split(/<tr\s+/).slice(1);
  for (const segment of trSegments) {
    const rowHtml = "<tr " + segment;
    const { line, status, statusCode, tests } = parseCodeRow(rowHtml);
    if (line < 1) continue;

    lineStatuses.set(line, statusCode);
    if (status === "covered") {
      coveredLines.push(line);
      if (tests.length > 0) {
        testsByLine.set(line, tests);
      }
    } else if (status === "uncovered") {
      uncoveredLines.push(line);
    }
  }

  return {
    coveredLines: [...new Set(coveredLines)].sort((a, b) => a - b),
    uncoveredLines: [...new Set(uncoveredLines)].sort((a, b) => a - b),
    testsByLine,
    sourcePath,
    lineStatuses,
  };
}
