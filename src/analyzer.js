'use strict';

/**
 * Aggregates a stream of parsed log entries into a structured report.
 */

class Analyzer {
  constructor() {
    this.totalLines     = 0;
    this.parsedCount    = 0;
    this.skippedCount   = 0;
    this.skipReasons    = {};   // reason -> count

    this.statusCounts   = {};   // "200" -> count
    this.methodCounts   = {};   // "GET" -> count
    this.pathCounts     = {};   // "/api/users" -> count
    this.ipCounts       = {};   // "1.2.3.4" -> count

    // For response time percentiles, store per-path arrays (capped for memory)
    this.pathTimes      = {};   // path -> [ms, ...]  (max 10k per path)
    this.allTimes       = [];   // global (max 100k)

    this.errorsByPath   = {};   // path -> { "4xx": N, "5xx": N }
    this.timelineData   = {};   // "YYYY-MM-DDTHH:MM" -> { requests, errors }

    this.firstTs        = null;
    this.lastTs         = null;
    this.formatCounts   = { text: 0, json: 0 };
  }

  ingest(entry) {
    this.parsedCount++;

    // Format tally
    if (entry.format) this.formatCounts[entry.format] = (this.formatCounts[entry.format] || 0) + 1;

    // Timeline bucket (minute-level)
    if (entry.timestamp && !isNaN(entry.timestamp)) {
      const ts = entry.timestamp;
      if (!this.firstTs || ts < this.firstTs) this.firstTs = ts;
      if (!this.lastTs  || ts > this.lastTs)  this.lastTs  = ts;

      const bucket = ts.toISOString().slice(0, 16); // "2024-03-15T14:23"
      if (!this.timelineData[bucket]) this.timelineData[bucket] = { requests: 0, errors: 0 };
      this.timelineData[bucket].requests++;
      if (entry.status && entry.status >= 400) this.timelineData[bucket].errors++;
    }

    // Status
    if (entry.status !== null && entry.status !== undefined) {
      const s = String(entry.status);
      this.statusCounts[s] = (this.statusCounts[s] || 0) + 1;
    }

    // Method
    if (entry.method) {
      this.methodCounts[entry.method] = (this.methodCounts[entry.method] || 0) + 1;
    }

    // Path (normalise IDs: /api/users/123 -> /api/users/:id)
    const normPath = entry.path ? normalisePath(entry.path) : null;
    if (normPath) {
      this.pathCounts[normPath] = (this.pathCounts[normPath] || 0) + 1;

      // Error tracking per path
      if (entry.status && entry.status >= 400) {
        if (!this.errorsByPath[normPath]) this.errorsByPath[normPath] = { '4xx': 0, '5xx': 0 };
        if (entry.status < 500) this.errorsByPath[normPath]['4xx']++;
        else                    this.errorsByPath[normPath]['5xx']++;
      }

      // Response time tracking
      if (entry.responseTimeMs !== null && entry.responseTimeMs !== undefined && !isNaN(entry.responseTimeMs)) {
        if (!this.pathTimes[normPath]) this.pathTimes[normPath] = [];
        if (this.pathTimes[normPath].length < 10000) this.pathTimes[normPath].push(entry.responseTimeMs);
        if (this.allTimes.length < 100000) this.allTimes.push(entry.responseTimeMs);
      }
    }

    // IP
    if (entry.ip) {
      this.ipCounts[entry.ip] = (this.ipCounts[entry.ip] || 0) + 1;
    }
  }

  skip(reason) {
    this.skippedCount++;
    this.skipReasons[reason] = (this.skipReasons[reason] || 0) + 1;
  }

  /**
   * Produce the final report object.
   */
  report() {
    const durationSec = (this.firstTs && this.lastTs)
      ? (this.lastTs - this.firstTs) / 1000
      : null;

    return {
      summary: {
        totalLines:    this.totalLines,
        parsedLines:   this.parsedCount,
        skippedLines:  this.skippedCount,
        skipReasons:   this.skipReasons,
        formatBreakdown: this.formatCounts,
        timeRange: {
          from:        this.firstTs ? this.firstTs.toISOString() : null,
          to:          this.lastTs  ? this.lastTs.toISOString()  : null,
          durationSec,
        },
        requestsPerSec: (durationSec && durationSec > 0)
          ? +(this.parsedCount / durationSec).toFixed(2)
          : null,
      },

      statusCodes:  sortedDesc(this.statusCounts),
      methods:      sortedDesc(this.methodCounts),

      topEndpoints: topN(this.pathCounts, 10),
      topIPs:       topN(this.ipCounts, 10),

      slowestEndpoints: this._slowestEndpoints(10),
      errorEndpoints:   this._errorEndpoints(10),

      responseTimeSummary: percentileSummary(this.allTimes),

      timeline: this._timeline(),
    };
  }

  _slowestEndpoints(n) {
    return Object.entries(this.pathTimes)
      .map(([path, times]) => ({
        path,
        requests: times.length,
        p50:  percentile(times, 0.5),
        p95:  percentile(times, 0.95),
        p99:  percentile(times, 0.99),
        mean: mean(times),
        max:  Math.max(...times),
      }))
      .sort((a, b) => b.p95 - a.p95)
      .slice(0, n);
  }

  _errorEndpoints(n) {
    return Object.entries(this.errorsByPath)
      .map(([path, counts]) => ({
        path,
        total4xx: counts['4xx'],
        total5xx: counts['5xx'],
        totalErrors: counts['4xx'] + counts['5xx'],
        totalRequests: this.pathCounts[path] || 0,
      }))
      .map(e => ({ ...e, errorRate: e.totalRequests > 0 ? +(e.totalErrors / e.totalRequests * 100).toFixed(1) : 0 }))
      .sort((a, b) => b.total5xx - a.total5xx || b.totalErrors - a.totalErrors)
      .slice(0, n);
  }

  _timeline() {
    // Return sorted array for easy charting
    return Object.entries(this.timelineData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, data]) => ({ time: bucket, ...data }));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise path: replace numeric segments with :id
 * /api/users/123/posts/456 -> /api/users/:id/posts/:id
 */
function normalisePath(path) {
  // Strip query string
  const base = path.split('?')[0];
  return base.replace(/\/\d+(?=\/|$)/g, '/:id');
}

function sortedDesc(obj) {
  return Object.entries(obj)
    .sort(([, a], [, b]) => b - a)
    .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});
}

function topN(obj, n) {
  return Object.entries(obj)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length) - 1;
  return +sorted[Math.max(0, idx)].toFixed(2);
}

function mean(arr) {
  if (!arr.length) return null;
  return +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2);
}

function percentileSummary(arr) {
  if (!arr.length) return null;
  return {
    count: arr.length,
    min:   +Math.min(...arr).toFixed(2),
    p50:   percentile(arr, 0.5),
    p75:   percentile(arr, 0.75),
    p95:   percentile(arr, 0.95),
    p99:   percentile(arr, 0.99),
    max:   +Math.max(...arr).toFixed(2),
    mean:  mean(arr),
  };
}

module.exports = { Analyzer };
