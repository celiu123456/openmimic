# OpenMimic + SillyTavern Integration

Two ways to use an OpenMimic persona in SillyTavern:

## Option A: Character Card (static export)

Export the persona as a Character Card V2 and import it into SillyTavern.
The card is a snapshot — it does not update when new testimony is added,
and **SillyTavern will not perform fact-checking or privacy protection**
on the model's output.

### Export via HTTP API

```bash
# JSON format
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/subjects/$SUBJECT_ID/export/character-card?format=json&acknowledgeRealPerson=true" \
  -o character.json

# PNG format (1x1 placeholder image with embedded card)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/subjects/$SUBJECT_ID/export/character-card?format=png&acknowledgeRealPerson=true" \
  -o character.png
```

### Export via CLI

```bash
# From a .persona package file
npx tsx scripts/convert-character-card.ts export persona.json -o card.json
npx tsx scripts/convert-character-card.ts export persona.json --png -o card.png
```

### Import into SillyTavern

1. Open SillyTavern.
2. Click the character import button (the upload icon).
3. Select the `.json` or `.png` file.
4. The character appears in your list with description, personality,
   example messages, and system prompt pre-filled.

### What the card contains

| Card field | OpenMimic source |
|---|---|
| `name` | Subject display name |
| `description` | Surviving claims (personality assertions backed by testimony) |
| `personality` | Audience-specific behavioral patterns from claims |
| `mes_example` | Subject's own words from the corpus (verbatim) |
| `system_prompt` | Identity disclaimer + speaking style + behavioral rules |
| `post_history_instructions` | Reminder that this is a simulation |
| `creator_notes` | Provenance (OpenMimic, witness count, export time, privacy warning) |
| `first_mes` | First corpus item or a default greeting |
| `extensions.openmimic` | Structured claims/episodes/corpus for lossless round-trip |

### What the card does NOT contain

- Original testimony text (only synthesized claims and authorized quotes)
- Witness real names or address terms (only relation labels: "发小", "前上司")
- Content a witness asked to keep secret (private markers filtered)
- `synthesis_only` witnesses' raw words (withheld before export)
- The subject's self-report

## Option B: OpenAI-compatible API (recommended)

Point SillyTavern at OpenMimic's built-in OpenAI-compatible endpoint.
This preserves all runtime protections:

- **Fact-checking**: the model only asserts what the testimony supports.
- **Privacy protection**: synthesis_only text is never exposed; private
  content stays private; crisis topics trigger safety responses.
- **Live updates**: new testimony and court sessions are reflected
  immediately without re-exporting.

### Setup

1. In SillyTavern, go to **API Connections**.
2. Select **Chat Completion** as the API type.
3. Select **Custom (OpenAI-compatible)** as the source.
4. Set the API URL to your OpenMimic server: `http://localhost:3000/v1`
5. Set the API key to your `OPENMIMIC_ADMIN_TOKEN`.
6. Under **model**, select any model (the proxy ignores this — it uses
   its own configured LLM).
7. Create a new character in SillyTavern with just a name.
8. In the system prompt, write: `subject_id: YOUR_SUBJECT_ID`
   (OpenMimic's `/v1/chat/completions` route reads this to select the
   persona). Or simply start chatting — the default subject is used.

### Differences between the two approaches

| | Character Card | OpenAI API |
|---|---|---|
| Fact-checking | None (static text) | Active (per-turn) |
| Privacy protection | Snapshot only | Live, per-request |
| Offline use | Yes | No |
| Updates | Manual re-export | Automatic |
| SillyTavern features | Full (lorebook, etc.) | Full |
| Model choice | SillyTavern decides | OpenMimic decides |

## Import a SillyTavern card into OpenMimic

```bash
# Via HTTP API
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @card.json \
  "http://localhost:3000/api/import/character-card"

# Via CLI (preview only, does not write to database)
npx tsx scripts/convert-character-card.ts import card.json
npx tsx scripts/convert-character-card.ts import card.png
```

Imported cards become a new subject with:
- Claims extracted from `description` and `personality` (conviction 0.5).
- Corpus items from `mes_example` character lines (source: `imported`).
- A synthetic court session (no real court ran).
- All text flagged for injection patterns (not rejected).
- **Nothing written to the testimony ledger** — character card content is
  author fiction, not witness evidence.

Cards exported by OpenMimic carry `extensions.openmimic` and import
losslessly (structured claims, episodes, and corpus are restored).
