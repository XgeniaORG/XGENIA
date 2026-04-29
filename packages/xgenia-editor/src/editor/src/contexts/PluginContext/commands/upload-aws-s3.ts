import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { filesystem, platform } from '@xgenia/platform';
import * as path from 'path';
import * as fs from 'fs';

import { Environment, EnvironmentDataFormat } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { createEditorCompilation } from '@xgenia-utils/compilation/compilation.editor';
import { guid } from '@xgenia-utils/utils';

import { ToastLayer } from '../../../views/ToastLayer';

export type Command = {
  kind: 'upload-aws-s3';
  taskId: string;
  cloudService: EnvironmentDataFormat;
  s3: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    region: string;
    bucket: string;
    prefix: string;
  }
  messages: {
    progress: string;
    success: string;
    failure: string;
  }
  // Initial version to a more extendable system that can be used with these
  // kind of events.
  events: {
    complete: {
      kind: "fetch",
      resource: string,
      options: RequestInit
    }[]
  }
};

export async function execute(command: Command, event: MessageEvent) {
  const project = ProjectModel.instance;
  const taskId = command.taskId || guid();

  // Setup the build steps
  const compilation = createEditorCompilation(project).addProjectBuildScripts();

  // Create a temp folder
  const tempDir = platform.getTempPath() + '/upload-' + taskId;

  // Deploy to temp folder
  await compilation.deployToFolder(tempDir, {
    environment: command.cloudService ? new Environment(command.cloudService) : undefined
  });

  // Upload to S3
  try {
    await uploadDirectory(
      {
        localDir: tempDir,
        accessKeyId: command.s3.accessKeyId,
        secretAccessKey: command.s3.secretAccessKey,
        sessionToken: command.s3.sessionToken,
        region: command.s3.region,
        bucket: command.s3.bucket,
        prefix: command.s3.prefix
      },
      ({ progress, total }) => {
        ToastLayer.showProgress(command.messages.progress, (progress / total) * 100, taskId);
      }
    );

    ToastLayer.showSuccess(command.messages.success);
  } catch (error: any) {
    console.error(error);
    ToastLayer.showError(command.messages.failure);
  } finally {
    ToastLayer.hideProgress(taskId);
  }

  // Clean up the temp folder
  filesystem.removeDirRecursive(tempDir);

  // Notify that the process is done
  event.source.postMessage({
    kind: "upload-aws-s3",
    id: taskId,
    status: "complete",
  }, { targetOrigin: event.origin })

  // Execute complete event
  if (Array.isArray(command?.events?.complete)) {
    for (const event of command.events.complete) {
      if (event.kind === "fetch") {
        await fetch(event.resource, event.options);
      } else {
        console.error("invalid event type", event);
      }
    }
  }
}

/**
 * Gets all files from a directory recursively with their relative paths
 */
async function getFilesRecursively(dir: string, baseDir: string = dir): Promise<{ path: string, fullPath: string }[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  
  const files = await Promise.all(
    entries.map(async entry => {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      
      if (entry.isDirectory()) {
        return getFilesRecursively(fullPath, baseDir);
      } else {
        return [{ path: relativePath, fullPath }];
      }
    })
  );
  
  return files.flat();
}

/**
 * Gets Cache-Control header based on file type and name
 */
function getFileCacheControl(fullPath: string): string {
  const ext = path.extname(fullPath).toLowerCase();
  
  if (ext === '.html') {
    return 'no-cache';
  } else {
    const TIME_1 = 31536000; // 365 days
    const TIME_2 = 10800; // 3 hours for files with hash
    const fileName = path.basename(fullPath);
    const maxAge = /-[a-f0-9]{16}\./.test(fileName) ? TIME_1 : TIME_2;
    return `public, max-age=${maxAge}`;
  }
}

/**
 * Gets the appropriate MIME type for a file
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'font/otf',
    '.txt': 'text/plain',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Uploads a directory to S3 using AWS SDK v3
 */
async function uploadDirectory(
  options: {
    localDir: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    region: string;
    bucket: string;
    prefix: string;
  },
  progressCallback: (args: { progress: number; total: number }) => void
): Promise<void> {
  // Create S3 client
  const s3Client = new S3Client({
    region: options.region,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: options.sessionToken
    }
  });
  
  // Get all files to upload
  const files = await getFilesRecursively(options.localDir);
  const totalFiles = files.length;
  let uploadedFiles = 0;
  let totalSize = 0;
  let uploadedSize = 0;
  
  // Calculate total size for better progress monitoring
  for (const file of files) {
    const stats = await fs.promises.stat(file.fullPath);
    totalSize += stats.size;
  }
  
  // List existing objects to delete later if they're not in the upload
  const existingObjectsResponse = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: options.bucket,
      Prefix: options.prefix
    })
  );
  
  const existingObjectKeys = new Set(
    (existingObjectsResponse.Contents || []).map(obj => obj.Key)
  );
  
  const uploadedObjectKeys = new Set<string>();
  
  // Upload all files
  for (const file of files) {
    try {
      const fileContent = await fs.promises.readFile(file.fullPath);
      const s3Key = options.prefix 
        ? path.posix.join(options.prefix, file.path.split(path.sep).join(path.posix.sep)) 
        : file.path.split(path.sep).join(path.posix.sep);
      
      await s3Client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: s3Key,
          Body: fileContent,
          ContentType: getMimeType(file.path),
          CacheControl: getFileCacheControl(file.path)
        })
      );
      
      // Mark this key as uploaded
      uploadedObjectKeys.add(s3Key);
      
      // Update progress
      const stats = await fs.promises.stat(file.fullPath);
      uploadedSize += stats.size;
      uploadedFiles++;
      
      progressCallback({
        progress: uploadedSize,
        total: totalSize
      });
    } catch (error: any) {
      console.error(`Error uploading ${file.path}:`, error);
      throw error;
    }
  }
  
  // Delete objects that exist in S3 but are not in the upload
  if (options.prefix) {
    for (const key of existingObjectKeys) {
      if (!uploadedObjectKeys.has(key) && key.startsWith(options.prefix)) {
        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: options.bucket,
              Key: key
            })
          );
        } catch (error: any) {
          console.error(`Error deleting ${key}:`, error);
          // Continue with other files even if one delete fails
        }
      }
    }
  }
}
