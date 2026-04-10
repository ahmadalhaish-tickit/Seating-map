# Seat-grid constants shared by psd_parser and dxf_parser.
# Seat generation itself moved to Node.js (server/src/index.ts) so that
# the Python analyzer stays fast and doesn't build large in-memory grids.

SEAT_SPACING_X = 22.0
SEAT_SPACING_Y = 22.0
MARGIN         = 10.0

SEATED_TYPES = {"RESERVED", "ACCESSIBLE", "RESTRICTED"}
