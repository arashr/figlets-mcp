# Design system — MD Gallery

Ground rules, color/accessibility standards, and token map for poster gallery UI. **Implementation reference:** `config/gallery.config.json` + `config/README.md`.

---

## Ground rules

1. **Accessibility first** — contrast, focus, motion, and readable type before visual flair. **Background colors are the anchor; foreground adapts** (see APCA section).
2. **Grid system: 8px** — spacing and sizing snap to an 8px base.
3. **Semantic colors over one-off hex** — prefer named tokens in config.
4. **Dark mode is chrome-only** — `darkTheme` affects the reader shell. Poster grounds keep their configured light-theme pairs.

---

## Accessibility — APCA

We use **APCA** for judging text/background pairs.

### Background first, foreground adapts

**The background is the design decision; foreground follows.**

---

## Color — OKLCH

**OKLCH** is the preferred color space for generation and mixing.

---

## 8px grid reference

| Token / element | Value | Grid |
|-----------------|-------|------|
| `theme.layout.pad` | `clamp(16px, 4vw, 56px)` | 16, 56 = 2×8, 7×8 |

---

## Token map (quick)

| Concern | Config path | CSS variable(s) |
|---------|-------------|-----------------|
| Page colors | `theme.colors` | `--config-paper`, `--config-ink`, … |

Full field reference: [`config/README.md`](../config/README.md).
