---
created: 2026-07-09
updated: 2026-07-10
category: research
status: current
doc_kind: node
id: award-winning-uiux-research-foundation
summary: Research foundation for category-aware UI recipes, design systems, validation, and UI-generation tooling.
tags: [research, ui, ux, design-systems, award-winning, accessibility, plugins]
related: [ui-craft-source-review, ui-development-governance]
---

# Award-Winning UI/UX Research Foundation

**Purpose:** Build a practical research base for creating UI-generation skills, plugins, scoring tools, and deterministic design-system helpers. This is not a moodboard. It is a pattern-extraction framework: where to look, what to extract, when each pattern works, and how to turn it into repeatable UI recipes.

**Target use in Elegy / Holon-style tooling:**

- Compile-time AI: analyze references, choose category recipes, generate design rationale, map visual intent to tokens/components.
- Runtime deterministic tools: generate/check tokens, layouts, component variants, accessibility, motion fallbacks, screenshots, visual diffs, and scorecards.
- Plugin output: reusable UI skills, CLI utilities, schema contracts, and design-system adapters for React + TypeScript first.

---

## 1. What "award-winning" means operationally

Award-winning UI is not just visually impressive. The strongest award platforms judge a mix of aesthetics, usability, content, creativity, technical execution, and total experience.

A usable synthesis:

| Dimension | What it means for UI generation | Typical evidence |
|---|---|---|
| Visual design | Coherent composition, hierarchy, color, typography, imagery, shape language, depth | Screenshot review, token consistency, visual hierarchy map |
| Usability / UX | Users can understand, navigate, act, and recover | Clear IA, CTAs, states, forms, navigation, mobile behavior |
| Creativity / distinctiveness | A memorable signature idea rather than generic template aesthetics | Hero mechanism, motif, interaction idea, narrative metaphor |
| Content quality | Copy, messaging, information density, explanation quality | Value proposition, scanability, domain fit |
| Technical execution | Performance, responsiveness, animation smoothness, accessibility, robust states | Lighthouse, axe, reduced-motion checks, visual regression |
| Overall experience | The experience feels intentional from first impression to conversion/completion | End-to-end flow review |

### Practical implication

A future UI plugin should not ask only "make this prettier." It should reason through:

1. **Category**: SaaS, ecommerce, editorial, portfolio, dashboard, AI tool, nonprofit, luxury, etc.
2. **Experience goal**: convert, explain, immerse, reassure, teach, transact, configure, explore.
3. **Visual signature**: one dominant idea, not a pile of effects.
4. **Token system**: color, type, spacing, radius, elevation, motion, layout.
5. **Component recipes**: hero, nav, cards, forms, pricing, product, dashboard, modals, empty states.
6. **Guardrails**: contrast, target size, reduced motion, loading, fallback, responsive behavior.

---

## 2. Main research areas

The research should be separated into nine areas. Mixing them too early creates vague "make it modern" instructions that are hard to automate.

### 2.1 Award platforms and high-end inspiration

Use these to understand what currently wins attention.

| Source type | Best use | Weakness | Plugin extraction value |
|---|---|---|---|
| Awwwards | Experimental web, agency work, portfolios, campaign sites, WebGL, motion, high-end visual systems | Can overvalue spectacle; not always conversion-safe | Visual signatures, hero mechanics, motion patterns, color/font direction |
| CSS Design Awards | UI/UX/innovation scores; good for categorizing interface craft | Still weighted toward standout websites | Score decomposition; UI/UX/innovation rating model |
| Webby Awards | Broader category awards; strong for editorial, public-interest, data viz, brand, apps | Less visually searchable than design galleries | Category-specific winners and total-experience rubric |
| The FWA | Interactive/campaign work, experiments, immersive storytelling | Often heavy motion/WebGL; not always product-friendly | Advanced interaction references |
| SiteInspire / Godly / One Page Love | Curated design galleries; easier to browse by aesthetic/category | Less rigorous judging | Fast moodboard and pattern discovery |

**Extraction method:** for every winner, record category, page type, dominant visual idea, layout structure, type system, palette, motion model, interaction model, performance risk, accessibility risk, and reusable recipe.

### 2.2 Design systems and product foundations

Use these to prevent award inspiration from becoming unmaintainable decoration.

| Source | Best use | What to extract |
|---|---|---|
| Material Design 3 | Tokenized color, typography, shape, motion, adaptive product UI | Semantic tokens, component behavior, motion roles |
| Apple Human Interface Guidelines | Platform-native feel, typography, color adaptation, interaction conventions | Native affordances, clarity rules, platform-specific heuristics |
| IBM Carbon | Enterprise UX, neutral palettes, typography scale, data/product surfaces | Productive vs expressive type, restrained color use, layered surfaces |
| Microsoft Fluent | Typography hierarchy, elevation, shadows, native UI consistency | Type ramp, elevation rules, content alignment |
| shadcn/ui + Radix | Practical React component base, CSS variable theming | Component recipes, semantic tokens, accessible primitives |
| Tailwind | Utility token implementation, theme variables, rapid composition | Token-to-class mapping, spacing/radius/shadow constraints |
| W3C Design Tokens / Style Dictionary | Cross-platform token exchange | Canonical token schema and build outputs |

**Extraction method:** keep systems separate from inspiration. Inspiration says "what could look good"; systems say "what should be stable, accessible, maintainable, and repeatable."

### 2.3 UX pattern libraries and conversion research

Use these to avoid beautiful but broken flows.

| Source | Best use | What to extract |
|---|---|---|
| Mobbin | App screens, SaaS flows, mobile/web UI patterns | Screen patterns, navigation, empty/loading/error states, component density |
| Page Flows | Recorded user journeys | Onboarding, checkout, booking, subscription, search, profile flows |
| Baymard | Ecommerce and checkout UX | Field rules, checkout friction, product page evidence, cart/payment patterns |
| NN/g | Foundational UX heuristics and visual design psychology | Hierarchy, aesthetic-usability effect, affordances, form usability |

**Extraction method:** pair every visual recipe with a UX recipe. Example: a luxury ecommerce product page can use cinematic visuals, but checkout still needs Baymard-style clarity.

### 2.4 Typography and font research

Typography is often the fastest path to "premium" UI. Strong typography can make simple layouts look expensive.

