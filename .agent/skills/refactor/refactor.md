---
trigger: always_on
---

# Agent Rule: Code Refactoring & Documentation

## 1. Variable Naming (The "can_be_long" Protocol)

- Variables must be named based on their logical function.
- **Strict Rule:** Shorthand is prohibited (e.g., no `i`, `tmp`, `val`).
- **Permission:** Variable names **can_be_long**. Priority is given to semantic clarity over character count.
- **Context:** If a variable relates to the physics engine or New Zealand data sets, include the specific domain in the name (e.g., `nz_economic_flow_rate`).

## 2. Documentation Style (The Tutorial Protocol)

- Every function and logic branch must be documented as if it were a "How-to-Code" tutorial.
- **What:** Describe exactly what the following block of code is doing.
- **Why:** Explain the reasoning or the "physics" behind the logic.
- **Style:** Use a friendly, instructional tone.

## 3. Implementation Example

```javascript
// WHAT: Calculating the density of the fluid at a specific grid point.
// WHY: We use the pressure-to-mass ratio here to ensure the simulation
// stays stable even when the velocity values spike.
const fluid_density_at_current_coordinate = pressure / mass_constant;
```
