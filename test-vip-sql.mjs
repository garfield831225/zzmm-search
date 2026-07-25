// 测 vip API SQL
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

// 直接跑 vip API 那个 SQL
const r = await sql(`
  SELECT
    r.id, r.tmdb_id, r.media_type, r.title,
    r.poster_path, r.vote_average, r.popularity,
    l.id AS link_id, l.play_url, l.source AS link_source,
    COUNT(*) OVER() AS _total
  FROM xx_vip_resources r
  LEFT JOIN xx_vip_links l
    ON l.id = (
      SELECT id FROM xx_vip_links
      WHERE resource_id = r.id AND status = 'ok'
      ORDER BY last_ok_at DESC NULLS LAST, id ASC
      LIMIT 1
    )
  ORDER BY (l.id IS NOT NULL) DESC, r.popularity DESC NULLS LAST
  LIMIT 3
`);

console.log('rows:', r.length);
if (r.length > 0) {
  console.log('total:', r[0]._total);
  console.log('first:', { id: r[0].id, title: r[0].title, hasLink: !!r[0].link_id, voteAverage: r[0].vote_average });
}

// 单独看 total
const t = await sql(`SELECT COUNT(*)::int as n FROM xx_vip_resources`);
console.log('xx_vip_resources total:', t[0].n);
const l = await sql(`SELECT COUNT(*)::int as n FROM xx_vip_links WHERE status='ok'`);
console.log('xx_vip_links ok:', l[0].n);
