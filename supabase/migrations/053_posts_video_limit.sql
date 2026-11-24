-- 053_posts_video_limit
-- Booth videos: raise the public `posts` bucket's per-file limit from 25 MB to
-- 60 MB, so long clips (60 s / 90 s plans) no longer have to record at a low
-- bitrate to fit. submit-post's finalize check (MAX_VIDEO_BYTES) is already
-- 60 MB. The recorder's own budget (src/lib/plans.ts VIDEO_CLIP_BYTE_BUDGET)
-- stays under the project-wide upload limit as well.
-- Idempotent: setting the same value twice is a no-op.
update storage.buckets
   set file_size_limit = 62914560 -- 60 * 1024 * 1024
 where id = 'posts';
