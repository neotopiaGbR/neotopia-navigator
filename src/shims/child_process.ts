// Browser shim for Node's `child_process`.
// Some dependencies (e.g. loaders.gl) have optional Node-only code paths that
// Vite may still statically include during build. This shim prevents Rollup
// from failing on `import { spawn } from "child_process"` or default imports.

export type SpawnOptions = Record<string, unknown>;

export function spawn(): never {
  throw new Error("child_process.spawn is not available in the browser");
}

export function exec(): never {
  throw new Error("child_process.exec is not available in the browser");
}

export function execSync(): never {
  throw new Error("child_process.execSync is not available in the browser");
}

export function fork(): never {
  throw new Error("child_process.fork is not available in the browser");
}

// Default export for `import ChildProcess from 'child_process'`
const ChildProcess = {
  spawn,
  exec,
  execSync,
  fork,
};

export default ChildProcess;
