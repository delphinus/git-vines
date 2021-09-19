import { Mutex } from "https://deno.land/x/semaphore@v1.1.0/mod.ts";

export class MutexMap<K, V> {
  private mutex = new Mutex();
  private map = new Map<K, V>();

  async get(k: K): Promise<V | undefined> {
    const release = await this.mutex.acquire();
    const v = this.map.get(k);
    release();
    return v;
  }

  async set(k: K, v: V): Promise<void> {
    const release = await this.mutex.acquire();
    this.map.set(k, v);
    release();
  }
}
