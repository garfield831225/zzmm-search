-- 回填: tg_baidu 容器里 217169 条数据按 source 重新分类
-- 安全: 用 source 字段反推, 只改 import_channel='tg_baidu' 的
-- 2026-07-24 修: 阿里云盘 TG 上传没显示 bug
-- source → import_channel 映射:
--   aliyun → tg_aliyun
--   xunlei/thunder → tg_xunlei
--   123 → tg_123
--   uc → tg_uc
--   tianyi → tg_tianyi
--   yidong → tg_yidong
--   quark → tg_quark
--   baidu → tg_baidu (保留)
--   115 → tg_115
--   magnet/ed2k → tg_magnet (合并)
--   telegra_ph → tg_telegraph
--   其他 → tg_other

UPDATE xx_resources
SET import_channel = CASE source
  WHEN 'aliyun'  THEN 'tg_aliyun'
  WHEN 'xunlei'  THEN 'tg_xunlei'
  WHEN 'thunder' THEN 'tg_xunlei'
  WHEN '123'     THEN 'tg_123'
  WHEN 'uc'      THEN 'tg_uc'
  WHEN 'tianyi'  THEN 'tg_tianyi'
  WHEN 'yidong'  THEN 'tg_yidong'
  WHEN 'quark'   THEN 'tg_quark'
  WHEN 'baidu'   THEN 'tg_baidu'   -- 已经是 baidu, 保留
  WHEN '115'     THEN 'tg_115'
  WHEN 'magnet'  THEN 'tg_magnet'
  WHEN 'ed2k'    THEN 'tg_magnet'  -- 合并到磁力
  WHEN 'telegra_ph' THEN 'tg_telegraph'
  ELSE 'tg_other'
END
WHERE import_channel = 'tg_baidu'
  AND source IS NOT NULL AND source <> '';

-- 看回填结果
SELECT import_channel, source, COUNT(*)::int as n
FROM xx_resources
WHERE import_channel LIKE 'tg_%'
GROUP BY import_channel, source
ORDER BY import_channel, n DESC;
