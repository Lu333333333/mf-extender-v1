/* クラウドBox 一括ダウンロード／一括ゴミ箱移動 - content script */
(() => {
  "use strict";

  const DOWNLOAD_URL_PREFIX = "/frontend/v3/files/";
  const DOWNLOAD_URL_SUFFIX = "/download";

  // 「ゴミ箱に入れる」API（DevToolsのNetworkタブで確認済み・2026/07 時点）
  //   POST /frontend/v3/files/{uuid}/trash （リクエストボディなし）
  //   ※ 完全削除ではなく、ゴミ箱への移動（復元可能）
  const TRASH_URL_PREFIX = "/frontend/v3/files/";
  const TRASH_URL_SUFFIX = "/trash";
  const TRASH_METHOD = "POST";

  const PANEL_ID = "mfbox-dl-panel";
  const SELECTED_CLASS = "mfbox-row-selected";
  const CHUNK_SIZE = 8; // 並列処理数（ダウンロード・削除共通）

  const MIME_TO_EXT = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "text/csv": ".csv",
    "text/plain": ".txt",
    "application/zip": ".zip",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.ms-excel": ".xls",
    "application/msword": ".doc",
  };

  let isDownloading = false;
  let isDeleting = false;
  let selectedUuids = new Set();
  let lastClickedIndex = null;

  // rowsキャッシュ（MutationObserver発火時に更新）
  let rowsCache = [];
  let observerInstance = null;

  // 選択状態管理

  function updateRowsCache() {
    const nameLinks = document.querySelectorAll('a[data-testid="file-name-span"]');
    rowsCache = [];
    nameLinks.forEach((link) => {
      const tr = link.closest("tr");
      if (tr) rowsCache.push({ tr, link });
    });
  }

  function getFileRows() {
    return rowsCache;
  }

  function extractFileInfo(link) {
    const href = link.getAttribute("href") || "";
    const match = href.match(/\/files\/([0-9a-fA-F-]{36})/);
    if (!match) return null;
    const uuid = match[1];
    const name = (link.textContent || "").trim() || `${uuid}.dat`;
    return { uuid, name };
  }

  function applySelectionClasses() {
    rowsCache.forEach(({ tr, link }) => {
      const info = extractFileInfo(link);
      tr.classList.toggle(SELECTED_CLASS, !!info && selectedUuids.has(info.uuid));
    });
  }

  function clearSelection() {
    if (selectedUuids.size === 0) return;
    selectedUuids.clear();
    lastClickedIndex = null;
    applySelectionClasses();
    syncPanel();
  }

  // イベントハンドラ

  function handleRowClick(e) {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;

    const tr = e.target.closest("tr");
    if (!tr) return;

    const rows = getFileRows();
    const index = rows.findIndex((r) => r.tr === tr);
    if (index === -1) return;

    const info = extractFileInfo(rows[index].link);
    if (!info) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey && lastClickedIndex !== null) {
      // Shift選択：既存選択をクリアして範囲のみに絞る（Explorer/Finder準拠）
      selectedUuids.clear();
      const [start, end] = [lastClickedIndex, index].sort((a, b) => a - b);
      for (let i = start; i <= end; i++) {
        const rowInfo = extractFileInfo(rows[i].link);
        if (rowInfo) selectedUuids.add(rowInfo.uuid);
      }
    } else {
      // Ctrl/Cmd：トグル
      if (selectedUuids.has(info.uuid)) {
        selectedUuids.delete(info.uuid);
      } else {
        selectedUuids.add(info.uuid);
      }
      lastClickedIndex = index;
    }

    applySelectionClasses();
    syncPanel();
  }

  function handleKeydown(e) {
    if (e.key === "Escape" && selectedUuids.size > 0) clearSelection();
  }

  // パネルUI

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.display = "none";

    const countLabel = document.createElement("span");
    countLabel.id = "mfbox-dl-count";

    const clearBtn = document.createElement("button");
    clearBtn.id = "mfbox-dl-clear";
    clearBtn.type = "button";
    clearBtn.textContent = "すべて解除";
    clearBtn.addEventListener("click", clearSelection);

    const dlBtn = document.createElement("button");
    dlBtn.id = "mfbox-dl-btn";
    dlBtn.type = "button";
    dlBtn.textContent = "一括ダウンロード";
    dlBtn.addEventListener("click", onBulkDownloadClick);

    const trashBtn = document.createElement("button");
    trashBtn.id = "mfbox-dl-delete-btn";
    trashBtn.type = "button";
    trashBtn.textContent = "ゴミ箱に入れる";
    trashBtn.addEventListener("click", onBulkTrashClick);

    panel.appendChild(countLabel);
    panel.appendChild(clearBtn);
    panel.appendChild(dlBtn);
    panel.appendChild(trashBtn);
    document.body.appendChild(panel);
  }

  function syncPanel() {
    const panel = document.getElementById(PANEL_ID);
    const countLabel = document.getElementById("mfbox-dl-count");
    const dlBtn = document.getElementById("mfbox-dl-btn");
    const trashBtn = document.getElementById("mfbox-dl-delete-btn");
    if (!panel) return;

    const count = selectedUuids.size;
    const busy = isDownloading || isDeleting;
    panel.style.display = count > 0 ? "flex" : "none";
    if (countLabel) countLabel.textContent = `${count}件選択中`;
    if (dlBtn) dlBtn.disabled = busy || count === 0;
    if (trashBtn) trashBtn.disabled = busy || count === 0;
  }

  // ダウンロード処理

  async function onBulkDownloadClick() {
    if (isDownloading || isDeleting) return;

    const dlBtn = document.getElementById("mfbox-dl-btn");
    if (!dlBtn || dlBtn.disabled) return;

    const targets = getFileRows()
      .map(({ link }) => extractFileInfo(link))
      .filter((info) => info && selectedUuids.has(info.uuid));

    if (targets.length === 0) return;

    isDownloading = true;
    dlBtn.disabled = true;
    dlBtn.textContent = `ダウンロード中 (0/${targets.length})`;

    try {
      const zip = new JSZip();
      const usedNames = new Map();
      const failures = [];
      let completed = 0;

      // CHUNK_SIZE件ずつ並列取得
      for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
        const chunk = targets.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (file) => {
            try {
              const url = `${DOWNLOAD_URL_PREFIX}${file.uuid}${DOWNLOAD_URL_SUFFIX}`;
              const res = await fetch(url, { credentials: "include", headers: { Accept: "*/*" } });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const blob = await res.blob();
              const name = ensureExtension(uniqueFileName(file.name, usedNames), blob.type);
              zip.file(name, blob);
            } catch (err) {
              failures.push({ name: file.name, error: err.message || String(err) });
            } finally {
              completed++;
              if (dlBtn) dlBtn.textContent = `ダウンロード中 (${completed}/${targets.length})`;
            }
          })
        );
      }

      if (targets.length - failures.length === 0) {
        alert("ダウンロードに失敗しました。ページを再読み込みしてから、もう一度お試しください。");
        return;
      }

      triggerDownload(await zip.generateAsync({ type: "blob" }), buildZipFileName());

      if (failures.length > 0) {
        alert(
          `${failures.length}件のファイルはダウンロードできませんでした。\n` +
          failures.map((f) => `・${f.name}`).join("\n") +
          "\n\n他のファイルはZIPに含めてダウンロードしました。"
        );
      }

      clearSelection();
    } catch (err) {
      console.error("[クラウドBox一括ダウンロード] エラー:", err);
      alert("ZIP作成中にエラーが発生しました。コンソールをご確認ください。");
    } finally {
      isDownloading = false;
      if (dlBtn) dlBtn.textContent = "一括ダウンロード";
      syncPanel();
    }
  }

  // ゴミ箱に入れる処理（完全削除ではなく復元可能な操作）

  async function onBulkTrashClick() {
    if (isDownloading || isDeleting) return;

    const trashBtn = document.getElementById("mfbox-dl-delete-btn");
    if (!trashBtn || trashBtn.disabled) return;

    const targets = getFileRows()
      .map(({ link }) => extractFileInfo(link))
      .filter((info) => info && selectedUuids.has(info.uuid));

    if (targets.length === 0) return;

    // 実行前の確認ダイアログ（件数・ファイル名一覧を表示）※必須
    // ゴミ箱への移動＝復元可能な操作のため、「取り消せません」ではなく
    // ゴミ箱に入る旨を明示する。
    const confirmMessage =
      `以下の${targets.length}件のファイルをゴミ箱に入れます。よろしいですか？\n` +
      "（ゴミ箱から復元できます）\n\n" +
      targets.map((f) => `・${f.name}`).join("\n");
    if (!confirm(confirmMessage)) return;

    isDeleting = true;
    trashBtn.disabled = true;
    trashBtn.textContent = `ゴミ箱に移動中 (0/${targets.length})`;
    // ダウンロードボタンも操作不能にする（syncPanelで一括制御）
    syncPanel();

    const failures = [];
    let completed = 0;

    try {
      // CHUNK_SIZE件ずつ並列実行
      for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
        const chunk = targets.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (file) => {
            try {
              const url = `${TRASH_URL_PREFIX}${file.uuid}${TRASH_URL_SUFFIX}`;
              const res = await fetch(url, {
                method: TRASH_METHOD,
                credentials: "include",
                headers: { Accept: "*/*" },
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              // 成功：選択状態からも除去
              selectedUuids.delete(file.uuid);
            } catch (err) {
              failures.push({ name: file.name, error: err.message || String(err) });
            } finally {
              completed++;
              if (trashBtn) trashBtn.textContent = `ゴミ箱に移動中 (${completed}/${targets.length})`;
            }
          })
        );
      }

      const successCount = targets.length - failures.length;

      if (successCount === 0) {
        alert("ゴミ箱への移動に失敗しました。ページを再読み込みしてから、もう一度お試しください。");
        return;
      }

      if (failures.length > 0) {
        alert(
          `${successCount}件のファイルをゴミ箱に入れました。\n` +
          `${failures.length}件は失敗しました。\n` +
          failures.map((f) => `・${f.name}`).join("\n") +
          "\n\n画面を再読み込みします。"
        );
      } else {
        alert(`${successCount}件のファイルをゴミ箱に入れました。\n\n画面を再読み込みします。`);
      }

      // このスクリプトはReact管理下のDOM/状態を直接操作しない方針のため、
      // 実行後は一覧を最新化するためにページを再読み込みする。
      location.reload();
    } catch (err) {
      console.error("[クラウドBoxゴミ箱に入れる] エラー:", err);
      alert("処理中にエラーが発生しました。コンソールをご確認ください。");
    } finally {
      isDeleting = false;
      if (trashBtn) trashBtn.textContent = "ゴミ箱に入れる";
      applySelectionClasses();
      syncPanel();
    }
  }

  // ユーティリティ

  function ensureExtension(name, mimeType) {
    if (/\.[a-zA-Z0-9]{2,5}$/.test(name)) return name;
    return name + (MIME_TO_EXT[mimeType] || "");
  }

  function uniqueFileName(name, usedNames) {
    const count = usedNames.get(name) || 0;
    usedNames.set(name, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return `${name} (${count})`;
    return `${name.slice(0, dot)} (${count})${name.slice(dot)}`;
  }

  function buildZipFileName() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `box_files_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // 初期化

  function init() {
    ensurePanel();
    updateRowsCache();
    syncPanel();

    document.addEventListener("click", handleRowClick, true);
    document.addEventListener("keydown", handleKeydown);

    // rAFデバウンスでReact再描画に追従（優先度A）
    let pending = false;
    observerInstance = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        updateRowsCache();
        applySelectionClasses();
      });
    });
    observerInstance.observe(document.body, { childList: true, subtree: true });

    // SPA遷移時に監視を解除（優先度B）
    window.addEventListener("beforeunload", () => observerInstance.disconnect());
  }

  function bootstrap() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  // 機能フラグがONの場合のみ起動する
  window.MFExFeatureFlags.isEnabled("box").then((enabled) => {
    if (enabled) bootstrap();
  });
})();
