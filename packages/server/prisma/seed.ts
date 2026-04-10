import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Cleaning up existing data…");
  await prisma.seatInventory.deleteMany();
  await prisma.ticketType.deleteMany();
  await prisma.event.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.row.deleteMany();
  await prisma.sectionZoneMapping.deleteMany();
  await prisma.section.deleteMany();
  await prisma.pricingZone.deleteMany();
  await prisma.venueMap.deleteMany();
  await prisma.venue.deleteMany();

  // Venue
  const venue = await prisma.venue.create({
    data: { name: "Grand Theater", slug: "grand-theater", address: "123 Main St, Dubai" },
  });

  // Map  (1200 × 800 viewbox — stage banner is at y=20 in SeatMap.tsx)
  const map = await prisma.venueMap.create({
    data: {
      venueId: venue.id,
      name: "Main Floor",
      svgViewBox: "0 0 1200 800",
      isPublished: true,
    },
  });

  // Pricing zones
  const vip = await prisma.pricingZone.create({
    data: { mapId: map.id, name: "VIP", color: "#7F77DD", sortOrder: 0 },
  });
  const premium = await prisma.pricingZone.create({
    data: { mapId: map.id, name: "Premium", color: "#1D9E75", sortOrder: 1 },
  });
  const standard = await prisma.pricingZone.create({
    data: { mapId: map.id, name: "Standard", color: "#BA7517", sortOrder: 2 },
  });

  // ── Sections ──────────────────────────────────────────────────────────────
  // Section A — VIP center (below stage)
  const sectionA = await prisma.section.create({
    data: {
      mapId: map.id,
      name: "Section A",
      label: "VIP",
      sectionType: "RESERVED",
      polygonPath: "M 390 90 L 810 90 L 810 240 L 390 240 Z",
      sortOrder: 0,
      zoneMappings: { create: { zoneId: vip.id } },
    },
  });

  // Section B — Premium left
  const sectionB = await prisma.section.create({
    data: {
      mapId: map.id,
      name: "Section B",
      label: "PRM-L",
      sectionType: "RESERVED",
      polygonPath: "M 30 270 L 370 270 L 370 490 L 30 490 Z",
      sortOrder: 1,
      zoneMappings: { create: { zoneId: premium.id } },
    },
  });

  // Section C — Premium right
  const sectionC = await prisma.section.create({
    data: {
      mapId: map.id,
      name: "Section C",
      label: "PRM-R",
      sectionType: "RESERVED",
      polygonPath: "M 830 270 L 1170 270 L 1170 490 L 830 490 Z",
      sortOrder: 2,
      zoneMappings: { create: { zoneId: premium.id } },
    },
  });

  // Section D — Standard rear (GA — no individual seats)
  await prisma.section.create({
    data: {
      mapId: map.id,
      name: "Section D",
      label: "STD",
      sectionType: "GA",
      polygonPath: "M 30 510 L 1170 510 L 1170 740 L 30 740 Z",
      sortOrder: 3,
      zoneMappings: { create: { zoneId: standard.id } },
    },
  });

  // ── Rows + Seats ──────────────────────────────────────────────────────────
  const configs = [
    { sectionId: sectionA.id, rows: 5,  cols: 10, startX: 415, startY: 108, spacingX: 38, spacingY: 26 },
    { sectionId: sectionB.id, rows: 8,  cols: 12, startX:  52, startY: 288, spacingX: 26, spacingY: 24 },
    { sectionId: sectionC.id, rows: 8,  cols: 12, startX: 852, startY: 288, spacingX: 26, spacingY: 24 },
  ];

  const allSeatIds: string[] = [];

  for (const cfg of configs) {
    for (let r = 0; r < cfg.rows; r++) {
      const row = await prisma.row.create({
        data: {
          sectionId: cfg.sectionId,
          label: String.fromCharCode(65 + r),
          startX: cfg.startX,
          startY: cfg.startY + r * cfg.spacingY,
          sortOrder: r,
          seats: {
            create: Array.from({ length: cfg.cols }, (_, i) => ({
              seatNumber: String(i + 1),
              x: cfg.startX + i * cfg.spacingX,
              y: cfg.startY + r * cfg.spacingY,
            })),
          },
        },
        include: { seats: true },
      });
      allSeatIds.push(...row.seats.map((s) => s.id));
    }
  }

  // ── Event ─────────────────────────────────────────────────────────────────
  const event = await prisma.event.create({
    data: {
      mapId: map.id,
      name: "Demo Night — April 2026",
      date: new Date("2026-04-15T20:00:00Z"),
      doorsOpen: new Date("2026-04-15T19:00:00Z"),
      isActive: true,
    },
  });

  // Ticket types per zone
  await prisma.ticketType.createMany({
    data: [
      { eventId: event.id, zoneId: vip.id,      name: "VIP",      price: 50000, currency: "AED", available: 50  },
      { eventId: event.id, zoneId: premium.id,  name: "Premium",  price: 30000, currency: "AED", available: 192 },
      { eventId: event.id, zoneId: standard.id, name: "Standard", price: 15000, currency: "AED", available: 500 },
    ],
  });

  // Inventory — all reserved seats start AVAILABLE
  await prisma.seatInventory.createMany({
    data: allSeatIds.map((seatId) => ({
      eventId: event.id,
      seatId,
      status: "AVAILABLE" as const,
    })),
  });

  console.log("\n✓ Seed complete");
  console.log(`  Venue id : ${venue.id}`);
  console.log(`  Map id   : ${map.id}`);
  console.log(`  Event id : ${event.id}`);
  console.log(`  Seats    : ${allSeatIds.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
