/* MF Extender v1 - 月次セレクト（仕訳帳・総勘定元帳ほか） */
(() => {
  "use strict";

  const SELECT_FROM_ID = "mfex-month-from";
  const SELECT_TO_ID   = "mfex-month-to";

  /**
   * 画面ごとの定義リスト。
   * 新規画面に対応する場合はここにエントリを追加する。
   *
   * detect()       : この画面かどうかの判定
   * fromFieldId    : 開始日 <input type="text"> のID（値セット＆期首読み取りに使う）
   * toFieldId      : 終了日 <input type="text"> のID
   * getFromAnchor(): 開始日セレクトを insertAfter する基準要素
   * getToAnchor()  : 終了日セレクトを insertAfter する基準要素
   *
   * ※ クラス名は MF 側の変更で変わることがある。
   *   動かなくなったら DevTools で実際のクラス名を再確認すること。
   */
  const PAGE_CONFIGS = [
    {
      // 仕訳帳：recognized_at_from が type="text" として直接存在する画面
      id: "journals",
      detect: () => {
        const el = document.getElementById("recognized_at_from");
        return !!el && el.type === "text";
      },
      fromFieldId: "recognized_at_from",
      toFieldId:   "recognized_at_to",
      getFromAnchor: () =>
        document.getElementById("recognized_at_from")?.closest(".wrapper___UX5gN"),
      getToAnchor: () =>
        document.getElementById("recognized_at_to")?.closest(".wrapper___UX5gN"),
    },
    {
      // 総勘定元帳：操作対象フィールドが webapp_ プレフィックス付きの画面
      // （recognized_at_from は type="hidden" として別に存在するため触らない）
      id: "ledger",
      detect: () => !!document.getElementById("webapp_recognized_at_from"),
      fromFieldId: "webapp_recognized_at_from",
      toFieldId:   "webapp_recognized_at_to",
      getFromAnchor: () =>
        document.getElementById("webapp_recognized_at_from")?.closest(".wrapper___UX5gN"),
      getToAnchor: () =>
        document.getElementById("webapp_recognized_at_to")?.closest(".wrapper___UX5gN"),
    },
  ];

  function detectPageConfig() {
    return PAGE_CONFIGS.find(cfg => cfg.detect()) ?? null;
  }

  /**
   * 年度表示 span（例：「2025年度（9月1日〜8月31日）」）から期首情報を読み取る。
   * @returns {{ fiscalStartMonth: number, fiscalStartYear: number }}
   */
  function getFiscalInfo() {
    const span = Array.from(document.querySelectorAll("span")).find(
      el => /\d+年度（\d+月\d+日〜\d+月\d+日）/.test(el.textContent)
    );
    if (span) {
      const m = span.textContent.match(/(\d+)年度（(\d+)月/);
      if (m) {
        return {
          fiscalStartMonth: parseInt(m[2], 10),
          fiscalStartYear:  parseInt(m[1], 10),
        };
      }
    }
    // フォールバック：4月始まり・現在の年
    return { fiscalStartMonth: 4, fiscalStartYear: new Date().getFullYear() };
  }

  // 期首月から12ヶ月分の {month, year} 配列を生成
  function buildMonthList() {
    const { fiscalStartMonth, fiscalStartYear } = getFiscalInfo();
    const months = [];
    for (let i = 0; i < 12; i++) {
      const month = ((fiscalStartMonth - 1 + i) % 12) + 1;
      const year  = month >= fiscalStartMonth ? fiscalStartYear : fiscalStartYear + 1;
      months.push({ month, year });
    }
    return months;
  }

  function lastDayOfMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function formatDate(year, month, day) {
    return `${year}/${String(month).padStart(2,"0")}/${String(day).padStart(2,"0")}`;
  }

  // React管理下のinputへ値をセットして変更を検知させる
  function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // セレクトボックスを生成
  function buildSelect(id, onChangeFn) {
    const select = document.createElement("select");
    select.id = id;
    select.className = "mfex-month-select";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "月を選択";
    select.appendChild(placeholder);

    buildMonthList().forEach(({ month, year }) => {
      const opt = document.createElement("option");
      opt.value = JSON.stringify({ month, year });
      opt.textContent = `${month}月`;
      select.appendChild(opt);
    });

    select.addEventListener("change", () => {
      if (!select.value) return;
      const { month, year } = JSON.parse(select.value);
      onChangeFn(month, year);
      select.value = ""; // 選択後リセット（再選択できるように）
    });

    return select;
  }

  // anchor要素の直後にセレクトを挿入
  function insertSelect(anchor, selectId, onChangeFn) {
    if (document.getElementById(selectId)) return;
    if (!anchor) return;
    const select = buildSelect(selectId, onChangeFn);
    anchor.insertAdjacentElement("afterend", select);
  }

  function init() {
    const cfg = detectPageConfig();
    if (!cfg) return; // 対応していない画面では何もしない

    const fromAnchor = cfg.getFromAnchor();
    const toAnchor   = cfg.getToAnchor();

    insertSelect(fromAnchor, SELECT_FROM_ID, (month, year) => {
      setInputValue(cfg.fromFieldId, formatDate(year, month, 1));
    });
    insertSelect(toAnchor, SELECT_TO_ID, (month, year) => {
      setInputValue(cfg.toFieldId, formatDate(year, month, lastDayOfMonth(year, month)));
    });
  }

  // SPA対応：URLが変わったら再度初期化を試みる
  let lastUrl = location.href;
  let domObserver = null;

  function tryInit() {
    const cfg = detectPageConfig();
    if (!cfg) return; // 対応外の画面は何もしない

    // 既存のセレクトを一旦除去して再構築（SPA遷移後の再注入に対応）
    [SELECT_FROM_ID, SELECT_TO_ID].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    init();
  }

  // MutationObserverでDOM変化を監視しフィールドの出現を待つ
  domObserver = new MutationObserver(() => {
    // URLが変わっていたら再初期化
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      tryInit();
      return;
    }
    // フィールドが出現したら注入（セレクト未注入かつ対応画面に切り替わった場合）
    if (!document.getElementById(SELECT_FROM_ID) && detectPageConfig()) {
      tryInit();
    }
  });

  function bootstrap() {
    domObserver = new MutationObserver(() => {
      // URLが変わっていたら再初期化
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        tryInit();
        return;
      }
      // フィールドが出現したら注入（セレクト未注入かつ対応画面に切り替わった場合）
      if (!document.getElementById(SELECT_FROM_ID) && detectPageConfig()) {
        tryInit();
      }
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("beforeunload", () => domObserver?.disconnect());

    // 初回（既にDOMにある場合）
    tryInit();
  }

  // 機能フラグがONの場合のみ起動する
  window.MFExFeatureFlags.isEnabled("journals").then((enabled) => {
    if (enabled) bootstrap();
  });
})();