| Source | Best use | What to extract |
|---|---|---|
| Typewolf | Real-world web font combinations and popular type families | Pairings, font mood, industry usage |
| Fonts In Use | Historical and contemporary typographic references | Typeface-to-brand/category mapping |
| Google Fonts / Adobe Fonts / commercial foundries | Implementation-ready font choices | Weights, optical sizes, variable axes, licensing |
| Awwwards typography collections | Experimental large display type | Hero typography, kinetic type, expressive headers |

**Typography variables to record:**

- Display family, text family, mono/accent family.
- Weight range and optical size availability.
- X-height, contrast, geometry, friendliness, authority, editorial tone.
- Pairing type: neutral sans + expressive serif, geometric sans + humanist sans, grotesk + mono, serif-led editorial, display-only logo/hero.
- Scale: conservative product scale vs editorial/marketing scale.
- Line height, letter spacing, max line length, paragraph rhythm.

### 2.5 Color research

Color should be tokenized and semantic, not hand-picked per component.

Research layers:

1. **Brand palette**: memorable, emotional, differentiating.
2. **Semantic palette**: background, foreground, primary, secondary, muted, accent, destructive, success, warning, info.
3. **Surface palette**: cards, panels, overlays, borders, separators, hover states.
4. **Data palette**: categorical, sequential, diverging.
5. **Accessibility palette**: contrast-compliant pairs, focus rings, disabled states.

Modern plugin direction:

- Generate palettes in perceptual color spaces such as OKLCH.
- Verify contrast for text and UI states.
- Prefer semantic tokens over direct color names.
- Keep accent use constrained: one strong accent is usually better than five.
- Store light/dark themes as semantic role mappings, not duplicate arbitrary palettes.

### 2.6 Layout and composition research

Layouts can be systematized into reusable composition archetypes.

| Layout archetype | Works best for | Risks | Notes |
|---|---|---|---|
| Centered conversion landing | SaaS, AI tools, waitlists, lightweight product pages | Generic if no strong motif | Clear hero, proof, features, CTA, FAQ |
| Split hero | Product, B2B, app launch | Can feel template-like | Copy on one side, product/visual proof on other |
| Bento grid | SaaS, AI products, feature-heavy launches | Overused; can become noisy | Works when each cell has a clear role and consistent tokens |
| Editorial asymmetry | agencies, portfolios, culture, luxury | Harder responsive behavior | Large type, whitespace, irregular but aligned composition |
| Immersive scroll narrative | campaigns, data viz, nonprofit, product storytelling | Performance and motion risks | Scene-by-scene progression, animation as explanation |
| Dashboard shell | B2B apps, admin, analytics, internal tools | Clutter, weak hierarchy | Sidebar/topbar, density controls, cards, tables, filters |
| Product configurator | fashion, ecommerce, tools | Complexity, state bugs | Immediate preview, constrained choices, clear save/share/buy |
| Magazine grid | editorial, blogs, cultural institutions | Needs strong imagery/content | Rhythm, cards, typographic hierarchy, topic filters |

### 2.7 Motion and interaction research

Motion should support meaning.

| Motion type | Use | Avoid |
|---|---|---|
| State transition | Change selected tab, open modal, move item | Random easing without semantic relation |
| Entrance animation | Guide attention on load or scroll | Delaying access to core content |
| Scroll-linked animation | Storytelling, product reveal, data-viz explanation | Hijacked scroll, inaccessible parallax |
| Micro-interaction | Button press, form validation, hover, drag, upload | Distracting "toy" UI on serious tools |
| Layout transition | Preserve context between route/view changes | Abrupt page swaps in complex flows |
| WebGL/3D | Campaign, portfolio, product storytelling, high-end brand | Using heavy 3D where screenshots would communicate faster |
| Kinetic typography | Brand/campaign/portfolio intros | Low legibility, motion sickness, excessive delay |

A motion plugin should output:

- Motion intent: orient, confirm, reveal, connect, delight, warn.
- Duration tokens: instant, fast, normal, slow, cinematic.
- Easing tokens: standard, emphasized, decelerate, spring.
- Allowed properties: transform/opacity first; avoid layout-heavy animation by default.
- Reduced-motion fallback: fade, instant state change, static graphic, or optional disable.

### 2.8 Shapes, borders, shadows, depth

These small decisions create category tone.

| Visual language | Typical effect | Works for |
|---|---|---|
| Sharp rectangles, thin borders | Technical, editorial, serious, architectural | Dev tools, finance, data, agencies |
| Soft radius, soft shadows | Friendly, consumer, approachable | Productivity, health, education, consumer apps |
| Large radius / pill shapes | Modern SaaS, AI, playful tools | Consumer SaaS, onboarding, AI helpers |
| Brutalist borders / hard shadows | Bold, youthful, indie, experimental | Portfolios, events, creative campaigns |
| Glass/blur panels | Futuristic, layered, ambient | AI, dashboards, creative tools; risky for contrast |
| 3D/isometric shapes | Explain abstraction, workflow, infrastructure | Dev tools, automation, AI, cloud |
| Organic blobs / irregular shapes | Friendly, human, creative | Wellness, nonprofit, education; less for enterprise |

Depth should be systematic:

- Border for separation on flat surfaces.
- Shadow for elevation and hierarchy.
- Overlay blur for modal/sheet focus, not as a default card style.
- Dark themes need surface contrast and border opacity more than large shadows.

### 2.9 Accessibility, performance, and implementation constraints

A UI skill must treat accessibility and performance as core design inputs, not post-checks.

Minimum checks:

- Contrast pairs for text and important UI indicators.
- Keyboard focus and visible focus rings.
- Target size for touch/click controls.
- Reduced-motion media query support.
- Responsive breakpoints and content reflow.
- Loading, empty, error, disabled, hover, active, selected, and success states.
- Avoid color-only status communication.
- Image alt strategy and decorative image marking.
- Performance budget for fonts, 3D assets, video, animation, and third-party scripts.

---

## 3. Best websites and resources by research category

### 3.1 Award-winning visual inspiration

#### Awwwards

**Use when:** you want cutting-edge visual design, agency/portfolio excellence, campaign sites, experimental landing pages, WebGL, expressive typography, and interaction-heavy experiences.

**What it is good at:**

- Detecting visual trends early.
- Exposing technical stacks and categories on many entries.
- Showing how a single visual signature can dominate a page.
- Finding advanced hero treatments, scroll interactions, and 3D/WebGL patterns.

