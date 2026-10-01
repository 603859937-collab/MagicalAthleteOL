# Playful race props

During a race, players and spectators can open **Interact**, choose another player (including a bot), and throw an egg or tomato. The dialog closes after throwing so the animated arc and splatter can be seen on the table. The latest throw is also shown in a compact line below the scores, including on the HTML/2D fallback.

The topbar entry occupies no permanent board space. Mobile uses a scrollable bottom dialog with large targets; desktop uses a centered dialog. The native dialog supports Escape, focus management, and background dismissal. Announcements and camera controls retain their own layout.

`THROW_PROP` carries `actionId`, `targetPlayerId`, and `item` (`egg` or `tomato`). The server validates membership, race phase, target, and a four-second per-sender cooldown. Successful action IDs are deduplicated; retries receive `ACTION_ACK`. The server broadcasts `PROP_THROWN` with a unique event ID, actor and target IDs/names, item, and `cooldownMs` to connected room participants.

These transient messages contain no game snapshot or revision. They do not update scores, positions, dice, decisions, timers, or the race playback queue. Cosmetic errors are handled separately from gameplay errors. Props do not survive a restart or play again on reconnect. At most four effects are mounted per client and they clear after 2.2 seconds; reduced-motion users see only a brief splash.

The prop meshes and splashes are native Three.js shapes. No new raster assets, external services, or gameplay physics are needed.
