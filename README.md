# Three.js 0.185.1 Skill for Claude Code

This repository provides one Claude Code skill for building, debugging, migrating, and optimizing Three.js 0.185.1 applications. The skill uses progressive disclosure: one activation file routes each task to only the relevant reference documents.

## Architecture

The repository contains one source package:

```text
skills/
└── threejs/
    ├── SKILL.md
    └── references/
        ├── core-rendering.md
        ├── geometry.md
        ├── materials.md
        ├── lighting-and-shadows.md
        ├── textures-and-render-targets.md
        ├── animation.md
        ├── asset-loading.md
        ├── interaction-and-controls.md
        ├── shaders-and-tsl.md
        ├── post-processing.md
        └── 0.185.1-migration.md
```

`SKILL.md` is the only activation file and the only internal index. The eleven Markdown files under `references/` are on-demand references, not independently activated skills. Each reference has one domain owner and does not link to another reference, so disclosure remains one hop from the index.

## Reference coverage

| Reference | Coverage |
| --- | --- |
| `core-rendering.md` | Scenes, cameras, renderers, scene graphs, transforms, resize handling, render loops, and disposal |
| `geometry.md` | Primitives, `BufferGeometry`, attributes, morph data, lines, points, and instancing |
| `materials.md` | Built-in and PBR materials, transparency, blending, and environment response |
| `lighting-and-shadows.md` | Lights, physically based intensity, shadows, image-based lighting, and helpers |
| `textures-and-render-targets.md` | Color and data textures, UV channels, HDR, PMREM, and render and depth targets |
| `animation.md` | Clips, tracks, mixers, actions, skeletal animation, and morph animation |
| `asset-loading.md` | Loading managers, asynchronous loading, GLTF and GLB, Draco, KTX2, other formats, and cleanup |
| `interaction-and-controls.md` | Raycasting, pointer coordinates, selection, controls, and event cleanup |
| `shaders-and-tsl.md` | `ShaderMaterial`, `RawShaderMaterial`, GLSL, TSL, nodes, and extension boundaries |
| `post-processing.md` | WebGL and WebGPU pipelines, passes, ordering, resizing, and output handling |
| `0.185.1-migration.md` | Removed or changed APIs, deprecated names, replacements, and revision upgrades |

## Installation

Clone the repository, then copy the complete source package into the project-local Claude Code skill directory:

```bash
git clone https://github.com/PhilosophiMoonbeam/threejs-skills.git
PROJECT=/absolute/path/to/project
mkdir -p "$PROJECT/.claude/skills"
cp -R threejs-skills/skills/threejs "$PROJECT/.claude/skills/threejs"
```

The installed package must retain this structure:

```text
$PROJECT/.claude/skills/threejs/SKILL.md
$PROJECT/.claude/skills/threejs/references/*.md
```

Run the copy command from a location where `$PROJECT/.claude/skills/threejs` does not already exist. To update an existing installation, replace that directory as a unit so removed or renamed references do not remain.

## Activation and routing

Claude Code discovers the single skill through the `threejs` metadata in `SKILL.md`. Requests involving Three.js scene setup, rendering, geometry, materials, lighting, textures, loading, animation, interaction, shaders, TSL, post-processing, migration, or performance can activate it.

After activation, the index classifies the task and directs the agent to the relevant reference or references. For example:

- A scene and resize request routes to core rendering.
- A GLB request routes to asset loading; animation playback also routes to animation.
- A pointer-selection request routes to interaction and controls.
- A custom WebGPU node effect routes to shaders and TSL.
- Code written for an earlier revision also routes to the 0.185.1 migration reference.

References supply domain detail only after routing. They do not compete for activation and do not form reference chains.

## Usage

Ask Claude Code for the result and constraints you need. Examples:

> Create a Three.js 0.185.1 WebGL scene with a responsive camera and a rotating instanced mesh.

> Load a Draco-compressed GLB, play one animation clip, and dispose of owned resources during teardown.

> Migrate this older Three.js post-processing pipeline to 0.185.1 and explain each required API change.

State the renderer when it matters (`WebGLRenderer` or `WebGPURenderer`) and identify the build environment, asset formats, color-data assumptions, and lifecycle constraints when known.

## Three.js 0.185.1 source policy

All guidance targets exactly Three.js 0.185.1. Addon imports use `three/addons/...`. Revision-sensitive statements must cite an adjacent official source:

- [Three.js documentation](https://threejs.org/docs/)
- [Three.js revision 185 tagged source](https://github.com/mrdoob/three.js/tree/r185)
- [Three.js migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)

Do not mix APIs from other revisions into examples. Use official API documentation for behavior, the revision 185 tag for exact exports or implementation details, and the migration guide for removals and replacements. Label any mentioned third-party integration as non-core.

## Validation

Validation requires [`uv`](https://docs.astral.sh/uv/getting-started/installation/). From the repository root, run the published `agentskills` validator ephemerally:

```bash
uvx --from skills-ref agentskills validate ./skills/threejs
```

## Contributing

Keep the package singular and progressively disclosed:

1. Edit `skills/threejs/SKILL.md` only for activation, cross-domain invariants, workflow, or routing.
2. Edit the owning file under `skills/threejs/references/` for domain guidance.
3. Keep `SKILL.md` as the sole internal index; do not add another activation file.
4. Give each topic one reference owner. Name another topic instead of duplicating its guidance.
5. Do not add links between references. Add or change routing in `SKILL.md`.
6. Target 0.185.1, use `three/addons/...` for addons, and cite revision-sensitive claims with an official source.
7. Keep examples minimal, complete, lifecycle-aware, and free of avoidable per-frame allocation.
8. Run the package validation command before submitting a change.
