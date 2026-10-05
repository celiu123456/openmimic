# Frequently Asked Questions

### Isn't this just a gossip engine?

It collects what people say about someone, so the comparison is fair. Two design choices separate it from unconstrained gossip: (1) every claim is anchored to testimony with a named source and relationship -- nothing floats anonymously; (2) the subject can see everything, contest any claim, and have it removed from the persona. The room content distribution is calibrated against Robbins & Karan (2019), which found that 74.3% of everyday gossip is neutral information exchange. The behind-the-scenes room targets roughly 75% neutral, 15% mild negative, 10% positive -- not scandal.

That said, the system generates speech *about* someone using other people's words. Whether that is appropriate depends entirely on the consent and context of use.

### Can I build a persona of someone without their consent?

Technically, yes. The engine does not require the subject to participate or approve. You can collect testimony from witnesses and build a persona without the subject knowing. This is a stated design intent limitation: public distribution of someone else's persona package is intended to require their authorization, but there is no code-level enforcement of this. The system is designed for private rehearsal scenarios (e.g. practicing a conversation with a digital version of your boss). Using it to create public-facing representations of people without their knowledge is outside the intended use.

### How do you stop it from making things up?

Several mechanisms, each with known limits:

- **Evidence anchoring.** Every claim must point to at least one testimony entry. The store rejects claims with empty or invalid evidence references (NoEvidenceError). This prevents claims from appearing without a source, but does not prevent the LLM from misinterpreting testimony during extraction.
- **Episode verbatim constraint.** Episodes must be sub-strings of the original testimony. The court filing stage extracts them with this constraint, though the LLM may occasionally produce episodes that are close but not exact matches.
- **Persona discipline rules.** The system prompt instructs the persona to say "I don't remember" rather than fabricate details not in the evidence, and to not combine details from different witnesses' accounts. This relies on the model following instructions.
- **Expression tier classification.** Each room utterance is classified post-generation as quote, paraphrase, or extrapolate, indicating how far it strays from source material.
- **Reflux detection.** MinHash fingerprinting catches cases where AI-generated output gets submitted as testimony. Paraphrased reflux below the Jaccard threshold (0.5) is not caught.

None of these is a hard guarantee. The persona is a simulation, and the model can and does generate content beyond what the evidence strictly supports.

### What happens to my friends' answers?

Testimony is stored in a local SQLite database on the server. The append-only ledger prevents modification or deletion of submitted testimony. Each witness chooses at submission time whether their words can be quoted verbatim (`quotable`) or only used for synthesis (`synthesis_only`, in which case their raw text is replaced with `[withheld]` in any display or export context). Exported `.persona` packages do not include original testimony -- they contain derived claims, episodes, divergences, corpus items, and a court report. There is no cloud service; everything runs on whichever machine the operator deploys to.

### Why not just fine-tune on my own chat logs?

Two reasons:

1. **Different data, different signal.** Your own chat logs contain your self-presentation. They do not contain what your colleagues say about you when you are not in the room, how your mother describes you to her friends, or which topics all your friends avoid when talking about you. The SOKA model (Vazire 2010) shows that self-knowledge and other-knowledge are *asymmetric* -- each captures different aspects of personality, with others being more accurate on highly evaluative and externally observable traits.

2. **No evidence chain.** A fine-tuned model cannot answer "who said I'm impulsive, and what was their exact example?" OpenMimic can, because every trait is anchored to specific testimony.

That said, fine-tuning captures the subject's own voice far better than a prompt-based approach. OpenMimic's speaking-style module is based on a small corpus of the subject's own words and rule-based statistical analysis (message length, single-sentence rate) -- it does not approach the fidelity of fine-tuning for voice reproduction.

### How accurate is it?

On the fictional demo character (Lin Mo, handwritten data), the persona wins 87.5% of leave-one-witness-out prediction pairs against a no-persona baseline (Wilson 95% CI [64.0%, 96.5%], N=16 valid pairs). This is a directional reading on fabricated test data, not a measure of real-world accuracy. No real-person evaluation has been conducted. The liveness evaluation scaffold exists but is uncalibrated (no human-labeled real-person samples).

For comparison, Park et al. (2024/2026) report 83--86% normalized accuracy for self-report-grounded LLM agents on 1,052 real people. OpenMimic's numbers are not comparable to theirs: different data (fictional vs. real), different evaluation protocol, and different input type (third-party testimony vs. self-report). The comparison is noted for context, not equivalence.