**What it is not good for alone:**

- Checkout and transactional UX.
- Enterprise dashboards.
- Accessibility-first product flows.
- Conservative B2B conversion unless filtered carefully.

**Pattern extraction checklist:**

- What is the site's one-sentence visual idea?
- What does the hero do that a template hero does not?
- Is the motion explanatory, theatrical, or decorative?
- What is the color signature?
- What typography choice creates the tone?
- Which patterns are reusable without copying the brand?

#### CSS Design Awards

**Use when:** you want UI/UX/innovation decomposition. CSSDA is useful because entries are framed around design, UX, and innovation, which maps well to plugin scoring.

**Good for:**

- Visual scoring systems.
- UI craft examples.
- Comparing sites by UI vs UX vs innovation.
- Front-end polish and interaction quality.

**Pattern extraction checklist:**

- UI score clues: visual polish, color, layout, type, component consistency.
- UX score clues: clarity, navigation, interaction cost, mobile quality.
- Innovation clues: novel mechanism, technical execution, interaction model.

#### Webby Awards

**Use when:** you need broader category winners, especially data visualization, editorial, nonprofit, public-interest, brand, mobile sites, and overall digital experience.

**Good for:**

- Category-specific research.
- Total experience, not just style.
- Data visualization and public-interest storytelling.
- Differentiating design goals by domain.

**Pattern extraction checklist:**

- Which category did it win?
- What is the primary user value?
- What makes the structure/navigation strong?
- How does visual design serve content and interactivity?
- What technical or accessibility constraints should a plugin learn from?

### 3.2 Curated design galleries

#### SiteInspire

**Use when:** you want broad, tasteful, curated website inspiration with less awards noise.

**Good for:**

- Clean editorial/portfolio/culture references.
- Moodboard building.
- Simpler, more reusable visual direction.

**Extraction:** focus on layout, whitespace, typography, and image treatment.

#### Godly

**Use when:** you want current interaction/interface trends and a fast scan of modern websites, apps, logos, and sections.

**Good for:**

- Modern SaaS and AI aesthetics.
- Trend detection.
- Section-level inspiration.

**Extraction:** collect sections, not only whole sites: hero, feature grid, pricing, integration block, testimonial, CTA.

#### One Page Love

**Use when:** you need launch pages, single-purpose sites, startup pages, app landing pages, personal pages, and focused conversion pages.

**Good for:**

- Page structure.
- Single-page information architecture.
- CTA sequencing.
- Lightweight launches.

**Extraction:** section order, CTA repetition, proof blocks, FAQ placement, final conversion block.

### 3.3 Product/app UX pattern sources

#### Mobbin

**Use when:** you are designing real app screens, not just marketing websites.

**Good for:**

- Mobile and web app UI patterns.
- Onboarding, settings, search, subscription, dashboard, profile, checkout.
- State and flow references.

**Extraction:** record full flows and screen states. Screens alone are less valuable than how a user moves through them.

#### Page Flows

**Use when:** you need recorded user journeys.

**Good for:**

- User onboarding.
- Purchase/ordering flows.
- Booking/reserving.
- Account management.
- Upgrade/cancel/subscribe patterns.

**Extraction:** convert flows to deterministic checklists: step count, decision points, form fields, progress indicators, error states.

#### Baymard

**Use when:** ecommerce conversion, product pages, cart, checkout, filtering, search, account creation, shipping/payment.

**Good for:**

- Avoiding expensive ecommerce mistakes.
- Checkout form simplification.
- Product evidence hierarchy.
- Filtering/sorting UX.

**Extraction:** convert research findings into guardrails and anti-pattern checks.

### 3.4 Typography resources

#### Typewolf

**Use when:** choosing font pairings, understanding font mood, and seeing real-world web usage.

**Plugin value:**

- Category-to-font-pair recommendations.
- Pairing rules.
- "Premium but safe" font shortlists.

#### Fonts In Use

**Use when:** mapping typefaces to cultural, editorial, luxury, technical, or historical contexts.

**Plugin value:**

- Typeface personality database.
- Brand-category fit scoring.

#### Awwwards typography collections

**Use when:** researching expressive hero type, kinetic typography, or high-impact display type.

**Plugin value:**

- Display-type recipes.
- Hero typography variants.

### 3.5 Motion resources

#### GSAP Showcase

**Use when:** researching advanced animation, scroll sequences, SVG animation, text effects, and interactive storytelling.

**Plugin value:**

- Motion recipes by intent.
- GSAP/Framer Motion/native CSS implementation choices.
- ScrollTrigger-like narrative templates.

#### MDN / web.dev platform docs

**Use when:** verifying whether native browser APIs are stable enough.

Relevant technologies:

- View Transition API.
- CSS scroll-driven animations.
- `prefers-reduced-motion`.
- CSS transforms and opacity.
- OKLCH color.

**Plugin value:**

- Compatibility checks.
- Fallback generation.
- Safe progressive enhancement.

---

## 4. Category playbooks

These are not final templates; they are starting recipes for a UI-generation system.

### 4.1 SaaS / B2B / AI tool landing pages

**Goal:** clarity, trust, explanation, conversion.

**Good sources:** SaaS Landing Page, Godly, Mobbin, Webflow showcases, Stripe-like product pages, Linear-like product pages, shadcn/ui examples.

**What works:**

- Strong but simple hero: exact value proposition, one primary CTA, one secondary proof/action.
- Product screenshot or abstract product diagram above the fold.
- Feature grid with user outcomes, not just feature labels.
- Bento grids when each card has a distinct information role.
- Integration logos, workflow diagrams, before/after examples.
- Trust blocks: customers, testimonials, security/compliance, case studies.
- Pricing clarity and FAQ.

**Visual patterns:**

- Neutral backgrounds with one vivid accent.
- Technical gradients used sparingly.
- Soft surfaces, thin borders, subtle shadows.
- Large sans-serif display type with readable body sans.
- Code snippets, diagrams, cards, tabs, workflow steps.

**Motion:**

- Product reveal animation.
- Small diagram transitions.
- Tabbed feature demos.
- Hover states on cards.
- Avoid long cinematic loaders.

**Avoid:**

- Abstract AI glitter without showing the actual product value.
- Too many gradients, glows, or 3D shapes.
- Generic "revolutionize your workflow" copy.
- Bento grids where every card looks equally important.

**Plugin recipe:**

