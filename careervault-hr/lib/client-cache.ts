"use client";

type CacheEntry<T> = {
  data: T;
  updatedAt: number;
};

const clientCache = new Map<string, CacheEntry<unknown>>();

export function getCachedData<T>(key: string) {
  return clientCache.get(key)?.data as T | undefined;
}

export function setCachedData<T>(key: string, data: T) {
  clientCache.set(key, { data, updatedAt: Date.now() });
}

export function clearCachedData(prefix: string) {
  for (const key of clientCache.keys()) {
    if (key.startsWith(prefix)) {
      clientCache.delete(key);
    }
  }
}
