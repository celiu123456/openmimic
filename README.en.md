# OpenMimic

> **Status: early development (v0.0.2). Feature-by-feature implementation status in [docs/claims-audit.md](docs/claims-audit.md).**

See yourself through the people who know you.

OpenMimic builds a digital persona from the testimony of the people around someone -- friends, family, colleagues -- rather than from the person's own self-description. It collects testimony, cross-examines claims across witnesses in a "court" pipeline, preserves disagreements instead of resolving them, and produces a persona whose every trait can be traced back to who said it and what words they used. It is a persona simulation engine, not the person.

## What you can do today

**The Room You're Not In** -- Send an invite link to 5--10 people who know you. Each spends a few minutes answering questions about you. Then open the room: their digital stand-ins are in there talking about you while you watch from outside. Press the button -- push the door open. The same people, different tone. What they say behind your back and what they say to your face, shown side by side for the first time. The behind-the-scenes room uses only material each witness explicitly authorized for display (see Ethics & Consent below). Leak protection is present (no-talk list generation, keyword + LLM verification, guided rewrite) but depends on model judgment and is not a guarantee.

**Rebuild anyone** -- You do not need the subject's participation to build their persona: your and your colleagues' testimony about your boss is the input. Talk to the version of yourself that your friends see, keep a composite of a deceased relative built from family testimony, or construct a historical figure from historical accounts. Historical figures have no self-report data; third-party testimony is all that exists.

**Rehearse conversations** -- Negotiate a raise with a digital boss and see where they push back. Walk through a proposal with a digital client. The persona speaks through an OpenAI-compatible endpoint, so any existing AI application can talk to it by pointing `BASE_URL` at the server and setting the model to `persona/<name>`.

**Biography output** -- Generate a short biography of the subject written from friends' testimony. Every quoted sentence is validated against the verbatim testimony of witnesses who authorized quoting; the subject can veto any section.

## Quick start

```bash
git clone https://github.com/celiu123456/openmimic.git
cd openmimic
npm install          # requires Node.js >= 22
npx tsx server/src/main.ts
# Open http://localhost:7860
```

No API key is needed to explore. An empty database auto-seeds a demo persona (Lin Mo, a fictional character with handwritten testimony data -- not engine output). You can walk through the room, push the door, and inspect the evidence chain.

To run the court, rooms, and persona dialogue, supply any OpenAI-compatible LLM in `.env`:

```env
LLM_BASE_URL=https://api.your-provider.com/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=your-model
```

Use a persona as a model from any OpenAI SDK client:

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:7860/v1", api_key="-")
resp = client.chat.completions.create(
    model="persona/limo",   # or persona/<your-subject-id>
    messages=[{"role": "user", "content": "How have you been?"}],
)
print(resp.choices[0].message.content)
```

Docker and systemd deployment are also documented: see [docs/DEPLOY-FOR-AI.md](docs/DEPLOY-FOR-AI.md). Note: the Dockerfile and docker-compose.yml exist in the repo but have not been tested on a live Docker host.

## How it works

```
  ┌──────────┐    ┌───────────────────────────┐    ┌──────────┐
  │ Witnesses │───>│ CourtEngine (4-stage)      │───>│ Persona  │
  │ submit    │    │ filing → pairing →         │    │ assembly │
  │ testimony │    │ relation judgment →         │    │ (system  │
  │ via invite│    │ conviction computation      │    │  prompt) │
  └──────────┘    │                             │    └────┬─────┘
       │          │ Divergences preserved       │         │
       │          │ Episodes = verbatim excerpts│         ├──> Room (behind + front)
       v          └───────────────────────────┘         ├──> OpenAI endpoint
  Append-only                                            ├──> MCP server
  testimony                                              ├──> Library import
  ledger (SQLite)                                        └──> .persona export
