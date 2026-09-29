/* Supabase client and cloud data layer for the Medication Tracker PWA. */
(function () {
  const cfg = window.MEDTRACK_SUPABASE || {};
  const configured = !!(cfg.url && cfg.publishableKey && window.supabase);

  const cloud = {
    configured,
    client: configured
      ? window.supabase.createClient(cfg.url, cfg.publishableKey, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
          }
        })
      : null,
    authUser: null,
    profile: null,
    realtimeChannel: null,

    async signIn(email, password) {
      if (!this.configured) throw new Error('Supabase is not configured');
      const { data, error } = await this.client.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });
      if (error) throw error;
      this.authUser = data.user;
      await this.loadProfile();
      if (!this.profile) {
        await this.client.auth.signOut();
        throw new Error('לא נמצא פרופיל משתמש בענן');
      }
      return { user: this.authUser, profile: this.profile };
    },

    async loadProfile() {
      if (!this.client) return null;
      const { data: authData } = await this.client.auth.getUser();
      this.authUser = authData?.user || null;
      if (!this.authUser) {
        this.profile = null;
        return null;
      }
      const { data, error } = await this.client
        .from('profiles')
        .select('id,role,username,display_name,language,address_gender')
        .eq('id', this.authUser.id)
        .maybeSingle();
      if (error) throw error;
      this.profile = data || null;
      return this.profile;
    },

    async restoreSession() {
      if (!this.configured) return null;
      const { data } = await this.client.auth.getSession();
      if (!data?.session) return null;
      await this.loadProfile();
      return this.profile ? { user: this.authUser, profile: this.profile } : null;
    },

    async signOut() {
      if (!this.client) return;
      await this.client.auth.signOut();
      this.authUser = null;
      this.profile = null;
      this.stopRealtime();
    },

    async loadDataInto(appData) {
      if (!this.client || !this.profile) return { loaded: false, empty: true };

      const tables = await Promise.all([
        this.client.from('residents').select('*').order('id'),
        this.client.from('medications').select('*').order('id'),
        this.client.from('resident_medications').select('*'),
        this.client.from('rounds').select('*').order('time'),
        this.client.from('round_entries').select('*'),
        this.client.from('round_entry_medications').select('*'),
        this.client.from('administrations').select('id,legacy_id,round_id,resident_id,medication_id,caregiver_id,status,administered_at,note,session_id').order('administered_at'),
        this.client.from('profiles').select('id,role,username,display_name,language,address_gender')
      ]);
      const errors = tables.map(x => x.error).filter(Boolean);
      if (errors.length) throw errors[0];

      const [residents, medications, links, rounds, entries, entryMeds, administrations, profiles] =
        tables.map(x => x.data || []);

      const empty = residents.length === 0 && medications.length === 0 && rounds.length === 0;
      if (empty) return { loaded: false, empty: true };

      appData.residents = residents.map(r => ({
        id: r.id, name: r.name, room: r.room || '', notes: r.notes || '', photoUrl: r.photo_url || ''
      }));

      appData.meds = medications.map(m => ({
        id: m.id, name: m.name, type: m.type || '', dose: m.dose || '', notes: m.notes || ''
      }));

      const medsByResident = {};
      links.forEach(x => {
        (medsByResident[x.resident_id] ||= []).push(x.medication_id);
      });
      appData.residents.forEach(r => { r.meds = medsByResident[r.id] || []; });

      const medsByEntry = {};
      entryMeds.forEach(x => {
        const key = x.round_id + '|' + x.resident_id;
        (medsByEntry[key] ||= []).push(x.medication_id);
      });
      const entriesByRound = {};
      entries.forEach(x => {
        const key = x.round_id + '|' + x.resident_id;
        (entriesByRound[x.round_id] ||= []).push({
          residentId: x.resident_id,
          medIds: medsByEntry[key] || [],
          notes: x.notes || ''
        });
      });
      appData.rounds = rounds.map(r => ({
        id: r.id,
        name: r.name,
        time: String(r.time).slice(0,5),
        entries: entriesByRound[r.id] || []
      }));

      const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
      appData.nurses = profiles
        .filter(p => p.role === 'caregiver')
        .map(p => ({ id: p.id, name: p.display_name || p.username || '', username: p.username || '' }));

      appData.history = administrations.map(h => {
        const p = profileMap[h.caregiver_id];
        const dt = h.administered_at ? new Date(h.administered_at) : new Date();
        return {
          id: h.legacy_id || h.id,
          roundId: h.round_id,
          residentId: h.resident_id,
          medId: h.medication_id,
          status: h.status,
          date: dt.toISOString(),
          time: dt.toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' }),
          nurseName: p?.display_name || '',
          sessionId: h.session_id || '',
          note: h.note || ''
        };
      });

      appData.activeRoundSession = null;
      if (this.authUser) {
        const mine = administrations.filter(x => x.caregiver_id === this.authUser.id && x.session_id);
        if (mine.length) {
          const latestSession = mine[mine.length - 1].session_id;
          const sessionRows = mine.filter(x => x.session_id === latestSession);
          const roundId = sessionRows[0]?.round_id;
          if (roundId) {
            const statuses = {};
            sessionRows.forEach(x => {
              (statuses[x.resident_id] ||= { meds:{} }).meds[x.medication_id] = {
                status: x.status,
                note: x.note || '',
                time: new Date(x.administered_at).toLocaleTimeString('he-IL', {hour:'2-digit',minute:'2-digit'})
              };
            });
            appData.activeRoundSession = { roundId, statuses, startTime: latestSession };
          }
        }
      }

      return { loaded: true, empty: false };
    },

    async saveManagerData(appData) {
      if (!this.client || !this.profile || this.profile.role !== 'manager') {
        return false;
      }

      const residents = (appData.residents || []).map(r => ({
        id: r.id, name: r.name, room: r.room || '', notes: r.notes || '', photo_url: r.photoUrl || null
      }));
      const medications = (appData.meds || []).map(m => ({
        id: m.id, name: m.name, type: m.type || '', dose: m.dose || '', notes: m.notes || ''
      }));

      let result = await this.client.from('residents').upsert(residents, { onConflict:'id' });
      if (result.error) throw result.error;
      result = await this.client.from('medications').upsert(medications, { onConflict:'id' });
      if (result.error) throw result.error;

      const links = [];
      (appData.residents || []).forEach(r => (r.meds || []).forEach(medication_id =>
        links.push({ resident_id:r.id, medication_id })
      ));
      if (links.length) {
        result = await this.client.from('resident_medications').upsert(links, { onConflict:'resident_id,medication_id' });
        if (result.error) throw result.error;
      }

      const rounds = (appData.rounds || []).map(r => ({
        id:r.id, name:r.name, time:(r.time || '00:00').slice(0,5) + ':00'
      }));
      if (rounds.length) {
        result = await this.client.from('rounds').upsert(rounds, { onConflict:'id' });
        if (result.error) throw result.error;
      }

      const entries = [];
      const roundMeds = [];
      (appData.rounds || []).forEach(r => (r.entries || []).forEach(e => {
        entries.push({ round_id:r.id, resident_id:e.residentId, notes:e.notes || '' });
        (e.medIds || []).forEach(medication_id =>
          roundMeds.push({ round_id:r.id, resident_id:e.residentId, medication_id })
        );
      }));
      if (entries.length) {
        result = await this.client.from('round_entries').upsert(entries, { onConflict:'round_id,resident_id' });
        if (result.error) throw result.error;
      }
      if (roundMeds.length) {
        result = await this.client.from('round_entry_medications').upsert(roundMeds, { onConflict:'round_id,resident_id,medication_id' });
        if (result.error) throw result.error;
      }
      return true;
    },

    async saveCurrentAdministrations(appData) {
      if (!this.client || !this.authUser) return false;
      const mine = (appData.history || []).filter(h =>
        h.nurseName === (this.profile?.display_name || '') ||
        !h.nurseName
      );
      const rows = mine.map(h => ({
        legacy_id: h.id,
        round_id: h.roundId,
        resident_id: h.residentId,
        medication_id: h.medId,
        caregiver_id: this.authUser.id,
        status: h.status,
        administered_at: h.date || new Date().toISOString(),
        note: h.note || '',
        session_id: h.sessionId || null
      }));
      if (rows.length) {
        const { error } = await this.client
          .from('administrations')
          .upsert(rows, { onConflict:'legacy_id' });
        if (error) throw error;
      }
      return true;
    },

    subscribeRealtime(onChange) {
      if (!this.client || !this.profile) return;
      this.stopRealtime();
      const channel = this.client.channel('medtrack-db-changes')
        .on('postgres_changes', { event:'*', schema:'public', table:'residents' }, onChange)
        .on('postgres_changes', { event:'*', schema:'public', table:'medications' }, onChange)
        .on('postgres_changes', { event:'*', schema:'public', table:'resident_medications' }, onChange)
        .on('postgres_changes', { event:'*', schema:'public', table:'rounds' }, onChange)
        .on('postgres_changes', { event:'*', schema:'public', table:'round_entries' }, onChange)
        .on('postgres_changes', { event:'*', schema:'public', table:'round_entry_medications' }, onChange)
        .on('postgres_changes', { event:'*', schema:'public', table:'administrations' }, onChange)
        .subscribe();
      this.realtimeChannel = channel;
    },

    stopRealtime() {
      if (this.client && this.realtimeChannel) {
        this.client.removeChannel(this.realtimeChannel);
        this.realtimeChannel = null;
      }
    }
  };

  window.medtrackCloud = cloud;
})();
