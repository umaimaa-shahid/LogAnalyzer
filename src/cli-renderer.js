'use strict';

const _chalkPkg = require('chalk');
const chalk = _chalkPkg.default || new _chalkPkg.Chalk();

function fmtMs(ms) {
  if (ms === null || ms === undefined) return chalk.gray('—');
  if (ms >= 1000) return chalk.red(`${(ms/1000).toFixed(2)}s`);
  if (ms >= 300)  return chalk.yellow(`${ms.toFixed(0)}ms`);
  return chalk.green(`${ms.toFixed(0)}ms`);
}

function fmtStatus(s) {
  const code = parseInt(s, 10);
  if (code >= 500) return chalk.bgRed.white(` ${s} `);
  if (code >= 400) return chalk.red(s);
  if (code >= 300) return chalk.cyan(s);
  return chalk.green(s);
}

function bar(value, max, width = 20) {
  const filled = Math.min(width, Math.max(0, Math.round((value / Math.max(max,1)) * width)));
  const empty  = Math.max(0, width - filled);
  return chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

function printReport(report) {
  const { summary, statusCodes, methods, topEndpoints, topIPs,
          slowestEndpoints, errorEndpoints, responseTimeSummary } = report;

  console.log('\n' + chalk.bold.blue('═'.repeat(60)));
  console.log(chalk.bold.blue('  LOG ANALYZER REPORT'));
  console.log(chalk.bold.blue('═'.repeat(60)));

  // ── Summary ──
  console.log('\n' + chalk.bold('📊 SUMMARY'));
  console.log(`  Total lines:    ${chalk.white(summary.totalLines.toLocaleString())}`);
  console.log(`  Parsed:         ${chalk.green(summary.parsedLines.toLocaleString())} ` +
    `(${((summary.parsedLines/summary.totalLines)*100).toFixed(1)}%)`);
  console.log(`  Skipped:        ${chalk.yellow(summary.skippedLines.toLocaleString())} ` +
    `(${((summary.skippedLines/summary.totalLines)*100).toFixed(1)}%)`);

  if (Object.keys(summary.skipReasons).length) {
    console.log('  Skip breakdown:');
    for (const [reason, count] of Object.entries(summary.skipReasons)) {
      if (reason !== 'blank') {
        console.log(`    ${chalk.gray(reason.padEnd(18))} ${chalk.yellow(count)}`);
      }
    }
  }

  if (summary.timeRange.from) {
    console.log(`  Time range:     ${summary.timeRange.from} → ${summary.timeRange.to}`);
    if (summary.timeRange.durationSec) {
      const hrs = (summary.timeRange.durationSec / 3600).toFixed(1);
      console.log(`  Duration:       ${hrs}h  |  Req/sec: ${chalk.cyan(summary.requestsPerSec ?? '—')}`);
    }
  }

  if (summary.formatBreakdown) {
    const parts = Object.entries(summary.formatBreakdown)
      .filter(([,v]) => v > 0)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    if (parts) console.log(`  Formats:        ${chalk.gray(parts)}`);
  }

  // ── Response Time ──
  if (responseTimeSummary) {
    console.log('\n' + chalk.bold('⏱  RESPONSE TIME (ms)'));
    const r = responseTimeSummary;
    console.log(`  Samples: ${r.count.toLocaleString()}`);
    console.log(`  min ${fmtMs(r.min)}   p50 ${fmtMs(r.p50)}   p75 ${fmtMs(r.p75)}   ` +
                `p95 ${fmtMs(r.p95)}   p99 ${fmtMs(r.p99)}   max ${fmtMs(r.max)}`);
  }

  // ── Status Codes ──
  console.log('\n' + chalk.bold('📈 STATUS CODES'));
  const statusEntries = Object.entries(statusCodes);
  const maxStatus = statusEntries[0]?.[1] || 1;
  for (const [code, count] of statusEntries) {
    console.log(`  ${fmtStatus(code)}  ${bar(count, maxStatus, 16)} ${count.toLocaleString()}`);
  }

  // ── Methods ──
  console.log('\n' + chalk.bold('🔧 HTTP METHODS'));
  const methodEntries = Object.entries(methods);
  const maxMethod = methodEntries[0]?.[1] || 1;
  for (const [method, count] of methodEntries) {
    console.log(`  ${chalk.cyan(method.padEnd(8))} ${bar(count, maxMethod, 16)} ${count.toLocaleString()}`);
  }

  // ── Top Endpoints ──
  console.log('\n' + chalk.bold('🔗 TOP ENDPOINTS (by request count)'));
  const maxEndpoint = topEndpoints[0]?.count || 1;
  for (const { key, count } of topEndpoints) {
    console.log(`  ${chalk.white(key.padEnd(35).slice(0,35))} ${bar(count, maxEndpoint, 14)} ${count.toLocaleString()}`);
  }

  // ── Slowest Endpoints ──
  if (slowestEndpoints.length) {
    console.log('\n' + chalk.bold('🐢 SLOWEST ENDPOINTS (p95)'));
    for (const e of slowestEndpoints) {
      const pathStr = chalk.white(e.path.slice(0, 36).padEnd(36));
      const stats   = `p50:${fmtMs(e.p50)}  p95:${fmtMs(e.p95)}  p99:${fmtMs(e.p99)}  max:${fmtMs(e.max)}`;
      console.log(`  ${pathStr}  ${stats}  ${chalk.gray(e.requests + ' req')}`);
    }
  }

  // ── Error Endpoints ──
  if (errorEndpoints.length) {
    console.log('\n' + chalk.bold('🚨 ERROR ENDPOINTS (by 5xx count)'));
    for (const e of errorEndpoints) {
      const errLine = chalk.red(`${e.total5xx} 5xx`) + ' ' + chalk.yellow(`${e.total4xx} 4xx`) +
        chalk.gray(` / ${e.totalRequests} req (${e.errorRate}% error rate)`);
      console.log(`  ${chalk.white(e.path.slice(0,35).padEnd(35))}  ${errLine}`);
    }
  }

  // ── Top IPs ──
  console.log('\n' + chalk.bold('🌐 TOP IPs'));
  const maxIP = topIPs[0]?.count || 1;
  for (const { key, count } of topIPs) {
    console.log(`  ${key.padEnd(18)} ${bar(count, maxIP, 14)} ${count.toLocaleString()}`);
  }

  console.log('\n' + chalk.gray('─'.repeat(60)) + '\n');
}

module.exports = { printReport };
