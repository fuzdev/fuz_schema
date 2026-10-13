---
'@fuzdev/fuz_schema': patch
---

perf: a failing parse is faster: an issue's `path` is a new array at each level it is prefixed, where one array was added to in place, so a `message` function that keeps the `path` it is handed no longer sees the keys added after; a path of one key allocates less for it and a deeper one more
