import { setFileSystem, setPlatform, setStorage } from '@xgenia/platform';
import { StorageNode } from '@xgenia/platform-node/src/storage-node';

import { FileSystemElectron } from './filesystem-electron';
import { PlatformElectron } from './platform-electron';

setPlatform(new PlatformElectron());
setFileSystem(new FileSystemElectron());
setStorage(new StorageNode());
