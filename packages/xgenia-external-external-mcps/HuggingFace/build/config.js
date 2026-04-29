import dotenv from 'dotenv';
import path from 'path';
// Load .env file from the current working directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
export function getConfig() {
    // Also try checking for HUGGING_FACE_HUB_TOKEN which is common in Python ecosystem
    const token = process.env.HF_ACCESS_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN;
    // We don't throw immediately if token is missing, but tools might fail
    if (!token) {
        console.warn('Warning: HF_ACCESS_TOKEN or HUGGING_FACE_HUB_TOKEN not found in environment variables. Some tools may fail.');
    }
    return {
        accessToken: token
    };
}
