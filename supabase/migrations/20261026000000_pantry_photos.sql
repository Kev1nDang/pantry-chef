-- Saved pantry photos: a private Storage bucket, one folder per user (`<user id>/<file>`).
-- The web app uploads and reads these directly with the user's session; the API never sees them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pantry-photos', 'pantry-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Users read their own pantry photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'pantry-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users upload their own pantry photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'pantry-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete their own pantry photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'pantry-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
