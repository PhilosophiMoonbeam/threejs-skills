<p align="center">
  <a href="assets/threejs-skills-for-agents.svg"><img src="assets/threejs-skills-for-agents.png" alt="Three.js Skills for Agents"></a>
</p>

# Three.js Skills for Agents

This repository provides one `threejs` skill for agents building, debugging, migrating, or optimizing Three.js applications. It covers scene setup, rendering, assets, interaction, shaders, post-processing, and teardown. Guidance is checked against official Three.js sources.

The skill targets npm `three@0.185.1` (revision 185), so prompts can request implementation guidance for that release.

## Capabilities

- Build WebGL and WebGPU scenes with cameras, transforms, resize handling, and render loops.
- Choose compatible geometry, materials, lighting, shadows, textures, render targets, and color management.
- Load GLTF/GLB and compressed assets, play animation, handle pointer interaction, and clean up owned resources.
- Write or review GLSL, TSL, node materials, and post-processing pipelines.
- Diagnose rendering, import, capability, color, readiness, lifecycle, and performance problems.
- Migrate older Three.js code to the pinned revision instead of mixing release conventions.

## Package

`skills/threejs` is the single package. Agents discover it through [`SKILL.md`](skills/threejs/SKILL.md), which routes matched tasks to the relevant guidance under `references/` as needed. Copying the complete directory preserves this progressive-disclosure structure.

## Installation

Clone the repository, then place the complete package in the directory where your agent discovers skills:

```bash
git clone https://github.com/PhilosophiMoonbeam/threejs-skills.git
AGENT_SKILLS_DIR=/absolute/path/to/agent/skills
mkdir -p "$AGENT_SKILLS_DIR"
cp -R threejs-skills/skills/threejs "$AGENT_SKILLS_DIR/threejs"
```

The installed package remains `$AGENT_SKILLS_DIR/threejs/`, with `SKILL.md` and `references/`. Replace that directory as a unit when updating an installation so removed or renamed references do not remain.

## Example prompts

> Create a responsive Three.js WebGL scene with an instanced mesh and deterministic teardown.

> Build a Three.js WebGPU scene with TSL compute, then provide an explicit path when WebGPU is unavailable.

> Load a Draco-compressed GLB, play one animation clip, and dispose of resources during teardown.

> Migrate this older post-processing pipeline to `three@0.185.1` and explain each required API change.

## Source and version policy

Target exactly `three@0.185.1` / revision 185 throughout. Use these public package exports: `three`, `three/webgpu`, `three/tsl`, and `three/addons/...`. Keep core, addon, CDN, decoder, and shader sources on revision 185. For exact APIs and revision-sensitive behavior, use:

- [Three.js documentation](https://threejs.org/docs/), [manual](https://threejs.org/manual/), and [LLM index](https://threejs.org/docs/llms.txt)
- [Revision 185 source tag](https://github.com/mrdoob/three.js/tree/r185) and [revision 185 package exports](https://github.com/mrdoob/three.js/blob/r185/package.json)
- [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)

The package follows the [Agent Skills specification](https://agentskills.io/specification). The repository identity artwork is available as the [SVG source](assets/threejs-skills-for-agents.svg).

## Validation

From the repository root, validate the package with the published reference validator:

```bash
uvx --from skills-ref agentskills validate ./skills/threejs
```

Maintainer checks live in `checks/`, outside the installed skill. With Node.js 22 or later:

```bash
npm ci
npm run check
npx playwright install chromium
npm run check:browser
git diff --check
```

The checks validate local links, routing, JavaScript syntax, and imports against the exact locked package; they also execute the documented cancellation, picking, and scheduling examples. Browser checks exercise renderer and canvas teardown, responsive sizing, PBR asset setup, explicit PMREM ownership, standalone raw KTX2 loading (not Basis transcoding), composer DPR, TSL material output, and compute readback on WebGL 2 fallback and WebGPU. WebGPU unavailability is reported as a skip; set `REQUIRE_WEBGPU=1` to require that backend. Headless software rendering checks correctness, not target-device performance.

Use the [behavior evaluation cases](checks/scenarios.md) to compare agent task scope, outcomes, and context use across skill revisions. Skill installation requires only `skills/threejs/`; maintainer dependencies and evaluation fixtures stay in this repository.

## Contributing

- Keep `skills/threejs/` as the only package and `SKILL.md` as its activation file.
- Put routing in `SKILL.md` and domain guidance in the owning references; keep references independent.
- Keep examples minimal, lifecycle-aware, revision-pinned, and grounded in official sources.
