import * as keytar from 'keytar';

const SERVICE_NAME = 'xgenia-editor';
const ACCOUNT_NAME = 'api-keys';

export class SecureStorageService {
  static async getApiKey(): Promise<string | null> {
    try {
      return await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    } catch (error: any) {
      console.error('Error retrieving API key:', error);
      return null;
    }
  }

  static async setApiKey(apiKey: string): Promise<void> {
    try {
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, apiKey);
    } catch (error: any) {
      console.error('Error storing API key:', error);
      throw error;
    }
  }

  static async deleteApiKey(): Promise<boolean> {
    try {
      return await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    } catch (error: any) {
      console.error('Error deleting API key:', error);
      return false;
    }
  }
} 