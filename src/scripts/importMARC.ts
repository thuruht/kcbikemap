import type { Env } from '../../src/index.js';

/**
 * Script to import MARC Regional Trails data into D1.
 * Run via wrangler or similar local execution context.
 */
export async function importMARC(env: Env) {
  const MARC_URL = 'https://marc2.org/arcgis/rest/services/MetroGreen/FeatureServer/0/query?where=PhaseSimple=%27Existing%27&outFields=*&f=geojson';
  
  console.log('Fetching MARC data...');
  const resp = await fetch(MARC_URL);
  if (!resp.ok) throw new Error('Failed to fetch MARC data');
  
  const data = await resp.json() as any;
  console.log(`Found ${data.features.length} features.`);

  for (const feature of data.features) {
    const props = feature.properties;
    const geom = feature.geometry;
    
    // Map MARC props to our schema
    const name = props.Name || 'Unnamed Trail Segment';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + crypto.randomUUID().split('-')[0];
    const category = 'Official Regional Data'; // New category for MARC imports
    const officiality = 'official';
    const status = 'active';
    const surface = props.SurfaceType || 'Unknown';
    const description = `Source: MARC Regional Trails. Jurisdiction: ${props.Jurisdiction || 'Unknown'}. Type: ${props.FacilityType || 'Unknown'}.`;

    // Insert into features
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO features (id, slug, name, feature_type, category, status, visibility, officiality, public_description, surface_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, slug, name, 'line', category, status, 'public', officiality, description, surface).run();

    // Insert into geometries
    await env.DB.prepare(`
      INSERT INTO feature_geometries (feature_id, public_geometry)
      VALUES (?, ?)
    `).bind(id, JSON.stringify(geom)).run();
  }

  console.log('Import complete.');
}
