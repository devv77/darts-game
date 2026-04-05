# Milestone 2: Modern UI + Custom Numpad

## Completed
- Replaced native `<input type="number">` with custom on-screen numpad (no keyboard popup on mobile)
- Numpad has digits 0-9, Clear (C), and Submit (OK) buttons
- Max value capped at 180, max 3 digits
- Updated all border-radius to use CSS variables (--radius: 1rem, --radius-pill: 2rem)
- Rounded pill-shaped buttons for player cards, player selection, undo, multiplier toggles
- Added hover/active states with subtle scale transforms
- Added backdrop-filter blur on game-over overlay
- Improved stat items with subtle background
- All touch targets remain >= 48px minimum

## Files Modified
- public/css/app.css — full restyle with rounded/modern design
- public/game.html — replaced input+submit with custom numpad grid
- public/js/x01-view.js — numpad key handler logic (replaces old input handler)

## Next
- Run `npm install && npm run dev` to test the application
- Test all three game modes end-to-end
