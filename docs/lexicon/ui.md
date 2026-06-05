---
created: 2026-06-03
updated: 2026-06-04
category: lexicon
status: current
doc_kind: node
id: ui-glossary
summary: Glossary of UI and interaction concepts, overlays, and component patterns.
tags: [lexicon, ui, interaction]
---

# UI & Interaction

## Overlays

### Modal
**Definition:** A blocking overlay that prevents interaction with the rest of the page until dismissed, typically via a required action.
**Usage:** Use for critical confirmations, required decisions, or focused tasks that must complete before the user returns to the main flow. Not for non-critical info that can wait.
**Related:** Dialog (may be non-blocking), Popover (non-blocking, lightweight), Toast (auto-dismissing, no interaction required)
**Tags:** ui, overlay, interaction, modal

### Dialog
**Definition:** An overlay window that presents information or prompts for input, which may be blocking (modal) or non-blocking (modeless).
**Usage:** Use for multi-step forms, detail views, or confirmation flows within an overlay. Distinguish from Modals when the overlay can be dismissed without forced action.
**Related:** Modal (always blocking), Popover (attached to a trigger, usually single-action), Drawer (slides in from edge)
**Tags:** ui, overlay, interaction, dialog

### Popover
**Definition:** A non-blocking overlay anchored to a trigger element that displays contextual content and dismisses when clicking outside.
**Usage:** Use for secondary actions, quick previews, or contextual menus attached to a specific element. Not for critical flows that require a decision.
**Related:** Tooltip (text only, no interactive content), Dropdown (menu-style choices), Modal (blocking, full attention)
**Tags:** ui, overlay, interaction, popover

### Tooltip
**Definition:** A small text-only popup that appears on hover or focus, providing a brief label or description for an element.
**Usage:** Use for clarifying icon-only buttons, truncated content, or non-obvious UI controls. Never use for critical information, interactive content, or content the user needs to act on.
**Related:** Popover (can contain interactive content), Help Text (persistent, not hover-triggered)
**Tags:** ui, overlay, interaction, tooltip

### Drawer
**Definition:** A panel that slides in from the edge of the screen, typically used for secondary navigation, filters, or contextual settings.
**Usage:** Use for persistent secondary content that doesn't warrant a full page or modal. Distinguish from Sidebar (always visible, not toggled).
**Related:** Sidebar (persistent, not dismissable), Panel (can be inline), Modal (overlay from center)
**Tags:** ui, overlay, layout, drawer

### Toast
**Definition:** A brief, auto-dismissing notification that appears temporarily, usually at the edge of the screen.
**Usage:** Use for non-critical success/error/info feedback that doesn't require user action. Not for errors that need acknowledgement or actions that need confirmation.
**Related:** Notification (may persist, may be interactive), Banner (persistent inline message), Alert (modal or semantic)
**Tags:** ui, overlay, notification, toast

### Notification
**Definition:** A persistent or timed message informing the user of an event, update, or system state, often with action options.
**Usage:** Use for asynchronous events, system updates, or messages the user may want to act on later. Distinguish from Toast (temporary, no action needed).
**Related:** Toast (auto-dismissing), Banner (inline, page-level), Badge (count indicator only)
**Tags:** ui, overlay, notification

### Banner
**Definition:** A persistent, full-width inline message at the top of a page or section conveying important information.
**Usage:** Use for site-wide announcements, maintenance warnings, or policy notices that must be visible until dismissed. Distinguish from Toast (temporary, overlay).
**Related:** Toast (temporary overlay), Inline Alert (section-level), Notification (event-driven)
**Tags:** ui, layout, notification, banner

### Inline Alert
**Definition:** A message displayed within the page content, typically near the relevant element, indicating success, error, warning, or info.
**Usage:** Use for form validation feedback, operation results, or contextual status messages. Distinguish from Toast (temporary, not anchored to content).
**Related:** Toast (temporary overlay), Banner (full-width, page-level), Form Validation (field-level only)
**Tags:** ui, feedback, interaction, alert

