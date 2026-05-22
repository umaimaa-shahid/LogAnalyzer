#!/usr/bin/env node
'use strict';

const path    = require('path');
const fs      = require('fs');
const { Command } = require('commander');
const { analyzeFile }  = require('./src/reader');
const { printReport }  = require('./src/cli-renderer');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

const program = new Command();

program
  .name('log-analyzer')
  .description('Analyze web server log files and surface useful insights')
  .version(pkg.version)
  .argument('[file]', 'Path to log file (omit to read from stdin)')
  .option('-j, --json', 'Output raw JSON report instead of formatted text')
  .option('-v, --verbose', 'Print skipped lines to stderr')
  .option('-w, --web', 'Launch web dashboard (default port 3000)')
  .option('-p, --port <number>', 'Port for web dashboard', '3000')
  .option('--top <n>', 'How many top items to show', '10')
  .action(async (file, opts) => {
    // Validate file exists if provided
    if (file) {
      if (!fs.existsSync(file)) {
        console.error(`Error: File not found: ${file}`);
        process.exit(1);
      }
    } else if (process.stdin.isTTY) {
      program.help();
      return;
    }

    if (opts.web) {
      // Launch web server
      const { startServer } = require('./src/server');
      const port = parseInt(opts.port, 10);

      console.log('Analyzing log file…');
      const { report } = await analyzeFile(file || null, { verbose: opts.verbose });
      startServer(report, port);
      return;
    }

    // CLI mode
    if (!opts.json) {
      process.stderr.write('Analyzing…\n');
    }

    const { report } = await analyzeFile(file || null, {
      verbose: opts.verbose,
      onProgress: (n) => {
        if (!opts.json) process.stderr.write(`  …${n.toLocaleString()} lines processed\r`);
      },
    });

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      process.stderr.write('\n');
      printReport(report);
    }
  });

program.parse();
