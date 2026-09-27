-- Private storage bucket and tenant-scoped storage policies.
-- Object keys are always "<organization_id>/<...>", so the first path
-- segment decides which organization may access the object.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'studio-assets',
  'studio-assets',
  false,
  209715200, -- 200 MB (videos); images are limited to 25 MB in application code
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy studio_assets_select on storage.objects for select to authenticated
  using (
    bucket_id = 'studio-assets'
    and public.has_org_role(public.try_uuid((storage.foldername(name))[1]), 'viewer')
  );

create policy studio_assets_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'studio-assets'
    and public.has_org_role(public.try_uuid((storage.foldername(name))[1]), 'editor')
  );

create policy studio_assets_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'studio-assets'
    and public.has_org_role(public.try_uuid((storage.foldername(name))[1]), 'editor')
  );

-- ---------------------------------------------------------------------------
-- Built-in shoot presets (organization_id is null). Organizations copy and
-- customise these; the originals are read-only for users.
-- ---------------------------------------------------------------------------
insert into public.shoot_presets (organization_id, name, category, description, config) values
(null, 'Catalog — Front', 'ecommerce', 'Clean full-body front view on a seamless background.',
 '{"shotType":"front","pose":"standing straight, relaxed arms, weight evenly distributed","cameraAngle":"eye level, straight on","framing":"full_body","background":"seamless light grey studio background","lighting":"soft, even high-key studio lighting with minimal shadows","aspectRatio":"3:4","imageSize":"2K","variations":2,"creativeInstructions":""}'),
(null, 'Catalog — Back', 'ecommerce', 'Full-body back view to show rear construction.',
 '{"shotType":"back","pose":"standing, facing away from camera, head slightly turned","cameraAngle":"eye level, straight on","framing":"full_body","background":"seamless light grey studio background","lighting":"soft, even high-key studio lighting with minimal shadows","aspectRatio":"3:4","imageSize":"2K","variations":2,"creativeInstructions":""}'),
(null, 'Catalog — Side', 'ecommerce', 'Profile view showing silhouette.',
 '{"shotType":"side","pose":"standing in profile, natural posture","cameraAngle":"eye level","framing":"full_body","background":"seamless light grey studio background","lighting":"soft, even high-key studio lighting","aspectRatio":"3:4","imageSize":"2K","variations":2,"creativeInstructions":""}'),
(null, 'Catalog — Three-quarter', 'ecommerce', 'Three-quarter turn, the most flattering catalog angle.',
 '{"shotType":"three_quarter","pose":"body turned 45 degrees, one hand relaxed at hip","cameraAngle":"eye level","framing":"three_quarter_body","background":"seamless off-white studio background","lighting":"soft key light with gentle fill","aspectRatio":"3:4","imageSize":"2K","variations":2,"creativeInstructions":""}'),
(null, 'Product Detail — Fabric close-up', 'detail', 'Tight crop on fabric, lace, stitching or closures.',
 '{"shotType":"detail","pose":"still pose that presents the garment detail clearly","cameraAngle":"close, slightly angled to reveal texture","framing":"detail_macro","background":"neutral, out of focus","lighting":"raking soft light to reveal texture","aspectRatio":"3:4","imageSize":"2K","variations":2,"creativeInstructions":"Focus on accurate reproduction of the fabric texture and trims."}'),
(null, 'Editorial — Soft natural light', 'editorial', 'Magazine-style editorial with window light.',
 '{"shotType":"three_quarter","pose":"relaxed editorial pose, seated or leaning","cameraAngle":"slightly below eye level","framing":"three_quarter_body","background":"minimal interior with neutral walls and natural window light","lighting":"soft directional window light","aspectRatio":"3:4","imageSize":"2K","variations":2,"creativeInstructions":"Elegant, tasteful, professional fashion editorial."}'),
(null, 'Campaign — Wide hero', 'campaign', 'Wide campaign hero image with space for copy.',
 '{"shotType":"front","pose":"confident standing pose","cameraAngle":"eye level","framing":"full_body","background":"warm neutral set with soft shadows, negative space on one side for text","lighting":"warm directional key light","aspectRatio":"16:9","imageSize":"2K","variations":2,"creativeInstructions":"Premium brand campaign look."}');

-- Functions created in this migration inherit PUBLIC execute by default.
revoke execute on all functions in schema public from anon, public;
grant execute on function public.has_org_role(uuid, public.org_role) to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.cancel_job(uuid) to authenticated;
grant execute on function public.org_month_spend(uuid) to authenticated;
grant execute on function public.try_uuid(text) to authenticated;
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.prevent_org_change() to authenticated;
grant execute on function public.enforce_job_transition() to authenticated;
