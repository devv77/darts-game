# Milestone 3: AI Player System

## Completed
10-level AI opponent system for all three game modes (501, 301, Cricket).

### AI Engine (server/ai-engine.js)
- Real dartboard geometry using clockwise segment order [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5]
- Per-dart throw simulation: miss check -> ring accuracy (treble/double/single) -> scatter to adjacent segments
- Doubles have separate random chance — lower levels miss doubles much more (5% at Lv.1, 75% at Lv.10)
- Each dart is individually randomized — no two turns are the same

### 10 Difficulty Levels
| Lv | Name | Target% | Treble% | Double% | Miss% | Scatter |
|----|------|---------|---------|---------|-------|---------|
| 1 | Beginner | 20 | 3 | 5 | 25 | +-3 |
| 2 | Novice | 28 | 5 | 10 | 20 | +-3 |
| 3 | Casual | 36 | 10 | 15 | 15 | +-2 |
| 4 | Pub Player | 44 | 15 | 20 | 12 | +-2 |
| 5 | Club Player | 52 | 22 | 28 | 9 | +-2 |
| 6 | League | 60 | 30 | 35 | 7 | +-1 |
| 7 | County | 68 | 38 | 42 | 5 | +-1 |
| 8 | Semi-Pro | 76 | 46 | 52 | 3 | +-1 |
| 9 | Pro | 85 | 55 | 62 | 2 | +-1 |
| 10 | World Class | 93 | 65 | 75 | 1 | +-1 |

### X01 Strategy
- Lv.1-3: Aim at single 20 (safer), attempt checkout only when <= 40
- Lv.4-6: Aim at treble 20, use checkout table for scores <= 120
- Lv.7-10: Aim at treble 20, use full checkout table (2-170)
- Reuses existing checkout-table.js for optimal finish paths

### Cricket Strategy
- Lv.1-3: Random unclosed number, mostly singles
- Lv.4-6: Target highest unclosed number, aim trebles to close faster
- Lv.7-10: Advanced — defends threatened numbers, finishes partially closed numbers, scores offensively on closed numbers opponents haven't closed

### Server Integration
- AI turns trigger automatically after each human turn (1-3 second random delay)
- Race guard prevents duplicate triggers
- Recursive check handles consecutive AI players
- Same handleX01Turn/handleCricketTurn pipeline — no duplicated game logic

### UI
- Lobby: "Add AI Opponent" form with level selector (1-10)
- AI players shown with dashed border, colored by difficulty (green->red gradient)
- AI badge on scoreboard names
- "AI is thinking..." pulsing indicator during AI turns, human input hidden
- AI-thinking socket event for immediate visual feedback

## Files Created
- server/ai-engine.js

## Files Modified
- server/db.js — is_ai, ai_level columns
- server/routes/players.js — accepts AI fields
- server/socket-handler.js — checkAndTriggerAiTurn() wired into all turn handlers
- public/index.html — AI form in lobby
- public/js/lobby.js — AI creation, badges, color palette
- public/game.html — AI thinking indicator div
- public/js/x01-view.js — hide input during AI turn, ai-thinking event
- public/js/cricket-view.js — same
- public/js/scoreboard.js — AI tag on names
- public/css/app.css — AI styles (badges, thinking animation, keyframes)

## Next
- Run `npm install && npm run dev` to test
- Create AI at levels 1, 5, 10 and play against them in 501 and Cricket
- Verify randomness and difficulty scaling
