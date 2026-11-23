#!/usr/bin/env node
import { runEvalCli } from '../eval-engine/cli.js';

runEvalCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write('eval-engine: unexpected failure\n');
  process.exitCode = 2;
});
