#!/usr/bin/env node
// Builds assets/courses/us-index.json — the on-device course list used for search and
// "nearby courses" — from OpenStreetMap via the Overpass API.
//
//   npm run build:course-index
//
// Data © OpenStreetMap contributors, ODbL 1.0. The app shows this attribution in Settings.
//
// Courses are fetched one state at a time so every row gets its state code (most OSM courses
// have no addr:state tag). Output rows: [id, name, city, state, lat, lng]; unnamed courses are
// dropped. Hole geometry is not part of this file — see supabase/functions/course-geometry.

import { writeFile } from 'node:fs/promises';

const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

const STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'PR',
];

// Courses mapped in OSM without a name tag (so the query below skips them), named by hand.
// North/South confirmed by matching OSM pars to the published scorecards. Better fix: add the name in OSM itself.
const UNNAMED = [
  ['osm:way/40149863', 'Charleston Springs Golf Course (North)', 'Millstone', 'NJ', 40.22219, -74.37663],
  ['osm:way/40149861', 'Charleston Springs Golf Course (South)', 'Millstone', 'NJ', 40.2144, -74.36227],
];

const round5 = (n) => Math.round(n * 1e5) / 1e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, attempt = 1) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MyScoreCardGolf course index builder' },
    body: new URLSearchParams({ data: query }),
  });
  if ((res.status === 429 || res.status === 504) && attempt < 5) {
    await sleep(15_000 * attempt); // Overpass asks clients to back off when busy
    return overpass(query, attempt + 1);
  }
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function coursesInState(code) {
  const { elements } = await overpass(`
    [out:json][timeout:300];
    area["ISO3166-2"="US-${code}"][admin_level=4]->.s;
    (
      way["leisure"="golf_course"]["name"](area.s);
      relation["leisure"="golf_course"]["name"](area.s);
    );
    out center tags;
  `);
  return elements;
}

async function main() {
  const rows = new Map(); // id → row; a course straddling a state line is kept once
  for (const code of STATES) {
    const elements = await coursesInState(code);
    for (const el of elements) {
      const center = el.center ?? (el.lat != null ? { lat: el.lat, lon: el.lon } : null);
      const name = el.tags?.name?.trim();
      const id = `osm:${el.type}/${el.id}`;
      if (!center || !name || rows.has(id)) continue;
      rows.set(id, [id, name, el.tags['addr:city']?.trim() ?? '', code, round5(center.lat), round5(center.lon)]);
    }
    console.log(`${code}: ${elements.length}`);
    await sleep(1_000);
  }

  for (const row of UNNAMED) if (!rows.has(row[0])) rows.set(row[0], row);
  const out = [...rows.values()].sort((a, b) => a[1].localeCompare(b[1]));
  const file = new URL('../assets/courses/us-index.json', import.meta.url);
  await writeFile(file, JSON.stringify(out));
  console.log(`Wrote ${out.length} courses to ${file.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
