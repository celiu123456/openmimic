# Comparison with Adjacent Approaches

This document positions OpenMimic relative to four neighboring approaches. The goal is to clarify what OpenMimic does and does not do, not to argue that any approach is inferior. Each approach optimizes for a different thing.

---

## 1. Self-Report-Trained Personal Replicas

**Representative projects:** Second-Me, Character.AI persona mode, custom GPTs trained on user journals.

**What they do:** Build a digital persona from the person's own data -- chat logs, journal entries, self-descriptions, questionnaire answers. The resulting agent speaks in the person's voice and reflects their self-reported personality.

**What OpenMimic does not do that they do:**
- OpenMimic does not fine-tune on the subject's own text and therefore does not reproduce their writing voice with the same fidelity. OpenMimic's speaking-style module relies on a small corpus of the subject's own words plus statistical heuristics (message length, sentence structure), which is a coarser approximation.
- OpenMimic does not work well as a self-reflection tool where the person wants to talk to "themselves." The persona it builds is a composite of how others see the person, not how the person sees themselves.

**What OpenMimic does that they do not:**
- Builds the persona from third-party testimony rather than self-report. The SOKA model (Vazire 2010) shows self and other knowledge are asymmetric: others are more accurate on highly evaluative and externally observable traits, while self-report is more accurate on low-observability internal states. Neither source is strictly better.
- Preserves disagreements between witnesses as a divergence map rather than producing a single coherent self-image.
- Supports the "room you're not in" mechanic (behind-the-scenes + door push), which requires testimony from multiple third parties about the same person -- data that self-report approaches do not have.
- Every personality trait can be traced to a specific witness and their exact words.

---

## 2. Memory Layers

**Representative projects:** Mem0, Zep, LangMem.

**What they do:** Store and retrieve facts, preferences, and interaction history associated with a user or agent. Some support user corrections and versioning. They serve as a persistence layer for conversational AI.

**What OpenMimic does not do that they do:**
- OpenMimic is not a general-purpose memory store for ongoing conversations. It does not learn from each interaction and update a running profile. It builds a persona from a discrete set of testimony submissions, then uses that persona for dialogue.
- OpenMimic does not offer the lightweight API integration that memory layers provide (typically a few lines to add memory to any chat application).

**What OpenMimic does that they do not:**
- Memory layers typically maintain a single consistent view of the user, resolving contradictions by overwriting or discarding older entries. OpenMimic preserves disagreements between sources as first-class objects (divergences).
- OpenMimic's data comes from multiple independent witnesses rather than from the user's own interactions, providing a different epistemic basis.
- Memory layers generally do not track provenance at the level of individual claims anchored to source text with conviction scores.

---

## 3. Crowd Simulation Frameworks

**Representative projects:** MiroFish (millions of prompt-defined agents), Generative Agents (Park et al. 2023, 25-agent sandbox), SocioVerse.

**What they do:** Simulate populations of agents interacting in a shared environment. Agent personalities are defined by prompt descriptions, demographic profiles, or brief backstories. The focus is on emergent social dynamics at scale.

**What OpenMimic does not do that they do:**
- OpenMimic does not scale to hundreds or thousands of agents. Each persona requires real human testimony -- currently, a set of 5--10 witnesses answering a structured questionnaire. Organization-level simulation (parallel organizations) is planned but not implemented.
- OpenMimic does not simulate emergent social dynamics, network effects, or information cascading across a population.
- OpenMimic does not generate agent personalities from demographic profiles or prompt descriptions. It cannot create a persona without testimony input.

**What OpenMimic does that they do not:**
- Each persona has an evidence chain: every trait traces to named witnesses and specific testimony. Crowd simulation agents typically have no provenance for their personality descriptions.
- Personas are grounded in what real people actually said, rather than in prompt-authored character descriptions. Whether this produces more "realistic" agents is an empirical question that has not been tested in a controlled comparison.

---

## 4. Character Cards / Roleplay Persona Formats

**Representative projects:** SillyTavern character cards (Character Card V2 spec), Pygmalion character sheets, Kobold character definitions.

**What they do:** Define a fictional or semi-fictional character in a structured or free-text format (personality description, example dialogues, scenario setup). The character is authored by a human writer and loaded into a chat application for roleplay.

**What OpenMimic does not do that they do:**
- OpenMimic does not support free-form character authoring. You cannot write a character description and import it as a persona (a converter from character cards to `.persona` format is planned but not built).
- OpenMimic does not optimize for creative writing, fictional worldbuilding, or entertainment-oriented roleplay. Its design assumes the persona represents a real (or historically real) person.
- The character card ecosystem has mature community infrastructure (sharing platforms, format standards, thousands of published characters). OpenMimic has no community distribution mechanism.

**What OpenMimic does that they do not:**
- Personas are derived from structured evidence rather than authored. A character card says "she is stubborn" because the author wrote it. An OpenMimic claim says "she is stubborn" because witness A (her colleague) said so in testimony entry T-47, witness B (her sister) disagreed and called it "persistence" (divergence D-12), and the conviction score is 0.65.
- The persona carries a court report (surviving/contested/retired claim counts, divergence map, episode count) that quantifies the evidence basis. Character cards have no equivalent metadata.

---

## Summary Table

| Dimension | Self-Report Replicas | Memory Layers | Crowd Simulations | Character Cards | OpenMimic |
|---|---|---|---|---|---|
| Data source | Person's own text | Interaction history | Prompt descriptions | Author's writing | Others' testimony |
| Provenance per trait | No | Partial | No | No (author's choice) | Yes (witness + testimony + episode) |
| Disagreement handling | N/A (single source) | Overwrite/discard | N/A (defined) | N/A (authored) | Divergence map |
| Scale | Single person | Single agent | Thousands+ | Single character | Single person / single room |
| Voice fidelity | High (trained on own text) | Medium | Low | Medium (authored examples) | Low (statistical heuristics) |
| Evidence for claims | No | Partial (source timestamps) | No | No | Yes (conviction score, testimony IDs) |