```yaml
category: saas_landing
experience_goal: explain_and_convert
visual_signature:
  type: controlled_accent_plus_product_diagram
layout:
  hero: centered_or_split
  proof: logo_strip_or_metric_row
  features: bento_or_three_column
  demo: tabs_or_steps
  conversion: pricing_or_waitlist
style:
  color: neutral_surface_plus_accent
  type: modern_sans_with_optional_mono
  depth: border_first_shadow_second
motion:
  allowed: reveal, tab_transition, diagram_step
  forbidden: blocking_loader, heavy_scroll_hijack
checks:
  - hero_value_prop_specific
  - cta_visible_above_fold
  - contrast_ok
  - reduced_motion_fallback
```

### 4.2 Ecommerce / fashion / product configurators

**Goal:** desire + product confidence + fast transaction.

**Good sources:** Awwwards ecommerce collections, Baymard, Mobbin ecommerce flows, Lacoste Members Experience-style configurators.

**What works:**

- Product photography or 3D preview dominates when the product is visual.
- Clear variants, pricing, availability, shipping/returns.
- Strong product detail hierarchy.
- Configurators with immediate feedback.
- Editorial/lifestyle visuals for premium/fashion products.
- Checkout simplicity remains more important than visual experimentation.

**Visual patterns:**

- Brand color used as an identity signal, not everywhere.
- Larger photography and whitespace for premium positioning.
- Compact, dense UI for catalogs; immersive UI for limited drops.
- Product cards should prioritize image, price, variant, and action.

**Motion:**

- Product rotate/zoom.
- Variant transitions.
- Add-to-cart confirmation.
- Mini-cart slide.
- Avoid scroll hijack during shopping and checkout.

**Avoid:**

- Hiding product details behind animation.
- Nonstandard checkout interactions.
- Low-contrast fashion minimalism that fails accessibility.
- Too many variant choices without grouping.

**Plugin recipe:**

```yaml
category: ecommerce_product
experience_goal: desire_and_purchase
layout:
  product: gallery_left_details_right
  variants: grouped_swatches
  trust: shipping_returns_size_help
  checkout: standard_clear
style:
  color: brand_led_but_contrast_checked
  type: editorial_or_clean_sans_by_brand
motion:
  allowed: variant_preview, image_zoom, cart_confirmation
  forbidden: checkout_experimentation, hidden_price
checks:
  - price_visible
  - add_to_cart_visible
  - variant_state_clear
  - guest_checkout_supported_when_relevant
```

### 4.3 Portfolio / agency / creative studio

**Goal:** memorability, taste, differentiation, proof of craft.

**Good sources:** Awwwards, CSSDA, SiteInspire, Godly, FWA.

**What works:**

- One strong visual/interaction signature.
- Confident typographic hierarchy.
- Case studies with process and outcomes.
- Irregular layouts that still align to a grid.
- Cursor/hover/scroll interaction when it reinforces brand personality.
- Motion-heavy hero if performance remains acceptable.

**Visual patterns:**

- Oversized typography.
- Editorial whitespace.
- Experimental navigation.
- Monochrome + one accent.
- Case-study thumbnails with distinctive image treatment.
- Brutalist, elegant, playful, or cinematic directions depending on studio personality.

**Motion:**

- Page transitions.
- Project grid hover previews.
- Scroll-linked reveal.
- Kinetic typography.
- WebGL when craft is the product.

**Avoid:**

- Navigation that hides work.
- Motion that blocks portfolio browsing.
- Low contrast for "cool" aesthetics.
- Copy that does not explain actual capabilities.

**Plugin recipe:**

```yaml
category: creative_portfolio
experience_goal: memorable_proof_of_craft
visual_signature:
  required: true
layout:
  hero: typographic_or_interactive
  work: project_grid_with_case_studies
  about: concise_capabilities
  contact: persistent_or_final_cta
style:
  type: expressive_display_plus_readable_text
  color: constrained_high_identity
motion:
  allowed: page_transition, hover_preview, scroll_reveal
  risk_budget: medium_to_high
checks:
  - work_accessible_with_no_animation
  - contact_easy_to_find
  - case_study_outcomes_present
```

### 4.4 Editorial / data visualization / public-interest storytelling

**Goal:** explain, reveal, guide understanding.

**Good sources:** Webby data visualization winners, WWF Blue Corridors, media interactive teams, data-journalism awards, Observable-style notebooks.

**What works:**

- Narrative progression: context → data → personal/human relevance → action.
- Maps, charts, annotations, and scrollytelling.
- Strong captions and explainers.
- Interactive controls when they answer real questions.
- Accessible static fallbacks for complex charts.

**Visual patterns:**

- Editorial type systems.
- Large maps/charts with high whitespace.
- Annotation cards.
- Sequential color palettes for magnitude; categorical palettes for groups.
- Strong content hierarchy and source transparency.

**Motion:**

- Scroll-driven reveals.
- Animated transitions between chart states.
- Map path drawing.
- Tooltip and filter transitions.
- Avoid motion that distorts data interpretation.

**Avoid:**

- Beautiful charts without explanation.
- Interactions that require guessing.
- Color scales that are not perceptually clear.
- No text alternative for key insights.

**Plugin recipe:**

```yaml
category: data_story
experience_goal: explain_and_persuade
layout:
  intro: editorial_context
  story: scrollytelling_sections
  data: chart_map_with_annotations
  action: takeaway_or_cta
style:
  color: data_palette_plus_editorial_neutrals
  type: editorial_readable
motion:
  allowed: chart_state_transition, scroll_reveal
  fallback: static_steps
checks:
  - data_source_visible
  - chart_alt_summary
  - color_not_only_encoding
  - reduced_motion_static_sequence
```

### 4.5 Luxury / hospitality / architecture / high-end lifestyle

**Goal:** perceived quality, emotion, trust, aspiration.

**Good sources:** Awwwards, SiteInspire, high-end hotel/architecture/fashion references.

**What works:**

- High-quality photography/video.
- Large whitespace and slow pacing.
- Refined typography, often serif + neutral sans.
- Minimal chrome.
- Strong image sequencing.
- Elegant transitions.

**Visual patterns:**

- Warm neutrals, deep blacks, off-whites, muted metallics.
- Thin dividers, precise spacing, restrained buttons.
- Editorial grid.
- Large image-first sections.

**Motion:**

