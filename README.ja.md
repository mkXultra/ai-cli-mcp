# AI CLI MCP Server

[![npm package](https://img.shields.io/npm/v/ai-cli-mcp)](https://www.npmjs.com/package/ai-cli-mcp)
[![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](/CHANGELOG.md)

> **📦 パッケージ移行のお知らせ**: 本パッケージは旧名 `@mkxultra/claude-code-mcp` から `ai-cli-mcp` に名称変更されました。これは、複数のAI CLIツールのサポート拡大を反映したものです。

AI CLIツール（Claude, Codex, Gemini, Forge, OpenCode）をバックグラウンドプロセスとして実行し、権限処理を自動化するMCP（Model Context Protocol）サーバーです。

Cursorなどのエディタが、複雑な手順を伴う編集や操作に苦戦していることに気づいたことはありませんか？このサーバーは、強力な統合 `run` ツールを提供し、複数のAIエージェントを活用してコーディングタスクをより効果的に処理できるようにします。

## デモ

[![デモ](docs/assets/demo-jp.gif)](https://github.com/mkXultra/ai-cli-mcp/releases/download/v2.11.0/demo-jp.mp4)

## 概要

このMCPサーバーは、LLMがAI CLIツールと対話するためのツールを提供します。MCPクライアントと統合することで、LLMは以下のことが可能になります：

- すべての権限確認をスキップしてClaude CLIを実行（`--dangerously-skip-permissions` を使用）
- 承認とサンドボックスをバイパスしてCodex CLIを実行（`--dangerously-bypass-approvals-and-sandbox` を使用）
- 自動承認モードでGemini CLIを実行（`-y` を使用）
- Forge CLI を非対話モードで実行（`forge -C <workFolder> -p <prompt>` を使用）
- OpenCode を非対話 JSON モードで実行（`opencode run --format json --dir <workFolder> <prompt>` を使用）
- 複数のAIモデルのサポート：
    - Claude (sonnet, sonnet[1m], opus, opusplan, haiku)
    - Codex (gpt-5.4, gpt-5.3-codex, gpt-5.2-codex, gpt-5.1-codex-mini, gpt-5.1-codex-max, など)
    - Gemini (gemini-2.5-pro, gemini-2.5-flash, gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview)
    - Forge (`forge`)
    - OpenCode (`opencode` と `oc-<provider/model>` ラッパー。例: `oc-openai/gpt-5.4`)
- PID追跡によるバックグラウンドプロセスの管理
- ツールからの構造化された出力の解析と返却

### 使用例（高度な並行処理）

メインのエージェントに以下のように指示することで、複数のタスクを並行して実行させることができます。

> 以下の3つのタスクをacm mcp runでエージェントを起動して：
> 1. `sonnet` で `src/backend` のコードをリファクタリング
> 2. `gpt-5.2-codex` で `src/frontend` のユニットテストを作成
> 3. `gemini-2.5-pro` で `docs/` のドキュメントを更新
>
> 実行中はあなたはTODOリストを更新する作業を行ってください。それが終わったら `wait` ツールを使ってすべての完了を待機し、結果をまとめて報告してください。

### 使用例（コンテキストキャッシュの共有）

一度読み込んだ重いコンテキスト（大規模なコードベースやドキュメント）をセッションIDを使って再利用することで、コストを抑えながら複数のタスクを実行できます。

> 1. まず `acm mcp run` を使い、`opus` で `src/` 以下の全ファイルを読み込み、プロジェクトの構造を理解させてください。
> 2. `wait` ツールでこの処理の完了を待ち、結果から `session_id` を取得してください。
> 3. その `session_id` を使い、以下の2つのタスクを `acm mcp run` で並行して実行してください：
>    - `sonnet` で `src/utils` のリファクタリング案を作成
>    - `gpt-5.2-codex` で `README.md` にアーキテクチャの解説を追記
> 4. 最後に再び `wait` して、両方の結果をまとめてください。

[![セッション再開デモ](docs/assets/demo-resume-jp.gif)](https://github.com/mkXultra/ai-cli-mcp/releases/download/v2.11.0/demo-resume-jp.mp4)

## メリット

- **真の非同期マルチタスク**: エージェントの実行はバックグラウンドで行われ、即座に制御が戻ります。呼び出し元のAIは実行完了を待つことなく、並行して次のタスクの実行や別のエージェントの呼び出しを行うことができます。
- **CLI in CLI (Agent in Agent) の実現**: MCPをサポートするあらゆるIDEやCLIから、Claude CodeやCodexといった強力なCLIツールを直接呼び出せます。ホスト環境の制限を超えた、より広範で複雑なシステム操作や自動化が可能になります。
- **モデル・プロバイダの制約からの解放**: 特定のエコシステムに縛られることなく、Claude、Codex (GPT)、Gemini、Forgeの中から、タスクに最適な「最強のモデル」や「コスト効率の良いモデル」を自由に選択・組み合わせて利用できます。

## 前提条件

利用したいAI CLIツールがローカル環境にインストールされ、正しく設定されていることが唯一の前提条件です。

- **Claude Code**: `claude doctor` が通り、`--dangerously-skip-permissions` での実行が承認済み（一度手動で実行してログイン・承認済み）であること。
- **Codex CLI**（オプション）: インストール済みで、ログインなどの初期設定が完了していること。
- **Gemini CLI**（オプション）: インストール済みで、ログインなどの初期設定が完了していること。
- **Forge CLI**（オプション）: インストール済みで、初期設定が完了していること。
- **OpenCode**（オプション）: インストール済みで、設定が完了していること。この統合では `opencode run --format json` を使用し、明示的なモデル指定は `ai-cli models` が公開する `oc-<provider/model>` 構文に従います。

## インストールと使い方

現在の主な使い方は 2 つあります。

- `ai-cli-mcp`: MCP サーバーの起動
- `ai-cli`: 人間向け CLI

### MCP 利用 (`npx`)

MCP サーバーとして使う場合は、`npx` 経由が推奨です。

#### MCP設定ファイルでnpxを使用する場合:

```json
    "ai-cli-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "ai-cli-mcp@latest"
      ]
    },
```

#### Claude CLI mcp add コマンドを使用する場合:

```bash
claude mcp add ai-cli '{"name":"ai-cli","command":"npx","args":["-y","ai-cli-mcp@latest"]}'
```

### 人間向け CLI 利用 (グローバルインストール)

シェルから `ai-cli` を直接使いたい場合は、グローバルインストールしてください。

```bash
npm install -g ai-cli-mcp
```

これで以下の 2 つのコマンドが使えるようになります。

- `ai-cli`
- `ai-cli-mcp`

例:

```bash
ai-cli doctor
ai-cli models
ai-cli run --cwd "$PWD" --model sonnet --prompt "summarize this repository"
ai-cli run --cwd "$PWD" --model opencode --prompt "OpenCode のデフォルト設定でこのリポジトリを要約して"
ai-cli run --cwd "$PWD" --model oc-openai/gpt-5.4 --session-id ses_123 --prompt "明示モデル付きでこの OpenCode セッションを続けて"
ai-cli ps
ai-cli result 12345
ai-cli result 12345 --verbose
ai-cli peek 12345 --time 10
ai-cli wait 12345 --timeout 300
ai-cli wait 12345 --verbose
ai-cli kill 12345
ai-cli cleanup
ai-cli-mcp
```

### 人間向け CLI 利用 (`npx`)

公開パッケージ名はまだ `ai-cli-mcp` のままなので、`npx` で `ai-cli` を使う場合は次の形になります。

```bash
npx -y --package ai-cli-mcp@latest ai-cli run --cwd "$PWD" --model sonnet --prompt "hello"
npx -y --package ai-cli-mcp@latest ai-cli run --cwd "$PWD" --model oc-openai/gpt-5.4 --prompt "OpenCode で hello"
```

## 重要な初回セットアップ

### Claude CLIの場合:

**MCPサーバーがClaudeを使用する前に、一度手動で `--dangerously-skip-permissions` フラグを付けてClaude CLIを実行し、ログインして利用規約に同意する必要があります。**

```bash
npm install -g @anthropic-ai/claude-code
claude --dangerously-skip-permissions
```

プロンプトに従って同意してください。これが完了すると、MCPサーバーはこのフラグを使って非対話的に実行できるようになります。

### Codex CLIの場合:

**Codexの場合、ログインして必要な規約に同意していることを確認してください：**

```bash
codex login
```

### Gemini CLIの場合:

**Geminiの場合、ログインして認証情報を設定していることを確認してください：**

```bash
gemini auth login
```

macOSでは、これらのツールを初めて実行する際にフォルダへのアクセス許可を求められる場合があります。最初の実行が失敗しても、2回目以降は動作するはずです。

## CLI コマンド

`ai-cli` は現在以下をサポートしています。

- `run`
- `ps`
- `result`
- `peek`
- `wait`
- `kill`
- `cleanup`
- `doctor`
- `models`
- `mcp`

基本的な流れ:

```bash
ai-cli doctor
ai-cli models
ai-cli run --cwd "$PWD" --model codex-ultra --prompt "fix failing tests"
ai-cli run --cwd "$PWD" --model opencode --session-id ses_existing --prompt "この OpenCode セッションを継続して"
ai-cli run --cwd "$PWD" --model oc-openai/gpt-5.4 --prompt "明示的な OpenCode モデルで実行"
ai-cli ps
ai-cli peek 12345 --time 10
ai-cli peek 12345 12346 --time 10
ai-cli wait 12345
ai-cli wait 12345 --verbose
ai-cli result 12345
ai-cli result 12345 --verbose
ai-cli cleanup
```

`run` の作業ディレクトリ指定は `--cwd` が基本です。互換性のために `--workFolder` / `--work-folder` も受け付けます。

OpenCode のモデル指定は次の 2 つを受け付けます。

- `opencode`: OpenCode 側で設定されたデフォルトモデルを使用
- `oc-<provider/model>`: 明示的な OpenCode の provider/model を指定。例: `oc-openai/gpt-5.4`

`ai-cli models` は OpenCode を機械可読に `opencode: ["opencode"]` と `dynamicModelBackends.opencode` で公開します。実際に利用可能なバックエンドネイティブなモデル一覧は `opencode models` で確認してください。

`doctor` は CLI バイナリの存在確認と path 解決だけを行います。ログイン状態や利用規約同意までは確認しません。

## CLI の状態保存先

バックグラウンド実行した `ai-cli` の状態は、次のディレクトリに保存されます。

```text
~/.local/state/ai-cli/cwds/<normalized-cwd>/<pid>/
```

各 PID ディレクトリには以下が入ります。

- `meta.json`
- `stdout.log`
- `stderr.log`
- `exit-status.json`（detached な OpenCode 実行用）

完了済み・失敗済みの実行は `ai-cli cleanup` で削除できます。`running` のものは保持されます。

## 既知の制約

detached 実行された `ai-cli` では、OpenCode バックエンドに限り自然終了時の exit status を永続化します。そのため OpenCode の失敗終了は非ゼロ exit code を含めて `failed` として扱われ、結果では生の `stdout` / `stderr` を保持します。一方、他の detached バックエンドでは従来どおり、より広い exit-status 追跡が追加されるまでは自然終了した実行が信頼できる exit code なしで `completed` と見なされる制約が残ります。

## MCPクライアントへの接続

サーバーのセットアップ後、MCPクライアント（CursorやWindsurfなど）の設定ファイル（`mcp.json` や `mcp_config.json`）に設定を追加してください。

ファイルが存在しない場合は作成し、`ai-cli-mcp` の設定を追加してください。

## 提供されるツール

このサーバーは以下のツールを公開しています：

### `run`

Claude CLI、Codex CLI、Gemini CLI、Forge CLI、または OpenCode を使用してプロンプトを実行します。モデル名に基づいて適切なCLIが自動的に選択されます。

**引数:**
- `prompt` (string, 任意): AIエージェントに送信するプロンプト。`prompt` または `prompt_file` のいずれかが必須です。
- `prompt_file` (string, 任意): プロンプトを含むファイルへのパス。`prompt` または `prompt_file` のいずれかが必須です。絶対パス、または `workFolder` からの相対パスが指定可能です。
- `workFolder` (string, 必須): CLIを実行する作業ディレクトリ。絶対パスである必要があります。
- **モデル (Models):**
    - **Ultra エイリアス:** `claude-ultra` (自動的に high effort に設定), `codex-ultra` (自動的に xhigh reasoning に設定), `gemini-ultra`
    - Claude: `sonnet`, `sonnet[1m]`, `opus`, `opusplan`, `haiku`
    - Codex: `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1`, `gpt-5`
    - Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-pro-preview`, `gemini-3-pro-preview`, `gemini-3-flash-preview`
    - Forge: `forge`
    - OpenCode: `opencode`（設定済みのデフォルトモデル）および `oc-openai/gpt-5.4` のような明示ラッパー
- `reasoning_effort` (string, 任意): Claude と Codex の推論制御。Claude では `--effort` を使います（許容値: "low", "medium", "high"）。Codex では `model_reasoning_effort` を使います（許容値: "low", "medium", "high", "xhigh"）。Gemini、Forge、OpenCode では `reasoning_effort` はサポートしません。
- `session_id` (string, 任意): 以前のセッションを再開するためのセッションID。Claude、Codex、Gemini、Forge、OpenCode でサポートされます。OpenCode は `--session` による in-place resume で再開し、`oc-<provider/model>` の明示指定と併用できます。

### `wait`

複数のAIエージェントプロセスの完了を待機し、結果をまとめて返します。指定されたすべてのPIDが終了するか、タイムアウトになるまでブロックします。

デフォルトでは、返される各結果項目は `get_result(verbose: false)` と同じ compact 形を使います。`pid`、`agent`、`status`、`exitCode`、`model` などの運用上必要な項目に加え、利用可能であれば `agentOutput` やトップレベルの `session_id` を含みます。`verbose: true` を指定すると、`startTime`、`workFolder`、`prompt` などの完全なメタデータや、`agentOutput.tools` のような詳細な解析結果を含む full 形を返します。

**引数:**
- `pids` (array of numbers, 必須): 待機するプロセスIDのリスト（`run` ツールから返されたもの）。
- `timeout` (number, 任意): 最大待機時間（秒）。デフォルトは180秒（3分）です。
- `verbose` (boolean, 任意): `true` の場合、各結果項目を full 形で返します。デフォルトは `false` です。

### `peek`

実行中の子エージェントを短時間だけ観測し、その `peek` 呼び出しの観測ウィンドウ内で ai-cli-mcp が受理した構造化イベントを返します。デフォルトでは自然言語メッセージイベントだけを返し、`include_tool_calls` または `--include-tool-calls` を指定すると正規化された tool-call イベントも含めます。履歴APIではなく、欠落のないストリーミングでもなく、シェルの `stdout` / `stderr` tail でもありません。別々の `peek` 呼び出しの間に出たイベントは取得できない場合があります。v1 では `--follow` はありません。

CLI v1:

```bash
ai-cli peek 123 --time 10
ai-cli peek 123 456 --time 10
ai-cli peek 123 --time 10 --include-tool-calls
```

**引数:**
- `pids` (array of numbers, 必須): `run` が返したプロセスIDを 1..32 件指定します。重複したPIDはサーバー側で重複排除され、最初に出た順序が維持されます。未知または管理外のPIDは、呼び出し全体の失敗ではなく、プロセスごとに `not_found` として返されます。
- `peek_time_sec` (number, 任意): 観測時間（秒）の正の整数です。デフォルトは10秒、最大60秒です。`0`、負数、小数は無効です。
- `include_tool_calls` (boolean, 任意): `true` の場合、各プロセスの `events` 配列にメッセージイベントに加えて正規化された `tool_call` イベントを含めます。デフォルトは `false` です。

**観測とフィルタリング:**
- `peek_started_at` と `events[].ts` は、ai-cli-mcp サーバー側の UTC RFC3339 タイムスタンプです。`peek_started_at` は検証とリスナー登録後に観測ウィンドウが始まった時刻、`events[].ts` は ai-cli-mcp がイベントを観測して受理した時刻です。
- 観測ウィンドウは `peek_time_sec` が経過するか、対象プロセスがすべて終端状態になった時点で終了します。
- 観測開始前のイベントは返しません。同じPIDへの同時 `peek` は可能で、それぞれ独立した観測ウィンドウを持つため、イベントが重複して返ることがあります。
- メッセージイベントは、Codex の `agent_message` text、Claude assistant の text content、OpenCode の `type: "text"` かつ `part.type` が `"text"` のイベント、Gemini stream-json の `role` が `"assistant"` の `message` イベント、Forge の `Summary:` または `Completed successfully:` で始まる plain-text 行から best-effort に認識します。
- tool call を含める場合、Codex の command/MCP call、Claude の tool use/result、Gemini の tool use/result、OpenCode の完了済み tool use event、Forge の低精度な `Execute` / `Finished` marker を正規化した `tool_call` イベントとして返します。tool summary は tool 名と入力メタデータだけから作る短い1行文字列です。Forge のコマンド出力自体は tail せず、公開しません。raw `stdout` / `stderr`、raw JSONL、tool result output、コマンド出力、`result.response`、stats、token usage、verbose メタデータは除外します。
- 未知のイベント形状はデフォルトで拒否します。まだ明示対応されていない管理対象エージェントは、実際のプロセス状態を返しつつ、`events: []`、`truncated: false`、`error: null` にします。
- 各PIDごとに、観測ウィンドウ内で最初に観測された50件までを保持します。それ以降のイベントを捨てた場合は `truncated` が `true` になります。
- `status` は `running`、`completed`、`failed`、`not_found` のいずれかで、観測ウィンドウ終了時点の状態を表します。
- `agent` は `claude`、`codex`、`gemini`、`forge`、`opencode`、将来追加される追跡済みエージェント文字列、または `null` です。`null` はプロセスが見つからない、またはエージェント種別を判断できない場合を表します。

レスポンス例:

```json
{
  "peek_started_at": "2026-04-11T12:34:56.789Z",
  "observed_duration_sec": 10.01,
  "processes": [
    {
      "pid": 123,
      "agent": "codex",
      "status": "running",
      "events": [
        { "kind": "message", "ts": "2026-04-11T12:34:59.120Z", "text": "I'm checking the implementation." },
        { "kind": "tool_call", "ts": "2026-04-11T12:35:00.000Z", "phase": "started", "id": "item_0", "tool": "command_execution", "summary": "/bin/sh -c 'echo hi'" }
      ],
      "truncated": false,
      "error": null
    },
    {
      "pid": 999,
      "agent": null,
      "status": "not_found",
      "events": [],
      "truncated": false,
      "error": "process not found"
    }
  ]
}
```

### `list_processes`

実行中および完了したすべてのAIエージェントプロセスを、ステータス、PID、基本情報とともにリストアップします。

### `get_result`

PIDを指定して、AIエージェントプロセスの現在の出力とステータスを取得します。

デフォルトでは compact 形を返します。これには `pid`、`agent`、`status`、`exitCode`、`model` などの運用上必要な項目に加え、利用可能であれば `agentOutput` やトップレベルの `session_id` を含みます。`startTime`、`workFolder`、`prompt` は含みません。`verbose: true` を指定すると、これらのメタデータや `agentOutput.tools` のような詳細な解析結果を含む full 形を返します。解析結果が得られない場合や不完全な場合は、従来どおり `stdout` / `stderr` のフォールバックを維持します。

**引数:**
- `pid` (number, 必須): `run` ツールによって返されたプロセスID。
- `verbose` (boolean, 任意): `true` の場合、full 形で返します。デフォルトは `false` です。

### `kill_process`

PIDを指定して、実行中のAIエージェントプロセスを終了します。

**引数:**
- `pid` (number, 必須): 終了させるプロセスID。

## トラブルシューティング

- **"Command not found" (claude-code-mcp):** グローバルにインストールした場合、npmのグローバルbinディレクトリがシステムのPATHに含まれているか確認してください。`npx` を使用している場合、`npx` 自体が機能しているか確認してください。
- **"Command not found" (`ai-cli`):** グローバルインストール時は npm のグローバル bin ディレクトリが `PATH` に入っているか確認してください。`npx` の場合は `npx -y --package ai-cli-mcp@latest ai-cli ...` を使ってください。
- **"Command not found" (claude または ~/.claude/local/claude):** Claude CLIが正しくインストールされていることを確認してください。`claude/doctor` を実行するか、公式ドキュメントを確認してください。
- **権限の問題:** 「重要な初回セットアップ」の手順を実行したか確認してください。
- **サーバーからのJSONエラー:** `MCP_CLAUDE_DEBUG` が `true` の場合、エラーメッセージやログがMCPのJSON解析を妨げる可能性があります。通常動作時は `false` に設定してください。

## 開発者向け: ローカルセットアップと貢献

このサーバーを開発・貢献したい場合、またはクローンしたリポジトリから実行してテストしたい場合は、[Local Installation & Development Setup Guide](./docs/local_install.md) を参照してください。

## テスト

プロジェクトには包括的なテストスイートが含まれています：

```bash
# 全テストの実行
npm test

# ユニットテストのみ実行
npm run test:unit

# E2Eテストの実行（モック使用）
npm run test:e2e
```

## 高度な設定（オプション）

通常の利用では設定不要ですが、CLIツールのパスをカスタマイズしたい場合やデバッグが必要な場合に使用できる環境変数です。

- `CLAUDE_CLI_NAME`: Claude CLIのバイナリ名または絶対パスを上書き（デフォルト: `claude`）
- `CODEX_CLI_NAME`: Codex CLIのバイナリ名または絶対パスを上書き（デフォルト: `codex`）
- `GEMINI_CLI_NAME`: Gemini CLIのバイナリ名または絶対パスを上書き（デフォルト: `gemini`）
- `FORGE_CLI_NAME`: Forge CLIのバイナリ名または絶対パスを上書き（デフォルト: `forge`）
- `OPENCODE_CLI_NAME`: OpenCode CLIのバイナリ名または絶対パスを上書き（デフォルト: `opencode`）
- `MCP_CLAUDE_DEBUG`: デバッグログを有効化（`true` に設定すると詳細な出力が表示されます）

**CLI名の指定方法:**
- コマンド名のみ: `CLAUDE_CLI_NAME=claude-custom`
- 絶対パス: `CLAUDE_CLI_NAME=/path/to/custom/claude`
※ 相対パスは使用できません。

### カスタムCLIバイナリを使用する場合の設定例:

```json
    "ai-cli-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "ai-cli-mcp@latest"
      ],
      "env": {
        "CLAUDE_CLI_NAME": "claude-custom",
        "CODEX_CLI_NAME": "codex-custom",
        "OPENCODE_CLI_NAME": "opencode-custom"
      }
    },
```

## ライセンス

MIT
