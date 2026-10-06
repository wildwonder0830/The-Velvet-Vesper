# Velvet Vesper data schema — v1

Vesper treats every durable object as an independently addressable record with a permanent ID and explicit ownership.

## Core records

- `vault`: schemaVersion, appVersion, exportedAt, metadata.
- `persona`: user-controlled protagonist identity. Never implicitly shared between stories.
- `character`: model-controlled primary or supporting character definition.
- `story`: container binding one or more characters to one persona and story-level configuration.
- `chat`: a conversation inside exactly one story.
- `message`: belongs to exactly one chat and story.
- `loreEntry`: scope is explicit: global, persona, character, or story. Character lore cannot leak to another character.
- `memoryEntry`: scope and source are explicit. Canon, relationship memory, summaries, and transient scene state are separate.
- `milestone`: belongs to one story; records participants, evidence, source message, confidence, and verification state.
- `relationship`: belongs to one story and explicit participant IDs.
- `statDefinition`: editable trigger dictionary, weights, cooldown/dedupe policy.
- `statEvent`: append-only audit event explaining why a stat changed.
- `sceneState`: current location/time/emotion/presence for one chat.
- `knowledgeEntry`: who knows what, with explicit knower/subject/source IDs.

## Identity and isolation

IDs are opaque permanent strings. Display names are never keys.

Every story-owned record contains `storyId`. Every chat-owned record also contains `chatId`. Character/persona references use IDs only. Importers may preserve legacy IDs as `legacyId`, but Vesper assigns/validates canonical IDs.

No query may retrieve lore or memory solely by name, slot number, array position, or current UI selection.

## Relationship stats

Stats are deterministic bookkeeping, not free-form model guesses.

A stat definition contains:
- key and display name
- positive and negative keyword/phrase triggers
- contextual event patterns
- trigger weights
- per-message caps
- cooldown/deduplication rules
- optional participant filters

A stat event contains:
- id, storyId, relationshipId
- statKey, delta
- sourceMessageId
- matched triggers
- explanation
- createdAt

Reprocessing a message must be idempotent: the same stat rule/version/message combination cannot create the same event twice.

## Milestones

Keyword/event detection creates a milestone candidate, not automatically canon. Negation and hypothetical language must be checked. High-confidence deterministic events may auto-confirm only when configured. Otherwise contextual verification confirms/rejects the candidate.

## Secrets

Provider/API credentials are device-local configuration and are excluded from ordinary vault backups and repository source.

## Import transaction

1. Parse source.
2. Detect source schema.
3. Validate required structures.
4. Build migration plan without mutating the live Vesper vault.
5. Present counts/warnings.
6. Commit all migrated records atomically.
7. Preserve source backup unchanged.
