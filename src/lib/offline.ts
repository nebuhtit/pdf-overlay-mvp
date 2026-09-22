export async function checkOfflineReady(): Promise<boolean> {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !('MessageChannel' in window)) return false;

  try {
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      updateViaCache: 'none',
    });
    if (navigator.onLine) void registration.update().catch(() => undefined);

    const controller = navigator.serviceWorker.controller;
    if (!controller || !registration.active) return false;

    return await new Promise<boolean>((resolve) => {
      const channel = new MessageChannel();
      const finish = (ready: boolean) => {
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve(ready);
      };
      const timeout = window.setTimeout(() => finish(false), 8000);
      channel.port1.onmessage = (event: MessageEvent<{ ready?: boolean }>) => finish(event.data?.ready === true);
      controller.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
    });
  } catch {
    return false;
  }
}
