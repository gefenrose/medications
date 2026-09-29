/* Supabase client bootstrap for the Medication Tracker PWA. */
(function () {
  const cfg = window.MEDTRACK_SUPABASE || {};
  const configured = !!(cfg.url && cfg.publishableKey && window.supabase);
  window.medtrackCloud = {
    configured,
    client: configured
      ? window.supabase.createClient(cfg.url, cfg.publishableKey, {
          auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
        })
      : null
  };
})();
