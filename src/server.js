'use strict';

const express = require('express');
const path    = require('path');

function startServer(report, port = 3000) {
  const app = express();

  app.get('/api/report', (req, res) => {
    res.json(report);
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  app.listen(port, () => {
    console.log(`\n✅  Dashboard ready at http://localhost:${port}\n`);
    console.log('   Press Ctrl+C to exit.\n');
  });
}

module.exports = { startServer };
