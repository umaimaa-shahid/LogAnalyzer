'use strict';

const fs       = require('fs');
const readline = require('readline');
const { parseLine } = require('./parser');
const { Analyzer }  = require('./analyzer');

/**
 * Read a log file (or stdin) line-by-line and return a completed report.
 * @param {string|null} filePath - path to log file, or null for stdin
 * @param {{ verbose?: boolean, onProgress?: function }} opts
 * @returns {Promise<{ report: object, analyzer: Analyzer }>}
 */
async function analyzeFile(filePath, opts = {}) {
  const { verbose = false, onProgress } = opts;
  const analyzer = new Analyzer();

  const input = filePath
    ? fs.createReadStream(filePath, { encoding: 'utf8' })
    : process.stdin;

  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    analyzer.totalLines++;

    const { entry, error } = parseLine(line);

    if (entry) {
      analyzer.ingest(entry);
    } else {
      analyzer.skip(error || 'unknown');
      if (verbose && error !== 'blank') {
        process.stderr.write(`  [SKIP line ${lineNum}] reason=${error}  ${line.slice(0, 80)}\n`);
      }
    }

    if (onProgress && lineNum % 10000 === 0) {
      onProgress(lineNum);
    }
  }

  return { report: analyzer.report(), analyzer };
}

module.exports = { analyzeFile };
