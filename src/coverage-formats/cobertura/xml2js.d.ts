declare module "xml2js" {
  export interface ParserOptions {
    explicitArray?: boolean;
    explicitRoot?: boolean;
    mergeAttrs?: boolean;
    trim?: boolean;
    normalize?: boolean;
  }

  export class Parser {
    constructor(options?: ParserOptions);
    parseString(
      xml: string,
      callback: (err: Error | null, result: unknown) => void,
    ): void;
  }
}
