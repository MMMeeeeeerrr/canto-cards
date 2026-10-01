"use strict";

const CACHE_VERSION = "cantocards-v04-mobile1";
const RELEASE = "04mobile1";

const APP_ASSETS = [
  `./index.html?v=${RELEASE}`,
  `./styles.css?v=${RELEASE}`,
  `./app.js?v=${RELEASE}`,
  `./manifest.webmanifest?v=${RELEASE}`,
  `./icon-180.png?v=${RELEASE}`,
  `./icon-192.png?v=${RELEASE}`,
  `./icon-512.png?v=${RELEASE}`,
  `./data/cards.json?v=${RELEASE}`,
  `./data/startup.json?v=${RELEASE}`,
  `./data/search_index.json?v=${RELEASE}`,
  `./data/examples/00.json?v=${RELEASE}`,
  `./data/examples/01.json?v=${RELEASE}`,
  `./data/examples/02.json?v=${RELEASE}`,
  `./data/examples/03.json?v=${RELEASE}`,
  `./data/examples/04.json?v=${RELEASE}`,
  `./data/examples/05.json?v=${RELEASE}`,
  `./data/examples/06.json?v=${RELEASE}`,
  `./data/examples/07.json?v=${RELEASE}`,
  `./data/examples/08.json?v=${RELEASE}`,
  `./data/examples/09.json?v=${RELEASE}`,
  `./data/examples/0a.json?v=${RELEASE}`,
  `./data/examples/0b.json?v=${RELEASE}`,
  `./data/examples/0c.json?v=${RELEASE}`,
  `./data/examples/0d.json?v=${RELEASE}`,
  `./data/examples/0e.json?v=${RELEASE}`,
  `./data/examples/0f.json?v=${RELEASE}`,
  `./data/examples/10.json?v=${RELEASE}`,
  `./data/examples/11.json?v=${RELEASE}`,
  `./data/examples/12.json?v=${RELEASE}`,
  `./data/examples/13.json?v=${RELEASE}`,
  `./data/examples/14.json?v=${RELEASE}`,
  `./data/examples/15.json?v=${RELEASE}`,
  `./data/examples/16.json?v=${RELEASE}`,
  `./data/examples/17.json?v=${RELEASE}`,
  `./data/examples/18.json?v=${RELEASE}`,
  `./data/examples/19.json?v=${RELEASE}`,
  `./data/examples/1a.json?v=${RELEASE}`,
  `./data/examples/1b.json?v=${RELEASE}`,
  `./data/examples/1c.json?v=${RELEASE}`,
  `./data/examples/1d.json?v=${RELEASE}`,
  `./data/examples/1e.json?v=${RELEASE}`,
  `./data/examples/1f.json?v=${RELEASE}`
];
const abs = path => new URL(path,self.location.href).href;
const INDEX_URL = abs(`./index.html?v=${RELEASE}`);

async function cacheBatch(cache, urls, batchSize=6){
  for(let i=0;i<urls.length;i+=batchSize){
    const batch=urls.slice(i,i+batchSize);
    await Promise.all(batch.map(async url=>{
      const req=new Request(abs(url),{cache:"reload"});
      const res=await fetch(req);
      if(!res.ok)throw new Error(`Failed to cache ${url}: ${res.status}`);
      await cache.put(req,res);
    }));
  }
}

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_VERSION);
    await cacheBatch(cache,APP_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("cantocards-")&&k!==CACHE_VERSION).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting()});

async function cacheFirst(request){
  const cached=await caches.match(request);
  if(cached)return cached;
  const response=await fetch(request);
  if(response.ok){const cache=await caches.open(CACHE_VERSION);cache.put(request,response.clone())}
  return response;
}
async function networkFirstNavigation(request){
  try{const response=await fetch(request,{cache:"no-store"});if(response.ok)return response;throw new Error(`Navigation HTTP ${response.status}`)}
  catch{return (await caches.match(INDEX_URL))||Response.error()}
}
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
  if(event.request.mode==="navigate"){event.respondWith(networkFirstNavigation(event.request));return}
  event.respondWith(cacheFirst(event.request));
});
