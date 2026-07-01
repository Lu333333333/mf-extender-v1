/* MF Extender v1 - popup設定画面 */
(() => {
  "use strict";

  const DEFAULT_FLAGS = {
    storage: true,
    box: true,
    journals: true,
  };

  const TOGGLES = {
    storage: document.getElementById("toggle-storage"),
    box: document.getElementById("toggle-box"),
    journals: document.getElementById("toggle-journals"),
  };

  const statusText = document.getElementById("status-text");
  let statusTimer = null;

  function showStatus(message) {
    statusText.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusText.textContent = "";
    }, 1500);
  }

  function loadSettings() {
    chrome.storage.sync.get(DEFAULT_FLAGS, (result) => {
      Object.keys(TOGGLES).forEach((key) => {
        TOGGLES[key].checked = result[key] !== false;
      });
    });
  }

  function bindEvents() {
    Object.keys(TOGGLES).forEach((key) => {
      TOGGLES[key].addEventListener("change", () => {
        const value = TOGGLES[key].checked;
        chrome.storage.sync.set({ [key]: value }, () => {
          showStatus("保存しました。対象ページを再読み込みしてください");
        });
      });
    });
  }

  loadSettings();
  bindEvents();
})();
