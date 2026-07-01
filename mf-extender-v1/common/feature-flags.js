/* MF Extender v1 - 機能オンオフの共通ヘルパー */
/* 各 content.js から `MFExFeatureFlags.isEnabled("storage", callback)` の形で利用する */
(() => {
  "use strict";

  const DEFAULT_FLAGS = {
    storage: true,
    box: true,
    journals: true,
  };

  /**
   * 指定した機能キーが有効かどうかを取得する。
   * @param {"storage"|"box"|"journals"} key
   * @returns {Promise<boolean>}
   */
  function isEnabled(key) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.sync) {
        // storage権限がない/読めない場合はデフォルト有効として動かす
        resolve(DEFAULT_FLAGS[key] !== false);
        return;
      }
      chrome.storage.sync.get(DEFAULT_FLAGS, (result) => {
        if (chrome.runtime.lastError) {
          resolve(DEFAULT_FLAGS[key] !== false);
          return;
        }
        resolve(result[key] !== false);
      });
    });
  }

  window.MFExFeatureFlags = { isEnabled, DEFAULT_FLAGS };
})();