### Dropdown
**Definition:** A menu that expands downward from a trigger to reveal a list of choices or actions.
**Usage:** Use for selecting one option from a list, or exposing secondary actions without cluttering the UI. Distinguish from Combobox (allows typing) and Select (form-native, no custom content).
**Related:** Select (form control, native), Combobox (searchable + selectable), Context Menu (right-click, position-based)
**Tags:** ui, input, navigation, dropdown

### Context Menu
**Definition:** A menu that appears on right-click (or long-press), offering actions relevant to the clicked element.
**Usage:** Use for power-user shortcuts and secondary actions. Never use as the only way to access functionality — always pair with visible controls.
**Related:** Dropdown (triggered by visible button), Menu Bar (top-level persistent menu)
**Tags:** ui, interaction, navigation, context-menu

## Layout

### Sidebar
**Definition:** A persistent vertical panel on the left or right side of the screen providing primary navigation or supplementary content.
**Usage:** Use for top-level navigation, workspace organization, or always-visible secondary content. Distinguish from Drawer (toggled, dismissable).
**Related:** Drawer (slides in, dismissable), Nav Rail (collapsed sidebar variant), Panel (content section, can be inline)
**Tags:** ui, layout, navigation, sidebar

### Panel
**Definition:** A contained section of a layout that groups related content, often with a header and footer.
**Usage:** Use for grouping settings, details, or secondary content within a page or workspace. Neutral term when the layout component doesn't need specific semantics.
**Related:** Section (HTML-semantic, no container chrome), Card (standalone unit, rounded, elevated), Pane (typically a split-view region)
**Tags:** ui, layout, container, panel

### Section
**Definition:** A distinct part of a page layout that groups related content under a heading.
**Usage:** Use as the default term for any grouped content area in a layout. Prefer over Panel when the container has no visual chrome.
**Related:** Panel (has header/footer chrome), Card (standalone unit), Container (generic wrapping element)
**Tags:** ui, layout, container, section

### Pane
**Definition:** A region within a split or multi-column layout, typically resizable or scrollable.
**Usage:** Use for regions in split views, code editors (editor pane, terminal pane), or any layout where content is divided into resizable areas.
**Related:** Panel (more structured, with chrome), Section (not resizable), Split View (the container holding panes)
**Tags:** ui, layout, container, pane

### Split View
**Definition:** A layout that divides the screen into two or more resizable panes.
**Usage:** Use for compare views, code editors with preview, or any layout requiring side-by-side content comparison. Not for simple page layouts.
**Related:** Pane (the regions within), Workbench (paned layout + tool windows), Sidebar (single, not resizable)
**Tags:** ui, layout, container, split-view

### Workbench
**Definition:** A flexible, multi-panel workspace layout with tool windows, editors, and panels that can be rearranged.
**Usage:** Use for IDEs, complex authoring tools, or dashboards where users customize their layout. More complex than a simple dashboard.
**Related:** Dashboard (read-only overview), Split View (fixed panes), Canvas (free-form, no panels)
**Tags:** ui, layout, workspace, workbench

### Container
**Definition:** A generic wrapping element that constrains width, provides padding, or groups child elements for layout purposes.
**Usage:** Use as the generic term for any element whose primary purpose is containing/wrapping other elements. Avoid overloading with semantic meaning.
**Related:** Panel (has visual chrome), Section (semantic grouping), Box (generic CSS term)
**Tags:** ui, layout, container

## Content Blocks

### Card
**Definition:** A standalone content unit with rounded corners, optional elevation, containing related information and actions.
**Usage:** Use for collections of items (dashboard cards, product cards, profile cards), where each item is self-contained and roughly equal in importance.
**Related:** Tile (grid-aligned, often no elevation), Widget (interactive, functional), List Item (linear, not self-contained)
**Tags:** ui, content, display, card