```

1. **Collect testimony.** Friends answer a structured questionnaire via an invite link. The WitnessEngine records each answer with the witness's relationship, stance, consent level, and verbatim text. The ledger is append-only (SQLite triggers block UPDATE/DELETE). An AI follow-up interview strategy is available (migrated from the author's earlier platform project), with intent classification, retreat detection, and quality gates.

2. **Run the court.** The CourtEngine processes testimony through a four-stage pipeline:
   - *Filing*: extract candidate claims and episodes (verbatim sub-strings of testimony) from each witness, with per-item lenient parsing.
   - *Pairing*: find semantically related claims across witnesses. Three implementations with fallback: LLM-based pair finding, embedding cosine similarity (threshold 0.55), keyword overlap (minimum 2).
   - *Relation judgment*: LLM classifies each pair as agreement, perspective_difference, factual_conflict, or unrelated. Perspective differences produce a divergence record preserving both viewpoints. Factual conflicts enter confrontation.
   - *Conviction computation*: a pure function (no LLM) computes a confidence score per claim (base 0.5, adjusted by witness count, episode anchoring, pairing status). Single-witness claims cap at 0.55; contested claims score 0.

3. **Assemble the persona.** Surviving claims, episodes, divergences, corpus items (the subject's own words, stored separately from testimony), and a self-report are assembled into a system prompt with quota-based per-section truncation (episodes 50%, claims 25%, corpus 10%, style 10%, self-report 5%). Behavioral discipline rules are appended (no diagnosis, no fabrication, stay within evidence, handle sensitive topics with care).

4. **Open the room / talk.** RoomEngine runs behind-the-scenes and face-to-face modes. Expression tiers (quote / paraphrase / extrapolate) control how closely each utterance tracks the source testimony. An OpenAI-compatible endpoint (`/v1/chat/completions`) and MCP server (stdio) allow any AI application to talk to the persona. The library entry point (`@openmimic/core`, `createOpenMimic()`) embeds in 30 lines without starting a server.

5. **Export.** A `.persona` package (v2) bundles surviving claims, episodes, divergences, corpus, a court report, and witness metadata (with consent filtering). Original testimony is not included. The package can be imported to create a new persona elsewhere.

## What makes it different

| | Data source | "Who said this?" | Disagreements | Behind / face-to-face | Scale |
|---|---|---|---|---|---|
| Self-trained replicas (e.g. Second-Me) | Person's own data | No | None (single source) | No | Single person |
| Memory layers (e.g. Mem0) | Interaction facts | Partially | Overwritten or discarded | No | Single agent |
| Crowd simulations (e.g. MiroFish) | Prompt-defined settings | No | None (defined) | No | Millions of defined agents |
| **OpenMimic** | **Others' testimony** | **Every claim** | **Preserved as divergence map** | **Yes** | **Single person / single room** |

Self-trained approaches work from the subject's own data, which does not contain what others say behind their back. OpenMimic does not do what crowd simulation frameworks do: it does not scale to millions of agents, and its personas require real human testimony rather than prompt-defined settings. Organization-level simulation (parallel organizations with multi-room cascading) is planned but not implemented.

## Ethics and consent

The following are enforced by code and tests:

- **Append-only ledger.** SQLite triggers block UPDATE/DELETE on the testimony table. The TypeScript API exposes no modification methods.
- **No anchor, no claim.** A claim's evidence list must be non-empty, and every ID must point to an existing testimony entry. `putClaim` throws `NoEvidenceError` otherwise.
- **Consent levels.** Each witness chooses at submission: *quotable* (verbatim text may appear in rooms and exports) or *synthesis_only* (raw text is replaced with `[withheld]` in any external-facing context).
- **AI products do not enter testimony.** Room transcripts are stored in a separate table and never feed back into the append-only testimony ledger.
- **Subject veto.** The subject can contest any claim about themselves. Contested claims are removed from the persona and marked with a persistent record (append-only plugin table). A claim can be reinstated (re-raised) only when at least 2 new witnesses independently provide supporting evidence, and only if the re-raise wording passes a tone gate.
- **Diagnostic/crisis word filtering.** Claims containing diagnostic or crisis terms (20+ patterns) are automatically retired from the persona. Room topics containing crisis words are rejected outright. Diagnostic words trigger guided rewrite or demotion to stage directions.
- **Collective silence.** When at least half of witnesses (and at least 3) skip the same question -- with at least one having answered a sibling question (raise-then-retreat evidence) -- a silence signal is recorded. The persona is instructed not to proactively raise that topic.
- **PII sanitization.** Phone numbers, email addresses, ID card numbers, bank card numbers, and credential patterns are stripped before storage (configurable).

The following is a stated design intent without technical enforcement:

- Building a persona of a living person is intended for private rehearsal. Public distribution of someone else's persona package requires their authorization. There is no code-level mechanism enforcing this.

**This is persona simulation, not the person.** Every persona prompt carries this disclaimer. The output reflects what witnesses reported, filtered through LLM processing. It is not ground truth.

## Evaluation

All evaluation data to date uses **Lin Mo**, a fictional demo character with **handwritten** testimony. Results validate the pipeline mechanics, not real-world fidelity.

**Calibration** (eval-ledger entry 7): The paired blind-evaluation judge prompt achieves 100% accuracy on 74 pairs (24 easy + 26 hard + 24 adversarial), with 0% position bias. Adversarial pairs share keywords but differ semantically. Judge model: deepseek-flash.

**Leave-One-Witness-Out (LOWO)** (entry 8): With one of 6 witnesses held out, the persona predicts the held-out witness's answers. Persona win rate: 87.5% (14/16 valid pairs, Wilson 95% CI [64.0%, 96.5%]). 2 pairs discarded due to position inconsistency. N=16 is small; the confidence interval is wide; this is a directional reading.

**Ablation** (entry 9): Three-arm comparison (full persona vs. baseline, vs. episodes-only, vs. claims-only). Full persona vs. no-persona baseline: 100% win rate (15/15 valid pairs, Wilson CI [79.6%, 100%]). Removing claims had smaller impact (53.3%) than removing episodes (64.3%), directionally suggesting episodes contribute more, but both CIs cross 50% and the result is not statistically conclusive. N=14--15.

**Stability** (entry 5): Running the court 3 times on the same testimony produces 67--73 surviving claims per run. Overlap rate (character bigram Jaccard >= 0.5, greedy matching): 46.9% mean across 3 pairs, SD 13.8%. This number reflects both court non-determinism and the strictness of the matching method (semantic rewording counts as non-overlap). N=3 pairs.

**Room leak protection** (entry 11): 4 behind-room runs (2 fixtures x 2 runs) produced 0 secret leaks across all utterances. No-talk list size varied between runs (2--6 items for the same fixture), confirming non-determinism in the LLM-generated list.

**Liveness** (activity): The liveness evaluation scaffold (13-signal rubric, calibration gate, scenario scripts, ablation harness) is built but **uncalibrated** -- no human-labeled real-person samples exist. The pipeline will not produce readings until calibration samples are provided and pass the accuracy gate (>80%, >=20 valid pairs, <=30% position bias).

**What is not measured:** Real-person fidelity (all data is fictional). Cross-model generalization (only deepseek-flash tested). Long-conversation coherence. Adversarial robustness of leak protection beyond the tested fixtures.

## Limitations

- **Demo data is handwritten fiction.** The built-in Lin Mo demo was written by hand, not produced by the engine from real testimony. Do not treat demo quality as representative of engine output.
- **Leak protection is not a guarantee.** The no-talk list, keyword scan, and LLM verification reduce but do not eliminate the risk of cross-witness secret disclosure. The list is regenerated each time and may vary. Partial-leak boundary (e.g. "changed cities" vs. "changed pace") depends on the model's judgment.
- **Prompt injection isolation reduces but does not eliminate risk.** User text is wrapped in delimited data blocks with guard instructions and scanned for injection patterns. This makes injection harder but not impossible.
- **AI reflux detection is pattern-based.** MinHash fingerprinting (3-char shingles, 128 dimensions) detects verbatim and near-verbatim recycling of AI output back into testimony. Paraphrased reflux below the threshold (Jaccard 0.5) will not be caught.
- **Small evaluation sample sizes.** All reported numbers have N <= 18 valid pairs, wide confidence intervals, and are directional readings on fictional data.
- **GraphEngine is not implemented.** There is no testimony graph or automatic re-computation when testimony changes. This is planned.
- **Organization-level simulation is not implemented.** Multi-room cascading and parallel organizations are planned.
- **Docker deployment is untested.** The Dockerfile and docker-compose.yml are provided but have not been run on a live Docker host.
- **Conviction scores are deterministic given court output, but court output is not deterministic.** Running the court twice on the same testimony produces different claim sets (overlap ~47% by character bigram matching).
- **Expression tier classification is post-hoc.** The tier (quote/paraphrase/extrapolate) is classified after generation, not enforced during generation. The model may produce output that does not match the intended tier.

## Architecture

```
            ┌────────────────────────────────────────────────┐
  Extend    │  Plugin layer (unified manifest)               │
  inward    │  Collectors: questionnaire / freetext / import │
  (community│  Scenarios: review meeting / custom scripts    │
   plugins) │  Bridges: webhook / external system sync       │
            ├────────────────────────────────────────────────┤
  Official  │  WitnessEngine · CourtEngine · RoomEngine      │
  engines   │  GateEngine · (GraphEngine: planned)           │
  (also     ├────────────────────────────────────────────────┤
   plugins) │  Microkernel                                   │
            │  Testimony ledger │ Persona assembly           │
            │  Plugin host      │ Consent gate               │
            ├────────────────────────────────────────────────┤
  Mount     │  OpenAI-compat endpoint │ MCP Server (stdio)   │
  outward   │  Library import (@openmimic/core)              │
  (embed)   │  .persona package (portable persona file)      │
            └────────────────────────────────────────────────┘
