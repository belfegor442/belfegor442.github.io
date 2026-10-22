// Shared callback registry used while main.js is split into domains:
// main.js registers router/session functions here at boot; extracted
// modules call them through hooks.name(...) instead of importing main
// (which would create an import cycle).
export const hooks = {};

export function setHooks(h) {
  Object.assign(hooks, h);
}
