# Studio model choices

Reviewed 2026-10-29. The model API is an availability source, not the product menu.

`shared/modelChoices.ts` defines an editorial shortlist for three studio uses: everyday directing, complex scenes, and quick edits. Each role has ordered, exact identifier fallbacks. Intersect those candidates with the selected account's returned catalogue; show at most one per role and three total. Do not fabricate IDs, infer capabilities from a larger version number, or recommend an arbitrary fine-tune when none match. If there is no match, show an explicit empty state and retain Advanced models.

The descriptions are studio recommendations inferred from the provider families' positioning; they are not measured Scene Maker benchmark results or guarantees about speed, quality, price, quota, or structured-output support. The current implementation does not generate paid test replies. No new model is selected or saved merely by loading suggestions. Existing saved selections outside the shortlist remain selected and are identified as advanced choices.

The default UI uses friendly model names and task descriptions. The collapsed Advanced models panel provides exact identifiers, search, and filters for snapshots and fine-tunes. It shows at most 50 matching rows at a time; any identifier can be reached through search. Character overrides remain inside the separate advanced preferences section.

Provider references used for editorial choices:

- [OpenAI model guide](https://developers.openai.com/api/docs/models): Sol balances capability and cost, Astra serves demanding work, Luna serves focused tasks. Supported account-dependent fallbacks include [GPT-5 Mini](https://developers.openai.com/api/docs/models/gpt-5-mini), [GPT-5 Nano](https://developers.openai.com/api/docs/models/gpt-5-nano), and [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1).
- [Claude model overview](https://platform.claude.com/docs/en/models/overview): Sonnet, Opus, and Haiku families. Prefer the current reviewed family alias; retain explicit older identifiers only when returned by the account.
- [Gemini model guide](https://ai.google.dev/gemini-api/docs/models): Flash, Argon/Pro, and Flash-Lite; exclude specialized voice, image, and preview variants from suggestions.
- [xAI model guide](https://docs.x.ai/developers/models): Grok 4.7. Show one suggestion rather than inventing a three-tier offering.
- [Kimi model guide](https://platform.kimi.ai/docs/models): K3.1 Pro with account-dependent K3/K2.6 fallbacks. Retired K2.5 and Moonshot-v1 models are not suggested.
- OpenRouter intersects the same reviewed families with its authenticated text/structured-output catalogue and keeps the exact returned provider-qualified identifier.

Maintenance: review this explicit shortlist when providers change their supported lineup. Availability always comes from live discovery. Unknown new releases stay accessible in Advanced models until reviewed. Dependencies and existing credentials are unchanged.
