CantoCards v0.4 — Chrome Migration Rescue (04pwa3)

WHY
---
Chrome still serves the old v0.3 shell at the formal root URL even though:
- another browser shows v0.4;
- the versioned index URL shows v0.4;
- GitHub Pages is deployed correctly.

This package performs a one-time, scoped cleanup of CantoCards Service Worker / Cache Storage.
It does NOT clear localStorage learning progress.

UPLOAD
------
Upload these FIVE files to the repository ROOT, replacing the four existing same-name files:
- index.html
- app.js
- manifest.webmanifest
- sw.js
and adding:
- migrate-v04.html

Do NOT touch /data.

AFTER GITHUB PAGES DEPLOYMENT SUCCEEDS
-------------------------------------
In normal Chrome (not Incognito), open:
https://mmmeeeeeerrr.github.io/canto-cards/migrate-v04.html?run=04pwa3

Optional: tap the backup button first.
Then tap:
"開始修復並進入 v0.4"

The page will:
1) unregister only Service Workers scoped under /canto-cards/;
2) delete only Cache Storage keys beginning with cantocards-;
3) preserve localStorage;
4) redirect to index.html?v=04pwa3.

Then wait for Settings > 安裝與離線 to show 離線功能已啟用.
Finally close Chrome and reopen the formal root URL:
https://mmmeeeeeerrr.github.io/canto-cards/

IMPORTANT
---------
Do NOT use Android "Clear storage / Clear site data" for this migration.
Do NOT uninstall the old PWA before confirming progress is present in v0.4.
