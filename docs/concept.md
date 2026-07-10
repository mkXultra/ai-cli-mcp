# AI CLI MCP Server - Concept

## What is this?

AI CLI MCP Server (`ai-cli-mcp`) は、複数のAI CLIツール（Claude Code, Codex, Gemini）をMCPプロトコル経由でバックグラウンド実行するサーバーである。

## 解決する課題

### 1. 単一エージェントのボトルネック

CursorなどのAI IDE は内部で1つのAIエージェントを逐次実行する。複雑なマルチステップ作業（リファクタリング + テスト作成 + ドキュメント更新など）では、1つずつ順番に処理するしかなく時間がかかる。

### 2. モデル/プロバイダーのロックイン

IDE が採用するAIモデルに依存し、タスクごとに最適なモデルを選択できない。コード生成には Claude Opus、高速な軽作業には Haiku、といった使い分けができない。

### 3. AI CLI の非同期実行の欠如

Claude Code や Codex CLI は対話的に使うことを前提としており、バックグラウンドでの非同期プロセス管理をネイティブにはサポートしていない。

## Core Idea

**MCP を「AIエージェントのプロセスマネージャー」として使う。**

```
MCP Client (Cursor, Claude Code, etc.)
  │
  ├─ run(prompt, model="opus")     → PID 1234 (即座に返却)
  ├─ run(prompt, model="gpt-5.3-codex")  → PID 1235
  ├─ run(prompt, model="gemini-3.5-flash-high") → PID 1236
  │
  ├─ list_processes()  → 実行状況一覧
  ├─ peek(pids)        → 実行中出力の短時間観測
  ├─ get_result(pid)   → 個別結果取得
  ├─ wait(pids)        → 全完了待ち
  ├─ kill_process(pid) → 実行中プロセスの終了
  ├─ cleanup_processes() → 完了済み状態の掃除
  ├─ doctor()          → CLI バイナリ解決状況
  └─ models()          → 対応モデル一覧
```

- **Fire-and-forget**: `run` は即座にPIDを返し、呼び出し側はブロックされない
- **Blocking wait**: `wait(pids)` は指定プロセスが全完了するまでブロックする。利用者がポーリングループを組む必要はない。`run` で複数タスクを投げ、自分の作業を進めた後、`wait` 一発で全結果を回収するのが基本フロー
- **マルチモデル**: プロンプトごとに異なるAIモデルを選択可能
- **プロセスライフサイクル管理**: 起動・監視・結果取得・強制終了を統一APIで提供

### 基本フロー

```
run(task1) → PID 1
run(task2) → PID 2
run(task3) → PID 3
  ↓
(呼び出し側は自分の作業を続行)
  ↓
wait([PID 1, 2, 3]) → ブロック → 全完了後に結果をまとめて返却
```

## Core Responsibility

このツールの責務は3つに集約される:

### 1. どのAI CLIからでも同じプロンプトで使える

このMCPサーバーは Claude Code / Gemini エージェント経路の Antigravity CLI / Codex CLI のいずれをホスト（呼び出し元）としても、同じツール名・同じ引数・同じプロンプトで動作する。ホスト側のAIがどのプロバイダーであっても、統一されたMCPインターフェースを通じて同一の体験を提供する。

### 2. CLI差異の完全な隠蔽

利用者（主にAIエージェント）は Claude Code / Codex / Gemini の個別仕様を一切知る必要がない。

- パーミッションフラグの違い（`--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox`）
- 出力形式の違い（Claude の JSON / Codex のログ / Gemini の出力）
- セッション管理の違い（`--session-id` / `--session` / `-s`）
- モデル名の指定方法の違い

これらはすべて内部で吸収される。利用者は「モデル名とプロンプトを渡すだけ」でよい。

### 3. AI-Friendly な返り値

返り値は人間ではなく **AIエージェントが消費する** ことを前提に設計する。

- 各CLIの生出力（JSON、ログ、テキスト）をパースし、構造化されたオブジェクトとして返す
- `session_id` や `exitCode` などのメタデータを統一フォーマットで付与する
- `verbose` フラグで必要に応じてツール使用履歴も提供する
- AIが次のアクションを判断しやすい、一貫した構造を維持する

## Design Principles

### Thin Wrapper, Not a Framework

