#!/usr/bin/env node
import { runCli } from '../app/cli.js';

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