- Slow image reveals.
- Subtle parallax with fallback.
- Smooth page transitions.
- Avoid playful micro-interactions unless brand demands it.

**Avoid:**

- Generic template luxury with illegible thin text.
- Overusing autoplay video.
- Hiding practical info such as price, location, availability, booking.

**Plugin recipe:**

```yaml
category: luxury_brand
experience_goal: aspiration_and_trust
layout:
  hero: image_or_video_first
  content: editorial_sections
  action: understated_but_visible
style:
  color: warm_neutral_or_deep_contrast
  type: serif_display_plus_clean_text
  depth: minimal
motion:
  allowed: slow_reveal, image_crossfade
  forbidden: playful_bounce, noisy_glow
checks:
  - practical_info_findable
  - text_contrast_ok
  - media_performance_budget_ok
```

### 4.6 Web apps / dashboards / internal tools

**Goal:** productivity, density, clarity, reliability.

**Good sources:** Mobbin, Material, Carbon, Fluent, shadcn/ui dashboards, real SaaS apps.

**What works:**

- Stable navigation shell.
- Consistent typography scale.
- Data tables with filters, sorting, pagination, empty/loading/error states.
- Cards with clear hierarchy.
- Forms with validation and recovery.
- Density controls for power users.
- Color used sparingly for status/action.

**Visual patterns:**

- Neutral palette.
- Clear surface layering.
- Border-first hierarchy.
- Small shadows only for overlays/popovers.
- Monospace for IDs/logs/code.

**Motion:**

- Short transitions for drawers, popovers, tabs.
- Skeleton loading.
- State-preserving route transitions.
- Avoid cinematic motion.

**Avoid:**

- Overdesigned cards hiding information.
- Low-density dashboards for data-heavy work.
- Colorful status systems without legends.
- Modals for everything.

**Plugin recipe:**

```yaml
category: dashboard_app
experience_goal: productivity_and_clarity
layout:
  shell: sidebar_or_topbar
  content: cards_tables_filters
  states: loading_empty_error_success
style:
  color: neutral_semantic
  type: product_sans_plus_mono
  depth: layered_surfaces
motion:
  allowed: drawer, popover, tab, skeleton
  duration: fast
checks:
  - keyboard_navigation
  - table_responsive_strategy
  - status_not_color_only
  - empty_and_error_states_present
```

### 4.7 AI / automation / developer tools

**Goal:** explain abstraction, build trust, show capability.

**Good sources:** SaaS Landing Page, Godly, Mobbin, developer-tool landing pages, documentation sites, product demos.

**What works:**

- Concrete workflow diagrams.
- Before/after examples.
- Live or animated product demos.
- Code snippets and API examples.
- Trust/security sections.
- Clear boundaries: what is automated, what is user-approved, what is deterministic.

**Visual patterns:**

- Dark or neutral technical base with one accent.
- Grid, graph, nodes, traces, timelines, logs, terminal/code motifs.
- Cards for capabilities; diagrams for orchestration.
- Monospace accents.

**Motion:**

- Animated workflow graph.
- Step execution playback.
- Cursor/agent trace only when it clarifies.
- Avoid fake "AI magic" fog.

**Avoid:**

- Abstract robot/glow visuals without concrete product proof.
- Overpromising autonomy.
- Hiding security, approval, logs, and reversibility.

**Plugin recipe:**

```yaml
category: ai_dev_tool
experience_goal: explain_and_build_trust
layout:
  hero: value_prop_plus_demo
  proof: workflow_diagram_or_screenshot
  details: security_approval_logs_integrations
  conversion: docs_or_install_cta
style:
  color: technical_neutral_plus_accent
  type: sans_plus_mono
  shape: grid_nodes_cards
motion:
  allowed: workflow_step, trace_replay, diagram_transition
  forbidden: meaningless_ai_glow
checks:
  - concrete_demo_present
  - limitations_or_controls_visible
  - docs_cta_present
```

### 4.8 Nonprofit / impact / cultural institutions

**Goal:** credibility, emotion, action.

**Good sources:** Webby winners, Awwwards nonprofit/culture examples, data-viz winners, museum/cultural sites.

**What works:**

- Human story + evidence/data.
- Strong photography/video when ethically appropriate.
- Clear donation/action/learn paths.
- Accessibility and readability.
- Trust signals and source transparency.

**Visual patterns:**

- Editorial layout.
- Documentary imagery.
- Data visualization integrated with narrative.
- Calm, serious palettes with selective accent for action.

**Motion:**

- Story progression.
- Map/chart reveal.
- Gentle content transitions.
- Avoid gimmicky interaction on serious topics.

**Avoid:**

- Award-show spectacle that weakens credibility.
- Donation CTAs hidden beneath story.
- Data without source explanation.

---

## 5. Cross-category patterns found in strong UI

### 5.1 One dominant visual signature

Great sites usually have one dominant idea: a color, type treatment, spatial metaphor, interaction, illustration style, photo treatment, or motion system. Weak sites often combine multiple unrelated trends.

**Plugin rule:** require a `visual_signature` field and reject "everything everywhere" style prompts.

Examples of signature types:

- Color signature: neon accent on dark neutral.
- Type signature: oversized editorial serif.
- Motion signature: scroll-driven product reveal.
- Shape signature: grid/node/fractal motif.
- Media signature: cinematic photography.
- Interaction signature: product configurator/customizer.

### 5.2 Strong typography before decoration

Typography creates hierarchy faster than shadows and gradients.

**Plugin rule:** generate type scale and hierarchy before choosing decoration.

Minimum type roles:

- `display`: hero, major campaign lines.
- `h1` / `h2` / `h3`: section structure.
- `body`: normal reading.
- `caption`: metadata, labels.
- `button`: actions.
- `mono`: code, IDs, technical details.

### 5.3 Constrained color systems

Most strong interfaces use fewer colors than beginners expect.

**Plugin rule:** choose one main accent and derive semantic tokens. Add extra colors only for data/status categories.

Bad pattern:

```yaml
primary: blue
secondary: purple
accent: green
cta: orange
success: green
warning: yellow
info: cyan
brand_gradient: pink-purple-blue
```

Better pattern:

```yaml
brand:
  accent: oklch(...)
semantic:
  background: ...
  foreground: ...
  primary: brand.accent
  muted: ...
  border: ...
  success: ...
  warning: ...
  destructive: ...
```

### 5.4 Layout rhythm and spacing discipline

