# QCut Accessibility Rules

These ten rules catch the most frequent and most critical a11y bugs in a React + Electron (Chromium) environment. Add them to your lint setup and PR checklist first.

| # | Rule | Why It Matters |
|---|------|----------------|
| **1** | **Provide a meaningful `alt` text for every image/icon that requires it.** | Screen-reader users rely on `alt`; missing or vague descriptions leave them with zero context. |
| **2** | **Never place `aria-hidden="true"` on focusable elements.** | The element is still tabbable, but the assistive tech can't read it – a dead end for keyboard users. |
| **3** | **Every `<button>` *must* specify `type="button"` or `type="submit"`.** | Avoids accidental form submission and clarifies intent. |
| **4** | **Ensure every `<a>` tag contains meaningful, screen-reader-friendly content and a valid `href`.** | "Empty" or icon-only links announce as "link" with no context or go nowhere. |
| **5** | **If you add `onClick`, also support keyboard (`onKeyDown`/`onKeyUp`).** | Click-only handlers are unusable via keyboard or assistive switches. |
| **6** | **Give every SVG icon a `<title>` element that describes its purpose.** | Without it, readers just announce "graphic" or skip the icon entirely. |
| **7** | **Do not set `tabIndex` on non-interactive elements.** | Arbitrary focus order confuses keyboard navigation and breaks logical flow. |
| **8** | **Use semantic elements instead of roles (`<button>` > `<div role="button">`).** | Native elements come with keyboard focus, states, and ARIA roles out of the box. |
| **9** | **Heading tags (`<h1>` … `<h6>`) must contain real, visible text (not hidden via `aria-hidden`).** | Screen readers rely on the heading hierarchy for quick navigation. |
| **10** | **For every table header `<th>`, set the correct `scope` ("row", "col").** | Gives assistive tech enough info to announce the correct header–cell relationship. |

## Quick Checklist

- [ ] All images have meaningful `alt` text
- [ ] No `aria-hidden` on focusable elements
- [ ] All buttons have explicit `type`
- [ ] All links have content and valid `href`
- [ ] Click handlers have keyboard equivalents
- [ ] SVG icons have `<title>` elements
- [ ] No `tabIndex` on non-interactive elements
- [ ] Semantic HTML over ARIA roles
- [ ] Headings contain visible text
- [ ] Table headers have `scope`
