# services/

Business logic lives here — **not** in route handlers or `worker.js`.

## Examples to migrate from worker.js

| Service file | Absorbs from worker.js |
|--------------|------------------------|
| `memes-home.js` | `fetchHomeViralMemes`, `classifyHomeMeme`, recheck pending |
| `memes-match.js` | `proxyMatchMemesApi`, scoring |
| `replay.js` | Vortex highlight search, embed proxy orchestration |
| `streams-vip.js` | VIP resolve/heal (keep HTML in adapters) |
| `poll.js` | Poll read/write via edge cache |

## Pattern

```javascript
// services/memes-home.js
import { homeMemeLikesThreshold } from "../../lib/meme-threshold.js";
import { loadMemeSources } from "../adapters/assets.js";

export async function listHomeMemes(env, origin, options) {
  const config = await loadMemeSources(env, origin);
  // ... orchestrate adapters, return plain data
}
```

Services return **plain data** or domain objects. Routes wrap them in `jsonResponse()`.
