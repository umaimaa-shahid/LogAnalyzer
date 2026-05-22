#!/usr/bin/env node
'use strict';
/**
 * scripts/generate-logs.js
 *
 * Generates a representative log file for testing the log analyzer.
 * Usage:
 *   node scripts/generate-logs.js [lines] [output-file]
 *   node scripts/generate-logs.js 50000 test.log
 *
 * Defaults: 10000 lines, ./sample.log
 */

const fs   = require('fs');
const path = require('path');

const LINES  = parseInt(process.argv[2], 10) || 10000;
const OUTPUT = process.argv[3] || path.join(__dirname, '..', 'sample.log');

// ── Config ──────────────────────────────────────────────────────────────────
const IPS = [
  '192.168.1.42', '192.168.1.100', '10.0.0.7', '10.0.0.15',
  '172.16.0.5',   '203.0.113.8',   '198.51.100.3', '54.239.28.85',
  '104.26.11.74', '185.199.108.153',
];

const PATHS = [
  ['/api/users',               'GET',    200, 5],
  ['/api/users/:id',           'GET',    200, 8],
  ['/api/login',               'POST',   200, 3],
  ['/api/login',               'POST',   401, 2],
  ['/api/logout',              'POST',   204, 1],
  ['/api/products',            'GET',    200, 6],
  ['/api/products/:id',        'GET',    200, 7],
  ['/api/orders',              'POST',   201, 2],
  ['/api/orders/:id',          'GET',    200, 4],
  ['/api/orders/:id',          'DELETE', 403, 1],
  ['/api/admin/stats',         'GET',    200, 1],
  ['/api/admin/users',         'GET',    200, 1],
  ['/api/internal/health',     'GET',    200, 2],
  ['/api/payments',            'POST',   200, 1],
  ['/api/payments',            'POST',   500, 0.3],
  ['/api/search',              'GET',    200, 3],
  ['/static/main.js',          'GET',    200, 4],
  ['/static/style.css',        'GET',    304, 3],
  ['/favicon.ico',             'GET',    200, 2],
  ['/',                        'GET',    200, 5],
  ['/not-found-path',          'GET',    404, 1],
  ['/api/missing',             'DELETE', 404, 0.5],
  ['/api/crash',               'GET',    500, 0.2],
  ['/api/slow-endpoint',       'GET',    200, 0.5],
];

// Build weighted list
const WEIGHTED = [];
for (const [p, m, s, w] of PATHS) {
  const reps = Math.max(1, Math.round(w * 10));
  for (let i = 0; i < reps; i++) WEIGHTED.push([p, m, s]);
}

