'use strict';

/**
 * Parses a single log line into a structured object.
 * Returns null for lines that cannot be meaningfully parsed.
 *
 * Supported formats:
 *   Standard: 2024-03-15T14:23:01Z 192.168.1.42 GET /api/users 200 142ms
 *   Slash date: 2024/03/15 14:23:01 ...
 *   Named month: 15-Mar-2024 14:23:01 ...
 *   Unix epoch: 1710512581 ...
 *   Response time: 142ms | 0.142s | 142 (bare integer = ms)
 *   JSON lines: {"timestamp":..., "method":..., ...}
 *   Extra trailing fields (user agent, referrer) are captured but not required
 */

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Regex pieces
const TS_ISO     = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/;
const TS_SLASH   = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/;
const TS_NAMED   = /^(\d{1,2}-([A-Za-z]{3})-(\d{4}) \d{2}:\d{2}:\d{2})/;
const TS_EPOCH   = /^(\d{10}(?:\.\d+)?)\b/;         // 10-digit unix timestamp

const IP_RE      = /(\d{1,3}(?:\.\d{1,3}){3})/;
const METHOD_RE  = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\b/;
const PATH_RE    = /\s(\/\S*)/;
const STATUS_RE  = /\b([1-5]\d{2}|-)\b/;
const RT_MS_RE   = /\b(\d+(?:\.\d+)?)ms\b/;
const RT_S_RE    = /\b(\d+\.\d+)s\b/;
const RT_BARE_RE = /\b(\d+)\b/;                     // last-resort bare integer

/**
 * Attempt to extract a timestamp from the beginning of a line.
 * Returns { timestamp: Date, rest: string } or null.
 */
function extractTimestamp(line) {
  let m;

  if ((m = TS_ISO.exec(line))) {
    return { timestamp: new Date(m[1]), rest: line.slice(m[0].length).trim() };
  }
  if ((m = TS_SLASH.exec(line))) {
    return { timestamp: new Date(m[1].replace('/', '-').replace('/', '-')), rest: line.slice(m[0].length).trim() };
  }
  if ((m = TS_NAMED.exec(line))) {
    const [full, , mon, year] = m;
    const parts = full.split(' ');
    const datePart = parts[0]; // e.g. 15-Mar-2024
    const timePart = parts[1]; // e.g. 14:23:01
    const [day] = datePart.split('-');
    const monthIdx = MONTH_MAP[mon.toLowerCase()];
    if (monthIdx === undefined) return null;
    const d = new Date(Date.UTC(+year, monthIdx, +day, ...timePart.split(':').map(Number)));
    return { timestamp: d, rest: line.slice(full.length).trim() };
  }
  if ((m = TS_EPOCH.exec(line))) {
    const ts = parseFloat(m[1]) * 1000; // convert to ms
    return { timestamp: new Date(ts), rest: line.slice(m[0].length).trim() };
  }
  return null;
}

/**
 * Parse response time from a string token, returning milliseconds (float).
 * Returns null if no recognisable response time is found.
 */
function parseResponseTime(str) {
  let m;
  if ((m = RT_MS_RE.exec(str))) return parseFloat(m[1]);
  if ((m = RT_S_RE.exec(str)))  return parseFloat(m[1]) * 1000;
  // bare integer — only accept if it looks like it's a response-time token
  // (preceded/followed by whitespace or end, not a status code range)
  const bareMatch = str.match(/(?:^|\s)(\d{1,6})(?:\s|$)/);
  if (bareMatch) {
    const n = parseInt(bareMatch[1], 10);
    if (n >= 0 && n < 100000) return n; // sanity: up to 100s
  }
  return null;
}

/**
 * Try to parse a JSON log line.
 * Returns a normalised entry or null.
 */
