# CantoCards

A mobile-first Cantonese character-reading study PWA.

## Data

- Character readings and source-table hints: primarily based on Hong Kong Education Department, *常用字廣州話讀音表*.
- Words and Jyutping: primarily based on Words.hk.
- Context sentences are learning aids; some long-tail entries use recognition contexts.

## Deployment

Upload the contents of this folder to the root of the existing GitHub Pages repository and keep the same Pages URL.

The app uses relative paths, so it works under a project Pages path such as `/canto-cards/`.

## Progress and updates

Learning progress remains in the browser under:

- `cantoCards.progress.v1`
- `cantoCards.settings.v1`

Service Worker cache replacement does not delete localStorage. The app also migrates the v0.3 card-ID format to the v0.4 IDs when needed.

## PWA

- Android / desktop Chromium: install from the browser or the in-app **安裝到裝置** button when available.
- iPhone / iPad Safari: **Share → Add to Home Screen / 加入主畫面**.
- Service Workers require HTTPS except on `localhost`; GitHub Pages provides HTTPS.
