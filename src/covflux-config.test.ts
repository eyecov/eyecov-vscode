import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadCovfluxConfig,
  DEFAULT_CONFIG,
  getPhpUnitHtmlDir,
  getLcovPath,
  getLcovPathsToWatch,
  type CovfluxConfig,
} from './covflux-config';

describe('covflux-config', () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covflux-config-'));
    workspaceRoot = path.join(tmpDir, 'workspace');
    fs.mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('DEFAULT_CONFIG', () => {
    it('has phpunit-html then lcov with default paths', () => {
      expect(DEFAULT_CONFIG.formats).toHaveLength(2);
      expect(DEFAULT_CONFIG.formats[0]).toEqual({ type: 'phpunit-html', path: 'coverage-html' });
      expect(DEFAULT_CONFIG.formats[1]).toEqual({ type: 'lcov', path: 'coverage/lcov.info' });
    });
  });

  describe('loadCovfluxConfig', () => {
    it('returns DEFAULT_CONFIG when no config file exists', () => {
      const config = loadCovfluxConfig(workspaceRoot);
      expect(config.formats).toEqual(DEFAULT_CONFIG.formats);
    });

    it('returns DEFAULT_CONFIG when workspace root is empty or missing', () => {
      expect(loadCovfluxConfig('').formats).toEqual(DEFAULT_CONFIG.formats);
      expect(loadCovfluxConfig(path.join(tmpDir, 'nonexistent')).formats).toEqual(DEFAULT_CONFIG.formats);
    });

    it('loads .covflux.json and uses its formats', () => {
      fs.writeFileSync(
        path.join(workspaceRoot, '.covflux.json'),
        JSON.stringify({
          formats: [
            { type: 'phpunit-html', path: 'build/coverage-html' },
            { type: 'lcov', path: 'out/lcov.info' },
          ],
        })
      );
      const config = loadCovfluxConfig(workspaceRoot);
      expect(config.formats).toHaveLength(2);
      expect(config.formats[0]).toEqual({ type: 'phpunit-html', path: 'build/coverage-html' });
      expect(config.formats[1]).toEqual({ type: 'lcov', path: 'out/lcov.info' });
    });

    it('loads covflux.json when .covflux.json is absent', () => {
      fs.writeFileSync(
        path.join(workspaceRoot, 'covflux.json'),
        JSON.stringify({ formats: [{ type: 'lcov', path: 'coverage/lcov.info' }] })
      );
      const config = loadCovfluxConfig(workspaceRoot);
      expect(config.formats).toHaveLength(1);
      expect(config.formats[0]).toEqual({ type: 'lcov', path: 'coverage/lcov.info' });
    });

    it('prefers .covflux.json over covflux.json', () => {
      fs.writeFileSync(path.join(workspaceRoot, 'covflux.json'), JSON.stringify({ formats: [{ type: 'lcov', path: 'a.info' }] }));
      fs.writeFileSync(path.join(workspaceRoot, '.covflux.json'), JSON.stringify({ formats: [{ type: 'lcov', path: 'b.info' }] }));
      const config = loadCovfluxConfig(workspaceRoot);
      expect(config.formats[0].path).toBe('b.info');
    });

    it('ignores unknown format types', () => {
      fs.writeFileSync(
        path.join(workspaceRoot, '.covflux.json'),
        JSON.stringify({
          formats: [
            { type: 'phpunit-html', path: 'coverage-html' },
            { type: 'unknown-format', path: 'x' },
            { type: 'lcov', path: 'coverage/lcov.info' },
          ],
        })
      );
      const config = loadCovfluxConfig(workspaceRoot);
      expect(config.formats).toHaveLength(2);
      expect(config.formats.map((f) => f.type)).toEqual(['phpunit-html', 'lcov']);
    });

    it('ignores entries with missing or invalid type/path', () => {
      fs.writeFileSync(
        path.join(workspaceRoot, '.covflux.json'),
        JSON.stringify({
          formats: [
            { type: 'phpunit-html', path: '' },
            { type: '', path: 'coverage-html' },
            { type: 'lcov', path: 'coverage/lcov.info' },
          ],
        })
      );
      const config = loadCovfluxConfig(workspaceRoot);
      expect(config.formats).toHaveLength(1);
      expect(config.formats[0].type).toBe('lcov');
    });

    it('returns DEFAULT_CONFIG when JSON is invalid', () => {
      fs.writeFileSync(path.join(workspaceRoot, '.covflux.json'), 'not json');
      const config = loadCovfluxConfig(workspaceRoot);
      expect(config.formats).toEqual(DEFAULT_CONFIG.formats);
    });

    it('returns DEFAULT_CONFIG when formats is not an array', () => {
      fs.writeFileSync(path.join(workspaceRoot, '.covflux.json'), JSON.stringify({ formats: null }));
      const config = loadCovfluxConfig(workspaceRoot);
      expect(config.formats).toEqual(DEFAULT_CONFIG.formats);
    });
  });

  describe('getPhpUnitHtmlDir', () => {
    it('returns default when no phpunit-html in config', () => {
      const config = { formats: [{ type: 'lcov', path: 'coverage/lcov.info' }] };
      expect(getPhpUnitHtmlDir(config)).toBe('coverage-html');
    });

    it('returns path from first phpunit-html entry', () => {
      const config = { formats: [{ type: 'phpunit-html', path: 'build/html' }] };
      expect(getPhpUnitHtmlDir(config)).toBe('build/html');
    });
  });

  describe('getLcovPath', () => {
    it('returns default when no lcov in config', () => {
      const config = { formats: [{ type: 'phpunit-html', path: 'coverage-html' }] };
      expect(getLcovPath(config)).toBe('coverage/lcov.info');
    });

    it('returns path from first lcov entry', () => {
      const config = { formats: [{ type: 'lcov', path: 'out/lcov.info' }] };
      expect(getLcovPath(config)).toBe('out/lcov.info');
    });
  });

  describe('getLcovPathsToWatch', () => {
    it('returns one absolute path per workspace root using default lcov path', () => {
      const config: CovfluxConfig = DEFAULT_CONFIG;
      const roots = [workspaceRoot];
      const paths = getLcovPathsToWatch(config, roots);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(path.join(workspaceRoot, 'coverage', 'lcov.info'));
    });

    it('returns custom lcov path when configured', () => {
      const config: CovfluxConfig = { formats: [{ type: 'lcov', path: 'build/coverage.info' }] };
      const roots = [workspaceRoot];
      const paths = getLcovPathsToWatch(config, roots);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(path.join(workspaceRoot, 'build', 'coverage.info'));
    });

    it('returns one path per workspace root for multi-root', () => {
      const root2 = path.join(tmpDir, 'workspace2');
      fs.mkdirSync(root2, { recursive: true });
      const config: CovfluxConfig = DEFAULT_CONFIG;
      const paths = getLcovPathsToWatch(config, [workspaceRoot, root2]);
      expect(paths).toHaveLength(2);
      expect(paths[0]).toBe(path.join(workspaceRoot, 'coverage', 'lcov.info'));
      expect(paths[1]).toBe(path.join(root2, 'coverage', 'lcov.info'));
    });

    it('returns empty array when config has no lcov format', () => {
      const config: CovfluxConfig = { formats: [{ type: 'phpunit-html', path: 'coverage-html' }] };
      const paths = getLcovPathsToWatch(config, [workspaceRoot]);
      expect(paths).toHaveLength(0);
    });
  });
});
