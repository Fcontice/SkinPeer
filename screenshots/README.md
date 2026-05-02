# Screenshots

This folder contains the rubric-required visual record of how AI was used to build SkinPeer. Drop your captures into the matching subfolder; each section below explains what belongs where.

## Folder layout

```
screenshots/
├── prompts/         ← Screenshots of AI prompt interactions (Claude Code chats, ChatGPT conversations, etc.)
├── iterations/      ← Intermediate steps: drafts, refinements, AI mistakes you corrected
└── final-product/   ← Final UI screens of the running app
```

## What goes in each folder

### `prompts/`

The "show your work" for the rubric. Include:

- Screenshots of full prompts you wrote in Claude Code (especially the orchestration prompts in `docs/plans/`).
- Screenshots of ChatGPT conversations where you used GPT to grade or rewrite Claude's output.
- Plan-mode plan files visible in the terminal.
- Slash command definitions (e.g., `/update-dev-log`, `/document-prompts`) being invoked.

**Naming:** `YYYY-MM-DD-short-topic.png` (e.g., `2026-04-30-mvp-scaffold-prompt.png`).

### `iterations/`

Evidence that you didn't blindly accept AI output. Include:

- Before/after of a prompt you refined.
- A screenshot of a Claude response that was wrong, with your correction.
- The `passport-steam` failure → hand-rolled OpenID rewrite (the kind of "AI got it wrong, here's what we did instead" example).
- Edits you made to AI-generated code (highlighted diffs).
- The "is this trade safe?" → "no obvious red flags detected" prompt rewrite for the AI safety review feature.

**Naming:** `YYYY-MM-DD-short-topic-vN.png` where `vN` indicates the iteration number.

### `final-product/`

End-state UI screens showing the system works. Include at least one screenshot of:

- Login page (Steam button).
- Trader directory listing.
- A conversation with messages.
- A trade proposal with the verification code prominently displayed.
- The 6-step safety checklist mid-completion.
- The AI safety review result (success and failure cases).
- The admin moderation dashboard.
- Trust bar / scam warning banner visible on a proposal page.

**Naming:** `screen-<page-name>.png` (e.g., `screen-trade-proposal.png`).

## Why this folder exists

The rubric explicitly requires:

> A `/screenshots` folder containing AI prompt interactions, intermediate steps (optional but encouraged), and final product screens.

A grader who skims this folder should be able to answer:

1. **Did the student write thoughtful prompts?** (look at `prompts/`)
2. **Did the student iterate and override AI output?** (look at `iterations/`)
3. **Does the system actually work?** (look at `final-product/`)

If any of those answers is unclear from the captures, add more.
