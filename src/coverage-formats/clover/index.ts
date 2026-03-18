/**
 * Clover coverage format: parser and adapter.
 */

export {
  CloverAdapter,
  listCloverSourcePaths,
  type CloverAdapterOptions,
} from "./adapter";
export {
  parseCloverCoverage,
  type CloverFileRecord,
  type CloverParseResult,
} from "./parser";
