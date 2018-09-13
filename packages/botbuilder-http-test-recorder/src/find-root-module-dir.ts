import { dirname } from 'path';

export function findRootModuleDir() {
  let m = module;
  let p: NodeModule;
  while (m) {
    if (m.parent) {
      p = m.parent;
    }
    m = m.parent;
  }

  return dirname(p.filename);
}
