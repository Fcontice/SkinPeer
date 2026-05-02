# Update Dev Log

You are updating the SkinPeer project dev log at `DEV_LOG.md` in the project root. This log doubles as rubric evidence for the AI Development class final project — it must capture not just *what was built*, but *which AI tool built it*, *which prompts worked*, *which failed*, and *where the human overrode the AI*.

## Instructions

1. Review the current conversation to identify everything that was implemented, changed, or fixed in this session.

2. Append a new entry to `DEV_LOG.md` using **this exact format** (do not omit or reorder fields, even if a field is "n/a" — say so explicitly):

```
---
## [YYYY-MM-DD] — <one-line summary of session>

**Prompt:** <the user's original request that started this work, verbatim or closely paraphrased>

**AI tool used:** <Claude Code | ChatGPT | both | other — and the model variant if known, e.g. "Claude Code (Opus 4.7)">

**Implemented:**
- <bullet per major change, file modified, or feature added>

**Bugs / Errors Encountered:**
- <error message or description> → <how it was fixed>
- (n/a if clean session)

**Prompts that worked:**
- <one-sentence description of a prompt that produced what you wanted, with one-line "why">
- (n/a if no notable prompt this session)

**Prompts that failed:**
- <description of a prompt that misled the AI or produced wrong output, with one-line "why">
- (n/a if nothing failed)

**Human overrides:**
- <what the AI suggested vs. what you decided, and the reason — even small ones count>
- (n/a if no overrides)

**Notes:**
- <any important decisions, trade-offs, or things to revisit>
```

3. Use the current date and time (today is 2026-05-01).

4. Read the existing `DEV_LOG.md` first so you append — never overwrite.

5. Be specific: include file paths, error messages, and fix descriptions. The log is the primary evidence trail for the rubric — vague entries hurt the grade.

6. **Capture confirmations as well as corrections.** If the AI got something right on the first try and you accepted it, that's worth a single line under "Prompts that worked." Survivor-bias kills the log if you only record failures.

7. **Override entries should include "why."** "Used hand-rolled OpenID instead of passport-steam because dependency conflict" is useful. "Used different approach" is not.

## Trigger

Run automatically at the end of every session where code is written or modified, per the rule in `CLAUDE.md` ("Dev Log" section). Can also be invoked manually as `/update-dev-log` at any time.

## Why these fields exist

The rubric explicitly grades on (a) prompt quality with iterative refinement, (b) examples where AI helped vs. failed vs. was overridden, and (c) critical reflection. Capturing this per-session is far easier than reconstructing it weeks later. The "AI tool used" field also makes the orchestration story (multiple models, distinct roles) visible at a glance.