Award-worthy pages often feel expensive because spacing is consistent.

**Plugin rule:** define spacing tokens and section rhythm.

Useful spacing roles:

- `space.inline-xs/sm/md/lg`
- `space.stack-xs/sm/md/lg/xl`
- `space.section-sm/md/lg/xl`
- `container.narrow/default/wide/full`
- `grid.gutter`

### 5.5 Motion as orientation

The best motion tells the user what changed, where to look, and what relationship exists between elements.

**Plugin rule:** every animation must declare an intent: `orient`, `confirm`, `reveal`, `connect`, `delight`, or `warn`.

### 5.6 Depth and shadows as hierarchy

Shadows are not decoration. They show elevation and focus.

**Plugin rule:** use elevation tokens, not arbitrary shadow strings.

```yaml
elevation:
  surface: none_or_border
  raised: small_soft_shadow
  overlay: medium_shadow
  modal: large_diffuse_shadow
  tooltip: small_crisp_shadow
```

### 5.7 Category-specific restraint

What wins in a creative portfolio may harm a checkout flow. A plugin must select patterns by category.

Examples:

- Portfolio: experimental cursor can be acceptable.
- Checkout: experimental cursor is usually harmful.
- Data story: scroll animation can explain.
- Dashboard: scroll animation usually distracts.
- Luxury: slow transitions can reinforce tone.
- Productivity app: slow transitions feel inefficient.

---

## 6. Case notes from recent award/reference sites

### 6.1 Lando Norris official site

**Category:** sports, personal brand, campaign-like portfolio.

**Observed strengths:**

- Strong color signature: vivid neon/lime against black.
- Dynamic interactions and bold visuals match F1/performance context.
- High motion/interaction budget is appropriate because the site is brand-first.
- Works best as a personal/sports/campaign reference, not as a dashboard or checkout reference.

**Reusable pattern:**

```yaml
recipe: high_energy_personal_brand
signature: vivid_accent_on_dark
layout: bold_hero + immersive_sections + media_rich_story
motion: high_energy_reveals + gestures + webgl_optional
risk: performance/accessibility/motion_sensitivity
```

### 6.2 Lacoste Members Experience

**Category:** fashion ecommerce, loyalty/member experience, product customization.

**Observed strengths:**

- Clear brand world: Lacoste green, playful customization, product-led interaction.
- Customization is the core experience, not a decorative add-on.
- Desktop and mobile require different interaction approaches.
- Strong example for product configurator skills.

**Reusable pattern:**

```yaml
recipe: branded_product_configurator
signature: product_customization_as_main_interaction
layout: preview_dominant + tool_controls + save/share/buy
motion: immediate_feedback + variant_transition
checks: mobile_control_mapping + performance + state_persistence
```

### 6.3 WWF Blue Corridors

**Category:** data visualization, nonprofit, public-interest storytelling.

**Observed strengths:**

- Uses long-term tracking data and map-based visualization to make a complex conservation issue legible.
- Combines data, threats, and action-oriented framing.
- Good model for data stories where interaction must clarify, not distract.

**Reusable pattern:**

```yaml
recipe: public_interest_data_story
signature: map_or_data_visualization_as_story_spine
layout: editorial_intro + interactive_map + annotated_insights + action_cta
motion: map_path_reveal + section_progression
checks: data_sources + chart_alt_text + color_accessibility
```

### 6.4 Shopify "Renaissance Edition" release page

**Category:** product launch, ecommerce platform, brand/editorial campaign.

**Observed strengths:**

- Strong conceptual theme: Renaissance art language applied to a large product update.
- Combines campaign memorability with structured product categories.
- Good reference for making release notes or feature launches feel distinctive.

**Reusable pattern:**

```yaml
recipe: themed_product_release
signature: historical_or_cultural_visual_metaphor
layout: hero_theme + categorized_updates + product_cards + cta
motion: editorial_reveal + detail_transitions
checks: theme_does_not_hide_product_information
```

### 6.5 SIGNS by Hello Monday/DEPT and NVIDIA

**Category:** responsible innovation, technical achievement, AI/interactive accessibility.

**Observed strengths:**

- Good example of technology-led interface where the interaction is the point.
- Strong fit for AI/ML demos where the UI must make a technical capability understandable.
- Useful reference for "responsible innovation" framing.

**Reusable pattern:**

```yaml
recipe: responsible_ai_interactive_demo
signature: live_interaction_or_simulation
layout: explain + try + understand + responsible_framing
motion: feedback_loop + state_explanation
checks: accessibility + transparency + fallback_content
```

---

## 7. Failure modes to explicitly guard against

### 7.1 Award-site cargo culting

Copying WebGL, cursor effects, kinetic type, and massive transitions without the same purpose.

**Guardrail:** the plugin must ask whether the site category permits high spectacle. If not, downgrade to restrained motion.

### 7.2 Generic modern SaaS sameness

Dark gradient hero, glowing orb, bento grid, vague AI copy, meaningless logos.

**Guardrail:** require concrete product proof: screenshot, diagram, API example, use-case flow, or measurable outcome.

### 7.3 Typography mismatch

Using expressive display fonts for long body text or overly thin luxury type that fails readability.

**Guardrail:** font roles and contrast checks.

### 7.4 Unchecked color palettes

Pretty palettes that fail contrast, dark mode, focus states, or semantic status meaning.

**Guardrail:** OKLCH generation + WCAG contrast validation + semantic role mapping.

### 7.5 Animation without reduced-motion fallback

Motion-heavy experiences can be inaccessible or unpleasant.

**Guardrail:** every motion recipe includes a reduced-motion fallback.

### 7.6 Component inconsistency

Buttons, cards, inputs, and modals look like they come from different systems.

**Guardrail:** component tokens and variants must be generated from the same theme contract.

### 7.7 Unresponsive art direction

Great desktop mockup collapses poorly on mobile.

**Guardrail:** require per-breakpoint layout rules, especially for asymmetry, bento grids, configurators, and data viz.

---

## 8. Plugin and skill architecture proposal

### 8.1 Capability pack structure

A practical Elegy/Holon-style plugin could be organized as:

