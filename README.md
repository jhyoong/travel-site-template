# travel-site-template
Basic website template build

## Run

```
cp .env.example .env   # set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL
npm start              # http://127.0.0.1:3000
```

Open the page through the server, not as a file, so "Describe an event" can reach the backend.

## Describe an event

Type a rough note in the box at the top of the page. The page posts the note and the current plan to `POST /api/draft-event`. The server (`lib/draft.js`) lays the plan out day by day so the model can see the events before and after the slot, then returns either drafted event cards or up to three follow-up questions. A note that covers several times comes back as several cards. Answers go back with the original note until cards come out. Nothing is added to the plan until you press "Add to plan".

The plan itself still lives in the browser's local storage. The server keeps no state.

The backend talks to any OpenAI-compatible chat completions API and has no npm dependencies (Node 20.12 or newer). Settings (`.env`): `LLM_BASE_URL` (default `https://api.openai.com/v1`), `LLM_API_KEY` (leave empty for local servers that need none), `LLM_MODEL` (required), `LLM_RESPONSE_FORMAT` (`json_schema` by default; use `json_object` or `none` if your server rejects it), `LLM_TIMEOUT_MS`, `PORT`.

`npm test` runs the unit tests for the prompt building and response checks.