const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const AGENTS   = [
  '"Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36"',
  '"python-requests/2.31.0"',
  '"curl/7.88.1"',
  '"Go-http-client/2.0"',
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function rnd(arr)       { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(a, b)   { return Math.floor(Math.random() * (b - a + 1)) + a; }
function rndFloat(a, b) { return Math.random() * (b - a) + a; }

function randomIp()  { return rnd(IPS); }

// Response time based on path
function responseTime(path) {
  if (path.includes('slow'))      return rndInt(800, 4000);
  if (path.includes('payment'))   return rndInt(200, 600);
  if (path.includes('login'))     return rndInt(80, 200);
  if (path.includes('static'))    return rndInt(2, 20);
  return rndInt(10, 300);
}

// Timestamp: start from a base and increment randomly
let currentTime = new Date('2024-03-15T14:00:00Z').getTime();

function nextTimestamp() {
  currentTime += rndInt(50, 3000); // 50ms–3s between requests
  return new Date(currentTime);
}

// Format timestamp in different ways
function formatTimestamp(date, fmt) {
  switch(fmt) {
    case 'iso':
      return date.toISOString().replace('.000', '').replace(/\.\d+/, '');
    case 'slash':
      return date.toISOString().replace('T', ' ').slice(0, 19)
                 .replace(/-/g, '/').replace('/', '/');
    case 'named': {
      const d = date.getUTCDate().toString().padStart(2, '0');
      const m = MONTHS[date.getUTCMonth()];
      const y = date.getUTCFullYear();
      const t = date.toISOString().slice(11, 19);
      return `${d}-${m}-${y} ${t}`;
    }
    case 'epoch':
      return String(Math.floor(date.getTime() / 1000));
    default:
      return date.toISOString().replace('.000Z', 'Z');
  }
}

// Format response time in different units
function formatRt(ms, fmt) {
  switch(fmt) {
    case 'ms':    return `${ms}ms`;
    case 's':     return `${(ms / 1000).toFixed(3)}s`;
    case 'bare':  return String(ms);
    default:      return `${ms}ms`;
  }
}

// Replace :id with a random number
function realPath(pathTpl) {
  return pathTpl.replace(/:id/g, () => rndInt(1, 9999));
}

// ── Line generators ──────────────────────────────────────────────────────────

function stdLine() {
  const ts          = nextTimestamp();
  const ip          = randomIp();
  const [pathTpl, method, status] = rnd(WEIGHTED);
  const p           = realPath(pathTpl);
  const rt          = responseTime(pathTpl);
  const tsFmt       = rnd(['iso','iso','iso','iso','slash','named','epoch']); // weight iso
  const rtFmt       = rnd(['ms','ms','ms','s','bare']);
  const withAgent   = Math.random() < 0.1;
  const statusField = Math.random() < 0.03 ? '-' : String(status);
  const tsStr       = formatTimestamp(ts, tsFmt);
  const rtStr       = formatRt(rt, rtFmt);
  let line = `${tsStr} ${ip} ${method} ${p} ${statusField} ${rtStr}`;
  if (withAgent) line += ' ' + rnd(AGENTS);
  return line;
}

function jsonLine() {
  const ts          = nextTimestamp();
  const [pathTpl, method, status] = rnd(WEIGHTED);
  const p           = realPath(pathTpl);
  const rt          = responseTime(pathTpl);
  const obj = {
    timestamp:     ts.toISOString(),
    ip:            randomIp(),
    method,
    path:          p,
    status,
    response_time: `${rt}ms`,
  };
  return JSON.stringify(obj);
}

function malformedLine() {
  const types = [
    // Partial write
    () => `2024-03-15T14:23:01Z 10.0.0.1 GET /api/`,
    // Stack trace continuation
    () => `    at processRequest (server.js:142:23)`,
    () => `    at async Router.handle (router.js:284:15)`,
    () => `java.lang.NullPointerException: Cannot read field "id"`,
    () => `    at com.example.UserService.getUser(UserService.java:88)`,
    // Garbled binary-like data
    () => `\x00\x01\x02corrupted log entry\xff\xfe`,
    // Just garbage
    () => `ERROR SIGPIPE broken pipe fd=7`,
    // Empty-ish
    () => `   `,
    // Wrong field order
    () => `GET /api/users 200 192.168.1.1 2024-03-15T14:23:01Z`,
    // Missing status
    () => `2024-03-15T14:23:01Z 192.168.1.1 POST /api/login  54ms`,
    // Extra = structured log from a different system
    () => `level=info ts=${Date.now()} caller=main.go:45 msg="request completed" path=/api/users status=200 duration=0.042s`,
  ];
  return rnd(types)();
}

function blankLine() { return ''; }

// ── Main ─────────────────────────────────────────────────────────────────────
console.error(`Generating ${LINES.toLocaleString()} lines → ${OUTPUT}`);

const out = fs.createWriteStream(OUTPUT);

for (let i = 0; i < LINES; i++) {
  const roll = Math.random();
  let line;

  if (roll < 0.02) {
    line = blankLine();
  } else if (roll < 0.06) {
    line = malformedLine();
  } else if (roll < 0.10) {
    line = jsonLine();
  } else {
    line = stdLine();
  }

  out.write(line + '\n');
}

out.end(() => {
  console.error(`Done. File written: ${OUTPUT}`);
});
