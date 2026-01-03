# Handoff Note - Connect Store Button Issue

## Current Issue
The "Connect Store" button in the "My Stores" section is not working. When clicked, the dropdown menu does not appear.

## What Has Been Tried

1. **Event Listener Approach**: Switched from inline `onclick` handlers to event listeners attached after DOM rendering
2. **Event Propagation**: Added `stopPropagation()` and `preventDefault()` to prevent event bubbling
3. **Menu Visibility Flag**: Added `menuJustOpened` flag to prevent immediate closing by document click handler
4. **CSS Fixes**: 
   - Increased z-index to 10000
   - Added `!important` to `.visible` class
   - Added visibility and opacity properties
5. **Debugging**: Added extensive console logging to track function calls and menu state

## Current State

- The button click handler is being attached (console shows `[renderStores] Event listener attached to connect button`)
- The `toggleConnectMenu()` function is being called
- The menu element is found via `getElementById('connectMenu')`
- The menu's `visible` class is being toggled
- However, the menu does not visually appear

## Likely Root Cause

The menu is likely being created dynamically in `renderStores()` function, but there may be:
1. **Timing issue**: The event listener might be attached before the menu element exists in the DOM
2. **CSS specificity**: The menu might be hidden by a more specific CSS rule
3. **Parent container**: The menu's parent container might have `overflow: hidden` or positioning issues
4. **Multiple menu instances**: There are two menu instances in the code (static HTML and dynamically created), which might be causing conflicts

## Files to Check

- `index.html` line ~4267: `renderStores()` function where button is created
- `index.html` line ~4282: `toggleConnectMenu()` function
- `index.html` line ~328: `.connect-menu` CSS class
- `index.html` line ~1190: Static HTML menu (might conflict with dynamic one)

## Suggested Next Steps

1. **Check if menu element exists when button is clicked**: Add `console.log` to verify menu is in DOM
2. **Inspect computed styles**: Check if `display: block !important` is actually being applied
3. **Check parent container**: Verify the parent div with `position: relative` is correctly positioned
4. **Remove static menu**: Consider removing the static HTML menu (line ~1196) to avoid conflicts
5. **Test with simpler approach**: Try a minimal test - create menu outside of `renderStores()` to isolate the issue
6. **Check for JavaScript errors**: Look for any errors in console that might be preventing execution

## Code Location

- Button creation: `index.html` line ~4238-4260
- Event listener attachment: `index.html` line ~4265-4276
- Toggle function: `index.html` line ~4282-4302
- CSS: `index.html` line ~328-343

## Additional Context

The button is rendered inside `renderStores()` which is called on `DOMContentLoaded`. The menu dropdown should appear below the button when clicked, showing options for Salla, Shopify, Zed, and Custom store connections.