### Does it work with local models?

Yes. The LLM interface accepts any OpenAI-compatible API endpoint. Set `LLM_BASE_URL` to your local server (e.g. Ollama at `http://localhost:11434/v1`). The court, room, and interview stages all go through the same configurable LLM client. Quality will depend on the model's instruction-following and JSON output capabilities -- the court filing stage requires structured JSON output, and weaker models may produce more parsing failures.

### What models have been tested?

All published evaluation runs used deepseek-flash. The engine's `OpenAICompatClient` auto-detects DeepSeek models and disables the thinking parameter. Other OpenAI-compatible models should work but have not been evaluated. There are no model-specific dependencies in the codebase.

### Can I use this for therapy or mental health assessment?

No. The claim permission wall automatically retires claims containing diagnostic or crisis terms. Room topics with crisis words are rejected. The system is a persona simulation tool, not a clinical instrument. It should not be used to diagnose, assess, or treat mental health conditions.

### What is the "court"? Is it adversarial AI agents arguing?

The name is a metaphor. The court is a four-stage LLM processing pipeline (filing, pairing, relation judgment, conviction computation). It is not a multi-agent debate system with independent agent processes. "Filing" sends each witness's testimony through one LLM call to extract claims and episodes. "Pairing" finds related claims across witnesses. "Relation judgment" uses one LLM call per pair to classify the relationship. "Conviction computation" is a pure function with no LLM involvement. The metaphor of adversarial cross-examination describes the function (testing claims against counter-evidence), not the implementation architecture.

### How stable are the results?

Running the court three times on the same testimony produces 67--73 surviving claims per run, with an overlap rate of 46.9% (character bigram Jaccard >= 0.5, greedy matching, N=3 pairs, SD 13.8%). This number is affected both by the court's non-determinism (different LLM outputs on each run) and the strictness of the matching method (semantic rewordings count as non-overlap). The two factors have not been separated. This was measured on the fictional demo character.

### What is a `.persona` package?

A portable file (version 2) containing surviving claims, episodes, divergences, corpus items, a court report, and witness metadata (relationship, stance, consent level). Original testimony is *not* included. The package can be imported on another OpenMimic instance to create a persona without re-running the court. Consent filtering is applied during export: `synthesis_only` witness content is excluded.

### How is this different from character cards (e.g. SillyTavern)?

Character cards describe a fictional character in a free-text format. OpenMimic personas are built from structured testimony with evidence chains, conviction scores, and divergence maps. A character card is an author's description; an OpenMimic persona is a multi-source composite where every trait is traceable. A bidirectional converter between `.persona` packages and character cards is planned but not implemented.

### Does the "push the door" mechanic actually work?

Yes. The RoomEngine runs in two modes: behind (witnesses discuss the subject without the subject present) and front (subject enters; witness tone shifts). The tone difference is driven by different system prompts and claim filtering rules -- the front room suppresses `doNotRaiseToSubject` claims and shifts expression tiers. The mechanic is implemented and can be run with any LLM. Whether the tone shift is convincing depends on the model and the testimony quality.

### How many witnesses do I need?

The system imposes no hard minimum, but the court produces more useful output with more input. The demo character (Lin Mo) uses 6 witnesses. The invite flow suggests 5--10. Academically, Huang & Hadfi (2025, EMNLP Findings) found that aggregating 5--7 observers yields optimal reliability for personality assessment. With fewer than 3 witnesses, many claims will be single-source (capped at conviction 0.55), and there will be few pairings or divergences.

### Can the persona say something a witness did not actually say?

Yes. Utterances classified as "extrapolate" are plausible speech not directly anchored to specific testimony. The persona assembly includes behavioral discipline rules ("say you don't remember rather than fabricate"), but the model may still generate content beyond the evidence. Expression tier classification after generation tells you how much of the room output is extrapolation vs. direct testimony anchoring, but it does not prevent extrapolation from happening.

### What data does the `.persona` export contain?

The export includes: surviving claims (with conviction scores and evidence IDs), episodes (verbatim testimony excerpts), divergences (preserved disagreements), corpus items (subject's own words), a court report (claim counts, divergence map), and witness metadata (relationship, stance, consent level). It does **not** include original testimony text. For `synthesis_only` witnesses, no raw text is included. The format is JSON-based and backward-compatible with version 1 packages.