```

The kernel (`kernel/src/`) owns four things: testimony ledger, persona assembly, plugin host, consent gate. Everything else -- including the official engines -- is a standard `Plugin` object loaded through the same `PluginHost.load()` path as third-party code. There is no privileged backdoor; a third-party plugin providing a service named `court` replaces the official court engine.

Five plugin kinds: `engine` (processing pipelines), `collector` (evidence gathering), `scenario` (room topic presets), `bridge` (external system sync), `mount` (external surfaces like HTTP or MCP). Dependencies between plugins are resolved by topological sort; cycles raise `CyclicDependencyError`.

Three example plugins ship with the repo: `collector-freetext` (free-form text testimony), `scenario-review` (review meeting topic preset), `example-bridge` (court.finished -> webhook POST).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full directory layout, event flow, and security layer details.

## Security measures

- **Untrusted content isolation.** All user text (testimony, corpus, episodes, self-report) is wrapped in sanitized data blocks with delimiter neutralization before insertion into LLM prompts. A guard instruction appended to every prompt tells the model to treat delimited blocks as data, not instructions. `detectInjection()` scans for prompt injection patterns (instruction overrides, system impersonation, delimiter forgery) and flags suspicious testimony without rejecting it. A guard test scans all prompt-constructing source files to verify coverage.
- **AI reflux detection.** Room narratives and court claims are fingerprinted at generation time (3-char shingle MinHash, 128 dimensions). Incoming testimony is screened against registered fingerprints. Medium/high suspicion testimony is excluded from court filing. Paraphrased reflux below the Jaccard threshold (0.5) is not caught.
- **Provider error classification.** Nine error classes with automatic retry-after parsing. Non-retryable errors (402/quota, 401/auth) are not retried, preventing budget waste on permanent failures.

These measures reduce risk but do not eliminate it. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation details.

## Roadmap

- **GraphEngine**: testimony graph where personas are live derivatives of the graph -- changing one testimony triggers re-computation of related personas.
- **Parallel organizations**: multi-room cascading for organization-level simulation.
- **Plugin marketplace.**
- **Community persona package distribution.**
- **Blind derivation audit** (planned adaptation from Twig).
- **Full process evaluation metrics**: evidence coverage is implemented in CourtReport; contradiction response and memory repair metrics are not.
- **OpenClaw skill and dsh bundle** (planned integration shells).

## Extending

**Plugins.** Write a collector, scenario, bridge, or engine plugin. Plugins declare dependencies via `inject`, are topologically sorted, and can persist data in sandboxed SQLite tables. See [docs/PLUGIN-GUIDE.md](docs/PLUGIN-GUIDE.md).

**OpenAI-compatible endpoint.** Point any OpenAI SDK client at `http://localhost:7860/v1` with model `persona/<name>`. Supports streaming. See [docs/DEPLOY-FOR-AI.md](docs/DEPLOY-FOR-AI.md).