function parseJsonLine(line) {
  try {
    const obj = JSON.parse(line);
    if (typeof obj !== 'object' || obj === null) return null;

    // Accept loose field names
    const timestamp = obj.timestamp || obj.time || obj.ts || obj['@timestamp'];
    const ip        = obj.ip || obj.remote_addr || obj.client || obj.host;
    const method    = (obj.method || obj.http_method || '').toUpperCase();
    const path      = obj.path || obj.url || obj.uri || obj.endpoint;
    const status    = parseInt(obj.status || obj.status_code || obj.code, 10);

    const rtRaw = obj.response_time || obj.duration || obj.latency || obj.elapsed;
    let responseTimeMs = null;
    if (typeof rtRaw === 'number') {
      // Heuristic: if < 10, probably seconds; otherwise ms
      responseTimeMs = rtRaw < 10 ? rtRaw * 1000 : rtRaw;
    } else if (typeof rtRaw === 'string') {
      responseTimeMs = parseResponseTime(rtRaw);
    }

    if (!timestamp && !path && !method) return null; // too sparse

    return {
      timestamp:      timestamp ? new Date(timestamp) : null,
      ip:             ip   || null,
      method:         METHOD_RE.test(method) ? method : null,
      path:           path || null,
      status:         (status >= 100 && status <= 599) ? status : null,
      responseTimeMs: responseTimeMs,
      raw:            line,
      format:         'json',
    };
  } catch {
    return null;
  }
}

/**
 * Parse a single text log line.
 * Strategy: tokenise by whitespace and assign fields by position/pattern.
 * Expected token order after timestamp: IP METHOD PATH STATUS RESPONSE_TIME [extras...]
 */
function parseTextLine(line) {
  const tsResult = extractTimestamp(line);
  if (!tsResult) return null;

  const { timestamp, rest } = tsResult;

  // Tokenise (but keep quoted strings together)
  const tokens = tokenise(rest);

  let ip = null, method = null, path = null, status = null;
  let statusConsumed = false;  // tracks whether we've seen the status field (even if '-')
  let responseTimeMs = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (!ip && IP_RE.test(t)) { ip = t; continue; }

    if (!method && METHOD_RE.test(t)) { method = t; continue; }

    if (!path && t.startsWith('/')) { path = t.split('?')[0]; continue; }

    // Status code: 3-digit or '-', but only after we have a path and haven't consumed it yet
    if (path && !statusConsumed) {
      if (t === '-') { statusConsumed = true; status = null; continue; }
      const n = parseInt(t, 10);
      if (!isNaN(n) && String(n) === t && n >= 100 && n <= 599) {
        status = n; statusConsumed = true; continue;
      }
    }

    // Response time (only after status field has been consumed)
    if (path && statusConsumed && responseTimeMs === null) {
      let rt = null;
      const msM = RT_MS_RE.exec(t);
      const sM  = RT_S_RE.exec(t);
      if (msM) {
        rt = parseFloat(msM[1]);
      } else if (sM) {
        rt = parseFloat(sM[1]) * 1000;
      } else if (/^\d{1,6}$/.test(t)) {
        // bare integer response time
        const n = parseInt(t, 10);
        if (n >= 0 && n < 100000) rt = n;
      }
      if (rt !== null) { responseTimeMs = rt; continue; }
    }
  }

  // Need at least method or path to be useful
  if (!method && !path) return null;

  return {
    timestamp,
    ip,
    method,
    path,
    status,
    responseTimeMs,
    raw:  line,
    format: 'text',
  };
}

/**
 * Split a line into tokens, keeping quoted strings together.
 */
function tokenise(str) {
  const tokens = [];
  let cur = '';
  let inQuote = false;
  let quoteChar = '';
  for (const ch of str) {
    if (inQuote) {
      cur += ch;
      if (ch === quoteChar) { inQuote = false; tokens.push(cur); cur = ''; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true; quoteChar = ch; cur += ch;
    } else if (ch === ' ' || ch === '\t') {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

/**
 * Main export: parse one line.
 * Returns { entry, error } where entry may be null and error describes why.
 */
function parseLine(line) {
  const trimmed = line.trim();

  if (trimmed === '') {
    return { entry: null, error: 'blank' };
  }

  // JSON line?
  if (trimmed.startsWith('{')) {
    const entry = parseJsonLine(trimmed);
    if (entry) return { entry, error: null };
    return { entry: null, error: 'invalid_json' };
  }

  // Stack trace / continuation lines (common patterns)
  if (/^\s+(at |Exception|Error:|Caused by:|\.{3}\d+ more)/.test(line)) {
    return { entry: null, error: 'stack_trace' };
  }

  const entry = parseTextLine(trimmed);
  if (entry) return { entry, error: null };

  return { entry: null, error: 'unparseable' };
}

module.exports = { parseLine, parseResponseTime };
