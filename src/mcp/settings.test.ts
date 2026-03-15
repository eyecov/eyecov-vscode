import { describe, it, expect } from 'vitest';
import { isMcpServerEnabled, isPrewarmCoverageCacheEnabled } from './settings';

/** Minimal config shape for unit testing without vscode */
function config(getValues: Record<string, unknown> = {}): { get: (key: string) => unknown } {
  return {
    get(key: string) {
      return key in getValues ? getValues[key] : undefined;
    },
  };
}

describe('mcp/settings', () => {
  describe('isMcpServerEnabled', () => {
    it('returns true when enableMcpServer is unset (default)', () => {
      expect(isMcpServerEnabled(config())).toBe(true);
    });

    it('returns true when enableMcpServer is true', () => {
      expect(isMcpServerEnabled(config({ enableMcpServer: true }))).toBe(true);
    });

    it('returns false when enableMcpServer is false', () => {
      expect(isMcpServerEnabled(config({ enableMcpServer: false }))).toBe(false);
    });
  });

  describe('isPrewarmCoverageCacheEnabled', () => {
    it('returns true when prewarmCoverageCache is unset (default)', () => {
      expect(isPrewarmCoverageCacheEnabled(config())).toBe(true);
    });

    it('returns false when prewarmCoverageCache is false', () => {
      expect(isPrewarmCoverageCacheEnabled(config({ prewarmCoverageCache: false }))).toBe(false);
    });
  });
});
