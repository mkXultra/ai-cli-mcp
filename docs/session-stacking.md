# Session Stacking

## 概要

Session Stacking は、`session_id` を使ってコンテキストを積み重ね、効率的にタスクを実行する推奨パターンである。

最初の `run` で構築したコンテキスト（コードベースの理解等）を `session_id` 経由で後続タスクに引き継ぐことで、同じ情報の再読み込みを避ける。

## 基本フロー

```
Step 1: コンテキスト構築
run("src/を全部読んで構造を理解して", model="opus")
  → 結果: { session_id: "abc-123", ... }

Step 2: コンテキストを再利用して並行タスク実行
run("utilsをリファクタして", session_id="abc-123", model="sonnet")  → PID 1
run("READMEを更新して",       session_id="abc-123", model="haiku")   → PID 2

Step 3: 結果回収
wait([PID 1, PID 2])  → ブロッキング待機 → 全結果返却
```

## 利点

- **コスト削減**: 大規模コードベースの再読み込みを避けられる
- **コンテキスト共有**: 1回の理解をベースに複数の派生タスクを実行できる
- **段階的な深掘り**: 概要把握 → 詳細分析 → 実装、とセッションを積み重ねられる

## 多段スタッキング

Session Stacking の真価は、セッションを2段、3段と重ねて深掘りしていける点にある。

```
Step 1: 全体理解
run("src/を全部読んで構造を理解して", model="opus")
  → session_id: "abc-123"

Step 2: 詳細分析（Step 1 のコンテキストを継承）
run("認証周りの問題点を洗い出して", session_id="abc-123", model="opus")
  → session_id: "def-456"  ← 新しい session_id が返る

Step 3: 実装（Step 1 + Step 2 のコンテキストを継承）
run("洗い出した問題を修正して", session_id="def-456", model="sonnet")
```

各ステップのコンテキストが累積されるため、後段のタスクほど深い理解の上で実行される。

## 各CLIの対応状況

| CLI | 1回のセッション再開 | 多段スタッキング | 備考 |
|---|---|---|---|
| Claude | OK | **OK** | 再開後に新しい `session_id` が返る。`--fork-session` でセッションをフォークするため、元のセッションも保持される |
| Codex | OK | **NG** | 再開後に新しい `session_id` が返らない。2段（初回 + 1回再開）まで |
| Gemini | OK | **NG** | 再開後に新しい `session_id` が返らない。2段（初回 + 1回再開）まで |

**完全な多段 Session Stacking ができるのは現時点では Claude のみ。** Codex / Gemini は1回のセッション再開には対応しているが、再開時に新しい `session_id` が発行されないため、それ以上の連鎖はできない。これは各CLIの制約であり、本ツール側の制限ではない。

## 内部実装

各CLIのセッション再開方法の違いは `cli-builder.ts` 内で吸収される。利用者は `session_id` パラメータを渡すだけでよい。

| CLI | 内部で実行されるフラグ |
|---|---|
| Claude | `-r <session_id> --fork-session` |
| Gemini | `-r <session_id>` |
| Codex | `exec resume <session_id>` |
