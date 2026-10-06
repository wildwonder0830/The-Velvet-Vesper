# Model output gate

Generated text is not automatically trusted.

Before a reply becomes a visible/canonical assistant message, Vesper can inspect it for:

- engine hard-rule violations
- forbidden identity terms
- narration of the user-controlled persona
- passive "your move"/waiting behavior
- obvious relationship continuity resets
- scene/location discontinuities
- knowledge leaks

Repairable problems trigger one controlled rewrite request that preserves the intended story beat while correcting the violation. Engine-level blocking violations are not silently accepted into canon.

The gate is deliberately separate from prompt construction. Prompting reduces mistakes; validation catches mistakes that still escape.
