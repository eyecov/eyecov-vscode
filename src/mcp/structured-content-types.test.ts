import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expectTypeOf, it } from "vitest";
import type {
  PathAggregateResponse,
  ProjectAggregateResponse,
} from "../coverage-aggregate";
import type { CoverageDiffResult } from "../coverage-diff";

type StructuredContent = NonNullable<CallToolResult["structuredContent"]>;

it("keeps MCP response types assignable to structured content", () => {
  expectTypeOf<PathAggregateResponse>().toMatchTypeOf<StructuredContent>();
  expectTypeOf<ProjectAggregateResponse>().toMatchTypeOf<StructuredContent>();
  expectTypeOf<CoverageDiffResult>().toMatchTypeOf<StructuredContent>();
});
