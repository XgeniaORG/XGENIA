import { IStorage } from "./common";

export class StorageWeb implements IStorage {
  async get(key: string): Promise<any> {
    try {
      const item = localStorage.getItem(key);
      if (item === null) {
        return {}; // Return empty object if key doesn't exist
      }
      return JSON.parse(item);
    } catch (error: any) {
      console.error(`[StorageWeb] Error getting key "${key}":`, error);
      return {}; // Return empty object on error
    }
  }

  async set(key: string, data: { [key: string]: any }): Promise<void> {
    try {
      const serialized = JSON.stringify(data);
      localStorage.setItem(key, serialized);
    } catch (error: any) {
      console.error(`[StorageWeb] Error setting key "${key}":`, error);
      throw error; // Re-throw to let caller handle storage errors
    }
  }

  async remove(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch (error: any) {
      console.error(`[StorageWeb] Error removing key "${key}":`, error);
      throw error; // Re-throw to let caller handle storage errors
    }
  }
}