**MCP server.** JSON-RPC 2.0 over stdio. Configure your MCP host to run `npx tsx server/src/mcp/main.ts`. See [integrations/mcp/README.md](integrations/mcp/README.md).

**Library embedding.** `@openmimic/core` exports `createOpenMimic()` -- no HTTP server, no port. See [examples/embed-as-library/](examples/embed-as-library/) for a 30-line example.

**Configuration.** Three layers merged in order: `openmimic.yml` (defaults) -> `openmimic.local.yml` (gitignored overrides) -> `OPENMIMIC_CONFIG` env var. Any plugin can be disabled with `enabled: false`.

## Related work and acknowledgements

### Implemented adaptations

- **Conviction scoring**, the `contested` status name, and the **crisis-word circuit breaker** concept are adapted from [Twig](https://github.com/qimingjiu/twig-memory) (MIT). This project extends Twig's approach from "a single AI's longitudinal understanding audit of one person" to "cross-examination across multiple witness sources." The code is an independent implementation; see Twig's [ATTRIBUTION.md](https://github.com/qimingjiu/twig-memory/blob/main/ATTRIBUTION.md) for scope and comparison.
- The **contested veto flow**, **claim permission wall** (diagnostic/crisis term filtering), and **counter-evidence search** (embedding + keyword pair finding) draw on mechanisms described in the Twig design document, adapted to the multi-witness setting.
- The **DEPLOY-FOR-AI** onboarding format is modeled after Twig's.

### Planned adaptations (not yet implemented)

- **Blind derivation audit** is described in Twig's design document and planned for OpenMimic but has no code.
- **Process evaluation metrics**: evidence coverage is implemented in CourtReport; contradiction response count is available as a proxy; memory repair has no corresponding implementation.

### Reference projects

- Multi-agent debate fusion engineering: [BettaFish](https://github.com/666ghj/BettaFish) ForumEngine.
- Organization-level crowd simulation (positional reference for planned parallel organizations): [MiroFish](https://github.com/666ghj/MiroFish).

### Academic references

See [docs/REFERENCES.md](docs/REFERENCES.md) for the full list with verification status. Key references:

- Vazire (2010), SOKA model: self-other knowledge is asymmetric, not "other-knowledge is superior." JPSP 98(2).
- Connelly & Ones (2010): observer reports have incremental predictive validity; aggregating multiple observers improves accuracy. Psychological Bulletin.
- Robbins & Karan (2019): 74.3% of everyday gossip is neutral information exchange. SPPS / EAR study, N=467. (Room content distribution calibration source.)
- Goffman (1959): front-stage / back-stage self-presentation. (Direct theoretical source for the room + door-push mechanic.)
- Huang & Hadfi (2025): multi-observer agents for personality assessment; aggregating 5--7 observers yields optimal reliability. Findings of EMNLP 2025, arXiv 2504.08399. (Closest neighbor work; assesses LLM personality with observer agents -- OpenMimic uses real human observers to build a real person's persona.)
- Park et al. (2024/2026): 1,052-person generative agent study. Self-report-grounded agents reach 83--86% normalized accuracy. arXiv 2411.10109.
- Peng, Toubia et al. (2025): digital twins built from 500+ self-report items correlate only r=0.20 with real answers. arXiv 2509.19088.

This project has no affiliation with any of the referenced projects or authors.

## Further reading

- [docs/en/CONCEPTS.md](docs/en/CONCEPTS.md) -- Core concepts (testimony ledger, episode, situated claim, divergence, expression tiers, no-talk list, meta-perception, reflux, consent levels, disclosure levels, corpus).
- [docs/en/FAQ.md](docs/en/FAQ.md) -- 15 questions including "Isn't this a gossip engine?", "How accurate is it?", "Can I build a persona without their consent?"
- [docs/en/COMPARISON.md](docs/en/COMPARISON.md) -- Positioning relative to self-report replicas, memory layers, crowd simulations, and character cards.
- [docs/REFERENCES.md](docs/REFERENCES.md) -- Academic reference list with per-entry verification status.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) -- Full architecture, plugin protocol, security layer, directory layout.
- [docs/PLUGIN-GUIDE.md](docs/PLUGIN-GUIDE.md) -- Writing plugins (collectors, scenarios, bridges, engines, mounts) with examples.
- [docs/DEPLOY-FOR-AI.md](docs/DEPLOY-FOR-AI.md) -- Self-hosted setup guide (designed to be handed to an AI agent).
- [docs/eval-ledger.md](docs/eval-ledger.md) -- Evaluation ledger with protocol declarations, run records, and readings.
- [docs/claims-audit.md](docs/claims-audit.md) -- Every functional claim in the README mapped to code, with implementation status.

## License

[Apache-2.0](LICENSE)
