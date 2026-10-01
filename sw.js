"use strict";

const CACHE_VERSION = "cantocards-v04-pwa3";
const RELEASE = "04pwa3";

const APP_ASSETS = [
  `./index.html?v=${RELEASE}`,
  `./styles.css?v=${RELEASE}`,
  `./app.js?v=${RELEASE}`,
  `./manifest.webmanifest?v=${RELEASE}`,
  `./icon-180.png?v=${RELEASE}`,
  `./icon-192.png?v=${RELEASE}`,
  `./icon-512.png?v=${RELEASE}`,
  `./data/cards.json?v=${RELEASE}`,
  `./data/words.json?v=${RELEASE}`,
  `./data/card_words.json?v=${RELEASE}`,
  `./data/sentences.json?v=${RELEASE}`
];

const abs = path => new URL(path, self.location.href).href;
const INDEX_URL = abs(`./index.html?v=${RELEASE}`);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    for (const url of APP_ASSETS) {
      const req = new Request(abs(url), {cache:"reload"});
      const res = await fetch(req);
      if (!res.ok) throw new Error(`Failed to cache ${url}: ${res.status}`);
      await cache.put(req, res);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith("cantocards-") && k !== CACHE_VERSION)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request, {cache:"no-cache"});
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request, {cache:"no-store"});
    if (response.ok) return response;
    throw new Error(`Navigation HTTP ${response.status}`);
  } catch {
    return (await caches.match(INDEX_URL)) || Response.error();
  }
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
