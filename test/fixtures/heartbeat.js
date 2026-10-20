#!/usr/bin/env node
// Touches a file every 100 ms until it is killed; proves whether a process is still alive.
const fs = require('node:fs');
const file = process.argv[2];
const beat = () => fs.writeFileSync(file, String(Date.now()));
beat();
setInterval(beat, 100);
