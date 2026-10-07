#!/usr/bin/env node
// Builds assets/courses/us-index.json — the on-device course list used for search and
// "nearby courses" — from OpenStreetMap via the Overpass API.
//
//   npm run build:course-index
//
// Data © OpenStreetMap contributors, ODbL 1.0. The app must show this attribution
// (Settings / About) when shipping this data.
//
// Output rows: [id, name, city, state, lat, lng]. Only courses with a name are kept.
// Expect roughly 15–17k US courses (~1 MB). Course *geometry* (greens per hole) is a separate
// import into the Supabase courses / course_holes tables.

import { writeFile } from 'node:fs/promises';

const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

const query = `
[out:json][timeout:900];
area["ISO3166-1"="US"][admin_level=2]->.us;
(
  way["leisure"="golf_course"]["name"](area.us);
  relation["leisure"="golf_course"]["name"](area.us);
);
out center tags;
`;

const round5 = (n) => Math.round(n * 1e5) / 1e5;

async function main() {
  console.log('Querying Overpass (this can take several minutes)…');
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MyScoreCardGolf course index builder' },
    body: new URLSearchParams({ data: query }),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
  const { elements } = await res.json();

  const rows = [];
  for (const el of elements) {
    const center = el.center ?? (el.lat != null ? { lat: el.lat, lon: el.lon } : null);
    const name = el.tags?.name?.trim();
    if (!center || !name) continue;
    rows.push([
      `osm:${el.type}/${el.id}`,
      name,
      el.tags['addr:city'] ?? '',
      el.tags['addr:state'] ?? '',
      round5(center.lat),
      round5(center.lon),
    ]);
  }
  rows.sort((a, b) => a[1].localeCompare(b[1]));

  const out = new URL('../assets/courses/us-index.json', import.meta.url);
  await writeFile(out, JSON.stringify(rows));
  console.log(`Wrote ${rows.length} courses to ${out.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
