# Repository Agent Guide

## Start here

1. Inspect `git status` before editing. Preserve existing user work and unrelated changes.
2. Read `SKILL_spec.md` for the governing Agent Skills format.
3. Read `skills/threejs/SKILL.md` for the version contract, workflow, invariants, and routing table.
4. Read only the reference files that own the requested domains. Use `README.md` for public repository and installation context, not implementation policy.

## Repository invariants

- Maintain one skill package: `skills/threejs/`.
- Keep `skills/threejs/SKILL.md` as the only activation file and internal index.
- Preserve progressive disclosure. Every reference must remain one hop from `SKILL.md`.
- Give each topic one reference owner. Do not duplicate guidance across references.
- Do not add links from one reference file to another. Route cross-domain work through `SKILL.md`.
- Keep `SKILL.md` below 500 lines. Move domain detail to the owning reference.
- Update `README.md` only when public architecture, installation, routing, source policy, or validation changes.

## Three.js source contract

- Target exactly npm `three@0.185.1`, which reports revision `185`.
- Treat current online documentation and `https://threejs.org/docs/llms.txt` as conceptual when their examples target another release.
- Use the revision-185 tag and the `three@0.185.1` package exports for exact APIs, import paths, and implementation-sensitive claims.
- Use only public package boundaries: `three`, `three/webgpu`, `three/tsl`, and `three/addons/...`.
- Keep core, addons, CDN URLs, decoder assets, and copied shader chunks on one revision.
- Cite an adjacent official source for every revision-sensitive statement. Label third-party integrations as non-core.
- Route code from an unknown or different revision through `skills/threejs/references/0.185.1-migration.md` before adapting it.

## Editing rules

- Put activation wording, cross-domain invariants, workflow, and routing in `SKILL.md`.
- Put domain decisions, examples, edge cases, and lifecycle rules in the owning reference.
- Prefer correction or replacement over an additional competing convention.
- Keep prose terse, direct, and complete. Use Standard Technical English.
- Keep examples minimal but operational. State prerequisites and ownership when omitted context would make an example unsafe.
- Make setup and teardown symmetrical. Cover animation loops, observers, listeners, controls, workers, loaders, GPU resources, and DOM nodes as applicable.
- Avoid allocations, loading, compilation, listener registration, and unconditional work in frame loops.
- Separate WebGL and WebGPU behavior explicitly. Do not imply feature, material, shader, render-target, or post-processing parity.
- Assign color spaces, coordinate spaces, units, asynchronous readiness, and resource ownership explicitly when relevant.

## Version changes

A version bump is a repository-wide cutover, not a text substitution:

1. Verify the published package and its export surface.
2. Audit the migration guide and tagged source for behavioral changes.
3. Update metadata, headings, examples, CDN URLs, source policy, migration filename, links, and routing together.
4. Remove obsolete advice and compatibility aliases. Do not retain two version conventions.
5. Preserve historical revision labels and tagged source URLs when they identify real upstream history.

## Verification

Run from the repository root after documentation changes:

```bash
uvx --from skills-ref agentskills validate ./skills/threejs
npm ci
npm run check
git diff --check
```

For renderer, shader, TSL, post-processing, or sizing examples, also run `npx playwright install chromium` and `npm run check:browser`. Set `REQUIRE_WEBGPU=1` when native WebGPU coverage is required. Keep maintainer checks and behavior evaluations under `checks/`, outside the installed skill. Mark executable Markdown examples with stable `<!-- check: name -->` identifiers so checks exercise the documented code directly.

Also verify the affected surface:

- Every local Markdown link resolves.
- `SKILL.md` routes once to each reference, and references do not chain to other references.
- Markdown fences are balanced; examples parse.
- Documented imports and named exports exist in the exact target package.
- Revision-sensitive behavior matches the tagged source or an executable package-level check.
- No stale version, removed API, duplicate convention, conflict marker, or unexplained third-party API remains.

Do not commit or push unless the user requests it. When requested, commit only the intended files with a focused message, then confirm the branch is synchronized with its remote.
