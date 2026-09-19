/**
 * Position units and the role catalogue — PO ruling, 2026-09-19 (#62).
 *
 * Pure data and pure functions. No React, no storage.
 *
 * ---------------------------------------------------------------------------
 * Why a primitive and a label, rather than just a label
 * ---------------------------------------------------------------------------
 *
 * The PO's design, in his words:
 *
 * > *"The actual positions might change names. So I would build in hard
 * > primitives like the three I just had then allow the user to call the
 * > positions what they want. We will track time at the primitive level so it
 * > survives renaming."*
 *
 * `PositionUnit` is fixed — GK, DEF, MID, ATT — and is what every recorded
 * interval is measured against. The label is the coach's and can change at any
 * time. Renaming "Left Mid" to "out wide" must never re-bucket a child's
 * minutes, and a season summary must still be answerable a year later when the
 * vocabulary has moved on.
 *
 * Same discipline as Protobuf field numbers: the stored value is stable, the
 * name is a convenience for humans.
 *
 * The catalogue below is the PO's own, verbatim. It is a set of SUGGESTIONS —
 * defaults offered when building a format — not a constraint. A coach may name
 * a position anything; only the unit is fixed.
 *
 * `grassrootsTerms` exist so a coach searching for "goalie" or "number 10"
 * finds the right role. They are never stored against an interval.
 */

import type { PositionUnit } from '../types/index';

export interface RoleTemplate {
  /** Catalogue code — 'CB', 'CAM', 'ST'. Stable; stored as `Position.roleCode`. */
  code: string;
  defaultName: string;
  /** What a grassroots coach might actually call it. For searching only. */
  grassrootsTerms: string[];
}

export interface UnitTemplate {
  unit: PositionUnit;
  name: string;
  roles: RoleTemplate[];
}

/** Every unit, in the order they appear on a pitch from back to front. */
export const UNITS: readonly PositionUnit[] = ['GK', 'DEF', 'MID', 'ATT'] as const;

export const POSITION_CATALOGUE: readonly UnitTemplate[] = [
  {
    unit: 'GK',
    name: 'Goalkeeping',
    roles: [
      {
        code: 'GK',
        defaultName: 'Goalkeeper',
        grassrootsTerms: ['Goalie', 'Keeper', 'In Goal', 'Number 1'],
      },
    ],
  },
  {
    unit: 'DEF',
    name: 'Defence',
    roles: [
      { code: 'CB', defaultName: 'Centre Back', grassrootsTerms: ['Defender', 'Central Defender', 'Back'] },
      { code: 'RB', defaultName: 'Right Back', grassrootsTerms: ['Right Defence', 'Right Side'] },
      { code: 'LB', defaultName: 'Left Back', grassrootsTerms: ['Left Defence', 'Left Side'] },
      { code: 'SW', defaultName: 'Sweeper', grassrootsTerms: ['Last Man', 'Cover'] },
      { code: 'WB', defaultName: 'Wing Back', grassrootsTerms: ['RWB', 'LWB'] },
    ],
  },
  {
    unit: 'MID',
    name: 'Midfield',
    roles: [
      { code: 'CM', defaultName: 'Central Midfield', grassrootsTerms: ['Midfielder', 'Middle'] },
      { code: 'CDM', defaultName: 'Defensive Midfield', grassrootsTerms: ['Holding Mid', 'Shield', 'Anchor', 'DM'] },
      { code: 'CAM', defaultName: 'Attacking Midfield', grassrootsTerms: ['Number 10', 'Playmaker', 'Attacking Mid'] },
      { code: 'RM', defaultName: 'Right Midfield', grassrootsTerms: ['Right Wing', 'Right Mid', 'RW'] },
      { code: 'LM', defaultName: 'Left Midfield', grassrootsTerms: ['Left Wing', 'Left Mid', 'LW'] },
    ],
  },
  {
    unit: 'ATT',
    name: 'Attack',
    roles: [
      { code: 'ST', defaultName: 'Striker', grassrootsTerms: ['Forward', 'Centre Forward', 'Number 9', 'Target Man'] },
    ],
  },
] as const;

/** What to call a unit on screen. */
export function unitName(unit: PositionUnit): string {
  return POSITION_CATALOGUE.find((u) => u.unit === unit)?.name ?? unit;
}

/** Look a role up by its catalogue code. Undefined for a code we do not know. */
export function roleByCode(code: string): RoleTemplate | undefined {
  for (const unit of POSITION_CATALOGUE) {
    const role = unit.roles.find((r) => r.code.toUpperCase() === code.toUpperCase());
    if (role) return role;
  }
  return undefined;
}

/**
 * Which unit a label belongs to — by catalogue code, default name, or one of
 * the grassroots terms. Null for anything the catalogue does not list.
 *
 * Grassroots terms count here, and that is the point of having them. A format
 * whose positions are labelled 'LW' and 'RW' is not ambiguous: the catalogue
 * lists both as terms for Left and Right Midfield. Reading a documented
 * synonym is not the same as guessing, and it is the difference between a real
 * squad's format migrating cleanly and the coach being asked to reclassify
 * seven positions they already named perfectly clearly.
 *
 * Matching is EXACT, case-insensitive. Substring matching would make "Back"
 * match "Wing Back" and quietly file a defender's minutes under the wrong
 * unit — see `findRoles` for the forgiving version, which is for searching and
 * never for deciding what something is.
 */
export function unitOfRole(label: string): PositionUnit | null {
  const needle = label.trim().toLowerCase();
  if (needle === '') return null;
  for (const unit of POSITION_CATALOGUE) {
    for (const role of unit.roles) {
      const names = [role.code, role.defaultName, ...role.grassrootsTerms];
      if (names.some((n) => n.toLowerCase() === needle)) return unit.unit;
    }
  }
  return null;
}

/**
 * Find roles by anything a coach might type — the code, the default name, or
 * one of the grassroots terms. Case- and whitespace-insensitive.
 *
 * This is why `grassrootsTerms` is in the model: a coach typing "goalie" or
 * "number 10" should find the role rather than an empty list and a shrug.
 */
export function findRoles(query: string): RoleTemplate[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const hits: RoleTemplate[] = [];
  for (const unit of POSITION_CATALOGUE) {
    for (const role of unit.roles) {
      const haystack = [role.code, role.defaultName, ...role.grassrootsTerms].map((t) =>
        t.toLowerCase()
      );
      if (haystack.some((t) => t.includes(needle))) hits.push(role);
    }
  }
  return hits;
}

/**
 * The unit a v1 position should migrate to, from what v1 recorded.
 *
 * A v1 goalkeeping position is unambiguously GK. A v1 outfield position could
 * be DEF, MID or ATT and v1 recorded nothing that distinguishes them — so it
 * returns null and the coach is asked, rather than a guess being written into
 * a child's history where nobody would ever see it was a guess.
 *
 * The label is checked against the catalogue first, because a v1 format built
 * from the catalogue used the codes as labels ('LB', 'CM', 'ST') and those DO
 * carry the answer. That recovers most real formats without inventing anything.
 */
export function inferUnit(kind: 'goalkeeper' | 'outfield', label: string): PositionUnit | null {
  if (kind === 'goalkeeper') return 'GK';
  return unitOfRole(label);
}
