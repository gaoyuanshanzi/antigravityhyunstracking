import { neon } from '@neondatabase/serverless';

const CONNECTION_STRING = 'postgresql://neondb_owner:npg_I5p0SZdrNGVj@ep-withered-bonus-axhavcpm.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require';

const sql = neon(CONNECTION_STRING);

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { action, payload } = req.body || {};

    // 1. Schema Init
    if (action === 'init_schema') {
      await sql`
        CREATE TABLE IF NOT EXISTS projects (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          status VARCHAR(20) DEFAULT 'IN_PROGRESS',
          total_distance FLOAT DEFAULT 0,
          total_steps INT DEFAULT 0,
          avg_stride FLOAT DEFAULT 0,
          duration_sec INT DEFAULT 0
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS tracking_points (
          id SERIAL PRIMARY KEY,
          project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          latitude FLOAT NOT NULL,
          longitude FLOAT NOT NULL,
          altitude FLOAT DEFAULT 0,
          step_count INT DEFAULT 0,
          speed FLOAT DEFAULT 0,
          recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS pois (
          id SERIAL PRIMARY KEY,
          project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          latitude FLOAT NOT NULL,
          longitude FLOAT NOT NULL,
          altitude FLOAT DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS photos (
          id SERIAL PRIMARY KEY,
          project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          latitude FLOAT NOT NULL,
          longitude FLOAT NOT NULL,
          altitude FLOAT DEFAULT 0,
          photo_base64 TEXT NOT NULL,
          caption TEXT,
          step_count INT DEFAULT 0,
          distance_at_photo FLOAT DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `;
      return res.status(200).json({ success: true, message: 'Schema initialized successfully' });
    }

    // 2. Get Projects List
    if (action === 'get_projects') {
      const rows = await sql`
        SELECT 
          p.*,
          (SELECT COUNT(*) FROM tracking_points tp WHERE tp.project_id = p.id) as point_count,
          (SELECT COUNT(*) FROM photos ph WHERE ph.project_id = p.id) as photo_count,
          (SELECT COUNT(*) FROM pois poi WHERE poi.project_id = p.id) as poi_count
        FROM projects p
        ORDER BY p.created_at DESC;
      `;
      return res.status(200).json({ success: true, data: rows || [] });
    }

    // 3. Create Project
    if (action === 'create_project') {
      const { name } = payload;
      const rows = await sql`
        INSERT INTO projects (name, status, total_distance, total_steps, avg_stride, duration_sec)
        VALUES (${name}, 'IN_PROGRESS', 0, 0, 0, 0)
        RETURNING *;
      `;
      return res.status(200).json({ success: true, data: rows[0] });
    }

    // 4. Get Project Details
    if (action === 'get_project_details') {
      const { projectId } = payload;
      const [projectRows, points, pois, photos] = await Promise.all([
        sql`SELECT * FROM projects WHERE id = ${projectId};`,
        sql`SELECT * FROM tracking_points WHERE project_id = ${projectId} ORDER BY recorded_at ASC, id ASC;`,
        sql`SELECT * FROM pois WHERE project_id = ${projectId} ORDER BY created_at ASC;`,
        sql`SELECT * FROM photos WHERE project_id = ${projectId} ORDER BY created_at ASC;`
      ]);
      return res.status(200).json({
        success: true,
        data: {
          project: projectRows[0] || null,
          points: points || [],
          pois: pois || [],
          photos: photos || []
        }
      });
    }

    // 5. Insert Tracking Point
    if (action === 'insert_point') {
      const { projectId, latitude, longitude, altitude, stepCount, speed } = payload;
      const rows = await sql`
        INSERT INTO tracking_points (project_id, latitude, longitude, altitude, step_count, speed, recorded_at)
        VALUES (${projectId}, ${latitude}, ${longitude}, ${altitude || 0}, ${stepCount || 0}, ${speed || 0}, NOW())
        RETURNING id, recorded_at;
      `;
      return res.status(200).json({ success: true, data: rows[0] });
    }

    // 6. Insert Batch Points (efficient mobile batching)
    if (action === 'insert_batch_points') {
      const { projectId, points } = payload;
      if (points && points.length > 0) {
        for (const pt of points) {
          await sql`
            INSERT INTO tracking_points (project_id, latitude, longitude, altitude, step_count, speed, recorded_at)
            VALUES (${projectId}, ${pt.latitude}, ${pt.longitude}, ${pt.altitude || 0}, ${pt.stepCount || 0}, ${pt.speed || 0}, ${pt.recorded_at || 'NOW()'});
          `;
        }
      }
      return res.status(200).json({ success: true });
    }

    // 7. Insert POI
    if (action === 'insert_poi') {
      const { projectId, name, latitude, longitude, altitude } = payload;
      const rows = await sql`
        INSERT INTO pois (project_id, name, latitude, longitude, altitude, created_at)
        VALUES (${projectId}, ${name}, ${latitude}, ${longitude}, ${altitude || 0}, NOW())
        RETURNING *;
      `;
      return res.status(200).json({ success: true, data: rows[0] });
    }

    // 8. Insert Photo
    if (action === 'insert_photo') {
      const { projectId, latitude, longitude, altitude, photoBase64, caption, stepCount, distanceAtPhoto } = payload;
      const rows = await sql`
        INSERT INTO photos (project_id, latitude, longitude, altitude, photo_base64, caption, step_count, distance_at_photo, created_at)
        VALUES (${projectId}, ${latitude}, ${longitude}, ${altitude || 0}, ${photoBase64}, ${caption}, ${stepCount || 0}, ${distanceAtPhoto || 0}, NOW())
        RETURNING *;
      `;
      return res.status(200).json({ success: true, data: rows[0] });
    }

    // 9. Update Project Stats
    if (action === 'update_project') {
      const { projectId, totalDistance, totalSteps, avgStride, durationSec, status } = payload;
      const rows = await sql`
        UPDATE projects 
        SET total_distance = ${totalDistance}, total_steps = ${totalSteps}, avg_stride = ${avgStride}, duration_sec = ${durationSec}, status = ${status || 'IN_PROGRESS'}
        WHERE id = ${projectId}
        RETURNING *;
      `;
      return res.status(200).json({ success: true, data: rows[0] });
    }

    // 10. Delete Project
    if (action === 'delete_project') {
      const { projectId } = payload;
      await sql`DELETE FROM projects WHERE id = ${projectId};`;
      return res.status(200).json({ success: true });
    }

    // Raw SQL fallback
    if (action === 'raw_query') {
      const { query, params } = payload;
      const rows = await sql(query, params || []);
      return res.status(200).json({ success: true, data: rows });
    }

    return res.status(400).json({ success: false, error: 'Unknown action' });
  } catch (error) {
    console.error('API DB Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
