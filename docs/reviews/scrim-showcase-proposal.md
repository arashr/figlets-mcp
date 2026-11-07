# Scrim showcase preview

November 6, 2026. Status: revised scope approved and implemented. Full regression suite: 139/139 test files passes. Live visual verification remains pending. Preserve the existing swatch design, not a new layout.

See [visual preview](scrim-showcase-preview.svg). The preview uses illustrative neutral endpoints; implementation must use existing design-system neutral variables.

## Proposed result

- User correction: scrims appear at the end of the Primitive Colors section, in the existing primitive swatch table. Do not create a separate Scrims section. Keep their special layered swatches out of the ordinary contrast-swatch path, including composed-color scrims.
- Reuse the existing ramp-group and swatch layout, including typography, group headings, step labels, metadata placement, spacing, widths, heights, and corner treatment. Keep the existing black and white group structure and opacity ordering. Do not add a new table, card design, explanatory subtitle, or percentage-label format. Other showcase sections retain their order.
- Show one swatch per scrim, without the second contrast row or generic AA/AAA badges.
- Each swatch has one neutral background layer beneath the actual bound scrim layer: light neutral for black scrims, dark neutral for white scrims. Use contrasting existing neutral values for other scrim colors.
- Bind both layers to existing variables. Preserve real scrim transparency without flattening it into an opaque RGB or multiplying alpha twice.
- Retain existing token labels and metadata exactly where the other swatches place them. Do not rename tokens, change values, or add new labels.
- On regeneration, keep all primitive scrim groups after every ordinary ramp in Primitive Colors. Remove legacy generated standalone Scrims sections. Do not display semantic scrim aliases as primitive tokens.
- If the required scrim or neutral source cannot be resolved, report the missing demonstration data. Do not invent a token or silently display a fabricated 50% overlay.

## Current source findings

Primitive ramp classification relies on resolved alpha, so composed scrims can enter the generic two-half contrast swatch path. A dedicated scrim section already exists at the end of generation. Full showcase regeneration removes generated sections first, so the old prior-position lookup did not provide useful position preservation. Its demo uses a single painted frame rather than a separately bound neutral backplate and scrim layer. Do not adopt its different table layout for this adjustment. Reuse the existing color ramp swatch design and adjust only scrim placement, the second contrast half, and the neutral backing layer. Extend these existing rendering paths; no new public tool or parallel showcase workflow is needed.

## Tests after approval

1. Raw and composed scrims do not appear in ordinary color ramps or duplicate sections.
2. Scrim groups remain last inside Primitive Colors on first generation and refresh, with no separate generated Scrims section. Existing full-showcase regeneration rebuilds generated sections; stable section IDs are not promised.
3. Every demo contains one neutral backplate and the bound scrim overlay; resolved black/white composites match the expected alpha.
4. No second contrast row or generic AA/AAA badge is generated for scrims.
5. Actual opacity ordering, token labels, and both variable bindings are preserved.
6. Missing neutral or scrim data produces a useful limitation rather than an invented demo.

Approval received: the existing swatch design with only the three requested adjustments and regression tests. Implemented using the existing swatch row and contrast-swatch helpers, with a scrim-only layered branch. Raw/composed values use the existing variable resolver; missing source data produces warnings rather than fabricated swatches. Bridge build: 1.3.0+dev.20261106.5. The SVG illustrates layering and retained group/step structure; actual typography and styling must reuse the current design-system-backed renderer, not substitute the SVG font. Live showcase regeneration requires approval of its actual write plan.

November 6 placement correction: the user explicitly clarified the end of Primitive Colors, not the end of the showcase. Bridge 1.3.0+dev.20261106.7 moves the existing scrim rows into the primitive table. Full-render regression fails before this correction and passes afterward.

November 6 inset adjustment: user supplied a visual reference requesting a visible neutral border around each scrim. Bridge 1.3.0+dev.20261106.8 adds 8px padding on all four sides, keeps the neutral backplate full size as an absolute layer, and lets the rounded scrim overlay fill the inset area. Outer dimensions, grouping, labels, variable bindings, and placement inside Primitive Colors remain unchanged. Helper and full-render tests cover the padding, backplate positioning, and resizing behavior.
