# Brand anchor and color range mismatch

November 7, 2026. Investigation followed by user-approved implementation.

## Confirmed evidence

The retained dummy_ds_4 designer-intake config stores color.scale as 0-100 and the exact primary #FFC850 and secondary #B52840. Its generated ramps nevertheless use 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950.

The core generator's SCALES table supports 50-950, 100-900, and 0-1000. It does not support the 0-100 label advertised by intake. Unknown keys silently fall back to 50-950 while the config and summary retain the requested label. Read-only reproduction returns the exact reported anchor summary: primary #FFC850 at 200 and secondary #B52840 at 600. Those names cannot describe a 0-100 ramp.

Semantic brand templates are a second issue. color/surface/brand starts at primary/500 in both modes instead of using the supplied primary anchor. Generated contrast adjustment can select a different background step. Other brand-related roles also use fixed canonical step numbers. The screenshot shows primary/400 in both modes. The active saved snapshot, currently named dummy_ds_6, confirms those aliases and a 50-950 primitive inventory. The precise historical operation that selected 400 is not captured, so it is not attributed to a specific repair call.

## Approved implementation

- Add genuine 0-100 support through a shared scale definition/resolver used by intake, generation, semantic reference resolution, validation, and reporting. Do not silently substitute another scale.
- Preserve the exact supplied brand hex at its resolved valid step in the selected scale. The default main brand semantic role uses that anchor; differentiated semantic variants can use other evaluated steps and must be represented as such in the preview.
- Adapt foreground/icon semantic aliases within existing ramps for contrast. Do not silently replace the main brand surface anchor or alter primitive values. Unresolved contrast stays advisory or can be continued under the already approved contrast policy.
- Summaries must describe actual generated step names, hex values, and semantic aliases. A requested label alone is not verification of the resulting scale.

## Regression coverage

1. Intake to generation to Bridge payload preserves 0-100 with no primitive step labels above 100, and reports the actual range.
2. The supplied primary and secondary hex values remain exact at their valid anchor steps; summaries agree with the inventory.
3. Default brand semantics use the actual primary anchor rather than a fixed midpoint. Foreground/icon adaptation does not change that anchor or primitives.
4. All canonical semantic template roles resolve correctly across supported scale ranges without collapsing to one endpoint.
5. Existing explicit semantic assignments remain unchanged, and existing 50-950 and 100-900 behavior is covered for compatibility.
6. Unsupported ranges produce an explicit input problem instead of a false successful fallback.

Implementation uses the shared core scale resolver, existing intake/prepare/setup surfaces, and existing Bridge executor. There is no new public tool or Bridge mutation path. Readback detects observed scales and semantic brand anchors. Existing explicit semantic assignments remain literal; invalid references are reported rather than clamped.

The corrected 0-100 result for the supplied colors uses primary/10 for #FFC850 and secondary/60 for #B52840. These are computed anchors in the requested range, not relabeled historical steps. Generated main brand semantics retain the exact primary in both modes; foregrounds adapt, and unresolved contrast follows the existing continuation policy.

Verification: 145/145 test files pass. Build, lint, plugin packaging smoke, and whitespace checks pass. Automated integration executes real Bridge setup code against a simulated Figma environment, not the live file. No live Figma changes, host restart, commit, or release in this task. The existing incorrect live inventory still needs a separately reviewed repair. Refresh the agent-host server before using the changed setup logic.
