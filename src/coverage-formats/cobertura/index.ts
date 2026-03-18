/**
 * Cobertura coverage format: parser and adapter.
 */

export {
  CoberturaAdapter,
  listCoberturaSourcePaths,
  type CoberturaAdapterOptions,
} from "./adapter";
export {
  parseCoberturaXml,
  type CoberturaFileRecord,
  type CoberturaParseResult,
} from "./parser";
