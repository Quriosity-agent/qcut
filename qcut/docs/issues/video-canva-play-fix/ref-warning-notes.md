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
- `src/components/ui/button.tsx` (or equivalent Radix-based button wrapper).
- Any Radix button usage with `asChild` in the editor UI, especially around panel controls (see stack trace: `Primitive.button.SlotClone`).
- `qcut/apps/web/src/components/editor/preview-panel.tsx` (involved in stack trace).
- `qcut/apps/web/src/components/editor/panel-layouts.tsx` (parent structure in stack trace).