```text
ui-craft.plugin/
  manifest.json
  skills/
    ui-research-harvest.skill.md
    ui-style-director.skill.md
    ui-layout-composer.skill.md
    ui-motion-director.skill.md
    ui-accessibility-review.skill.md
    ui-award-score-review.skill.md
  schemas/
    ui-brief.schema.json
    ui-theme.schema.json
    ui-layout.schema.json
    ui-motion.schema.json
    ui-scorecard.schema.json
  tools/
    generate-theme.ts
    check-contrast.ts
    generate-tailwind-theme.ts
    generate-css-vars.ts
    score-ui.ts
    screenshot-compare.ts
    motion-fallback-check.ts
  adapters/
    react-tailwind-shadcn/
    css-modules/
    vanilla-css/
  evals/
    sample-saas-landing/
    sample-dashboard/
    sample-ecommerce-product/
    sample-data-story/
  docs/
    sources.md
    category-playbooks.md
    pattern-library.md
```

### 8.2 Core schemas

#### UI brief

```json
{
  "schemaId": "elegy-ui-brief.v0",
  "category": "saas_landing",
  "audience": "technical_founders",
  "experienceGoal": "explain_and_convert",
  "brandAdjectives": ["precise", "technical", "trustworthy", "modern"],
  "visualSignature": {
    "kind": "workflow_graph_motif",
    "intensity": "medium"
  },
  "contentSections": ["hero", "proof", "features", "demo", "security", "pricing", "faq", "cta"],
  "interactionBudget": "medium",
  "motionSensitivity": "safe_by_default",
  "accessibilityLevel": "wcag_2_2_aa_target",
  "implementationTarget": {
    "framework": "react",
    "styling": "tailwind_css_variables",
    "components": "shadcn_radix"
  }
}
```

#### Theme token schema

```json
{
  "schemaId": "elegy-ui-theme.v0",
  "meta": {
    "name": "Technical Neutral Lime",
    "categoryFit": ["ai_dev_tool", "saas_landing", "dashboard_app"]
  },
  "color": {
    "primitive": {
      "neutral_0": "oklch(...)"
    },
    "semantic": {
      "background": "{color.primitive.neutral_0}",
      "foreground": "{color.primitive.neutral_950}",
      "primary": "{color.primitive.accent_500}",
      "border": "{color.primitive.neutral_200}"
    }
  },
  "typography": {
    "fontFamily": {
      "display": "...",
      "body": "...",
      "mono": "..."
    },
    "scale": {
      "h1": { "size": "...", "lineHeight": "...", "weight": 700 }
    }
  },
  "space": {},
  "radius": {},
  "shadow": {},
  "motion": {},
  "component": {}
}
```

### 8.3 Skill set

#### `ui-research-harvest.skill.md`

Purpose: Analyze reference websites and extract reusable patterns.

Output:

- Source metadata.
- Category classification.
- Visual signature.
- Layout map.
- Typography map.
- Color map.
- Motion map.
- Component inventory.
- Risks and reusable recipe.

#### `ui-style-director.skill.md`

Purpose: Convert a product brief into a visual direction.

Output:

- Brand adjectives.
- Visual signature.
- Palette strategy.
- Typography strategy.
- Shape/depth strategy.
- Image/illustration strategy.
- Do/don't list.

#### `ui-layout-composer.skill.md`

Purpose: Select a category-appropriate layout.

Output:

- Section order.
- Grid/container rules.
- Responsive behavior.
- Component hierarchy.
- CTA placement.

#### `ui-motion-director.skill.md`

Purpose: Define motion intent and safe implementation.

Output:

- Motion tokens.
- Interaction recipes.
- Reduced-motion fallbacks.
- Performance constraints.

#### `ui-accessibility-review.skill.md`

Purpose: Enforce design accessibility before implementation is accepted.

Output:

- Contrast report.
- Keyboard/focus checklist.
- Reduced-motion validation.
- Target-size checks.
- Component state coverage.

#### `ui-award-score-review.skill.md`

Purpose: Score a generated UI against an award-inspired rubric.

Output:

- Visual design score.
- Usability score.
- Creativity score.
- Content score.
- Technical execution score.
- Category fit score.
- Prioritized fix list.

### 8.4 Deterministic tools

#### Theme generator

Inputs:

- Brand adjectives.
- Category.
- Desired mood.
- Optional seed colors.

Outputs:

- OKLCH primitives.
- Semantic CSS variables.
- Tailwind theme extension.
- Contrast matrix.
- Light/dark variants.

#### Typography pairing engine

Inputs:

- Category.
- Brand tone.
- Font availability/license constraints.

Outputs:

- Display/body/mono pair.
- Type scale.
- Line-height and tracking tokens.
- CSS font-face or provider import suggestions.

#### Layout composer

Inputs:

- Category.
- Content sections.
- Density.
- Interaction budget.

Outputs:

- Page section map.
- Grid/container classes.
- Responsive rules.
- Component slots.

#### Motion compiler

Inputs:

- Motion intent.
- Interaction budget.
- Target tech: CSS, Framer Motion, GSAP.

Outputs:

- Motion tokens.
- Implementation snippets.
- Reduced-motion fallback.
- Performance warning list.

#### UI scorecard

Inputs:

- Screenshot(s).
- DOM/component inventory.
- Token file.
- Page category.

Outputs:

- 100-point score.
- Visual hierarchy notes.
- Category-fit warnings.
- Accessibility/performance flags.
- Concrete fixes.

---

## 9. Award-inspired scoring rubric for generated UI

A practical scoring model:

| Area | Weight | Questions |
|---|---:|---|
| Visual design | 25 | Is the composition coherent? Does the page have a strong visual signature? Are type, spacing, color, imagery, and depth consistent? |
| Usability / UX | 25 | Can the user understand, navigate, act, and recover? Are states clear? Is the mobile behavior sound? |
| Category fit | 15 | Does the style match the type of website/app and user intent? |
| Content / communication | 15 | Is the value proposition specific? Is the hierarchy readable? Does copy support decisions? |
| Interaction / motion | 10 | Does motion clarify state and attention? Are fallbacks present? |
| Technical execution | 10 | Is it accessible, performant, responsive, and maintainable? |

Score interpretation:

- **90–100:** strong award-level candidate for its category.
- **80–89:** polished; likely good enough for production marketing or product UI.
- **70–79:** solid but generic or inconsistent.
- **60–69:** usable but visually weak or UX-incomplete.
- **Below 60:** needs redesign, not surface polishing.

---

## 10. Research-harvest template

Use this template when analyzing a new website.

