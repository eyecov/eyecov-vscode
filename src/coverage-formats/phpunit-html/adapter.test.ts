import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveCoverageHtmlPath,
  buildCoverageFileResult,
  findCoverageHtmlBasenameMatches,
  listCoverageHtmlSourcePaths,
  stripTestsByLine,
  PhpUnitHtmlAdapter,
} from './index';

describe('phpunit-html adapter', () => {
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

  describe('resolveCoverageHtmlPath', () => {
    it('resolves when source file is under app/ and coverage-html exists', () => {
      const sourcePath = path.join(workspaceRoot, 'app', 'Domain', 'Foo', 'Action.php');
      const expected = path.join(workspaceRoot, 'coverage-html', 'Domain', 'Foo', 'Action.php.html');
      expect(resolveCoverageHtmlPath(sourcePath, [workspaceRoot])).toBe(path.resolve(expected));
    });

    it('returns null when coverage-html file does not exist', () => {
      const sourcePath = path.join(workspaceRoot, 'app', 'Domain', 'Foo', 'Other.php');
      expect(resolveCoverageHtmlPath(sourcePath, [workspaceRoot])).toBeNull();
    });

    it('returns null when source is not under app/', () => {
      expect(resolveCoverageHtmlPath('/tmp/other/file.php', [workspaceRoot])).toBeNull();
    });
  });

  describe('buildCoverageFileResult', () => {
    it('returns ParsedCoverageFileResult with line stats and testsByLine', () => {
      const sourcePath = path.join(workspaceRoot, 'app', 'Domain', 'Foo', 'Action.php');
      const htmlPath = path.join(workspaceRoot, 'coverage-html', 'Domain', 'Foo', 'Action.php.html');
      const result = buildCoverageFileResult(sourcePath, htmlPath);
      expect(result.filePath).toBe(sourcePath);
      expect(result.coverageHtmlPath).toBe(htmlPath);
      expect(result.coveredLines).toBe(1);
      expect(result.uncoveredLines).toBe(0);
      expect(result.lineCoveragePercent).toBe(100);
      expect(result.coveredLineNumbers).toEqual([1]);
      expect(result.testsByLine).toBeInstanceOf(Map);
    });
  });

  describe('stripTestsByLine', () => {
    it('removes only testsByLine from ParsedCoverageFileResult and keeps coveredLineNumbers', () => {
      const sourcePath = path.join(workspaceRoot, 'app', 'Domain', 'Foo', 'Action.php');
      const htmlPath = path.join(workspaceRoot, 'coverage-html', 'Domain', 'Foo', 'Action.php.html');
      const full = buildCoverageFileResult(sourcePath, htmlPath);
      const stripped = stripTestsByLine(full);
      expect(stripped).not.toHaveProperty('testsByLine');
      expect(stripped).toHaveProperty('coveredLineNumbers');
      expect(stripped.coveredLineNumbers).toEqual(full.coveredLineNumbers);
      expect(stripped.filePath).toBe(full.filePath);
      expect(stripped.coveredLines).toBe(full.coveredLines);
    });
  });

  describe('findCoverageHtmlBasenameMatches', () => {
    it('finds files by basename under coverage-html', () => {
      const matches = findCoverageHtmlBasenameMatches('Action.php', [workspaceRoot]);
      expect(matches).toHaveLength(1);
      expect(matches[0].filePath).toContain('Action.php');
    });

    it('accepts query with .html suffix', () => {
      const matches = findCoverageHtmlBasenameMatches('Action.php.html', [workspaceRoot]);
      expect(matches).toHaveLength(1);
    });

    it('returns empty when no coverage-html root exists', () => {
      const emptyRoot = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyRoot);
      expect(findCoverageHtmlBasenameMatches('Action.php', [emptyRoot])).toEqual([]);
    });
  });

  describe('listCoverageHtmlSourcePaths', () => {
    it('returns all source paths that have coverage HTML under the given roots', () => {
      const paths = listCoverageHtmlSourcePaths([workspaceRoot]);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe(path.resolve(workspaceRoot, 'app', 'Domain', 'Foo', 'Action.php'));
    });

    it('returns empty when coverage-html root does not exist', () => {
      const emptyRoot = path.join(tmpDir, 'empty');
      fs.mkdirSync(emptyRoot);
      expect(listCoverageHtmlSourcePaths([emptyRoot])).toEqual([]);
    });
  });

  describe('PhpUnitHtmlAdapter (staleness)', () => {
    it('returns null when source file is newer than coverage HTML (stale)', async () => {
      const sourcePath = path.join(workspaceRoot, 'app', 'Domain', 'Foo', 'Action.php');
      const htmlPath = path.join(workspaceRoot, 'coverage-html', 'Domain', 'Foo', 'Action.php.html');
      const nowSec = Date.now() / 1000;
      const fiveSecondsAgo = nowSec - 5;
      fs.utimesSync(htmlPath, fiveSecondsAgo, fiveSecondsAgo);
      fs.utimesSync(sourcePath, nowSec, nowSec);

      const adapter = new PhpUnitHtmlAdapter();
      const record = await adapter.getCoverage(sourcePath, [workspaceRoot]);

      expect(record).toBeNull();
    });
  });
});
