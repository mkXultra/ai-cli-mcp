# ACMのmodel／effort選定メモ

ACMで実装を依頼するモデルを選ぶための、具体的な成功・失敗例。呼び出し側が把握している依頼の背景と、下表の**同時に満たすべき要求**を照らし合わせて候補を考える。「UI」「キャッシュ」といった名前だけでは選ばない。

AstraはGPT-6、Sol・Terra・LunaはGPT-5.6。effortは作業担当モデルに指定する推論量。`4/4`はそのタスクで4試行中4回成功した意味で、未知の類似タスクの成功確率ではない。

## どんな依頼で候補になるか

| 依頼に含まれる要求 | 候補model／effort | 根拠となる具体例と実績 |
|---|---|---|
| **非同期UIで、古い応答の破棄・キャンセル・キャッシュ・再試行・終了処理を両立する** | Astra high / max | Clackの検索補完UI。入力変更時のabort、最新応答だけの反映、バックグラウンド再取得、タイマー破棄まで要求。Astra high/maxは各4/4、Sol/Terra/Lunaのmaxは各0/4。 |
| **構造を書き換えても、変更前の関係が決める意味を壊さない** | Astra high / xhigh / max | OxvgのSVG最適化。変更前のセレクタと要素の関係を調べ、関係する箇所だけ変形を禁止する。Astra high以上は各4/4、Sol/Terraは全effortで成功なし。 |
| **再帰参照と条件分岐が組み合わさる仕様を実装する** | Astra max | ArkTypeのJSON Schema対応。再帰的な参照、if/then/else、暗黙のobject判定、anyOfの組み合わせ。Astra maxは4/4、同high/xhighは各1/4。 |
| **データ形式を相互変換し、値・コメント・往復変換の整合性を保つ** | Astra medium / Sol high | TOMLKitの通常テーブル・インラインテーブル・ドットキー間の変換。Astra medium、Sol highは各4/4。Terra maxは2/4、Luna maxは3/4。 |
| **永続化した状態を、既存の実行時状態と細かい規則で復元・統合する** | Sol high / Terra medium / Luna medium | TanStack Queryの復元。データとエラーの新旧を別々に判定し、失敗回数・時刻・ページ情報を保持、通常の成功コールバックを抑止する。左の3設定は各4/4、Astraは各effortで最大2/4。Sol/Terraのmaxは各1/4。 |
| **既存の型付きAPIを拡張し、実行時の動作と型検査の契約を別々に守る** | Terra medium以上 | ts-patternの全件マッチAPI。元の入力型で各分岐を評価しつつ、網羅性検査・型の絞り込み・分岐ごとの選択状態を維持する。Terra medium以上は各4/4、Astraは全effortで0/4。 |
| **複数コンポーネントへの変更を巻き戻し、結果を永続化・公開する** | Terra max（失敗もあり） | Prometheusの設定再読込。途中失敗時に正常設定へ戻し、再起動後も結果をHTTPで確認できるようにする。Terra maxは3/4、同medium/high/xhighは各1/4、Astra/Solは全effortで0/4。 |
| **細かく列挙された整形規則と、構文を取り出すAPIを実装する** | Luna xhigh（失敗もあり） | sqlfmtのCREATE TABLE対応。改行・括弧・制約・型内の空白・対象外構文の維持と、列情報を取り出すAPI。Luna xhighは3/4、同maxは1/4、Astra medium以上は各0/4。 |

## このメモの使い方

- **どの要求同士が干渉するかを見て候補を選ぶ。** 同じ状態管理でも、非同期補完UIと永続キャッシュ復元では結果が違う。
- **modelとeffortをセットで考える。** 再帰スキーマではAstra maxが良かった一方、状態復元やSQL整形ではmaxへの引き上げが改善になっていない。
- 表は結果を見て選んだ事例からの選定ヒントで、タスク種類ごとの優劣を検証した分類器ではない。似た要求がなければ無理に当てはめず、現在のコード・制約・実際の失敗内容を優先する。

出典：DeepSWE由来の[保存済みタスク別試行結果](../.codex-artifacts/jev-effort-staged-20260920/source-outcomes.json)から8事例を抜粋（2026-09-21）。数値は作業の実行結果であり、モデル選定LLMの精度ではない。
