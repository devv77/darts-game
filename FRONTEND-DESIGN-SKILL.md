# Frontend Design Skill

## What is it?

An Anthropic skill that makes Claude generate **distinctive, production-grade frontend interfaces** that avoid generic "AI slop" aesthetics. It's automatically activated when you ask Claude to build web components, pages, or applications.

## How to use it

Just describe what you want to build. Claude will automatically apply the skill for any frontend work:

```
"Create a dashboard for a music streaming app"
"Build a landing page for an AI security startup"
"Design a settings panel with dark mode"
"Redesign the scoreboard component with a modern look"
```

No special syntax needed — Claude detects frontend tasks and applies the skill automatically.

## What it does differently

Instead of generic, cookie-cutter UI, Claude will:

- **Pick a bold aesthetic direction** (brutalist, retro-futuristic, luxury, playful, editorial, etc.)
- **Use distinctive typography** — no generic Inter/Arial/Roboto
- **Apply cohesive color palettes** — dominant colors with sharp accents
- **Add meaningful animations** — page load reveals, hover states, micro-interactions
- **Create atmospheric backgrounds** — gradients, textures, noise, geometric patterns
- **Use unexpected layouts** — asymmetry, overlap, grid-breaking elements

## Design process

Before writing code, Claude will think through:

1. **Purpose** — What problem does the interface solve? Who uses it?
2. **Tone** — Commits to a specific aesthetic direction
3. **Constraints** — Framework, performance, accessibility requirements
4. **Differentiation** — What makes it memorable?

Then implements working code (HTML/CSS/JS, React, Vue, etc.) that is production-ready.

## Example prompts for this project

```
"Redesign the game page with a premium dark theme"
"Make the lobby page feel like a real darts pub"
"Create an animated scoreboard with player avatars"
"Design a victory screen with confetti and bold typography"
```

## Learn more

- [Frontend Aesthetics Cookbook](https://github.com/anthropics/claude-cookbooks/blob/main/coding/prompting_for_frontend_aesthetics.ipynb)
- Installed from: `npx skills add https://github.com/anthropics/skills --skill frontend-design`
