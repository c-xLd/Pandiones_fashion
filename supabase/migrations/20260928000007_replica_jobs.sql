-- "Replica" jobs: recreate an uploaded reference photo 1:1 (pose, framing,
-- background, light) with the chosen model wearing the chosen product.
-- One job per reference image; references live under <org>/references/.
alter type public.job_type add value if not exists 'replica_generation';
