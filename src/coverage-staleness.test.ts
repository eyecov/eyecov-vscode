import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isCoverageStale } from './coverage-staleness';

describe('isCoverageStale', () => {
  let tmpDir: string;
  let sourcePath: string;
  let artifactPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'covflux-stale-'));
    sourcePath = path.join(tmpDir, 'source.php');
    artifactPath = path.join(tmpDir, 'coverage.html');
    fs.writeFileSync(sourcePath, '<?php');
    fs.writeFileSync(artifactPath, '<html></html>');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when source file is newer than coverage artifact (reject coverage)', () => {
    const nowSec = Date.now() / 1000;
    const fiveSecondsAgo = nowSec - 5;
    fs.utimesSync(artifactPath, fiveSecondsAgo, fiveSecondsAgo);
    fs.utimesSync(sourcePath, nowSec, nowSec);

    expect(isCoverageStale(sourcePath, artifactPath)).toBe(true);
  });

  it('returns false when source is older than or equal to artifact (use coverage)', () => {
    const nowSec = Date.now() / 1000;
    const fiveSecondsAgo = nowSec - 5;
    fs.utimesSync(sourcePath, fiveSecondsAgo, fiveSecondsAgo);
    fs.utimesSync(artifactPath, nowSec, nowSec);

    expect(isCoverageStale(sourcePath, artifactPath)).toBe(false);
  });

  it('returns true when source or artifact cannot be statted (fail safe)', () => {
    expect(isCoverageStale(path.join(tmpDir, 'nonexistent.php'), artifactPath)).toBe(true);
    expect(isCoverageStale(sourcePath, path.join(tmpDir, 'nonexistent.html'))).toBe(true);
  });
});
