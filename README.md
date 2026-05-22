# Log Analyzer

A command-line + web dashboard tool for analyzing web server log files.
Surfaces error patterns, slowest endpoints, traffic breakdowns, and response-time percentiles — designed to degrade gracefully on malformed input.

---

## Quick Start (fresh machine)

**Requirements:** Node.js ≥ 16

```bash
git clone https://github.com/umaimaa-shahid/LogAnalyzer.git
cd log-analyzer
npm install
```

### Generate a sample log file

```bash
node scripts/generate-logs.js 20000 sample.log
```

This produces `sample.log` with ~20,000 lines including all format variants and intentional malformed lines.

### Run — CLI mode (default)

```bash
node index.js sample.log
```

Or pipe from stdin:

```bash
cat sample.log | node index.js
```

### Run — JSON output

```bash
node index.js sample.log --json
node index.js sample.log --json > report.json
```

### Run — Web dashboard

```bash
node index.js sample.log --web
# Opens dashboard at http://localhost:3000
```

Custom port:

```bash
node index.js sample.log --web --port 8080
```

### All CLI flags

```
Usage: log-analyzer [options] [file]

Arguments:
  file                Path to log file (omit to read from stdin)

Options:
  -j, --json          Output raw JSON report instead of formatted text
  -v, --verbose       Print each skipped line and reason to stderr
  -w, --web           Launch web dashboard
  -p, --port <n>      Port for web dashboard (default: 3000)
  --top <n>           How many top items to show (default: 10)
  -V, --version       Show version
  -h, --help          Show help
```

---

## Project Structure

```
log-analyzer/
├── index.js              # CLI entry point (commander)
├── src/
│   ├── parser.js         # Single-line parser — all format variants
│   ├── analyzer.js       # Aggregator — builds the report object
│   ├── reader.js         # Streams the file line-by-line
│   ├── cli-renderer.js   # Terminal output (chalk)
│   └── server.js         # Express server for web dashboard
├── public/
│   └── index.html        # Web dashboard (Chart.js, single-file)
├── scripts/
│   └── generate-logs.js  # Test data generator
└── sample.log            # Generated after running the generator
```

---

## Log Format Support

The parser handles:

| Format                    | Example                             |
| ------------------------- | ----------------------------------- |
| ISO 8601                  | `2024-03-15T14:23:01Z`            |
| Slash date                | `2024/03/15 14:23:01`             |
| Named month               | `15-Mar-2024 14:23:01`            |
| Unix epoch                | `1710512581`                      |
| Response time ms          | `142ms`                           |
| Response time seconds     | `0.142s`                          |
| Response time bare int    | `142`                             |
| Missing/dash status       | `-`                               |
| JSON log lines            | `{"timestamp":...,"method":...}`  |
| Extra trailing fields     | user-agent strings, referrers       |
| Malformed lines           | skipped with a reason code, counted |
| Stack trace continuations | skipped silently                    |
| Blank lines               | skipped silently                    |
