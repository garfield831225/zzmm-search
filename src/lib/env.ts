// 环境变量统一管理
export const env = {
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: process.env.JWT_SECRET || '',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  REDIS_HOST: process.env.REDIS_HOST || '',
  REDIS_PORT: process.env.REDIS_PORT || '6379',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
  REDIS_TLS: process.env.REDIS_TLS || '',
  TMDB_API_KEY: process.env.TMDB_API_KEY || '7985342d5961e9ee3d5ef6d969c1b8dd',
  SITE_NAME: process.env.SITE_NAME || '泽泽妈妈资源库',
  SITE_URL: process.env.SITE_URL || '',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
  WECHAT_CONTACT: process.env.WECHAT_CONTACT || 'HKmaipanren',
};
