# ANSWERS.md

## 1. How to Run

**Requirements:** Node.js ≥ 16 (no other system dependencies)

```bash
git clone https://github.com/umaimaa-shahid/LogAnalyzer.git
cd log-analyzer
npm install
```

Generate a test log file:

```bash
node scripts/generate-logs.js 20000 sample.log
```

Run the analyzer:

```bash
# CLI report (terminal)
node index.js sample.log

# JSON output
node index.js sample.log --json

# Web dashboard at http://localhost:3000
node index.js sample.log --web

# Read from stdin
cat some.log | node index.js

# Show skipped lines with reasons
node index.js sample.log --verbose
```

---

## 2. Stack Choice

**Chosen stack:** Node.js, vanilla (readline, fs, http) + Express for the web mode, Commander for the CLI, Chalk for terminal colour.

**Why Node.js:**

- `readline` gives a streaming line-by-line reader with backpressure out of the box — no memory spike on 500k-line files.
- The whole solution ships as one `npm install` with no compiled native modules, so it runs identically everywhere Node does (Linux, macOS, Windows, CI containers).
- Regex and string manipulation — the bulk of the parsing work — are fast and natural in JavaScript.
- JSON log lines parse with `JSON.parse()`, zero overhead.

**What would have been worse:**

- **Python (naive approach):** `open(f).readlines()` loads the whole file into memory before iteration starts. It's fixable with generators, but it's the easy trap to fall into and would OOM on large files.
- **Shell (awk/sed pipeline):** Fast, but handling mixed formats (epoch timestamps, JSON lines, bare response times vs status codes) in a portable shell pipeline gets brittle fast. Error messages are cryptic. The web dashboard would be impossible.
- **Go or Rust:** Would produce a faster binary, but the build step adds friction on a fresh machine and the iteration speed during development is lower. For a log-analysis tool where the bottleneck is I/O, not CPU, the speed gain isn't worth the setup cost.

---

## 3. One Real Edge Case

**The case:** A log line with a missing/dashed status code followed by a bare-integer response time, e.g.:

```
2024-03-15T14:18:00Z 198.51.100.3 GET /api/products - 102 "Mozilla/5.0 ..."
```

Here `-` means the status was not recorded, and `102` is the response time in milliseconds (no unit suffix). Without careful handling, `102` gets parsed as HTTP status code `102 (Processing)` — a valid 3-digit code — and the response time is lost.

**Where it's handled:** `src/parser.js`, line ~153–163 (the `statusConsumed` flag):

```js
let statusConsumed = false;  // tracks whether we've seen the status field (even if '-')

// Status code field: consume '-' or a 3-digit code, then mark consumed
if (path && !statusConsumed) {
  if (t === '-') { statusConsumed = true; status = null; continue; }
  const n = parseInt(t, 10);
  if (!isNaN(n) && String(n) === t && n >= 100 && n <= 599) {
    status = n; statusConsumed = true; continue;
  }
}

// Bare integer response time: only accepted AFTER status has been consumed
if (path && statusConsumed && responseTimeMs === null) {
  // ...
  else if (/^\d{1,6}$/.test(t)) {
    const n = parseInt(t, 10);
    if (n >= 0 && n < 100000) rt = n;   // accepted as ms
  }
}
```

**Without this handling:** The tool would accumulate hundreds of phantom 1xx status codes from lines with missing statuses, polluting the status-code breakdown with nonsense entries like `102: 47`, `186: 12`, `244: 8`. The response times for those requests would be silently dropped, skewing the percentile calculations.

---

## 4. AI Usage

### Tool used: Claude (Sonnet 4)

**What I asked / what it gave:**

1. **Initial scaffolding:** Asked for a Node.js log parser that handles the listed format variants. It gave a single-function regex approach. Useful as a starting point but it used a single chained regex that couldn't handle fields in different positions.

   **What I changed:** Rewrote the core `parseTextLine` function to use a tokeniser + per-field state machine (`statusConsumed`, separate response-time check) instead of a positional regex. The regex approach silently misassigned bare integers in edge cases like `- 102`; the state machine makes the field-consumption order explicit and debuggable.
2. **Analyzer aggregation:** Asked for percentile computation and path normalisation. It suggested `.sort()` on every ingestion call. I changed it to store raw arrays and defer sorting until the final `report()` call, capping array size at 10k per path to bound memory on large files.
3. **Web dashboard HTML/CSS:** Asked for a dark terminal-aesthetic dashboard using Chart.js. Useful starting point for the layout. I changed the colour palette (moved away from purple gradients to a cyan-on-near-black scheme), replaced the suggested `localStorage` calls (not appropriate here since the report is ephemeral), and rewrote the response-time chart to use conditional colouring per bar.
4. **Log generator:** Asked for a generator that produces realistic malformed lines. It gave a flat array of line-type generators. I restructured it to use a weighted PATHS table so the endpoint distribution matches a realistic service (login/user endpoints get more traffic than admin endpoints).

---

## 5. Honest Gap

**The gap:** The web dashboard's timeline chart is limited to the last 500 minute-buckets to avoid rendering lag. For a log file spanning days or weeks, this means the early portion of the timeline is silently truncated — the user sees only the most recent ~8 hours.

**What I'd do with another day:**

- Add adaptive bucketing: if the log spans > 12 hours, aggregate into hourly buckets; if > 7 days, aggregate into daily buckets. This is a one-pass change in `analyzer.js` (`_timeline()`) — compute the span first, then choose the bucket granularity.
- Add a brush/zoom control on the timeline chart so users can drag to inspect a sub-range, then the underlying data re-aggregates at a finer grain for that window.
- Currently the 500-bucket cap is a hardcoded magic number with no warning. At minimum it should log a notice: `"Timeline truncated to last 500 buckets; use --json for full data."`
