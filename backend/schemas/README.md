# schemas/

Request validation with **Zod** (when added: `npm install zod`).

## Why

AI-generated handlers often skip input validation. Schemas catch bad params before they hit services.

## Pattern

```javascript
// schemas/poll.js
import { z } from "zod";

export const PollVoteSchema = z.object({
  choice: z.enum(["home", "away", "draw"]),
});

export function parsePollVote(body) {
  return PollVoteSchema.parse(body);
}
```

Routes call `parse*` and return `400` on `ZodError`.
