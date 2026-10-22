/* Offline shell. Bump VERSION on each deploy so phones pick up the new files. */
var VERSION='v7', SHELL='cl-shell-'+VERSION, RUNTIME='cl-runtime';
var FILES=['/','/index.html','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/favicon.svg'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(SHELL).then(function(c){return c.addAll(FILES)}).then(function(){return self.skipWaiting()}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k.indexOf('cl-shell-')===0&&k!==SHELL}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener('fetch',function(e){
  var r=e.request; if(r.method!=='GET')return; var u=new URL(r.url);
  if(u.pathname.indexOf('/api/')===0)return; /* API calls always go to the network */
  if(r.mode==='navigate'){
    e.respondWith(fetch(r).then(function(res){var cp=res.clone();caches.open(SHELL).then(function(c){c.put('/index.html',cp)});return res}).catch(function(){return caches.match('/index.html')}));return;
  }
  if(u.origin===location.origin||u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com'){
    e.respondWith(caches.match(r).then(function(hit){
      var net=fetch(r).then(function(res){if(res.ok){var cp=res.clone();caches.open(RUNTIME).then(function(c){c.put(r,cp)})}return res}).catch(function(){return hit});
      return hit||net;
    }));
  }
});
