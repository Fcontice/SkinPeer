# Document Prompts

You are appending to `AI_PROMPTS.md` in the SkinPeer project root — a structured log of significant prompts used during development. This is rubric evidence under "Prompt Quality (25%)" and "Engineering Rigor in AI Usage (25%)" of the AI Development class final project.

## When to invoke

Run `/document-prompts` after a session (or part of a session) where the user wrote a prompt that produced a meaningful engineering outcome — not every prompt, only the ones with grading value. Good candidates:

- Long-form orchestration prompts (e.g., the docs/plans/*.md files).
- A prompt that produced a hard-won correct answer after iteration.
- A prompt that failed in an instructive way and shows how the human corrected.
- A prompt where you (the user) deliberately chose between two AI tools and the choice was informed.

Skip:

- Trivial prompts ("read this file", "fix this typo").
- Conversational asides.
- Prompts that the user already captured fully in `DEV_LOG.md`.

## Instructions

1. **Read `AI_PROMPTS.md` first.** If the file doesn't exist, create it with this header:

```markdown
# AI Prompts — SkinPeer

A structured log of significant prompts used to build SkinPeer, with outcomes and reflections. Maintained via `/document-prompts`. Companion to `DEV_LOG.md` (which logs *what was built*) and `AI_ENGINEERING.md` (which logs *the meta-analysis*).

---
```

2. **For each prompt to log, append an entry in this exact format**:

```markdown
## [YYYY-MM-DD HH:MM] — <short topic, e.g. "Steam OpenID refactor orchestration prompt">

**AI tool:** <Claude Code | ChatGPT | both | other; include model variant if known>

**Context:** <one sentence — what were we trying to achieve and what was the state of the codebase?>

**Prompt (verbatim or closely paraphrased):**
> <the prompt text, blockquote style; trim only if extremely long, and say so explicitly>

**What it produced:**
- <bullet per output artifact: file created, plan written, code generated, etc.>

**Iteration count:** <1 if accepted on first try; N if you had to refine. If iterated, briefly say what each refinement was.>

**Outcome:** <accepted | refined and accepted | discarded>

**Reflection:** <one or two sentences — why did this work, or why didn't it? Was the AI's first instinct right? Did you override?>
```

3. **Use today's date in `YYYY-MM-DD HH:MM` format.** Today is 2026-05-01 (update as needed).

4. **Be honest about iteration count.** If a prompt took 4 tries to produce something usable, say 4. Underreporting hurts the rubric grade because it undermines the "evidence of iterative refinement" criterion.

5. **Group related prompts under one entry when appropriate.** A back-and-forth conversation around a single task can be one entry with iteration count = N, not N entries.

6. **Never duplicate** — check whether the prompt has already been logged. If you're updating an existing entry (e.g., adding a follow-up reflection), edit it in place rather than appending a duplicate.

## Why this exists

The rubric explicitly grades on:

- **Prompt Quality (25%)** — clarity, structure, intentionality of prompts, evidence of iterative refinement.
- **Engineering Rigor in AI Usage (25%)** — depth of software engineering thinking embedded in prompts.
- **Critical Reflection (15%)** — honest evaluation of where AI helped, failed, was overridden.

`AI_PROMPTS.md` is the per-prompt evidence trail, complementing `AI_ENGINEERING.md`'s thematic synthesis. A grader who opens `AI_PROMPTS.md` should be able to flip through 5–15 entries and see *exactly how* prompts were constructed and refined over the project's life.

## What NOT to do

- Don't paraphrase a prompt to make it look better than the original. Verbatim or honestly-trimmed; nothing else.
- Don't fabricate iteration counts or pretend a one-shot success was a multi-step refinement.
- Don't log every prompt — quality over quantity. 5 well-documented prompts beat 50 shallow ones.
- Don't duplicate content from `DEV_LOG.md` — link to it instead. (DEV_LOG = what was built; AI_PROMPTS = how the building was prompted.)
