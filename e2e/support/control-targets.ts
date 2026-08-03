/**
 * Which control sizes this template's shipped kit is allowed to render below the touch floor. The floor
 * itself is `CONTROL_MIN_SIZE_PX` in `./geometry` — never restated here, and asserted against in
 * `control-targets.test.ts` so a dead entry at or above the floor cannot accumulate.
 *
 * Measured, not assumed: the geometry harness reported exactly two heights under the floor across every
 * route and every content state — `40` (`Button`, from `h-10` and `size-10`) and `36` (`Input`, from
 * `h-9`). Both are shadcn's default scale, which this template deliberately ships unaltered.
 *
 * This is a RATCHET, not an amnesty. Raising the whole kit to 44 changes the visual scale of every app
 * scaffolded from this template, which is the consuming app's design decision rather than a defect to
 * fix here — but a control at any OTHER size below the floor is new debt and fails the gate. Keying on
 * the exact rendered size is what makes that true: a 38px control matches nothing here.
 *
 * Exit condition: when a consuming app raises the kit to the touch floor, delete the entry rather than
 * widening it.
 */

export interface AcceptedControlTarget {
    /** Rendered height, rounded. */
    height: number;
    reason: string;
    /**
     * Rendered width, rounded — consulted ONLY for a control with no text label, where width matters
     * as much as height. `null` means this entry never excuses a narrow icon-only control.
     */
    width: number | null;
}

export const ACCEPTED_CONTROL_TARGETS: readonly AcceptedControlTarget[] = [
    {
        height: 40,
        width: 40,
        reason: 'Button: shadcn default scale (`h-10`, and `size-10` for the icon variant).'
    },
    {
        height: 36,
        width: null,
        reason: 'Input: shadcn default scale (`h-9`). Never excuses an icon-only control.'
    }
];

export interface ControlTarget {
    hasTextLabel: boolean;
    height: number;
    width: number;
}

export const isAcceptedControlTarget = ({ hasTextLabel, height, width }: ControlTarget): boolean =>
    ACCEPTED_CONTROL_TARGETS.some(
        (accepted) =>
            Math.round(height) === accepted.height &&
            (hasTextLabel || (accepted.width !== null && Math.round(width) === accepted.width))
    );
