import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

type IncomingFile = {
  name: string;
  uri: string;
};

type IncomingFilesPlugin = {
  list(): Promise<{ files: IncomingFile[] }>;
  clear(options: { names: string[] }): Promise<void>;
  addListener(eventName: 'incomingFiles', listener: () => void): Promise<PluginListenerHandle>;
};

const plugin = registerPlugin<IncomingFilesPlugin>('IncomingFiles');

const readPendingFiles = async (): Promise<{ files: File[]; names: string[] }> => {
  const pending = await plugin.list();
  const files: File[] = [];
  const names: string[] = [];

  for (const entry of pending.files) {
    const response = await fetch(Capacitor.convertFileSrc(entry.uri));
    if (!response.ok) continue;
    const blob = await response.blob();
    files.push(new File([blob], entry.name, { type: 'application/pdf' }));
    names.push(entry.name);
  }

  return { files, names };
};

export const listenForIncomingPdfs = (
  onFiles: (files: File[]) => Promise<void>,
  onError: (message: string) => void,
) => {
  if (!Capacitor.isNativePlatform()) return () => undefined;

  let listener: PluginListenerHandle | null = null;
  let stopped = false;
  let reading = false;

  const consume = async () => {
    if (reading || stopped) return;
    reading = true;
    try {
      const incoming = await readPendingFiles();
      if (incoming.files.length > 0) {
        await onFiles(incoming.files);
        await plugin.clear({ names: incoming.names });
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Не удалось принять PDF из другого приложения');
    } finally {
      reading = false;
    }
  };

  void plugin.addListener('incomingFiles', () => void consume()).then((handle) => {
    if (stopped) void handle.remove();
    else listener = handle;
  });
  void consume();

  return () => {
    stopped = true;
    if (listener) void listener.remove();
  };
};
