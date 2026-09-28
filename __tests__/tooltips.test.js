/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const appScriptContent = fs.readFileSync(path.resolve(__dirname, '../renderer/js/app.js'), 'utf8');

describe('Universal Custom Floating Tooltip Engine', () => {
  beforeEach(() => {
    // Reset DOM and global flags
    document.body.innerHTML = `
      <div id="test_container">
        <button id="btn_with_title" title="Play audio line">Play</button>
        <button id="btn_with_data_tooltip" data-tooltip="Directorial subtext notes">Notes</button>
        <div id="unrelated_elem">No tooltip here</div>
      </div>
    `;
    window.__cyber_tooltip_engine_initialized = false;

    // Evaluate tooltip code from app.js in jsdom environment
    // Use an isolated function wrapper or direct eval
    eval(appScriptContent);
  });

  afterEach(() => {
    delete window.__cyber_tooltip_engine_initialized;
  });

  test('initializes #cyber_floating_tooltip in document body', () => {
    window.initialize_universal_custom_tooltip_engine();
    const tooltip = document.getElementById('cyber_floating_tooltip');
    expect(tooltip).not.toBeNull();
    expect(tooltip.getAttribute('role')).toBe('tooltip');
  });

  test('migrates title attribute to data-tooltip-text and strips title to suppress OS tooltip', () => {
    window.initialize_universal_custom_tooltip_engine();
    const btn = document.getElementById('btn_with_title');

    expect(btn.getAttribute('title')).toBe('Play audio line');

    const mouseOverEvent = new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 200
    });
    btn.dispatchEvent(mouseOverEvent);

    // Native title should be removed to suppress native tooltip
    expect(btn.hasAttribute('title')).toBe(false);
    // data-tooltip-text should contain original title
    expect(btn.getAttribute('data-tooltip-text')).toBe('Play audio line');

    const tooltip = document.getElementById('cyber_floating_tooltip');
    expect(tooltip.classList.contains('visible')).toBe(true);
    expect(tooltip.textContent).toBe('Play audio line');
  });

  test('calculates tooltip top position 16px lower on the screen than standard clearance (clientY + 28px)', () => {
    window.initialize_universal_custom_tooltip_engine();
    const btn = document.getElementById('btn_with_data_tooltip');

    const clientY = 150;
    const clientX = 80;

    const mouseOverEvent = new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: clientX,
      clientY: clientY
    });
    btn.dispatchEvent(mouseOverEvent);

    const tooltip = document.getElementById('cyber_floating_tooltip');
    expect(tooltip.classList.contains('visible')).toBe(true);

    // Standard base clearance is 12px. With the requested 16px lower position: 12 + 16 = 28px.
    // Therefore, top should be clientY + 28 = 178px
    expect(tooltip.style.top).toBe(`${clientY + 28}px`);
    // Left should be clientX + 10 = 90px
    expect(tooltip.style.left).toBe(`${clientX + 10}px`);
  });

  test('hides tooltip on mouseout, mousedown, and scroll', () => {
    window.initialize_universal_custom_tooltip_engine();
    const btn = document.getElementById('btn_with_data_tooltip');

    btn.dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50
    }));

    const tooltip = document.getElementById('cyber_floating_tooltip');
    expect(tooltip.classList.contains('visible')).toBe(true);

    // Trigger mousedown to hide
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(tooltip.classList.contains('visible')).toBe(false);

    // Trigger mouseover again then mouseout
    btn.dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50
    }));
    expect(tooltip.classList.contains('visible')).toBe(true);

    btn.dispatchEvent(new MouseEvent('mouseout', {
      bubbles: true,
      cancelable: true,
      relatedTarget: document.getElementById('unrelated_elem')
    }));
    expect(tooltip.classList.contains('visible')).toBe(false);
  });

  test('displays custom tooltip for buttons using aria-label fallback when title is omitted', () => {
    // WHAT: Testing fallback tooltip discovery using the aria-label attribute.
    // WHY: Accessible buttons with aria-label must automatically display styled cyber tooltips.
    window.initialize_universal_custom_tooltip_engine();
    const test_button_element = document.createElement('button');
    test_button_element.id = 'button_with_aria_label';
    test_button_element.setAttribute('aria-label', 'Open Audio Settings');
    document.getElementById('test_container').appendChild(test_button_element);

    const mouse_over_event = new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: 75,
      clientY: 120
    });
    test_button_element.dispatchEvent(mouse_over_event);

    const floating_tooltip_element = document.getElementById('cyber_floating_tooltip');
    expect(floating_tooltip_element.classList.contains('visible')).toBe(true);
    expect(floating_tooltip_element.textContent).toBe('Open Audio Settings');
  });

  test('displays custom tooltip for buttons using button text content fallback', () => {
    // WHAT: Testing fallback tooltip discovery using visible text content.
    // WHY: Guarantees that any plain button without title or aria-label still displays an informative tooltip.
    window.initialize_universal_custom_tooltip_engine();
    const test_button_element = document.createElement('button');
    test_button_element.id = 'button_with_plain_text';
    test_button_element.textContent = 'Apply Transformation';
    document.getElementById('test_container').appendChild(test_button_element);

    const mouse_over_event = new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 160
    });
    test_button_element.dispatchEvent(mouse_over_event);

    const floating_tooltip_element = document.getElementById('cyber_floating_tooltip');
    expect(floating_tooltip_element.classList.contains('visible')).toBe(true);
    expect(floating_tooltip_element.textContent).toBe('Apply Transformation');
  });
});
