/**
 * PHPUnit HTML coverage format: parser, adapter, and query helpers.
 */

export {
  parseCoverageHtml,
  parseTestName,
  type CoverageHtmlResult,
  type NormalizedTest,
} from './parser';

export {
  PhpUnitHtmlAdapter,
  resolveCoverageHtmlPath,
  findCoverageHtmlBasenameMatches,
  listCoverageHtmlSourcePaths,
  buildCoverageFileResult,
  stripTestsByLine,
  type PhpUnitHtmlAdapterOptions,
} from './phpunit-html-adapter';

export type { CoverageFileResult, ParsedCoverageFileResult } from './types';
