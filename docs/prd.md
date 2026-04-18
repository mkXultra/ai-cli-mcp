# AI CLI MCP Server - Product Requirements Document

## Product Overview

| 項目 | 内容 |
|---|---|
| プロダクト名 | AI CLI MCP Server (`ai-cli-mcp`) |
| npm パッケージ | [ai-cli-mcp](https://www.npmjs.com/package/ai-cli-mcp) |
| 現バージョン | 2.8.2 |
| ライセンス | MIT |
| ターゲットユーザー | MCP対応AI IDE / CLI を利用する開発者 |

## Problem Statement

AI支援開発において、以下の制約がユーザーの生産性を阻害している:

1. **逐次処理の制約**: IDEのAIエージェントは1タスクずつしか処理できず、並行作業ができない
2. **モデル選択の制約**: IDEが提供するモデルに限定され、タスクに最適なモデルを選べない
3. **環境の制約**: AI CLIツールの豊富な機能（ファイル操作、Git操作、Web検索等）をIDE内から活用できない

## Goals

- **ホスト非依存**: Claude Code / Gemini CLI / Codex CLI のどれをホスト（呼び出し元）として使っても、同じプロンプト・同じインターフェースで動作すること
- **CLI差異の隠蔽**: 利用者が呼び出し先の Claude Code / Codex / Gemini の個別仕様（フラグ、出力形式、セッション管理等）を意識せず、モデル名とプロンプトだけで使えること
- **AI-Friendly な返り値**: 各CLIの生出力をパースし、AIエージェントが次のアクションを判断しやすい構造化データとして返すこと
- **並行実行**: MCP対応の任意のクライアントから、複数のAI CLIエージェントを並行実行できること
- **最小セットアップ**: npx 一行で起動可能であること

## Non-Goals

- AI CLI ツール自体の機能拡張
- 独自のプロンプトエンジニアリングやチェーン処理
- Web UI やダッシュボードの提供
- AI CLI ツールのインストールや認証の自動化
- 人間向けのリッチなフォーマット出力（返り値はAI消費が前提）

## Functional Requirements

### FR-1: プロセス実行 (`run`)

- ユーザーがプロンプト（文字列 or ファイルパス）、作業ディレクトリ、モデル名を指定してAIエージェントを起動できる
- プロセスはバックグラウンドで実行され、即座にPIDが返却される
- モデル名から適切なCLI（Claude / Codex / Gemini / Forge / OpenCode）が自動選択される
- Ultra エイリアス（`claude-ultra`, `codex-ultra`, `gemini-ultra`）による簡易モデル指定をサポート
- `session_id` による前回セッションの継続をサポート（Claude / Codex / Gemini / Forge / OpenCode）
- `reasoning_effort` による推論深度の指定をサポート（Claude / Codex）

### FR-2: プロセス一覧 (`list_processes`)

- 実行中・完了・失敗の全プロセスをPID・エージェント種別・ステータスとともに一覧表示できる

### FR-3: 結果取得 (`get_result`)

- PIDを指定して、プロセスの出力（パース済み）とメタデータを取得できる
- `verbose` オプションでツール使用履歴等の詳細情報を取得できる
- `session_id` がある場合は結果に含まれる

### FR-4: 一括待機 (`wait`)

- 複数PIDを指定して、全プロセスの完了を待機できる
- 呼び出し側がポーリングする必要はなく、`wait` 自体がブロックして完了まで待つ設計
- `run` → (自分の作業) → `wait` で結果回収、が基本フロー
- タイムアウト指定が可能（デフォルト: 180秒）

### FR-5: プロセス終了 (`kill_process`)

- PIDを指定して実行中のプロセスをSIGTERMで終了できる

### FR-6: クリーンアップ (`cleanup_processes`)

- 完了・失敗したプロセスをプロセスリストから削除し、メモリを解放できる

### FR-7: CLI 状態確認 (`doctor`)

- 対応 AI CLI バイナリの利用可否と path 解決結果を取得できる
- 検査範囲として、ログイン状態や利用規約同意は未確認であることを機械可読に示す

### FR-8: モデル一覧 (`models`)

- 対応モデル名、モデルエイリアス、動的バックエンドの discovery hint を取得できる

## Non-Functional Requirements

### NFR-1: パフォーマンス

- `run` のレスポンスタイムはプロセスの実行時間に依存せず、即座に返却すること
- 複数プロセスの同時実行をサポートすること

### NFR-2: 互換性

- Node.js v20 以上で動作すること
- MCP プロトコル仕様に準拠すること（`@modelcontextprotocol/sdk` 使用）
- stdio トランスポートで動作すること

### NFR-3: 信頼性

- CLIプロセスのクラッシュを適切にハンドリングし、ステータスに反映すること
- プロセスの stdout / stderr を確実に収集すること

### NFR-4: 運用性

- `npx ai-cli-mcp@latest` のみで起動可能であること
- 環境変数によるCLIパスのカスタマイズが可能であること
- `MCP_CLAUDE_DEBUG` によるデバッグログ出力をサポートすること

## Supported Models

| Provider | Models |
|---|---|
| Claude | `sonnet`, `sonnet[1m]`, `opus`, `opusplan`, `haiku` |
| Codex | `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`, `gpt-5.2`, `gpt-5.1`, `gpt-5` |
| Gemini | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-3.1-pro-preview`, `gemini-3-pro-preview`, `gemini-3-flash-preview` |
| Ultra aliases | `claude-ultra`, `codex-ultra`, `gemini-ultra` |

## User Scenarios

### Scenario 1: 並列タスク実行

1. ユーザーがMCPクライアント経由で3つの `run` を発行（リファクタリング / テスト作成 / ドキュメント更新）
2. それぞれ異なるモデルで即座に起動、PIDが返却される
3. ユーザーは別作業を進めつつ、`wait` で全完了を待機
4. 各結果をまとめて確認

### Scenario 2: Session Stacking（推奨パターン）

`session_id` によるセッション再開を活用し、コンテキストを積み重ねて効率的にタスクを実行する。

1. `opus` で大規模コードベースを読み込み、`session_id` を取得
2. 同じ `session_id` を後続の `run` に渡して複数タスクを並行起動
3. コンテキストの再読み込みコストなしに、共有コンテキスト上で実行される
4. さらに後続タスクの `session_id` を使って追加の深掘りも可能（段階的スタッキング）

ポーリング不要: 手順2の後は `wait` で全完了をブロッキング待機すればよい。

**注意**: 多段スタッキング（手順4）に完全対応しているのは Claude のみ。Codex / Gemini は1回のセッション再開は可能だが、再開後に新しい `session_id` が返らないため、それ以上の連鎖はできない。詳細は [Session Stacking](./session-stacking.md) を参照。

## Security Model

本プロダクトは **信頼されたローカル環境** での使用を前提とする。

- 各AI CLIは自動承認モード（`--dangerously-skip-permissions` / `--full-auto` / `-y`）で実行されるため、接続クライアントはローカルマシン上で任意のコード実行が可能になる
- ネットワーク越しの不特定多数への公開は想定しない
- セキュリティ境界は「MCPサーバーへの接続可否」で制御される

## Constraints

- プロセス情報はインメモリのみ。サーバー再起動で消失する（永続化なし）
- stdio トランスポートのみ対応。リモート接続は未サポート
- 単一マシンでの実行が前提。分散実行はサポートしない
- 各AI CLIの事前インストール・認証はユーザー責任

## Release History (Notable)

- **v1.x**: Claude Code MCP として Claude CLI のみサポート
- **v2.x**: `ai-cli-mcp` にリネーム、Codex / Gemini サポート追加、非同期実行モデルに移行
