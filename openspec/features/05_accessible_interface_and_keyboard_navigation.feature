@domain @accessibility @ui
Feature: Accessible Interface Styling and Keyboard Focus
  As an audiobook studio operator
  I want an interface that complies with WCAG 2.1 AA accessibility standards and full keyboard navigation
  So that all controls are legible against dark glass panels and operatable without mouse interaction

  Background:
    Given the desktop application renderer loaded with dark glass theme tokens

  Rule: Interactive controls must satisfy minimum contrast ratios and present visible keyboard focus rings

    @UI-01
    Scenario: Primary button text contrast meets WCAG 2.1 AA threshold
      Given a primary call-to-action button rendered with white text on crimson background
      When the accessibility contrast evaluator computes relative luminance against `#c5504c`
      Then the measured contrast ratio is at least 4.5 to 1
      And brand hue and saturation remain preserved according to `brand_safe_contrast`

    @UI-02
    Scenario: Secondary button utility text overrides maintain readability
      Given a secondary button configured with a colored utility class on dark glass `#304b75`
      When the renderer applies colored text tokens for purple, coral, gold, emerald, or neon blue
      Then all colored text variants achieve at least 4.5 to 1 contrast ratio
      And the button text remains readable without visual vibration

    @UI-03
    Scenario: Keyboard focus ring visibility on tab navigation
      Given a keyboard user navigating across controls using the Tab key
      When an interactive button receives focus via keyboard navigation
      Then a high-contrast gold outline with 2px offset appears on the focused element
      And the focus ring satisfies WCAG 2.1 SC 2.4.7 focus visible requirements

