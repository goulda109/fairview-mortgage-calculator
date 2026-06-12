// Fairview Mortgage Calculator — service worker
// Cache-first for static assets, network-first with cache fallback for everything else.
const VERSION = 'fairview-v12';
const CORE = [
    '/',
    '/index.html',
    '/lib/calc-engine.js',
    '/lib/jspdf.umd.min.js',
    '/lib/jspdf.plugin.autotable.min.js',
    '/manifest.json',
    '/logo.webp',
    '/worker.js',
    '/resources/KYC.pdf',
    '/resources/Credit_Consent_Form.pdf',
    '/resources/Suitability_Form.pdf',
    '/resources/Material_Risks_Form.pdf',
    '/resources/NB_Compliance_Checklist_Form.pdf',
    '/resources/UNI_Suitability.pdf',
    '/resources/Mortgage_protection_doc.pdf'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    if (url.origin !== self.location.origin) return;

    const fetchAndCache = () => fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return resp;
    });

    // Network-first for the app shell so clients get new tabs/fixes on their next visit;
    // cache-first for static assets (libs, PDFs, images) which only change with a VERSION bump.
    const isShell = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
    if (isShell) {
        e.respondWith(fetchAndCache().catch(() => caches.match(e.request)));
        return;
    }

    e.respondWith(
        caches.match(e.request).then(cached => cached || fetchAndCache().catch(() => cached))
    );
});
