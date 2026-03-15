/**
 * LCOV coverage format: parser and adapter.
 */

export {
  LcovAdapter,
  listLcovSourcePaths,
  type LcovAdapterOptions,
} from "./adapter";
export { parseLcov, lineCoveragePercent, type LcovFileRecord } from "./parser";
