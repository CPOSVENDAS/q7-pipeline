/**
 * Service worker mínimo — só existe para o navegador considerar o site "instalável"
 * (ícone na tela do celular, abre sem barra de endereço) e dar uma sobrevida em
 * quedas de conexão. Ele NUNCA intercepta chamadas ao Supabase/Uazapi/Groq (são de
 * outro domínio) nem POST/PATCH/DELETE — só GET dentro do próprio site.
 *
 * Estratégia: tenta a rede primeiro (para nunca mostrar tela velha por engano);
 * se falhar (sem internet), usa o que estiver salvo em cache.
 */
const CACHE = "cpos-vendas-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // deixa passar direto: Supabase, fontes, etc.

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("/index.html"))),
  );
});
