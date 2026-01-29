// Browser shim for Node's `child_process`.
// Some dependencies (e.g. loaders.gl) have optional Node-only code paths that
// Vite may still statically include during build. This shim prevents Rollup
// from failing on `import { spawn } from "child_process"`.

export type SpawnOptions = Record<string, unknown>;

export function spawn(): never {
  throw new Error("child_process.spawn is not available in the browser");
}
