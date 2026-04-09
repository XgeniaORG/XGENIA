import { setFileSystem, setPlatform, setStorage } from "@xgenia/platform";
import { FileSystemNode } from "./filesystem-node";
import { PlatformNode } from "./platform-node";
import { StorageNode } from "./storage-node";

setPlatform(new PlatformNode());
setFileSystem(new FileSystemNode());
setStorage(new StorageNode());
