# The Velvet Vesper

A private, mobile-first roleplay story engine.

## Status

Early foundation build — v1.0.0 architecture.

## Design principles

- Strict story, character, persona, lore, memory, milestone, relationship, and chat isolation by permanent IDs.
- Backward-compatible migration path from Noctis vault backups.
- Structured prompt assembly instead of accumulated prompt blobs.
- Deterministic bookkeeping for relationship stats and milestone candidates using editable weighted triggers.
- AI is used for storytelling and contextual verification, not basic bookkeeping.
- Local-only API credentials. Secrets are never committed to this repository or included in ordinary backups.
- Mobile-first interface designed for iPhone and iPad.
- Black, charcoal, oxblood, crimson, ruby, ivory visual language.
- No legacy phone or social-media simulator code.

## Migration

Existing Noctis backups are treated as migration sources. Import will validate and preview records before committing changes. New Vesper backups will use an explicit schema version.

## Safety of existing data

The existing Noctis application remains separate and untouched while Vesper is developed and tested.
