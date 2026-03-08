# AI CLI MCP Server

[![npm package](https://img.shields.io/npm/v/ai-cli-mcp)](https://www.npmjs.com/package/ai-cli-mcp)
[![View changelog](https://img.shields.io/badge/Explore%20Changelog-brightgreen)](/CHANGELOG.md)

> **📦 パッケージ移行のお知らせ**: 本パッケージは旧名 `@mkxultra/claude-code-mcp` から `ai-cli-mcp` に名称変更されました。これは、複数のAI CLIツールのサポート拡大を反映したものです。

AI CLIツール（Claude, Codex, Gemini）をバックグラウンドプロセスとして実行し、権限処理を自動化するMCP（Model Context Protocol）サーバーです。

Cursorなどのエディタが、複雑な手順を伴う編集や操作に苦戦していることに気づいたことはありませんか？このサーバーは、強力な統合 `run` ツールを提供し、複数のAIエージェントを活用してコーディングタスクをより効果的に処理できるようにします。

## 概要

このMCPサーバーは、LLMがAI CLIツールと対話するためのツールを提供します。MCPクライアントと統合することで、LLMは以下のことが可能になります：

- すべての権限確認をスキップしてClaude CLIを実行（`--dangerously-skip-permissions` を使用）
- 自動承認モードでCodex CLIを実行（`--full-auto` を使用）
- 自動承認モードでGemini CLIを実行（`-y` を使用）
- 複数のAIモデルのサポート：
    - Claude (sonnet, sonnet[1m], opus, opusplan, haiku)
    - Codex (gpt-5.4, gpt-5.3-codex, gpt-5.2-codex, gpt-5.1-codex-mini, gpt-5.1-codex-max, など)
    - Gemini (gemini-2.5-pro, gemini-2.5-flash, gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview)
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

## メリット

- **真の非同期マルチタスク**: エージェントの実行はバックグラウンドで行われ、即座に制御が戻ります。呼び出し元のAIは実行完了を待つことなく、並行して次のタスクの実行や別のエージェントの呼び出しを行うことができます。
- **CLI in CLI (Agent in Agent) の実現**: MCPをサポートするあらゆるIDEやCLIから、Claude CodeやCodexといった強力なCLIツールを直接呼び出せます。ホスト環境の制限を超えた、より広範で複雑なシステム操作や自動化が可能になります。
- **モデル・プロバイダの制約からの解放**: 特定のエコシステムに縛られることなく、Claude、Codex (GPT)、Geminiの中から、タスクに最適な「最強のモデル」や「コスト効率の良いモデル」を自由に選択・組み合わせて利用できます。

## 前提条件

利用したいAI CLIツールがローカル環境にインストールされ、正しく設定されていることが唯一の前提条件です。

- **Claude Code**: `claude doctor` が通り、`--dangerously-skip-permissions` での実行が承認済み（一度手動で実行してログイン・承認済み）であること。
- **Codex CLI**（オプション）: インストール済みで、ログインなどの初期設定が完了していること。
- **Gemini CLI**（オプション）: インストール済みで、ログインなどの初期設定が完了していること。

## インストールと使い方

推奨される使用方法は、`npx` を使用してインストールすることです。

### MCP設定ファイルでnpxを使用する場合:

```json
    "ai-cli-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "ai-cli-mcp@latest"
      ]
    },
```

### Claude CLI mcp add コマンドを使用する場合:

```bash
claude mcp add ai-cli '{"name":"ai-cli","command":"npx","args":["-y","ai-cli-mcp@latest"]}'
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

## MCPクライアントへの接続

サーバーのセットアップ後、MCPクライアント（CursorやWindsurfなど）の設定ファイル（`mcp.json` や `mcp_config.json`）に設定を追加してください。

ファイルが存在しない場合は作成し、`ai-cli-mcp` の設定を追加してください。

## 提供されるツール

このサーバーは以下のツールを公開しています：

### `run`

Claude CLI、Codex CLI、またはGemini CLIを使用してプロンプトを実行します。モデル名に基づいて適切なCLIが自動的に選択されます。

**引数:**
- `prompt` (string, 任意): AIエージェントに送信するプロンプト。`prompt` または `prompt_file` のいずれかが必須です。
- `prompt_file` (string, 任意): プロンプトを含むファイルへのパス。`prompt` または `prompt_file` のいずれかが必須です。絶対パス、または `workFolder` からの相対パスが指定可能です。
- `workFolder` (string, 必須): CLIを実行する作業ディレクトリ。絶対パスである必要があります。
- **モデル (Models):**
    - **Ultra エイリアス:** `claude-ultra` (自動的に high effort に設定), `codex-ultra` (自動的に xhigh reasoning に設定), `gemini-ultra`
    - Claude: `sonnet`, `sonnet[1m]`, `opus`, `opusplan`, `haiku`
    - Codex: `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1`, `gpt-5`
    - Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-pro-preview`, `gemini-3-pro-preview`, `gemini-3-flash-preview`
- `reasoning_effort` (string, 任意): Claude と Codex の推論制御。Claude では `--effort` を使います（許容値: "low", "medium", "high"）。Codex では `model_reasoning_effort` を使います（許容値: "low", "medium", "high", "xhigh"）。
- `session_id` (string, 任意): 以前のセッションを再開するためのセッションID。対応モデル: haiku, sonnet, opus, gemini-2.5-pro, gemini-2.5-flash, gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-3-flash-preview。

### `wait`

複数のAIエージェントプロセスの完了を待機し、結果をまとめて返します。指定されたすべてのPIDが終了するか、タイムアウトになるまでブロックします。

**引数:**
- `pids` (array of numbers, 必須): 待機するプロセスIDのリスト（`run` ツールから返されたもの）。
- `timeout` (number, 任意): 最大待機時間（秒）。デフォルトは180秒（3分）です。

### `list_processes`

実行中および完了したすべてのAIエージェントプロセスを、ステータス、PID、基本情報とともにリストアップします。

### `get_result`

PIDを指定して、AIエージェントプロセスの現在の出力とステータスを取得します。

**引数:**
- `pid` (number, 必須): `run` ツールによって返されたプロセスID。

### `kill_process`

PIDを指定して、実行中のAIエージェントプロセスを終了します。

**引数:**
- `pid` (number, 必須): 終了させるプロセスID。

## トラブルシューティング

- **"Command not found" (claude-code-mcp):** グローバルにインストールした場合、npmのグローバルbinディレクトリがシステムのPATHに含まれているか確認してください。`npx` を使用している場合、`npx` 自体が機能しているか確認してください。
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
        "CODEX_CLI_NAME": "codex-custom"
      }
    },
```

## ライセンス

MIT