### Tile
**Definition:** A grid-aligned content unit, typically without elevation, used for gallery-style layouts or icon grids.
**Usage:** Use for image galleries, app launchers, or any grid where visual alignment matters more than container prominence. Distinguish from Card (elevated, more emphasis).
**Related:** Card (elevated, standalone), Grid (the layout pattern), Icon Button (single-action, not a container)
**Tags:** ui, content, display, tile

### Widget
**Definition:** A small, often interactive functional unit that performs a specific task or displays live data.
**Usage:** Use for dashboard components that show live data, perform actions, or provide tool-like functionality. Distinguish from Card (display-oriented, less interactive).
**Related:** Card (display-oriented), Component (generic), Mini-app (larger scope)
**Tags:** ui, content, interactive, widget

### Block
**Definition:** A generic content unit in a linear or stacked layout, typically in a feed, stream, or document.
**Usage:** Use as the generic term for items in a feed, stream, or page-builder context. Avoid when more specific terms apply (Card, Tile, Item).
**Related:** Card (more structured, standalone), Feed Item (contextual), Section (part of a document)
**Tags:** ui, content, layout, block

### Feed
**Definition:** A chronologically-ordered stream of content items, typically infinite-scrolling or paginated.
**Usage:** Use for activity streams, news feeds, timelines, or any reverse-chronological content list. Distinguish from Stream (real-time) and List (static).
**Related:** Stream (live updates), List (static, any order), Timeline (events by date, not necessarily social)
**Tags:** ui, content, timeline, feed

### List
**Definition:** A vertical arrangement of items, each typically containing text and optional metadata or actions.
**Usage:** Use for structured data display where items are read linearly. Generic term for any vertical item collection.
**Related:** Data Grid (tabular, multi-column), Table (formal tabular data), Feed (chronological, stream-oriented)
**Tags:** ui, content, display, list

### Data Grid
**Definition:** A rich tabular component supporting sorting, filtering, column resizing, inline editing, and row selection.
**Usage:** Use for complex data display requiring sorting, filtering, and interactive column management. Distinguish from Table (static, presentation-only) and List (single-column).
**Related:** Table (static, presentational), List (single-column, no grid), Spreadsheet (fully editable grid of cells)
**Tags:** ui, data, display, data-grid

### Table
**Definition:** A presentational grid of rows and columns displaying structured data in a static format.
**Usage:** Use for comparing structured data in rows and columns where interactivity (sorting, filtering, editing) is minimal. Prefer Data Grid when rich interaction is needed.
**Related:** Data Grid (interactive, feature-rich), List (single column, no grid), Matrix (multi-dimensional data)
**Tags:** ui, data, display, table

### Tree
**Definition:** A hierarchical display of items with parent-child relationships, expandable and collapsible.
**Usage:** Use for file browsers, organizational charts, category hierarchies, or any nested data that users navigate by expanding branches.
**Related:** Accordion (expandable sections, not hierarchical), List (flat, no nesting), Directory (file system context)
**Tags:** ui, navigation, data, tree

### Accordion
**Definition:** A vertically stacked set of expandable sections where showing one section may collapse others.
**Usage:** Use for FAQs, settings grouped by category, or content that benefits from progressive disclosure. Distinguish from Tabs (horizontal, always one visible) and Tree (hierarchical).
**Related:** Tab (horizontal, one-at-a-time), Stepper (sequential, numbered steps), Collapsible (single, independent)
**Tags:** ui, navigation, content, accordion

## Input

### Form
**Definition:** A structured collection of input fields with a submit action, used to collect, validate, and process user data.
**Usage:** Use for any data collection or configuration flow. Avoid using "form" when describing a single-input search or a multi-step wizard — keep Form for the standard submit-pattern.
**Related:** Wizard (multi-step form), Dialog (form in overlay), Search (single input, immediate results)
**Tags:** ui, input, interaction, form

### Wizard
**Definition:** A multi-step guided flow that leads the user through a task sequentially, with back/next navigation.
**Usage:** Use for complex setup processes, onboarding flows, or any task that benefits from linear progression. Distinguish from Form (single page, all fields visible).
**Related:** Stepper (step indicator, may not be navigable), Form (single-page), Onboarding (broader first-run experience)
**Tags:** ui, input, workflow, wizard