各AI CLIの既存機能をそのまま活かし、MCPのインターフェースでラップするだけに留める。独自のプロンプト処理やフィルタリングは行わない。

### Immediate Return

`run` は常に即座にPIDを返す。重い処理のブロッキングを避け、呼び出し元が他の作業を並行して進められるようにする。

### CLI Agnostic

Claude / Codex / Gemini のCLI差異（フラグ、出力形式）を内部で吸収し、統一されたインターフェースを提供する。新しいCLIの追加も最小限の変更で可能な構造にする。

## Architecture Overview

```
src/
├── server.ts       # MCP Server 本体 (ツールハンドラ + プロセス管理)
├── cli-builder.ts  # モデル名 → CLI コマンド構築 (パス解決・引数組み立て)
├── cli-utils.ts    # CLI バイナリ検出・デバッグログ
├── parsers.ts      # 各CLI出力のパース (Claude JSON / Codex logs / Gemini)
├── cli.ts          # スタンドアロン CLI エントリポイント
└── cli-parse.ts    # パース単体テスト用エントリポイント
```

## Session Stacking

`session_id` を使ってコンテキストを積み重ね、効率的にタスクを実行する推奨パターン。初回の `run` で構築したコンテキストを後続タスクに引き継ぎ、再読み込みコストを削減する。

詳細は [Session Stacking](./session-stacking.md) を参照。

## Model Aliases (Ultra)

`claude-ultra` / `codex-ultra` / `gemini-ultra` というエイリアスを提供している。

```
claude-ultra  → opus (+ reasoning_effort: max)
codex-ultra   → gpt-5.6-sol (+ reasoning_effort: ultra)
gemini-ultra  → Gemini 3.1 Pro (High)
```

**設計意図**: AI プロバイダーのモデル名は頻繁に変わる。利用者（特にAIエージェント）が個々のモデル名の変遷を追う必要がないよう、「そのプロバイダーの最強モデル」を指す安定したエイリアスを提供する。マッピング先はサーバー側で更新するだけで、利用者のプロンプトを変更する必要がない。

`codex-ultra` はこの設計に従って `gpt-5.5` + `xhigh` から `gpt-5.6-sol` + `ultra` へ移行した。再現性のため旧モデルを固定したい呼び出しは、エイリアスではなくモデルと effort を明示する。

## Security Model

このツールは **信頼された環境でのみ使用する** ことを前提としている。

- Claude Code は `--dangerously-skip-permissions` で実行される（すべてのファイル操作・コマンド実行が無許可で行われる）
- Codex は `--dangerously-bypass-approvals-and-sandbox` で実行される
- Gemini エージェント経路の Antigravity は `--dangerously-skip-permissions -p` で実行される

つまり、このMCPサーバーに接続できるクライアントは、ローカルマシン上で **任意のコード実行が可能** である。ネットワーク越しの不特定多数への公開や、信頼できないクライアントからのアクセスは想定していない。

## Constraints

| 制約 | 詳細 |
|---|---|
| インメモリプロセス管理 | プロセス情報はサーバーのメモリ上にのみ保持される。サーバー再起動で全プロセス情報が消失する |
| stdio トランスポートのみ | HTTP/WebSocket 等のリモートトランスポートは未サポート。ローカル実行が前提 |
| 単一マシン | 分散実行やリモートマシンへのプロセス委譲はサポートしない |
| CLI の事前セットアップ必須 | 各AI CLIのインストール・認証はユーザーが事前に完了させる必要がある |

## Key Technical Decisions

| 決定 | 理由 |
|---|---|
| `node:child_process.spawn` でプロセス管理 | 軽量で直接的。外部依存なしにPIDベースの管理が可能 |
| `--dangerously-skip-permissions` (Claude) | MCP経由の自動実行には非対話モードが必須 |
| `--dangerously-bypass-approvals-and-sandbox` (Codex) / `--dangerously-skip-permissions -p` (Antigravity) | 同上。各CLIの自動承認・非対話モード |
| `session_id` サポート | コンテキストキャッシュにより、大規模コードベースの読み込みコストを複数タスクで共有 |
| 出力パーサーの分離 | CLI出力形式の変更に対して個別に対応可能 |
| npx 配布 | インストール不要でMCP設定に直接記述可能 |
