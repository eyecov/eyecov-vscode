import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  toFileSystemPath,
  resolveFilePath,
  getCandidatePathsForQuery,
} from './coverage-runtime';

describe('coverage-runtime', () => {
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covflux-test-'));
    workspaceRoot = path.join(tmpDir, 'workspace');
    fs.mkdirSync(path.join(workspaceRoot, 'app', 'Domain', 'Foo'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, 'coverage-html', 'Domain', 'Foo'), {
      recursive: true,
    });
    fs.writeFileSync(path.join(workspaceRoot, 'app', 'Domain', 'Foo', 'Action.php'), '<?php\n');
    const minimalHtml = `
<table id="code"><tr class="success d-flex"><td><a id="1" href="#1">1</a></td></tr></table>
`;
    fs.writeFileSync(
      path.join(workspaceRoot, 'coverage-html', 'Domain', 'Foo', 'Action.php.html'),
      minimalHtml
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('toFileSystemPath', () => {
    it('returns path unchanged when not file://', () => {
      expect(toFileSystemPath('/foo/bar')).toBe('/foo/bar');
      expect(toFileSystemPath('app/Foo.php')).toBe('app/Foo.php');
    });

    it('converts file:// URI to path', () => {
      const p = toFileSystemPath('file:///foo/bar');
      expect(p).toMatch(/[/\\]foo[/\\]bar$/);
    });
  });

  describe('resolveFilePath', () => {
    it('returns null for undefined', () => {
      expect(resolveFilePath(undefined, [workspaceRoot])).toBeNull();
    });

    it('resolves absolute path that exists', () => {
      const abs = path.join(workspaceRoot, 'app', 'Domain', 'Foo', 'Action.php');
      expect(resolveFilePath(abs, [])).toBe(path.resolve(abs));
    });

    it('resolves relative path under workspace root', () => {
      expect(resolveFilePath('app/Domain/Foo/Action.php', [workspaceRoot])).toBe(
        path.resolve(workspaceRoot, 'app/Domain/Foo/Action.php')
      );
    });

    it('returns null when path does not exist under any root', () => {
      expect(resolveFilePath('app/Nonexistent.php', [workspaceRoot])).toBeNull();
    });
  });

  describe('getCandidatePathsForQuery', () => {
    it('resolves by basename when query matches one file in coverage-html', () => {
      const paths = getCandidatePathsForQuery('Action.php', [workspaceRoot]);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('Action.php');
    });

    it('resolves by full relative path when file exists', () => {
      const paths = getCandidatePathsForQuery('app/Domain/Foo/Action.php', [workspaceRoot]);
      expect(paths).toHaveLength(1);
      expect(path.basename(paths[0])).toBe('Action.php');
    });

    it('returns empty array when no match', () => {
      expect(getCandidatePathsForQuery('Nonexistent.php', [workspaceRoot])).toEqual([]);
    });

    it('uses custom coverageHtmlDir when provided', () => {
      const buildHtml = path.join(workspaceRoot, 'build', 'coverage-html', 'Domain', 'Foo');
      fs.mkdirSync(buildHtml, { recursive: true });
      const minimalHtml = '<table id="code"><tr class="success d-flex"><td><a id="1" href="#1">1</a></td></tr></table>';
      fs.writeFileSync(path.join(buildHtml, 'Action.php.html'), minimalHtml);
      const paths = getCandidatePathsForQuery('Action.php', [workspaceRoot], {
        coverageHtmlDir: 'build/coverage-html',
      });
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('Action.php');
    });

    it('uses sourceSegment when provided so basename search looks under src/', () => {
      fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, 'src', 'Baz.php'), '<?php\n');
      fs.writeFileSync(
        path.join(workspaceRoot, 'coverage-html', 'Baz.php.html'),
        '<table id="code"><tr class="success d-flex"><td></td></tr></table>'
      );
      const paths = getCandidatePathsForQuery('Baz.php', [workspaceRoot], { sourceSegment: 'src' });
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(path.resolve(workspaceRoot, 'src', 'Baz.php'));
    });
  });
});
