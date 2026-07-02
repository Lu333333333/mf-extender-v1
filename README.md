# MF Extender

マネーフォワード クラウド各サービスの使い勝手を改善する Chrome 拡張機能。

社内業務の効率化を目的とした内製ツール。Chrome Web Store には公開しない。  
チームへの配布は zip 共有 → 開発者モードで手動インストール。

---

## 機能一覧

| 機能 | 対象 URL | 状態 |
|---|---|---|
| ストレージ 一括ダウンロード | `*.moneyforward.com/storage*` | ✅ 完成 |
| クラウドBox 一括ダウンロード | `box.moneyforward.com/files*` | ✅ 完成 |
| 月次セレクトボックス | `accounting.moneyforward.com/*` | ⚠️ デバッグ中 |

### 月次セレクトボックスの動作

- 開始日フィールドの隣にあるセレクトで月を選ぶと、開始日に `YYYY/MM/01` が自動入力される。
- **開始月を選択すると、終了日にも自動で同月の末日（`YYYY/MM/末日`）が入力される。**
  例：開始月に「7月」を選ぶ → 開始日 `2026/07/01`・終了日 `2026/07/31` が同時に入る。
- 単月以外の範囲にしたい場合は、終了日フィールドの隣にある終了月セレクトで別の月を選び直せば、そちらの値で上書きされる（終了月セレクト単体の動作は従来通り）。
- 対応画面：仕訳帳・総勘定元帳（`journals/content.js` の `PAGE_CONFIGS` で管理。新規画面を追加する場合はここにエントリを足す）。

---

## リポジトリ構成

```
mf-extender-v1/
├── manifest.json        # 拡張機能定義（Manifest V3）
├── icons/               # アイコン 16 / 48 / 128px（#008BF2 背景）
├── lib/
│   └── jszip.min.js     # JSZip v3.10.1（オフラインバンドル）
├── storage/
│   ├── content.js       # ストレージ一括DL
│   └── content.css
├── box/
│   ├── content.js       # クラウドBox一括DL
│   └── content.css
└── journals/
    ├── content.js       # 月次セレクトボックス ⚠️
    └── content.css
```

---

## インストール手順

1. このリポジトリをクローン、または zip でダウンロードして展開
2. Chrome で `chrome://extensions` を開く
3. 右上「デベロッパーモード」を ON にする
4. 「パッケージ化されていない拡張機能を読み込む」→ `mf-extender-v1` フォルダを選択
5. 「MF Extender v1」が一覧に表示されれば完了

---

## コードを変更して反映する

```
1. 対象ファイルを編集して保存
2. chrome://extensions でカードの 🔄 をクリック
3. 対象ページを F5 でリロード
```

構文チェックは `node -c <ファイル名>` で実行できる。

---

## チームへの配布

```
zip -r mf-extender-v1.zip mf-extender-v1/
```

作成した zip をSlack・共有ドライブ等で共有。受け取り側は上記インストール手順に従う。  
更新時はフォルダを上書きして 🔄 を押すだけ。

---

## ブランチ運用

| ブランチ | 用途 |
|---|---|
| `main` | リリース済み・チームへ配布するバージョン |
| `develop` | 開発・統合ブランチ |
| `feature/*` | 機能追加（例：`feature/journals-select`） |
| `fix/*` | バグ修正（例：`fix/box-selector`） |

PR は `feature/*` → `develop` → `main` の順でマージ。  
`main` へのマージ時は `manifest.json` の `version` をインクリメントする。

---

## 開発上の重要ルール

### React 管理 DOM への干渉禁止
React が管理する要素（`tr`・`thead` 等）への `insertBefore` / `appendChild` は **禁止**。  
Reactの再描画時に `Minified React error #418`（Hydration mismatch）でクラッシュする。

- ✅ 許容：既存要素への `classList.toggle`
- ✅ 許容：`document.body` 直下への独立要素の追加
- ❌ 禁止：React 管理ツリー内への要素追加・削除

### MutationObserver は必ず rAF デバウンスする
```js
let pending = false;
const observer = new MutationObserver(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; /* 処理 */ });
});
```

### SPA ナビゲーションに対応する
`accounting.moneyforward.com` は SPA。`location.href` の変化を MutationObserver で検知して再初期化する。

### 外部ライブラリは同梱する
Manifest V3 の CSP により外部 CDN からの読み込みは不可。`lib/` に同梱して使う。

---

## よくあるトラブル

| 症状 | 原因 | 対処 |
|---|---|---|
| 機能が突然動かなくなった | MF 側の HTML 構造変更 | DevTools でセレクタを再確認し `content.js` を修正 |
| `Minified React error #418` | React DOM ツリーへの要素追加 | DOM 追加をやめ、body 直下への独立要素設置に変更 |
| ボタン・セレクトが表示されない | SPA の描画タイミングのズレ | MutationObserver でフィールドの出現を待っているか確認 |
| ダウンロードが 403 エラー | セッション切れ | ログインし直して再試行 |
| 変更が反映されない | キャッシュ | 🔄 の後に F5 |
| 開始月を選んでも終了日が変わらない | `content.js` が古いまま反映されていない、または `toFieldId` のID不一致 | 🔄 → F5 で再読み込み。直らない場合は DevTools で終了日フィールドの実際のIDを確認し `PAGE_CONFIGS` と照合 |

---

## 関連ドキュメント

- `CHECKLIST.md` — PR レビュー・リリース時のチェックリスト
- `MF_Extender_v1_引き継ぎ書.md` — 開発経緯・設計判断の詳細
