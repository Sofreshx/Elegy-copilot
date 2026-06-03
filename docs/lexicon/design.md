# Design Concepts

## HCI Principles

### Affordance
**Definition:** A property of an object that suggests how it can be used — a flat button affords pressing, a handle affords pulling.
**Usage:** Use to describe whether an element visually communicates its purpose. A good affordance needs no label. Distinguish from Signifier (the visual indicator of affordance) and Mapping (the relationship between control and result).
**Related:** Signifier (visual cue making affordance perceivable), Mapping (control-result relationship), Feedback (response to action)
**Tags:** design, hci, affordance

### Signifier
**Definition:** A visual or audible cue that communicates where an action should take place — the underline on a link, the shadow on a button.
**Usage:** Use when describing the visible indicator of an affordance. Every affordance needs a signifier to be perceivable. Distinguish from Affordance (the property itself) — signifiers make affordances visible.
**Related:** Affordance (the actionable property), Feedback (the response), Call-to-action (the desired action)
**Tags:** design, hci, signifier

### Feedback
**Definition:** A response from the system after a user action, confirming the action was received and showing its result.
**Usage:** Use for any system response — visual (button press), audible (click sound), haptic (vibration), or status message. Every user action needs immediate feedback.
**Related:** Affordance (before action), Signifier (where to act), Response Time (how fast feedback appears), Toast (a feedback delivery mechanism)
**Tags:** design, hci, feedback

