import type { Condition } from '../model/types';
import type { PageText } from '../detect/page';

export interface SheetRequest {
  /** JPEG of the sheet (or the part on screen), base64. */
  imageBase64: string;
  imageWidth: number;
  imageHeight: number;
  /** Text found on the sheet, with positions already converted to 0-1000 image coordinates. */
  labels: PageText[];
  conditions: Condition[];
  /** What the estimator asked for. */
  instruction: string;
}

export const SYSTEM_PROMPT = `You are a take-off assistant for a finishes subcontractor estimating painting, waterproofing, flooring, sealants and wallcovering. An estimator has opened an architectural drawing and wants a first-pass take-off that they will check and adjust by hand.

You are given an image of the sheet, the text found on it with positions, the take-off items the estimator has set up, and their instruction. Your job is to identify the rooms and spaces the instruction covers and say which take-off items apply to each. You do not trace outlines or compute quantities: software traces each room's boundary from the linework starting at the point you give, and measures it. So what matters from you is which spaces to include, a point safely inside each one, and a box around it.

Coordinates are integers from 0 to 1000 across the image: x runs left to right, y runs top to bottom.

For each room or space:
- name: the room name as written on the sheet. Join label fragments that belong together (for example "EXISTING" above "PRO SHOP" is "Existing Pro Shop"). If it has no label, give a short descriptive name.
- label_id: the id of a text label that sits inside this room, on its floor, or -1 if there is none. Prefer the label closest to the middle of the room. Do not use a label that sits on a wall, outside the room, or at the end of a leader line.
- x, y: a point on open floor inside the room, away from walls, furniture, fixtures and doors.
- x0, y0, x1, y1: a box that just contains the whole room, wall to wall. The software will not look outside this box (plus a margin), so it must not cut the room off.
- items: the ids of the take-off items that apply to this room, following the estimator's instruction.

Include every space the instruction covers, one entry per enclosed space, including small ones such as closets, showers and storage rooms. Leave out spaces the instruction excludes, exterior areas, and site features such as parking, paving, lawns and landscaping unless the estimator asks for them. If several labels sit in one undivided space, return it once.

Use the estimator's existing take-off items where they fit. Only add a new item when the instruction calls for something the existing items do not cover, for example a separate floor finish. Give each new item an id such as "new1" and use that id in the rooms it applies to. Area items measure floor or ceiling area. Length items measure a room's perimeter, and with a wall height they report wall area, which is how paint and wallcovering on walls are measured. Count items mark one point per room.

Set scale_note to the drawing scale exactly as written on the sheet (for example 1/8" = 1'-0"), or an empty string if none is shown. Write summary as one or two plain sentences telling the estimator what you included and anything they should check, such as rooms you were unsure about.`;

/** The text part of the request that goes with the sheet image. */
export function userText(req: SheetRequest): string {
  const items = req.conditions.length
    ? req.conditions
        .map((c) => `${c.id} | ${c.name} | ${c.trade} | ${c.kind === 'linear' ? `length${c.heightFt ? `, ${c.heightFt} ft high walls` : ''}` : c.kind}`)
        .join('\n')
    : '(none yet)';
  const labels = req.labels.length ? req.labels.map((l) => `${l.id} | ${l.text} | ${Math.round(l.x)},${Math.round(l.y)}`).join('\n') : '(no selectable text on this sheet; rely on the image)';
  return `<instruction>
${req.instruction.trim()}
</instruction>

<take_off_items>
id | name | trade | measured as
${items}
</take_off_items>

<sheet_text>
id | text | x,y of its centre
${labels}
</sheet_text>

The image is ${req.imageWidth} x ${req.imageHeight} pixels. Return the structured result.`;
}
