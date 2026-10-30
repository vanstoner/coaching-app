/**
 * The control vocabulary — #264 (Dee's One system v6, approved by Rob 29 Oct;
 * Bea's criteria V1 to V33). Every screen draws its controls from here:
 *
 * | Control | Component | Means |
 * |---|---|---|
 * | Row › | `RowNav` | opens a sheet or another screen; the › never turns |
 * | Section heading | `Section` | the one twisty: › on the left, turning to ⌄ |
 * | Segmented choice | `Segmented`, `SegmentedRow` | 2 to 5 short options, a tick on the chosen |
 * | List sheet with a tick | `ListSheet`, `MultiListSheet` | a long or wordy set |
 * | Stepper | `Stepper` | the compact −|+ |
 * | Action | `Action` | mint text that acts now |
 * | Main button | `MainButton` | green, the screen's one job, at the bottom |
 * | Field row | `FieldRow` | label left, text right |
 * | Saving | `SavedTick`, `useSavedTick`, `FormStatus` | ✓ Saved on a setting; Not saved yet on a form |
 * | Back or out | `BackLink`, `TopBar` | top left; never changes anything |
 * | Sheet | `FormSheet`, `LeaveAsk` | Cancel and Save; a tap outside is Cancel |
 * | Danger | `Danger`, `DangerRow` | what cannot be undone |
 *
 * The rules each one keeps are in its own file. The pure parts (save state,
 * the planned-sub stepper, the Settings sections) are in `src/app/`.
 */

export { Icon, type IconName } from './Icon';
export { Action, ActionRow, BackLink, FieldRow, GroupLabel, MainButton, MainFoot, RowNav, TopBar } from './Rows';
export { FormStatus, SavedTick, Section, useSavedTick, useSavedTicks } from './Section';
export { Segmented, SegmentedRow, Stepper, type Option } from './Choice';
export {
  CheckLine,
  FormSheet,
  LeaveAsk,
  ListSheet,
  MultiListSheet,
  SheetNote,
  useBackLeaves,
  type ListItem,
} from './Sheets';
export { Danger, DangerRow, UndoToast } from './Danger';
