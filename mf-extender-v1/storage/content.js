/* MF会計 ストレージ一括ダウンロード - content script */
(() => {
  "use strict";

  const BULK_DELETE_ID = "js-btn-bulk-destroy";
  const BULK_DOWNLOAD_ID = "js-btn-bulk-download";
  const FILE_CHECKBOX_CLASS = "js-file-select";
  const FILE_ROW_SELECTOR = "tr.storage-file";
  const CHUNK_SIZE = 8;

  let isDownloading = false;
  let observerInstance = null;

  // 初期化

  function init() {
    const bulkDeleteBtn = document.getElementById(BULK_DELETE_ID);
    if (!bulkDeleteBtn || document.getElementById(BULK_DOWNLOAD_ID)) return;

    const downloadBtn = document.createElement("div");
    downloadBtn.id = BULK_DOWNLOAD_ID;
    downloadBtn.className = "ca-btn-setting ca-btn-size-xxsmall mf-mb10 mf-ml5 is-disabled";
    downloadBtn.textContent = "一括ダウンロード";
    bulkDeleteBtn.insertAdjacentElement("afterend", downloadBtn);
    downloadBtn.addEventListener("click", onBulkDownloadClick);

    syncButtonState();

    document.addEventListener("change", (e) => {
      const target = e.target;
      if (
        target &&
        target.matches &&
        (target.matches(`.${FILE_CHECKBOX_CLASS}`) || target.id === "js-bulk-select")
      ) {
        syncButtonState();
      }
    });

    // rAFデバウンスでMutationObserverの過剰発火を抑制
    const tableBody = document.getElementById("js-storage-files");
    if (tableBody) {
      let pending = false;
      observerInstance = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          syncButtonState();
        });
      });
      observerInstance.observe(tableBody, { childList: true, subtree: true });
    }

    window.addEventListener("beforeunload", () => observerInstance?.disconnect());
  }

  // 選択行の取得・ボタン状態同期

  function getSelectedRows() {
    return Array.from(document.querySelectorAll(FILE_ROW_SELECTOR)).filter((row) => {
      const checkbox = row.querySelector(`.${FILE_CHECKBOX_CLASS}`);
      return checkbox && checkbox.checked;
    });
  }

  function syncButtonState() {
    const downloadBtn = document.getElementById(BULK_DOWNLOAD_ID);
    if (!downloadBtn || isDownloading) return;
    downloadBtn.classList.toggle("is-disabled", getSelectedRows().length === 0);
  }

  // ダウンロード処理

  async function onBulkDownloadClick() {
    if (isDownloading) return;

    const downloadBtn = document.getElementById(BULK_DOWNLOAD_ID);
    if (!downloadBtn || downloadBtn.classList.contains("is-disabled")) return;

    const files = getSelectedRows().map((row) => ({
      fid: row.dataset.fid,
      name: row.dataset.name || `${row.dataset.fid}.dat`,
      url: row.dataset.url,
    }));

    if (files.length === 0) return;

    isDownloading = true;
    setButtonProgress(downloadBtn, 0, files.length);

    try {
      const zip = new JSZip();
      const usedNames = new Map();
      const failures = [];
      let completed = 0;

      // CHUNK_SIZE件ずつ並列取得
      for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (file) => {
            try {
              const response = await fetch(file.url, {
                credentials: "include",
                headers: { Accept: "*/*" },
              });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const blob = await response.blob();
              zip.file(uniqueFileName(file.name, usedNames), blob);
            } catch (err) {
              failures.push({ name: file.name, error: err.message || String(err) });
            } finally {
              completed++;
              setButtonProgress(downloadBtn, completed, files.length);
            }
          })
        );
      }

      if (files.length - failures.length === 0) {
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
    } catch (err) {
      console.error("[MF一括ダウンロード] エラー:", err);
      alert("ZIP作成中にエラーが発生しました。コンソールをご確認ください。");
    } finally {
      isDownloading = false;
      resetButtonLabel(downloadBtn);
      syncButtonState();
    }
  }

  // ユーティリティ

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
    return `storage_files_${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
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

  function setButtonProgress(btn, done, total) {
    btn.classList.add("is-disabled");
    btn.textContent = `ダウンロード中 (${done}/${total})`;
  }

  function resetButtonLabel(btn) {
    btn.textContent = "一括ダウンロード";
  }

  function bootstrap() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }

  // 機能フラグがONの場合のみ起動する
  window.MFExFeatureFlags.isEnabled("storage").then((enabled) => {
    if (enabled) bootstrap();
  });
})();
