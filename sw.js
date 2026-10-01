"use strict";

const RELEASE = "04mobile2";
const CORE_CACHE = "cantocards-v04-mobile2-core";
const DATA_CACHE = "cantocards-v04-mobile2-data";

const CORE_ASSETS = [
  `./index.html?v=${RELEASE}`,
  `./styles.css?v=${RELEASE}`,
  `./app.js?v=${RELEASE}`,
  `./manifest.webmanifest?v=${RELEASE}`,
  `./icon-180.png?v=${RELEASE}`,
  `./icon-192.png?v=${RELEASE}`,
  `./icon-512.png?v=${RELEASE}`,
  `./data/cards.json?v=${RELEASE}`,
  `./data/startup.json?v=${RELEASE}`
];

const OPTIONAL_ASSETS = [
  `./data/search_index.json?v=${RELEASE}`,
  ...Array.from({length:32},(_,n)=>`./data/examples/${n.toString(16).padStart(2,"0")}.json?v=${RELEASE}`)
];

const abs = path => new URL(path,self.location.href).href;
const INDEX_URL = abs(`./index.html?v=${RELEASE}`);
const scopePath = new URL(self.registration.scope).pathname;

let optionalCachingPromise = null;
let optionalPauseRequested = false;
let optionalLastError = "";

const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function fetchWithTimeout(request,ms=12000){
  const ctrl=new AbortController(),tm=setTimeout(()=>ctrl.abort(),ms);
  try{return await fetch(request,{signal:ctrl.signal})}finally{clearTimeout(tm)}
}

async function putFresh(cache,url){
  const req = new Request(abs(url),{cache:"reload"});
  const res = await fetch(req);
  if(!res.ok) throw new Error(`HTTP ${res.status} · ${url}`);
  await cache.put(req,res);
}

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    // Only the minimum app/core dataset is required for installation.
    // Full examples are deliberately NOT part of install, so one slow shard
    // can never prevent the PWA from becoming a working offline app.
    const cache = await caches.open(CORE_CACHE);
    for(const url of CORE_ASSETS) await putFresh(cache,url);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("cantocards-")&&![CORE_CACHE,DATA_CACHE].includes(k)).map(k=>caches.delete(k)));
    await self.clients.claim();
    await broadcastStatus();
  })());
});

async function cacheStatus(){
  const core = await caches.open(CORE_CACHE);
  const data = await caches.open(DATA_CACHE);
  const essential = [
    `./index.html?v=${RELEASE}`,
    `./styles.css?v=${RELEASE}`,
    `./app.js?v=${RELEASE}`,
    `./data/cards.json?v=${RELEASE}`,
    `./data/startup.json?v=${RELEASE}`
  ];
  const coreChecks = await Promise.all(essential.map(u=>core.match(abs(u))));
  const optionalChecks = await Promise.all(OPTIONAL_ASSETS.map(u=>data.match(abs(u))));
  return {
    type:"OFFLINE_STATUS",
    release:RELEASE,
    coreReady:coreChecks.every(Boolean),
    optionalDone:optionalChecks.filter(Boolean).length,
    optionalTotal:OPTIONAL_ASSETS.length,
    running:!!optionalCachingPromise&&!optionalPauseRequested,
    lastError:optionalLastError
  };
}

async function broadcastStatus(){
  const status = await cacheStatus();
  const list = await self.clients.matchAll({type:"window",includeUncontrolled:true});
  for(const client of list) client.postMessage(status);
  return status;
}

async function cacheOptional(){
  if(optionalCachingPromise) return optionalCachingPromise;
  optionalPauseRequested = false;
  optionalLastError = "";
  optionalCachingPromise = (async()=>{
    const cache = await caches.open(DATA_CACHE);
    let consecutiveFailures = 0;
    for(const url of OPTIONAL_ASSETS){
      if(optionalPauseRequested) break;
      const req = new Request(abs(url));
      if(await cache.match(req)){
        consecutiveFailures = 0;
        await broadcastStatus();
        continue;
      }
      try{
        const res = await fetchWithTimeout(new Request(abs(url),{cache:"reload"}),12000);
        if(!res.ok) throw new Error(`HTTP ${res.status} · ${url}`);
        await cache.put(req,res);
        consecutiveFailures = 0;
        optionalLastError = "";
      }catch(err){
        optionalLastError = err?.message || String(err);
        consecutiveFailures++;
        // When the device goes offline, do not hammer all 33 URLs.
        if(consecutiveFailures>=2) break;
      }
      await broadcastStatus();
      // Intentionally gentle: don't compete aggressively with the card the user is viewing.
      await sleep(180);
    }
  })().finally(async()=>{
    optionalCachingPromise = null;
    await broadcastStatus();
  });
  return optionalCachingPromise;
}

self.addEventListener("message",event=>{
  const type = event.data?.type;
  if(type==="SKIP_WAITING"){
    event.waitUntil(self.skipWaiting());
    return;
  }
  if(type==="GET_OFFLINE_STATUS"){
    event.waitUntil((async()=>{
      const status = await cacheStatus();
      event.ports?.[0]?.postMessage(status);
    })());
    return;
  }
  if(type==="START_OPTIONAL_CACHE"){
    optionalPauseRequested = false;
    event.waitUntil(cacheOptional());
    return;
  }
  if(type==="PAUSE_OPTIONAL_CACHE"){
    optionalPauseRequested = true;
    event.waitUntil(broadcastStatus());
  }
});

function cacheNameFor(request){
  const u = new URL(request.url);
  if(u.pathname.includes("/data/examples/") || u.pathname.endsWith("/data/search_index.json")) return DATA_CACHE;
  return CORE_CACHE;
}

async function cacheFirst(request){
  const cache = await caches.open(cacheNameFor(request));
  const cached = await cache.match(request);
  if(cached) return cached;
  const response = await fetch(request);
  if(response.ok) await cache.put(request,response.clone());
  return response;
}

async function navigationResponse(request){
  const url = new URL(request.url);
  const isAppEntry = url.pathname===scopePath || url.pathname===`${scopePath}index.html`;
  const core = await caches.open(CORE_CACHE);
  if(isAppEntry){
    const cachedIndex = await core.match(INDEX_URL);
    if(cachedIndex) return cachedIndex;
  }
  try{
    const response = await fetch(request,{cache:"no-store"});
    if(response.ok) return response;
    throw new Error(`Navigation HTTP ${response.status}`);
  }catch{
    return (await core.match(INDEX_URL)) || Response.error();
  }
}

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;
  const url = new URL(event.request.url);
  if(url.origin!==self.location.origin) return;
  if(event.request.mode==="navigate"){
    event.respondWith(navigationResponse(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});
