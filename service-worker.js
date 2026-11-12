// Scope-aware app-shell cache. Never cache customer media or replace other HTML pages.
const PREFIX = 'wypha-v13.3.0';
const CACHE = PREFIX + '-portal-v19-0-0-preset-7-ebooks-20-themes-20261109-' + encodeURIComponent(self.registration.scope);
const SHELL = ['index.html','manifest.webmanifest','icon-192.png','icon-512.png'].map(p=>new URL(p,self.registration.scope).href);
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE&&k.endsWith(encodeURIComponent(self.registration.scope))).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url),root=new URL(self.registration.scope);
 if(url.origin!==root.origin)return;
 const isIndex=url.pathname===root.pathname||url.pathname===new URL('index.html',root).pathname;
 const key=isIndex?SHELL[0]:url.href;
 if(!isIndex&&!SHELL.includes(key))return;
 e.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(e.request);if(response.ok){await cache.put(key,response.clone());return response}return await cache.match(key)||response}catch(err){return await cache.match(key)||Response.error()}})());
});
