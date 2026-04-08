import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface OpenCodeMockOptions {
  argsLogPath?: string;
  defaultSessionId?: string;
}

export interface OpenCodeMockResult {
  scriptPath: string;
  argsLogPath?: string;
}

export function createOpenCodeMock(dir: string, options: OpenCodeMockOptions = {}): OpenCodeMockResult {
  const scriptPath = join(dir, 'mock-opencode');
  const defaultSessionId = options.defaultSessionId || 'ses-opencode-default';
  const argsLogPath = options.argsLogPath;
  const argsLogSection = argsLogPath
    ? `printf '%s\n' "$*" >> "${argsLogPath}"\n`
    : '';

  writeFileSync(
    scriptPath,
    `#!/bin/bash
set -euo pipefail

prompt=""
session_id=""
session_provided=0
model=""
work_dir=""

${argsLogSection}if [[ "\${1:-}" == "run" ]]; then
  shift
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --format)
      shift 2
      ;;
    --dir)
      work_dir="$2"
      shift 2
      ;;
    --session)
      session_id="$2"
      session_provided=1
      shift 2
      ;;
    --model)
      model="$2"
      shift 2
      ;;
    *)
      prompt="$1"
      shift
      ;;
  esac
done

if [[ -z "$session_id" ]]; then
  session_id="${defaultSessionId}"
fi

if [[ "$prompt" == *"sleep"* ]]; then
  sleep 5
fi

if [[ "$prompt" == *"fail"* ]]; then
  printf '{"type":"step_start","sessionID":"%s"}\n' "$session_id"
  printf '{"type":"text","sessionID":"%s","part":{"type":"text","text":"Partial failure output"}}\n' "$session_id"
  printf '{"type":"step_finish","sessionID":"%s","part":{"type":"step-finish","tokens":{"total":42},"cost":0}}\n' "$session_id"
  printf 'OpenCode failed for %s in %s\n' "$model" "$work_dir" >&2
  exit 7
fi

if [[ "$prompt" == *"multi-step"* ]]; then
  printf '{"type":"step_start","sessionID":"%s"}\n' "$session_id"
  printf '{"type":"text","sessionID":"%s","part":{"type":"text","text":"First step"}}\n' "$session_id"
  printf '{"type":"step_finish","sessionID":"%s","part":{"type":"step-finish","tokens":{"total":11},"cost":0}}\n' "$session_id"
  printf '{"type":"step_start","sessionID":"%s"}\n' "$session_id"
  printf '{"type":"text","sessionID":"%s","part":{"type":"text","text":"Second step"}}\n' "$session_id"
  printf '{"type":"step_finish","sessionID":"%s","part":{"type":"step-finish","tokens":{"total":22},"cost":1}}\n' "$session_id"
  exit 0
fi

message_prefix="Initial"
if [[ $session_provided -eq 1 ]]; then
  message_prefix="Resumed"
fi
if [[ -n "$model" ]]; then
  message_prefix="Model $model"
  if [[ $session_provided -eq 1 ]]; then
    message_prefix="Resumed model $model"
  fi
fi

printf '{"type":"step_start","sessionID":"%s"}\n' "$session_id"
printf '{"type":"text","sessionID":"%s","part":{"type":"text","text":"%s: %s"}}\n' "$session_id" "$message_prefix" "$prompt"
printf '{"type":"step_finish","sessionID":"%s","part":{"type":"step-finish","tokens":{"total":11833},"cost":0}}\n' "$session_id"
`,
    'utf8',
  );
  chmodSync(scriptPath, 0o755);

  return { scriptPath, argsLogPath };
}
