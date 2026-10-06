# Prompt and canon precedence

Vesper assembles prompts from structured data. It does not maintain one ever-growing prompt blob.

Highest to lowest precedence:

1. Engine hard rules
2. Explicit OOC instruction for the current turn
3. Story safety/boundary configuration
4. User-controlled persona agency rules
5. Explicit story canon and retcons
6. Current scene state and participant presence
7. Character definitions and character-specific directives
8. Relationship state and confirmed milestones
9. Scoped story/persona/character lore
10. Consolidated story memory and summaries
11. Recent chat window
12. Style preferences

Lower layers cannot override higher layers.

## Context filtering

Lore carries explicit scope and may also carry context exclusions. A family/background entry can remain canon while being excluded from romantic, sensual, sexual, mate-bond, bathing, kissing, or other intimate contexts.

## Continuity

A missing fact is not permission to invent history. If Vesper lacks evidence for an event, the model should avoid claiming that event occurred.

## User agency

The model never supplies the user persona's dialogue, actions, thoughts, feelings, decisions, or reactions. Regeneration and continuation obey the same rule.
