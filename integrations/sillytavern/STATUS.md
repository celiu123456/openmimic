# SillyTavern Integration Status

**Not tested with a real SillyTavern instance: no SillyTavern is installed on this machine.**

## What works (unit-tested)

- Export `.persona` → Character Card V2 JSON
- Export `.persona` → Character Card V2 PNG (placeholder image with embedded tEXt)
- Import Character Card V2 JSON → OpenMimic subject
- Import Character Card V2 PNG → OpenMimic subject
- Privacy filtering (private markers, synthesis_only withholding, no name hints)
- Real-person acknowledgment gate
- Round-trip fidelity via `extensions.openmimic`
- Injection detection on imported text
- Plugin route registration and teardown
- CLI conversion script (file-to-file)

## Items to verify with a real SillyTavern install

1. **PNG import**: confirm SillyTavern reads the tEXt chunk from our generated
   minimal 1x1 PNG (some builds may require a larger or better-formed image).
2. **mes_example format**: confirm the `<START>\n{{char}}: ...` format renders
   correctly in ST's example dialogue pane.
3. **system_prompt**: confirm ST uses the card's `system_prompt` field to
   override its own default system prompt (and that `{{original}}` placeholder
   is not needed when the card replaces it entirely).
4. **post_history_instructions**: confirm ST injects these after the chat
   history (some versions may call this "jailbreak" or "ujb").
5. **alternate_greetings**: we export an empty array; verify ST handles this
   gracefully (no empty option in the greeting picker).
6. **character_book**: we do not export a lorebook; verify ST does not
   error on a card without one.
7. **extensions preservation**: confirm ST does not strip `extensions.openmimic`
   when the user edits and re-exports the card.
8. **Large cards**: test with a subject that has 50+ claims and many episodes;
   check whether ST truncates the description or system_prompt.
9. **OpenAI-compatible endpoint**: confirm SillyTavern can connect to
   OpenMimic's `/v1/chat/completions` endpoint as a "Custom (OpenAI)" API,
   and that conversations retain fact-checking and privacy protection.
10. **first_mes**: confirm the first message appears correctly as the
    character's opening in a new chat.