```yaml
source:
  name:
  url:
  platform: awwwards | cssda | webby | siteinspire | mobbin | pageflows | other
  award_or_context:
  year:

classification:
  category:
  page_type:
  audience:
  experience_goal:
  conversion_goal:

visual_signature:
  summary:
  type: color | typography | motion | illustration | 3d | layout | interaction | media
  intensity: low | medium | high
  reusable_without_copying: true

layout:
  structure:
  grid:
  section_order:
  hero_type:
  navigation:
  mobile_strategy:

color:
  palette_summary:
  background_strategy:
  accent_strategy:
  semantic_roles:
  contrast_risks:

typography:
  display_style:
  body_style:
  scale:
  hierarchy:
  readability_risks:

shape_depth:
  radius_language:
  border_language:
  shadow_language:
  surface_layers:

motion:
  interaction_budget:
  key_animations:
  motion_intent:
  reduced_motion_fallback:
  performance_risks:

components:
  notable_components:
  reusable_patterns:
  component_states_seen:
  missing_states:

ux:
  clarity:
  navigation:
  task_flow:
  trust:
  friction:

implementation:
  likely_stack:
  assets:
  performance_budget:
  accessibility_notes:

recipe:
  name:
  works_for:
  avoid_for:
  token_implications:
  component_implications:
  skill_prompt_snippet:
```

---

## 11. Initial research backlog

### Phase 1: Build source taxonomy

- Create source list by category: award, product UX, typography, color, motion, design systems, accessibility, ecommerce research.
- Create a reference database schema.
- Start with 50 manually curated examples across categories.

### Phase 2: Extract patterns

For each example:

- Screenshot major breakpoints.
- Extract palette.
- Extract fonts if possible.
- Record section structure.
- Record motion/interaction patterns.
- Record component inventory.
- Rate category fit and implementation risk.

### Phase 3: Convert patterns to recipes

- `saas_landing.recipe.json`
- `dashboard_app.recipe.json`
- `ecommerce_product.recipe.json`
- `creative_portfolio.recipe.json`
- `data_story.recipe.json`
- `luxury_brand.recipe.json`
- `ai_dev_tool.recipe.json`

### Phase 4: Build tools

- Token generator.
- Contrast checker.
- Typography scale generator.
- Layout recipe generator.
- Motion fallback generator.
- Screenshot-based reviewer.
- Storybook/preview harness.
- Visual regression test.

### Phase 5: Integrate into UI creation workflow

Target workflow:

```text
brief
  -> category classifier
  -> visual direction
  -> token generation
  -> layout recipe
  -> component generation
  -> preview
  -> visual/a11y/performance score
  -> fix loop
  -> crystallized UI recipe/tool output
```

---

## 12. Recommended v0 scope for Elegy UI plugin

Keep v0 small and useful.

### V0 should include

1. `ui-brief.schema.json`
2. `ui-theme.schema.json`
3. `ui-style-director.skill.md`
4. `ui-award-score-review.skill.md`
5. `generate-theme.ts`
6. `check-contrast.ts`
7. React + Tailwind + shadcn adapter
8. Three category recipes:
   - `saas_landing`
   - `dashboard_app`
   - `ai_dev_tool`

### V0 should not include yet

- Fully automated web scraping of awards sites.
- Heavy WebGL generation.
- Complex animation timelines.
- Universal framework support.
- Automatic brand identity generation beyond a basic visual direction.

### Why this v0

It aligns with deterministic workflow goals: AI helps choose and explain direction, but concrete outputs are token files, layout recipes, component variants, checks, and scorecards.

---

## 13. Source list for continued research

### Award and inspiration

- Awwwards — https://www.awwwards.com/
- Awwwards Evaluation System — https://www.awwwards.com/about-evaluation/
- Awwwards Sites of the Year — https://www.awwwards.com/websites/sites_of_the_year/
- CSS Design Awards — https://www.cssdesignawards.com/
- CSSDA WOTY — https://www.cssdesignawards.com/woty2025/
- Webby Awards Winners — https://winners.webbyawards.com/winners/websites-and-mobile-sites
- Webby Judging Criteria — https://www.webbyawards.com/judging-criteria/
- The FWA — https://thefwa.com/
- SiteInspire — https://www.siteinspire.com/
- Godly — https://godly.design/
- One Page Love — https://onepagelove.com/

### Product UX / flows

- Mobbin — https://mobbin.com/
- Page Flows — https://pageflows.com/
- Baymard Institute — https://baymard.com/
- Nielsen Norman Group — https://www.nngroup.com/

### Typography

- Typewolf — https://www.typewolf.com/
- Fonts In Use — https://fontsinuse.com/
- Google Fonts — https://fonts.google.com/
- Adobe Fonts — https://fonts.adobe.com/

### Systems and implementation

- Material Design 3 — https://m3.material.io/
- Apple Human Interface Guidelines — https://developer.apple.com/design/human-interface-guidelines/
- IBM Carbon — https://carbondesignsystem.com/
- Microsoft Fluent — https://fluent2.microsoft.design/
- shadcn/ui — https://ui.shadcn.com/
- Tailwind CSS — https://tailwindcss.com/
- Style Dictionary — https://styledictionary.com/
- W3C Design Tokens Community Group — https://www.w3.org/community/design-tokens/

### Motion, color, accessibility

- GSAP Showcase — https://gsap.com/showcase/
- MDN View Transition API — https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- MDN CSS Scroll-Driven Animations — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_scroll-driven_animations
- MDN `prefers-reduced-motion` — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- MDN OKLCH — https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch
- WCAG 2.2 — https://www.w3.org/TR/WCAG22/

---

## 14. Bottom line

The useful abstraction is not "copy award-winning websites." The useful abstraction is:

```text
award references
  -> extracted design patterns
  -> category-specific recipes
  -> design tokens
  -> component variants
  -> motion rules
  -> accessibility/performance checks
  -> deterministic UI generation and review tools
```

For Holon/Elegy, this should become a UI craft capability pack: skills for judgment and direction, tools for generation and validation, adapters for React/Tailwind/shadcn, and evals based on category-specific examples.

---

## Related

- [[ui-craft-source-review]] [ui-craft-source-review.md](ui-craft-source-review.md) [ui-craft-source-review](docs/research/ui-craft-source-review.md)
- [[ui-development-governance]] [../system/ui-development-governance.md](../system/ui-development-governance.md) [ui-development-governance](docs/system/ui-development-governance.md)
