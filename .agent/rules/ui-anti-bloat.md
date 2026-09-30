# Rule: Ruthless UI Anti-Bloat & Minimalism

AI tools inherently over-generate decorative icons, extra copy, and redundant wrappers. When designing, implementing, refactoring, or reviewing any UI or frontend code:

1. **Review & Cut Unnecessary Elements:** Review every single UI element before and after writing code. If removing it does not break core functionality or comprehension, cut it immediately.
2. **Zero Decorative Icons:** Never add icons (SVGs, emojis, Lucide/Heroicon components) next to text labels, buttons, headers, or nav links unless strictly necessary for interaction (e.g., an icon-only close button `×` or a compact search trigger).
3. **Flatten DOM & Eliminate Redundant Wrappers:** Strictly avoid unnecessary container `div`s, nested card wrappers (`card > card-inner > wrapper`), and superfluous structural framing. If a single element or CSS grid/flex layout can achieve the structure without extra containers, use it.
4. **Eliminate Fluff Copy:** Do not generate conversational helper text, explanatory paragraphs under headings, or obvious instructions (e.g., *"Manage your settings here"*). Let functional labels and data speak for themselves.
5. **Restraint Over Visual Gimmicks:** Resist gratuitous glassmorphism, multi-layered gradient borders, and distracting animations. Prioritize clean layout, typography, functional density, and fast rendering.
