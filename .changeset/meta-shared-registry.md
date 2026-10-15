---
'@fuzdev/fuz_schema': patch
---

fix: metadata is shared by every copy of `meta.ts`, so no copy drops what another attached

- `get_meta` reads metadata `meta` attached through any copy of the module: a second install, another version, a bundler's duplicate
- the registry is a `WeakMap` on `globalThis` under `Symbol.for('@fuzdev/fuz_schema/meta')`: a copy of 0.2.0 or earlier keeps one of its own, and shares nothing with the rest: upgrade every copy to share
- a bundle that never calls `meta` or `get_meta` still carries none of it
