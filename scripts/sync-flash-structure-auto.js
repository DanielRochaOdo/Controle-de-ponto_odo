import { createClient } from '@supabase/supabase-js';
import { getFlashCompanies } from '../api/_lib/flashCompanies.js';
import { syncFlashStructureTarget } from '../api/sync-flash-structure.js';

const TIME_ZONE = 'America/Fortaleza';
const TARGETS = ['employees', 'departments', 'schedules'];
const LOCK_TIMEOUT_MS = 4 * 60 * 60 * 1000;

const getServerClient = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessários.');
  console.log(`Projeto Supabase usado pela rotina: ${new URL(url).host}.`);
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
};

const dateKeyInFortaleza = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)?.value).join('-');
};

async function main() {
  const supabase = getServerClient();
  const { data: settings, error: settingsError } = await supabase
    .from('flash_structure_sync_settings')
    .select('is_enabled,last_updated_at')
    .eq('id', 1)
    .single();
  if (settingsError) throw settingsError;
  if (!settings.is_enabled) {
    console.log('Sincronização automática desativada; execução ignorada.');
    return;
  }
  if (settings.last_updated_at && dateKeyInFortaleza(new Date(settings.last_updated_at)) === dateKeyInFortaleza(new Date())) {
    console.log('A sincronização de hoje já foi concluída; execução ignorada.');
    return;
  }

  const runningStartedAt = new Date().toISOString();
  const staleRunBefore = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();
  const claimLock = (staleLock = false) => {
    let query = supabase
      .from('flash_structure_sync_settings')
      .update({ is_running: true, running_started_at: runningStartedAt, progress_company_name: null, progress_target: null, progress_current: null, progress_total: null, progress_unit: null, updated_at: runningStartedAt })
      .eq('id', 1)
      .eq('is_enabled', true);
    query = staleLock
      ? query.eq('is_running', true).lt('running_started_at', staleRunBefore)
      : query.eq('is_running', false);
    return query.select('id').maybeSingle();
  };

  let { data: claim, error: claimError } = await claimLock();
  if (claimError) throw claimError;
  if (!claim) {
    const staleClaim = await claimLock(true);
    if (staleClaim.error) throw staleClaim.error;
    claim = staleClaim.data;
  }
  if (!claim) {
    console.log('Outra sincronização está em andamento; execução ignorada.');
    return;
  }

  try {
    if (!process.env.FLASH_API_KEY) throw new Error('FLASH_API_KEY não está configurada nas Secrets do GitHub.');
    const companies = getFlashCompanies();
    const missingCompanies = companies.filter((company) => !company.id);
    if (missingCompanies.length) {
      throw new Error(`Configure nas Secrets do GitHub os IDs das empresas: ${missingCompanies.map((company) => company.env).join(', ')}.`);
    }

    const { data: admin, error: adminError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('role', 'admin')
      .order('user_id')
      .limit(1)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!admin?.user_id) throw new Error('Nenhum usuário administrador está configurado.');

    console.log(`Sincronizando ${companies.length} empresas, em sequência.`);
    for (const company of companies) {
      for (const target of TARGETS) {
        const { error: progressError } = await supabase
          .from('flash_structure_sync_settings')
          .update({
            progress_company_name: company.name,
            progress_target: target,
            progress_current: 0,
            progress_total: 0,
            progress_unit: target === 'departments' ? 'departamentos' : 'funcionários',
            updated_at: new Date().toISOString(),
          })
          .eq('id', 1)
          .eq('is_running', true);
        if (progressError) throw progressError;

        await syncFlashStructureTarget({
          supabase,
          userId: admin.user_id,
          company,
          target,
          onProgress: async ({ target: progressTarget, current, total, unit }) => {
            const { error } = await supabase
              .from('flash_structure_sync_settings')
              .update({
                progress_company_name: company.name,
                progress_target: progressTarget,
                progress_current: current,
                progress_total: total,
                progress_unit: unit,
                updated_at: new Date().toISOString(),
              })
              .eq('id', 1)
              .eq('is_running', true);
            if (error) throw error;
          },
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const { error: finishError } = await supabase
      .from('flash_structure_sync_settings')
      .update({ is_running: false, running_started_at: null, progress_company_name: null, progress_target: null, progress_current: null, progress_total: null, progress_unit: null, last_updated_at: finishedAt, updated_at: finishedAt })
      .eq('id', 1);
    if (finishError) throw finishError;
    console.log(`Sincronização geral concluída em ${new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }).format(new Date(finishedAt))}.`);
  } catch (error) {
    await supabase
      .from('flash_structure_sync_settings')
      .update({ is_running: false, running_started_at: null, progress_company_name: null, progress_target: null, progress_current: null, progress_total: null, progress_unit: null, updated_at: new Date().toISOString() })
      .eq('id', 1);
    throw error;
  }
}

main().catch((error) => {
  console.error('Falha na sincronização automática da Estrutura Flash:', error);
  process.exitCode = 1;
});
