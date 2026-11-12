export * from "./models";
export * from "./git";
export * from "./actions";

export { setRequestGitAccount } from "./core/trampoline/trampoline-askpass-handler";

export {
  registerMergeHandler,
  mergeHandlers,
  readConflicts,
  readBlob,
  writeConflicts,
  settleConflict
} from "./merge-handlers";
export type { MergeHandler, MergeConflictItem, MergeContext } from "./merge-handlers";
