// SidebarItem is an interface: re-exporting it as a VALUE makes webpack look for a runtime
// binding that does not exist and warn on every compile. `export type` erases it at build time.
export type { SidebarItem } from './sidebarmodel';
export { SidebarModel } from './sidebarmodel';