### Mapping
**Definition:** The relationship between a control and its effect in the world — steering wheel turns left → car turns left.
**Usage:** Use when evaluating whether a control's behavior matches user expectations. Good mapping is intuitive; poor mapping requires labels. Distinguish from Affordance (what it offers) and Mental Model (user's internal understanding).
**Related:** Affordance (what the control offers), Mental Model (user's expectation), Consistency (same mapping across the system)
**Tags:** design, hci, mapping

### Fitts' Law
**Definition:** The time to acquire a target is a function of the target's size and distance — larger, closer targets are faster to hit.
**Usage:** Apply when designing interactive elements: make primary actions larger, place them closer to where the user is looking/clicking, and put destructive actions in harder-to-reach positions.
**Related:** Hick's Law (decision time increases with options), Jakob's Law (users prefer familiar patterns), Target Size (minimum touch target of 44x44px)
**Tags:** design, hci, ergonomics

### Hick's Law
**Definition:** The time it takes to make a decision increases logarithmically with the number of choices.
**Usage:** Apply when designing menus, forms, and settings. Break complex choices into progressive disclosure. Distinguish from Fitts' Law (physical targeting speed) — Hick's is about cognitive load.
**Related:** Fitts' Law (physical targeting), Progressive Disclosure (revealing choices gradually), Cognitive Load (mental effort)
**Tags:** design, hci, decision-making

### Jakob's Law
**Definition:** Users spend most of their time on other websites/apps, so they prefer your site to work the same way as all the others.
**Usage:** Apply by following platform conventions rather than reinventing interactions. Users bring expectations from the rest of the web. Distinguish from Consistency (internal, within your product) — Jakob's Law is about external conventions.
**Related:** Consistency (internal patterns), Standard Conventions (accepted norms), Mental Model (user expectations)
**Tags:** design, hci, usability

## Perception

### Gestalt Principles
**Definition:** A set of psychological principles describing how humans visually group elements: Proximity (nearby items relate), Similarity (similar items group), Closure (we complete incomplete shapes), Figure-Ground (we separate foreground from background), Common Region (items in same boundary group), Continuity (smooth lines continue).
**Usage:** Apply when designing layout, data visualization, and component grouping. These principles explain why some layouts feel intuitive and others feel chaotic.
**Related:** Visual Hierarchy (importance ordering), Information Architecture (content organization), White Space (negative space)
**Tags:** design, psychology, perception, gestalt

### Visual Hierarchy
**Definition:** The arrangement of elements in order of importance, guiding the user's eye through the page via size, color, position, and spacing.
**Usage:** Apply to every screen design: primary actions should be most prominent, secondary less, tertiary minimal. Users should know where to look first without thinking.
**Related:** Information Architecture (content organization), Scanning Pattern (F-pattern, Z-pattern), Focal Point (the most prominent element)
**Tags:** design, layout, visual-hierarchy

### Scanning Pattern
**Definition:** The predictable path users' eyes follow when quickly browsing content — F-pattern (western, text-heavy) or Z-pattern (western, visual-heavy).
**Usage:** Apply when laying out content. Put key information along the natural scan path. Headlines, CTAs, and important content should sit on these predictable scan lines.
**Related:** Visual Hierarchy (importance ordering), Readability (how easy text is to read), Above the Fold (visible without scrolling)
**Tags:** design, layout, scanning-pattern

### Cognitive Load
**Definition:** The amount of mental effort required to use an interface — lower is better.
**Usage:** Use when evaluating whether an interface is overwhelming. Reduce cognitive load by using familiar patterns, progressive disclosure, clear labeling, and consistent layouts.
**Related:** Progressive Disclosure (revealing complexity gradually), Hick's Law (choice complexity), Mental Model (user expectations)
**Tags:** design, psychology, cognitive-load

### Mental Model
**Definition:** The user's internal understanding of how a system works, based on past experience with similar systems.
**Usage:** Use when designing interactions: align with users' existing mental models from other apps. Don't make users learn entirely new patterns unless the payoff is dramatic.
**Related:** Affordance (signaling how something works), Consistency (reinforcing mental models), Jakob's Law (users expect familiar patterns)
**Tags:** design, psychology, mental-model

## Methodology

### Atomic Design
**Definition:** A methodology for creating design systems by breaking interfaces into atoms (basic elements), molecules (element groups), organisms (complex sections), templates (page layouts), and pages (specific instances).
**Usage:** Use as a mental model for organizing component libraries. Helps teams talk about component granularity consistently. Distinguish from Design System (the implementation) — Atomic Design is a way to structure one.
**Related:** Design System (the result), Component Library (the code), Pattern Library (reusable solutions)
**Tags:** design, methodology, atomic-design

### Design System
**Definition:** A complete set of standards, components, patterns, and guidelines used to build and maintain digital products consistently.
**Usage:** Use to refer to the whole system: design tokens, component library, usage guidelines, accessibility standards, and governance processes. Distinguish from Component Library (just the code) and Style Guide (visual rules only).
**Related:** Component Library (implemented components), Design Token (atomic design values), Pattern Library (reusable solutions), Style Guide (visual rules)
**Tags:** design, methodology, design-system

### Design Token
**Definition:** A named, reusable design value — color, typography, spacing, shadow — stored as a platform-agnostic variable for consistency across implementations.
**Usage:** Use to encode design decisions as data rather than hard-coded values. Tokens enable theming, multi-platform consistency, and single-source-of-truth for design. Distinguish from CSS Custom Properties (one implementation of tokens).
**Related:** Design System (the container), Theme (a complete token set), Style Dictionary (token transformation tool)
**Tags:** design, tokens, design-system

### Component Library
**Definition:** A collection of reusable, tested UI components with documented APIs and usage guidelines, typically the code implementation of a design system.
**Usage:** Use to refer to the code assets (React components, web components, etc.) that implement design system specs. Distinguish from Design System (broader, includes guidelines+patterns) and Pattern Library (focused on solutions, not components).
**Related:** Design System (the parent), Pattern Library (solutions, not components), Style Guide (visual specifications)
**Tags:** design, development, component-library

### Pattern Library
**Definition:** A collection of reusable solutions to common design problems — empty states, error handling, confirmation flows, onboarding.
**Usage:** Use to capture and share interaction patterns beyond individual components. Distinguish from Component Library (code components) — patterns describe how components compose.
**Related:** Design System (parent), Component Library (building blocks), Anti-pattern (what NOT to do)
**Tags:** design, methodology, pattern-library

### Progressive Disclosure
**Definition:** A design pattern that shows only essential actions/info first and reveals additional complexity progressively as needed.
**Usage:** Apply to simplify complex interfaces without removing functionality. Show primary actions, hide advanced settings behind "More" or expandable sections. Distinguish from Progressive Enhancement (technical, from minimal to capable).
**Related:** Progressive Enhancement (technical strategy), Hick's Law (reducing choice complexity), Onboarding (first-run disclosure)
**Tags:** design, interaction, progressive-disclosure

### Progressive Enhancement
**Definition:** A development strategy that starts with a functional baseline and layers enhanced features on top for capable browsers.
**Usage:** Use when building web applications that must work for all users regardless of browser capability. Distinguish from Progressive Disclosure (UI pattern for reducing complexity) and Graceful Degradation (starts full-featured, degrades).
**Related:** Graceful Degradation (reverse approach), Progressive Disclosure (UI, not technical), Mobile-first (mobile as baseline)
**Tags:** design, development, progressive-enhancement

### Graceful Degradation
**Definition:** A strategy where a full-featured application is built first, then fallbacks are provided for less capable environments.
**Usage:** Use when enhancing existing applications for modern browsers while supporting legacy ones. The reverse of Progressive Enhancement. Distinguish from Fail Gracefully (system behavior on error).
**Related:** Progressive Enhancement (baseline-first), Fail Gracefully (error handling), Degraded Mode (operating with limited features)
**Tags:** design, development, graceful-degradation

## Accessibility

### WCAG (Web Content Accessibility Guidelines)
**Definition:** The international standard for web accessibility, organized into four principles: Perceivable, Operable, Understandable, Robust (POUR), with conformance levels A (minimum), AA (target), and AAA (advanced).
**Usage:** Target WCAG 2.2 AA as the minimum for any web product. Use the POUR framework to audit accessibility gaps. Distinguish from Section 508 (US law, largely aligned with WCAG) and ARIA (technical implementation).
**Related:** ARIA (technical attributes), Screen Reader (assistive tech), Keyboard Navigation (no-mouse operation), Color Contrast (minimum ratios)
**Tags:** design, accessibility, standards, wcag

### ARIA (Accessible Rich Internet Applications)
**Definition:** A set of HTML attributes that enhance accessibility of dynamic content and custom widgets for assistive technologies.
**Usage:** Use to add roles, states, and properties to custom components that native HTML can't express. First rule of ARIA: don't use it if you can use a native HTML element instead.
**Related:** WCAG (the standards), Screen Reader (the user agent), Focus Management (keyboard navigation), Role (the element's purpose)
**Tags:** design, accessibility, development, aria

### Screen Reader
**Definition:** Assistive technology that converts on-screen content to speech or braille, used by people who are blind or have low vision.
**Usage:** Test all UI changes with at least one screen reader (NVDA on Windows, VoiceOver on Mac). Ensure non-text content has text alternatives, custom controls have proper ARIA roles, and focus order is logical.
**Related:** WCAG (compliance standards), ARIA (technical bridge), Keyboard Navigation (operable without mouse), Alt Text (image description)
**Tags:** design, accessibility, screen-reader

### Keyboard Navigation
**Definition:** The ability to operate all functionality using only a keyboard, without requiring a mouse or touch.
**Usage:** Every interactive element must be reachable and operable via keyboard (Tab, Enter, arrow keys, Escape). Visible focus indicators are required. Distinguish from Shortcut Keys (accelerators) — Keyboard Navigation is about full operation.
**Related:** Focus Management (where keyboard focus is), Tab Order (navigation sequence), Focus Ring (visible indicator)
**Tags:** design, accessibility, keyboard-navigation

### Focus Management
**Definition:** The practice of programmatically controlling where keyboard focus moves during interaction, especially in dynamic interfaces.
**Usage:** Apply when content changes dynamically (modals open, content loads, items are removed). Focus must move to the new/changed content. Distinguish from Tab Order (the default navigation sequence) — Focus Management overrides default flow.
**Related:** Keyboard Navigation (general operation), Focus Trap (loop within a modal), Tab Order (the sequence)
**Tags:** design, accessibility, focus-management

### Color Contrast
**Definition:** The difference in luminance between text and its background, measured as a ratio. WCAG requires 4.5:1 for normal text, 3:1 for large text, and 3:1 for UI components.
**Usage:** Check all text and meaningful UI elements against WCAG contrast minimums. Never convey information through color alone — pair with icons, text, or patterns.
**Related:** WCAG (compliance), Color Blindness (deuteranopia, protanopia, tritanopia), Semantic Color (color with meaning)
**Tags:** design, accessibility, color-contrast

### Alt Text
**Definition:** A text alternative for images and non-text content, read by screen readers and displayed when images fail to load.
**Usage:** Every image needs alt text. Decorative images get empty alt (alt=""). Informative images describe their content and function. Distinguish from Caption (visible to everyone) — Alt Text is for assistive tech only.
**Related:** Screen Reader (the consumer), WCAG (requires alt text), Figure (HTML element for images with captions)
**Tags:** design, accessibility, images

## UX Patterns

### Onboarding
**Definition:** The process of guiding new users through initial setup, feature introduction, and value demonstration during their first experience.
**Usage:** Use for first-run experiences, feature announcements, or tutorial flows. Should be skippable and not required for repeat use. Distinguish from Empty State (post-onboarding, pre-data) and First-run Experience (broader than onboarding).
**Related:** Empty State (post-onboarding), First-run Experience (the whole first session), Tutorial (step-by-step guidance)
**Tags:** design, ux, onboarding

### Error Prevention
**Definition:** Design strategies that prevent errors before they happen, rather than handling them afterward — confirmation dialogs, input constraints, undo support.
**Usage:** Apply proactively: disable invalid submissions, validate inline, confirm destructive actions. Distinguish from Error Recovery (handling errors after they happen) — prevention is always better.
**Related:** Error Recovery (handling after), Confirmation (preventing accidental action), Forgiveness (undo, rollback)
**Tags:** design, ux, error-prevention

### Error Recovery
**Definition:** Design patterns that help users recover from errors after they occur — undo, error messages with solutions, auto-save, version history.
**Usage:** Provide when error prevention falls short. Good error recovery tells the user what happened, why, and what to do next. Distinguish from Error Prevention (stopping errors before they happen).
**Related:** Error Prevention (stop before), Undo (revert action), Forgiveness (allowing mistakes), Toast (error notification)
**Tags:** design, ux, error-recovery

### Forgiveness
**Definition:** The principle of designing interfaces that allow users to recover from mistakes easily — undo, confirm, archive instead of delete.
**Usage:** Apply to all destructive operations. If an action can't be undone, require explicit confirmation. Distinguish from Error Prevention (blocking the mistake) — Forgiveness lets it happen but allows recovery.
**Related:** Undo (action reversal), Confirmation (verification before action), Soft Delete (archive instead of delete)
**Tags:** design, ux, forgiveness

### Confirmation
**Definition:** A prompt asking the user to verify their intent before a potentially destructive or irreversible action.
**Usage:** Use for deletions, discarding changes, or any action with significant consequences. Distinguish from Notification (informs after) and Toast (no action required) — Confirmation requires explicit agreement.
**Related:** Modal (confirmation container), Dialog (confirmation in overlay), Undo (allows recovery without confirmation)
**Tags:** ui, interaction, confirmation

### Skeuomorphism
**Definition:** A design style that mimics real-world objects and materials — a digital notebook that looks like leather, a button with 3D shading.
**Usage:** Use for familiarity in contexts where users benefit from real-world analogies (calculator, notebook). Now largely replaced by Flat Design and Neumorphism in modern UI.
**Related:** Flat Design (minimal, no realism), Neumorphism (soft, extruded), Realism (broader aesthetic)
**Tags:** design, visual, skeuomorphism

### Flat Design
**Definition:** A minimalist design style characterized by clean, two-dimensional visuals, bright colors, and no gradients or shadows.
**Usage:** A modern default style prioritizing clarity and simplicity over visual realism. Distinguish from Material Design (adds depth via elevation) and Skeuomorphism (realism).
**Related:** Material Design (Google's approach, adds depth), Neumorphism (soft depth), Minimalism (broader aesthetic)
**Tags:** design, visual, flat-design

### Neumorphism
**Definition:** A design style using soft, extruded shapes that appear to be raised or recessed from the background, achieved with subtle shadows and highlights.
**Usage:** Use for decorative or low-interaction elements where visual softness is desired. Poor accessibility due to low contrast makes it unsuitable for primary UI.
**Related:** Flat Design (no depth), Skeuomorphism (real-world mimicking), Material Design (elevation, shadows)
**Tags:** design, visual, neumorphism

### Material Design
**Definition:** Google's design language based on physical surfaces and edges, using elevation, motion, and responsive layout.
**Usage:** A design system, not just a visual style. Includes tokens, components, motion guidelines, and accessibility standards. Distinguish from Flat Design (no depth metaphor) and Neumorphism (aesthetic only, no system).
**Related:** Design System (broader concept), Elevation (z-axis positioning), Motion Design (purposeful animation)
**Tags:** design, visual, material-design
