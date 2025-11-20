## 1) What is the error?
- React warning: “Function components cannot be given refs. Did you mean to use React.forwardRef()? Check the render method of `Primitive.button.SlotClone`.”
- Likely caused by passing `ref` through a Radix `asChild`/`Slot` button without forwarding the ref to a DOM node.
- Impact: ref-based behaviors (focus, measurement) won’t work and console noise persists.

## 2) Function flow (where ref likely passes)
1. Caller renders Radix button with `asChild` or uses a custom button wrapper.
2. Ref is supplied by parent (e.g., for focus/measure).
3. Slot renders the child component (`Primitive.button.SlotClone`).
4. Child is a function component that does **not** forward the ref to an underlying DOM element.
5. React warns and the ref is effectively dropped.

## 3) Relevant files to inspect
- `qcut/apps/web/src/components/ui/button.tsx` (Radix-based button wrapper).
- Any Radix button usage with `asChild` in the editor UI, especially panel controls (stack trace: `Primitive.button.SlotClone`).
- `qcut/apps/web/src/components/editor/preview-panel.tsx` (in trace).
- `qcut/apps/web/src/components/editor/panel-layouts.tsx` (parents in trace).

## 4) Quick remediation plan
- Locate the component rendered as `Primitive.button.SlotClone` (likely `Button` with `asChild`).
- Ensure that child component is wrapped in `forwardRef` and passes the ref to the underlying DOM element (e.g., `<button ref={ref} ... />`). If the ref is unused, drop it.
- Implemented stopgap: removed ref forwarding from `Button` when `asChild` is used (`qcut/apps/web/src/components/ui/button.tsx`) to prevent refs from landing on components that cannot handle them.
- Next step if ref is needed: add `forwardRef` to any custom child passed via `asChild`, then restore ref forwarding inside `Button`.
- Re-test the interaction that logs the warning to confirm it disappears.
