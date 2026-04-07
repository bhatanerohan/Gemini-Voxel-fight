# Arena Heuristics

Use these heuristics when the request is about combat readability, flow, or map quality rather than exact coordinates.

## Layout Priorities

1. Landmark first
   - Build one center piece or landmark that explains the map at a glance.
2. Route structure second
   - Center route should be fastest and most exposed.
   - Flank routes should be safer or offer better angles, not both.
3. Cover third
   - Place cover where players make decisions: approach, hold, cross, disengage.
4. Height last
   - Add high ground only when it changes fight geometry in a useful way.

## Good Deathmatch Whitebox Patterns

- Strong center with ring or lane pressure around it
- Symmetrical team-side access with small asymmetrical cover details only if balance remains clear
- Mid-field cover at commitment points, not every few units
- Long sightlines broken by a few deliberate blockers instead of many tiny props
- High ground that can be challenged quickly

## Avoid

- Too many pieces that all do the same job
- Narrow chokepoints with no alternate route
- High ground with no contest path
- Cover directly on top of spawns
- Decorative clutter that turns aiming and movement into collision noise

## Whitebox Review Questions

- Can a player understand the map in five seconds from each spawn?
- Is there a clear center fight area?
- Does each team have at least one reliable route to mid?
- Are the strongest sightlines answerable by cover or alternate elevation?
- Are jumpable shortcuts intentional rather than accidental?
- Does the map still look readable if all trim plates are ignored?
