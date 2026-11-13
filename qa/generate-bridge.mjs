import fs from 'node:fs';import {bridgeWorker} from './worker-release.mjs';
fs.mkdirSync(new URL('../release/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../release/v111-bridge-sw.js',import.meta.url),bridgeWorker());console.log('Prepared V1.11 compatibility worker artifact only; nothing published.');