### Stepper
**Definition:** A visual indicator showing progress through a sequence of steps, often numbered, that may or may not allow non-linear navigation.
**Usage:** Use for multi-step flows where the user should see their progress and the remaining steps. Distinguish from Wizard (focus on the flow) — Stepper is the indicator, Wizard is the container.
**Related:** Wizard (the overall flow), Progress Bar (indeterminate or percentage), Pagination (page-based, not step-based)
**Tags:** ui, navigation, progress, stepper

### Combobox
**Definition:** An input that combines a text field with a dropdown list, allowing the user to type to filter or enter a custom value.
**Usage:** Use when the user should be able to either select from predefined options or type a custom value. Distinguish from Select (no typing) and Autocomplete (suggests, but doesn't require selection from list).
**Related:** Select (dropdown only, no typing), Autocomplete (suggests as you type), Dropdown (menu, not an input)
**Tags:** ui, input, selection, combobox

### Select
**Definition:** A form control that presents a list of options in a dropdown, allowing single or multiple selection from predefined values.
**Usage:** Use for choosing from a fixed set of options when the user doesn't need to type. Distinguish from Combobox (allows custom values) and Radio Group (fewer options, always visible).
**Related:** Combobox (searchable + custom values), Radio Group (2-6 visible options), Dropdown (generic menu, not form-native)
**Tags:** ui, input, selection, select

### Autocomplete
**Definition:** An input that suggests completions or options as the user types, which they can accept or ignore.
**Usage:** Use for search inputs, address fields, or any context where suggestions speed up data entry. Distinguish from Combobox (requires selection from list or custom value) — Autocomplete is purely assistive.
**Related:** Combobox (select-or-type), Search (no suggestions), Predictive Text (mobile keyboard)
**Tags:** ui, input, search, autocomplete

### Date Picker
**Definition:** A control that lets users select a date (and optionally time) from a calendar interface.
**Usage:** Use for date input where typing the date manually is cumbersome or error-prone. Provide manual text input as an alternative for power users.
**Related:** Calendar (read-only display), Time Picker (time only), Date Range Picker (start + end)
**Tags:** ui, input, date, date-picker

### Rich Text
**Definition:** An input field that supports formatted text (bold, italic, lists, links, etc.) beyond plain text.
**Usage:** Use for content creation, note-taking, or any scenario where users need formatting control. Distinguish from Code Editor (syntax highlighting, monospace) and Plain Text (no formatting).
**Related:** Code Editor (code-specific), Plain Text (no formatting), Markdown Editor (text + preview)
**Tags:** ui, input, editing, rich-text

## Navigation

### Tab
**Definition:** A horizontal navigation control that switches between related content sections, with one tab active at a time.
**Usage:** Use for switching between views within a page when the number of sections is small (2-8). Distinguish from Accordion (vertical, expandable) and Stepper (sequential, numbered).
**Related:** Accordion (vertical, expand), Stepper (sequential steps), Nav Bar (site-level navigation)
**Tags:** ui, navigation, layout, tab

### Breadcrumb
**Definition:** A secondary navigation aid showing the user's location in a hierarchy, with links to ancestor levels.
**Usage:** Use for deep navigation hierarchies where users benefit from understanding their path. Distinguish from Progress Indicator (step progress, not hierarchy) and Back Button (single level, no context).
**Related:** Progress Indicator (step-based), Back Button (single action), Site Map (full hierarchy)
**Tags:** ui, navigation, hierarchy, breadcrumb

### Pagination
**Definition:** A control that splits content across multiple pages with numbered page links and prev/next navigation.
**Usage:** Use when content is finite but large enough to warrant splitting. Distinguish from Infinite Scroll (continuous loading) and Load More (append, don't replace).
**Related:** Infinite Scroll (continuous), Load More (append), Virtual Scroll (DOM virtualization, no visual pager)
**Tags:** ui, navigation, content, pagination

### Menu Bar
**Definition:** A horizontal bar of top-level menu categories (File, Edit, View, etc.) that open dropdown menus.
**Usage:** Use for desktop-style applications with many actions organized into categories. Distinguish from Toolbar (action buttons, not dropdown categories) and Nav Bar (site navigation links).
**Related:** Toolbar (action buttons), Nav Bar (site navigation), Context Menu (right-click)
**Tags:** ui, navigation, menu, menu-bar

### Nav Rail
**Definition:** A collapsed sidebar variant showing only icons by default, expanding on hover or selection.
**Usage:** Use for applications where screen space is limited but users need quick access to top-level navigation sections. Distinguish from Sidebar (always expanded, text visible) and Bottom Nav (mobile pattern).
**Related:** Sidebar (always expanded), Bottom Navigation (mobile tabs), Icon Bar (always collapsed)
**Tags:** ui, navigation, layout, nav-rail

## States

### Empty State
**Definition:** The initial or zero-data state of a page, section, or list, showing a message and optional action when no content exists.
**Usage:** Use to guide users when a list, feed, or search returns no results. Should explain why the state exists and offer a next action. Distinguish from Loading (data pending) and Error (something went wrong).
**Related:** Loading State (data pending), Error State (failure), First-run (onboarding, not empty yet)
**Tags:** ui, state, empty-state

### Skeleton
**Definition:** A placeholder UI that mimics the page layout with grey blocks while content loads, showing the structure before data arrives.
**Usage:** Use for content-heavy pages where users benefit from seeing the imminent layout. Distinguish from Spinner (no layout preview) and Placeholder (single element, not full page).
**Related:** Spinner (circular progress, no layout), Placeholder (single element ghost), Loading Overlay (blocks interaction)
**Tags:** ui, state, loading, skeleton

### Spinner
**Definition:** A rotating indicator showing that an operation is in progress, with no indication of remaining time.
**Usage:** Use for short, indeterminate waits where showing a layout preview is unnecessary. Distinguish from Skeleton (shows layout preview) and Progress Bar (shows percentage).
**Related:** Skeleton (layout preview), Progress Bar (determinate progress), Loading Overlay (covers content)
**Tags:** ui, state, loading, spinner

### Placeholder
**Definition:** A faint hint or ghost text within an input field showing an example of expected input.
**Usage:** Use inside form fields to show examples (e.g., "john@example.com"). Distinguish from Label (persistent, above field) and Helper Text (below field, provides guidance).
**Related:** Label (persistent field name), Helper Text (guidance below field), Ghost Text (disappears on type)
**Tags:** ui, input, state, placeholder

### Loading Overlay
**Definition:** A semi-transparent overlay covering content with a loading indicator, blocking interaction during an operation.
**Usage:** Use when loading replaces or blocks existing content and you don't want the user to interact with stale data. Distinguish from Skeleton (shows future layout) and Spinner (inline, no overlay).
**Related:** Skeleton (shows layout), Spinner (inline, no blocking), Disabled State (interaction blocked, still visible)
**Tags:** ui, state, loading, overlay

### Error State
**Definition:** A UI state displayed when an operation fails, showing what went wrong and optionally suggesting recovery actions.
**Usage:** Use for failed operations, network errors, or any state where expected data isn't available. Should be actionable (retry, go back) whenever possible.
**Related:** Empty State (no data, not an error), Success State (operation completed), Offline State (connectivity lost)
**Tags:** ui, state, error

### Success State
**Definition:** A UI state confirming that an operation completed successfully, often with a checkmark or green indicator.
**Usage:** Use after form submission, data save, or any user-initiated action that succeeds. Can be inline (toast, banner) or full-page (confirmation).
**Related:** Error State (failed operation), Toast (temporary success message), Confirmation Dialog (requires acknowledgement)
**Tags:** ui, state, success, confirmation

## Buttons

### Primary Button
**Definition:** The most visually prominent button on a page or section, representing the primary or most important action.
**Usage:** Use for the main call-to-action (submit, save, continue). Only one per logical section. Distinguish from Secondary (less important, alternative) and Ghost (minimal, low emphasis).
**Related:** Secondary Button (alternative action), Ghost Button (minimal emphasis), FAB (mobile primary, floating)
**Tags:** ui, button, interaction, primary

### Secondary Button
**Definition:** A medium-emphasis button used for alternative actions that are important but not primary.
**Usage:** Use for cancel, back, or secondary calls-to-action alongside a primary button. Less visually prominent than Primary but more than Ghost.
**Related:** Primary Button (main action), Ghost Button (minimal), Tertiary Button (lowest emphasis)
**Tags:** ui, button, interaction, secondary

### Ghost Button
**Definition:** A minimal button with no visible border or background until hovered, used for low-emphasis actions.
**Usage:** Use for toolbar actions, inline controls, or anywhere buttons need to minimize visual noise. Distinguish from Icon Button (icon-only) — Ghost can have text.
**Related:** Icon Button (icon only, same minimal style), Text Button (always visible text, no border), Link Button (styled as hyperlink)
**Tags:** ui, button, interaction, ghost

### Icon Button
**Definition:** A button that displays only an icon (no text label), often circular or square.
**Usage:** Use for toolbar actions, close buttons, or when space is limited. Must have accessible label (aria-label) for screen readers. Distinguish from Ghost Button (may include text).
**Related:** Ghost Button (minimal, may have text), FAB (floating, circular, elevated), Toggle Button (on/off state)
**Tags:** ui, button, interaction, icon-button

### FAB (Floating Action Button)
**Definition:** A circular button that floats above the UI, typically representing the primary action on mobile screens.
**Usage:** Use for the single most common action on a mobile screen. Less common on desktop. Distinguish from Primary Button (fixed position, not floating) and Icon Button (in-toolbar, not floating).
**Related:** Primary Button (in-page, not floating), Icon Button (in-toolbar), Speed Dial (FAB that expands to reveal multiple actions)
**Tags:** ui, button, interaction, fab

### Toggle Button
**Definition:** A button that maintains an on/off or selected/deselected state, often appearing pressed when active.
**Usage:** Use for enabling/disabling a feature, switching between two states, or indicating a selected item in a toolbar. Distinguish from Checkbox (form control) and Switch (mobile-style on/off).
**Related:** Switch (mobile-style, horizontal), Checkbox (form selection), Toggle Group (multiple toggle buttons)
**Tags:** ui, button, interaction, toggle

### Split Button
**Definition:** A button with two parts: a primary action and a dropdown arrow for related alternatives.
**Usage:** Use when one action is most common but alternatives exist. The dropdown exposes save-as, delete-variants, or send-options while the main button triggers the default.
**Related:** Dropdown Button (all actions in dropdown), Primary Button (single action), Menu Button (all choices in menu)
**Tags:** ui, button, interaction, split-button

### Dropdown Button
**Definition:** A button that opens a dropdown menu of related actions, with no default action of its own.
**Usage:** Use for grouping multiple related actions under one button when no single default makes sense. Distinguish from Split Button (has a default action + alternatives).
**Related:** Split Button (default action + alternatives), Menu Button (synonym), Dropdown (general concept)
**Tags:** ui, button, interaction, dropdown-button

## Visual Design

### Color Palette
**Definition:** The set of colors used consistently across a UI, typically including primary, secondary, neutral, and semantic (success, warning, error) colors.
**Usage:** Refer to colors by semantic role (primary, accent, danger), never by appearance (blue, red). This allows theming without renaming.
**Related:** Design Token (the encoded value), Theme (the complete set of visual properties), Accessibility Contrast (ensuring readability)
**Tags:** ui, design, visual, color

### Typography
**Definition:** The system of typefaces, sizes, weights, line heights, and spacing used consistently across a UI.
**Usage:** Refer to text styles by their role (heading, body, caption, code), not by size (14px). A typographic scale ensures harmonious sizing.
**Related:** Font (the typeface file), Type Scale (the sizing system), Line Height (vertical spacing), Readability (how easy text is to read)
**Tags:** ui, design, visual, typography

### Elevation
**Definition:** The perceived depth of an element, typically implemented through box shadows, indicating its z-order relative to other elements.
**Usage:** Use elevation to indicate hierarchy — higher elevation elements (modals, dropdowns) appear to float above lower ones (cards, panels). Distinguish from Z-index (implementation) and Shadow (visual effect).
**Related:** Shadow (the visual effect), Z-index (the stacking order), Surface (the material metaphor)
**Tags:** ui, design, visual, elevation

### Spacing Grid
**Definition:** A consistent system of spacing increments (4px, 8px, 12px, 16px, etc.) used for margins, paddings, and gaps.
**Usage:** Use named spacing tokens (space-xs, space-md) rather than arbitrary pixel values to maintain visual rhythm. Distinguish from Grid (layout columns) and Gap (the space between grid/flex items).
**Related:** Layout Grid (column-based layout), Gap (CSS gap property), Padding (internal spacing)
**Tags:** ui, design, layout, spacing

### Dark Mode
**Definition:** A color scheme variant with light text on dark backgrounds, reducing eye strain in low-light environments.
**Usage:** Refer to Dark Mode as a theme variant, not a separate design. Colors adjust by semantic role, not by swapping light↔dark. Distinguish from High Contrast Mode (accessibility, not aesthetics).
**Related:** Theme (the complete visual variant), Light Mode (the default), High Contrast (accessibility-focused)
**Tags:** ui, design, accessibility, dark-mode

## Interaction

### Hover
**Definition:** The state when a user's pointer is positioned over an interactive element, triggering visual feedback.
**Usage:** Use hover to indicate interactivity (underline links, highlight buttons). On touch devices, hover states may trigger on first tap. Distinguish from Focus (keyboard navigation) and Active (while being pressed).
**Related:** Focus (keyboard indicator), Active (press state), Hover Card (popover triggered by hover)
**Tags:** ui, interaction, state, hover

### Focus
**Definition:** The visual indicator showing which element is currently selected for keyboard or screen reader interaction.
**Usage:** Always provide visible focus indicators for accessibility. Never remove focus outlines without providing an alternative. Distinguish from Hover (mouse-based) and Active (mouse-down).
**Related:** Hover (mouse-based), Focus Ring (the visible indicator), Tab Order (the sequence of focusable elements)
**Tags:** ui, interaction, accessibility, focus

### Drag and Drop
**Definition:** An interaction where the user picks up an element by pressing and holding, moves it to a new position, and releases to place it.
**Usage:** Use for reordering lists, moving items between containers, or file upload zones. Always provide keyboard alternatives (cut/paste, move buttons) for accessibility.
**Related:** Reorder (internal list reordering), File Upload (dropping files), Drag Handle (visual indicator for draggable item)
**Tags:** ui, interaction, dnd, drag-and-drop

### Gesture
**Definition:** A touch or motion-based interaction (swipe, pinch, tap, long-press) on touch-enabled devices.
**Usage:** Use for mobile interactions where gestures are natural. Always provide non-gesture alternatives. Distinguish from Click (mouse primary action) and Touch (generic contact).
**Related:** Swipe (horizontal gesture), Pinch (zoom gesture), Tap (touch equivalent of click), Long Press (hold gesture)
**Tags:** ui, interaction, mobile, gesture

### Swipe
**Definition:** A horizontal or vertical gesture where the user moves their finger across the screen, used for dismiss, navigation, or reveal actions.
**Usage:** Use for dismissing items (swipe to delete), navigating between views (swipe between tabs), or revealing hidden actions. Must be paired with visible alternatives.
**Related:** Drag (repositions, not a gesture shortcut), Scroll (continuous movement), Dismiss (closing via swipe)
**Tags:** ui, interaction, mobile, swipe
