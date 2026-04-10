# Map Editor — Feature Plan (Non-Technical)

> **What is the Map Editor?**
> It is the admin-facing tool that lets venue managers visually design their seating layout — placing sections, seats, tables, venue landmarks, and text labels — all on an interactive, zoomable canvas.

---

## Table of Contents

1. [Canvas & Navigation](#1-canvas--navigation)
2. [Drawing Tools](#2-drawing-tools)
3. [Seating Sections (Reserved / GA / Accessible)](#3-seating-sections)
4. [Tables](#4-tables)
5. [Venue Objects (Stage, Bar, Bathroom, etc.)](#5-venue-objects)
6. [Text Labels](#6-text-labels)
7. [Seat Editing (Focus Mode)](#7-seat-editing-focus-mode)
8. [Row Management](#8-row-management)
9. [Pricing Zones](#9-pricing-zones)
10. [Seat Holds](#10-seat-holds)
11. [Copy / Paste & Multi-Select](#11-copy--paste--multi-select)
12. [Saving & Data Persistence](#12-saving--data-persistence)
13. [Current Limitations & Known Issues](#13-current-limitations--known-issues)

---

## 1. Canvas & Navigation

| What you can do | How it works |
|---|---|
| **Pan (scroll) the map** | Click-and-drag on any empty area to move around the map. |
| **Zoom in / out** | Use the mouse scroll wheel, or click the **＋** / **－** buttons in the bottom-right corner. |
| **Reset view** | Click the **↺** button to snap back to the default zoom and position. |
| **Background image** | An optional floor-plan image can be shown behind the map (faded) as a reference while building. |
| **Grid** | A subtle grid is always shown to help align objects. |

**Zoom range:** The map can be zoomed from 15 % all the way up to 800 %.

---

## 2. Drawing Tools

The left sidebar has a **Tools** panel with six options:

| Tool | Purpose |
|---|---|
| **Select** | Default. Click items to select, drag to move, double-click to edit. |
| **GA Section** | Draw a free-form polygon (click point-by-point) to create a General Admission or similar section. |
| **Seated** | Configure rows & seats first in the sidebar, then click on the canvas to stamp a pre-configured seated section. |
| **Table** | Click-and-drag to size and place a table (rectangle, round, square, oval, or booth shape). |
| **Object** | Place venue landmarks — Stage, Bar, Bathroom, Dance Floor, Parking, Stairs, Wall, Door, or Check-in area. |
| **Text** | Click on the canvas to place a floating text label (e.g., "EXIT", "VIP ENTRANCE"). |

### Drawing a polygon (GA Section or Wall)
1. Switch to **GA Section** (or Object → Wall).
2. Click on the canvas to place corner points.
3. Click near the first point (or double-click anywhere) to close the shape.
4. The section appears as an **unsaved draft** — you must click **Save** in the sidebar to persist it.

### Placing a Seated section
1. Switch to the **Seated** tool.
2. In the sidebar, configure: number of rows, seats per row, spacing, labeling style (A/B/C or 1/2/3), seat numbering direction (left-to-right or right-to-left).
3. Click once on the canvas to place the section.
4. The section is created, saved, and you enter **Focus Mode** to fine-tune individual seats.

---

## 3. Seating Sections

Sections are the core building blocks of any venue map. Each section is a colored polygon on the canvas.

### Section types

| Type | Meaning |
|---|---|
| **Reserved** | Each seat is individually numbered and bookable. |
| **General Admission (GA)** | Standing / open area. No individual seats — just a capacity number. |
| **Accessible** | Wheelchair-accessible seating area. |
| **Restricted** | Limited-view or obstructed-view seats (e.g., behind a pillar). |

### Section properties (sidebar inspector)

- **Name** — e.g., "Orchestra Left" (longer, descriptive).
- **Label** — e.g., "OL" (short, shown on the map, max 6 characters).
- **Label size** — override the auto-calculated font size.
- **Type** — switch between Reserved / GA / Accessible / Restricted.
- **Zone** — assign a pricing zone (see section 9).
- **Edge curve** — for GA sections without seats: bend the polygon edges inward or outward for organic shapes.
- **Capacity** — for GA sections: total number of available standing spots.
- **Max per order** — for GA sections: limit how many tickets one person can buy.
- **Hide seats** — for seated sections: seats are hidden by default; the customer clicks the section to reveal them.

### Visual indicators

- **Unsaved sections** appear with **dashed borders** and an "unsaved" label.
- **Selected sections** have a **thicker border**.
- **Multi-selected sections** show a **purple dashed outline**.

---

## 4. Tables

Tables are a special section type designed for restaurant-style, cabaret, or gala layouts.

### Creating a table
1. Select the **Table** tool.
2. In the sidebar, choose a shape preset (Rectangle, Round, Square, Oval, Booth) and set how many chairs go on each side.
3. Click-and-drag on the canvas to size the table.
4. Release — the table appears as an unsaved draft.
5. Click **Save** in the sidebar.

### Table shapes

| Shape | Description |
|---|---|
| **Rectangle** | Standard long table. Chairs on all 4 sides. |
| **Round** | Circular table. Chairs evenly spaced around the edge. |
| **Square** | Equal-sided table. Chairs on all 4 sides. |
| **Oval** | Elongated round table. Chairs spaced around the perimeter. |
| **Booth** | Chairs only on the two long sides (like a restaurant booth). |

### Table properties

- **Name / Label** — displayed on the table surface.
- **Width / Height** — resize the table.
- **Chairs per long side / short side** — adjust seating capacity.
- **Zone** — pricing zone assignment.
- **Seat selection mode** — choose whether customers pick individual chairs ("Seat by seat") or book the whole table at once ("Whole table").

### Editing tables
- **Double-click** a table to open a quick-edit popup.
- **Drag corner handles** to resize.
- **Rotation handle** (↻ icon above the table) to rotate.
- Individual chairs can be dragged, renamed, or have their shape changed.

---

## 5. Venue Objects

Non-bookable landmarks that help customers orient themselves on the map.

### Available object types

| Object | Visual | Purpose |
|---|---|---|
| **Stage** | Theater stage icon | Show where performers are |
| **Bar** | Wine glass icon | Locate bars / refreshments |
| **Bathroom** | Restroom icon | Locate restrooms |
| **Dance Floor** | Globe/sparkle icon | Dancing area |
| **Parking** | P-in-a-box icon | Parking area |
| **Stairs** | Staircase shape | Stairways (resizable, rotatable rectangle) |
| **Wall** | Thick line (2-point) | Physical walls or dividers |
| **Door** | Door shape with arrow | Entry/exit points (resizable, rotatable) |
| **Check-in** | Camera/QR frame icon | Check-in / ticket scan points |

### Placing objects
1. Select the **Object** tool.
2. Choose the object type from the grid in the sidebar.
3. Click on the canvas — a creation dialog appears asking for a name.
4. The object is placed and can be moved, resized, rotated.

### Object properties

- **Name** — shown below the icon.
- **Icon type** — can be changed after placement (swap a Stage for a Bar, etc.).
- **Icon size** — slider to scale the icon up or down.
- **Label size** — font size for the name text.
- **Show icon / Show name** — toggle visibility of each.
- **Arrow keys** — nudge the icon position; **Shift+Arrow** nudges the label.

---

## 6. Text Labels

Free-floating text that can be placed anywhere on the map (e.g., "EXIT", "VIP AREA", "ROW AA").

### Placing text
1. Select the **Text** tool.
2. Click on the canvas — a text editing bar appears at the bottom of the screen.

### Text properties

- **Content** — the text to display.
- **Color** — any color via color picker.
- **Font size** — 6 to 200.
- **Bold** — toggle bold weight.
- **Angle** — rotate the text -180° to +180°.

Text labels can be dragged, rotated (↻ handle), and repositioned with **Shift+Arrow** keys.

---

## 7. Seat Editing (Focus Mode)

Focus Mode zooms into a single seated section and lets you work with individual seats.

### Entering Focus Mode
- **Double-click** a seated section on the canvas, **or**
- Click the **Edit seats** button in the sidebar inspector.

### What you can do in Focus Mode

| Action | How |
|---|---|
| **Select a seat** | Click on it. |
| **Select multiple seats** | Hold **Shift** and click, or **Shift+drag** to draw a selection rectangle. |
| **Move a seat** | Drag it (or drag multiple selected seats at once). |
| **Rename a seat** | Double-click a seat → type a new number → press Enter. |
| **Change seat shape** | Double-click → pick from Circle, Square, Triangle, Chair, Wheelchair. |
| **Delete a seat** | Double-click → click the trash icon. Or select multiple → click "Delete selected" in sidebar. |
| **Re-space rows** | Click "Fill gaps" in the sidebar → seats are redistributed evenly within each row. |
| **Rename a row** | Click the row label (A, B, C…) on the canvas, or edit in the sidebar row list. |

### Seat shapes available

| Shape | Icon | Use case |
|---|---|---|
| Circle | ● | Standard seat |
| Square | ■ | Alternative look |
| Triangle | ▲ | Special / unique seats |
| Chair | 🪑 | Realistic chair silhouette |
| Wheelchair | ♿ | Accessible seating |

### Exiting Focus Mode
- Press **Escape**, or
- Click the **✕ Exit** button in the sidebar banner, or
- Click on an empty area of the canvas.

---

## 8. Row Management

Rows are groups of seats arranged in a horizontal line. They can be curved and skewed.

### Row properties (per row)

- **Label** — e.g., "A", "B", "1", "2".
- **Curve** — bends the row into an arc (positive = curve down, negative = curve up). Useful for amphitheater-style layouts.
- **Skew** — tilts the row diagonally (positive = right side drops, negative = left side drops).

### Global row controls

In the sidebar under the row list, there is an **"Apply to all"** panel:
- Set a single Curve and Skew value and click **Apply to all** — every row in the section updates at once.

### Baking transforms

After setting curves and skews, the section boundary automatically reshapes to hug the new seat positions. If you want to **permanently save** the curved positions (so the curve/skew sliders reset to zero and you work from the new positions going forward), click **"Bake transforms → save positions"**.

### Row generator (adding rows to an existing empty section)

If you select an empty polygon section, you can open the **Row generator** to fill it with rows of seats:
- Row count, seats per row
- Start position (X, Y)
- Spacing between seats and between rows
- Row labels: letters (A, B, C…) or numbers (1, 2, 3…)
- Row start offset (e.g., start from row C instead of A)
- Seat numbering: left-to-right or right-to-left
- Seat start number

---

## 9. Pricing Zones

Pricing Zones are color-coded groups that link sections to ticket prices.

### How they work
1. In the sidebar under **Pricing zones**, create a new zone by typing a name and picking a color.
2. When editing any section or table, assign it to a zone from the dropdown.
3. All sections in the same zone share the same color on the map.

### Example zones

| Zone | Color | Sections |
|---|---|---|
| VIP Front | Gold | Rows A–C center |
| Premium | Purple | Rows D–H |
| Standard | Teal | Rows I–P |
| Balcony | Blue | Upper level |

Zones are purely a visual grouping in the editor — pricing amounts are set separately when creating events and ticket types.

---

## 10. Seat Holds

Holds let you **permanently block specific seats** so they cannot be sold to customers (e.g., production holds, house seats, obstructed views).

### Holds tab

Switch to the **Holds** tab in the sidebar to manage holds.

### Creating a hold
1. Type a name (e.g., "Production Hold") and pick a color.
2. Click **+** to create the hold.

### Assigning seats to a hold
1. Click on individual seats on the canvas (they highlight as selected), or **Shift+drag** to select a rectangle of seats.
2. Next to the desired hold, click **+ Assign** — the selected seats are added to that hold.
3. Held seats show an **✕ cross-hatch** overlay in the hold's color.

### Managing holds

| Action | How |
|---|---|
| **Edit a hold** | Click **Edit** → change name / color → click **Save**. |
| **Clear all seats from a hold** | Click **Clear**. |
| **Remove selected seats** | Select seats on canvas → click **Desel.** to deselect, or assign to a different hold. |
| **Delete a hold entirely** | Click the **✕** button on the hold card. |

---

## 11. Copy / Paste & Multi-Select

### Multi-select
- **Shift+click** on multiple sections to add them to a multi-selection (purple dashed outlines).
- **Shift+drag** on empty canvas to draw a selection rectangle around sections.
- All selected sections **move together** when you drag any one of them.

### Copy and paste
- **Ctrl+C** (or **Cmd+C** on Mac) copies the selected section(s).
- **Ctrl+V** (or **Cmd+V**) pastes them at a slight offset.
- Pasted sections are **unsaved drafts** — remember to save each one.

### Rotation
- When a section is selected, a **↻ rotation handle** appears above it.
- Drag the handle to rotate the section (and all its seats) freely.
- Multi-selected sections can each rotate independently.

---

## 12. Saving & Data Persistence

### How saving works

| Situation | What happens |
|---|---|
| **New section / table / object** | Appears with dashed border and "unsaved" label. Click **Save** in the sidebar to persist to the database. |
| **Moving a section** | Automatically saved when you release the mouse. |
| **Resizing / rotating** | Auto-saved on mouse release. |
| **Changing properties** (name, label, type, zone) | Auto-saved on blur (when you click away from the input field). |
| **Moving / renaming a seat** | Auto-saved immediately. |
| **Curve / skew changes** | Auto-saved immediately. |

### What is NOT auto-saved

- **Newly drawn sections** — must be manually saved.
- **Newly placed tables** — must be manually saved.
- **New venue objects** — must be manually saved after the creation dialog.

### Deleting sections
Select a section → click **Delete** in the sidebar. This immediately removes it from the database if it was saved.

---

## 13. Current Limitations & Known Issues

| Area | Limitation |
|---|---|
| **Undo / Redo** | Not yet implemented. If you make a mistake, you need to manually revert. |
| **Snap-to-grid** | Objects don't snap to the grid — positioning is free-form only. |
| **Seat numbering** | No auto-renumber after deleting seats. Must be done manually. |
| **Mobile editing** | The editor is designed for desktop use with a mouse. Touch/tablet editing has not been tested. |
| **Collaborative editing** | Only one person should edit a map at a time — there is no real-time sync between multiple editors. |
| **Performance** | Very large maps (1000+ seats across many sections) may feel slower during pan/zoom. |
| **Background images** | Only one background image per map. Cannot be repositioned or scaled within the editor. |
| **Section overlap** | Sections can overlap visually — the editor does not prevent or warn about overlapping areas. |

---

## Summary of Key Workflows

### Building a new venue map from scratch

1. **Start** → Open the Map Editor for a new map.
2. **Place the stage** → Object tool → Stage → click on canvas → name it → save.
3. **Draw GA sections** → GA Section tool → draw polygons around standing areas → set capacity → save.
4. **Place seated sections** → Seated tool → configure rows/seats → click to place → save.
5. **Add tables** → Table tool → drag to size → configure chairs → save.
6. **Add landmarks** → Object tool → doors, stairs, bars, bathrooms.
7. **Add text labels** → Text tool → "EXIT", "ENTRANCE", etc.
8. **Create pricing zones** → Name and color-code them → assign to sections.
9. **Set up holds** → Block any production/house seats.
10. **Fine-tune** → Focus Mode for individual seat adjustments, row curves, shapes.

### Editing an existing map

1. Open the Map Editor — all saved sections load automatically.
2. Click any section to select it → edit properties in the sidebar.
3. Double-click a seated section to enter Focus Mode for seat-level edits.
4. Drag sections/objects to reposition.
5. Use rotation handles to angle sections.
6. Changes are auto-saved as described above.
