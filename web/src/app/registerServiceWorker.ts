// Registers the service worker in production only, so it never interferes with
// the Vite dev server / HMR.

export function registerServiceWorker(): void {
    if (!import.meta.env.PROD) return;
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((error) => {
            console.warn("Service worker registration failed:", error);
        });
    });
}
