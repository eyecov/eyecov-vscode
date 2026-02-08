#!/usr/bin/env node
/**
 * Converts a PHPUnit coverage HTML file to JSON (covered/uncovered lines + tests per line).
 * Usage: node scripts/html-to-coverage-json.js <path-to-file.html>
 * Writes next to the HTML file:
 *   - <base>.json       — sourcePath, coveredLines, uncoveredLines, testsFile
 *   - <base>.tests.json — testsByLine (line number -> list of test names)
 */
const fs = require('fs');
const path = require('path');
const { parseCoverageHtml, parseTestName } = require('../out/coverage-html.js');

const htmlPath = process.argv[2];
if (!htmlPath || !fs.existsSync(htmlPath)) {
  console.error('Usage: node scripts/html-to-coverage-json.js <path-to-file.html>');
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const result = parseCoverageHtml(html);

const basePath = htmlPath.replace(/\.html$/i, '');
const mainPath = basePath + '.json';
const testsPath = basePath + '.tests.json';

// Main coverage file (no testsByLine)
const mainJson = {
  sourcePath: result.sourcePath,
  coveredLines: result.coveredLines,
  uncoveredLines: result.uncoveredLines,
  testsFile: path.basename(testsPath),
};
fs.writeFileSync(mainPath, JSON.stringify(mainJson, null, 2), 'utf8');
console.log('Wrote', mainPath);

// Separate tests-by-line file: { "lineNum": [ { class, classFile, path, describe, description }, ... ] }
const testsByLine = {};
for (const [line, rawTests] of result.testsByLine) {
  testsByLine[String(line)] = rawTests.map((raw) => {
    const n = parseTestName(raw);
    return {
      class: n.class,
      classFile: n.classFile,
      path: n.path,
      describe: n.describe,
      description: n.description,
    };
  });
}
fs.writeFileSync(testsPath, JSON.stringify(testsByLine, null, 2), 'utf8');
console.log('Wrote', testsPath);
